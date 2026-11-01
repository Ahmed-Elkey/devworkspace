import https from 'node:https';
import http from 'node:http';
import httpProxy from 'http-proxy';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
/**
 * Public edge proxy.
 *
 * Locally (unchanged): terminates TLS for https://localhost:8443 and routes
 * /api/* and /socket.io/* to the API and everything else to the backend web app.
 *
 * Production option 1 — FRONT_STATIC_ROOT: when set, non-API GET/HEAD paths are
 * served from the built designed frontend directory (MPA: /pricing -> pricing.html),
 * with 404.html as the not-found fallback. The backend web app keeps serving
 * locally via WEB_INTERNAL_URL when FRONT_STATIC_ROOT is unset.
 *
 * Production option 2 — PROXY_ORIGIN overrides the pinned public origin
 * (default https://localhost:8443): used for the Host pinning, the staging
 * upload origin check and the websocket upgrade check. TLS material comes from
 * PROXY_TLS_KEY / PROXY_TLS_CERT inside the TLS directory (same default
 * filenames as before), so a real certificate can replace the dev pair without
 * touching this script.
 *
 * Production option 3 — PROXY_TLS=off: plain HTTP listener for a host whose
 * TLS termination is an upstream edge on the same machine (Caddy); the default
 * remains the local development HTTPS listener.
 */
const origin = process.env.PROXY_ORIGIN ?? 'https://localhost:8443';
const originHost = new URL(origin).host;
const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
const web = process.env.WEB_INTERNAL_URL ?? 'http://127.0.0.1:3000';
const storage = process.env.S3_INTERNAL_URL ?? 'http://127.0.0.1:9000';
const staticRoot = process.env.FRONT_STATIC_ROOT
  ? resolve(process.env.FRONT_STATIC_ROOT)
  : null;
const tlsDirectory = resolve(process.env.WORKSPACE_ROOT ?? process.cwd(), '.local/tls');
const tlsKeyFile = resolve(tlsDirectory, process.env.PROXY_TLS_KEY ?? 'localhost-key.pem');
const tlsCertFile = resolve(tlsDirectory, process.env.PROXY_TLS_CERT ?? 'localhost.pem');
const tlsOff = process.env.PROXY_TLS === 'off';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Serve one file inside staticRoot; deny traversal and unsafe verbs. */
async function serveStatic(request, response, requestPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (pathname.includes('\0')) {
    response.writeHead(400);
    response.end();
    return;
  }
  const clean = pathname.replace(/\/+$/, '');
  const candidates =
    clean === ''
      ? ['index.html']
      : [clean + '.html', clean + '/index.html', clean.replace(/^\/+/, '')];
  for (const relative of candidates) {
    const file = resolve(staticRoot, '.' + (relative.startsWith('/') ? relative : '/' + relative));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      response.writeHead(200, {
        'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).pipe(response);
      return;
    } catch {
      /* try next candidate */
    }
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('Not found');
}

const proxy = httpProxy.createProxyServer({ changeOrigin: false, xfwd: false });
proxy.on('error', (_error, _request, response) => {
  if ('writeHead' in response && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Foundation upstream unavailable');
  } else response.destroy();
});

async function edge(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.headers.host !== originHost) {
    response.writeHead(421);
    response.end();
    return;
  }
  const path = (request.url ?? '/').split('?')[0];
  if (path.startsWith('/dw-staging')) {
    const query = new URL(request.url, origin).searchParams;
    if (
      request.method !== 'PUT' ||
      request.headers.origin !== origin ||
      !/^\/dw-staging\/[A-Za-z0-9/_-]+$/.test(path) ||
      !query.has('X-Amz-Signature') ||
      request.headers['if-none-match'] !== '*'
    ) {
      response.writeHead(403);
      response.end('Staging request denied');
      return;
    }
    const size = Number(request.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 1 || size > 25 * 1024 * 1024) {
      response.writeHead(413);
      response.end();
      return;
    }
    delete request.headers.cookie;
    let received = 0;
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > 25 * 1024 * 1024) request.destroy();
    });
    proxy.web(request, response, { target: storage });
    return;
  }
  if (/^\/(dw-canonical|storage-admin|s3-admin)(\/|$)/.test(path)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (staticRoot) {
    if ((request.method ?? 'GET') === 'GET' || (request.method ?? 'GET') === 'HEAD') {
      void serveStatic(request, response, path);
      return;
    }
    response.writeHead(405);
    response.end();
    return;
  }
  proxy.web(request, response, {
    target: path.startsWith('/api/') || path.startsWith('/socket.io/') ? api : web,
  });
}

const server = tlsOff
  ? http.createServer(
      (
        request,
        response,
      ) => void edge(request, response),
    )
  : https.createServer(
      { key: await readFile(tlsKeyFile), cert: await readFile(tlsCertFile) },
      (
        request,
        response,
      ) => void edge(request, response),
    );
server.on('upgrade', (request, socket, head) => {
  if (
    request.headers.host !== originHost ||
    request.headers.origin !== origin ||
    !(request.url ?? '').startsWith('/socket.io/')
  ) {
    socket.destroy();
    return;
  }
  proxy.ws(request, socket, head, { target: api });
});
server.listen(8443, process.env.PROXY_BIND_HOST ?? '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      event: 'proxy.bootstrap.ready',
      origin,
      tls: tlsOff ? 'edge-terminated' : 'terminated-here',
      storageGuarantees: 'V03 not proven',
    }),
  ),
);
function stop() {
  proxy.close();
  server.close(() => process.exit(0));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

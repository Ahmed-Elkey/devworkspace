import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

/**
 * SMTP delivery adapter. Never logs recipient or body.
 *
 * Default (unset SMTP_URL): bounded local development relay on 127.0.0.1:1025
 * (Mailpit), plain SMTP, same behaviour as the original local adapter.
 *
 * Production: set SMTP_URL=smtp://user:pass@host:587 (or smtps://…:465 for
 * implicit TLS) and SMTP_FROM='DevWorkspace <you@provider.com>'. When
 * credentials are present the adapter upgrades to STARTTLS (or connects over
 * implicit TLS) and authenticates with AUTH PLAIN; it refuses to offer
 * credentials to a relay that will not start TLS.
 */

function readSession(passed?: number) {
  const env = process.env.SMTP_URL?.trim();
  if (!env) return { host: '127.0.0.1', port: passed ?? 1025, user: '', pass: '', implicitTls: false };
  const url = new URL(env);
  if (!/^smtps?:$/.test(url.protocol)) throw new Error('SMTP_URL must be smtp:// or smtps://');
  const port = passed ?? (Number(url.port) || (url.protocol === 'smtps:' ? 465 : 587));
  return {
    host: url.hostname,
    port,
    user: url.username ? decodeURIComponent(url.username) : '',
    pass: url.password ? decodeURIComponent(url.password) : '',
    implicitTls: url.protocol === 'smtps:' || Number(url.port) === 465,
  };
}

function senderAddress(from: string) {
  const m = from.match(/<([^>]+)>/);
  const candidate = (m?.[1] ?? from).trim();
  if (!/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(candidate)) throw new Error('Invalid SMTP_FROM sender');
  return candidate;
}

export async function sendLocalMail(
  mail: { to: string; subject: string; text: string; idempotencyKey?: string },
  port = 1025,
) {
  if (!/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(mail.to) || /[\r\n]/.test(mail.subject))
    throw new Error('Invalid mail envelope');
  const session = readSession(port === 1025 ? undefined : port);
  /* SNI must carry a hostname; sending an IP is discouraged (RFC 6066) and warns in Node. */
  const isIp = net.isIP(session.host) !== 0;
  const from = process.env.SMTP_FROM?.trim() || 'DevWorkspace <noreply@devworkspace.test>';
  const envelopeFrom = senderAddress(from);
  const idempotencyKey = mail.idempotencyKey || crypto.randomUUID();

  let socket: net.Socket | tls.TLSSocket = session.implicitTls
    ? tls.connect({
        host: session.host,
        port: session.port,
        servername: isIp ? undefined : session.host,
      })
    : net.createConnection({ host: session.host, port: session.port });

  let buffer = '';
  let replyLines: string[] = [];
  let failure: Error | undefined;
  let pending: { resolve: (code: number) => void; reject: (error: Error) => void } | undefined;
  const queued: number[] = [];

  /** Bind reply handling to the current socket. Called again after STARTTLS,
   *  where the TLS socket is a new object carrying the decrypted stream. */
  function bind(current: net.Socket | tls.TLSSocket) {
    current.setKeepAlive?.(true);
    current.setTimeout(10000, () => current.destroy(new Error('SMTP timeout')));
    current.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}[ -]/.test(line)) {
          replyLines.push(line);
          if (/^\d{3} /.test(line)) {
            const code = Number(line.slice(0, 3));
            if (pending) {
              pending.resolve(code);
              pending = undefined;
            } else queued.push(code);
          }
        }
      }
    });
    current.on('error', (error: Error) => {
      failure = error;
      pending?.reject(error);
      pending = undefined;
    });
    current.on('close', () => {
      if (pending) {
        pending.reject(new Error('SMTP closed'));
        pending = undefined;
      }
    });
  }
  bind(socket);

  const reply = () =>
    failure
      ? Promise.reject(failure)
      : queued.length
        ? Promise.resolve(queued.shift()!)
        : new Promise<number>((resolve, reject) => {
            pending = { resolve, reject };
          });
  const expect = async (code: number) => {
    const got = await reply();
    if (got !== code) throw new Error('SMTP rejected delivery (code ' + got + ')');
  };

  try {
    await expect(220);
    const hello = 'EHLO devworkspace.local.test';
    const run = (line: string) => {
      replyLines = [];
      socket.write(line + '\r\n');
    };
    run(hello);
    await expect(250);
    if (session.user) {
      let caps: string[];
      if (session.implicitTls) caps = capabilities();
      else {
        if (!capabilities().some((c) => c.trim() === 'STARTTLS'))
          throw new Error('SMTP relay does not offer STARTTLS');
        socket.write('STARTTLS\r\n');
        await expect(220);
        const previous = socket;
        socket = tls.connect({ socket: previous, servername: isIp ? undefined : session.host });
        for (const event of ['data', 'error', 'close', 'timeout']) previous.removeAllListeners(event);
        bind(socket);
        run(hello);
        await expect(250);
        caps = capabilities();
      }
      if (!caps.some((c) => /^AUTH\b/.test(c.trim()))) throw new Error('SMTP relay offers no AUTH');
      const plain = Buffer.from('\0' + session.user + '\0' + (session.pass || '')).toString('base64');
      run('AUTH PLAIN ' + plain);
      await expect(235);
    }
    for (const [line, code] of [
      ['MAIL FROM:<' + envelopeFrom + '>', 250],
      [`RCPT TO:<${mail.to}>`, 250],
      ['DATA', 354],
    ] as const) {
      run(line);
      await expect(code);
    }
    const headers =
      `From: ${from.replace(/[\r\n]/g, '')}\r\n` +
      `To: <${mail.to}>\r\n` +
      `Subject: ${mail.subject}\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Message-ID: <${idempotencyKey}@${envelopeFrom.split('@')[1]}>\r\n` +
      'Content-Type: text/plain; charset=utf-8\r\n';
    const text = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(headers + '\r\n' + text + '\r\n.\r\n');
    await expect(250);
    run('QUIT');
    await expect(221);
  } finally {
    socket.destroy();
  }

  /** EHLO capability lines captured since the last command. */
  function capabilities() {
    return replyLines.map((l) => l.slice(4));
  }
}

import { createApi } from './app.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Serverless entry for platforms that invoke a Node (req, res) handler
// (e.g. Vercel Functions). Reuses the already-initialized Nest application
// across invocations; no listen() call, no sockets opened at bootstrap.
// createApi() initializes middleware, security headers and the global API
// prefix before init(), so every request passing through this handler
// inherits the exact same behavior as the long-running server.

type NestApp = Awaited<ReturnType<typeof createApi>>['app'];
type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<NestApp> | null = null;
let expressHandler: NodeHandler | null = null;

export default async function handler(
  serverlessReq: IncomingMessage,
  serverlessRes: ServerResponse,
) {
  if (!appPromise) appPromise = createApi().then((bag) => bag.app);
  const handle: NodeHandler =
    expressHandler ?? ((await appPromise).getHttpAdapter().getInstance() as unknown as NodeHandler);
  expressHandler = handle;

  // Express does not invoke next() for handled routes; it ends the response
  // instead. Resolve on response close so the function terminates exactly when
  // the response is finalized (success, error, or client disconnect).
  await new Promise<void>((resolve) => {
    serverlessRes.on('close', resolve);
    handle(serverlessReq, serverlessRes);
  });
}

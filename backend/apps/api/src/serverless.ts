import { createApi } from './app.js';

// Serverless entry for platforms that invoke a Node (req, res) handler
// (e.g. Vercel Functions). Reuses the already-initialized Nest application
// across invocations; no listen() call, no sockets opened at bootstrap.
// createApi() initializes middleware, security headers and the global API
// prefix before init(), so every request passing through this handler
// inherits the exact same behavior as the long-running server.

type NestApp = Awaited<ReturnType<typeof createApi>>['app'];

let appPromise: Promise<NestApp> | null = null;
let expressHandler: ((req: unknown, res: unknown) => unknown) | null = null;

function toNodeHandler(app: NestApp): (req: never, res: never) => unknown {
  const instance = app.getHttpAdapter().getInstance() as unknown as (
    req: never,
    res: never,
  ) => unknown;
  return instance;
}

export default async function handler(serverlessReq: any, serverlessRes: any) {
  if (!appPromise) appPromise = createApi().then((bag) => bag.app);
  const app = await appPromise;
  if (!expressHandler) expressHandler = toNodeHandler(app) as never;

  await new Promise<void>((resolve) => {
    (expressHandler as unknown as (req: any, res: any, next: () => void) => void)(
      serverlessReq,
      serverlessRes,
      () => resolve(),
    );
  });
}

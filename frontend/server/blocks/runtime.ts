import { buildCsp, STORAGE_ORIGINS } from "../security/csp.ts";
import { createSecurityMiddleware } from "../security/plugin.ts";
import { createLoopbackRedirect } from "../fnHost/appOrigin.ts";
import { createBlocksHost, type BlocksFunctionName } from "./host.ts";
import type { FunctionHandler } from "../../functions/_lib/types.ts";
import { createApiMiddleware } from "../api/middleware.ts";
import type { CallerReads } from "../api/brief/access.ts";
import type { PurgeModuleLike } from "../fnHost/purgeWorker.ts";

import type { IncomingMessage, ServerResponse } from "node:http";
export type Next = (error?: unknown) => void;
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;
export interface MiddlewareStack {
  use(handler: Middleware): void;
  use(path: string, handler: Middleware): void;
}
export interface RuntimeOptions { root: string; appOrigin: string; apiOrigin: string; env: Record<string, string> }
/** Mounts the Blocks-backed routes. With `loadPurge` (a serving host: the dev server, the production server) the
 *  background project purge runs too; `stop` ends it when the server closes. */
export function mountBlocksRuntime(middlewares: MiddlewareStack, o: RuntimeOptions,
  loadRouter: (name: BlocksFunctionName) => Promise<FunctionHandler>,
  loadPurge?: () => Promise<PurgeModuleLike>): { stop(): void } {
  const embedded = o.env.VITE_BLOCKS_AUTH_MODE === "embedded";
  // Engine API middleware — handles /api/engine/*, /api/projects/*, /api/artifacts/*, /api/steps/*, /api/brief/*, /api/github/*
  // The brief and extraction routes read the project as the signed-in person (the host's caller reads, set below);
  // without the embedded host they refuse every request (503), never answer without a session.
  // The legacy engine routes (/api/engine/*, /api/steps/*, /api/projects*, /api/artifacts/*) are left out: in Blocks
  // mode every piece of work is an EngineJob row that the MADP engine runs on the engine host, never this server.
  let callerReads: CallerReads | null = null;
  let host: ReturnType<typeof createBlocksHost> | null = null;
  middlewares.use(createApiMiddleware({
    legacyGithub: false,
    legacyEngine: false,
    callerReads: (req, res, reads) => (callerReads ? callerReads(req, res, reads) : Promise.resolve({ ok: false as const, status: 503 })),
    readings: (objectId) => (host ? host.readings(objectId) : Promise.resolve(null)),
    callOp: (req, res, op, args) => (host ? host.callProjectOp(req, res, op, args) : Promise.resolve({ ok: false as const, status: 503, code: "unavailable" })),
  }));
  middlewares.use(createLoopbackRedirect({ appOrigin: o.appOrigin }));
  middlewares.use(createSecurityMiddleware({
    csp: (nonce) => buildCsp({
      nonce, https: true, appOrigin: o.appOrigin, blocksApiOrigin: o.apiOrigin,
      storageOrigins: STORAGE_ORIGINS, wasm: false, reportOnly: false,
    }),
  }));
  if (embedded) {
    // Blocks projects for new Factory projects are made with the Blocks CLI by the MADP engine worker on the engine
    // host (engineWorker/worker.ts, MF_BLOCKS_PROVISIONING_ENABLED there); this server only writes the Project row.
    const blocksHost = createBlocksHost({ ...o, loadRouter, ...(loadPurge ? { loadPurge } : {}) });
    host = blocksHost;
    blocksHost.startBackground();
    callerReads = blocksHost.readAsCaller;
    // IAM OIDC: /api/idp/initiate, /api/idp/callback, /api/idp/signup-settings
    middlewares.use(blocksHost.iamOidc);
    // Bearer token interceptor: handles /api/auth/session with genesis-os tokens (before the full auth middleware)
    middlewares.use("/api/auth", blocksHost.bearerAuth);
    middlewares.use("/api/auth", (req, res, next) => { void blocksHost.auth(req, res, next); });
    middlewares.use("/api/fn", blocksHost.fn);
    middlewares.use("/api/public/plans", (req, res, next) => { void blocksHost.publicPlans(req, res, next); });
    middlewares.use("/api/public/i18n", (req, res, next) => { void blocksHost.publicI18n(req, res, next); });
    middlewares.use(blocksHost.githubRoutes);
    middlewares.use(blocksHost.logicProxy);
    middlewares.use(blocksHost.dataAndBridge);
  }
  // Missing platform integrations must fail explicitly, never fall through to SQLite
  // or Vite's HTML fallback. Engine/GitHub API migration is a separate checkpoint.
  middlewares.use((req, res, next) => {
    if (req.url !== "/api" && !(req.url ?? "").startsWith("/api/")) return next();
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ok: false, error: { code: "SERVER_NOT_CONFIGURED", message: "This application service has not been connected to Blocks yet." } }));
  });
  return { stop: () => host?.stopBackground() };
}

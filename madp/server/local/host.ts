// The local host: the same-origin server routes of MADP Factory, all on the local store.
//   /api/auth/*          sign-in, session, sign-out, password and activation flows (server/fnHost/authRoutes.ts)
//   /api/data            browser reads (server/local/dataRoute.ts)
//   /api/fn/<function>   the functions' routers and ops (server/fnHost/middleware.ts -> server/local/backend.ts)
//   /api/files/*         signed upload / download URLs of local Storage
//   /api/public/share/*  public share links
//   /api/public/plans    the plan catalogue for the pricing page (no sign-in)
//   /api/public/i18n     the texts of one language (no sign-in; the local adapter has none: bundled texts)
// plus the background project purge. The session is the sealed HttpOnly mf_session cookie, as on the hosted app.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { formatFnLogLine } from "../../functions/_lib/stats.ts";
import { createLoopbackRedirect } from "../fnHost/appOrigin.ts";
import { createAuthMiddleware, createSignupDeps } from "../fnHost/authRoutes.ts";
import { createSignupFlows } from "../fnHost/signup.ts";
import { createLocalSignupBackend, pendingSignup } from "./signup.ts";
import { createIpLimiter, createLoginLimiter } from "../fnHost/loginLimiter.ts";
import { SECURITY_HEADERS, createFnMiddleware, type SessionLookup } from "../fnHost/middleware.ts";
import { createPasswordGate } from "../fnHost/passwordGate.ts";
import { createPurgeWorker } from "../fnHost/purgeWorker.ts";
import { parseSessionSecret } from "../fnHost/sessionCrypto.ts";
import { createSessionStore } from "../fnHost/sessionStore.ts";
import { createHostTokenStore } from "../fnHost/tokenStore.ts";
import type { Backend } from "./backend.ts";
import { createLocalDataRoute, loadReadPolicies } from "./dataRoute.ts";
import { metaGet, metaSet } from "./db.ts";
import { createFilesRoute } from "./filesRoute.ts";
import { createLocalIamAuth } from "./iam/auth.ts";
import { revokeUser } from "./iam/store.ts";
import { createLocalVerifier } from "./iam/verify.ts";
import { grantWorkspaceAccess } from "./iam/walkIn.ts";
import { LOCAL_TENANT, type LocalRuntime } from "./runtime.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/** The function env the routers read (readEnv): local values; nothing here leaves the process. */
export const LOCAL_FN_ENV: Record<string, string> = {
  MF_BLOCKS_API_URL: "https://factory.local",
  MF_BLOCKS_TENANT: LOCAL_TENANT,
  MF_SVC_CLIENT_ID: "factory-host",
  MF_SVC_CLIENT_SECRET: "local",
};

function sessionSecret(rt: LocalRuntime): Buffer {
  let s = metaGet(rt.db, "session.secret");
  if (!s) {
    s = randomBytes(32).toString("base64url");
    metaSet(rt.db, "session.secret", s);
  }
  const key = parseSessionSecret(s);
  if (!key) throw new Error("session secret unreadable");
  return key;
}

export function createLocalHost(o: { rt: LocalRuntime; loadBackend(): Promise<Backend> }) {
  const { rt } = o;
  const appOrigin = rt.appOrigin;
  const host = new URL(appOrigin).host;
  const info = (line: string) => rt.log("info", line);

  const iam = createLocalIamAuth({
    db: rt.db,
    appOrigin: () => rt.appOrigin,
    log: info,
    walkIn: (u) => grantWorkspaceAccess(rt, u),
    accountDeactivated: (userId) => rt.store.rows("Account").some((a) => a.UserId === userId && a.Status === "deactivated"),
    pendingSignup: (userId) => pendingSignup(rt, userId),
  });
  const sessions = createSessionStore({ keys: [sessionSecret(rt)], secure: false, iam, log: info });
  const signupBackend = createLocalSignupBackend(rt);
  const passwordGate = createPasswordGate({
    read: async (userId) => rt.store.rows("Account").some((a) => a.UserId === userId && a.MustChangePassword === true),
    log: info,
  });
  const sessionLookup = async (req: IncomingMessage, res: ServerResponse): Promise<SessionLookup> => {
    const r = await sessions.read(req, res);
    return r.state === "ok" ? { state: "ok", accessToken: r.session.accessToken, userId: r.session.userId } : { state: r.state };
  };

  // Background work (the purge) yields while a person's request runs.
  let interactive = 0;
  const gate = {
    enter() {
      interactive += 1;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        interactive -= 1;
      };
    },
  };

  let current: Backend | null = null;
  const backend = async (): Promise<Backend> => {
    const b = await o.loadBackend();
    if (current && current !== b) current.stop();
    current = b;
    return b;
  };

  const policiesCache = { at: 0, value: loadReadPolicies(rt.paths.root) };
  const policies = () => {
    // Re-read now and then, so a policy edited during a session applies without a restart.
    if (Date.now() - policiesCache.at > 5_000) {
      try {
        policiesCache.value = loadReadPolicies(rt.paths.root);
      } catch {
        /* keep the last good table */
      }
      policiesCache.at = Date.now();
    }
    return policiesCache.value;
  };

  const auth = createAuthMiddleware({
    appOrigin,
    expectedHost: host,
    configured: { ok: true },
    sessions,
    iam,
    limiter: createLoginLimiter(),
    flowLimiter: createIpLimiter({ limit: 20, windowMs: 60_000 }),
    passwordGate,
    accountLinkHosts: [appOrigin.toLowerCase()],
    log: info,
    signup: createSignupDeps({
      flows: createSignupFlows({ backend: signupBackend, appOrigin, log: info }),
      mode: signupBackend.mode,
      ticketKey: sessionSecret(rt),
      revokeSessions: (userId) => sessions.revokeUser(userId),
    }),
  });

  const data = createLocalDataRoute({ origin: appOrigin, expectedHost: host, session: sessionLookup, passwordGate, db: rt.db, store: rt.store, policies, log: info });

  const fn = createFnMiddleware({
    env: LOCAL_FN_ENV,
    origin: appOrigin,
    expectedHost: host,
    session: sessionLookup,
    onRefused: (req, res) => void sessions.end(req, res),
    passwordGate,
    onAccountChanged: (userId, kind) => {
      if (kind === "deactivated") {
        sessions.revokeUser(userId);
        revokeUser(rt.db, userId);
      }
      passwordGate.forget(userId);
    },
    hostInfo: { tokenVerification: "iam", csp: "enforce" },
    routerLog: (level, line) => rt.log(level, `[fn] ${line}`),
    textLine: (level, line) => rt.log(level, line),
    loadRouter: async (name) => ({ default: (await backend()).routers[name as keyof Backend["routers"]] }) as never,
    verify: createLocalVerifier(rt.db, new URL(appOrigin).hostname),
    interactive: gate,
    apiUrl: LOCAL_FN_ENV.MF_BLOCKS_API_URL,
    tokenStore: createHostTokenStore(),
    bootstrapCache: false,
    log: (entry) => rt.log(entry.overBudget ? "warn" : "info", formatFnLogLine(entry)),
  });

  const files = createFilesRoute(rt);
  const share: Handler = (req, res, next) => {
    backend().then((b) => b.publicShare(req, res, next), next);
  };
  const plans: Handler = (req, res, next) => {
    backend().then((b) => b.publicPlans(req, res, next), next);
  };
  const i18n: Handler = (req, res, next) => {
    backend().then((b) => b.publicI18n(req, res, next), next);
  };
  const apiNotFound: Handler = (_req, res) => {
    res.statusCode = 404;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.end(JSON.stringify({ ok: false, error: { code: "not_found" } }));
  };

  const mounts: { path: string | null; handler: Handler }[] = [
    { path: null, handler: createLoopbackRedirect({ appOrigin }) as Handler },
    { path: "/api/auth", handler: auth as unknown as Handler },
    { path: "/api/data", handler: data as unknown as Handler },
    { path: "/api/fn", handler: fn as unknown as Handler },
    { path: "/api/files", handler: files as unknown as Handler },
    { path: "/api/public/share", handler: share },
    { path: "/api/public/plans", handler: plans },
    { path: "/api/public/i18n", handler: i18n },
    { path: "/api", handler: apiNotFound },
  ];

  const purge = createPurgeWorker({
    load: async () => (await backend()).purge as never,
    platform: { env: LOCAL_FN_ENV },
    isBusy: () => interactive > 0,
    log: (level, line) => rt.log(level, line),
  });

  return {
    mounts,
    start() {
      purge.start();
      // Builds the routers now (engine hook, doorbell), so the first request does not wait for them.
      void backend().catch((e: unknown) => rt.log("error", `[fn] functions not loaded: ${e instanceof Error ? e.message : String(e)}`));
    },
    /** Loads the backend again now if one of its modules changed (the engine hook's drivers restart on the new code). */
    reload() {
      void backend().catch((e: unknown) => rt.log("error", `[fn] functions not loaded: ${e instanceof Error ? e.message : String(e)}`));
    },
    close() {
      purge.stop();
      current?.stop();
    },
  };
}

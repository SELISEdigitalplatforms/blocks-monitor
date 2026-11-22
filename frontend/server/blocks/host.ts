import { createBlocksClient, BlocksApiError } from "@seliseblocks/client";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildBatchQuery, splitBatchAnswer } from "../../functions/_lib/batch.ts";
import type { FunctionHandler } from "../../functions/_lib/types.ts";
import { createAuthMiddleware, createSignupDeps } from "../fnHost/authRoutes.ts";
import { createSignupFlows } from "../fnHost/signup.ts";
import { createBlocksSignupBackend } from "./signup.ts";
import { createDataLimiter, createLoginLimiter, createIpLimiter } from "../fnHost/loginLimiter.ts";
import { createFnMiddleware, readBody, SECURITY_HEADERS } from "../fnHost/middleware.ts";
import { liveS1Catalog, validateDataRequest, type ValidRead } from "../fnHost/dataRead.ts";
import type { CallerOp, CallerReads } from "../api/brief/access.ts";
import type { ReadingLoader } from "../api/brief/builder.ts";
import { parsePublishedReading, type PublishedReading } from "../api/extraction/process.ts";
import { serviceClient, serviceTokens } from "../../functions/_lib/serviceToken.ts";
import { defaultSdk } from "../../functions/_lib/sdk.ts";
import { createFiles } from "../../functions/_lib/storage.ts";
import { createRawGateway } from "../../functions/_lib/gateway.ts";
import { createUtilitiesAccess } from "../../functions/_lib/blocksUtilities.ts";
import { utilitiesBaseOf } from "../../src/domain/blocksUtilities.ts";
import { createPublicPlansHandler } from "../fnHost/publicPlans.ts";
import { createPublicI18nHandler } from "../fnHost/publicI18n.ts";
import { UILM_LANGUAGE } from "../../src/i18n/modules.ts";
import { randomUUID } from "node:crypto";
import type { FnContext } from "../fnHost/verifyToken.ts";
import { createBlocksIam } from "./iam.ts";
import * as iamAdmin from "../iam/iamAdmin.ts";
import { createBlocksSessions, sessionStoreFile, sessionStoreKey } from "./sessions.ts";
import { createGithubIntegration } from "./github.ts";
import { createGithubStore } from "./githubStore.ts";
import { githubTokenKey } from "./githubCrypto.ts";
import { createPurgeWorker, type PurgeModuleLike } from "../fnHost/purgeWorker.ts";

type Next = (error?: unknown) => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

/** The functions this host serves at POST /api/fn/<name> (server/blocks/backend.ts builds one router each). A name
 *  left out here has no router on this host: a call to it fails (that was the admin function's 500 internal). */
export const BLOCKS_FUNCTIONS = ["workspace", "project", "delivery", "collab", "admin", "billing"] as const;
export type BlocksFunctionName = (typeof BLOCKS_FUNCTIONS)[number];
export const isBlocksFunction = (name: string): name is BlocksFunctionName => (BLOCKS_FUNCTIONS as readonly string[]).includes(name);

/**
 * project.delete only marks the Project 'deleting'; this worker removes its rows, Storage objects and the Project row
 * (functions/_lib/purge.ts) with the host's service identity: at once after a delete (the wake hook) and on a slow poll
 * that resumes leftover work. It yields while people's requests run. Without the service settings it stays off.
 */
export function createBlocksPurgeWorker(
  env: { apiUrl: string; tenant?: string; clientId?: string; clientSecret?: string },
  loadPurge: () => Promise<PurgeModuleLike>,
  isBusy: () => boolean,
  log: (level: "info" | "warn" | "error", line: string) => void = (level, line) => { if (level === "info") console.log(line); else console.warn(line); },
) {
  return createPurgeWorker({
    load: loadPurge,
    platform: {
      env: { MF_BLOCKS_TENANT: env.tenant ?? "", MF_SVC_CLIENT_ID: env.clientId ?? "", MF_SVC_CLIENT_SECRET: env.clientSecret ?? "", MF_BLOCKS_API_URL: env.apiUrl },
      apiUrl: env.apiUrl,
    },
    isBusy,
    log,
  });
}

/** How long one Data Gateway call made for a browser read (POST /api/data, the brief routes, the bridge) may take before
 *  it is given up and answered 503: the SDK sets no timeout of its own, so a stuck call held the screen on "loading"
 *  for up to Node's 5-minute default. The browser's read path then retries after its back-off. */
export const DATA_CALL_TIMEOUT_MS = 25_000;

/** A fetch that gives up after `ms` (and still honours the caller's own signal). */
export function fetchWithTimeout(ms: number, base: typeof fetch = globalThis.fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const timeout = AbortSignal.timeout(ms);
    return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  }) as typeof fetch;
}

/** One page of a validated read as the browser's transport expects it. The gateway answers totalCount; when an answer
 *  lacks it, a full page says there may be more (the count is then the rows known so far), so a list is never cut at
 *  its first page in silence. */
export function dataPage(part: { items: Record<string, unknown>[]; totalCount: number | null }, read: { pageNo: number; pageSize: number }) {
  const known = (read.pageNo - 1) * read.pageSize + part.items.length;
  const totalCount = part.totalCount ?? known;
  const hasNextPage = part.totalCount === null ? part.items.length >= read.pageSize : read.pageNo * read.pageSize < totalCount;
  return { ok: true as const, items: part.items, totalCount, pageNo: read.pageNo, pageSize: read.pageSize, hasNextPage };
}

export function createBlocksHost(o: {
  root: string; appOrigin: string; apiOrigin: string; env: Record<string, string>;
  loadRouter(name: BlocksFunctionName): Promise<FunctionHandler>;
  /** The durable project purge (functions/_lib/purge.ts) as this host loads modules; without it no purge runs here. */
  loadPurge?: () => Promise<PurgeModuleLike>;
}) {
  const env = { apiUrl: o.apiOrigin, tenant: o.env.MF_BLOCKS_TENANT || o.env.VITE_BLOCKS_PROJECT_KEY,
    clientId: o.env.MF_SVC_CLIENT_ID, clientSecret: o.env.MF_SVC_CLIENT_SECRET };
  const configured = Boolean(env.tenant && env.clientId && env.clientSecret);
  // IAM administration (roles, permissions, organizations, access) on this host's service identity.
  if (configured) iamAdmin.configureIamAdmin(env);
  const iam = createBlocksIam(env);
  // Sessions survive a dev-server restart: an encrypted store under ~/.config/madp-factory/, keyed from the service secret.
  const sessionKey = sessionStoreKey(env.clientSecret, env.tenant);
  const sessions = createBlocksSessions(iam, Date.now, sessionKey ? {
    file: sessionStoreFile(o.appOrigin), key: sessionKey,
    warn: (reason) => { console.warn(`[blocks-sessions] ${reason}`); },
  } : undefined);
  const expectedHost = new URL(o.appOrigin).host;
  // Public sign-up acts as the service identity (no caller token exists yet); the form ticket key comes from the same
  // service secret as the session store key, through its own derivation.
  const signupBackend = configured && sessionKey
    ? createBlocksSignupBackend(env, { log: (line) => console.warn(line) })
    : null;
  const auth = createAuthMiddleware({ appOrigin: o.appOrigin, expectedHost,
    configured: configured ? { ok: true } : { ok: false, reason: "credentials" },
    iam, sessions, limiter: createLoginLimiter(), flowLimiter: createIpLimiter({ limit: 20, windowMs: 60_000 }),
    accountLinkHosts: [o.appOrigin, "https://iam.seliseblocks.com"],
    // one line per sign-up, verification and reset request (method, path, status, time, outcome tag; never a value)
    log: (line) => { if (/ \/(signup|verify|password\/(forgot|reset))\b/.test(line)) console.warn(line); },
    ...(signupBackend && sessionKey ? {
      signup: createSignupDeps({
        flows: createSignupFlows({ backend: signupBackend, appOrigin: o.appOrigin, log: (line) => console.warn(line) }),
        mode: signupBackend.mode,
        ticketKey: sessionKey,
        revokeSessions: (userId) => sessions.revokeUser(userId),
      }),
    } : {}),
  });
  const session = async (req: IncomingMessage, res: ServerResponse) => {
    const result = await sessions.read(req, res);
    return result.state === "ok" ? { state: "ok" as const, accessToken: result.session.accessToken, userId: result.session.userId } : result;
  };
  const verify = async (token: string): Promise<FnContext> => {
    const user = await iam.me(token);
    const nameParts = [user.firstName, user.lastName].filter(Boolean);
    return { tenantId: env.tenant, userId: user.itemId, email: user.email, roles: user.roles, permissions: user.permissions,
      organizationId: user.organizationId || "default", isAuthenticated: true, impersonated: false, applicationDomain: new URL(o.appOrigin).hostname,
      identitySource: "iam", displayName: user.displayName || nameParts.join(" ").trim() };
  };
  const key = githubTokenKey(o.env.MF_GITHUB_TOKEN_KEY);
  const github = key && o.env.GITHUB_CLIENT_ID && o.env.GITHUB_CLIENT_SECRET ? createGithubIntegration({
    origin: o.appOrigin, clientId: o.env.GITHUB_CLIENT_ID, clientSecret: o.env.GITHUB_CLIENT_SECRET,
    store: createGithubStore(o.env, o.apiOrigin, key),
    identity: async (req, res) => {
      const current = await sessions.read(req, res);
      if (current.state !== "ok") return null;
      const user = await iam.me(current.session.accessToken);
      if (user.itemId !== current.session.userId) return null;
      return { userId: user.itemId, sid: current.session.sid };
    },
  }) : null;
  // Background work (the project purge) yields while a person's request runs.
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
  const purge = o.loadPurge ? createBlocksPurgeWorker({ ...env, apiUrl: o.apiOrigin }, o.loadPurge, () => interactive > 0) : null;
  const fn = createFnMiddleware({ env: o.env, origin: o.appOrigin, expectedHost, verify, session,
    interactive: gate,
    verifyRepository: github?.verifyRepository,
    iamAdmin,
    apiUrl: o.apiOrigin, bootstrapCache: false, onRefused: (req, res) => { sessions.end(req, res); },
    loadRouter: async (name) => {
      if (!isBlocksFunction(name)) throw new Error("service_not_connected");
      return { default: await o.loadRouter(name) };
    },
    callerIamFor: ["admin", "workspace"],
    // Blocks Utilities scopes a subscription to the bearer's organization: billing asks with the caller's own token.
    utilitiesFor: ["billing"],
    // A request that fails inside the host (answered 500 internal) leaves one redacted line, so it can be diagnosed.
    routerLog: (level, line) => { if (level === "error") console.error(`[fn] ${line}`); },
  });
  // read again when blocks/data/schemas changes (a new field needs no restart)
  const catalog = liveS1Catalog(o.root);
  // a ceiling per address before the session is read, then a budget per session (two people behind one address, or one
  // person's two tabs, never starve each other's reads)
  const limit = createDataLimiter();
  /** Runs validated reads with the caller's own token: one batched GraphQL request, isolated per read on errors. */
  async function runReads(sdk: ReturnType<typeof createBlocksClient>, reads: readonly ValidRead[]) {
    const isolateReads = async () => Promise.all(reads.map(async (read) => {
      try {
        const isolated = await sdk.data.graphql(buildBatchQuery([read.member]));
        return splitBatchAnswer(isolated, 1)[0];
      } catch {
        return { ok: false as const, errorText: null };
      }
    }));
    let parts;
    let response: unknown;
    try {
      response = await sdk.data.graphql(buildBatchQuery(reads.map((read) => read.member)));
      parts = splitBatchAnswer(response, reads.length);
    } catch (error) {
      const status = error instanceof BlocksApiError ? error.status : null;
      // Retry only client-side GraphQL/schema errors. Auth failures, rate limits and server outages are not fanned out.
      if (reads.length <= 1 || status === null || status < 400 || status >= 500 || status === 401 || status === 403 || status === 429) throw error;
      parts = await isolateReads();
    }
    // A schema with cloud/local field drift can cause a GraphQL validation error with no response path;
    // GraphQL then rejects every root in the batch. Isolate those reads so valid workspace/member reads
    // still work, while only the incompatible schema reads fail. Normal and path-scoped errors stay batched.
    const graph = response && typeof response === "object" ? response as { errors?: unknown } : {};
    const errors = Array.isArray(graph.errors) ? graph.errors : [];
    const hasGlobalError = errors.some((error: unknown) => {
      const value = error && typeof error === "object" ? error as { path?: unknown } : {};
      const path = value.path;
      return !Array.isArray(path) || typeof path[0] !== "string" || !/^q\d+$/.test(path[0]);
    });
    if (hasGlobalError && reads.length > 1) parts = await isolateReads();
    return parts;
  }
  /** The server's own reads as the signed-in caller (the brief routes): the same session, IAM and catalogue checks as
   *  POST /api/data, so a person only ever gets rows their own token may read. */
  const callerLimit = createIpLimiter({ limit: 240, windowMs: 60_000 });
  const readAsCaller: CallerReads = async (req, res, reads) => {
    const headerHost = String(req.headers[":authority"] ?? req.headers.host ?? "");
    if (headerHost !== expectedHost || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return { ok: false, status: 403 };
    if (!callerLimit.take(req.socket.remoteAddress ?? "").ok) return { ok: false, status: 429 };
    const current = await sessions.read(req, res);
    if (current.state !== "ok") return { ok: false, status: current.state === "unavailable" ? 503 : 401 };
    try { await iam.me(current.session.accessToken); }
    catch (error) {
      if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) {
        sessions.end(req, res);
        return { ok: false, status: 401 };
      }
      return { ok: false, status: 503 };
    }
    const parsed = validateDataRequest({ reads }, catalog());
    if (!parsed.ok) return { ok: false, status: 400 };
    const sdk = createBlocksClient({ apiUrl: env.apiUrl, xBlocksKey: env.tenant, accessToken: current.session.accessToken, fetch: fetchWithTimeout(DATA_CALL_TIMEOUT_MS) });
    try {
      const parts = await runReads(sdk, parsed.reads);
      return { ok: true, userId: current.session.userId, results: parts.map((part) => (part.ok ? { ok: true as const, items: part.items, totalCount: part.totalCount } : { ok: false as const })) };
    } catch (error) {
      return { ok: false, status: error instanceof BlocksApiError && error.status === 401 ? 401 : 503 };
    }
  };
  /** The MADP engine's published readings (one JSON object per reading in the project's Storage folder), loaded with
   *  the service identity. Only ever asked for an object id that a file.extract job row pointed at, and that row was
   *  read by the brief route as the signed-in caller (their own token): what a person may read is decided there.
   *  Readings never change once written, so they are kept in memory (bounded). */
  const readingCache = new Map<string, PublishedReading>();
  const svcTokens = configured ? serviceTokens(env, defaultSdk) : null;
  const svcFiles = svcTokens ? createFiles({ client: serviceClient(env, defaultSdk, svcTokens), workspaceIdOf: async () => { throw new Error("not used"); } }) : null;
  /** GET /api/public/plans: the plan catalogue for the pricing page, no sign-in (read with the service identity; the
   *  answer carries the public plan fields only). Without the service credential it answers 503 and the page shows
   *  its default plans. */
  const svcRaw = svcTokens ? createRawGateway({ env, sdk: defaultSdk, tokens: svcTokens }) : null;
  const publicPlans = createPublicPlansHandler({
    raw: svcRaw ?? { findAll: async () => { throw new Error("service_not_configured"); } },
    utilities: svcTokens ? createUtilitiesAccess({ env: { ...env, utilitiesBase: utilitiesBaseOf(o.env.MF_BLOCKS_UTILITIES_BASE) }, sdk: defaultSdk, tokens: svcTokens }) : null,
    expectedHost,
  });
  /** GET /api/public/i18n/<culture>[/<module>]: the Factory's texts from Blocks UILM for the language switch, no sign-in
   *  (read with the service identity; the answer is the dictionary only). Without the service credential it answers 503
   *  and the app keeps its bundled texts. English in UILM is MF_UILM_EN_LANGUAGE (en-US unless the tenant uses "en"). */
  const svcClient = svcTokens ? serviceClient(env, defaultSdk, svcTokens) : null;
  const uilmLanguage = { ...UILM_LANGUAGE, ...(o.env.MF_UILM_EN_LANGUAGE ? { en: o.env.MF_UILM_EN_LANGUAGE } : {}) };
  const publicI18n = createPublicI18nHandler({
    read: async (module, culture) => {
      if (!svcClient) throw new Error("service_not_configured");
      return (await svcClient()).localization.cloudTranslations(module, uilmLanguage[culture]);
    },
    expectedHost,
  });
  const readings: ReadingLoader = async (objectId) => {
    const hit = readingCache.get(objectId);
    if (hit) return hit;
    if (!svcFiles || !/^[A-Za-z0-9_-]{1,128}$/.test(objectId)) return null;
    const { url } = await svcFiles.downloadUrl(objectId);
    if (!url.startsWith("https://")) return null;
    const answer = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!answer.ok) return null;
    const text = await answer.text();
    if (text.length > 8_000_000) return null;
    let parsed: PublishedReading | null = null;
    try { parsed = parsePublishedReading(JSON.parse(text)); } catch { parsed = null; }
    if (!parsed) return null;
    readingCache.set(objectId, parsed);
    if (readingCache.size > 2000) readingCache.delete(readingCache.keys().next().value!);
    return parsed;
  };
  /** One op of the project function as the signed-in caller: the same router, permission checks, stamps and audit as
   *  POST /api/fn/project (the brief routes write people's decisions through it). */
  let callSeq = 0;
  const callProjectOp: CallerOp = async (req, res, op, args) => {
    const headerHost = String(req.headers[":authority"] ?? req.headers.host ?? "");
    if (headerHost !== expectedHost || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return { ok: false, status: 403, code: "forbidden" };
    const current = await sessions.read(req, res);
    if (current.state !== "ok") return { ok: false, status: current.state === "unavailable" ? 503 : 401, code: "unauthenticated" };
    let context: FnContext;
    try { context = await verify(current.session.accessToken); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : null;
      return { ok: false, status: status === 401 || status === 403 ? 401 : 503, code: "unauthenticated" };
    }
    const router = await o.loadRouter("project");
    const answer = await router.dispatch(
      { method: "POST", path: "/project", query: {}, headers: {}, body: { op, args, requestId: randomUUID() } },
      {
        context,
        env: { BLOCKS_API_URL: o.apiOrigin, BLOCKS_TENANT: env.tenant, SVC_CLIENT_ID: env.clientId, SVC_CLIENT_SECRET: env.clientSecret,
          ...(o.env.MF_FACTORY_DESIGN_WORKER_ID ? { FACTORY_DESIGN_WORKER_ID: o.env.MF_FACTORY_DESIGN_WORKER_ID } : {}),
          ...(o.env.MF_FIGMA_DESIGN_WORKER_ID ? { FIGMA_DESIGN_WORKER_ID: o.env.MF_FIGMA_DESIGN_WORKER_ID } : {}),
          ...(o.env.MF_EXTRACTION_WORKER_ID ? { EXTRACTION_WORKER_ID: o.env.MF_EXTRACTION_WORKER_ID } : {}) },
        run: { id: `host-brief-${++callSeq}`, attempt: 1 },
      },
    );
    const body = answer.body as { ok?: boolean; data?: unknown; error?: { code?: unknown } };
    if (answer.statusCode < 400 && body?.ok === true) return { ok: true, data: body.data };
    return { ok: false, status: answer.statusCode >= 400 ? answer.statusCode : 500, code: typeof body?.error?.code === "string" ? body.error.code : "failed" };
  };
  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.statusCode = status;
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.end(JSON.stringify(body));
  }
  /** 429 with how long to wait (the browser's read path pauses that long instead of asking again at once). */
  const tooMany = (res: ServerResponse, verdict: { ok: false; retryAfterS: number }) =>
    send(res, 429, { ok: false }, { "retry-after": String(verdict.retryAfterS) });
  const dataAndBridge: Handler = (req, res, next) => {
    const url = req.url ?? "";
    const isData = url.split("?")[0] === "/api/data";
    const isBridge = url.startsWith("/api/blocks/");
    if (!isData && !isBridge) return next();
    void (async () => {
      const headerHost = String(req.headers[":authority"] ?? req.headers.host ?? "");
      if (headerHost !== expectedHost || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return send(res, 403, { ok: false });
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "POST") return send(res, 405, { ok: false });
      if (method === "POST" && (req.headers.origin !== o.appOrigin || !String(req.headers["content-type"] ?? "").startsWith("application/json"))) return send(res, 403, { ok: false });
      const byAddress = limit.address(req.socket.remoteAddress ?? "");
      if (!byAddress.ok) return tooMany(res, byAddress);
      const current = await sessions.read(req, res);
      if (current.state !== "ok") return send(res, current.state === "unavailable" ? 503 : 401, { ok: false });
      const bySession = limit.session(current.session.sid);
      if (!bySession.ok) return tooMany(res, bySession);
      try { await iam.me(current.session.accessToken); }
      catch (error) {
        if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) {
          sessions.end(req, res);
          return send(res, 401, { ok: false });
        }
        throw error;
      }
      const sdk = createBlocksClient({ apiUrl: env.apiUrl, xBlocksKey: env.tenant, accessToken: current.session.accessToken, fetch: fetchWithTimeout(DATA_CALL_TIMEOUT_MS) });
      let body: unknown;
      if (method === "POST") {
        const raw = await readBody(req, 1_000_000, 10_000);
        if (typeof raw === "string") return send(res, raw === "timeout" ? 408 : 413, { ok: false });
        try { body = JSON.parse(raw.toString("utf8")); } catch { return send(res, 400, { ok: false }); }
      }
      if (isData) {
        if (method !== "POST") return send(res, 405, { ok: false });
        const parsed = validateDataRequest(body, catalog());
        if (!parsed.ok) return send(res, 400, { ok: false });
        const parts = await runReads(sdk, parsed.reads);
        return send(res, 200, { results: parts.map((part, index) => {
          if (!part.ok) return { ok: false, error: { code: "unavailable" } };
          return dataPage(part, parsed.reads[index]);
        }) });
      }
      const path = url.slice("/api/blocks".length);
      // No auth/admin passthrough or arbitrary upstream URL. These SDK calls run only as the verified caller.
      if (!/^\/(data|notifier|localization)\/v4\//.test(path) || /[\\\u0000-\u0020]/.test(path)) return send(res, 403, { ok: false });
      const target = new URL(path, env.apiUrl);
      if (target.origin !== new URL(env.apiUrl).origin || !/^\/(data|notifier|localization)\/v4\//.test(target.pathname)) return send(res, 403, { ok: false });
      return send(res, 200, await sdk.http.request(path, { method, ...(body === undefined ? {} : { body }) }));
    })().catch((error: unknown) => send(res, error instanceof BlocksApiError && error.status === 401 ? 401 : 503, { ok: false, error: { code: "unavailable" } }));
  };
  const githubRoutes: Handler = (req, res, next) => {
    if (!(req.url ?? "").startsWith("/api/github/")) return next();
    if (!github) return send(res, 503, { error: "github_not_configured" });
    return github.handle(req, res, next);
  };
  return {
    auth, fn, dataAndBridge, githubRoutes, readAsCaller, readings, callProjectOp, publicPlans, publicI18n,
    /** Starts the background work (the project purge worker); a host made only to answer requests never starts it. */
    startBackground() { purge?.start(); },
    stopBackground() { purge?.stop(); },
  };
}

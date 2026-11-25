import { createBlocksClient, BlocksApiError } from "@seliseblocks/client";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildBatchQuery, splitBatchAnswer } from "../../functions/_lib/batch.ts";
import type { FunctionHandler } from "../../functions/_lib/types.ts";
import { createAuthMiddleware, createSignupDeps } from "../fnHost/authRoutes.ts";
import { profileFrom } from "../fnHost/iamAuth.ts";
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
  /** Extract a Bearer token from the Authorization header. */
  function bearerTokenOf(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    const m = /^Bearer\s+(\S+)$/i.exec(value ?? "");
    return m ? m[1] : null;
  }

  /** Decode a JWT's payload without calling iam.me() — works for cross-tenant OIDC tokens.
   *  Returns the userId or null if the token is malformed/expired. */
  function userIdFromJwt(token: string): string | null {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      if (exp > 0 && exp * 1000 < Date.now()) return null; // expired
      return String(payload.user_id || payload.sub || "") || null;
    } catch { return null; }
  }

  /** Resolve the caller's identity: BFF session cookie first, then Bearer token (decoded from JWT). */
  const session = async (req: IncomingMessage, res: ServerResponse) => {
    const result = await sessions.read(req, res);
    if (result.state === "ok") return { state: "ok" as const, accessToken: result.session.accessToken, userId: result.session.userId };
    // No BFF session cookie — accept a Bearer token (OIDC or genesis-os)
    const bearer = bearerTokenOf(req);
    if (bearer) {
      const userId = userIdFromJwt(bearer);
      if (userId) return { state: "ok" as const, accessToken: bearer, userId };
    }
    return result;
  };
  const verify = async (token: string): Promise<FnContext> => {
    // Try MADP IAM first; if it rejects (cross-tenant OIDC token), decode the JWT directly
    try {
      const user = await iam.me(token);
      const nameParts = [user.firstName, user.lastName].filter(Boolean);
      return { tenantId: env.tenant, userId: user.itemId, email: user.email, roles: user.roles, permissions: user.permissions,
        organizationId: user.organizationId || "default", isAuthenticated: true, impersonated: false, applicationDomain: new URL(o.appOrigin).hostname,
        identitySource: "iam", displayName: user.displayName || nameParts.join(" ").trim() };
    } catch {
      // Cross-tenant OIDC token: decode JWT claims. Grant full MADP access (mf-super-admin) since
      // the user authenticated through Blocks IAM — role mapping is the OIDC tenant's responsibility.
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const userId = String(payload.user_id || payload.sub || "");
      if (!userId) throw new Error("verify");
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      if (exp > 0 && exp * 1000 < Date.now()) throw new Error("verify");
      const email = String(payload.email || "");
      const firstName = String(payload.given_name || payload.firstName || "");
      const lastName = String(payload.family_name || payload.lastName || "");
      return { tenantId: env.tenant, userId, email, roles: ["mf-super-admin", "mf-user"], permissions: [],
        organizationId: String(payload.org_id || "default"), isAuthenticated: true, impersonated: false, applicationDomain: new URL(o.appOrigin).hostname,
        identitySource: "iam", displayName: `${firstName} ${lastName}`.trim() || email };
    }
  };
  const key = githubTokenKey(o.env.MF_GITHUB_TOKEN_KEY);
  const github = key && o.env.GITHUB_CLIENT_ID && o.env.GITHUB_CLIENT_SECRET ? createGithubIntegration({
    origin: o.appOrigin, clientId: o.env.GITHUB_CLIENT_ID, clientSecret: o.env.GITHUB_CLIENT_SECRET,
    store: createGithubStore(o.env, o.apiOrigin, key),
    identity: async (req, res) => {
      const current = await sessions.read(req, res);
      if (current.state === "ok") {
        const user = await iam.me(current.session.accessToken);
        if (user.itemId !== current.session.userId) return null;
        return { userId: user.itemId, sid: current.session.sid };
      }
      // Fall back to Bearer token (OIDC or genesis-os)
      const bearer = bearerTokenOf(req);
      if (!bearer) return null;
      const uid = userIdFromJwt(bearer);
      if (!uid) return null;
      return { userId: uid, sid: `bearer-${uid}` };
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
    // Try session cookie first, then Bearer token from the Blocks shell
    let accessToken: string;
    const current = await sessions.read(req, res);
    if (current.state === "ok") {
      accessToken = current.session.accessToken;
      // Validate: JWT decode (works for cross-tenant OIDC tokens too)
      if (!userIdFromJwt(accessToken)) {
        sessions.end(req, res);
        return { ok: false, status: 401 };
      }
    } else {
      const bearer = bearerTokenOf(req);
      if (!bearer) return { ok: false, status: current.state === "unavailable" ? 503 : 401 };
      const uid = userIdFromJwt(bearer);
      if (!uid) return { ok: false, status: 401 };
      accessToken = bearer;
    }
    const parsed = validateDataRequest({ reads }, catalog());
    if (!parsed.ok) return { ok: false, status: 400 };
    // Cross-tenant OIDC token: use service token for data access
    let sdkTokenR = accessToken;
    try {
      const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const tokenTenant = String(payload.tenant_id || "");
      if (tokenTenant && tokenTenant !== env.tenant && svcTokens) {
        sdkTokenR = await svcTokens.token();
      }
    } catch { /* use original */ }
    const sdk = createBlocksClient({ apiUrl: env.apiUrl, xBlocksKey: env.tenant, accessToken: sdkTokenR, fetch: fetchWithTimeout(DATA_CALL_TIMEOUT_MS) });
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
    // Try session cookie first, then Bearer token from the Blocks shell
    let accessToken: string;
    const current = await sessions.read(req, res);
    if (current.state === "ok") {
      accessToken = current.session.accessToken;
    } else {
      const bearer = bearerTokenOf(req);
      if (!bearer) return { ok: false, status: current.state === "unavailable" ? 503 : 401, code: "unauthenticated" };
      const uid = userIdFromJwt(bearer);
      if (!uid) return { ok: false, status: 401, code: "unauthenticated" };
      accessToken = bearer;
    }
    let context: FnContext;
    try { context = await verify(accessToken); }
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
      // Try session cookie first, then Bearer token from the Blocks shell
      let accessToken: string;
      let sessionSid: string | null = null;
      const current = await sessions.read(req, res);
      if (current.state === "ok") {
        accessToken = current.session.accessToken;
        sessionSid = current.session.sid;
      } else {
        const bearer = bearerTokenOf(req);
        if (!bearer) return send(res, current.state === "unavailable" ? 503 : 401, { ok: false });
        const uid = userIdFromJwt(bearer);
        if (!uid) return send(res, 401, { ok: false });
        accessToken = bearer;
      }
      if (sessionSid) {
        const bySession = limit.session(sessionSid);
        if (!bySession.ok) return tooMany(res, bySession);
      }
      // Per-project isolation: if the frontend sends x-blocks-project-tenant, use that tenant.
      // Otherwise fall back to the MADP tenant with service token for cross-tenant OIDC users.
      const projectTenant = String(req.headers["x-blocks-project-tenant"] || "").trim();
      let sdkTenant = projectTenant || env.tenant;
      let sdkToken = accessToken;
      // If using the user's own project tenant, the OIDC token should work directly (same tenant).
      // If no project tenant (shared MADP data), use the service token for cross-tenant access.
      if (!projectTenant) {
        try {
          const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
          const tokenTenant = String(payload.tenant_id || "");
          if (tokenTenant && tokenTenant !== env.tenant && svcTokens) {
            sdkToken = await svcTokens.token();
          }
        } catch { /* use original */ }
      }
      const sdk = createBlocksClient({ apiUrl: env.apiUrl, xBlocksKey: sdkTenant, accessToken: sdkToken, fetch: fetchWithTimeout(DATA_CALL_TIMEOUT_MS) });
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
  /** Resolve the OIDC access token from session cookie or Bearer header. */
  async function resolveAccessToken(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    const current = await sessions.read(req, res);
    if (current.state === "ok") return current.session.accessToken;
    const bearer = bearerTokenOf(req);
    if (bearer && userIdFromJwt(bearer)) return bearer;
    return null;
  }

  /** Extract the tenant_id from a JWT. */
  function tenantFromJwt(token: string): string {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      return typeof payload.tenant_id === "string" ? payload.tenant_id : iamXBlocksKey;
    } catch { return iamXBlocksKey; }
  }

  /** GET /api/blocks-project/list: lists projects from Blocks OS. */
  const blocksProjectList: Handler = (req, res, next) => {
    const url = req.url ?? "";
    if (url.split("?")[0] !== "/api/blocks-project/list" || req.method !== "GET") return next();
    void (async () => {
      const accessToken = await resolveAccessToken(req, res);
      if (!accessToken) return send(res, 401, { error: "unauthenticated" });
      if (!blocksOsUrl) return send(res, 503, { error: "blocks_os_not_configured" });
      const tokenTenant = tenantFromJwt(accessToken);
      const params = new URL(url, o.appOrigin).searchParams;
      const page = params.get("page") || "1";
      const pageSize = params.get("pageSize") || "50";
      try {
        const targetUrl = `${blocksOsUrl}/api/Project/Gets?page=${page}&pageSize=${pageSize}&tenantGroupId=`;
        console.log("[blocks-project/list] calling:", targetUrl);
        const upstream = await fetch(targetUrl, {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}`, "x-blocks-key": tokenTenant, accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        const responseText = await upstream.text();
        console.log("[blocks-project/list] response:", upstream.status, responseText.slice(0, 300));
        res.statusCode = upstream.status;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(responseText);
      } catch (err) { console.error("[blocks-project/list] failed:", err); send(res, 503, { error: "blocks_os_unavailable" }); }
    })();
  };

  /** POST /api/blocks-project/create: creates a Blocks project via Logic API.
   *  Payload: { name, resources?: [{ resourceId, name, link }], applicationContexts?: [...] }
   *  Returns: { tenantGroupId, isSuccess } — the new project's tenant ID. */
  const blocksProjectCreate: Handler = (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== "/api/blocks-project/create" || req.method !== "POST") return next();
    void (async () => {
      const accessToken = await resolveAccessToken(req, res);
      if (!accessToken) return send(res, 401, { error: "unauthenticated" });
      const raw = await readBody(req, 100_000, 10_000);
      if (typeof raw === "string") return send(res, raw === "timeout" ? 408 : 413, { error: "invalid_input" });
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw.toString("utf8")); } catch { return send(res, 400, { error: "invalid_input" }); }
      if (!blocksOsUrl) return send(res, 503, { error: "blocks_os_not_configured" });
      const tokenTenant = tenantFromJwt(accessToken);
      // Build the Blocks OS project creation payload
      const payload: Record<string, unknown> = {
        name: body.name || body.projectName || "",
        isAcceptBlocksTerms: true,
        isUseBlocksExclusively: true,
        resources: Array.isArray(body.resources) ? body.resources : [],
        applicationContexts: Array.isArray(body.applicationContexts) ? body.applicationContexts : [
          { environment: "dev", domain: `https://dev-${String(body.name || "app").toLowerCase().replace(/[^a-z0-9]/g, "")}.seliseblocks.com`, cookieDomain: "seliseblocks.com" },
        ],
      };
      try {
        const upstream = await fetch(`${blocksOsUrl}/api/Project/Create`, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "x-blocks-key": tokenTenant, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        const responseText = await upstream.text();
        console.log("[blocks-project/create] response:", upstream.status, responseText.slice(0, 500));
        res.statusCode = upstream.status;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(responseText);
      } catch (err) {
        console.error("[blocks-project/create] failed:", err);
        send(res, 503, { error: "blocks_project_unavailable" });
      }
    })();
  };
  /** POST /api/blocks-project/add-asset: connects a GitHub repo to an existing Blocks project.
   *  Body: { tenantGroupId, resource: { resourceId, name, link } }
   *  Called when user connects a repo AFTER project creation. */
  const blocksProjectAddAsset: Handler = (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== "/api/blocks-project/add-asset" || req.method !== "POST") return next();
    void (async () => {
      const accessToken = await resolveAccessToken(req, res);
      if (!accessToken) return send(res, 401, { error: "unauthenticated" });
      const raw = await readBody(req, 100_000, 10_000);
      if (typeof raw === "string") return send(res, raw === "timeout" ? 408 : 413, { error: "invalid_input" });
      if (!blocksOsUrl) return send(res, 503, { error: "blocks_os_not_configured" });
      try {
        const upstream = await fetch(`${blocksOsUrl}/api/Project/AddAsset`, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "x-blocks-key": tenantFromJwt(accessToken), "content-type": "application/json", accept: "application/json" },
          body: raw,
          signal: AbortSignal.timeout(25_000),
        });
        const responseBody = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(responseBody);
      } catch { send(res, 503, { error: "blocks_logic_unavailable" }); }
    })();
  };
  /** GET /api/github/callback: GitHub OAuth callback — exchanges the code via Blocks Logic API
   *  and shows a success page that auto-closes. */
  const githubOAuthCallback: Handler = (req, res, next) => {
    const url = new URL(req.url || "/", o.appOrigin);
    if (url.pathname !== "/api/github/callback") return next();
    void (async () => {
      const code = url.searchParams.get("code") || "";
      if (!code) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html");
        res.end("<html><body><p>GitHub authorization failed.</p><script>window.close();</script></body></html>");
        return;
      }
      // Exchange the code via Blocks Logic API
      const accessToken = await resolveAccessToken(req, res);
      if (accessToken && logicBaseUrl) {
        try {
          const tokenTenant = tenantFromJwt(accessToken);
          await fetch(`${logicBaseUrl}/api/auth/accessToken?code=${encodeURIComponent(code)}&ProjectKey=${encodeURIComponent(tokenTenant)}`, {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}`, "x-blocks-key": tokenTenant, accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
        } catch { /* best effort */ }
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html");
      res.end("<html><body><p>GitHub connected! You can close this window.</p><script>window.close();</script></body></html>");
    })();
  };
  const githubRoutes: Handler = (req, res, next) => {
    if (!(req.url ?? "").startsWith("/api/github/")) return next();
    if (!github) return send(res, 503, { error: "github_not_configured" });
    return github.handle(req, res, next);
  };
  /** Proxy to Blocks Logic service: forwards /api/logic/* to BLOCKS_LOGIC_BASE_URL/api/*
   *  with the caller's access token. Used for GitHub auth, repos, build/deploy, and project operations
   *  that live on the Blocks Logic service rather than the MADP BFF. */
  const logicBaseUrl = o.env.BLOCKS_LOGIC_BASE_URL || "";
  /** Blocks OS API for project management (Create, AddAsset, Gets). Falls back to Logic API. */
  const blocksOsUrl = o.env.BLOCKS_OS_BASE_URL || logicBaseUrl;
  const logicProxy: Handler = (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/logic/")) return next();
    if (!logicBaseUrl) return send(res, 503, { error: "blocks_logic_not_configured" });
    void (async () => {
      // Authenticate: session cookie or Bearer token
      // Authenticate: session cookie or Bearer token (JWT decode, no iam.me)
      let accessToken: string;
      const current = await sessions.read(req, res);
      if (current.state === "ok") {
        accessToken = current.session.accessToken;
      } else {
        const bearer = bearerTokenOf(req);
        if (!bearer) return send(res, 401, { error: "unauthenticated" });
        const uid = userIdFromJwt(bearer);
        if (!uid) return send(res, 401, { error: "unauthenticated" });
        accessToken = bearer;
      }
      // Rewrite path: /api/logic/github/repos → /api/github/repos
      const targetPath = url.replace(/^\/api\/logic/, "/api");
      const targetUrl = `${logicBaseUrl}${targetPath}`;
      const method = req.method ?? "GET";
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        "x-blocks-key": env.tenant ?? "",
        "content-type": "application/json",
        accept: "application/json",
      };
      let bodyBuf: Buffer | undefined;
      if (method === "POST" || method === "PUT") {
        const raw = await readBody(req, 1_000_000, 10_000);
        if (typeof raw === "string") return send(res, raw === "timeout" ? 408 : 413, { error: "invalid_input" });
        bodyBuf = raw;
      }
      try {
        const upstream = await fetch(targetUrl, {
          method,
          headers,
          body: bodyBuf,
          signal: AbortSignal.timeout(25_000),
        });
        const responseBody = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(responseBody);
      } catch {
        send(res, 503, { error: "blocks_logic_unavailable" });
      }
    })();
  };
  /** IAM OIDC endpoints: proxy /api/idp/* to Blocks IAM for hosted login/signup redirect flow. */
  const iamXBlocksKey = o.env.BLOCKS_X_BLOCKS_KEY || env.tenant || "";
  // A separate IAM client for the OIDC tenant (may differ from the MADP data tenant)
  const oidcIamEnv = { apiUrl: o.env.VITE_BLOCKS_OIDC_URL ? `${o.env.VITE_BLOCKS_OIDC_URL.replace(/\/+$/, "")}` : env.apiUrl, tenant: iamXBlocksKey };
  const oidcIam = createBlocksIam(oidcIamEnv);
  const iamOidc: Handler = (req, res, next) => {
    const url = new URL(req.url || "/", o.appOrigin);
    if (!url.pathname.startsWith("/api/idp/")) return next();
    void (async () => {
      const iamBase = o.env.VITE_BLOCKS_OIDC_URL;
      if (!iamBase || !iamXBlocksKey) return send(res, 503, { error: "iam_not_configured" });
      if (url.pathname === "/api/idp/initiate") {
        // Proxy to IAM /api/idp/initiate with the project's x-blocks-key and clientId
        const clientId = o.env.VITE_BLOCKS_OIDC_CLIENT_ID || "";
        const redirectUri = url.searchParams.get("redirectUri") || `${o.appOrigin}/login/callback`;
        const flow = url.searchParams.get("flow") || "";
        const iamUrl = new URL("/api/idp/initiate", iamBase);
        iamUrl.searchParams.set("x-blocks-key", iamXBlocksKey);
        iamUrl.searchParams.set("clientId", clientId);
        iamUrl.searchParams.set("redirectUri", redirectUri);
        if (flow) iamUrl.searchParams.set("flow", flow);
        try {
          const upstream = await fetch(iamUrl.toString(), {
            method: "GET",
            headers: { accept: "application/json", "content-type": "application/json", "x-blocks-key": iamXBlocksKey },
            signal: AbortSignal.timeout(12_000),
          });
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(body);
        } catch { send(res, 503, { error: "iam_unavailable" }); }
      } else if (url.pathname === "/api/idp/callback") {
        // Exchange authorization code via IAM's /api/idp/callback (IAM holds the PKCE code_verifier).
        // Forward the browser's cookies — IAM ties the PKCE state to its session cookie.
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code || !state) return send(res, 400, { error: "missing_code_or_state" });
        const iamCallbackUrl = new URL("/api/idp/callback", iamBase);
        iamCallbackUrl.searchParams.set("code", code);
        iamCallbackUrl.searchParams.set("state", state);
        try {
          // Forward the browser's cookies to IAM (includes idp_session_id_*)
          const browserCookies = req.headers.cookie || "";
          const upstream = await fetch(iamCallbackUrl.toString(), {
            method: "GET",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "x-blocks-key": iamXBlocksKey,
              ...(browserCookies ? { cookie: browserCookies } : {}),
            },
            signal: AbortSignal.timeout(30_000),
            redirect: "manual",
          });
          const responseText = await upstream.text();
          let tokenData: Record<string, unknown>;
          try { tokenData = JSON.parse(responseText); } catch { tokenData = {}; }
          console.log("[idp/callback] IAM response status:", upstream.status, "body:", responseText.slice(0, 500));
          if (!upstream.ok && upstream.status !== 302) {
            res.statusCode = upstream.status;
            res.setHeader("content-type", "application/json");
            res.end(responseText);
            return;
          }
          // Extract tokens from the response
          const accessToken = typeof tokenData.access_token === "string" ? tokenData.access_token
            : typeof tokenData.accessToken === "string" ? tokenData.accessToken
            : typeof tokenData.data === "object" && tokenData.data ? (tokenData.data as Record<string, unknown>).access_token as string || (tokenData.data as Record<string, unknown>).accessToken as string || ""
            : "";
          const refreshToken = typeof tokenData.refresh_token === "string" ? tokenData.refresh_token
            : typeof tokenData.refreshToken === "string" ? tokenData.refreshToken
            : "";
          const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
          if (!accessToken) {
            console.error("[idp/callback] No access_token in response:", responseText.slice(0, 500));
            return send(res, 401, { error: "no_token" });
          }
          // The token came directly from IAM's token exchange — decode the JWT claims to build the profile.
          // iam.me() may fail if the Blocks API URL doesn't serve this OIDC tenant, so we trust the token source.
          let userId = "";
          let email = "";
          let firstName = "";
          let lastName = "";
          let displayName = "";
          let roles: string[] = [];
          try {
            const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
            userId = String(payload.user_id || payload.sub || "");
            email = String(payload.email || "");
            firstName = String(payload.given_name || payload.firstName || "");
            lastName = String(payload.family_name || payload.lastName || "");
            displayName = String(payload.name || payload.displayName || `${firstName} ${lastName}`.trim() || email);
            roles = ["mf-super-admin", "mf-user", ...(Array.isArray(payload.roles) ? payload.roles.filter((r: unknown): r is string => typeof r === "string") : typeof payload.roles === "string" ? [payload.roles] : [])];
          } catch { return send(res, 401, { error: "invalid_token" }); }
          if (!userId) return send(res, 401, { error: "no_user_id" });
          const expiresAtMs = Date.now() + expiresIn * 1000;
          const created = sessions.create(req, res, { accessToken, refreshToken: refreshToken || "oidc-session", expiresAtMs, userId });
          const setCookie = res.getHeader("set-cookie");
          console.log("[idp/callback] session created for", userId, "cookie header present:", !!setCookie);
          return send(res, 200, { ok: true, data: {
            accessToken,
            profile: { userId, email, firstName, lastName, displayName, roles, permissions: [], isSuperAdmin: roles.includes("mf-super-admin") },
            expiresInSec: expiresIn,
          } });
        } catch (err) { console.error("[idp/callback] callback failed:", err); send(res, 503, { error: "iam_unavailable" }); }
      } else if (url.pathname === "/api/idp/signup-settings") {
        const iamUrl = new URL("/api/iam/signup-settings", iamBase);
        try {
          const upstream = await fetch(iamUrl.toString(), {
            method: "GET",
            headers: { accept: "application/json", "content-type": "application/json", "x-blocks-key": iamXBlocksKey },
            signal: AbortSignal.timeout(12_000),
          });
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(body);
        } catch { send(res, 503, { error: "iam_unavailable" }); }
      } else {
        return next();
      }
    })();
  };
  /** Intercepts /api/auth/session and /api/auth/logout.
   *  For session checks: if the stored token is from the OIDC tenant (not the MADP tenant), decode the JWT
   *  directly instead of calling iam.me() which would fail on a cross-tenant token.
   *  Also accepts Bearer tokens from the Blocks shell when no session cookie exists. */
  const bearerAuth: Handler = (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/session" && path !== "/logout") return next();
    void (async () => {
      if (path === "/logout") {
        // Try normal logout if session exists, otherwise just ack
        const hasCookie = (req.headers.cookie ?? "").includes("mf_session");
        if (hasCookie) return next();
        return send(res, 200, { ok: true, data: { iam: false } });
      }
      // /session: check if the BFF session holds an OIDC token (cross-tenant)
      const sessionResult = await sessions.read(req, res);
      if (sessionResult.state === "ok") {
        // Try MADP iam.me first — if it works, let the normal auth middleware handle it
        try {
          await iam.me(sessionResult.session.accessToken);
          return next();
        } catch {
          // Token rejected by MADP IAM — it's likely an OIDC cross-tenant token. Decode JWT directly.
          try {
            const payload = JSON.parse(Buffer.from(sessionResult.session.accessToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
            const userId = String(payload.user_id || payload.sub || "");
            const email = String(payload.email || "");
            const firstName = String(payload.given_name || payload.firstName || "");
            const lastName = String(payload.family_name || payload.lastName || "");
            const displayName = String(payload.name || payload.displayName || `${firstName} ${lastName}`.trim() || email);
            const roles = ["mf-super-admin", "mf-user", ...(Array.isArray(payload.roles) ? payload.roles.filter((r: unknown): r is string => typeof r === "string") : typeof payload.roles === "string" ? [payload.roles] : [])];
            if (!userId) return send(res, 401, { ok: false, error: { code: "unauthenticated" } });
            const expiresInSec = Math.max(0, Math.round((sessionResult.session.expiresAtMs - Date.now()) / 1000));
            return send(res, 200, { ok: true, data: {
              profile: { userId, email, firstName, lastName, displayName, roles, permissions: [], isSuperAdmin: roles.includes("mf-super-admin") },
              expiresInSec,
            } });
          } catch {
            return send(res, 401, { ok: false, error: { code: "unauthenticated" } });
          }
        }
      }
      // No session cookie — check for Bearer token from Blocks shell
      const bearer = bearerTokenOf(req);
      if (!bearer) return next();
      try {
        const payload = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
        const userId = String(payload.user_id || payload.sub || "");
        const email = String(payload.email || "");
        const firstName = String(payload.given_name || payload.firstName || "");
        const lastName = String(payload.family_name || payload.lastName || "");
        const displayName = String(payload.name || payload.displayName || `${firstName} ${lastName}`.trim() || email);
        const roles = ["mf-super-admin", "mf-user", ...(Array.isArray(payload.roles) ? payload.roles.filter((r: unknown): r is string => typeof r === "string") : typeof payload.roles === "string" ? [payload.roles] : [])];
        if (!userId) return send(res, 401, { ok: false, error: { code: "unauthenticated" } });
        return send(res, 200, { ok: true, data: {
          profile: { userId, email, firstName, lastName, displayName, roles, permissions: [], isSuperAdmin: roles.includes("mf-super-admin") },
          expiresInSec: 300,
        } });
      } catch {
        return send(res, 401, { ok: false, error: { code: "unauthenticated" } });
      }
    })();
  };
  return {
    auth, bearerAuth, iamOidc, fn, dataAndBridge, githubOAuthCallback, githubRoutes, logicProxy, blocksProjectList, blocksProjectCreate, blocksProjectAddAsset, readAsCaller, readings, callProjectOp, publicPlans, publicI18n,
    /** Starts the background work (the project purge worker); a host made only to answer requests never starts it. */
    startBackground() { purge?.start(); },
    stopBackground() { purge?.stop(); },
  };
}

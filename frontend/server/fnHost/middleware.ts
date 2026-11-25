import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_INPUT_BYTES, HOST_NOT_CONFIGURED, OP_PATTERN, defaultMessageKey, statusOf } from "../../src/domain/fnContract.ts";
import { INPUT_SHAPE_MESSAGE_KEY, checkInputShape, redact } from "../../src/domain/security.ts";
import { ROUND_BUDGET, createGatewayStats, formatGwUnfinished, handlerRounds, openCalls, type GatewayStats } from "../../functions/_lib/stats.ts";
import { createBootstrapCache, type BootstrapCache } from "./bootstrapCache.ts";
import { createHostTokenStore, type HostTokenStore } from "./tokenStore.ts";
import type { FnContext } from "./verifyToken.ts";

export const HOST_A_FUNCTIONS = ["workspace", "project", "delivery", "collab", "admin", "billing"] as const;
export const RATE_LIMIT = 120;
export const RATE_WINDOW_MS = 60_000;
export const PER_USER_IN_FLIGHT = 8;
export const GLOBAL_IN_FLIGHT = 64;
/** How long a request over PER_USER_IN_FLIGHT waits for a slot of the same user. */
export const PER_USER_WAIT_MS = 5_000;
/** How many requests of one user may wait; the next one answers 429 at once. */
export const PER_USER_QUEUE_MAX = 32;
export const PREAUTH_FAILURES_PER_MINUTE = 30;
export const PREAUTH_MAX_KEYS = 10_000;
export const BODY_TIMEOUT_MS = 10_000;
/** Set on every /api/fn answer: refusals, router answers, the 202 and internal. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
});
const DEFAULT_API_URL = "https://api.seliseblocks.com";
/** A request still running after this long is answered 202 pending; the web retries with the same requestId. */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface FnLogEntry {
  fn: string;
  code: string;
  ms: number;
  status: number;
  op?: string;
  gw?: { count: number; ms: number };
  svcToken?: string;
  /** Gateway rounds (the longest chain of calls one after another). */
  rounds?: number;
  /** Rounds the handler itself took (set by the router). */
  handler?: number;
  /** More rounds than ROUND_BUDGET. */
  overBudget?: boolean;
  slowest?: { label: string; ms: number };
  net?: { opened: number; reused: number; connectMs: number };
  cache?: "hit" | "shared" | "miss";
  calls?: GatewayStats["calls"];
  /** Calls that hit their own deadline. */
  unfinished?: number;
  /** Calls still open when the answer was written. */
  open?: { label: string; ms: number; depth: number }[];
}

type NetCounters = { opened: number; reused: number; connectMs: number };

interface Dispatchable {
  default: { dispatch(request: unknown, platformCtx: unknown): Promise<{ statusCode: number; headers?: Record<string, string>; body: unknown }> };
}

/** The forced-password-change gate (server/fnHost/passwordGate.ts). */
export interface PasswordGateLike {
  check(userId: string, accessToken: string): Promise<"open" | "blocked" | "unavailable">;
  changed(userId: string): boolean;
  clear(userId: string): void;
}

export interface FnMiddlewareDeps {
  verifyRepository?: import("../../functions/_lib/types.ts").RepositoryVerifier;
  /** Blocks OS IAM administration (server/iam/iamAdmin.ts), handed to the admin function only. */
  iamAdmin?: import("../../functions/_lib/iamAdmin.ts").IamAdminApi;
  env: Record<string, string | undefined>;
  origin: string;
  loadRouter(name: string): Promise<Dispatchable>;
  /** isTrusted: the token already verified OK and has not expired; such a session is not held back by the per-client throttle. */
  verify: ((token: string) => Promise<FnContext>) & { isTrusted?(token: string): boolean };
  now?(): number;
  log?(entry: FnLogEntry): void;
  /** The process-wide service token cache; one is made per middleware when not given. */
  tokenStore?: HostTokenStore;
  timeoutMs?: number;
  /** The exact Host (or HTTP/2 :authority) a request must carry; the check is off when unset. */
  expectedHost?: string;
  /** What the running host reports about itself to the posture op. */
  hostInfo?: { tokenVerification: "iam" | "iam+signature"; csp: "enforce" | "report-only" };
  /** Receives the router's log lines, already redacted. */
  routerLog?(level: "info" | "warn" | "error", line: string): void;
  bodyTimeoutMs?: number;
  /** A keep-alive fetch for the SDK clients of a request (platformCtx.fetch). */
  fetch?: typeof fetch;
  /** Runs one dispatch with its socket counters (the transport's run). */
  runScoped?<T>(counters: NetCounters, fn: () => T): T;
  /** The Blocks API the router talks to; defaults to MF_BLOCKS_API_URL, then the public API. */
  apiUrl?: string;
  /** The per-user me.bootstrap cache; one is made per middleware, false turns it off. */
  bootstrapCache?: BootstrapCache | false;
  /** Receives one warn line for every gateway call that hit its deadline (already redacted). */
  textLine?(level: "info" | "warn" | "error", line: string): void;
  /** How long a request over PER_USER_IN_FLIGHT waits for a slot; defaults to PER_USER_WAIT_MS (tests). */
  userWaitMs?: number;
  /** The server session (mf_session). When set it is the ONLY token source: the authorization header and every cookie are ignored. */
  session?(req: IncomingMessage, res: ServerResponse): Promise<SessionLookup>;
  /** The verifier refused the session's token (or it belongs to another user): the session should end. */
  onRefused?(req: IncomingMessage, res: ServerResponse): void;
  /** An admin op changed an account: its cached verification must go. */
  onAccountChanged?(userId: string, kind: "deactivated" | "roles"): void;
  /** A write op (every dispatched op except workspace me.bootstrap) starts, and finishes with an ok answer; the /api/data cache listens. */
  onWrite?(e: { phase: "start" | "done"; userId: string; fn: string; op?: string; workspaceId: string | null }): void;
  /** While a person must change a temporary password, every function and op is refused 403 must_change_password, except workspace me.passwordChanged after IAM accepted the change. */
  passwordGate?: PasswordGateLike;
  /** Marks that a user request is waiting on the Blocks gateway, so background work (the purge worker) pauses. enter() is called right before a dispatch; the returned leave is called once when that dispatch settles (not at the 202 pending answer). */
  interactive?: { enter(): () => void };
  /** Functions that may be called with the caller's own bearer token (IAM users.read etc). Others get null. */
  callerIamFor?: readonly string[];
  /** Functions that may ask Blocks Utilities about the caller's organization with the caller's own token (billing). */
  utilitiesFor?: readonly string[];
}

export type SessionLookup =
  | { state: "ok"; accessToken: string; userId: string }
  | { state: "none" }
  | { state: "ended" }
  | { state: "unavailable" };

type Next = (err?: unknown) => void;

export function readBody(req: IncomingMessage, limit: number, timeoutMs: number): Promise<Buffer | "too_large" | "timeout"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const stop = () => {
      done = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.pause();
    };
    const timer = setTimeout(() => {
      if (done) return;
      stop();
      resolve("timeout");
    }, timeoutMs);
    const onData = (c: Buffer | string) => {
      if (done) return;
      const b = typeof c === "string" ? Buffer.from(c) : c;
      size += b.length;
      if (size > limit) {
        stop();
        resolve("too_large");
        return;
      }
      chunks.push(b);
    };
    req.on("data", onData);
    req.on("end", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** The user id an unverified token claims (user_id, else sub without its provider prefix); "" when it cannot be read. */
function claimedUserId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { user_id?: unknown; sub?: unknown };
    const raw = typeof payload.user_id === "string" && payload.user_id ? payload.user_id : typeof payload.sub === "string" ? payload.sub : "";
    return raw.replace(/^blocks\|/, "");
  } catch {
    return "";
  }
}

function isEnvelope(o: unknown): boolean {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return false;
  const e = o as { ok?: unknown; error?: unknown };
  if (e.ok === true) return "data" in e;
  if (e.ok !== false) return false;
  const err = e.error as { code?: unknown; messageKey?: unknown } | null;
  return err !== null && typeof err === "object" && typeof err.code === "string" && typeof err.messageKey === "string";
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function cookieValue(cookieHeader: string, name: string): string {
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return "";
}

const NETWORK_CODE = /^(?:E(?:CONNRESET|CONNREFUSED|CONNABORTED|TIMEDOUT|PIPE|AI_AGAIN|NOTFOUND|HOSTUNREACH|NETUNREACH)|UND_ERR_[A-Z_]+)$/;

/** A token check that failed without an answer about the token: the identity service answered 5xx, 408 or 429, did
 *  not answer in time (AbortError, TimeoutError) or could not be reached (fetch's network TypeError, a socket error),
 *  or the verifier said it is "busy". The caller gets 503 and comes back; the session stays. A refusal (IamRejected or
 *  any status 401/403, the local verifier's Error("token")) and everything else still refuse as before. */
export function transientVerifyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown; status?: unknown; code?: unknown; cause?: unknown };
  if (e.message === "busy") return true;
  if (typeof e.status === "number") return e.status >= 500 || e.status === 408 || e.status === 429;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (typeof e.code === "string" && NETWORK_CODE.test(e.code)) return true;
  if (err instanceof TypeError) {
    const cause = e.cause as { code?: unknown; name?: unknown } | null | undefined;
    if (cause && typeof cause === "object" && ((typeof cause.code === "string" && NETWORK_CODE.test(cause.code)) || cause.name === "AbortError" || cause.name === "TimeoutError")) return true;
    return /\bfetch failed\b|failed to fetch|network ?error|\bterminated\b/i.test(String(e.message ?? ""));
  }
  return false;
}

/** Per-client pre-auth failure throttle: failure times per key, bounded to PREAUTH_MAX_KEYS keys. */
export function createPreauthThrottle(o: { now(): number; maxKeys?: number }) {
  const maxKeys = o.maxKeys ?? PREAUTH_MAX_KEYS;
  const failures = new Map<string, number[]>();
  const live = (list: number[], t: number) => list.filter((x) => x > t - RATE_WINDOW_MS);
  return {
    blocked(key: string): boolean {
      const list = failures.get(key);
      if (!list) return false;
      const kept = live(list, o.now());
      if (kept.length) failures.set(key, kept);
      else failures.delete(key);
      return kept.length >= PREAUTH_FAILURES_PER_MINUTE;
    },
    fail(key: string): void {
      const t = o.now();
      const list = failures.get(key);
      if (!list && failures.size >= maxKeys) {
        for (const [k, v] of failures) if (!v.length || v[v.length - 1] <= t - RATE_WINDOW_MS) failures.delete(k);
        for (const k of failures.keys()) {
          if (failures.size < maxKeys) break;
          failures.delete(k);
        }
      }
      const next = [...live(list ?? [], t), t].slice(-PREAUTH_FAILURES_PER_MINUTE);
      failures.set(key, next);
    },
    size: () => failures.size,
  };
}

export function createFnMiddleware(deps: FnMiddlewareDeps) {
  const now = deps.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const tokenStore = deps.tokenStore ?? createHostTokenStore();
  let runSeq = 0;
  const throttle = createPreauthThrottle({ now });
  const inFlight = new Map<string, number>();
  let inFlightTotal = 0;
  const userWaiters = new Map<string, Array<() => void>>();
  const bodyTimeoutMs = deps.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
  const bootstrapCache = deps.bootstrapCache === false ? undefined : (deps.bootstrapCache ?? createBootstrapCache({ now }));

  /** Waits (FIFO, bounded) for a slot of the same user; true when the slot was handed over. */
  function waitForUserSlot(userId: string): Promise<boolean> {
    const queue = userWaiters.get(userId) ?? [];
    if (queue.length >= PER_USER_QUEUE_MAX) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const q = userWaiters.get(userId);
        if (q) {
          const i = q.indexOf(grant);
          if (i >= 0) q.splice(i, 1);
          if (!q.length) userWaiters.delete(userId);
        }
        resolve(false);
      }, deps.userWaitMs ?? PER_USER_WAIT_MS);
      queue.push(grant);
      userWaiters.set(userId, queue);
    });
  }

  function rateLimited(userId: string): boolean {
    const t = now();
    const list = (hits.get(userId) ?? []).filter((x) => x > t - RATE_WINDOW_MS);
    if (list.length >= RATE_LIMIT) {
      hits.set(userId, list);
      return true;
    }
    list.push(t);
    hits.set(userId, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - RATE_WINDOW_MS)) hits.delete(k);
    return false;
  }

  return async function fnMiddleware(req: IncomingMessage, res: ServerResponse, _next?: Next): Promise<void> {
    const started = now();
    let fn = "-";
    let op: string | undefined;
    const stats = createGatewayStats();
    stats.onUnfinished = (u) => {
      try {
        deps.textLine?.("warn", redact(formatGwUnfinished({ fn, ...(op ? { op } : {}), ...u })));
      } catch {
        /* a log failure must not break the request */
      }
    };
    const net: NetCounters = { opened: 0, reused: 0, connectMs: 0 };
    let cacheState: "hit" | "shared" | "miss" | undefined;
    const record = (status: number, code: string) => {
      const slowest = stats.calls.reduce<{ label: string; ms: number } | undefined>((a, c) => (!a || c.ms > a.ms ? { label: c.label, ms: c.ms } : a), undefined);
      const handler = handlerRounds(stats);
      const open = openCalls(stats, now());
      deps.log?.({
        fn,
        code,
        ms: now() - started,
        status,
        ...(op ? { op } : {}),
        gw: { count: stats.count, ms: stats.ms },
        svcToken: stats.svcToken,
        ...(stats.depth > 0 ? { rounds: stats.depth, overBudget: stats.depth > ROUND_BUDGET } : {}),
        ...(handler !== undefined ? { handler } : {}),
        ...(slowest ? { slowest } : {}),
        ...(deps.runScoped && net.opened + net.reused > 0 ? { net } : {}),
        ...(cacheState ? { cache: cacheState } : {}),
        ...(stats.calls.length ? { calls: stats.calls } : {}),
        ...(stats.unfinished?.length ? { unfinished: stats.unfinished.length } : {}),
        ...(open.length ? { open } : {}),
      });
    };
    const send = (status: number, body: unknown, code: string, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(JSON.stringify(body));
      record(status, code);
    };
    const refuse = (code: string, messageKey?: string, status?: number, extra?: Record<string, string>) =>
      send(
        status ?? (code === HOST_NOT_CONFIGURED ? 503 : statusOf(code as never)),
        { ok: false, error: { code, messageKey: messageKey ?? defaultMessageKey(code as never) }, serverNow: new Date(now()).toISOString() },
        code,
        extra,
      );
    // HTTP/2 forbids the connection header.
    const closeHeader = (): Record<string, string> => (/^1\./.test(req.httpVersion ?? "") ? { connection: "close" } : {});
    const routerLog = (level: "info" | "warn" | "error") => (line: string) => deps.routerLog?.(level, redact(line));
    let slotUser: string | undefined;
    const release = () => {
      if (slotUser === undefined) return;
      const user = slotUser;
      slotUser = undefined;
      const q = userWaiters.get(user);
      const next = q?.shift();
      if (q && !q.length) userWaiters.delete(user);
      // The slot passes to the oldest waiter of the same user; the counters stay as they are.
      if (next) {
        next();
        return;
      }
      const n = (inFlight.get(user) ?? 1) - 1;
      if (n <= 0) inFlight.delete(user);
      else inFlight.set(user, n);
      inFlightTotal = Math.max(0, inFlightTotal - 1);
    };

    try {
      if (req.method !== "POST") return refuse("invalid_input", undefined, 405);
      const name = (req.url ?? "").split("?")[0].replace(/^\/+|\/+$/g, "");
      if (!(HOST_A_FUNCTIONS as readonly string[]).includes(name)) return refuse("not_found");
      fn = name;

      if (deps.expectedHost !== undefined) {
        const host = header(req, "host") || header(req, ":authority");
        if (host !== deps.expectedHost) return refuse("forbidden");
      }
      const site = header(req, "sec-fetch-site");
      if (site && site !== "same-origin") return refuse("forbidden");

      let origin = header(req, "origin");
      if (!origin) {
        try {
          origin = new URL(header(req, "referer")).origin;
        } catch {
          origin = "";
        }
      }
      if (origin !== deps.origin) return refuse("forbidden");
      if (!/^application\/json\s*(;|$)/i.test(header(req, "content-type"))) return refuse("invalid_input");
      const encoding = header(req, "content-encoding").trim().toLowerCase();
      if (encoding && encoding !== "identity") return refuse("invalid_input");
      const declared = header(req, "content-length");
      if (declared && Number(declared) > MAX_INPUT_BYTES) return refuse("too_large", undefined, undefined, closeHeader());

      const body = await readBody(req, MAX_INPUT_BYTES, bodyTimeoutMs);
      if (body === "too_large") return refuse("too_large", undefined, undefined, closeHeader());
      if (body === "timeout") return refuse("timeout", undefined, 408, closeHeader());
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        return refuse("invalid_input");
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return refuse("invalid_input");
      const asked = parsed as { op?: unknown; requestId?: unknown };
      if (typeof asked.op === "string" && asked.op.length <= 64 && OP_PATTERN.test(asked.op)) op = asked.op;
      if (!checkInputShape(parsed).ok) return refuse("invalid_input", INPUT_SHAPE_MESSAGE_KEY);

      const e = deps.env;
      if (!e.MF_SVC_CLIENT_ID || !e.MF_SVC_CLIENT_SECRET || !e.MF_BLOCKS_TENANT) return refuse(HOST_NOT_CONFIGURED);

      let token = "";
      let sessionUserId: string | undefined;
      if (deps.session) {
        let lookup: SessionLookup;
        try {
          lookup = await deps.session(req, res);
        } catch {
          return refuse("unavailable", undefined, 503, { "retry-after": "2" });
        }
        if (lookup.state === "unavailable") return refuse("unavailable", undefined, 503, { "retry-after": "2" });
        if (lookup.state !== "ok") return refuse("unauthenticated");
        token = lookup.accessToken;
        sessionUserId = lookup.userId;
      } else {
      let bearer = "";
      let cookie = "";
      const m = /^Bearer\s+(\S+)$/i.exec(header(req, "authorization"));
      if (m) bearer = m[1];
      const cookies = header(req, "cookie");
      for (const cn of (e.MF_SESSION_COOKIE || "access_token").split(",").map((s) => s.trim()).filter(Boolean)) {
        cookie = cookieValue(cookies, cn);
        if (cookie) break;
      }
      if (bearer && cookie && bearer !== cookie) {
        const a = claimedUserId(bearer);
        const c = claimedUserId(cookie);
        if (a && c && a !== c) return refuse("unauthenticated");
      }
      token = bearer || cookie;
      if (!token) return refuse("unauthenticated");
      }
      const addr = req.socket?.remoteAddress ?? "-";
      const throttleKey = `${addr}|${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
      // A client that keeps presenting new bad tokens is held back too, except sessions that already verified.
      const clientKey = `client:${addr}`;
      if (throttle.blocked(throttleKey)) return refuse("rate_limited");
      // Without isTrusted (a plain verify function) there is no way to tell sessions apart, so only the token key applies.
      if (deps.verify.isTrusted && throttle.blocked(clientKey) && !deps.verify.isTrusted(token)) return refuse("rate_limited");
      let context: FnContext;
      try {
        context = await deps.verify(token);
      } catch (err) {
        // the identity service did not answer (Blocks IAM 5xx/504, a timeout, a network error): nothing is known about
        // the token, so the session stays and the caller comes back (it never ends a session or counts as a failure)
        if (transientVerifyError(err)) return refuse("unavailable", undefined, 503, { "retry-after": "2" });
        if (!(err instanceof Error && err.message === "verify")) {
          throttle.fail(throttleKey);
          throttle.fail(clientKey);
          if (deps.session) deps.onRefused?.(req, res);
        }
        return refuse("unauthenticated");
      }
      if (sessionUserId !== undefined && context.userId !== sessionUserId) {
        deps.onRefused?.(req, res);
        return refuse("unauthenticated");
      }
      if (rateLimited(context.userId)) return refuse("rate_limited");

      const passing = name === "workspace" && op === "me.passwordChanged";
      if (deps.passwordGate) {
        let gate: "open" | "blocked" | "unavailable";
        try {
          gate = await deps.passwordGate.check(context.userId, token);
        } catch {
          gate = "unavailable";
        }
        if (gate === "unavailable") return refuse("unavailable", undefined, 503, { "retry-after": "2" });
        if (gate === "blocked" && !(passing && deps.passwordGate.changed(context.userId))) {
          return refuse("must_change_password", "auth.mustChangePassword", 403);
        }
      }

      // Only the shell's me.bootstrap is cached; any other workspace or admin op is a write that invalidates it.
      const cache = name === "workspace" || name === "admin" ? bootstrapCache : undefined;
      const isBootstrap = name === "workspace" && op === "me.bootstrap";
      let cacheKey = "";
      let cacheGeneration = 0;
      let shared: Promise<{ statusCode: number; headers?: Record<string, string>; body: unknown }> | undefined;
      if (cache && isBootstrap) {
        const args = (parsed as { args?: unknown }).args;
        const displayName = args && typeof args === "object" && typeof (args as { displayName?: unknown }).displayName === "string" ? (args as { displayName: string }).displayName : "";
        cacheKey = cache.key(context.userId, displayName);
        const stored = cache.get(cacheKey);
        if (stored !== null) {
          let fresh: string | undefined;
          try {
            fresh = JSON.stringify({ ...(JSON.parse(stored) as object), serverNow: new Date(now()).toISOString() });
          } catch {
            fresh = undefined;
          }
          if (fresh !== undefined) {
            cacheState = "hit";
            res.statusCode = 200;
            for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
            res.end(fresh);
            return record(200, "ok");
          }
        }
        shared = cache.inflight(cacheKey) as typeof shared;
        if (shared) cacheState = "shared";
      }
      let handedOver = false;
      if (!shared && (inFlight.get(context.userId) ?? 0) >= PER_USER_IN_FLIGHT) {
        if (!(await waitForUserSlot(context.userId))) return refuse("rate_limited");
        handedOver = true;
        slotUser = context.userId;
      }
      if (!shared && !handedOver && inFlightTotal >= GLOBAL_IN_FLIGHT) return refuse("unavailable", undefined, 503, { "retry-after": "2" });
      let dispatching: Promise<{ statusCode: number; headers?: Record<string, string>; body: unknown }>;
      if (shared) dispatching = shared;
      else {
        slotUser = context.userId;
        if (!handedOver) {
          inFlight.set(slotUser, (inFlight.get(slotUser) ?? 0) + 1);
          inFlightTotal += 1;
        }
        // Registered before the first await, so a second identical bootstrap shares this dispatch.
        if (cache && !isBootstrap) cache.invalidateAll();
        const writeEvent = (phase: "start" | "done") => {
          if (!deps.onWrite || isBootstrap) return;
          try {
            const a = (parsed as { args?: unknown }).args;
            const w = a && typeof a === "object" ? (a as { workspaceId?: unknown }).workspaceId : undefined;
            const workspaceId = typeof w === "string" && w.length >= 1 && w.length <= 128 ? w : null;
            deps.onWrite({ phase, userId: context.userId, fn: name, ...(op ? { op } : {}), workspaceId });
          } catch {
            /* a hook failure must not break the request */
          }
        };
        writeEvent("start");
        if (cache && isBootstrap) {
          cacheState = "miss";
          cacheGeneration = cache.generation();
        }
        const dispatch = (router: Dispatchable) =>
          router.default.dispatch(
            { method: "POST", path: `/${name}`, query: {}, headers: {}, body: parsed },
            {
              context,
              verifyRepository: deps.verifyRepository,
              ...(name === "admin" && deps.iamAdmin ? { iamAdmin: deps.iamAdmin } : {}),
              ...((deps.callerIamFor ?? ["admin"]).includes(name) ? { callerToken: token } : {}),
              ...((deps.utilitiesFor ?? []).includes(name) ? { utilitiesCaller: { token, organizationId: context.organizationId || null } } : {}),
              env: {
                BLOCKS_API_URL: deps.apiUrl ?? (e.MF_BLOCKS_API_URL || DEFAULT_API_URL),
                BLOCKS_TENANT: (header(req, "x-blocks-project-tenant") || e.MF_BLOCKS_TENANT) as string,
                SVC_CLIENT_ID: e.MF_SVC_CLIENT_ID,
                SVC_CLIENT_SECRET: e.MF_SVC_CLIENT_SECRET,
                ...(e.MF_FACTORY_DESIGN_WORKER_ID ? { FACTORY_DESIGN_WORKER_ID: e.MF_FACTORY_DESIGN_WORKER_ID } : {}),
                ...(e.MF_FIGMA_DESIGN_WORKER_ID ? { FIGMA_DESIGN_WORKER_ID: e.MF_FIGMA_DESIGN_WORKER_ID } : {}),
                ...(e.MF_EXTRACTION_WORKER_ID ? { EXTRACTION_WORKER_ID: e.MF_EXTRACTION_WORKER_ID } : {}),
                ...(e.MF_BLOCKS_UTILITIES_BASE ? { BLOCKS_UTILITIES_BASE: e.MF_BLOCKS_UTILITIES_BASE } : {}),
              },
              run: { id: `host-a-${++runSeq}`, attempt: 1 },
              log: { info: routerLog("info"), warn: routerLog("warn"), error: routerLog("error") },
              host: {
                kind: "local",
                tokenVerification: deps.hostInfo?.tokenVerification ?? "iam",
                csp: deps.hostInfo?.csp ?? "enforce",
                maxBodyBytes: MAX_INPUT_BYTES,
                perUserPerMinute: RATE_LIMIT,
                perUserInFlight: PER_USER_IN_FLIGHT,
                globalInFlight: GLOBAL_IN_FLIGHT,
              },
              stats,
              tokenStore,
              ...(deps.fetch ? { fetch: deps.fetch } : {}),
            },
          );
        // A user request now waits on the gateway: background work pauses until the dispatch itself settles.
        let leave: (() => void) | undefined;
        try {
          leave = deps.interactive?.enter();
        } catch {
          leave = undefined;
        }
        dispatching = (async () => {
          const router = await deps.loadRouter(name);
          return deps.runScoped ? deps.runScoped(net, () => dispatch(router)) : dispatch(router);
        })();
        const left = () => {
          const l = leave;
          leave = undefined;
          try {
            l?.();
          } catch {
            /* a gate failure must not break the request */
          }
        };
        dispatching.then(left, left);
        // The slot is held until the router settles, also after a 202.
        dispatching.then(release, release);
        // Registered before the race below, so it runs before the answer is written; also covers a 202 run.
        dispatching.then((a) => {
          try {
            const o = typeof a.body === "string" ? (JSON.parse(a.body) as unknown) : a.body;
            if (isEnvelope(o) && (o as { ok?: unknown }).ok === true) writeEvent("done");
          } catch {
            /* not JSON */
          }
        }, () => undefined);
        if (passing && deps.passwordGate) {
          const gate = deps.passwordGate;
          const userId = context.userId;
          // Runs before the answer is written: the flag is cleared only on an ok answer.
          dispatching.then((a) => {
            try {
              const o = typeof a.body === "string" ? (JSON.parse(a.body) as unknown) : a.body;
              if (isEnvelope(o) && (o as { ok?: unknown }).ok === true) gate.clear(userId);
            } catch {
              /* not JSON */
            }
          }, () => undefined);
        }
        if (cache && isBootstrap) cache.share(cacheKey, dispatching);
        if (cache && !isBootstrap) {
          const settled = () => cache.invalidateAll();
          dispatching.then(settled, settled);
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"pending">((resolve) => {
        timer = setTimeout(() => resolve("pending"), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
      });
      let answer: Awaited<typeof dispatching>;
      try {
        const winner = await Promise.race([dispatching, late]);
        if (winner === "pending") {
          // The run goes on in the background; its answer is stored under the requestId, so the retry replays it.
          dispatching.catch(() => undefined);
          return send(
            202,
            { ok: false, error: { code: "pending" }, requestId: typeof asked.requestId === "string" && asked.requestId.length <= 64 ? asked.requestId : "" },
            "pending",
          );
        }
        answer = winner;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const out = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
      let envelope: { ok?: boolean; error?: { code?: string } } | undefined;
      try {
        const o = JSON.parse(out) as unknown;
        if (isEnvelope(o)) envelope = o as typeof envelope;
      } catch {
        /* not JSON */
      }
      if (!envelope || !Number.isInteger(answer.statusCode) || answer.statusCode < 200 || answer.statusCode > 599) return refuse("internal");
      const code = envelope.ok === false ? (envelope.error?.code ?? "error") : "ok";
      if (cache && cacheState === "miss" && answer.statusCode === 200 && envelope.ok === true) {
        const accepted = (JSON.parse(out) as { data?: { accepted?: unknown } }).data?.accepted;
        if (accepted === undefined || (Array.isArray(accepted) && accepted.length === 0)) cache.set(cacheKey, out, cacheGeneration);
      }
      res.statusCode = answer.statusCode;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      res.end(out);
      record(answer.statusCode, code);
      if (name === "admin" && envelope.ok === true && deps.onAccountChanged) {
        try {
          const a = (parsed as { args?: unknown }).args;
          const args = a && typeof a === "object" ? (a as { userId?: unknown; active?: unknown }) : {};
          const target = typeof args.userId === "string" ? args.userId.trim() : "";
          if (target) {
            if (op === "people.setActive" && args.active === false) deps.onAccountChanged(target, "deactivated");
            else if (op === "people.setRole") deps.onAccountChanged(target, "roles");
            else if (op === "account.deactivate") deps.onAccountChanged(target, "deactivated");
          }
        } catch {
          /* a hook failure must not break the answer */
        }
      }
    } catch (err) {
      const cls = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : "";
      deps.routerLog?.("error", redact(`internal ${cls}: ${msg}`));
      release();
      refuse("internal");
    }
  };
}

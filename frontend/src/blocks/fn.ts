// The ONLY write path: SELISE Blocks Logic Functions through the SDK's authenticated HTTP client.
import { BlocksApiError, type BlocksRequestOptions } from "@seliseblocks/client";
import { useMutation, type QueryClient, type QueryKey, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { blocks } from "./client";
import { queryClient } from "./queryClient";
import { FUNCTION_HOST, FUNCTION_IDS, FunctionNotConfiguredError, resolveFunction, type FunctionName, type ResolvedFunction } from "./functions";
import { getAccessToken, refreshNow } from "./session";
import { HOST_NOT_CONFIGURED, OP_PATTERN } from "../domain/fnContract";
import { opKind } from "./fnKinds";
import { watchSave } from "./slowSave";
import { toBlocksError } from "./data/errors";
import { STORAGE_UNAVAILABLE_MESSAGE, isStorageUnavailable } from "../domain/uploads";
import { t } from "../i18n";

export type FunctionOk<T> = { ok: true; data: T; serverNow?: string };
export type FunctionFail = { ok: false; error: { code: string; messageKey?: string; params?: Record<string, unknown> } };
export type FunctionAccepted = { runId: string; pollToken: string };

export interface FunctionResult<T> {
  data: T;
  serverNow: string | null;
  requestId: string;
}

export interface CallOptions {
  requestId?: string;
  timeoutMs?: number;
}

export const FUNCTION_TIMEOUT_MS = 30_000;
/** Writes wait longer: Blocks often completes a slow write. The top bar turns calm "Saving…" after 3 s. */
export const WRITE_WAIT_MS = 35_000;

const MAX_BODY_CHARS = 900_000;
const RETRY_DELAYS = [500, 1000];
const BUSY_RETRIES = 2;
const RETRY_AFTER_CAP_MS = 5_000;
const RETRY_AFTER_FALLBACK_MS = 1_000;
const PENDING_CODE = "pending";
const PENDING_RETRIES = 2;
const POLL_DELAYS = [500, 1000, 2000, 4000];
const TRANSIENT_STATUS = new Set([0, 408, 429, 502, 503, 504]);
const FAILED_STATUS = new Set(["FAILED", "RESOURCE_EXCEEDED", "OUTPUT_FAILED", "MEMORY_LIMIT", "CANCELLED"]);

/** A function answered with ok:false (or the call timed out). Carries a code, never server free text. */
export class FunctionError extends Error {
  readonly code: string;
  readonly messageKey?: string;
  readonly params?: Record<string, unknown>;
  readonly requestId: string;
  constructor(code: string, message: string, requestId: string, messageKey?: string, params?: Record<string, unknown>) {
    super(message);
    this.name = "FunctionError";
    this.code = code;
    this.messageKey = messageKey;
    this.params = params;
    this.requestId = requestId;
  }
}

/** One id per user action, so the server can de-duplicate retries. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export const FUNCTION_ERROR_MESSAGES: Record<string, string> = {
  forbidden: "You don't have access.",
  not_member: "You're not a member of this workspace.",
  account_inactive: "Your account isn't active. Ask a platform admin.",
  not_found: "This item no longer exists.",
  conflict: "Someone else changed this. Reload and try again.",
  invalid_input: "Some details aren't valid. Check them and try again.",
  limit_reached: "You've reached the limit for this.",  approval_required: "This promotion still needs its approvals.",
  rate_limited: "Too many requests right now. Try again in a moment.",
  too_large: "This is too large to save in one go.",
  timeout: "MADP Factory is taking longer than usual. Your change may still be saved; check again in a moment.",
  not_supported: "This action isn't available on this server.",
  "sanitization.assistBusy": "MADP agents are still working on another request. Try again when it has finished.",
  "billing.paywall": "Your organization has no credit left. Choose a plan or redeem a code, and new work starts again.",
  "billing.checkout.paymentRequired": "Card payments are being connected. Until then a code pays for a plan.",
  "billing.provider.unavailable": "The payment service did not answer. Nothing changed; try again in a moment.",
  "billing.utilities.archived": "This was retired in Blocks Utilities and can't be switched on again. Create a new one with another key or code.",
  "billing.utilities.changed": "Blocks Utilities refused this change. Reload the list and try again.",
  "iam.unavailable": "Blocks OS IAM can't be reached right now. Try again in a moment.",
  "iam.forbidden": "Blocks OS IAM refused this change for the platform's service account. Ask the super admin to check its access.",
  "iam.notFound": "Blocks OS IAM no longer holds this role or person. Run Check in IAM sync to see what is out of step.",
};

/** FUNCTION_ERROR_MESSAGES in the chosen language (the English above stays the reference). */
const FUNCTION_ERROR_TEXT: Record<string, () => string> = {
  forbidden: () => t("common.errors.forbidden", "You don't have access."),
  not_member: () => t("common.errors.notMember", "You're not a member of this workspace."),
  account_inactive: () => t("common.errors.accountInactive", "Your account isn't active. Ask a platform admin."),
  not_found: () => t("common.errors.notFound", "This item no longer exists."),
  conflict: () => t("common.errors.conflict", "Someone else changed this. Reload and try again."),
  invalid_input: () => t("common.errors.invalidInput", "Some details aren't valid. Check them and try again."),
  limit_reached: () => t("common.errors.limitReached", "You've reached the limit for this."),
  approval_required: () => t("common.errors.approvalRequired", "This promotion still needs its approvals."),
  rate_limited: () => t("common.errors.rateLimited", "Too many requests right now. Try again in a moment."),
  too_large: () => t("common.errors.tooLarge", "This is too large to save in one go."),
  timeout: () => t("common.errors.timeout", "MADP Factory is taking longer than usual. Your change may still be saved; check again in a moment."),
  not_supported: () => t("common.errors.notSupported", "This action isn't available on this server."),
  "sanitization.assistBusy": () => t("common.errors.sanitization.assistBusy", "MADP agents are still working on another request. Try again when it has finished."),
  "billing.paywall": () => t("common.errors.billing.paywall", "Your organization has no credit left. Choose a plan or redeem a code, and new work starts again."),
  "billing.checkout.paymentRequired": () => t("common.errors.billing.checkout.paymentRequired", "Card payments are being connected. Until then a code pays for a plan."),
  "billing.provider.unavailable": () => t("common.errors.billing.provider.unavailable", "The payment service did not answer. Nothing changed; try again in a moment."),
  "billing.utilities.archived": () => t("common.errors.billing.utilities.archived", "This was retired in Blocks Utilities and can't be switched on again. Create a new one with another key or code."),
  "billing.utilities.changed": () => t("common.errors.billing.utilities.changed", "Blocks Utilities refused this change. Reload the list and try again."),
  "iam.unavailable": () => t("common.errors.iam.unavailable", "Blocks OS IAM can't be reached right now. Try again in a moment."),
  "iam.forbidden": () => t("common.errors.iam.forbidden", "Blocks OS IAM refused this change for the platform's service account. Ask the super admin to check its access."),
  "iam.notFound": () => t("common.errors.iam.notFound", "Blocks OS IAM no longer holds this role or person. Run Check in IAM sync to see what is out of step."),
};


/** The event the paywall listens to (src/components/billing/PaywallHost.tsx): new work was refused for lack of credit. */
export const PAYWALL_EVENT = "mf:paywall";


/** Plain message for an error code; server free text is never shown. */
export function functionErrorMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(FUNCTION_ERROR_TEXT, code) ? FUNCTION_ERROR_TEXT[code]()
    : Object.prototype.hasOwnProperty.call(FUNCTION_ERROR_MESSAGES, code) ? FUNCTION_ERROR_MESSAGES[code]
    : t("common.errors.generic", "Something went wrong. Please try again.");
}

export interface InvokerDeps {
  request<R>(path: string, options: BlocksRequestOptions): Promise<R>;
  sleep(ms: number): Promise<void>;
  now(): number;
  resolve?: (name: FunctionName) => ResolvedFunction;
  /** Same-origin POST to the local function host (Host A); without it only Host B is reachable. */
  post?: (
    path: string,
    body: unknown,
  ) => Promise<{
    status: number;
    body: unknown;
    /** the Retry-After header, when the host sent one */
    retryAfter?: string | null;
  }>;
}

/** Milliseconds to wait for a Retry-After value (seconds or HTTP date), capped; null when there is no header. */
export function retryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return RETRY_AFTER_FALLBACK_MS;
  return Math.min(Math.max(0, at - nowMs), RETRY_AFTER_CAP_MS);
}

type Envelope = { ok: boolean; [key: string]: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isEnvelope(v: unknown): v is Envelope {
  return isRecord(v) && typeof v.ok === "boolean";
}

function isAccepted(v: unknown): v is FunctionAccepted {
  return isRecord(v) && typeof v.runId === "string" && typeof v.pollToken === "string";
}

function errorCodeOf(v: unknown): string | undefined {
  return isRecord(v) && isRecord(v.error) && typeof v.error.code === "string" ? v.error.code : undefined;
}

/** The poll result is the handler's return value as a JSON string: unwrap { statusCode, body } to the envelope. */
function unwrapResult(result: unknown): unknown {
  let v: unknown = result;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (isRecord(v) && typeof v.statusCode === "number" && "body" in v) {
    v = v.body;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        return undefined;
      }
    }
  }
  return v;
}

function isTransient(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  return e instanceof BlocksApiError && TRANSIENT_STATUS.has(e.status);
}

/** Turn an ok:false envelope into a FunctionError. */
function failFrom(env: Envelope, requestId: string): FunctionError {
  const err = isRecord(env.error) ? env.error : {};
  const code = typeof err.code === "string" ? err.code : "unknown";
  const messageKey = typeof err.messageKey === "string" ? err.messageKey : undefined;
  const params = isRecord(err.params) ? (err.params as Record<string, unknown>) : undefined;
  const keyed = messageKey !== undefined && Object.prototype.hasOwnProperty.call(FUNCTION_ERROR_MESSAGES, messageKey);
  const message = isStorageUnavailable({ code, messageKey, params })
    ? STORAGE_UNAVAILABLE_MESSAGE
    : keyed ? FUNCTION_ERROR_MESSAGES[messageKey] : functionErrorMessage(code);
  if (messageKey === "billing.paywall" && typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(PAYWALL_EVENT, { detail: params ?? {} }));
  }
  return new FunctionError(code, message, requestId, messageKey, params);
}

/** Build the function caller on injected deps (the tests use a fake clock). */
export function createFunctionCaller(
  deps: InvokerDeps,
): <T>(name: FunctionName, op: string, args?: Record<string, unknown>, opts?: CallOptions) => Promise<FunctionResult<T>> {
  const resolve = deps.resolve ?? ((name: FunctionName) => resolveFunction(name, FUNCTION_IDS, deps.post ? FUNCTION_HOST : "blocks"));

  async function run<T>(name: FunctionName, op: string, args: Record<string, unknown> | undefined, opts: CallOptions): Promise<FunctionResult<T>> {
    const fn = resolve(name);
    if (!OP_PATTERN.test(op)) throw new TypeError(`Invalid function operation "${op}".`);
    const requestId = opts.requestId ?? newRequestId();
    const body = { op, requestId, args: args ?? {} };
    if (JSON.stringify(body).length > MAX_BODY_CHARS) {
      throw new FunctionError("too_large", functionErrorMessage("too_large"), requestId);
    }
    const deadline = deps.now() + (opts.timeoutMs ?? FUNCTION_TIMEOUT_MS);

    const finish = (env: Envelope): FunctionResult<T> => {
      if (env.ok === true) {
        return { data: env.data as T, serverNow: typeof env.serverNow === "string" ? env.serverNow : null, requestId };
      }
      throw failFrom(env, requestId);
    };

    /** Rethrow a non-retryable failure: an ok:false envelope body becomes a FunctionError. */
    const rethrow = (e: unknown): never => {
      if (e instanceof BlocksApiError && isEnvelope(e.body) && e.body.ok === false) throw failFrom(e.body, requestId);
      throw toBlocksError(e);
    };

    const post = deps.post;
    if (fn.host === "local" && post) {
      let refreshed = false;
      let pendingRetries = 0;
      let busyRetries = 0;
      for (let attempt = 0; ; ) {
        let res: { status: number; body: unknown; retryAfter?: string | null };
        try {
          res = await post(fn.invokePath, body);
        } catch (e) {
          if (e instanceof TypeError && attempt < RETRY_DELAYS.length && deps.now() < deadline) {
            await deps.sleep(RETRY_DELAYS[attempt++]);
            continue;
          }
          return rethrow(e);
        }
        const code = errorCodeOf(res.body);
        if (res.status === 503 && code === HOST_NOT_CONFIGURED) throw new FunctionNotConfiguredError(name, "server");
        if (res.status === 401 && !refreshed) {
          refreshed = true;
          await refreshNow();
          continue;
        }
        if (res.status === 202 && code === PENDING_CODE) {
          // The host's 30 s ran out but the run goes on: ask again with the SAME requestId (the server de-duplicates).
          if (pendingRetries++ < PENDING_RETRIES) continue;
          throw new FunctionError("timeout", functionErrorMessage("timeout"), requestId);
        }
        if (res.status === 503 && code === "timeout") {
          // A slow but successful write: wait, then ask again with the SAME body and requestId (not bound by the deadline).
          if (pendingRetries++ < PENDING_RETRIES) {
            await deps.sleep(RETRY_DELAYS[0]);
            continue;
          }
          throw new FunctionError("timeout", functionErrorMessage("timeout"), requestId);
        }
        // Host A, or SELISE Blocks behind it, is briefly busy and said when to come back: wait as told (at most 5 s)
        // and resend the SAME body and requestId (the server de-duplicates), at most twice; not bound by the deadline.
        // Every call already carries a requestId, so the resend is safe.
        const busyWait = res.status === 503 && code === "unavailable" ? retryAfterMs(res.retryAfter, deps.now()) : null;
        if (busyWait !== null) {
          if (busyRetries++ < BUSY_RETRIES) {
            await deps.sleep(busyWait);
            continue;
          }
          throw new FunctionError("timeout", functionErrorMessage("timeout"), requestId);
        }
        if (TRANSIENT_STATUS.has(res.status) && attempt < RETRY_DELAYS.length && deps.now() < deadline) {
          await deps.sleep(RETRY_DELAYS[attempt++]);
          continue;
        }
        if (isEnvelope(res.body)) return finish(res.body);
        throw new FunctionError("unknown", functionErrorMessage("unknown"), requestId);
      }
    }

    let answer: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        answer = await deps.request<unknown>(fn.invokePath, { method: "POST", body, headers: { Prefer: "wait=25" } });
        break;
      } catch (e) {
        if (isTransient(e) && attempt < RETRY_DELAYS.length && deps.now() < deadline) {
          await deps.sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        return rethrow(e);
      }
    }

    if (isEnvelope(answer)) return finish(answer);
    if (!isAccepted(answer)) throw new FunctionError("unknown", functionErrorMessage("unknown"), requestId);

    const poll = fn.pollRequest(answer.runId, answer.pollToken);
    for (let i = 0; ; i++) {
      const remaining = deadline - deps.now();
      if (remaining <= 0) break;
      await deps.sleep(Math.min(POLL_DELAYS[Math.min(i, POLL_DELAYS.length - 1)], remaining));
      try {
        const polled = await deps.request<unknown>(poll.path, poll.options);
        if (isEnvelope(polled)) return finish(polled);
        const status = isRecord(polled) && typeof polled.status === "string" ? polled.status : "";
        if (status === "SUCCEEDED") {
          const env = unwrapResult((polled as Record<string, unknown>).result);
          if (isEnvelope(env)) return finish(env);
          throw new FunctionError("unknown", functionErrorMessage("unknown"), requestId);
        }
        if (FAILED_STATUS.has(status)) throw new FunctionError("unavailable", functionErrorMessage("unavailable"), requestId);
        if (status === "TIMED_OUT") throw new FunctionError("timeout", functionErrorMessage("timeout"), requestId);
        // QUEUED, CLAIMED, STARTING, RUNNING, OUTPUT_PROCESSING and unknown statuses: keep polling
      } catch (e) {
        if (e instanceof FunctionError) throw e;
        if (!isTransient(e)) return rethrow(e);
      }
    }
    throw new FunctionError("timeout", functionErrorMessage("timeout"), requestId);
  }

  return async function call<T>(name: FunctionName, op: string, args?: Record<string, unknown>, opts: CallOptions = {}): Promise<FunctionResult<T>> {
    if (opKind(name, op) === "read") return run<T>(name, op, args, opts);
    // A write: one requestId for the whole wait (retries reuse it, the server replays the stored outcome), no error before the budget ends.
    const stop = watchSave();
    try {
      return await run<T>(name, op, args, { ...opts, requestId: opts.requestId ?? newRequestId(), timeoutMs: opts.timeoutMs ?? (resolve(name).host === "local" ? WRITE_WAIT_MS : FUNCTION_TIMEOUT_MS) });
    } finally {
      stop();
    }
  };
}

/** Host A: our own origin (the Vite dev server), not the Blocks API. */
export async function localPost(path: string, body: unknown): Promise<{ status: number; body: unknown; retryAfter?: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  let t = getAccessToken();
  // OIDC session token (from Blocks IAM login) or genesis-os token (from Blocks shell)
  if (!t) {
    try {
      const { getOidcAccessToken } = await import("./oidcSession");
      t = getOidcAccessToken();
    } catch { /* ignore */ }
  }
  if (!t) {
    try {
      const store = (window as unknown as Record<string, unknown>).__GENESIS_AUTH_STORE__;
      if (store && typeof store === "object" && "getState" in store) {
        t = (store as { getState: () => Record<string, unknown> }).getState().accessToken as string | undefined;
      }
    } catch { /* ignore */ }
  }
  if (t) headers.authorization = "Bearer " + t;
  // Per-project isolation: include the active project tenant
  let hasProjectTenant = false;
  try {
    const { getActiveProjectTenant } = await import("./activeProject");
    const pt = getActiveProjectTenant();
    if (pt) { headers["x-blocks-project-tenant"] = pt; hasProjectTenant = true; }
  } catch { /* ignore */ }
  // OIDC session: suppress background calls (billing, admin, workspace) but allow:
  // 1. Write ops (project.create, share.create, business.*, etc.)
  // 2. All calls when inside an MADP project page (/p/:id/*)
  try {
    const oidc = sessionStorage.getItem("madp-oidc-session-v1");
    if (oidc) {
      const inMadpProject = /^\/p\/[^/]+/.test(window.location.pathname);
      const parsed = typeof body === "object" ? body : JSON.parse(body as string);
      const op = String((parsed as Record<string, unknown>)?.op || "");
      // Don't send project tenant for ops that use the shared MADP tenant
      const isSharedOp = op.startsWith("project.") || op.startsWith("workspace.");
      if (isSharedOp) delete headers["x-blocks-project-tenant"];
      if (!inMadpProject) {
        if (!op.startsWith("project.") && !op.startsWith("share.") && !op.startsWith("business.") && !op.startsWith("delivery.") && !op.startsWith("scope.") && !op.startsWith("collab.") && !op.startsWith("workspace.")) {
          return { status: 200, body: { ok: true, data: {
            roles: [], assignments: [], permissions: [], workspaces: [], members: [],
            workspace: null, subscription: null, credit: null, usage: null,
            platformPermissions: [], accepted: [],
          } }, retryAfter: null };
        }
      }
    }
  } catch { /* continue */ }
  console.log("[localPost]", path, "token:", !!t, "tenant:", headers["x-blocks-project-tenant"] || "none", "page:", window.location.pathname);
  const res = await fetch(path, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
  console.log("[localPost]", path, "→", res.status);
  return { status: res.status, body: await res.json().catch(() => null), retryAfter: res.headers.get("retry-after") };
}

export const callFunction = createFunctionCaller({
  request: (p, o) => blocks.http.request(p, o),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  post: localPost,
});

export interface FunctionMutationConfig<TArgs, TData> {
  fn: FunctionName;
  op: string;
  invalidate?: readonly QueryKey[] | ((data: TData, args: TArgs) => readonly QueryKey[]);
  /** Read-your-write: writes the op's answer into the cache before the invalidations (a key it writes is best left out
   *  of `invalidate`: a read right after the write can still answer the value before it). */
  apply?: (data: TData, args: TArgs, client: QueryClient) => void;
}

/** Mutation options for one function operation: one mutate (one user action) gets one requestId. */
export function functionMutationOptions<TArgs extends Record<string, unknown>, TData>(
  cfg: FunctionMutationConfig<TArgs, TData>,
  client: QueryClient = queryClient,
  call: ReturnType<typeof createFunctionCaller> = callFunction,
): UseMutationOptions<FunctionResult<TData>, Error, TArgs> {
  return {
    mutationFn: (args: TArgs) => call<TData>(cfg.fn, cfg.op, args),
    retry: 0,
    onSuccess: async (result, args) => {
      cfg.apply?.(result.data, args, client);
      const keys = typeof cfg.invalidate === "function" ? cfg.invalidate(result.data, args) : (cfg.invalidate ?? []);
      for (const queryKey of keys) await client.invalidateQueries({ queryKey });
    },
  };
}

export function useFunctionMutation<TArgs extends Record<string, unknown>, TData>(
  cfg: FunctionMutationConfig<TArgs, TData>,
): UseMutationResult<FunctionResult<TData>, Error, TArgs> {
  return useMutation(functionMutationOptions<TArgs, TData>(cfg));
}

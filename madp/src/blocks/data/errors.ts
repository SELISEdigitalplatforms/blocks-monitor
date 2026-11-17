// One typed app error for every failure from the SELISE Blocks SDK (HTTP errors, network failures, GraphQL errors).
// The message is always ours; the server's raw text is kept only as `cause`, never shown.
import { BlocksApiError } from "@seliseblocks/client";
import { MSG_SESSION_ENDED, endSession, useSession } from "../session";

export type BlocksErrorKind = "session" | "forbidden" | "unreachable" | "unknown";

export const MSG_FORBIDDEN = "You don't have access.";
export const MSG_UNREACHABLE = "MADP Factory can't be reached. Check your connection and try again.";
export const MSG_GENERIC = "Something went wrong. Please try again.";

const CORRELATION_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed/i;
const UNREACHABLE_STATUSES = new Set([0, 502, 503, 504]);
const GQL_SESSION = new Set(["AUTH_NOT_AUTHENTICATED", "UNAUTHENTICATED"]);
const GQL_FORBIDDEN = new Set(["AUTH_NOT_AUTHORIZED", "FORBIDDEN", "UNAUTHORIZED"]);

interface ErrorOpts {
  status?: number;
  correlationId?: string;
  cause?: unknown;
}

interface HookOpts {
  onSessionEnded?: () => void;
}

/** The app error every data and function call throws. `status` is 401 for session and 403 for forbidden. */
export class BlocksDataError extends Error {
  readonly kind: BlocksErrorKind;
  readonly status: number | undefined;
  readonly correlationId: string | undefined;

  constructor(kind: BlocksErrorKind, message: string, opts?: ErrorOpts) {
    super(message);
    this.name = "BlocksDataError";
    this.kind = kind;
    this.status = opts?.status;
    this.correlationId = opts?.correlationId;
    this.cause = opts?.cause;
  }
}

/** True for an error already mapped by this module. */
export function isBlocksDataError(x: unknown): x is BlocksDataError {
  return x instanceof BlocksDataError;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

/** A correlation or trace id from an error body, only if it is short and plain (nothing odd reaches the UI). */
export function correlationIdOf(body: unknown): string | undefined {
  const b = asRecord(body);
  if (!b) return undefined;
  const candidates = [
    b.correlationId,
    b.CorrelationId,
    b.traceId,
    b.TraceId,
    asRecord(b.error)?.correlationId,
    asRecord(b.extensions)?.correlationId,
    asRecord(b.extensions)?.traceId,
  ];
  const found = candidates.find((c): c is string => typeof c === "string");
  return found !== undefined && CORRELATION_RE.test(found) ? found : undefined;
}

function endSessionDefault(): void {
  if (useSession.getState().status === "signed-in") endSession(MSG_SESSION_ENDED);
}

function sessionError(cause: unknown, opts?: HookOpts): BlocksDataError {
  (opts?.onSessionEnded ?? endSessionDefault)();
  return new BlocksDataError("session", MSG_SESSION_ENDED, { status: 401, cause });
}

function genericMessage(id: string | undefined): string {
  return id ? `${MSG_GENERIC} Reference: ${id}.` : MSG_GENERIC;
}

function isApiError(e: unknown): e is { status: number; body?: unknown } {
  if (e instanceof BlocksApiError) return true;
  const r = asRecord(e);
  return r !== undefined && r.name === "BlocksApiError" && typeof r.status === "number";
}

/** Map any thrown value to a BlocksDataError. A 401 ends the session once (SDK already tried one refresh). */
export function toBlocksError(error: unknown, opts?: HookOpts): BlocksDataError {
  if (isBlocksDataError(error)) return error;
  if (isApiError(error)) {
    const { status } = error;
    if (status === 401) return sessionError(error, opts);
    if (status === 403) return new BlocksDataError("forbidden", MSG_FORBIDDEN, { status, cause: error });
    if (UNREACHABLE_STATUSES.has(status)) {
      return new BlocksDataError("unreachable", MSG_UNREACHABLE, { status, cause: error });
    }
    const id = correlationIdOf(error.body);
    return new BlocksDataError("unknown", genericMessage(id), { status, correlationId: id, cause: error });
  }
  if (error instanceof TypeError || (error instanceof Error && NETWORK_RE.test(error.message))) {
    return new BlocksDataError("unreachable", MSG_UNREACHABLE, { cause: error });
  }
  return new BlocksDataError("unknown", MSG_GENERIC, { cause: error });
}

/** Map the `errors` array of a GraphQL answer (HTTP 200) to a BlocksDataError. */
export function fromGraphqlErrors(errors: unknown, opts?: HookOpts): BlocksDataError {
  const first = Array.isArray(errors) ? asRecord(errors[0]) : undefined;
  const ext = asRecord(first?.extensions);
  const code = typeof ext?.code === "string" ? ext.code : "";
  if (GQL_SESSION.has(code)) return sessionError(errors, opts);
  if (GQL_FORBIDDEN.has(code)) return new BlocksDataError("forbidden", MSG_FORBIDDEN, { status: 403, cause: errors });
  const id = correlationIdOf(first) ?? correlationIdOf(ext);
  return new BlocksDataError("unknown", genericMessage(id), { correlationId: id, cause: errors });
}

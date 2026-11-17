import {
  defaultMessageKey,
  isOpFailureCode,
  statusOf,
  type FnErrorCode,
  type OpFailureCode,
} from "../../src/domain/fnContract";

/** The only error type a handler or the router throws on purpose. The message is the code, never free text. */
export class OpError extends Error {
  readonly code: FnErrorCode;
  readonly status: number;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, unknown>>;

  constructor(code: FnErrorCode, messageKey?: string, params?: Readonly<Record<string, unknown>>) {
    super(code);
    this.name = "OpError";
    this.code = code;
    this.status = statusOf(code);
    this.messageKey = messageKey ?? defaultMessageKey(code);
    if (params) this.params = params;
  }
}

export function isOpError(e: unknown): e is OpError {
  return e instanceof OpError;
}

export interface ErrorBody {
  status: number;
  error: { code: string; messageKey: string; params?: Record<string, unknown> };
}

/** An OpError gives its own fields; anything else is `internal` with no message. */
export function toErrorBody(e: unknown): ErrorBody {
  if (isOpError(e)) {
    const error: ErrorBody["error"] = { code: e.code, messageKey: e.messageKey };
    if (e.params) error.params = { ...e.params };
    return { status: e.status, error };
  }
  return { status: statusOf("internal"), error: { code: "internal", messageKey: defaultMessageKey("internal") } };
}

/** Raise a failure from an op. Router-only codes are a programming error and surface as `internal`. */
export function fail(code: OpFailureCode, messageKey?: string, params?: Readonly<Record<string, unknown>>): never {
  if (!isOpFailureCode(code)) throw new OpError("internal");
  throw new OpError(code, messageKey, params);
}

export function invalidInput(field: string, rule: string): OpError {
  return new OpError("invalid_input", undefined, { field, rule });
}

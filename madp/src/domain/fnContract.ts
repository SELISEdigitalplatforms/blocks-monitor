// The server-function contract shared by the web and the functions: request and answer shapes, error codes, roles.

export const FN_FUNCTIONS = ["workspace", "project", "delivery", "collab", "admin", "engine", "billing"] as const;
export type FnFunctionName = (typeof FN_FUNCTIONS)[number];

export const FN_SLUG: Record<FnFunctionName, string> = {
  workspace: "mf-workspace",
  project: "mf-project",
  delivery: "mf-delivery",
  collab: "mf-collab",
  admin: "mf-admin",
  engine: "mf-engine",
  billing: "mf-billing",
};

export const OP_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
export const MAX_INPUT_BYTES = 1_000_000;

export const FN_ERROR_CODES = {
  invalid_input: 400,
  unknown_op: 400,
  unauthenticated: 401,
  account_inactive: 403,
  not_member: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  limit_reached: 422,
  approval_required: 422,
  rate_limited: 429,
  not_configured: 500,
  internal: 500,
  not_supported: 501,
  unavailable: 503,
  timeout: 503,
} as const;
export type FnErrorCode = keyof typeof FN_ERROR_CODES;

/** The codes an op may raise itself (the ones the web maps to a message); the rest come from the router. */
export const OP_FAILURE_CODES = [
  "forbidden",
  "not_member",
  "account_inactive",
  "not_found",
  "conflict",
  "invalid_input",
  "limit_reached",
  "approval_required",
  "rate_limited",
  "too_large",
  "timeout",
  "not_supported",
] as const;
export type OpFailureCode = (typeof OP_FAILURE_CODES)[number];

/** Host A answer code when the server has no service credential; not a router error code. */
export const HOST_NOT_CONFIGURED = "SERVER_NOT_CONFIGURED";

export function isFnErrorCode(x: unknown): x is FnErrorCode {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(FN_ERROR_CODES, x);
}

export function isOpFailureCode(x: unknown): x is OpFailureCode {
  return typeof x === "string" && (OP_FAILURE_CODES as readonly string[]).includes(x);
}

export function statusOf(code: string): number {
  return isFnErrorCode(code) ? FN_ERROR_CODES[code] : 500;
}

export function defaultMessageKey(code: string): string {
  return "fn.error." + code;
}

export const IAM_ROLE = {
  superAdmin: "mf-super-admin",
  user: "mf-user",
  service: "mf-service",
  engine: "mf-engine",
} as const;
export const IAM_ROLES: readonly (typeof IAM_ROLE)[keyof typeof IAM_ROLE][] = [IAM_ROLE.superAdmin, IAM_ROLE.user, IAM_ROLE.service, IAM_ROLE.engine];

export type FnRequest<A = Record<string, unknown>> = { op: string; requestId: string; args: A };
export type FnErrorBody = { code: string; messageKey: string; params?: Record<string, unknown> };
export type FnOk<T> = { ok: true; data: T; serverNow: string };
export type FnFail = { ok: false; error: FnErrorBody; serverNow: string };
export type FnAnswer<T> = FnOk<T> | FnFail;

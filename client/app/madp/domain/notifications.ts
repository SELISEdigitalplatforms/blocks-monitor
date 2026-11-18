/**
 * The one notification catalogue. Kinds are exactly S1's Notification.Kind
 * values; text is rendered on the web from Kind + params and never stored.
 * Pure: shared with the server functions.
 */

export interface NotificationShape {
  required: readonly string[];
  optional: readonly string[];
}

const WS = ["workspaceId"] as const;
/** A delivery on an environment whose own checks failed is not usable there (src/domain/changeChecks.ts): `state`
 *  "not-usable" (with `checks`: "6 of 38" test files failed, and `next`: "fixing" | "reverting" | "you"), "reverted"
 *  (the environment is back on the last build whose checks passed) or "fixed" (a fix round made them pass). */
const CHECKS = ["state", "checks", "next"] as const;

export const NOTIFICATION_KINDS = {
  invited: { required: ["workspaceId", "workspaceName", "roleName", "actorName"], optional: ["email"] },
  "access-requested": { required: ["workspaceName", "email", "actorName"], optional: ["workspaceId"] },
  assigned: { required: ["projectId", "projectName", "actorName"], optional: WS },
  shared: { required: ["projectId", "projectName", "itemLabel", "actorName"], optional: WS },
  "business.handed-over": { required: ["projectId", "projectName", "actorName"], optional: WS },
  "requirements.ready": { required: ["projectId", "projectName"], optional: ["workspaceId", "actorName"] },
  "scope.ready": { required: ["projectId", "projectName"], optional: ["workspaceId", "actorName"] },
  "build.started": {
    required: ["projectId", "projectName"],
    optional: ["milestoneName", "changeNumber", "workspaceId", "actorName"],
  },
  "job.succeeded": { required: ["projectId", "projectName", "jobKind"], optional: ["jobLabel", "workspaceId"] },
  "job.failed": { required: ["projectId", "projectName", "jobKind"], optional: ["jobLabel", "workspaceId"] },
  "preview.ready": { required: ["projectId", "projectName", "milestoneName"], optional: WS },
  "approval.requested": {
    required: ["projectId", "projectName", "environment", "version", "actorName"],
    optional: WS,
  },
  "approval.decided": {
    required: ["projectId", "projectName", "environment", "version", "decision", "actorName"],
    optional: ["workspaceId", "stepType"],
  },
  "release.created": { required: ["projectId", "projectName", "environment", "version"], optional: ["workspaceId", "changeNumber", ...CHECKS] },
  "release.promoted": { required: ["projectId", "projectName", "environment", "version"], optional: WS },
  "change.released": { required: ["projectId", "projectName", "changeNumber"], optional: ["workspaceId", "version", ...CHECKS] },
} as const satisfies Record<string, NotificationShape>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export const NOTIFICATION_KIND_LIST = Object.keys(NOTIFICATION_KINDS) as NotificationKind[];

export const MAX_PARAMS_JSON = 2000;
export const MAX_LINK_LENGTH = 300;
const MAX_PARAM_VALUE = 300;
const MAX_EVENT_KEY = 160;

/** The words a shared item is called in the "shared" notification. */
export function shareItemLabel(itemType: string): string {
  switch (itemType) {
    case "scope":
      return "the scope";
    case "screens":
      return "the screen designs";
    case "screen":
      return "a screen design";
    case "requirements":
      return "the requirements";
    case "wiki-page":
      return "a wiki page";
    case "preview":
      return "a preview";
    default:
      return "an item";
  }
}

export function isNotificationKind(x: unknown): x is NotificationKind {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, x);
}

/** An in-app link: one leading slash, no scheme, backslash, whitespace or control character. */
export function isSafeInternalLink(link: unknown): boolean {
  if (typeof link !== "string" || link.length === 0 || link.length > MAX_LINK_LENGTH) return false;
  if (link[0] !== "/" || link[1] === "/") return false;
  if (/[\\\s\u0000-\u001f\u007f-\u009f]/.test(link)) return false;
  const firstSlash = link.indexOf("/");
  const colon = link.indexOf(":");
  return !(colon >= 0 && colon < firstSlash);
}

/** A stable per-event key: `${op}:${requestId}:${local}`, reduced and capped. */
export function notificationEventKey(op: string, requestId: string, local: string): string {
  const safe = (s: string) => String(s).replace(/[^A-Za-z0-9:._-]/g, "");
  return `${safe(op)}:${safe(requestId)}:${safe(local)}`.slice(0, MAX_EVENT_KEY);
}

export type NotificationCheck =
  | { ok: true; paramsJson: string; link: string | null }
  | {
      ok: false;
      reason: "unknown-kind" | "missing-param" | "bad-param" | "unsafe-link" | "too-large";
      fields?: string[];
    };

export function validateNotification(
  kind: string,
  params: Record<string, unknown>,
  link: string | null,
): NotificationCheck {
  if (!isNotificationKind(kind)) return { ok: false, reason: "unknown-kind" };
  const shape: NotificationShape = NOTIFICATION_KINDS[kind];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined;
  const missing = shape.required.filter((k) => !has(k) || params[k] === "" || params[k] === null);
  if (missing.length) return { ok: false, reason: "missing-param", fields: missing };
  const allowed = new Set([...shape.required, ...shape.optional]);
  const bad: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const okValue =
      (typeof v === "string" && v.length <= MAX_PARAM_VALUE) || (typeof v === "number" && Number.isFinite(v));
    if (!allowed.has(k) || !okValue) bad.push(k);
  }
  if (bad.length) return { ok: false, reason: "bad-param", fields: bad };
  if (link !== null && !isSafeInternalLink(link)) return { ok: false, reason: "unsafe-link" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v;
  const paramsJson = JSON.stringify(clean);
  if (paramsJson.length > MAX_PARAMS_JSON) return { ok: false, reason: "too-large" };
  return { ok: true, paramsJson, link };
}

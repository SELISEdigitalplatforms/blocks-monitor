// Pure security rules shared by Host A (server/**), the router (functions/**) and the probe tests.
// No imports on purpose: server/** loads this file natively and functions/** bundles it.

// ---------------------------------------------------------------- input shape

export const INPUT_LIMITS = {
  maxDepth: 32,
  maxKeys: 20000,
  forbiddenKeys: ["__proto__", "prototype", "constructor"],
} as const;

export const INPUT_SHAPE_MESSAGE_KEY = "fn.input.shape";

export type ShapeVerdict = { ok: true } | { ok: false; reason: "depth" | "keys" | "forbidden-key" };

const isContainer = (v: unknown): v is object => typeof v === "object" && v !== null;

/** Iterative walk (no recursion, so a hostile body cannot overflow the stack); exits at the first violation. */
export function checkInputShape(value: unknown): ShapeVerdict {
  if (!isContainer(value)) return { ok: true };
  const forbidden: readonly string[] = INPUT_LIMITS.forbiddenKeys;
  const stack: Array<{ node: object; depth: number }> = [{ node: value, depth: 1 }];
  let entries = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > INPUT_LIMITS.maxDepth) return { ok: false, reason: "depth" };
    if (Array.isArray(node)) {
      entries += node.length;
      if (entries > INPUT_LIMITS.maxKeys) return { ok: false, reason: "keys" };
      for (const child of node) if (isContainer(child)) stack.push({ node: child, depth: depth + 1 });
    } else {
      // Object.keys sees an own "__proto__" key that JSON.parse creates.
      const keys = Object.keys(node);
      entries += keys.length;
      if (entries > INPUT_LIMITS.maxKeys) return { ok: false, reason: "keys" };
      for (const key of keys) {
        if (forbidden.includes(key)) return { ok: false, reason: "forbidden-key" };
        const child = (node as Record<string, unknown>)[key];
        if (isContainer(child)) stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- impersonation

export const IMPERSONATION_REFUSED_PERMISSIONS = [
  "members.manage",
  "roles.manage",
  "workspace.manage",
  "release.approve",
  "release.manage-approvals",
  "release.promote",
] as const;

export const IMPERSONATION_REFUSED_SCOPES = ["platform", "engine"] as const;

/** Views that expose the IAM directory: refused for an impersonated caller although they are not commands. */
export const IMPERSONATION_REFUSED_VIEWS = ["people.list", "people.countSuperAdmins"] as const;

export const IMPERSONATION_MESSAGE_KEY = "fn.impersonationRefused";

/**
 * Tenancy and admin commands are bound with scope "self" and no router-level permission (functions/workspace/ops/_shared/bind.ts);
 * each handler checks its own permission. This table gives the router that permission, or "platform" for platform permissions.
 */
export const SELF_SCOPE_COMMAND_PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({
  "member.invite": "members.manage",
  "member.remove": "members.manage",
  "member.setRole": "members.manage",
  "workspaceRole.save": "roles.manage",
  "workspaceRole.delete": "roles.manage",
  "workspaceRole.applyTemplate": "roles.manage",
  "acl.restamp": "workspace.manage",
  "platformRole.save": "platform",
  "platformRole.delete": "platform",
  "platformRole.assign": "platform",
  "platformRole.unassign": "platform",
  "setting.save": "platform",
  "signup.settings.save": "platform",
  "account.deactivate": "platform",
  "account.reactivate": "platform",
  "workspace.suspend": "platform",
  "people.invite": "platform",
  "people.createAccount": "platform",
  "people.setActive": "platform",
  "people.resendActivation": "platform",
  "people.setRole": "platform",
});

/** Self-scope commands that act only on the caller's own data (or create a new workspace the caller then owns). */
export const SELF_SCOPE_UNRESTRICTED_COMMANDS = [
  "me.bootstrap",
  "notification.markRead",
  "notification.markAllRead",
  "workspace.create",
  "me.passwordChanged",
  "me.completeSignup",
] as const;

export function impersonationRefused(o: {
  impersonated: boolean;
  op: string;
  kind: string;
  scope: string;
  permission?: string | readonly string[] | null;
}): boolean {
  if (!o.impersonated) return false;
  if ((IMPERSONATION_REFUSED_VIEWS as readonly string[]).includes(o.op)) return true;
  if (o.kind !== "command") return false;
  const refusedPermissions: readonly string[] = IMPERSONATION_REFUSED_PERMISSIONS;
  if ((IMPERSONATION_REFUSED_SCOPES as readonly string[]).includes(o.scope)) return true;
  const declared = o.permission == null ? [] : typeof o.permission === "string" ? [o.permission] : o.permission;
  if (declared.some((p) => refusedPermissions.includes(p))) return true;
  if (o.scope === "self") {
    const needed = Object.prototype.hasOwnProperty.call(SELF_SCOPE_COMMAND_PERMISSIONS, o.op)
      ? SELF_SCOPE_COMMAND_PERMISSIONS[o.op]
      : undefined;
    if (needed === "platform" || (needed !== undefined && refusedPermissions.includes(needed))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- quotas

export type QuotaSource = "operation" | "audit";

export interface OpQuota {
  readonly op: string;
  readonly max: number;
  readonly windowMinutes: number;
  readonly source: QuotaSource;
}

const quota = (op: string, max: number, windowMinutes = 60): OpQuota => Object.freeze({ op, max, windowMinutes, source: "operation" });

export const OP_QUOTAS: readonly OpQuota[] = Object.freeze([
  quota("member.invite", 50),
  quota("workspace.create", 10),
  quota("me.completeSignup", 10),
  quota("workspace.rename", 30),
  quota("project.create", 60),
  quota("share.create", 120),
  quota("doc.file.presign", 300),
  quota("sample.presign", 300),
  quota("scope.attachment.presign", 300),
  quota("feedback.attachment.presign", 300),
  quota("attachment.presign", 300),
  quota("job.create", 60),
  quota("job.retry", 60),
  quota("approvalRequest.create", 30),
  quota("account.deactivate", 30),
  quota("account.reactivate", 30),
  quota("people.invite", 30),
  // The op leaves no Operation row (its answer holds the password), so the quota counts audit rows.
  Object.freeze({ op: "people.createAccount", max: 30, windowMinutes: 60, source: "audit" }),
  quota("people.setActive", 30),
  quota("people.resendActivation", 30),
  quota("people.setRole", 30),
  quota("setting.save", 30),
  quota("signup.settings.save", 30),
  quota("platformRole.assign", 60),
  // A view leaves no Operation row, so the quota counts the AuditEvent written on the first page.
  Object.freeze({ op: "workspace.export", max: 10, windowMinutes: 60, source: "audit" }),
]);

export const QUOTA_MESSAGE_KEY = "fn.quota";

/** An "operation" quota counts Operation rows, which only commands leave; an "audit" quota applies to either kind. */
export function quotaFor(op: string, kind: "command" | "view"): OpQuota | null {
  const found = OP_QUOTAS.find((q) => q.op === op);
  if (!found) return null;
  if (found.source === "operation" && kind !== "command") return null;
  return found;
}

function timeOf(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v);
  return Number.NaN;
}

/** `newestFirst` holds the caller's newest timestamps for this op, newest first. */
export function quotaVerdict(
  q: OpQuota,
  newestFirst: readonly unknown[],
  nowMs: number,
): { limited: false } | { limited: true; retryAfterSeconds: number } {
  if (newestFirst.length < q.max) return { limited: false };
  const oldestMs = timeOf(newestFirst[q.max - 1]);
  // Fail open: a row without a readable timestamp must not lock a person out of the product.
  if (!Number.isFinite(oldestMs)) return { limited: false };
  const windowMs = q.windowMinutes * 60_000;
  if (oldestMs > nowMs - windowMs) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((oldestMs + windowMs - nowMs) / 1000)) };
  }
  return { limited: false };
}

// ---------------------------------------------------------------- redaction

export const REDACTED = "[redacted]";
export const LOG_LINE_MAX = 1024;

const SECRET_WORDS = "secret|password|passwd|token|api[ _-]?key|client[ _-]?secret|authorization|cookie|credential|private[ _-]?key";
const SECRET_KEY = new RegExp(SECRET_WORDS, "i");
const SECRET_PAIR = new RegExp(
  `(["']?)([\\w-]*(?:${SECRET_WORDS})[\\w-]*)\\1(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;&}"']+)`,
  "gi",
);
const SIGNED_PARAM = /\b(sig|se|sv|sp|skoid|sktid|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|access_token|token|code)=([^&\s"']+)/gi;
const URL_QUERY = /(https?:\/\/[^\s"'<>?#]*)\?[^\s"'<>]*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const LONG_RUN = /[A-Za-z0-9+/_]{32,}={0,2}/g;

export function redactText(s: string): string {
  return s
    .replace(URL_QUERY, `$1?${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(SIGNED_PARAM, `$1=${REDACTED}`)
    .replace(SECRET_PAIR, (_m, q: string, key: string, sep: string, value: string) => {
      const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
      return `${q}${key}${q}${sep}${quote}${REDACTED}${quote}`;
    })
    .replace(LONG_RUN, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? REDACTED : run));
}

const DEPTH_CAP = 8;

function scrub(value: unknown, depth: number, ancestors: object[]): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return redactText(String(value));
  if (ancestors.includes(value)) return "[circular]";
  if (depth >= DEPTH_CAP) return "[depth]";
  const next = [...ancestors, value];
  if (value instanceof Error) return redactText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1, next));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : scrub(v, depth + 1, next);
  return out;
}

export function redact(value: unknown, max: number = LOG_LINE_MAX): string {
  let text: string;
  if (typeof value === "string") text = redactText(value);
  else if (value === null || typeof value === "number" || typeof value === "boolean") text = String(value);
  else if (typeof value === "object") text = JSON.stringify(scrub(value, 0, [])) ?? "";
  else text = redactText(String(value));
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

// Pure rules for the few emails people get (design 12.3 D6): which kinds mail, with which template,
// and the exact fields the doorbell workflow's Shape node produces. No I/O.
import { isSafeInternalLink, type NotificationKind } from "./notifications";

export const EMAIL_LANGUAGE = "en-US";
export const SUBJECT_VALUE_MAX = 120;
export const BODY_VALUE_MAX = 200;
export const RECIPIENT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export interface EmailTemplateSpec {
  purpose: string;
  subject: readonly string[];
  body: readonly string[];
}

export const EMAIL_TEMPLATES: Readonly<Partial<Record<NotificationKind, EmailTemplateSpec>>> = {
  "job.failed": {
    purpose: "mf-build-failed",
    subject: ["projectName"],
    body: ["projectName", "jobKind", "failure", "failedAt", "link"],
  },
  invited: {
    purpose: "mf-workspace-added",
    subject: ["workspaceName"],
    body: ["actorName", "workspaceName", "roleName", "link"],
  },
  "access-requested": {
    purpose: "mf-access-requested",
    subject: ["email"],
    body: ["actorName", "email", "workspaceName", "link"],
  },
};

export function emailTemplateFor(kind: string): EmailTemplateSpec | null {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, kind)
    ? (EMAIL_TEMPLATES as Record<string, EmailTemplateSpec>)[kind]
    : null;
}

export function normaliseEmailAddress(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const v = x.trim().toLowerCase();
  if (v.length === 0 || v.length > 254) return null;
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(v)) return null;
  const parts = v.split("@");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return null;
  return parts[1].indexOf(".") >= 0 ? v : null;
}

export interface EmailFields {
  to: string;
  template: string;
  subject: Record<string, string>;
  body: Record<string, string>;
}

const clean = (v: unknown, max: number): string => {
  if (typeof v === "string") return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max);
  if (typeof v === "number" && isFinite(v)) return String(v);
  return "";
};

export function emailFieldsFor(
  kind: string,
  params: Record<string, unknown>,
  link: string | null,
  appBaseUrl: string,
  emailStatus: string,
): EmailFields | null {
  if (emailStatus !== "pending") return null;
  const spec = emailTemplateFor(kind);
  if (!spec || params.emailTemplate !== spec.purpose) return null;
  const to = normaliseEmailAddress(params.emailTo);
  if (to === null) return null;
  const subject: Record<string, string> = {};
  const body: Record<string, string> = {};
  for (const k of spec.subject) subject[k] = clean(params[k], SUBJECT_VALUE_MAX);
  for (const k of spec.body) body[k] = clean(params[k], BODY_VALUE_MAX);
  body.link = appBaseUrl + (isSafeInternalLink(link) ? (link as string) : "/dashboard");
  return { to, template: spec.purpose, subject, body };
}

export interface DoorbellShape {
  recipient: string;
  ring: boolean;
  email: boolean;
  to: string;
  template: string;
  subject: Record<string, string>;
  body: Record<string, string>;
}

export function shapeNotificationRow(
  row: { RecipientUserId?: unknown; Kind?: unknown; ParamsJson?: unknown; Link?: unknown; EmailStatus?: unknown },
  appBaseUrl: string,
): DoorbellShape {
  const recipient =
    typeof row.RecipientUserId === "string" && RECIPIENT_ID_PATTERN.test(row.RecipientUserId) ? row.RecipientUserId : "";
  let params: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(row.ParamsJson));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
  } catch {
    params = {};
  }
  const fields = recipient
    ? emailFieldsFor(String(row.Kind), params, typeof row.Link === "string" ? row.Link : null, appBaseUrl, String(row.EmailStatus))
    : null;
  return {
    recipient,
    ring: recipient !== "",
    email: fields !== null,
    to: fields ? fields.to : "",
    template: fields ? fields.template : "",
    subject: fields ? fields.subject : {},
    body: fields ? fields.body : {},
  };
}

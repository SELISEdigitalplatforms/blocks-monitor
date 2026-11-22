import type { BlocksProfile } from "./session";

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (...values: unknown[]): string => values.find((v) => typeof v === "string" && v.trim()) as string || "";
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Accept only a live IAM response, never a locally decoded token or cached persona. */
export function profileFromOidc(value: unknown): BlocksProfile | null {
  const envelope = record(value);
  if (!envelope || envelope.isSuccess === false || envelope.error || (Array.isArray(envelope.errors) && envelope.errors.length)) return null;
  const claims = record(envelope.data) ?? envelope;
  if (claims.active === false || claims.isActive === false) return null;
  const userId = text(claims.sub, claims.userId, claims.itemId);
  const email = text(claims.email);
  if (!userId || !email) return null;
  const firstName = text(claims.given_name, claims.firstName);
  const lastName = text(claims.family_name, claims.lastName);
  const roles = strings(claims.roles);
  return {
    userId, email, firstName, lastName,
    displayName: text(claims.name, claims.displayName, `${firstName} ${lastName}`.trim(), email),
    roles, permissions: strings(claims.permissions),
    isSuperAdmin: roles.includes("mf-super-admin"),
  };
}

/** Reject external destinations, encoded backslashes and auth-loop destinations. */
export function oidcReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020]/.test(raw)) return "/dashboard";
  try {
    const decoded = decodeURIComponent(raw);
    if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith("//")) return "/dashboard";
    const url = new URL(raw, "https://madp.invalid");
    if (url.origin !== "https://madp.invalid" || /^\/(login|sign-in|sign-up|activate|resetpassword)(\/|$)/.test(url.pathname)) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch { return "/dashboard"; }
}

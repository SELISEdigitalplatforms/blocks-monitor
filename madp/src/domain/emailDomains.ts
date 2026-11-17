/**
 * Allowed email domains: the sign-in allow-list read from S1's two
 * PlatformSetting rows. Pure: shared with the server functions.
 */
import {
  DEFAULT_ALLOWED_DOMAINS,
  MAX_ALLOWED_DOMAINS,
  MAX_QA_EXCEPTIONS,
  isEmailAllowed,
  isValidDomain,
  isValidEmail,
  normalizeDomain,
  normalizeEmail,
} from "./platform";

/** The PlatformSetting keys S1 stores the allow-list under (list in Values). */
export const S1_SETTING_KEYS = {
  domains: "allowed-email-domains",
  exceptions: "allowed-email-exceptions",
} as const;

export interface AllowedEmailDomains {
  domains: string[];
  exceptions: string[];
  isDefault: boolean;
}

function list(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function clean(raw: unknown, normalize: (s: string) => string, valid: (s: string) => boolean, cap: number): string[] {
  const out: string[] = [];
  for (const r of list(raw)) {
    const v = normalize(r);
    if (valid(v) && !out.includes(v)) out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/** Reads the two setting rows; missing or invalid domains give the default. */
export function parseAllowedEmailDomains(i: { domains: unknown; exceptions: unknown }): AllowedEmailDomains {
  const domains = clean(i.domains, normalizeDomain, isValidDomain, MAX_ALLOWED_DOMAINS);
  const exceptions = clean(i.exceptions, normalizeEmail, isValidEmail, MAX_QA_EXCEPTIONS);
  if (domains.length === 0) return { domains: [...DEFAULT_ALLOWED_DOMAINS], exceptions, isDefault: true };
  return { domains, exceptions, isDefault: false };
}

export function emailDomainOf(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  return at < 0 ? "" : e.slice(at + 1);
}

/** Exact domain match (no subdomains) or an exact exception email. */
export function emailAllowed(email: string, s: AllowedEmailDomains): boolean {
  return isEmailAllowed(email, s.domains, s.exceptions);
}

export type SettingChangeResult =
  | { ok: true; value: AllowedEmailDomains }
  | {
      ok: false;
      code: "invalid_input";
      messageKey: "tenancy.noDomains" | "tenancy.wouldLockOut" | "tenancy.invalidArgs";
      params?: Record<string, unknown>;
    };

/** Refuses invalid entries, an empty allow-list, or one that would lock the caller out. */
export function checkSettingChange(i: {
  next: { domains: readonly string[]; exceptions: readonly string[] };
  callerEmail: string;
}): SettingChangeResult {
  const domains: string[] = [];
  const exceptions: string[] = [];
  const invalid: string[] = [];
  for (const raw of i.next.domains) {
    const v = normalizeDomain(String(raw));
    if (!isValidDomain(v)) invalid.push(String(raw));
    else if (!domains.includes(v)) domains.push(v);
  }
  for (const raw of i.next.exceptions) {
    const v = normalizeEmail(String(raw));
    if (!isValidEmail(v)) invalid.push(String(raw));
    else if (!exceptions.includes(v)) exceptions.push(v);
  }
  if (domains.length > MAX_ALLOWED_DOMAINS) invalid.push(`more than ${MAX_ALLOWED_DOMAINS} domains`);
  if (exceptions.length > MAX_QA_EXCEPTIONS) invalid.push(`more than ${MAX_QA_EXCEPTIONS} exceptions`);
  if (invalid.length) {
    return { ok: false, code: "invalid_input", messageKey: "tenancy.invalidArgs", params: { invalid } };
  }
  if (domains.length === 0 && exceptions.length === 0) {
    return { ok: false, code: "invalid_input", messageKey: "tenancy.noDomains" };
  }
  if (!isEmailAllowed(i.callerEmail, domains, exceptions)) {
    return {
      ok: false,
      code: "invalid_input",
      messageKey: "tenancy.wouldLockOut",
      params: { domain: emailDomainOf(i.callerEmail) },
    };
  }
  return { ok: true, value: { domains, exceptions, isDefault: false } };
}

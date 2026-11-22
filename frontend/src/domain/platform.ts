/**
 * Platform settings and audit rules. Pure: shared with the server functions,
 * so no React, DOM, store or SDK imports.
 */

export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ["selisegroup.com"];

export const PLATFORM_SETTING_KEYS = ["allowedEmailDomains", "qaExceptions"] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export const MAX_ALLOWED_DOMAINS = 50;
export const MAX_QA_EXCEPTIONS = 200;

/** Trims, lowercases and strips a leading "@" and a trailing ".". */
export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

export function isValidDomain(d: string): boolean {
  if (d.length === 0 || d.length > 253) return false;
  const labels = d.split(".");
  if (labels.length < 2) return false;
  const ok = labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
  if (!ok) return false;
  return /^[a-z]{2,63}$/.test(labels[labels.length - 1]);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(e: string): boolean {
  if (e.length === 0 || e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  const local = e.slice(0, at);
  if (/[\s,;<>()]/.test(local)) return false;
  return isValidDomain(e.slice(at + 1));
}

export type ListCheck =
  | { ok: true; values: string[] }
  | { ok: false; message: string; invalid: string[] };

function cleanList(list: readonly string[], normalize: (s: string) => string): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = normalize(String(raw));
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function checkAllowedDomains(list: readonly string[]): ListCheck {
  const values = cleanList(list, normalizeDomain);
  if (values.length === 0) return { ok: false, message: "Keep at least one allowed domain.", invalid: [] };
  const invalid = values.filter((d) => !isValidDomain(d));
  if (invalid.length) {
    return { ok: false, message: `These aren't valid domains: ${invalid.join(", ")}`, invalid };
  }
  if (values.length > MAX_ALLOWED_DOMAINS) {
    return { ok: false, message: `Up to ${MAX_ALLOWED_DOMAINS} domains.`, invalid: [] };
  }
  return { ok: true, values };
}

export function checkQaExceptions(list: readonly string[]): ListCheck {
  const values = cleanList(list, normalizeEmail);
  const invalid = values.filter((e) => !isValidEmail(e));
  if (invalid.length) {
    return { ok: false, message: `These aren't valid email addresses: ${invalid.join(", ")}`, invalid };
  }
  if (values.length > MAX_QA_EXCEPTIONS) {
    return { ok: false, message: `Up to ${MAX_QA_EXCEPTIONS} addresses.`, invalid: [] };
  }
  return { ok: true, values };
}

/** A stored setting value: a string array, or a JSON string holding one. */
export function parseSettingValue(raw: unknown): string[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function allowedDomainsFrom(raw: unknown): { values: string[]; isDefault: boolean } {
  const values = parseSettingValue(raw);
  if (values.length === 0) return { values: [...DEFAULT_ALLOWED_DOMAINS], isDefault: true };
  return { values, isDefault: false };
}

export function isEmailAllowed(
  email: string,
  domains: readonly string[],
  exceptions: readonly string[],
): boolean {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return false;
  if (exceptions.some((x) => normalizeEmail(x) === e)) return true;
  const domain = e.slice(e.indexOf("@") + 1);
  return domains.some((d) => normalizeDomain(d) === domain);
}

export interface AuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  crossWorkspace: boolean;
}

/** from and to are "YYYY-MM-DD", inclusive. */
export interface AuditFilters {
  actor?: string;
  action?: string;
  workspaceId?: string;
  from?: string;
  to?: string;
  crossWorkspaceOnly?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function filterAudit(entries: readonly AuditEntry[], f: AuditFilters): AuditEntry[] {
  const actor = f.actor?.trim().toLowerCase();
  const from = f.from && DAY.test(f.from) ? f.from : null;
  const to = f.to && DAY.test(f.to) ? f.to : null;
  return entries
    .filter((e) => {
      if (actor && !e.actorEmail.toLowerCase().includes(actor) && !(e.actorName ?? "").toLowerCase().includes(actor)) {
        return false;
      }
      if (f.action && e.action !== f.action) return false;
      if (f.workspaceId && e.workspaceId !== f.workspaceId) return false;
      const day = e.at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (f.crossWorkspaceOnly && !e.crossWorkspace) return false;
      return true;
    })
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.at < b.e.at ? 1 : a.e.at > b.e.at ? -1 : a.i - b.i))
    .map((x) => x.e);
}

export function auditFacets(entries: readonly AuditEntry[]): {
  actions: string[];
  workspaces: { id: string; name: string }[];
} {
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const ws = new Map<string, string>();
  for (const e of entries) {
    if (e.workspaceId && !ws.has(e.workspaceId)) ws.set(e.workspaceId, e.workspaceName ?? e.workspaceId);
  }
  const workspaces = [...ws].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { actions, workspaces };
}

// Platform management (/admin): its sections, who may open each, and where each lives. Pure: the route guard, the rail's
// entry and the section navigation all read this one list.
import type { PlatformPermission } from "./rbac";

export type PlatformSectionKey =
  | "overview" | "organizations" | "people" | "roles"
  | "plans" | "credits" | "usage"
  | "engine" | "ai-accounts"
  | "settings" | "audit";

export type PlatformGroup = "Organization" | "Business" | "Operations" | "System";

export interface PlatformSectionDef {
  key: PlatformSectionKey;
  label: string;
  /** The address below /admin ("" for the overview at /admin itself). */
  slug: string;
  group: PlatformGroup | null;
  /** One sentence under the section's title. */
  summary: string;
  /** Opened by a person holding any one of these; the super admin opens every section. */
  anyOf: readonly PlatformPermission[];
  /** Only the super admin, whatever else a person holds. */
  superAdminOnly?: boolean;
}

export const PLATFORM_GROUPS: readonly PlatformGroup[] = ["Organization", "Business", "Operations", "System"];

export const PLATFORM_SECTIONS: readonly PlatformSectionDef[] = [
  { key: "overview", label: "Overview", slug: "", group: null, anyOf: [],
    summary: "What the platform spends, how busy the engine is, and what waits for you." },
  { key: "organizations", label: "Organizations", slug: "organizations", group: "Organization",
    anyOf: ["platform.orgs.manage", "platform.workspaces.view", "platform.workspaces.manage", "platform.workspaceRoles.view"],
    summary: "Every organization on the platform, its members and its roles." },
  // Accounts themselves (the IAM directory: invite, create, deactivate) stay with the super admin inside the section;
  // a platform.people.manage holder opens it for people's platform roles and organizations.
  { key: "people", label: "People", slug: "people", group: "Organization",
    anyOf: ["platform.people.manage"],
    summary: "Everyone who can sign in, and the people waiting for an account." },
  { key: "roles", label: "Roles & permissions", slug: "roles", group: "Organization",
    anyOf: ["platform.roles.manage", "platform.users.manage"],
    summary: "The roles people hold on the platform and what each one may do." },
  { key: "plans", label: "Plans", slug: "plans", group: "Business", anyOf: ["platform.billing.manage"],
    summary: "The plans organizations choose from: price, monthly credit, human help and parallel work." },
  { key: "credits", label: "Credits & coupons", slug: "credits", group: "Business", anyOf: ["platform.billing.manage"],
    summary: "Credit balances, purchase requests waiting for a decision, and coupons." },
  { key: "usage", label: "Usage & costs", slug: "usage", group: "Business", anyOf: ["platform.usage.view", "platform.billing.manage"],
    summary: "What the engine's work cost, by organization, project, person, model or day." },
  { key: "engine", label: "Engine & capacity", slug: "engine", group: "Operations", anyOf: ["platform.engine.view", "platform.engine.manage"],
    summary: "The engine hosts, how loaded they are, and the work running now." },
  { key: "ai-accounts", label: "Model accounts", slug: "ai-accounts", group: "Operations", anyOf: ["platform.ai.manage", "platform.engine.manage"],
    summary: "The model accounts the engine works with, their limits and when they rotate." },
  { key: "settings", label: "Settings", slug: "settings", group: "System", anyOf: ["platform.settings.manage"],
    summary: "Who may sign up, and the platform's own settings." },
  { key: "audit", label: "Audit", slug: "audit", group: "System", anyOf: ["platform.audit.view"],
    summary: "Every change made on the platform, by whom and when." },
];

const BY_KEY = new Map(PLATFORM_SECTIONS.map((s) => [s.key, s]));
const BY_SLUG = new Map(PLATFORM_SECTIONS.map((s) => [s.slug, s]));

export function platformSection(key: PlatformSectionKey): PlatformSectionDef {
  return BY_KEY.get(key) ?? PLATFORM_SECTIONS[0];
}

export function platformSectionPath(key: PlatformSectionKey): string {
  const s = platformSection(key);
  return s.slug ? `/admin/${s.slug}` : "/admin";
}

type PlatformHolder = { isSuperAdmin: boolean; permissions: readonly string[] };

/** The sections this person may open, in the navigation's order; the overview comes with any other section. */
export function platformSectionsFor(a: PlatformHolder | null | undefined): PlatformSectionKey[] {
  if (!a) return [];
  if (a.isSuperAdmin) return PLATFORM_SECTIONS.map((s) => s.key);
  const rest = PLATFORM_SECTIONS.filter((s) => s.key !== "overview" && !s.superAdminOnly && s.anyOf.some((p) => a.permissions.includes(p)));
  return rest.length ? ["overview", ...rest.map((s) => s.key)] : [];
}

/** Whether Platform management has anything to show: the one source of truth for the rail entry and the route guard. */
export function hasPlatformSections(a: PlatformHolder | null | undefined): boolean {
  return platformSectionsFor(a).length > 0;
}

/** The section an address names (no slug: the overview), or null for an address that names none. */
export function sectionFromSlug(slug: string | undefined): PlatformSectionKey | null {
  if (slug === undefined || slug === "") return "overview";
  const s = BY_SLUG.get(slug.toLowerCase());
  return s ? s.key : null;
}

/** The former Admin tabs (/admin?tab=…) and the section each one became. */
export const LEGACY_ADMIN_TABS: Readonly<Record<string, PlatformSectionKey>> = {
  people: "people", roles: "roles", workspaces: "organizations", settings: "settings", audit: "audit",
};

/** Where an /admin address must go instead, or null to stay: an old tab link opens its section, an unknown or closed
 *  section opens the overview. */
export function platformRedirect(slug: string | undefined, legacyTab: string | null, a: PlatformHolder | null | undefined): string | null {
  const allowed = platformSectionsFor(a);
  if ((slug === undefined || slug === "") && legacyTab) {
    const target = LEGACY_ADMIN_TABS[legacyTab];
    return target && allowed.includes(target) ? platformSectionPath(target) : "/admin";
  }
  const key = sectionFromSlug(slug);
  if (key === null || !allowed.includes(key)) return "/admin";
  return null;
}

export interface PlatformNavGroup { group: PlatformGroup | null; sections: PlatformSectionDef[] }

/** The navigation's groups with only the sections this person may open; empty groups are left out. */
export function platformNavGroups(allowed: readonly PlatformSectionKey[]): PlatformNavGroup[] {
  const open = PLATFORM_SECTIONS.filter((s) => allowed.includes(s.key));
  const groups: PlatformNavGroup[] = [{ group: null, sections: open.filter((s) => s.group === null) }];
  for (const g of PLATFORM_GROUPS) groups.push({ group: g, sections: open.filter((s) => s.group === g) });
  return groups.filter((g) => g.sections.length > 0);
}

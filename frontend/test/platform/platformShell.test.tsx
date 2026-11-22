// Platform management (/admin): which sections a person may open, where each lives, how the old Admin tabs move, what the
// section navigation draws, when the area is closed, and how the overview reads other functions without ever failing.
//   npx vitest run --config test/platform/vitest.config.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { hasPlatformAccess } from "../../src/blocks/guard";
import {
  LEGACY_ADMIN_TABS, PLATFORM_SECTIONS, platformNavGroups, platformRedirect, platformSectionPath, platformSectionsFor,
  sectionFromSlug, type PlatformSectionKey,
} from "../../src/domain/platformSections";
import { PlatformSectionNav } from "../../src/components/platform/PlatformNav";
import { PlatformLayout, platformGate } from "../../src/components/platform/PlatformView";
import {
  aiAccountsFrom, attentionItems, countOrganizations, hostsFrom, pendingPurchasesFrom, readOp, usageFromReport,
} from "../../src/components/platform/overviewData";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPER = { isSuperAdmin: true, permissions: [] as string[] };
const holder = (...permissions: string[]) => ({ isSuperAdmin: false, permissions });
const ALL: PlatformSectionKey[] = PLATFORM_SECTIONS.map((s) => s.key);

describe("who may open which section", () => {
  it("opens every section to the super admin, in the navigation's order", () => {
    expect(platformSectionsFor(SUPER)).toEqual([
      "overview", "organizations", "people", "roles", "plans", "credits", "usage", "engine", "ai-accounts", "settings", "audit",
    ]);
  });

  it("opens a role holder only the sections their permissions name, with the overview first", () => {
    expect(platformSectionsFor(holder("platform.engine.manage"))).toEqual(["overview", "engine", "ai-accounts"]);
    expect(platformSectionsFor(holder("platform.audit.view", "platform.settings.manage"))).toEqual(["overview", "settings", "audit"]);
    expect(platformSectionsFor(holder("platform.workspaces.view"))).toEqual(["overview", "organizations"]);
  });

  it("keeps People and the business sections for the super admin alone", () => {
    const s = platformSectionsFor(holder("platform.users.manage", "platform.users.view", "platform.roles.manage"));
    expect(s).toEqual(["overview", "roles"]);
    for (const k of ["people", "plans", "credits", "usage"] as const) expect(s).not.toContain(k);
  });

  it("closes the area to anyone without a platform permission (the rail entry and the route guard agree)", () => {
    expect(platformSectionsFor(holder())).toEqual([]);
    expect(platformSectionsFor(holder("project.edit"))).toEqual([]);
    expect(platformSectionsFor(null)).toEqual([]);
    expect(hasPlatformAccess(holder())).toBe(false);
    expect(hasPlatformAccess(holder("platform.engine.manage"))).toBe(true);
    expect(hasPlatformAccess(SUPER)).toBe(true);
  });
});

describe("where each section lives", () => {
  it("has the contract's addresses", () => {
    expect(ALL.map(platformSectionPath)).toEqual([
      "/admin", "/admin/organizations", "/admin/people", "/admin/roles", "/admin/plans", "/admin/credits", "/admin/usage",
      "/admin/engine", "/admin/ai-accounts", "/admin/settings", "/admin/audit",
    ]);
  });

  it("reads a section back from its address; an unknown one names none", () => {
    for (const k of ALL) expect(sectionFromSlug(platformSectionPath(k).replace(/^\/admin\/?/, "") || undefined)).toBe(k);
    expect(sectionFromSlug(undefined)).toBe("overview");
    expect(sectionFromSlug("Plans")).toBe("plans");
    expect(sectionFromSlug("billing")).toBeNull();
  });

  it("moves an old Admin tab link to its section, and an unknown or closed section to the overview", () => {
    expect(platformRedirect(undefined, "workspaces", SUPER)).toBe("/admin/organizations");
    expect(platformRedirect(undefined, "people", SUPER)).toBe("/admin/people");
    expect(platformRedirect(undefined, "audit", SUPER)).toBe("/admin/audit");
    expect(platformRedirect(undefined, "nonsense", SUPER)).toBe("/admin");
    expect(platformRedirect(undefined, "people", holder("platform.audit.view"))).toBe("/admin");
    expect(platformRedirect("wrong", null, SUPER)).toBe("/admin");
    expect(platformRedirect("plans", null, holder("platform.engine.manage"))).toBe("/admin");
    expect(platformRedirect("engine", null, holder("platform.engine.manage"))).toBeNull();
    expect(platformRedirect(undefined, null, SUPER)).toBeNull();
    expect(Object.values(LEGACY_ADMIN_TABS).every((k) => ALL.includes(k))).toBe(true);
  });

  it("is routed in the app at /admin and /admin/:section", () => {
    const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
    expect(app).toContain('path="/admin" element={<Page><Admin /></Page>}');
    expect(app).toContain('path="/admin/:section" element={<Page><Admin /></Page>}');
  });

  it("has a component file at every path the contract names, each a default-exported component", async () => {
    const files: Record<PlatformSectionKey, string> = {
      overview: "OverviewSection", organizations: "OrganizationsSection", people: "PeopleSection", roles: "RolesSection",
      plans: "PlansSection", credits: "CreditsSection", usage: "UsageSection", engine: "EngineSection",
      "ai-accounts": "AiAccountsSection", settings: "SettingsSection", audit: "AuditSection",
    };
    for (const name of Object.values(files)) {
      const file = path.join(root, "src/components/platform/sections", `${name}.tsx`);
      expect(existsSync(file), name).toBe(true);
      const mod = (await import(file)) as { default?: unknown };
      expect(typeof mod.default, name).toBe("function");
    }
  });
});

describe("the section navigation", () => {
  const nav = (allowed: PlatformSectionKey[], active: PlatformSectionKey) =>
    renderToStaticMarkup(<MemoryRouter><PlatformSectionNav allowed={allowed} active={active} /></MemoryRouter>);

  it("groups the sections under Organization, Business, Operations and System, the overview on top", () => {
    expect(platformNavGroups(ALL).map((g) => g.group)).toEqual([null, "Organization", "Business", "Operations", "System"]);
    const html = nav(ALL, "overview");
    const at = (t: string) => html.indexOf(t);
    expect(at(">Overview<")).toBeLessThan(at(">Organization<"));
    expect(at(">Organization<")).toBeLessThan(at(">Business<"));
    expect(at(">Business<")).toBeLessThan(at(">Operations<"));
    expect(at(">Operations<")).toBeLessThan(at(">System<"));
    for (const label of ["Organizations", "People", "Roles &amp; permissions", "Plans", "Credits &amp; coupons", "Usage &amp; costs", "Engine &amp; capacity", "Model accounts", "Settings", "Audit"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("links every section to its address and marks the open one", () => {
    const html = nav(ALL, "plans");
    for (const k of ALL) expect(html).toContain(`href="${platformSectionPath(k)}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/plans"|href="\/admin\/plans"[^>]*aria-current="page"/);
  });

  it("leaves out the sections and the groups a person cannot open", () => {
    const html = nav(platformSectionsFor(holder("platform.engine.manage")), "engine");
    expect(html).toContain(">Engine &amp; capacity<");
    expect(html).not.toContain(">Business<");
    expect(html).not.toContain(">Organization<");
    expect(html).not.toContain('href="/admin/people"');
  });

  it("frames the open section: the title and its sentence, the list for wide screens and a picker for a phone", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><PlatformLayout allowed={ALL} active="usage" onPick={() => {}}><p>section body</p></PlatformLayout></MemoryRouter>,
    );
    expect(html).toContain(">Usage &amp; costs</h1>");
    expect(html).toContain("What the engine&#x27;s work cost");
    expect(html).toContain("Platform management");
    expect(html).toContain("lg:sticky");
    expect(html).toContain('aria-label="Section"');
    expect(html).toContain("lg:hidden");
    expect(html).toContain("<p>section body</p>");
  });
});

describe("the gate", () => {
  it("is closed where the admin function is not mounted, waits for the access, and admits platform admins only", () => {
    expect(platformGate(false, { ready: true, ...SUPER })).toBe("unavailable");
    expect(platformGate(true, { ready: false, isSuperAdmin: false, permissions: [] })).toBe("loading");
    expect(platformGate(true, { ready: true, isSuperAdmin: false, permissions: [] })).toBe("denied");
    expect(platformGate(true, { ready: true, isSuperAdmin: false, permissions: ["platform.audit.view"] })).toBeNull();
    expect(platformGate(true, { ready: true, ...SUPER })).toBeNull();
  });
});

describe("the overview's reads", () => {
  it("answers null, never an error, for an op that is not there", async () => {
    await expect(readOp("platform", "platform.engine.status")).resolves.toBeNull();
    await expect(readOp("billing", "billing.usage.report", { groupBy: "workspace" })).resolves.toBeNull();
  });

  it("adds up this month's usage from the report rows in either field spelling", () => {
    expect(usageFromReport(null)).toBeNull();
    expect(usageFromReport({ rows: [{ costUsd: 1.5, tokens: { total: 1000 } }, { CostUsd: "2.25", tokens: 500 }] }))
      .toEqual({ costUsd: 3.75, tokens: 1500, rows: 2 });
    expect(usageFromReport([])).toEqual({ costUsd: 0, tokens: 0, rows: 0 });
  });

  it("reads engine hosts, AI accounts and pending purchases from lists or wrapped lists", () => {
    const hosts = hostsFrom({ hosts: [{ HostId: "h1", Name: "Engine 1", CpuPercent: 42, RunningJobs: 3, ActiveAgents: 7, LastSeenAt: "2026-11-09T10:00:00Z" }] });
    expect(hosts[0]).toMatchObject({ id: "h1", name: "Engine 1", cpuPercent: 42, runningJobs: 3, activeAgents: 7 });
    expect(aiAccountsFrom([{ label: "Account A", status: "Cooling", usage5hPercent: 99 }])[0]).toMatchObject({ label: "Account A", status: "cooling", usage5h: 99 });
    expect(pendingPurchasesFrom({ items: [{ Status: "pending" }, { Status: "approved" }, { status: "pending" }] })).toBe(2);
    expect(hostsFrom("nonsense")).toEqual([]);
  });

  it("lists what needs attention, most urgent first, and nothing for sources it could not read", () => {
    const now = Date.parse("2026-11-09T10:10:00Z");
    const items = attentionItems({
      pendingPurchases: 2, waitingPeople: 1, now,
      hosts: [
        { id: "h1", name: "Engine 1", lastSeenAt: "2026-11-09T09:00:00Z", cpuPercent: 10, runningJobs: 0, activeAgents: 0, queueLength: 0 },
        { id: "h2", name: "Engine 2", lastSeenAt: "2026-11-09T10:09:00Z", cpuPercent: 95, runningJobs: 4, activeAgents: 9, queueLength: 2 },
      ],
      aiAccounts: [{ label: "Account A", status: "cooling", usage5h: 100, resetsAt: null }],
    });
    expect(items.map((i) => i.id)).toEqual(["host-silent-h1", "host-busy-h2", "ai-none-active", "ai-cooling-Account A", "purchases", "people"]);
    expect(items.find((i) => i.id === "purchases")?.text).toBe("2 purchase requests wait for your decision");
    expect(items.find((i) => i.id === "people")?.text).toBe("1 person waits for an account");
    expect(items.every((i) => i.to.startsWith("/admin/"))).toBe(true);
    expect(attentionItems({ pendingPurchases: null, waitingPeople: null, hosts: null, aiAccounts: null, now })).toEqual([]);
  });

  it("counts active organizations over every page, and nothing when the list cannot be read", async () => {
    const page = (items: { status: string }[], totalCount: number) =>
      ({ ok: true as const, value: { items: items.map((w, i) => ({ workspaceId: `w${i}`, name: `W${i}`, status: w.status, memberCount: 1, admins: [] })), totalCount, page: 1, pageSize: 50 } });
    const pages = [page(Array.from({ length: 50 }, (_, i) => ({ status: i < 3 ? "suspended" : "active" })), 60), page(Array.from({ length: 10 }, () => ({ status: "active" })), 60)];
    let n = 0;
    await expect(countOrganizations(async () => pages[n++])).resolves.toEqual({ active: 57, total: 60, counted: 60 });
    await expect(countOrganizations(async () => ({ ok: false as const, error: "no" }))).resolves.toBeNull();
    await expect(countOrganizations(async () => { throw new Error("down"); })).resolves.toBeNull();
  });
});

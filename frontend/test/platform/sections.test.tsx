// The Organizations, People and Roles & permissions sections rendered from cached op answers: what the super admin sees,
// and the plain refusal a person without the platform permission gets (the ops refuse them too; see rbacOps.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlatformAccess } from "../../src/blocks/admin";

const state = vi.hoisted(() => ({ access: null as unknown as PlatformAccess }));
vi.mock("../../src/blocks/admin", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/admin")>()),
  usePlatformAccess: () => state.access,
}));

const { meKeys } = await import("../../src/blocks/workspaces/queries");
const { default: RolesSection, OrganizationRolesView, PermissionCatalogue } = await import("../../src/components/platform/sections/RolesSection");
const { default: OrganizationsSection } = await import("../../src/components/platform/sections/OrganizationsSection");
const { default: PeopleSection } = await import("../../src/components/platform/sections/PeopleSection");

const SUPER: PlatformAccess = { ready: true, isSuperAdmin: true, userId: "super-1", email: "super@example.org", roleKeys: [], permissions: [] };
const NOBODY: PlatformAccess = { ready: true, isSuperAdmin: false, userId: "n-1", email: "n@example.org", roleKeys: [], permissions: [] };
const VIEWER: PlatformAccess = { ...NOBODY, permissions: ["platform.users.view", "platform.workspaces.view"] };
const PEOPLE_DESK: PlatformAccess = { ...NOBODY, permissions: ["platform.users.view", "platform.users.manage", "platform.people.manage"] };

function render(el: ReactElement, access: PlatformAccess): string {
  state.access = access;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The session is signed out in a server render, so the hooks key their cache with an empty user id.
  client.setQueryData(meKeys.admin("", "platformRole.list"), {
    roles: [
      { itemId: null, key: "platform-admin", name: "Platform admin", permissions: [], isBuiltIn: true },
      { itemId: "r1", key: "billing-desk", name: "Billing desk", description: "Plans and credit", permissions: ["platform.billing.manage"], isBuiltIn: false },
    ],
    templates: [{ itemId: "t1", key: "reviewer", name: "Reviewer", description: "Reads and comments", permissions: ["view", "comment"] }],
    assignments: [{ itemId: "a1", userId: "u-9", roleKey: "billing-desk", status: "active", email: "desk@example.org", displayName: "Desk Person" }],
  });
  client.setQueryData(meKeys.admin("", "workspace.list", { page: 1 }), {
    items: [
      { workspaceId: "w1", name: "Northwind", status: "active", memberCount: 3, admins: [{ userId: "o1", email: "owner@example.org", displayName: "Owner One" }], planKey: "classic" },
      { workspaceId: "w2", name: "Harbor", status: "suspended", memberCount: 1, admins: [], planKey: null },
    ],
    totalCount: 2, page: 1, pageSize: 50,
  });
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(QueryClientProvider, { client }, el)));
}

describe("Roles & permissions", () => {
  it("shows the super admin the locked Platform admin, custom roles with clone, and the matrix", () => {
    const html = render(createElement(RolesSection), SUPER);
    expect(html).toContain("Roles &amp; permissions");
    expect(html).toContain("Platform admin");
    expect(html).toContain("Built-in");
    expect(html).toContain("Billing desk");
    expect(html).toContain('aria-label="Clone Billing desk"');
    expect(html).toContain('aria-label="Clone Platform admin"');
    expect(html).toContain("Platform roles side by side");
    expect(html).toContain("Manage plans, credits and coupons");
  });

  it("lists organization role templates beside the locked built-in roles; editing needs platform.roles.manage", () => {
    const html = render(createElement(OrganizationRolesView, { access: SUPER }), SUPER);
    expect(html).toContain("Built-in organization roles");
    expect(html).toContain("Locked");
    expect(html).toContain("Reviewer");
    expect(html).toContain("New template");
    expect(html).toContain('aria-label="Edit Reviewer"');
    const readOnly = render(createElement(OrganizationRolesView, { access: VIEWER }), VIEWER);
    expect(readOnly).toContain("Reviewer");
    expect(readOnly).not.toContain("New template");
    expect(readOnly).not.toContain('aria-label="Edit Reviewer"');
  });

  it("explains every permission in plain words, grouped by area", () => {
    const html = render(createElement(PermissionCatalogue), SUPER);
    expect(html).toContain("Plans, credits &amp; usage");
    expect(html).toContain("Edit plans, grant credit, create coupons and approve purchases.");
    expect(html).toContain("Invite, suspend and remove members, and change their roles.");
  });
});

describe("Organizations", () => {
  it("lists every organization with plan, members, owner and status", () => {
    const html = render(createElement(OrganizationsSection), SUPER);
    expect(html).toContain("2 organizations");
    expect(html).toContain("Northwind");
    expect(html).toContain("Classic");
    expect(html).toContain("3 members");
    expect(html).toContain("Owner: Owner One");
    expect(html).toContain("No plan yet");
    expect(html).toContain("No owner yet");
    expect(html).toContain('aria-label="Open Harbor"');
  });

  it("refuses a person without an organizations permission", () => {
    const html = render(createElement(OrganizationsSection), NOBODY);
    expect(html).toContain("Organizations need a platform role");
    expect(html).not.toContain("Northwind");
  });
});

describe("People", () => {
  it("is refused without platform.people.manage; a holder sees the platform role holders, not the account directory", () => {
    expect(render(createElement(PeopleSection), NOBODY)).toContain("People need a platform role");
    expect(render(createElement(PeopleSection), VIEWER)).toContain("People need a platform role");
    const desk = render(createElement(PeopleSection), PEOPLE_DESK);
    expect(desk).toContain("Inviting people and changing accounts is for the super admin.");
    expect(desk).toContain("People with a platform role");
    expect(desk).toContain("Desk Person");
    expect(desk).toContain("Billing desk");
    const admin = render(createElement(PeopleSection), SUPER);
    expect(admin).toContain("create an account");
    expect(admin).not.toContain("is for the super admin");
    expect(admin).not.toContain("People with a platform role");
  });
});

describe("the sections the new platform permissions open", () => {
  it("maps each new key onto its section", async () => {
    const { platformSectionsFor } = await import("../../src/domain/platformSections");
    const { platformPermissionsFor } = await import("../../src/domain/roles");
    const holder = (...p: string[]) => ({ isSuperAdmin: false, permissions: platformPermissionsFor({ isSuperAdmin: false, roleKeys: ["r"], roles: [{ key: "r", name: "r", permissions: p, isBuiltIn: false }] }) });
    expect(platformSectionsFor(holder("platform.orgs.manage"))).toEqual(["overview", "organizations"]);
    expect(platformSectionsFor(holder("platform.people.manage"))).toEqual(["overview", "people", "roles"]);
    expect(platformSectionsFor(holder("platform.roles.manage"))).toEqual(["overview", "roles"]);
    expect(platformSectionsFor(holder("platform.billing.manage"))).toEqual(["overview", "plans", "credits", "usage"]);
    expect(platformSectionsFor(holder("platform.usage.view"))).toEqual(["overview", "usage"]);
    expect(platformSectionsFor(holder("platform.engine.view"))).toEqual(["overview", "engine"]);
    expect(platformSectionsFor(holder("platform.ai.manage"))).toEqual(["overview", "engine", "ai-accounts"]);
  });
});

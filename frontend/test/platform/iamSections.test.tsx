// Roles & permissions and People with the role source: the Factory (as before, plus the IAM sync tab), Blocks OS IAM
// (roles, matrix and a person's roles read from IAM) and IAM that can't be reached, rendered from cached op answers.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlatformAccess } from "../../src/blocks/admin";
import type { IamPersonAccess, IamRole, IamStatus } from "../../src/blocks/iam";

const state = vi.hoisted(() => ({ access: null as unknown as PlatformAccess }));
vi.mock("../../src/blocks/admin", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/admin")>()),
  usePlatformAccess: () => state.access,
}));

const { meKeys } = await import("../../src/blocks/workspaces/queries");
const { default: RolesSection } = await import("../../src/components/platform/sections/RolesSection");
const { PersonAccessCard } = await import("../../src/components/platform/sections/PeopleSection");
const { IamSyncCard } = await import("../../src/components/platform/iam/IamSyncCard");
const { IamRolesPanel } = await import("../../src/components/platform/iam/IamRolesPanel");

const SUPER: PlatformAccess = { ready: true, isSuperAdmin: true, userId: "super-1", email: "super@example.org", roleKeys: [], permissions: [] };
const ROLES_DESK: PlatformAccess = { ready: true, isSuperAdmin: false, userId: "r-1", email: "r@example.org", roleKeys: ["roles-desk"], permissions: ["platform.roles.manage"] };
const PEOPLE_DESK: PlatformAccess = { ...ROLES_DESK, roleKeys: ["people-desk"], permissions: ["platform.users.view", "platform.users.manage", "platform.people.manage"] };

const status = (o: Partial<IamStatus> = {}): IamStatus => ({
  source: "factory", canSync: true, available: true, unavailable: null,
  counts: { permissions: 40, roles: 6, organizations: 2 },
  drift: { permissions: 0, roles: 2, organizations: 1, total: 3 },
  sync: { checkedAt: "2026-11-09T10:00:00.000Z", syncedAt: "2026-11-08T09:30:00.000Z" },
  parity: null,
  ...o,
});
const IAM_ROLES: IamRole[] = [
  { slug: "mf-platform-admin", scope: "platform", key: "platform-admin", builtIn: true, workspaceId: null, workspaceName: null, name: "Platform admin", description: "", permissions: ["platform.roles.manage"] },
  { slug: "mf-platform-billing-desk", scope: "platform", key: "billing-desk", builtIn: false, workspaceId: null, workspaceName: null, name: "Billing desk", description: "", permissions: ["platform.billing.manage"] },
  { slug: "mf-org-owner", scope: "organization", key: "owner", builtIn: true, workspaceId: null, workspaceName: null, name: "Workspace admin", description: "", permissions: ["view"] },
  { slug: "mf-tpl-reviewer", scope: "template", key: "reviewer", builtIn: false, workspaceId: null, workspaceName: null, name: "Reviewer", description: "", permissions: ["view", "comment"] },
  { slug: "mf-org-abcd1234-lead", scope: "organization", key: "lead", builtIn: false, workspaceId: "abcd1234-w", workspaceName: "Northwind", name: "Project lead", description: "", permissions: ["view"] },
];
const PERSON_ACCESS: IamPersonAccess = {
  userId: "u-9",
  platformRoles: ["billing-desk"],
  organizations: [
    { workspaceId: "w1", workspaceName: "Northwind", workspaceStatus: "active", organizationId: "org-1", membershipId: "m1", iamRoles: ["member"], factoryRole: "member", inStep: true },
    { workspaceId: "w2", workspaceName: "Harbor", workspaceStatus: "active", organizationId: null, membershipId: "m2", iamRoles: [], factoryRole: "viewer", inStep: false },
  ],
  unlinked: [],
};

function render(el: ReactElement, access: PlatformAccess, s: IamStatus | null): string {
  state.access = access;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The session is signed out in a server render, so the hooks key their cache with an empty user id.
  if (s) client.setQueryData(meKeys.admin("", "iam.status"), s);
  client.setQueryData(meKeys.admin("", "iam.roles.list"), { roles: IAM_ROLES });
  client.setQueryData(meKeys.admin("", "iam.access.get", { userId: "u-9" }), PERSON_ACCESS);
  client.setQueryData(meKeys.admin("", "platformRole.list"), {
    roles: [
      { itemId: null, key: "platform-admin", name: "Platform admin", permissions: [], isBuiltIn: true },
      { itemId: "r1", key: "billing-desk", name: "Billing desk", description: "Plans and credit", permissions: ["platform.billing.manage"], isBuiltIn: false },
    ],
    templates: [],
    assignments: [],
  });
  client.setQueryData(meKeys.admin("", "people.access", { userId: "u-9" }), {
    userId: "u-9", platformRoles: [{ roleKey: "billing-desk", assignedAt: "" }],
    memberships: [{ membershipId: "m1", workspaceId: "w1", workspaceName: "Northwind", workspaceStatus: "active", roleKey: "member", status: "active" }],
  });
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(QueryClientProvider, { client }, el)));
}

const PERSON = { userId: "u-9", email: "desk@example.org", firstName: "", lastName: "", displayName: "Desk Person", roles: [], active: true, superAdmin: false };

describe("the Factory is the source", () => {
  it("Roles & permissions works as before, says where roles are managed and adds the IAM sync tab", () => {
    const html = render(createElement(RolesSection), SUPER, status());
    expect(html).toContain('data-rbac-source="factory"');
    expect(html).toContain("Managed in MADP Factory · last synced to Blocks OS IAM 8 Nov 2026");
    expect(html).toContain("Platform roles side by side");
    expect(html).not.toContain("Platform roles in Blocks OS IAM");
    expect(html).toContain(">IAM sync<");
  });

  it("without an iam.status answer the section is exactly as before, with no source line and no sync tab", () => {
    const html = render(createElement(RolesSection), SUPER, null);
    expect(html).not.toContain("data-rbac-source");
    expect(html).not.toContain(">IAM sync<");
    expect(html).toContain("Platform roles side by side");
  });

  it("a person's access is read from the Factory", () => {
    const html = render(createElement(PersonAccessCard, { access: SUPER, person: PERSON, onClose: () => undefined }), SUPER, status());
    expect(html).not.toContain("in Blocks OS IAM");
    expect(html).toContain("Billing desk");
  });
});

describe("Blocks OS IAM is the source", () => {
  it("lists the roles IAM holds; a roles manager ticks permissions of custom roles; built-in roles stay locked", () => {
    const html = render(createElement(RolesSection), ROLES_DESK, status({ source: "iam", canSync: false }));
    expect(html).toContain('data-rbac-source="iam"');
    expect(html).toContain("Managed in Blocks OS IAM · last synced 8 Nov 2026");
    expect(html).toContain("Platform roles in Blocks OS IAM");
    expect(html).toContain("Billing desk");
    expect(html).toContain('aria-label="Manage plans, credits and coupons: Billing desk"');
    expect(html).not.toContain('aria-label="Manage plans, credits and coupons: Platform admin"');
    expect(html).toContain("New role");
    expect(html).not.toContain("Platform roles side by side");
  });

  it("organization roles: built-ins and templates in the matrix, organization-only roles listed with their organization", () => {
    const html = render(createElement(IamRolesPanel, { access: SUPER, view: "organization" }), SUPER, status({ source: "iam" }));
    expect(html).toContain("Organization roles in Blocks OS IAM");
    expect(html).toContain('aria-label="Comment: Reviewer"');
    expect(html).not.toContain('aria-label="Comment: Workspace admin"');
    expect(html).toContain("Project lead");
    expect(html).toContain("Northwind");
  });

  it("without platform.roles.manage the matrix is read-only", () => {
    const html = render(createElement(IamRolesPanel, { access: PEOPLE_DESK, view: "platform" }), PEOPLE_DESK, status({ source: "iam" }));
    expect(html).toContain("Billing desk");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("New role");
  });

  it("a person's platform roles and role in each organization are read from IAM, out-of-step lines marked", () => {
    const html = render(createElement(PersonAccessCard, { access: SUPER, person: PERSON, onClose: () => undefined, iam: true }), SUPER, status({ source: "iam" }));
    expect(html).toContain("Platform roles in Blocks OS IAM");
    expect(html).toContain("Billing desk");
    expect(html).toContain("Role in each organization");
    expect(html).toContain("In step with the Factory");
    expect(html).toContain("Not in Blocks OS IAM yet");
    expect(html).toContain('aria-label="Remove Billing desk from Desk Person"');
  });
});

describe("the IAM sync card", () => {
  it("platform admins check, sync and switch the source; the warning names the parity check", () => {
    const html = render(createElement(IamSyncCard, { status: status({ parity: { at: "2026-11-09T08:00:00.000Z", ok: false, mismatches: 2, url: "https://example.org/parity" } }), canCheck: true }), SUPER, null);
    expect(html).toContain("Connected");
    expect(html).toContain("3 differences");
    expect(html).toContain(">Check<");
    expect(html).toContain(">Sync now<");
    expect(html).toContain('role="radiogroup" aria-label="Where roles are managed"');
    expect(html).toContain("Parity check 9 Nov 2026");
    expect(html).toContain("2 differences found.");
    expect(html).toContain('href="https://example.org/parity"');
  });

  it("a roles manager who is not a platform admin may check but not sync or switch", () => {
    const html = render(createElement(IamSyncCard, { status: status({ canSync: false }), canCheck: true }), ROLES_DESK, null);
    expect(html).toContain(">Check<");
    expect(html).not.toContain(">Sync now<");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain("Syncing and changing where roles are managed is for platform admins.");
    expect(html).toContain("No parity check has run yet.");
  });

  it("IAM unavailable: said plainly, nothing out of step is claimed, Check and Sync now are disabled", () => {
    const down = status({ available: false, unavailable: "unreachable", counts: null, drift: null });
    const html = render(createElement(IamSyncCard, { status: down, canCheck: true }), SUPER, null);
    expect(html).toContain("Can&#x27;t be reached right now");
    expect(html).toContain("Unknown until IAM answers");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Check<\/button>/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Sync now<\/button>/s);
    const section = render(createElement(RolesSection), SUPER, { ...down, source: "iam" });
    expect(section).toContain("IAM can&#x27;t be reached");
  });
});

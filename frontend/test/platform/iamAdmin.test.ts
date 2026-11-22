// The IAM admin module (functions/_lib/iamAdmin.ts) over a fake of the IAM HTTP API: idempotent ensure helpers, a
// role's exact permission set, access grants that merge (IAM replaces a sent list), revokes that remove an emptied
// organization, and plain error codes.
import { describe, expect, it } from "vitest";
import {
  IamAdminError,
  createIamAdmin,
  orgRoleKeyOf,
  orgRoleSlug,
  platformRoleKeyOf,
  platformRoleSlug,
  workspaceMarker,
} from "../../functions/_lib/iamAdmin";
import { fakeIamSdk, seedIamUser } from "./fakeIamSdk";

function setup() {
  const fake = fakeIamSdk();
  let t = 1_000_000;
  const iam = createIamAdmin({ client: fake.client, now: () => t });
  return { ...fake, iam, tick: (ms: number) => (t += ms) };
}

describe("slugs", () => {
  it("map Factory keys to IAM role slugs and back", () => {
    expect(platformRoleSlug("billing-desk")).toBe("mf-platform-billing-desk");
    expect(platformRoleSlug("platform-admin")).toBe("mf-platform-admin");
    expect(platformRoleKeyOf("mf-platform-admin")).toBe("platform-admin");
    expect(platformRoleKeyOf("mf-platform-super-admin")).toBeNull();
    expect(platformRoleKeyOf("mf-platform-billing-desk")).toBe("billing-desk");
    expect(platformRoleKeyOf("mf-org-owner")).toBeNull();
    expect(orgRoleSlug("owner", "WS-1")).toBe("mf-org-owner");
    expect(orgRoleSlug("reviewer", "Ab-12_cd")).toBe("mf-org-ab12cd-reviewer");
    expect(orgRoleSlug("reviewer", "6F1A-23bc-9d8e")).toBe("mf-org-6f1a23bc-reviewer");
    expect(orgRoleKeyOf("mf-org-ab12cd-reviewer", "Ab-12_cd")).toBe("reviewer");
    expect(orgRoleKeyOf("mf-org-zzz-reviewer", "Ab-12_cd")).toBeNull();
    expect(orgRoleKeyOf("mf-org-viewer", "anything")).toBe("viewer");
  });
});

describe("permissions and roles", () => {
  it("ensurePermissions creates only the missing ones, each under its own madp-factory resource with a type", async () => {
    const t = setup();
    expect(await t.iam.ensurePermissions(["view", "comment"], (k) => `about ${k}`)).toEqual({ created: ["view", "comment"] });
    expect(await t.iam.ensurePermissions(["view", "comment", "share"])).toEqual({ created: ["share"] });
    expect(await t.iam.ensurePermissions(["view"])).toEqual({ created: [] });
    expect(t.state.perms.map((p) => [p.name, p.resource])).toEqual([["view", "madp-factory::organization::view"], ["comment", "madp-factory::organization::comment"], ["share", "madp-factory::organization::share"]]);
    expect(t.state.perms[0].description).toBe("about view");
  });

  it("upsertRole creates the role, sets exactly its permissions, and a second run changes nothing", async () => {
    const t = setup();
    const role = await t.iam.upsertRole({ slug: "mf-platform-desk", name: "Desk", description: "d", permissions: ["platform.audit.view", "platform.usage.view"] });
    expect(role).toMatchObject({ slug: "mf-platform-desk", name: "Desk" });
    expect(role.permissions.sort()).toEqual(["platform.audit.view", "platform.usage.view"]);
    const writes = () => t.state.calls.filter((c) => /create|update|assign/.test(c)).length;
    const before = writes();
    await t.iam.upsertRole({ slug: "mf-platform-desk", name: "Desk", description: "d", permissions: ["platform.usage.view", "platform.audit.view"] });
    expect(writes()).toBe(before);
    // A narrower set takes the dropped permission off; a rename updates the role.
    const narrower = await t.iam.upsertRole({ slug: "mf-platform-desk", name: "Desk 2", description: "d", permissions: ["platform.usage.view"] });
    expect(narrower.permissions).toEqual(["platform.usage.view"]);
    expect(t.state.roles[0].name).toBe("Desk 2");
    expect((await t.iam.getRole("mf-platform-desk"))?.permissions).toEqual(["platform.usage.view"]);
    expect(await t.iam.getRole("mf-platform-nobody")).toBeNull();
  });

  it("deleteRole takes every permission off and marks the role removed (IAM has no role delete)", async () => {
    const t = setup();
    await t.iam.upsertRole({ slug: "mf-org-abc-reviewer", name: "Reviewer", permissions: ["view"] });
    await t.iam.deleteRole("mf-org-abc-reviewer");
    const r = await t.iam.getRole("mf-org-abc-reviewer");
    expect(r?.permissions).toEqual([]);
    expect(r?.name).toBe("[removed] Reviewer");
    await t.iam.deleteRole("mf-org-missing");
  });
});

describe("organizations", () => {
  it("ensureOrganization reuses the linked or the marked organization and creates one only once", async () => {
    const t = setup();
    const a = await t.iam.ensureOrganization({ workspaceId: "ws-1", name: "Northwind" });
    const b = await t.iam.ensureOrganization({ workspaceId: "ws-1", name: "Northwind" });
    const c = await t.iam.ensureOrganization({ workspaceId: "ws-1", name: "Northwind", iamOrganizationId: a });
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(t.state.orgs).toHaveLength(1);
    expect(t.state.orgs[0].description).toContain(workspaceMarker("ws-1"));
    // A link to an organization that no longer exists falls back to the marker.
    expect(await t.iam.ensureOrganization({ workspaceId: "ws-1", name: "Northwind", iamOrganizationId: "gone" })).toBe(a);
  });
});

describe("access", () => {
  it("grant merges into the current lists; userAccess resolves the roles' permissions", async () => {
    const t = setup();
    seedIamUser(t.state, "u1", ["mf-user"]);
    await t.iam.upsertRole({ slug: "mf-platform-desk", name: "Desk", permissions: ["platform.audit.view"] });
    await t.iam.upsertRole({ slug: "mf-org-owner", name: "Owner", permissions: ["members.manage", "view"] });
    await t.iam.grant("u1", { roles: ["mf-platform-desk"] });
    await t.iam.grant("u1", { roles: ["mf-org-owner"], organizationId: "org-1" });
    expect(t.state.access.get("u1")!.default.roles).toEqual(["mf-user", "mf-platform-desk"]);
    const access = await t.iam.userAccess("u1", { organizationIds: ["org-1", "org-2"] });
    expect(access.platform.roles).toEqual(["mf-user", "mf-platform-desk"]);
    expect(access.platform.permissions).toEqual(["platform.audit.view"]);
    expect(access.orgs["org-1"]).toEqual({ roles: ["mf-org-owner"], permissions: ["members.manage", "view"] });
    expect(access.orgs["org-2"]).toEqual({ roles: [], permissions: [] });
    // Granting what is held writes nothing.
    const writes = t.state.calls.filter((c) => c === "users.updateAccess").length;
    await t.iam.grant("u1", { roles: ["mf-platform-desk"] });
    expect(t.state.calls.filter((c) => c === "users.updateAccess").length).toBe(writes);
  });

  it("revoke keeps the rest; an emptied organization is revoked as a whole; platform access is never emptied", async () => {
    const t = setup();
    await t.iam.upsertRole({ slug: "mf-org-owner", name: "Owner", permissions: ["view"] });
    await t.iam.upsertRole({ slug: "mf-org-viewer", name: "Viewer", permissions: ["view"] });
    seedIamUser(t.state, "u1", ["mf-user"], { "org-1": ["mf-org-owner", "mf-org-viewer"] });
    await t.iam.revoke("u1", { roles: ["mf-org-owner"], organizationId: "org-1" });
    expect(t.state.access.get("u1")!["org-1"].roles).toEqual(["mf-org-viewer"]);
    await t.iam.revoke("u1", { roles: ["mf-org-viewer"], organizationId: "org-1" });
    expect(t.state.access.get("u1")!["org-1"]).toBeUndefined();
    expect(t.state.calls).toContain("users.revokeAccess");
    await expect(t.iam.revoke("u1", { roles: ["mf-user"] })).rejects.toMatchObject({ code: "iam.forbidden" });
    expect(t.state.access.get("u1")!.default.roles).toEqual(["mf-user"]);
  });

  it("maps failures to plain codes", async () => {
    const t = setup();
    seedIamUser(t.state, "u1");
    t.state.failOn["users.get"] = { status: 503 };
    await expect(t.iam.userAccess("u1")).rejects.toMatchObject({ code: "iam.unavailable" });
    t.state.failOn["users.get"] = { status: 403 };
    await expect(t.iam.userAccess("u1")).rejects.toMatchObject({ code: "iam.forbidden" });
    t.state.failOn = {};
    await expect(t.iam.userAccess("nobody")).rejects.toMatchObject({ code: "iam.notFound" });
    t.state.failOn["roles.create"] = { refuse: true };
    const e = await t.iam.upsertRole({ slug: "mf-platform-x", name: "X", permissions: [] }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IamAdminError);
    expect((e as IamAdminError).code).toBe("iam.forbidden");
    expect(String((e as Error).message)).toBe("iam.forbidden");
    await expect(t.iam.upsertRole({ slug: "not-ours", name: "X", permissions: [] })).rejects.toMatchObject({ code: "iam.forbidden" });
  });

  it("caches the permission catalogue for a minute", async () => {
    const t = setup();
    await t.iam.ensurePermissions(["view"]);
    // A create drops the cache; the next read fills it again.
    await t.iam.listPermissions();
    const reads = () => t.state.calls.filter((c) => c === "permissions.list").length;
    const n = reads();
    await t.iam.listPermissions();
    await t.iam.listPermissions();
    expect(reads()).toBe(n);
    t.tick(61_000);
    await t.iam.listPermissions();
    expect(reads()).toBe(n + 1);
  });
});

// Fixtures in today's shapes: Factory RBAC rows as the Data Gateway returns them, and an in-memory Blocks IAM behind
// iam-core's IamAdminApi (organization calls refused while multi-organization mode is off, as on today's tenant).
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import { matches, type Filter } from "../../functions/_lib/filter";
import { IamAdminError, type IamAccessSet, type IamOrganization, type IamPermission, type IamRole } from "../../functions/_lib/iamAdmin";
import type { IamAdminPort } from "../../server/iam/migrate/apply";
import { FACTORY_RESOURCE_GROUP, sortedUnique, workspaceMarker, type IamUserAccess } from "../../server/iam/migrate/model";

export const WS_A = "a1b2c3d4-0000-4000-8000-00000000000a";
export const WS_B = "b5c6d7e8-0000-4000-8000-00000000000b";

/** Today's Factory rows (PlatformRole, PlatformRoleAssignment, Workspace, WorkspaceRole, Membership). */
export function factoryRows(): Record<string, Row[]> {
  return {
    PlatformRole: [
      { ItemId: "pr1", Key: "billing-desk", Name: "Billing desk", Description: "Plans and credit", Permissions: ["platform.billing.manage"], IsBuiltIn: false },
      { ItemId: "pr2", Key: "people-desk", Name: "People desk", Description: "", Permissions: ["platform.people.manage", "platform.workspaces.manage"], IsBuiltIn: false, Scope: "platform" },
      { ItemId: "pr3", Key: "reviewer", Name: "Reviewer", Description: "Reads and approves", Permissions: ["view", "comment", "release.approve"], IsBuiltIn: false, Scope: "organization" },
    ],
    PlatformRoleAssignment: [
      { ItemId: "pa1", UserId: "u-admin", RoleKey: "platform-admin", Status: "active" },
      { ItemId: "pa2", UserId: "u-bill", RoleKey: "billing-desk", Status: "active" },
      { ItemId: "pa3", UserId: "u-old", RoleKey: "billing-desk", Status: "revoked" },
      { ItemId: "pa4", UserId: "u-people", RoleKey: "people-desk", Status: "active" },
      { ItemId: "pa5", UserId: "u-bill", RoleKey: "gone-role", Status: "active" },
    ],
    Workspace: [
      { ItemId: "w1", WorkspaceId: WS_A, Name: "Acme", Status: "active" },
      { ItemId: "w2", WorkspaceId: WS_B, Name: "Beta", Status: "suspended" },
    ],
    WorkspaceRole: [
      { ItemId: "wr0", WorkspaceId: WS_A, Key: "owner", Name: "Workspace admin", Description: "", Permissions: [], IsBuiltIn: true },
      { ItemId: "wr1", WorkspaceId: WS_A, Key: "qa", Name: "QA", Description: "Tests builds", Permissions: ["view", "comment", "build.run"], IsBuiltIn: false },
      { ItemId: "wr2", WorkspaceId: WS_B, Key: "qa", Name: "QA", Description: "", Permissions: ["view"], IsBuiltIn: false },
    ],
    Membership: [
      { ItemId: "m1", WorkspaceId: WS_A, UserId: "u-owner", RoleKey: "owner", Status: "active" },
      { ItemId: "m2", WorkspaceId: WS_A, UserId: "u-mem", RoleKey: "member", Status: "active" },
      { ItemId: "m3", WorkspaceId: WS_A, UserId: "u-qa", RoleKey: "qa", Status: "active" },
      { ItemId: "m4", WorkspaceId: WS_B, UserId: "u-mem", RoleKey: "viewer", Status: "active" },
      { ItemId: "m5", WorkspaceId: WS_A, UserId: "u-gone", RoleKey: "member", Status: "removed" },
      { ItemId: "m6", WorkspaceId: WS_A, UserId: "u-ghost", RoleKey: "ghost", Status: "active" },
      { ItemId: "m7", WorkspaceId: WS_B, UserId: "u-qa", RoleKey: "qa", Status: "suspended" },
      { ItemId: "m8", WorkspaceId: WS_B, UserId: "u-admin", RoleKey: "owner", Status: "active" },
    ],
  };
}

/** A Data Gateway over rows; `unknownFields` are refused like a schema without them. */
export function fakeRaw(rows: Record<string, Row[]>, o: { unknownFields?: Record<string, string[]> } = {}): RawGateway & { rows: Record<string, Row[]> } {
  const project = (r: Row, fields: readonly string[]) => Object.fromEntries(fields.filter((k) => k in r).map((k) => [k, r[k]]));
  const check = (schema: string, fields: readonly string[]) => {
    const bad = fields.filter((x) => (o.unknownFields?.[schema] ?? []).includes(x));
    if (bad.length) throw new Error(`The field ${bad[0]} does not exist`);
  };
  const gw: RawGateway & { rows: Record<string, Row[]> } = {
    rows,
    async get(schema, itemId, fields) {
      const r = (rows[schema] ?? []).find((x) => x.ItemId === itemId);
      return r ? project(r, fields) : null;
    },
    async find(schema, opts) {
      check(schema, opts.fields);
      const items = (rows[schema] ?? []).filter((r) => matches(opts.where as Filter, r)).map((r) => project(r, opts.fields));
      return { items, totalCount: items.length };
    },
    async findAll(schema, opts) {
      return (await gw.find(schema, { ...opts })).items;
    },
    async insert(schema, row) {
      const list = (rows[schema] ??= []);
      const had = list.find((r) => row.RequestKey && r.RequestKey === row.RequestKey);
      if (had) return { created: false, itemId: String(had.ItemId) };
      const itemId = `${schema}-${list.length + 1}`;
      list.push({ ...row, ItemId: itemId });
      return { created: true, itemId };
    },
    async insertMany() {
      throw new Error("not used");
    },
    async update(schema, itemId, patch) {
      check(schema, Object.keys(patch));
      const r = (rows[schema] ?? []).find((x) => x.ItemId === itemId);
      if (!r) throw new Error("not found");
      Object.assign(r, patch);
    },
    async updateMany() {
      throw new Error("not used");
    },
    async remove() {
      throw new Error("not used");
    },
  };
  return gw;
}

/**
 * An in-memory IAM with today's tenant (Blocks permissions, the four existing roles, no organizations) behind iam-core's
 * IamAdminApi semantics: grant adds to what the person holds, revoke takes away (an emptied organization drops the
 * access), userAccess answers the asked organizations with resolved permissions (direct + via roles).
 */
export function fakeIam(o: { multiOrg?: boolean } = {}) {
  let multiOrg = o.multiOrg ?? false;
  const perms: IamPermission[] = [
    { id: "p-blocks-1", name: "Create Data Source", resource: "blocks-data::configuration::create-data-source", description: "", roles: ["clouduser"] },
    { id: "p-blocks-2", name: "Users", resource: "blocks-iam::iam::users", description: "", roles: ["clouduser", "mf-super-admin"] },
  ];
  const roles = new Map<string, { id: string; slug: string; name: string; description: string }>(
    [
      ["clouduser", "System User"],
      ["mf-super-admin", "MADP Factory super admin"],
      ["mf-user", "MADP Factory user"],
      ["mf-service", "MADP Factory service"],
    ].map(([slug, name]) => [slug, { id: `r-${slug}`, slug, name, description: "" }]),
  );
  const orgs: IamOrganization[] = [];
  /** userId -> orgId ("default" = platform) -> raw roles and direct permissions. */
  const users = new Map<string, Map<string, { roles: string[]; permissions: string[] }>>();
  const calls: string[] = [];
  let seq = 0;
  const userOrg = (userId: string, org: string) => {
    const u = users.get(userId) ?? new Map<string, { roles: string[]; permissions: string[] }>();
    users.set(userId, u);
    const set = u.get(org) ?? { roles: [], permissions: [] };
    u.set(org, set);
    return set;
  };
  const needMultiOrg = () => {
    if (!multiOrg) throw new IamAdminError("iam.forbidden");
  };
  const resolved = (set: { roles: string[]; permissions: string[] } | undefined): IamAccessSet => ({
    roles: sortedUnique(set?.roles ?? []),
    permissions: sortedUnique([...(set?.permissions ?? []), ...perms.filter((p) => p.roles.some((r) => (set?.roles ?? []).includes(r))).map((p) => p.name)]),
  });
  const roleOf = (slug: string): IamRole => {
    const r = roles.get(slug) as { id: string; slug: string; name: string; description: string };
    return { ...r, permissions: perms.filter((p) => p.roles.includes(slug)).map((p) => p.name) };
  };

  const port: IamAdminPort = {
    async listPermissions() {
      return perms.map((p) => ({ ...p, roles: [...p.roles] }));
    },
    async ensurePermissions(keys, describe) {
      calls.push(`ensurePermissions ${keys.length}`);
      const created: string[] = [];
      for (const key of keys) {
        if (perms.some((p) => p.name === key)) continue;
        perms.push({ id: `p-${++seq}`, name: key, resource: FACTORY_RESOURCE_GROUP, description: describe?.(key) ?? key, roles: [] });
        created.push(key);
      }
      return { created };
    },
    async listRoles() {
      return [...roles.keys()].map(roleOf);
    },
    async getRole(slug) {
      return roles.has(slug) ? roleOf(slug) : null;
    },
    async upsertRole(role) {
      calls.push(`upsertRole ${role.slug}`);
      const had = roles.get(role.slug);
      roles.set(role.slug, { id: had?.id ?? `r-${++seq}`, slug: role.slug, name: role.name, description: role.description ?? "" });
      await port.ensurePermissions(role.permissions);
      calls.pop();
      for (const p of perms.filter((x) => x.resource === FACTORY_RESOURCE_GROUP)) {
        const want = role.permissions.includes(p.name);
        const has = p.roles.includes(role.slug);
        if (want && !has) p.roles.push(role.slug);
        if (!want && has) p.roles = p.roles.filter((s) => s !== role.slug);
      }
      return roleOf(role.slug);
    },
    async deleteRole() {
      throw new Error("not used");
    },
    async listOrganizations() {
      needMultiOrg();
      return orgs.map((x) => ({ ...x }));
    },
    async ensureOrganization({ workspaceId, name }) {
      needMultiOrg();
      calls.push(`ensureOrganization ${workspaceId}`);
      const found = orgs.find((x) => x.description.includes(workspaceMarker(workspaceId)));
      if (found) return found.id;
      const id = `org-${++seq}`;
      orgs.push({ id, name, description: `MADP Factory organization ${workspaceMarker(workspaceId)}` });
      return id;
    },
    async userAccess(userId, opts) {
      const u = users.get(userId);
      const out: IamUserAccess = { platform: resolved(u?.get("default")), orgs: {} };
      for (const id of opts?.organizationIds ?? []) out.orgs[id] = resolved(u?.get(id));
      return out;
    },
    async grant(userId, g) {
      if (g.organizationId) needMultiOrg();
      calls.push(`grant ${userId} ${g.organizationId ?? "platform"} ${(g.roles ?? []).join(",")}`);
      const set = userOrg(userId, g.organizationId ?? "default");
      set.roles = sortedUnique([...set.roles, ...(g.roles ?? [])]);
      set.permissions = sortedUnique([...set.permissions, ...(g.permissions ?? [])]);
    },
    async revoke(userId, g) {
      calls.push(`revoke ${userId} ${g.organizationId ?? "platform"} ${(g.roles ?? []).join(",")}`);
      const set = userOrg(userId, g.organizationId ?? "default");
      set.roles = set.roles.filter((r) => !(g.roles ?? []).includes(r));
      if (!set.roles.length && !g.organizationId) throw new IamAdminError("iam.forbidden");
      if (!set.roles.length && g.organizationId) users.get(userId)?.delete(g.organizationId);
    },
    async listUserIds() {
      return [...users.keys()].sort();
    },
    async multiOrgEnabled() {
      return multiOrg;
    },
  };

  return {
    port,
    calls,
    orgs,
    perms,
    /** Seeds a user's current roles ("default" = platform). */
    give(userId: string, org: string, list: string[]) {
      userOrg(userId, org).roles.push(...list);
    },
    enableMultiOrg() {
      multiOrg = true;
    },
  };
}

/** Today's IAM users: everyone holds mf-user platform-wide; u-super is the super admin (no Factory rows). */
export function todaysIam(o: { multiOrg?: boolean } = {}) {
  const iam = fakeIam(o);
  for (const u of ["u-admin", "u-bill", "u-old", "u-people", "u-owner", "u-mem", "u-qa", "u-gone", "u-ghost", "u-super"]) iam.give(u, "default", ["mf-user"]);
  iam.give("u-super", "default", ["mf-super-admin"]);
  return iam;
}

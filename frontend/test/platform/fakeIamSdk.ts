// A fake of the Blocks IAM HTTP API as the SDK client exposes it (permissions, roles, organizations, users access),
// with IAM's own semantics where the module relies on them: /users/access replaces a sent list and keeps an empty one,
// revoke-access removes a whole organization, a permission lists its roles. Every call is recorded; `failOn` makes a
// method throw (status) or answer a refusal.
import type { SdkClient } from "../../functions/_lib/sdk";

type AccessSet = { roles: string[]; permissions: string[] };
export interface FakeIamState {
  perms: { itemId: string; name: string; resource: string; description: string; roles: string[] }[];
  roles: { itemId: string; slug: string; name: string; description: string }[];
  orgs: { itemId: string; name: string; description: string }[];
  /** userId -> organization id ("default" = platform) -> access. */
  access: Map<string, Record<string, AccessSet>>;
  calls: string[];
  failOn: Record<string, { status?: number; refuse?: boolean }>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function fakeIamSdk() {
  const state: FakeIamState = { perms: [], roles: [], orgs: [], access: new Map(), calls: [], failOn: {} };
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const rec =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R | Record<string, unknown>> => {
      state.calls.push(name);
      const f = state.failOn[name] ?? state.failOn["*"];
      if (f?.refuse) return { isSuccess: false, errors: { request: "Refused." } };
      if (f) throw Object.assign(new Error(`HTTP ${f.status ?? 503}`), { status: f.status ?? 503 });
      return fn(...a);
    };
  const userOf = (uid: string) => {
    let a = state.access.get(uid);
    if (!a) {
      a = {};
      state.access.set(uid, a);
    }
    return a;
  };
  const iam = {
    permissions: {
      list: rec("permissions.list", async (q: { page?: number; pageSize?: number }) => {
        const page = q.page ?? 0;
        const size = q.pageSize ?? 20;
        return { data: clone(state.perms.slice(page * size, (page + 1) * size)), totalCount: state.perms.length };
      }),
      create: rec("permissions.create", async (b: { name: string; resource: string; description: string }) => {
        if (state.perms.some((p) => p.name === b.name)) return { isSuccess: false, errors: { name: "Already exists." } };
        state.perms.push({ itemId: id("perm"), name: b.name, resource: b.resource, description: b.description, roles: [] });
        return { isSuccess: true };
      }),
    },
    roles: {
      list: rec("roles.list", async (q: { filter?: { slugs?: string[] }; page?: number; pageSize?: number }) => {
        const rows = q.filter?.slugs ? state.roles.filter((r) => q.filter!.slugs!.includes(r.slug)) : state.roles;
        const page = q.page ?? 0;
        const size = q.pageSize ?? 20;
        return { data: clone(rows.slice(page * size, (page + 1) * size)), totalCount: rows.length };
      }),
      create: rec("roles.create", async (b: { slug: string; name: string; description: string }) => {
        if (state.roles.some((r) => r.slug === b.slug)) return { isSuccess: false, errors: { slug: "Already exists." } };
        state.roles.push({ itemId: id("role"), slug: b.slug, name: b.name, description: b.description });
        return { isSuccess: true };
      }),
      update: rec("roles.update", async (b: { itemId: string; name: string; description: string }) => {
        const r = state.roles.find((x) => x.itemId === b.itemId);
        if (!r) return { isSuccess: false, errors: { itemId: "Role not found." } };
        r.name = b.name;
        r.description = b.description;
        return { isSuccess: true };
      }),
      assignPermissions: rec("roles.assignPermissions", async (b: { slug: string; addPermissions?: string[]; removePermissions?: string[] }) => {
        for (const pid of b.addPermissions ?? []) {
          const p = state.perms.find((x) => x.itemId === pid);
          if (!p) return { isSuccess: false, errors: { addPermissions: "Permission not found." } };
          if (!p.roles.includes(b.slug)) p.roles.push(b.slug);
        }
        for (const pid of b.removePermissions ?? []) {
          const p = state.perms.find((x) => x.itemId === pid);
          if (p) p.roles = p.roles.filter((r) => r !== b.slug);
        }
        return { isSuccess: true };
      }),
    },
    organizations: {
      list: rec("organizations.list", async (q: { Page?: number; PageSize?: number }) => {
        const page = q.Page ?? 0;
        const size = q.PageSize ?? 20;
        return { organizations: clone(state.orgs.slice(page * size, (page + 1) * size)), totalCount: state.orgs.length };
      }),
      get: rec("organizations.get", async (oid: string) => {
        const o = state.orgs.find((x) => x.itemId === oid);
        if (!o) throw Object.assign(new Error("HTTP 404"), { status: 404 });
        return { data: clone(o) };
      }),
      create: rec("organizations.create", async (b: { name: string; description: string }) => {
        const o = { itemId: id("org"), name: b.name, description: b.description };
        state.orgs.push(o);
        return { isSuccess: true, itemId: o.itemId };
      }),
    },
    users: {
      get: rec("users.get", async (uid: string, opt?: { organizationId?: string }) => {
        if (!state.access.has(uid)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
        const s = userOf(uid)[opt?.organizationId ?? "default"] ?? { roles: [], permissions: [] };
        return { data: { itemId: uid, roles: [...s.roles], permissions: [...s.permissions], ...(opt?.organizationId ? { organizationId: opt.organizationId } : {}) } };
      }),
      updateAccess: rec("users.updateAccess", async (b: { userId: string; organizationId?: string; roles?: string[]; permissions?: string[] }) => {
        if (!state.access.has(b.userId)) return { isSuccess: false, errors: { userId: "User not found." } };
        for (const r of b.roles ?? []) if (!state.roles.some((x) => x.slug === r) && !r.startsWith("mf-user") && r !== "mf-super-admin") return { isSuccess: false, errors: { roles: "Role not found." } };
        const a = userOf(b.userId);
        const s = (a[b.organizationId ?? "default"] ??= { roles: [], permissions: [] });
        if (b.roles?.length) s.roles = [...b.roles];
        if (b.permissions?.length) s.permissions = [...b.permissions];
        return { isSuccess: true };
      }),
      revokeAccess: rec("users.revokeAccess", async (b: { userId: string; organizationId?: string }) => {
        delete userOf(b.userId)[b.organizationId ?? "default"];
        return { isSuccess: true };
      }),
    },
  };
  return { state, iam, client: async () => ({ iam }) as unknown as SdkClient };
}

/** Seeds an IAM user with platform roles (and optional organization roles). */
export function seedIamUser(state: FakeIamState, userId: string, platformRoles: string[] = ["mf-user"], orgs: Record<string, string[]> = {}): void {
  const a: Record<string, AccessSet> = { default: { roles: [...platformRoles], permissions: [] } };
  for (const [org, roles] of Object.entries(orgs)) a[org] = { roles: [...roles], permissions: [] };
  state.access.set(userId, a);
}

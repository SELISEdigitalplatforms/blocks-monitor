// The workspace store follows the session while it runs, not only at sign-in: the super admin flag granted or removed
// changes the workspace list (kept on screen until the new one has come), my role in it and the platform permissions; a
// new name shows at once; me.access (read-only) brings the platform permissions of the roles I hold now. The account
// button's role line and the permission checks read that same session and store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  access: { ok: true as boolean, platformPermissions: [] as string[] },
  accessCalls: 0,
  bootstrapPermissions: [] as string[],
}));

type W = { op: "eq"; field: string; value: unknown } | { op: "in"; field: string; values: unknown[] } | { op: "and"; clauses: W[] };
vi.mock("../../src/blocks/data/gql", async (orig) => {
  const real = await orig<typeof import("../../src/blocks/data/gql")>();
  const match = (row: Record<string, unknown>, w?: W): boolean =>
    !w ? true : w.op === "eq" ? row[w.field] === w.value : w.op === "in" ? w.values.includes(row[w.field]) : w.clauses.every((c) => match(row, c));
  const list = async (schema: string, o: { where?: W } = {}) => (db.rows[schema] ?? []).filter((r) => match(r, o.where)).map((r) => ({ ...r }));
  return {
    ...real,
    queryList: list,
    queryPage: async (schema: string, o: { where?: W; pageSize?: number } = {}) => {
      const items = await list(schema, o);
      return { items, totalCount: items.length, page: 1, pageSize: o.pageSize ?? 50, hasNextPage: false };
    },
  };
});
vi.mock("../../src/blocks/workspaces/ops", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/workspaces/ops")>()),
  bootstrapMe: async () => ({
    ok: true,
    value: { account: { userId: "u-1", email: "ada@example.org", displayName: "Ada Lovelace", status: "active" }, platformPermissions: db.bootstrapPermissions },
  }),
  readMyAccess: async () => {
    db.accessCalls += 1;
    return db.access.ok
      ? { ok: true, value: { isSuperAdmin: false, platformPermissions: [...db.access.platformPermissions], platformRoleKeys: [] } }
      : { ok: false, error: "We couldn't load your workspaces. Try again in a moment." };
  },
}));

import { useSession, type BlocksProfile } from "../../src/blocks/session";
import { refreshAccess, startWorkspaceSync, stopWorkspaceSync } from "../../src/blocks/workspaces/sync";
import { useWorkspaces } from "../../src/blocks/workspaces/store";
import { meKeys } from "../../src/blocks/workspaces/queries";
import { queryClient } from "../../src/blocks/queryClient";
import { platformAccessFrom } from "../../src/blocks/admin";
import { hasPlatformAccess } from "../../src/blocks/guard";
import { accountRoleLine } from "../../src/components/roles/permissionText";
import { PLATFORM_PERMISSIONS } from "../../src/domain/rbac";

const PROFILE: BlocksProfile = {
  userId: "u-1", email: "ada@example.org", firstName: "Ada", lastName: "Lovelace", displayName: "Ada Lovelace", roles: ["mf-user"], permissions: [], isSuperAdmin: false,
};

const ids = () => useWorkspaces.getState().workspaces.map((w) => w.id);
/** What the account button and the platform checks read: the session profile and the store, as the shell does. */
function screen() {
  const profile = useSession.getState().profile!;
  const s = useWorkspaces.getState();
  const workspace = s.workspaces.find((w) => w.id === s.workspaceId) ?? null;
  const roleKey = workspace ? (s.me?.workspaceId === workspace.id ? s.me.roleKey : workspace.roleKey) : null;
  const access = platformAccessFrom({
    isSuperAdmin: profile.isSuperAdmin, userId: profile.userId, email: profile.email, assignments: [], roles: [], settled: true, storePermissions: s.platformPermissions,
  });
  return {
    roleLine: accountRoleLine({ isSuperAdmin: profile.isSuperAdmin, ready: s.ready, roleKey, customRoles: s.customRoles }),
    platform: hasPlatformAccess(access),
    permissions: access.permissions,
    name: s.me?.name ?? null,
  };
}

async function signIn(profile: BlocksProfile = PROFILE) {
  startWorkspaceSync();
  useSession.setState({ status: "signed-in", profile, notice: null });
  await vi.waitFor(() => {
    const s = useWorkspaces.getState();
    expect(s.ready && !s.bootstrapPending && s.workspaceId === "ws-a" && s.me !== null).toBe(true);
  });
}

const setProfile = (p: Partial<BlocksProfile>) => useSession.setState({ profile: { ...useSession.getState().profile!, ...p } });
const observers = (key: readonly unknown[]) => queryClient.getQueryCache().findAll({ queryKey: key }).reduce((n, q) => n + q.getObserversCount(), 0);

beforeEach(() => {
  db.rows = {
    Workspace: [
      { ItemId: "ws-a", Name: "Acme", Status: "active", CreatedDate: "2026-11-01T00:00:00Z" },
      { ItemId: "ws-b", Name: "Beta", Status: "active", CreatedDate: "2026-11-02T00:00:00Z" },
    ],
    Membership: [{ ItemId: "m-1", WorkspaceId: "ws-a", UserId: "u-1", Email: "ada@example.org", DisplayName: "", RoleKey: "member", Status: "active" }],
  };
  db.access = { ok: true, platformPermissions: [] };
  db.accessCalls = 0;
  db.bootstrapPermissions = [];
});

afterEach(() => {
  stopWorkspaceSync();
  useSession.setState({ status: "restoring", profile: null, notice: null });
  queryClient.clear();
});

describe("the workspace store follows the session profile", () => {
  it("a super admin role granted during the session: the flag, every permission, then every workspace, without losing the open one", async () => {
    await signIn();
    expect(screen()).toMatchObject({ roleLine: "Member", platform: false, permissions: [] });
    expect(ids()).toEqual(["ws-a"]);

    setProfile({ isSuperAdmin: true, roles: ["mf-user", "mf-super-admin"] });
    // at once: the flag and every platform permission; the list still on screen while every workspace is read
    expect(useWorkspaces.getState().isSuperAdmin).toBe(true);
    expect(useWorkspaces.getState().platformPermissions).toEqual([...PLATFORM_PERMISSIONS]);
    expect(ids()).toEqual(["ws-a"]);
    expect(useWorkspaces.getState().workspaceId).toBe("ws-a");
    expect(screen()).toMatchObject({ roleLine: "Super admin", platform: true });

    await vi.waitFor(() => expect(ids()).toEqual(["ws-a", "ws-b"]));
    expect(useWorkspaces.getState().workspaceId).toBe("ws-a");
    // the member list's read is dropped once every workspace has come
    expect(observers([...meKeys.workspaces("u-1"), ["ws-a"]])).toBe(0);
    expect(observers([...meKeys.workspaces("u-1"), "all"])).toBe(1);
  });

  it("a super admin role removed: the flag at once, the permissions of the roles still held, my own workspaces only", async () => {
    db.bootstrapPermissions = [];
    await signIn({ ...PROFILE, isSuperAdmin: true, roles: ["mf-user", "mf-super-admin"] });
    await vi.waitFor(() => expect(ids()).toEqual(["ws-a", "ws-b"]));
    expect(screen()).toMatchObject({ roleLine: "Super admin", platform: true });

    db.access = { ok: true, platformPermissions: ["platform.usage.view"] };
    setProfile({ isSuperAdmin: false, roles: ["mf-user"] });
    expect(useWorkspaces.getState().isSuperAdmin).toBe(false);
    // never every permission for a moment longer: none until me.access answers
    expect(useWorkspaces.getState().platformPermissions).not.toContain("platform.billing.manage");
    expect(ids()).toEqual(["ws-a"]);
    expect(screen().roleLine).toBe("Member");

    await vi.waitFor(() => expect(useWorkspaces.getState().platformPermissions).toEqual(["platform.usage.view"]));
    expect(db.accessCalls).toBe(1);
    expect(screen()).toMatchObject({ roleLine: "Member", platform: true, permissions: ["platform.usage.view"] });
    await vi.waitFor(() => expect(observers([...meKeys.workspaces("u-1"), "all"])).toBe(0));
    expect(ids()).toEqual(["ws-a"]);
  });

  it("a new name shows at once on my own row", async () => {
    await signIn();
    expect(screen().name).toBe("Ada Lovelace");
    setProfile({ displayName: "Ada King", lastName: "King" });
    expect(screen().name).toBe("Ada King");
  });

  it("the same profile read again changes nothing", async () => {
    await signIn();
    const before = useWorkspaces.getState();
    setProfile({});
    expect(useWorkspaces.getState().workspaces).toBe(before.workspaces);
    expect(useWorkspaces.getState().me).toBe(before.me);
    expect(db.accessCalls).toBe(0);
  });
});

describe("refreshAccess (me.access)", () => {
  it("brings a platform role granted or removed during the session, and reads the role list again when it changed", async () => {
    await signIn();
    expect(screen().platform).toBe(false);
    queryClient.setQueryData(meKeys.admin("u-1", "platformRole.list"), { roles: [], templates: [], assignments: [] });

    db.access = { ok: true, platformPermissions: ["platform.audit.view", "not.a.permission"] };
    expect(await refreshAccess()).toBe(true);
    expect(useWorkspaces.getState().platformPermissions).toEqual(["platform.audit.view"]);
    expect(screen()).toMatchObject({ platform: true, permissions: ["platform.audit.view"] });
    expect(queryClient.getQueryState(meKeys.admin("u-1", "platformRole.list"))?.isInvalidated).toBe(true);

    // the same answer again: nothing changes, the role list is not read again
    queryClient.setQueryData(meKeys.admin("u-1", "platformRole.list"), { roles: [], templates: [], assignments: [] });
    const held = useWorkspaces.getState().platformPermissions;
    expect(await refreshAccess()).toBe(true);
    expect(useWorkspaces.getState().platformPermissions).toBe(held);
    expect(queryClient.getQueryState(meKeys.admin("u-1", "platformRole.list"))?.isInvalidated).toBe(false);

    db.access = { ok: true, platformPermissions: [] };
    await refreshAccess();
    expect(screen()).toMatchObject({ platform: false, permissions: [] });
  });

  it("keeps what is there when the read fails, and reads one at a time", async () => {
    db.bootstrapPermissions = ["platform.audit.view"];
    await signIn();
    expect(useWorkspaces.getState().platformPermissions).toEqual(["platform.audit.view"]);
    db.access = { ok: false, platformPermissions: [] };
    expect(await refreshAccess()).toBe(false);
    expect(useWorkspaces.getState().platformPermissions).toEqual(["platform.audit.view"]);
    db.access = { ok: true, platformPermissions: [] };
    const a = refreshAccess();
    const b = refreshAccess();
    expect(a).toBe(b);
    await a;
    expect(db.accessCalls).toBe(2);
  });

  it("reads nothing before the sign-in's own bootstrap or while signed out", async () => {
    expect(await refreshAccess()).toBe(false);
    expect(db.accessCalls).toBe(0);
  });
});

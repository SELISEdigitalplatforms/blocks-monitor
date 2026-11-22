import { describe, expect, it, vi } from "vitest";
import { memberInvite } from "../../functions/workspace/ops/member/invite";
import { meBootstrap } from "../../functions/workspace/ops/me/bootstrap";
import { workspaceCreate } from "../../functions/workspace/ops/workspace/create";
import { memberSetRole } from "../../functions/workspace/ops/member/setRole";
import { memberRemove } from "../../functions/workspace/ops/member/remove";
import { SCHEMA } from "../../functions/workspace/ops/_shared/records";
import type { Filter, Gateway, IamAdmin, OpCtx, OpDeps } from "../../functions/workspace/ops/_shared/ports";

type Row = Record<string, unknown>;
function fixture(result: Awaited<ReturnType<IamAdmin["exists"]>>) {
  const rows: Record<string, Row[]> = {
    [SCHEMA.platformSetting]: [{ ItemId: "domains", Key: "allowed-email-domains", Values: ["example.org"] }],
    [SCHEMA.workspace]: [{ ItemId: "ws", Name: "Workspace", Status: "active", ReaderIds: ["owner"] }],
    [SCHEMA.membership]: [{ ItemId: "owner-member", WorkspaceId: "ws", UserId: "owner", Email: "owner@example.org", RoleKey: "owner", Status: "active" }],
  };
  const matches = (row: Row, filter: Filter) => Object.entries(filter).every(([key, value]) =>
    typeof value === "object" ? ("in" in value ? value.in.includes(row[key] as string) : "ne" in value ? row[key] !== value.ne : true) : row[key] === value);
  const select = (schema: string, filter: Filter) => {
    if (schema === SCHEMA.account) throw new Error("Account mirror accessed");
    return (rows[schema] ?? []).filter(row => matches(row, filter));
  };
  let id = 0;
  const keyed = new Map<string, Row>();
  const gateway: Gateway = {
    async list<T>(schema: string, q: Parameters<Gateway["list"]>[1]) { const all = select(schema, q.filter); return { items: all.slice(0, q.pageSize ?? all.length) as T[], totalCount: all.length }; },
    async listAll<T>(schema: string, q: Parameters<Gateway["listAll"]>[1]) { return select(schema, q.filter) as T[]; },
    async insertOnce<T>(schema: string, row: Record<string, unknown>, key: string) {
      select(schema, {});
      const old = keyed.get(key);
      const item = old ?? { ...row, ItemId: `row-${++id}` };
      if (!old) { (rows[schema] ??= []).push(item); keyed.set(key, item); }
      return { item: item as T & { ItemId: string }, created: !old };
    },
    async update(schema, itemId, set) { Object.assign(select(schema, {}).find(row => row.ItemId === itemId)!, set); },
    async updateMany() { return 0; },
    async remove() { throw new Error("Unexpected remove"); },
  };
  const exists = vi.fn().mockResolvedValue(result);
  const createUser = vi.fn().mockRejectedValue(new Error("Must never provision"));
  const deps: OpDeps = {
    identitySource: "iam", gateway,
    iam: { exists, createUser } as unknown as IamAdmin,
    clock: { now: () => "2026-10-28T12:00:00.000Z", sleep: async () => {} },
    acl: { restamp: vi.fn().mockResolvedValue({ schemas: [], rows: 0 }) },
    access: { platformHolders: async () => ["admin"] },
  };
  const ctx: OpCtx = { context: { isAuthenticated: true, userId: "owner", email: "owner@example.org", displayName: "Owner" }, requestId: "invite-1", op: "member.invite" };
  return { rows, deps, ctx, exists, createUser };
}

describe("IAM workspace membership", () => {
  it("creates a workspace with the caller as owner and is idempotent", async () => {
    const f = fixture({ ok: true, userId: "unused" });
    f.rows[SCHEMA.workspace] = [];
    f.rows[SCHEMA.membership] = [];
    const ctx = { ...f.ctx, op: "workspace.create", requestId: "workspace-create-1" };
    const first = await workspaceCreate(ctx, { name: "Test workspace" }, f.deps);
    const retry = await workspaceCreate(ctx, { name: "Test workspace" }, f.deps);
    expect(first).toMatchObject({ ok: true, data: { workspace: { Name: "Test workspace", Status: "active" }, membership: { UserId: "owner", RoleKey: "owner", Status: "active" } } });
    expect(retry).toMatchObject({ ok: true, data: { workspace: { Name: "Test workspace" }, membership: { UserId: "owner", RoleKey: "owner" } } });
    expect(f.rows[SCHEMA.workspace]).toHaveLength(1);
    expect(f.rows[SCHEMA.membership]).toHaveLength(1);
  });
  it("invites an existing IAM user and accepts by verified email without Account access", async () => {
    const f = fixture({ ok: true, userId: "invitee" });
    const invited = await memberInvite(f.ctx, { workspaceId: "ws", email: "invitee@example.org", roleKey: "member" }, f.deps);
    expect(invited).toMatchObject({ ok: true, data: { path: "invite", membership: { UserId: "invitee", Status: "invited" } } });
    expect(f.exists).toHaveBeenCalledWith("invitee@example.org");
    expect(f.createUser).not.toHaveBeenCalled();
    const boot = await meBootstrap({ context: { isAuthenticated: true, userId: "invitee", email: "invitee@example.org", displayName: "Invitee" }, requestId: "bootstrap-1", op: "me.bootstrap" }, {}, f.deps);
    expect(boot).toMatchObject({ ok: true, data: { account: { userId: "invitee", displayName: "Invitee" }, accepted: [{ workspaceId: "ws" }] } });
    expect(f.rows[SCHEMA.invitation][0].Status).toBe("accepted");
    expect(f.deps.acl.restamp).toHaveBeenCalled();
    const membershipId = String(f.rows[SCHEMA.membership].find(row => row.UserId === "invitee")?.ItemId);
    expect(await memberSetRole({ ...f.ctx, op: "member.setRole", requestId: "role-1" }, { workspaceId: "ws", membershipId, roleKey: "viewer" }, f.deps)).toMatchObject({ ok: true, data: { membership: { RoleKey: "viewer" } } });
    expect(await memberRemove({ ...f.ctx, op: "member.remove", requestId: "remove-1" }, { workspaceId: "ws", membershipId }, f.deps)).toMatchObject({ ok: true, data: { membership: { Status: "removed" }, readerCount: 1 } });
    expect(f.rows[SCHEMA.workspace][0].ReaderIds).toEqual(["owner"]);
  });
  it.each([{ ok: true as const, userId: null }, { ok: false as const, status: 403, errors: {} }])("uses access requests for missing or permission-denied IAM lookups", async result => {
    const f = fixture(result);
    expect(await memberInvite(f.ctx, { workspaceId: "ws", email: "invitee@example.org", roleKey: "member" }, f.deps)).toMatchObject({ ok: true, data: { path: "pending-account" } });
    expect(f.rows[SCHEMA.notification]).toEqual(expect.arrayContaining([expect.objectContaining({ Kind: "access-requested", RecipientUserId: "admin" })]));
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it("fails without writes on IAM outages", async () => {
    const f = fixture({ ok: false, status: 503, errors: {} });
    expect(await memberInvite(f.ctx, { workspaceId: "ws", email: "invitee@example.org", roleKey: "member" }, f.deps)).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(f.rows[SCHEMA.invitation]).toBeUndefined();
    expect(f.rows[SCHEMA.membership]).toHaveLength(1);
  });
});

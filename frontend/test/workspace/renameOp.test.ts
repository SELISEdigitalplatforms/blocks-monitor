// workspace.rename through the real router: who may rename (a Workspace admin of THAT workspace), the name rule, the
// audit entry (old and new name), the optimistic-concurrency check on the name the admin saw, and the per-user quota.
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedWorkspace } from "../../functions/_lib/testing";
import { WORKSPACE_RENAME_OPS } from "../../functions/workspace/ops/workspace/rename";
import { auditActionLabel } from "../../src/components/admin/auditLabels";
import { OP_QUOTAS, impersonationRefused } from "../../src/domain/security";
import { MAX_WORKSPACE_NAME, checkWorkspaceRename } from "../../src/domain/tenancy";

const ADMIN = { userId: "admin-1", email: "admin@example.org" };
const MEMBER = { userId: "member-1", email: "member@example.org" };
const VIEWER = { userId: "viewer-1", email: "viewer@example.org" };
const KEEPER = { userId: "keeper-1", email: "keeper@example.org" };
const OUTSIDER = { userId: "outsider-1", email: "outsider@example.org" };

function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, {
    name: "Old name",
    members: [
      { ...ADMIN, roleKey: "owner" },
      { ...MEMBER, roleKey: "member" },
      { ...VIEWER, roleKey: "viewer" },
      { ...KEEPER, roleKey: "keeper" },
    ],
    roles: [{ key: "keeper", name: "Keeper", permissions: ["view", "workspace.manage"] }],
  });
  const other = seedWorkspace(gateway, { name: "Other workspace", members: [{ ...OUTSIDER, roleKey: "owner" }] }).workspaceId;
  const call = (who: { userId: string; email: string; roles?: string[]; impersonated?: boolean }, args: Record<string, unknown>, requestId?: string) =>
    runOp("workspace", WORKSPACE_RENAME_OPS, {
      ctx: fakeCtx(who),
      gateway,
      request: { op: "workspace.rename", args: { workspaceId, ...args }, ...(requestId ? { requestId } : {}) },
    });
  const name = (id = workspaceId) => gateway.rows("Workspace").find((r) => r.ItemId === id)?.Name;
  const audits = () => gateway.rows("AuditEvent").filter((r) => r.Action === "workspace.rename");
  return { gateway, workspaceId, other, call, name, audits };
}

const errorOf = (body: unknown) => (body as { error: { code: string; messageKey?: string; params?: Record<string, unknown> } }).error;

describe("workspace.rename: permission", () => {
  it("is registered in mf-workspace", async () => {
    expect(await listRegisteredOps("workspace")).toContain("workspace.rename");
  });

  it("renames for a Workspace admin and for a custom role holding workspace.manage", async () => {
    const t = setup();
    const ok = await t.call(ADMIN, { name: "  New name  ", expectedName: "Old name" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ data: { workspace: { id: t.workspaceId, name: "New name" }, changed: true } });
    expect(t.name()).toBe("New name");
    expect(t.gateway.rows("Workspace").find((r) => r.ItemId === t.workspaceId)?.UpdatedByUserId).toBe(ADMIN.userId);

    const keeper = await t.call(KEEPER, { name: "Kept name", expectedName: "New name" });
    expect(keeper.status).toBe(200);
    expect(t.name()).toBe("Kept name");
  });

  it("refuses members and viewers (forbidden) without writing", async () => {
    const t = setup();
    for (const who of [MEMBER, VIEWER]) {
      const no = await t.call(who, { name: "Taken over", expectedName: "Old name" });
      expect(no.status).toBe(403);
      expect(errorOf(no.body).code).toBe("forbidden");
    }
    expect(t.name()).toBe("Old name");
    expect(t.audits()).toHaveLength(0);
  });

  it("refuses an admin of ANOTHER workspace (not_member) and leaves both names alone", async () => {
    const t = setup();
    const no = await t.call(OUTSIDER, { name: "Taken over", expectedName: "Old name" });
    expect(no.status).toBe(403);
    expect(errorOf(no.body).code).toBe("not_member");
    expect(t.name()).toBe("Old name");
    expect(t.name(t.other)).toBe("Other workspace");
  });

  it("refuses an impersonated admin (workspace.manage is never granted to impersonation)", async () => {
    const t = setup();
    expect(impersonationRefused({ impersonated: true, op: "workspace.rename", kind: "command", scope: "workspace", permission: "workspace.manage" })).toBe(true);
    const no = await t.call({ ...ADMIN, impersonated: true }, { name: "Impersonated", expectedName: "Old name" });
    expect(no.status).toBe(403);
    expect(t.name()).toBe("Old name");
  });

  it("refuses a suspended workspace", async () => {
    const t = setup();
    await t.gateway.update("Workspace", t.workspaceId, { Status: "suspended" });
    const no = await t.call(ADMIN, { name: "While suspended", expectedName: "Old name" });
    expect(no.status).toBe(403);
    expect(errorOf(no.body)).toMatchObject({ code: "forbidden", messageKey: "fn.workspaceInactive" });
    expect(t.name()).toBe("Old name");
  });
});

describe("workspace.rename: the name rule", () => {
  it("trims and accepts 2 to 60 characters", () => {
    expect(checkWorkspaceRename("  Northwind App Center ")).toEqual({ ok: true, value: "Northwind App Center" });
    expect(checkWorkspaceRename("AB")).toMatchObject({ ok: true, value: "AB" });
    expect(checkWorkspaceRename("x".repeat(MAX_WORKSPACE_NAME))).toMatchObject({ ok: true });
  });

  it.each([
    ["", "min"],
    ["   ", "min"],
    [" A ", "min"],
    ["x".repeat(MAX_WORKSPACE_NAME + 1), "max"],
    ["Line\nbreak", "control"],
    ["Tab\there", "control"],
    ["Escape\u001b", "control"],
    ["C1\u0085", "control"],
  ])("refuses %j (%s)", (name, rule) => {
    expect(checkWorkspaceRename(name)).toEqual({
      ok: false, code: "invalid_input", messageKey: "tenancy.invalidWorkspaceName", params: { field: "name", rule },
    });
  });

  it("is applied by the op before any write; a missing or non-string name is invalid too", async () => {
    const t = setup();
    for (const [args, rule] of [
      [{ name: "A", expectedName: "Old name" }, "min"],
      [{ name: "Two\nlines", expectedName: "Old name" }, "control"],
      [{ name: "y".repeat(61), expectedName: "Old name" }, "max"],
    ] as const) {
      const no = await t.call(ADMIN, args);
      expect(no.status).toBe(400);
      expect(errorOf(no.body)).toMatchObject({ code: "invalid_input", messageKey: "tenancy.invalidWorkspaceName", params: { field: "name", rule } });
    }
    expect((await t.call(ADMIN, { expectedName: "Old name" })).status).toBe(400);
    expect((await t.call(ADMIN, { name: 42, expectedName: "Old name" })).status).toBe(400);
    expect((await t.call(ADMIN, { name: "Fine name" })).status).toBe(400);
    expect((await t.call(ADMIN, { name: "Fine name", expectedName: "Old name", extra: true })).status).toBe(400);
    expect(t.name()).toBe("Old name");
    expect(t.audits()).toHaveLength(0);
  });
});

describe("workspace.rename: audit", () => {
  it("records the existing workspace.rename label with the old and the new name", async () => {
    const t = setup();
    await t.call(ADMIN, { name: "New name", expectedName: "Old name" });
    const [row] = t.audits();
    expect(row).toMatchObject({ ActorUserId: ADMIN.userId, WorkspaceId: t.workspaceId, TargetType: "workspace", TargetId: t.workspaceId });
    expect(JSON.parse(String(row.DetailsJson))).toMatchObject({ before: "Old name", after: "New name" });
    expect(auditActionLabel("workspace.rename")).toBe("Renamed a workspace");
  });

  it("a rename to the name it already has writes nothing and records nothing", async () => {
    const t = setup();
    const same = await t.call(ADMIN, { name: " Old name ", expectedName: "Old name" });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ data: { workspace: { name: "Old name" }, changed: false } });
    expect(t.audits()).toHaveLength(0);
    expect(t.gateway.calls.some((c) => c.schema === "Workspace" && (c.method === "update" || c.method === "updateMany"))).toBe(false);
  });

  it("a repeated request (same requestId) replays its answer: one write, one audit entry", async () => {
    const t = setup();
    const first = await t.call(ADMIN, { name: "New name", expectedName: "Old name" }, "rename-request-1");
    const again = await t.call(ADMIN, { name: "New name", expectedName: "Old name" }, "rename-request-1");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ data: (first.body as { data: unknown }).data });
    expect(t.audits()).toHaveLength(1);
  });
});

describe("workspace.rename: optimistic concurrency", () => {
  it("refuses a save made against a name someone else has changed since (conflict), and keeps their name", async () => {
    const t = setup();
    expect((await t.call(ADMIN, { name: "First admin's name", expectedName: "Old name" })).status).toBe(200);
    const stale = await t.call(KEEPER, { name: "Second admin's name", expectedName: "Old name" });
    expect(stale.status).toBe(409);
    expect(errorOf(stale.body)).toMatchObject({ code: "conflict", messageKey: "tenancy.workspaceRenamed" });
    expect(t.name()).toBe("First admin's name");
    expect(t.audits()).toHaveLength(1);
  });

  it("is not fooled by other changes to the Workspace row (member changes restamp its readers)", async () => {
    const t = setup();
    await t.gateway.update("Workspace", t.workspaceId, {
      ReaderIds: [ADMIN.userId, KEEPER.userId], UpdatedByUserId: "service", LastUpdatedDate: "2026-11-05T09:00:00.000Z",
    });
    expect(t.gateway.rows("Workspace").find((r) => r.ItemId === t.workspaceId)).toMatchObject({ LastUpdatedDate: "2026-11-05T09:00:00.000Z" });
    expect((await t.call(ADMIN, { name: "New name", expectedName: "Old name" })).status).toBe(200);
    expect(t.name()).toBe("New name");
  });

  it("answers a second save of the same new name (a timed-out save that landed) without a conflict", async () => {
    const t = setup();
    await t.call(ADMIN, { name: "New name", expectedName: "Old name" });
    const twice = await t.call(ADMIN, { name: "New name", expectedName: "Old name" });
    expect(twice.status).toBe(200);
    expect(twice.body).toMatchObject({ data: { changed: false } });
    expect(t.audits()).toHaveLength(1);
  });
});

describe("workspace.rename: rate limit", () => {
  it("has a per-user quota like the other admin ops", () => {
    expect(OP_QUOTAS.find((q) => q.op === "workspace.rename")).toMatchObject({ max: 30, windowMinutes: 60, source: "operation" });
  });

  it("refuses the call once the caller used the quota within the hour (limit_reached)", async () => {
    const t = setup();
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      t.gateway.seed("Operation", {
        RequestId: `earlier-${i}`, Op: "workspace.rename", Status: "done", ActorUserId: ADMIN.userId,
        CreatedDate: new Date(now - (i + 1) * 60_000).toISOString(),
      });
    }
    const no = await t.call(ADMIN, { name: "One too many", expectedName: "Old name" });
    expect(no.status).toBe(422);
    expect(errorOf(no.body)).toMatchObject({ code: "limit_reached", messageKey: "fn.quota", params: { op: "workspace.rename", max: 30 } });
    expect(t.name()).toBe("Old name");
    // another admin's quota is their own
    expect((await t.call(KEEPER, { name: "Keeper's name", expectedName: "Old name" })).status).toBe(200);
  });
});

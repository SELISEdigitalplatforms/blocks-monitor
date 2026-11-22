import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedWorkspace } from "../../functions/_lib/testing";
import { DOC_OPS } from "../../functions/project/ops/projects/bind";

const member = { userId: "resource-member", email: "resource-member@example.org" };
function fixture() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: member.userId });
  const call = (op: string, args: Record<string, unknown>, pid = projectId) => runOp("project", DOC_OPS, {
    gateway, ctx: fakeCtx(member), request: { op, args: { projectId: pid, ...args } },
  });
  return { gateway, workspaceId, projectId, call };
}

describe("Project resources through the permission-checked router", () => {
  it("creates, renames, moves and deletes folders and notes in Gateway records", async () => {
    const f = fixture();
    const first = await f.call("doc.folder.create", { parentId: "", name: "Materials", kind: "meeting" });
    expect(first.status).toBe(200);
    const folderId = first.body.data.folder.ItemId;
    expect(first.body.data.folder).toMatchObject({ ProjectId: f.projectId, WorkspaceId: f.workspaceId });
    expect((await f.call("doc.folder.rename", { folderId, name: "Briefs" })).status).toBe(200);

    const second = await f.call("doc.folder.create", { parentId: "", name: "Archive", kind: "meeting" });
    const parentId = second.body.data.folder.ItemId;
    expect((await f.call("doc.folder.move", { folderId, parentId, beforeId: null })).status).toBe(200);
    expect(f.gateway.rows("DocFolder").find((r) => r.ItemId === folderId)).toMatchObject({ Name: "Briefs", ParentId: parentId });

    const created = await f.call("doc.note.save", { folderId, title: "Requirements", bodyMd: "Original brief" });
    expect(created.status).toBe(200);
    const note = created.body.data.note;
    const edited = await f.call("doc.note.save", { noteId: note.ItemId, folderId, title: "Updated requirements", bodyMd: "Updated brief", expectedUpdatedAt: note.LastUpdatedDate });
    expect(edited.status).toBe(200);
    expect((await f.call("doc.note.move", { noteId: note.ItemId, folderId: "", beforeId: null })).status).toBe(200);
    expect(f.gateway.rows("DocNote").find((r) => r.ItemId === note.ItemId)).toMatchObject({ Title: "Updated requirements", BodyMd: "Updated brief", FolderId: "" });
    expect((await f.call("doc.note.delete", { noteId: note.ItemId })).status).toBe(200);
    expect((await f.call("doc.folder.delete", { folderId: parentId })).status).toBe(200);
    expect(f.gateway.rows("DocNote")).toHaveLength(0);
    expect(f.gateway.rows("DocFolder")).toHaveLength(0);
    expect(f.gateway.rows("AuditEvent").length).toBeGreaterThan(0);
  });

  it("refuses resource ids belonging to a different project", async () => {
    const f = fixture();
    const folder = await f.call("doc.folder.create", { parentId: "", name: "Private resources", kind: "meeting" });
    const folderId = folder.body.data.folder.ItemId;
    const { projectId: otherProject } = seedProject(f.gateway, { workspaceId: f.workspaceId, Name: "Other project", CreatedByUserId: member.userId });
    expect((await f.call("doc.folder.rename", { folderId, name: "Wrong project" }, otherProject)).status).not.toBe(200);
    expect(f.gateway.rows("DocFolder")[0].Name).toBe("Private resources");
  });

  it("refuses another workspace before creating or modifying its resources", async () => {
    const f = fixture();
    const { workspaceId } = seedWorkspace(f.gateway, { name: "Other workspace", members: [{ userId: "other-user", email: "other@example.org", roleKey: "owner" }] });
    const { projectId } = seedProject(f.gateway, { workspaceId, CreatedByUserId: "other-user" });
    const denied = await f.call("doc.folder.create", { parentId: "", name: "Not allowed", kind: "meeting" }, projectId);
    expect(denied.status).not.toBe(200);
    expect(f.gateway.rows("DocFolder")).toHaveLength(0);
  });
});

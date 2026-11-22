// project.setup.save through the real router: fields written, the brief's sections refreshed, the approval owner checked.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { parseSetupSave } from "../../functions/project/ops/projects/setupSave";
import { detailsFromRow } from "../../src/domain/setupDetails";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const OTHER = { userId: "member-2", email: "luca.bernasconi@selisegroup.com", displayName: "Luca Bernasconi" };
const GONE = { userId: "member-3", email: "former@selisegroup.com", status: "removed" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };

function setup(opts: { brief?: string; briefByTitle?: boolean } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, {
    members: [{ ...ME, roleKey: "member" }, { ...OTHER, roleKey: "member" }, { ...GONE, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }],
  });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, RepoMode: "existing" });
  if (opts.brief !== undefined) {
    seedRow(gateway, "DocNote", {
      WorkspaceId: workspaceId, ReaderIds: [ME.userId, OTHER.userId, VIEWER.userId], ProjectId: projectId, FolderId: "", Title: "Project brief",
      BodyMd: opts.brief, SortOrder: 0, IsScratchPad: false, ...(opts.briefByTitle ? {} : { IsProjectBrief: true }),
    });
  }
  const call = (args: Record<string, unknown>, who: { userId: string; email: string } = ME) =>
    runOp("project", PROJECT_OPS, { ctx: fakeCtx(who), gateway, request: { op: "project.setup.save", args: { projectId, ...args } } });
  const row = () => gateway.rows("Project").find((r) => r.ItemId === projectId)!;
  const brief = () => gateway.rows("DocNote").find((r) => r.ProjectId === projectId && r.Title === "Project brief");
  return { call, row, brief };
}

describe("project.setup.save parse", () => {
  it("needs something to save, refuses unknown keys and an empty approval owner", () => {
    expect(parseSetupSave({ projectId: "p" })).toMatchObject({ ok: false, messageKey: "project.setupNothingToSave" });
    expect(parseSetupSave({ projectId: "p", mustHave: [] })).toMatchObject({ ok: false, messageKey: "input.unknownKey" });
    expect(parseSetupSave({ projectId: "p", approvalOwnerUserId: " " })).toMatchObject({ ok: false, messageKey: "project.approvalOwnerInvalid" });
    expect(parseSetupSave({ projectId: "p", exclusions: [] })).toEqual({ ok: true, value: { projectId: "p", details: { exclusions: [] } } });
  });
});

describe("project.setup.save run", () => {
  it("writes the sent details only and answers the project", async () => {
    const { call, row } = setup();
    const res = await call({ mustHaves: [{ text: "Book a slot", priority: "must" }], workflows: ["Staff log a return"], intendedChanges: "Faster" });
    expect(res.status).toBe(200);
    expect(detailsFromRow(row())).toMatchObject({ mustHaves: [{ text: "Book a slot", priority: "must" }], workflows: ["Staff log a return"], intendedChanges: "Faster", exclusions: [] });
    expect(res.body.data.note).toBeUndefined();
    await call({ exclusions: ["No app"] });
    expect(detailsFromRow(row())).toMatchObject({ mustHaves: [{ text: "Book a slot", priority: "must" }], exclusions: ["No app"] });
  });

  it("refreshes the setup sections of the Project brief and keeps the rest", async () => {
    const { call, brief } = setup({ brief: "## About the product\n\n**Returns Desk**\n\n## Must-haves\n\n- old one\n" });
    const res = await call({ mustHaves: [{ text: "Book a slot", priority: "should" }], constraints: [{ kind: "deadline", text: "1 March" }] });
    expect(res.status).toBe(200);
    expect(brief()!.BodyMd).toBe("## About the product\n\n**Returns Desk**\n\n## What it must do\n\n- **Should:** Book a slot\n\n## Constraints\n\n- **Deadline**: 1 March\n");
    expect(res.body.data.note).toMatchObject({ BodyMd: brief()!.BodyMd });
  });

  it("a note titled Project brief is refreshed too", async () => {
    const { call, brief } = setup({ brief: "## Goal\n\nX.", briefByTitle: true });
    await call({ workflows: ["Staff log a return"] });
    expect(brief()!.BodyMd).toBe("## Goal\n\nX.\n\n## Key workflows\n\n- Staff log a return\n");
  });

  it("the approval owner must be an active member; the brief names them", async () => {
    const { call, row, brief } = setup({ brief: "## Goal\n\nX.\n" });
    expect((await call({ approvalOwnerUserId: GONE.userId })).body).toMatchObject({ error: { messageKey: "project.approvalOwnerNotMember" } });
    expect((await call({ approvalOwnerUserId: "nobody" })).body).toMatchObject({ error: { messageKey: "project.approvalOwnerNotMember" } });
    const res = await call({ approvalOwnerUserId: OTHER.userId });
    expect(res.status).toBe(200);
    expect(row().ApprovalOwnerUserId).toBe(OTHER.userId);
    expect(brief()!.BodyMd).toBe("## Goal\n\nX.\n\n## Approval\n\nLuca Bernasconi approves the result.\n");
  });

  it("a viewer cannot save", async () => {
    const { call } = setup();
    const res = await call({ exclusions: ["No app"] }, VIEWER);
    expect(res.status).toBe(403);
  });
});

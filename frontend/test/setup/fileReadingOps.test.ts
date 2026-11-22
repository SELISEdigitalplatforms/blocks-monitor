// Files are read by the MADP engine, never by a web server: committing an upload (doc.file.commit) queues one
// file.extract job for the file, "Read again" (doc.file.extract) queues another only when none is under way, and
// people's decisions on the brief are ProjectAnswer rows (project.brief.decide), which every server and the engine read.
//   npx vitest run --config test/setup/vitest.config.ts test/setup/fileReadingOps.test.ts
import { describe, expect, it, vi } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { DOC_OPS, PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { decisionsFromAnswers } from "../../src/domain/briefDecisions";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };
const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");

function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, RepoMode: "new" });
  const stamp = { WorkspaceId: workspaceId, ReaderIds: [ME.userId, VIEWER.userId], ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
  const file = (status: "pending" | "ready") => ({ ItemId: seedRow(gateway, "DocFile", {
    ...stamp, FolderId: "", Name: "Spec.pdf", StoredName: "1.pdf", Mime: "application/pdf", SizeBytes: PDF_HEAD.length, StorageObjectId: "obj-1", Status: status, SortOrder: 1024,
  }) });
  const files = {
    info: vi.fn(async (id: string) => ({ fileId: id, name: "1.pdf", mime: "application/pdf", sizeBytes: PDF_HEAD.length, directoryId: "d", createdAt: "" })),
    head: vi.fn(async () => PDF_HEAD),
    remove: vi.fn(async () => undefined),
  };
  const ops = [...DOC_OPS, ...PROJECT_OPS];
  const call = (op: string, args: Record<string, unknown>, who: { userId: string; email: string } = ME) =>
    runOp("project", ops, { ctx: fakeCtx(who), gateway, files: () => files, request: { op, args: { projectId, ...args } } });
  const readings = () => gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId && j.Kind === "file.extract");
  const answers = () => gateway.rows("ProjectAnswer").filter((a) => a.ProjectId === projectId);
  return { gateway, projectId, file, call, readings, answers };
}

describe("committing an upload queues the engine's reading of it", () => {
  it("queues one file.extract job for the committed file, aimed at the file", async () => {
    const t = setup();
    const f = t.file("pending");
    const res = await t.call("doc.file.commit", { fileId: f.ItemId });
    expect(res.status).toBe(200);
    expect(res.body.data.file.Status).toBe("ready");
    const jobs = t.readings();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ Status: "queued", TargetType: "doc-file", TargetId: f.ItemId, RequestedByUserId: ME.userId });
    expect(JSON.parse(String(jobs[0]!.InputJson))).toEqual({ fileId: f.ItemId });
    expect(res.body.data.readingJobId).toBe(jobs[0]!.ItemId);
  });

  it("reads again on request, but never twice at once, and only for people who may edit", async () => {
    const t = setup();
    const f = t.file("ready");
    const first = await t.call("doc.file.extract", { fileId: f.ItemId });
    expect(first.status).toBe(200);
    expect(first.body.data.queued).toBe(true);
    const again = await t.call("doc.file.extract", { fileId: f.ItemId });
    expect(again.body.data).toEqual({ jobId: first.body.data.jobId, queued: false });
    expect(t.readings()).toHaveLength(1);
    // once that reading has finished, asking again queues a new one
    const done = t.readings()[0]!;
    await t.gateway.update("EngineJob", String(done.ItemId), { Status: "succeeded", ActiveKey: String(done.ItemId) });
    const later = await t.call("doc.file.extract", { fileId: f.ItemId });
    expect(later.body.data.queued).toBe(true);
    expect(later.body.data.jobId).not.toBe(first.body.data.jobId);
    expect(t.readings()).toHaveLength(2);
    expect((await t.call("doc.file.extract", { fileId: f.ItemId }, VIEWER)).status).toBe(403);
    expect((await t.call("doc.file.extract", { fileId: "missing" })).status).toBe(404);
  });
});

describe("decisions on the brief are rows every server reads", () => {
  it("saves, changes and undoes a decision, one row per item, and records the confirmation", async () => {
    const t = setup();
    const r0 = await t.call("project.brief.decide", { kind: "requirement", key: "R-0123456789", value: "confirmed" });
    expect(r0.status).toBe(200);
    expect((await t.call("project.brief.decide", { kind: "requirement", key: "R-0123456789", value: "rejected" })).status).toBe(200);
    expect((await t.call("project.brief.decide", { kind: "conflict", key: "C-abcdef0123", value: "product_manager" })).status).toBe(200);
    expect((await t.call("project.brief.decide", { kind: "confirm", value: "confirmed" })).status).toBe(200);
    expect(t.answers()).toHaveLength(3);
    const d = decisionsFromAnswers(t.answers());
    expect(d.requirements).toEqual({ "R-0123456789": "rejected" });
    expect(Object.keys(d.conflicts)).toEqual(["C-abcdef0123"]);
    expect(d.confirmedByUserId).toBe(ME.userId);
    expect(typeof d.confirmedAt).toBe("string");
    expect((await t.call("project.brief.decide", { kind: "requirement", key: "R-0123456789", value: null })).status).toBe(200);
    expect(decisionsFromAnswers(t.answers()).requirements).toEqual({});
  });

  it("refuses bad keys and values, and people who may not edit", async () => {
    const t = setup();
    expect((await t.call("project.brief.decide", { kind: "requirement", key: "../x", value: "confirmed" })).status).toBe(400);
    expect((await t.call("project.brief.decide", { kind: "conflict", key: "C-abcdef0123", value: "confirmed" })).status).toBe(400);
    expect((await t.call("project.brief.decide", { kind: "other", value: "confirmed" })).status).toBe(400);
    expect((await t.call("project.brief.decide", { kind: "requirement", key: "R-0123456789", value: "confirmed" }, VIEWER)).status).toBe(403);
    expect(t.answers()).toEqual([]);
  });
});

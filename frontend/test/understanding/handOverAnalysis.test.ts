// business.handOver starts the project analysis by itself: the questions and the technical reading are queued as two
// sanitization.assist jobs that can run side by side, with the record ids the engine reads. Through the real router.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { SANITIZATION_DEFS } from "../../functions/project/ops/sanitization/register";
import { analysisRefs } from "../../functions/project/ops/projects/analysisStart";
import { shouldDraft } from "../../functions/project/ops/sanitization/autoDraft";

const ME = { userId: "member-1", email: "member@selisegroup.com" };

async function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
  const call = (op: string, args: Record<string, unknown>, requestId?: string) =>
    runOp("project", [...PROJECT_OPS, ...SANITIZATION_DEFS], {
      ctx: fakeCtx(ME), gateway, request: { op, args: op === "project.create" ? { workspaceId, ...args } : args, ...(requestId ? { requestId } : {}) },
    });
  const made = await call("project.create", { name: "Café shop", goal: "Sell coffee online", targetUsers: "Café owners" });
  expect(made.status).toBe(200);
  const projectId = String(made.body.data.project.ItemId);
  const project = gateway.rows("Project").find((p) => p.ItemId === projectId)!;
  const stamp = { WorkspaceId: workspaceId, ReaderIds: project.ReaderIds, ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
  const noteId = seedRow(gateway, "DocNote", { ...stamp, Title: "Kick-off", BodyMd: "- Wish: order online\n- Open: delivery area?", SortOrder: 1, IsScratchPad: false });
  seedRow(gateway, "DocNote", { ...stamp, Title: "Empty", BodyMd: "", SortOrder: 2, IsScratchPad: false });
  return { gateway, call, projectId, noteId };
}

describe("analysis start at the hand-over", () => {
  it("queues the questions and the technical reading, side by side", async () => {
    const { gateway, call, projectId, noteId } = await setup();
    const res = await call("business.handOver", { projectId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(gateway.rows("Project").find((p) => p.ItemId === projectId)?.Stage).toBe("sanitization");

    const jobs = gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId);
    expect(jobs).toHaveLength(2);
    const byFocus = Object.fromEntries(jobs.map((j) => [JSON.parse(String(j.InputJson)).focus, j]));
    expect(Object.keys(byFocus).sort()).toEqual(["clarifications", "technical"]);
    for (const j of jobs) {
      expect(j).toMatchObject({ Kind: "sanitization.assist", Status: "queued", RequestedByUserId: ME.userId });
      const input = JSON.parse(String(j.InputJson));
      expect(input.projectId).toBe(projectId);
      expect(input.refs.docNoteIds).toEqual([noteId]); // the note with text only
    }
    // one active job per kind and target: the two keys differ, so neither is dropped
    expect(byFocus.clarifications!.ActiveKey).toBe("sanitization.assist:project");
    expect(byFocus.technical!.ActiveKey).toBe(`sanitization.assist:${projectId}`);
    expect(res.body.data.analysis).toEqual({ questionsJobId: byFocus.clarifications!.ItemId, technicalJobId: byFocus.technical!.ItemId });
    expect(gateway.rows("AuditEvent").some((e) => e.Action === "analysis.start")).toBe(true);
  });

  it("every project gets its own readings (a second project's hand-over never answers the first one's jobs)", async () => {
    const { gateway, call, projectId } = await setup();
    expect((await call("business.handOver", { projectId })).status).toBe(200);
    const made = await call("project.create", { name: "Bakery orders", goal: "Take orders online", targetUsers: "Bakery customers" });
    const second = String(made.body.data.project.ItemId);
    const p2 = gateway.rows("Project").find((p) => p.ItemId === second)!;
    seedRow(gateway, "DocNote", {
      WorkspaceId: p2.WorkspaceId, ReaderIds: p2.ReaderIds, ProjectId: second, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId,
      Title: "Brief", BodyMd: "Customers order bread for the next morning.", SortOrder: 1, IsScratchPad: false,
    });
    const res = await call("business.handOver", { projectId: second });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const jobs = gateway.rows("EngineJob").filter((j) => j.ProjectId === second);
    expect(jobs).toHaveLength(2);
    expect(res.body.data.analysis).toEqual({
      questionsJobId: jobs.find((j) => JSON.parse(String(j.InputJson)).focus === "clarifications")!.ItemId,
      technicalJobId: jobs.find((j) => JSON.parse(String(j.InputJson)).focus === "technical")!.ItemId,
    });
    expect(gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId)).toHaveLength(2);
  });

  it("a retried hand-over queues nothing twice", async () => {
    const { gateway, call, projectId } = await setup();
    const first = await call("business.handOver", { projectId }, "11111111-1111-5111-8111-111111111111");
    expect(first.status).toBe(200);
    await call("business.handOver", { projectId }, "11111111-1111-5111-8111-111111111111");
    expect(gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId)).toHaveLength(2);
  });

  it("the questions can still be asked for once the reading finished (sanitization.assist)", async () => {
    const { gateway, call, projectId } = await setup();
    await call("business.handOver", { projectId });
    // while the readings run, another assist request is refused as busy
    const busy = await call("sanitization.assist", { projectId, focus: "clarifications", refId: "", question: "" });
    expect(JSON.stringify(busy.body)).toMatch(/existing|assistBusy/);
    for (const j of gateway.rows("EngineJob")) gateway.update("EngineJob", String(j.ItemId), { Status: "succeeded", ActiveKey: String(j.ItemId) });
    const again = await call("sanitization.assist", { projectId, focus: "clarifications" });
    expect(again.status).toBe(200);
    expect(again.body.data.existing).toBe(false);
  });

  it("refs: sorted ids, nothing else", () => {
    expect(analysisRefs([{ ItemId: "b" }, { ItemId: "a" }], [{ ItemId: "f" }])).toEqual({
      docNoteIds: ["a", "b"], docFileIds: ["f"], clarificationIds: [], decisionIds: [], techDecisionIds: [], requirementIds: [],
    });
  });

  it("the first requirements are prepared behind the scenes once every question is answered or set aside", async () => {
    const { gateway, call, projectId } = await setup();
    await call("business.handOver", { projectId });
    const ask = async (question: string) => {
      const r = await call("clarification.save", { projectId, question, ownerUserId: "" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return String(r.body.data.clarification.ItemId);
    };
    const a = await ask("How many cafés order at the same time?");
    const b = await ask("How fast must the order page open?");
    const drafts = () => gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId && j.Kind === "requirements.draft");

    // the reading still writes questions: no draft yet, even with everything answered
    const first = await call("clarification.answer", { projectId, id: a, answer: "About 40 at lunch time." });
    expect(first.status).toBe(200);
    expect(drafts()).toHaveLength(0);
    for (const j of gateway.rows("EngineJob")) gateway.update("EngineJob", String(j.ItemId), { Status: "succeeded", ActiveKey: String(j.ItemId) });

    // the last open question set aside ("Not sure"): the draft is queued
    const last = await call("clarification.defer", { projectId, id: b, reason: "Not sure yet. Your business analyst suggests an answer." });
    expect(last.status, JSON.stringify(last.body)).toBe(200);
    expect(drafts()).toHaveLength(1);
    expect(last.body.data.draftJobId).toBe(drafts()[0]!.ItemId);
    expect(JSON.parse(String(drafts()[0]!.InputJson))).toMatchObject({ projectId, sanitizationVersion: 1 });

    // reopened and answered again: the draft that runs is not queued twice
    await call("clarification.reopen", { projectId, id: b });
    await call("clarification.answer", { projectId, id: b, answer: "Within 2 seconds." });
    expect(drafts()).toHaveLength(1);
  });

  it("shouldDraft: only with every question handled, the reading done and no draft yet", () => {
    const job = (Kind: string, Status: string, focus = "clarifications") => ({ ItemId: Kind + Status, Kind, Status, InputJson: JSON.stringify({ focus }) });
    const base = { openQuestions: 0, anyQuestions: 3, requirements: 0, jobs: [] as ReturnType<typeof job>[] };
    expect(shouldDraft(base)).toBe(true);
    expect(shouldDraft({ ...base, openQuestions: 1 })).toBe(false);
    expect(shouldDraft({ ...base, anyQuestions: 0 })).toBe(false);
    expect(shouldDraft({ ...base, requirements: 2 })).toBe(false);
    expect(shouldDraft({ ...base, jobs: [job("sanitization.assist", "running")] })).toBe(false);
    expect(shouldDraft({ ...base, jobs: [job("sanitization.assist", "running", "technical")] })).toBe(true);
    expect(shouldDraft({ ...base, jobs: [job("requirements.draft", "queued")] })).toBe(false);
    expect(shouldDraft({ ...base, jobs: [job("requirements.draft", "succeeded")] })).toBe(false);
    expect(shouldDraft({ ...base, jobs: [job("requirements.draft", "failed")] })).toBe(true);
  });
});

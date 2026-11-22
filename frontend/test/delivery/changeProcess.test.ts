// The change request process (CHANGE-PROCESS-31.10): draft -> analysing -> questions -> review -> approved | rejected
// -> building -> released. The Analysis parser, the status helpers, and the ops cr.submit, cr.answer, cr.decide and
// the cr.startBuild gate on the delivery test ports: every transition, the guards, self-approval and the scope route.
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { crSubmitOp } from "../../functions/delivery/ops/changes/crSubmit";
import { crAnswerOp } from "../../functions/delivery/ops/changes/crAnswer";
import { crDecideOp } from "../../functions/delivery/ops/changes/crDecide";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { crSaveDraftOp } from "../../functions/delivery/ops/changes/crSaveDraft";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, guardCases, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import {
  CHANGE_STATUSES,
  changeApproverIds,
  changeDecideRight,
  changeRequestsToPromote,
  changeStepOf,
  checkChangeForBuild,
  isChangeStatus,
  isOpenChange,
  stepKeyFor,
} from "../../src/domain/delivery";
import {
  applyChangeAnswers,
  allQuestionsAnswered,
  parseChangeAnalysis,
  serializeChangeAnalysis,
  statusAfterAnalysis,
  type ChangeAnalysis,
} from "../../src/domain/changeAnalysis";
import { ENGINE_JOB_KIND_LABEL, ENGINE_JOB_OUTPUTS, JOB_MAX_RUN_MS, isEngineJobKind } from "../../src/domain/engineJob";
import { parseChangeRequest } from "../../src/blocks/delivery/types";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };

const SPEC_SAMPLE = {
  v: 1,
  kind: "change",
  route: "fast",
  summary: "Show the delivery window on the order list.",
  impact: { features: ["Orders"], stories: ["See my orders"], screens: ["Order list"], milestones: ["M2"] },
  scopeChange: false,
  conflicts: [],
  risks: ["The list gets wider on phones"],
  acceptanceCriteria: ["The order list shows the delivery window", "Older orders show a dash"],
  tickets: [
    { title: "Delivery window column", description: "Add the column." },
    { title: "Phone layout of the order list", description: "Keep it readable." },
  ],
  estimate: { tickets: 2 },
  questions: [
    { id: "q1", text: "Which format?", options: ["Date only", "Date and time"], answer: null, answeredBy: null, answeredAt: null },
    { id: "q2", text: "Show it on phones?", options: ["Yes", "No"], answer: null, answeredBy: null, answeredAt: null },
  ],
  contextVersion: 31,
};

const analysisWith = (patch: Partial<Record<keyof typeof SPEC_SAMPLE, unknown>> = {}): ChangeAnalysis =>
  parseChangeAnalysis({ ...SPEC_SAMPLE, ...patch })!;
const answered = (a: ChangeAnalysis): ChangeAnalysis => ({
  ...a,
  questions: a.questions.map((q) => ({ ...q, answer: q.options[0] ?? "Yes", answeredBy: FX.owner, answeredAt: FX.now })),
});

// ------------------------------------------------------------------ the Analysis JSON

describe("parseChangeAnalysis", () => {
  it("reads the spec's version 1 shape, from text or an object, and writes it back unchanged", () => {
    const a = parseChangeAnalysis(JSON.stringify(SPEC_SAMPLE));
    expect(a).not.toBeNull();
    expect(a).toMatchObject({ v: 1, kind: "change", route: "fast", scopeChange: false, estimate: { tickets: 2 }, contextVersion: 31 });
    expect(a!.impact).toEqual(SPEC_SAMPLE.impact);
    expect(a!.tickets).toEqual(SPEC_SAMPLE.tickets);
    expect(a!.questions).toEqual(SPEC_SAMPLE.questions);
    expect(parseChangeAnalysis(serializeChangeAnalysis(a!))).toEqual(a);
    expect(parseChangeAnalysis(SPEC_SAMPLE)).toEqual(a);
  });

  it("routes a feature or a scope change through scope, whatever route the model claimed", () => {
    expect(analysisWith({ kind: "feature", route: "fast" }).route).toBe("scope");
    expect(analysisWith({ kind: "fix", scopeChange: true, route: "fast" }).route).toBe("scope");
    expect(analysisWith({ kind: "fix", route: "scope" }).route).toBe("scope");
    expect(analysisWith({ kind: "fix", route: "fast" }).route).toBe("fast");
  });

  it("returns null for anything that is not an analysis, and never throws", () => {
    for (const bad of [null, undefined, "", "not json", "[]", 42, { v: 2, kind: "fix" }, { v: 1, kind: "rewrite" }, { v: 1 }, "x".repeat(100_001)]) {
      expect(parseChangeAnalysis(bad)).toBeNull();
    }
  });

  it("clamps and cleans: at most 3 questions and 4 options, unique ids, no empty items, estimate from the tickets", () => {
    const a = parseChangeAnalysis({
      v: 1, kind: "fix", summary: "  two   spaces ", impact: { features: ["A", "a", "", 3] }, risks: "not a list",
      tickets: [{ title: "" }, { title: "Keep", description: 5 }, "junk"],
      estimate: { tickets: -1 },
      questions: [
        { id: "q1", text: "One?", options: ["a", "b", "c", "d", "e"] },
        { id: "q1", text: "Two?", options: ["a", "b"], answer: "  b ", answeredBy: "u-x", answeredAt: FX.now },
        { text: "" },
        { id: "bad id!", text: "Three?", options: ["x", "y"] },
        { id: "q9", text: "Four?", options: ["x", "y"] },
      ],
    })!;
    expect(a.summary).toBe("two spaces");
    expect(a.impact).toEqual({ features: ["A"], stories: [], screens: [], milestones: [] });
    expect(a.risks).toEqual([]);
    expect(a.tickets).toEqual([{ title: "Keep", description: "" }]);
    expect(a.estimate.tickets).toBe(1);
    expect(a.contextVersion).toBeNull();
    expect(a.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(a.questions[0].options).toEqual(["a", "b", "c", "d"]);
    expect(a.questions[1]).toMatchObject({ answer: "b", answeredBy: "u-x", answeredAt: FX.now });
    expect(statusAfterAnalysis(a)).toBe("questions");
    expect(statusAfterAnalysis(analysisWith({ questions: [] }))).toBe("review");
  });
});

describe("applyChangeAnswers", () => {
  const a = analysisWith();
  it("saves an option or free text with who and when; answering again replaces it", () => {
    const one = applyChangeAnswers(a, [{ id: "q1", answer: "Date only" }], FX.member, FX.now);
    expect(one.ok).toBe(true);
    const v = (one as { ok: true; value: ChangeAnalysis }).value;
    expect(v.questions[0]).toMatchObject({ answer: "Date only", answeredBy: FX.member, answeredAt: FX.now });
    expect(v.questions[1].answer).toBeNull();
    expect(allQuestionsAnswered(v)).toBe(false);
    expect(a.questions[0].answer).toBeNull(); // the input is not changed
    const two = applyChangeAnswers(v, [{ id: "q1", answer: "Only the week, please" }, { id: "q2", answer: "Yes" }], FX.owner, FX.now);
    const w = (two as { ok: true; value: ChangeAnalysis }).value;
    expect(w.questions.map((q) => q.answer)).toEqual(["Only the week, please", "Yes"]);
    expect(allQuestionsAnswered(w)).toBe(true);
  });
  it("refuses unknown, repeated, empty, too long and malformed answers", () => {
    const key = (x: unknown) => { const r = applyChangeAnswers(a, x, FX.owner, FX.now); return r.ok ? null : r.messageKey; };
    expect(key([{ id: "q7", answer: "x" }])).toBe("delivery.cr.unknownQuestion");
    expect(key([{ id: "q1", answer: "x" }, { id: "q1", answer: "y" }])).toBe("delivery.cr.unknownQuestion");
    expect(key([{ id: "q1", answer: "   " }])).toBe("delivery.cr.emptyAnswer");
    expect(key([{ id: "q1", answer: "x".repeat(2001) }])).toBe("delivery.cr.answerTooLong");
    expect(key([{ id: "q1" }])).toBe("delivery.args.invalid");
    expect(key([])).toBe("delivery.cr.noAnswers");
    expect(applyChangeAnswers(analysisWith({ questions: [] }), [{ id: "q1", answer: "x" }], FX.owner, FX.now)).toMatchObject({ ok: false, messageKey: "delivery.cr.noQuestions" });
  });
});

// ------------------------------------------------------------------ statuses and rules

describe("statuses", () => {
  it("keeps the existing statuses and adds the new ones", () => {
    for (const s of ["draft", "building", "released-dev", "promoted-stage", "promoted-production"]) expect(isChangeStatus(s)).toBe(true);
    for (const s of ["analysing", "questions", "review", "approved", "rejected", "failed"]) expect(isChangeStatus(s)).toBe(true);
    expect(isChangeStatus("cancelled")).toBe(false);
    expect(CHANGE_STATUSES).toHaveLength(11);
  });
  it("counts every status still on its way to development as open", () => {
    for (const s of ["draft", "requested", "analysing", "questions", "review", "approved", "building", "failed"]) expect(isOpenChange(s)).toBe(true);
    for (const s of ["rejected", "released-dev", "promoted-stage", "promoted-production", "cancelled", "", null]) expect(isOpenChange(s)).toBe(false);
  });
  it("places each status on the lifecycle bar", () => {
    expect(["draft", "analysing", "questions", "review", "approved", "rejected", "building", "released-dev", "promoted-stage", "promoted-production"].map((s) => changeStepOf(s)))
      .toEqual(["requested", "analysis", "questions", "approval", "build", "approval", "build", "dev", "stage", "production"]);
    expect(changeStepOf("failed")).toBe("analysis");
    expect(changeStepOf("failed", true)).toBe("build");
    expect(changeStepOf("something else")).toBe("requested");
  });
  it("a released change is still carried along by a promotion", () => {
    const crs = [{ id: "c1", status: "released-dev", version: "1.1.0" }, { id: "c2", status: "approved", version: null }];
    expect(changeRequestsToPromote(crs, "stage", "1.1.0").map((c) => c.id)).toEqual(["c1"]);
  });
  it("change.analyse is a job kind with its label, output and run time", () => {
    expect(isEngineJobKind("change.analyse")).toBe(true);
    expect(ENGINE_JOB_KIND_LABEL["change.analyse"]).toBe("Change analysis");
    expect(ENGINE_JOB_OUTPUTS["change.analyse"]).toEqual(["ChangeRequest"]);
    expect(JOB_MAX_RUN_MS["change.analyse"]).toBeGreaterThan(0);
  });
});

describe("checkChangeForBuild", () => {
  const cr = { title: "T", description: "D" };
  const key = (o: Parameters<typeof checkChangeForBuild>[0], dev = 1) => { const r = checkChangeForBuild(o, dev); return r.ok ? null : r.messageKey; };
  it("builds only an approved change on the fast route", () => {
    expect(key({ ...cr, status: "approved", route: "fast" })).toBeNull();
    expect(key({ ...cr, status: "draft", route: null })).toBe("delivery.cr.notApproved");
    expect(key({ ...cr, status: "review", route: "fast" })).toBe("delivery.cr.notApproved");
    expect(key({ ...cr, status: "approved", route: "scope" })).toBe("delivery.cr.scopeRoute");
    expect(key({ ...cr, status: "approved", route: null })).toBe("delivery.cr.notApproved");
    expect(key({ ...cr, status: "approved", route: "fast" }, 0)).toBe("delivery.cr.noDevRelease");
  });
  it("a failed build of an approved change may run again; a failed analysis may not build", () => {
    expect(key({ ...cr, status: "failed", route: "fast", decidedAt: FX.now })).toBeNull();
    expect(key({ ...cr, status: "failed", route: "fast", decidedAt: null })).toBe("delivery.cr.notApproved");
    expect(key({ ...cr, status: "building", route: "fast", lastBuildFailed: true })).toBeNull();
    expect(key({ ...cr, status: "building", route: "fast", lastBuildFailed: false })).toBe("delivery.cr.notApproved");
    expect(key({ ...cr, status: "building", route: "scope", lastBuildFailed: true })).toBe("delivery.cr.scopeRoute");
    expect(key({ ...cr, status: "building", route: null, lastBuildFailed: true })).toBe("delivery.cr.notApproved");
  });
});

describe("the approver rule (same as releases)", () => {
  it("policy approvers who are active; every active member without a policy", () => {
    expect(changeApproverIds([{ approverUserIds: ["a", "b"] }, { approverUserIds: ["b", "gone"] }], ["a", "b", "c"])).toEqual(["a", "b"]);
    expect(changeApproverIds([], ["a", "c"])).toEqual(["a", "c"]);
    expect(changeApproverIds([{ approverUserIds: ["gone"] }], ["a"])).toEqual(["a"]);
  });
  it("the requester decides only as the only approver", () => {
    const m = ["a", "b"];
    expect(changeDecideRight("a", { requesterId: "a", approverIds: ["a"], activeMemberIds: m })).toEqual({ ok: true, self: true });
    expect(changeDecideRight("a", { requesterId: "a", approverIds: ["a", "b"], activeMemberIds: m })).toEqual({ ok: false, reason: "ownRequest", others: ["b"] });
    expect(changeDecideRight("b", { requesterId: "a", approverIds: ["a", "b"], activeMemberIds: m })).toEqual({ ok: true, self: false });
    expect(changeDecideRight("b", { requesterId: "a", approverIds: ["a"], activeMemberIds: m })).toMatchObject({ ok: false, reason: "notApprover" });
  });
});

// ------------------------------------------------------------------ the ops

type CrSeed = { Status: string; Lane?: string; Analysis?: string; DecidedAt?: string; RequestedByUserId?: string; Description?: string; Number?: number };

/** v1.0.0 on dev, one ticket on the board, and one change request. `approvers` seeds a stage policy. */
function world(cr: CrSeed, o: { approvers?: string[]; devRelease?: boolean } = {}) {
  const w = createFakeWorld();
  if (o.devRelease !== false) {
    w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  }
  w.seed("Ticket", {
    ProjectId: FX.project, Number: 7, PlanRef: "plan:7", Title: "Existing", TicketType: "story", FeatureRef: "", MilestoneId: "",
    AgentRole: "shipper", Column: "done", SortOrder: 0, Description: "", IsDone: true, Source: "plan", ...stamps,
  });
  if (o.approvers) {
    const policy = w.seed("ApprovalPolicy", { ProjectId: FX.project, Environment: "stage", Status: "active", ...stamps });
    w.seed("ApprovalStep", {
      ProjectId: FX.project, ParentType: "policy", ParentId: policy.ItemId, StepKey: stepKeyFor(0, "architect"), StepType: "architect", Label: "",
      Required: true, ApproverUserIds: [...o.approvers], SortOrder: 0, ...stamps,
    });
  }
  const row = w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: cr.Number ?? 1, Lane: cr.Lane ?? "change", FeatureRef: "feature:orders", Title: "Delivery window",
    Description: cr.Description ?? "Show the delivery window on the order list.", Status: cr.Status, Version: "",
    RequestedByUserId: cr.RequestedByUserId ?? FX.owner,
    ...(cr.Analysis !== undefined ? { Analysis: cr.Analysis } : {}),
    ...(cr.DecidedAt !== undefined ? { DecidedAt: cr.DecidedAt } : {}),
    ...stamps,
  });
  return { w, crId: String(row.ItemId) };
}

const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-1`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });
type Ans = Awaited<ReturnType<typeof call>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : {});
const crRow = (w: FakeWorld, id: string) => w.rows("ChangeRequest").find((r) => r.ItemId === id)!;

describe("the registry", () => {
  it("has the new ops", () => {
    expect(deliveryOps["cr.submit"]).toBe(crSubmitOp);
    expect(deliveryOps["cr.answer"]).toBe(crAnswerOp);
    expect(deliveryOps["cr.decide"]).toBe(crDecideOp);
  });
});

describe("cr.submit", () => {
  it("draft -> analysing, and queues change.analyse for this change request", async () => {
    const { w, crId } = world({ Status: "draft" });
    const a = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(data(a)).toMatchObject({ changeRequestId: crId, status: "analysing", existing: false });
    expect(crRow(w, crId).Status).toBe("analysing");
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ kind: "change.analyse", input: { projectId: FX.project, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId } });
    expect(w.audits.find((x) => x.action === "cr.submit")).toMatchObject({ targetId: crId, details: { refine: false, from: "draft" } });
  });

  it("a second click answers with the queued job", async () => {
    const { w, crId } = world({ Status: "draft" });
    const first = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId });
    const again = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId }, "r-cr.submit-2");
    expect(data(again)).toMatchObject({ jobId: data(first).jobId, existing: true });
    expect(w.jobs).toHaveLength(1);
  });

  it("refuses a change that is past draft, has no description, or comes before the first dev release", async () => {
    for (const status of ["analysing", "questions", "review", "approved", "rejected", "building", "released-dev"]) {
      const { w, crId } = world({ Status: status });
      expect(err(await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId })), status).toMatchObject({ code: "conflict", messageKey: "delivery.cr.notDraft" });
    }
    const empty = world({ Status: "draft", Description: "" });
    expect(err(await call(empty.w, crSubmitOp, "cr.submit", { changeRequestId: empty.crId }))).toMatchObject({ messageKey: "delivery.cr.needsTitleAndDescription" });
    const early = world({ Status: "draft" }, { devRelease: false });
    expect(err(await call(early.w, crSubmitOp, "cr.submit", { changeRequestId: early.crId }))).toMatchObject({ messageKey: "delivery.cr.noDevRelease" });
    const other = world({ Status: "draft" });
    expect(err(await call(other.w, crSubmitOp, "cr.submit", { changeRequestId: "nope" }))).toMatchObject({ code: "not_found" });
  });

  it("a failed analysis with no analysis yet is sent again as a fresh change.analyse job (a new attempt)", async () => {
    const { w, crId } = world({ Status: "draft" });
    const first = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId });
    // the engine fails the job and sets the change to failed, without writing an analysis
    await w.ports.update("EngineJob", data(first).jobId, { Status: "failed" });
    await w.ports.update("ChangeRequest", crId, { Status: "failed" });
    const again = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId }, "r-cr.submit-2");
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(data(again)).toMatchObject({ status: "analysing", existing: false });
    expect(data(again).jobId).not.toBe(data(first).jobId);
    expect(w.jobs.map((j) => j.dedupeKey)).toEqual([`change.analyse:${crId}:1`, `change.analyse:${crId}:2`]);
    expect(w.jobs[1].input).toEqual({ projectId: FX.project, changeRequestId: crId });
    expect(crRow(w, crId).Status).toBe("analysing");
  });

  it("a failed analysis is sent again; with every question answered it is refined", async () => {
    const fresh = world({ Status: "failed" });
    expect(data(await call(fresh.w, crSubmitOp, "cr.submit", { changeRequestId: fresh.crId }))).toMatchObject({ status: "analysing" });
    expect(fresh.w.jobs[0].input).toEqual({ projectId: FX.project, changeRequestId: fresh.crId });
    const refined = world({ Status: "failed", Analysis: serializeChangeAnalysis(answered(analysisWith())) });
    await call(refined.w, crSubmitOp, "cr.submit", { changeRequestId: refined.crId });
    expect(refined.w.jobs[0].input).toEqual({ projectId: FX.project, changeRequestId: refined.crId, refine: true });
    // a failed build (decided) is not sent back to analysis
    const built = world({ Status: "failed", DecidedAt: FX.now });
    expect(err(await call(built.w, crSubmitOp, "cr.submit", { changeRequestId: built.crId }))).toMatchObject({ messageKey: "delivery.cr.notDraft" });
  });

  it.each(guardCases(crSubmitOp.permission))("guard: $name", async ({ userId, superAdmin, code }) => {
    const { w, crId } = world({ Status: "draft" });
    w.as(userId, { superAdmin });
    const a = await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId });
    if (code === null) expect(a.ok, JSON.stringify(a)).toBe(true);
    else expect(err(a)?.code).toBe(code);
  });
});

describe("cr.answer", () => {
  const q = () => serializeChangeAnalysis(analysisWith());

  it("saves answers; the last one re-queues the analysis with refine and the status stays questions", async () => {
    const { w, crId } = world({ Status: "questions", Analysis: q() });
    const one = await call(w, crAnswerOp, "cr.answer", { changeRequestId: crId, answers: [{ id: "q1", answer: "Date only" }] });
    expect(one.ok, JSON.stringify(one)).toBe(true);
    expect(data(one)).toMatchObject({ complete: false, jobId: null, answered: 1 });
    expect(parseChangeAnalysis(crRow(w, crId).Analysis)!.questions[0]).toMatchObject({ answer: "Date only", answeredBy: FX.owner, answeredAt: FX.now });
    expect(w.jobs).toHaveLength(0);

    const two = await call(w, crAnswerOp, "cr.answer", { changeRequestId: crId, answers: [{ id: "q2", answer: "Only on large screens" }] }, "r-cr.answer-2");
    expect(data(two)).toMatchObject({ complete: true, status: "questions" });
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ kind: "change.analyse", input: { projectId: FX.project, changeRequestId: crId, refine: true } });
    expect(crRow(w, crId).Status).toBe("questions");
    expect(w.audits.filter((x) => x.action === "cr.answer").map((x) => x.details.complete)).toEqual([false, true]);

    // while the refinement runs, the answers are locked
    const three = await call(w, crAnswerOp, "cr.answer", { changeRequestId: crId, answers: [{ id: "q1", answer: "Date and time" }] }, "r-cr.answer-3");
    expect(err(three)).toMatchObject({ code: "conflict", messageKey: "delivery.cr.analysing" });
  });

  it("refuses outside questions, without an analysis, and bad answers", async () => {
    const review = world({ Status: "review", Analysis: q() });
    expect(err(await call(review.w, crAnswerOp, "cr.answer", { changeRequestId: review.crId, answers: [{ id: "q1", answer: "x" }] }))).toMatchObject({ messageKey: "delivery.cr.notQuestions" });
    const none = world({ Status: "questions" });
    expect(err(await call(none.w, crAnswerOp, "cr.answer", { changeRequestId: none.crId, answers: [{ id: "q1", answer: "x" }] }))).toMatchObject({ messageKey: "delivery.cr.noAnalysis" });
    const bad = world({ Status: "questions", Analysis: q() });
    expect(err(await call(bad.w, crAnswerOp, "cr.answer", { changeRequestId: bad.crId, answers: [{ id: "q9", answer: "x" }] }))).toMatchObject({ messageKey: "delivery.cr.unknownQuestion", params: { field: "answers.0" } });
    expect(err(await call(bad.w, crAnswerOp, "cr.answer", { changeRequestId: bad.crId, answers: "q1" }, "r2"))).toMatchObject({ code: "invalid_input", params: { field: "answers" } });
    expect(err(await call(bad.w, crAnswerOp, "cr.answer", { changeRequestId: bad.crId, answers: [{ id: "q1", answer: "x" }], extra: 1 }, "r3"))).toMatchObject({ code: "invalid_input" });
  });
});

describe("cr.decide", () => {
  const review = (a: ChangeAnalysis = analysisWith({ questions: [] })) => serializeChangeAnalysis(a);
  const decide = (w: FakeWorld, crId: string, decision: string, note?: string, requestId = `d-${decision}`) =>
    call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision, ...(note !== undefined ? { note } : {}) }, requestId);

  it("the requester as the only approver approves it themselves: SelfApproved, audited, and the planned tickets are on the board", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    const a = await decide(w, crId, "approve", "Fine for the next release.");
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(data(a)).toMatchObject({ status: "approved", selfApproved: true, route: "fast" });
    const cr = crRow(w, crId);
    expect(cr).toMatchObject({ Status: "approved", DecidedAt: FX.now, DecidedByUserId: FX.owner, DecisionNote: "Fine for the next release.", SelfApproved: true });
    const tickets = w.rows("Ticket").filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.Number) - Number(y.Number));
    expect(tickets.map((t) => [t.Number, t.PlanRef, t.Title, t.Column, t.Source, t.TicketType])).toEqual([
      [8, `cr:${crId}:0`, "Delivery window column", "planned", "change-request", "fix"],
      [9, `cr:${crId}:1`, "Phone layout of the order list", "planned", "change-request", "fix"],
    ]);
    expect(tickets[0]).toMatchObject({ FeatureRef: "feature:orders", AgentRole: "dev", IsDone: false, Description: "Add the column.", Acceptance: SPEC_SAMPLE.acceptanceCriteria, WorkspaceId: FX.ws });
    expect(data(a).ticketIds).toEqual(tickets.map((t) => t.ItemId));
    expect(w.rows("TicketEvent").map((e) => e.Text)).toEqual(["Created in Planned: Delivery window column.", "Created in Planned: Phone layout of the order list."]);
    expect(w.audits.find((x) => x.action === "cr.decide")).toMatchObject({ targetId: crId, details: { decision: "approve", selfApproved: true, reason: "only approver", tickets: 2 } });
  });

  it("another approver exists: the requester is refused and the other approver approves (not a self-approval)", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner, FX.customWith] });
    expect(err(await decide(w, crId, "approve"))).toMatchObject({ code: "forbidden", messageKey: "delivery.cr.ownRequest", params: { approvers: 1 } });
    expect(crRow(w, crId).Status).toBe("review");
    w.as(FX.customWith);
    const a = await decide(w, crId, "approve", undefined, "d-2");
    expect(data(a)).toMatchObject({ status: "approved", selfApproved: false });
    expect(crRow(w, crId)).toMatchObject({ DecidedByUserId: FX.customWith, SelfApproved: false });
  });

  it("someone outside the approver list is refused", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.customWith] });
    w.as(FX.member);
    expect(err(await decide(w, crId, "approve"))).toMatchObject({ code: "forbidden", messageKey: "delivery.cr.notApprover" });
  });

  it("without a policy every active member approves, so the requester cannot while others can", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() });
    expect(err(await decide(w, crId, "approve"))).toMatchObject({ messageKey: "delivery.cr.ownRequest" });
    w.as(FX.member);
    expect(data(await decide(w, crId, "approve", undefined, "d-2"))).toMatchObject({ status: "approved", selfApproved: false });
  });

  it("a scope-route change approved as a change (route fast): the decision is recorded, the tickets planned, the build may start", async () => {
    const scope = serializeChangeAnalysis(analysisWith({ questions: [], scopeChange: true, conflicts: ["The locked scope's hero has two buttons"] }));
    const { w, crId } = world({ Status: "review", Analysis: scope }, { approvers: [FX.owner] });
    expect(parseChangeAnalysis(scope)!.route).toBe("scope");
    const a = await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve", route: "fast" }, "d-fast");
    expect(data(a)).toMatchObject({ status: "approved", route: "fast" });
    const stored = parseChangeAnalysis(crRow(w, crId).Analysis)!;
    // the analysis keeps its own words; the route follows the person's decision
    expect(stored).toMatchObject({ route: "fast", scopeChange: true, routeDecision: { route: "fast", by: FX.owner, at: FX.now } });
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(2);
    expect(checkChangeForBuild({ status: "approved", title: "x", description: "y", route: stored.route }, 1).ok).toBe(true);
    expect(w.audits.find((x) => x.action === "cr.decide")!.details).toMatchObject({ route: "fast", routeDecision: "fast", from: "review" });
  });

  it("an approved scope-route change never dead-ends: it can be built as a change later, and a repeat answers what is stored", async () => {
    const scope = serializeChangeAnalysis(analysisWith({ questions: [], kind: "feature" }));
    const { w, crId } = world({ Status: "approved", Analysis: scope, DecidedAt: FX.now }, { approvers: [FX.owner] });
    expect(checkChangeForBuild({ status: "approved", title: "x", description: "y", route: "scope" }, 1).ok).toBe(false);
    expect(err(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }, "d-0"))).toMatchObject({ messageKey: "delivery.cr.notInReview" });
    expect(data(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve", route: "fast" }, "d-1"))).toMatchObject({ status: "approved", route: "fast" });
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(2);
    expect(parseChangeAnalysis(crRow(w, crId).Analysis)).toMatchObject({ kind: "feature", route: "fast" });
    expect(data(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve", route: "fast" }, "d-2"))).toMatchObject({ status: "approved", route: "fast" });
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(2);
    expect(err(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "reject", route: "fast" }, "d-3"))).toBeTruthy();
  });

  it("reject: rejected with the note, no tickets, audited", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    const a = await decide(w, crId, "reject", "Not now.");
    expect(data(a)).toMatchObject({ status: "rejected", selfApproved: false, ticketIds: [] });
    expect(crRow(w, crId)).toMatchObject({ Status: "rejected", DecisionNote: "Not now.", SelfApproved: false, DecidedByUserId: FX.owner });
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(0);
    expect(w.audits.find((x) => x.action === "cr.decide")!.details).toMatchObject({ decision: "reject", selfApproved: false });
  });

  it("a scope-route change is approved without tickets; it cannot build", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review(analysisWith({ kind: "feature", questions: [] })) }, { approvers: [FX.owner] });
    expect(data(await decide(w, crId, "approve"))).toMatchObject({ status: "approved", route: "scope", ticketIds: [] });
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(0);
    const b = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(err(b)).toMatchObject({ code: "conflict", messageKey: "delivery.cr.scopeRoute" });
  });

  it("a fix gets change.build's fix tickets (fx:<n>:<id>, fix source)", async () => {
    const { w, crId } = world({ Status: "review", Lane: "fix", Number: 4, Analysis: review(analysisWith({ kind: "fix", questions: [] })) }, { approvers: [FX.owner] });
    await decide(w, crId, "approve");
    const tickets = w.rows("Ticket").filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.SortOrder) - Number(y.SortOrder));
    expect(tickets.map((t) => [t.PlanRef, t.Source, t.TicketType])).toEqual([[`fx:4:${crId}`, "fix", "fix"], [`fx:4:${crId}:1`, "fix", "fix"]]);
    expect(tickets[0].Description).toBe("FX-4 · Add the column.");
  });

  it("a number taken meanwhile is skipped; tickets already linked are not made twice", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    // the first insert clashes on (ProjectId, Number): that ticket takes the next free number after a fresh read
    w.failNextInsert("Ticket", w.duplicateKeyError());
    const a = await decide(w, crId, "approve");
    expect(a.ok, JSON.stringify(a)).toBe(true);
    const mine = w.rows("Ticket").filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.SortOrder) - Number(y.SortOrder));
    expect(mine.map((t) => [t.SortOrder, t.Number])).toEqual([[0, 10], [1, 9]]);

    const again = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    again.w.seed("Ticket", {
      ProjectId: FX.project, Number: 20, PlanRef: `cr:${again.crId}:0`, Title: "Earlier", TicketType: "fix", FeatureRef: "", MilestoneId: "",
      AgentRole: "planner", Column: "planned", SortOrder: 0, Description: "", IsDone: false, Source: "change-request", ChangeRequestId: again.crId, ...stamps,
    });
    const b = await decide(again.w, again.crId, "approve");
    expect(data(b).ticketIds).toHaveLength(1);
    expect(again.w.rows("Ticket").filter((t) => t.ChangeRequestId === again.crId)).toHaveLength(1);
  });

  it("only a change in review is decided; open questions and missing analyses are refused", async () => {
    for (const status of ["draft", "analysing", "questions", "approved", "rejected", "building", "failed"]) {
      const { w, crId } = world({ Status: status, Analysis: review() }, { approvers: [FX.owner] });
      expect(err(await decide(w, crId, "approve")), status).toMatchObject({ code: "conflict", messageKey: "delivery.cr.notInReview" });
    }
    const open = world({ Status: "review", Analysis: review(analysisWith()) }, { approvers: [FX.owner] });
    expect(err(await decide(open.w, open.crId, "approve"))).toMatchObject({ messageKey: "delivery.cr.openQuestions" });
    const none = world({ Status: "review" }, { approvers: [FX.owner] });
    expect(err(await decide(none.w, none.crId, "approve"))).toMatchObject({ messageKey: "delivery.cr.noAnalysis" });
    const bad = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    expect(err(await decide(bad.w, bad.crId, "maybe"))).toMatchObject({ code: "invalid_input", params: { field: "decision" } });
    expect(err(await decide(bad.w, bad.crId, "approve", "x".repeat(2001), "d-long"))).toMatchObject({ messageKey: "delivery.cr.noteTooLong" });
  });

  it("a replay answers the same and writes nothing more", async () => {
    const { w, crId } = world({ Status: "review", Analysis: review() }, { approvers: [FX.owner] });
    const a = await decide(w, crId, "approve");
    const writes = w.writes.length;
    const b = await decide(w, crId, "approve");
    expect(b).toEqual(a);
    expect(w.writes.length).toBe(writes);
  });

  it.each(guardCases(crDecideOp.permission))("guard: $name", async ({ userId, superAdmin, code }) => {
    const { w, crId } = world({ Status: "review", Analysis: review(), RequestedByUserId: FX.member }, { approvers: [FX.owner, FX.member, FX.viewer, FX.customWith, FX.customWithout] });
    w.as(userId, { superAdmin });
    const a = await decide(w, crId, "approve");
    // the guard passes; a passing caller is then an approver unless it is the requester (member)
    if (code !== null) expect(err(a)?.code).toBe(code);
    else if (userId === FX.member) expect(err(a)?.messageKey).toBe("delivery.cr.ownRequest");
    else expect(a.ok, `${userId} ${JSON.stringify(a)}`).toBe(true);
  });
});

describe("cr.startBuild after the change process", () => {
  it("a draft never goes straight to build", async () => {
    const { w, crId } = world({ Status: "draft" });
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }))).toMatchObject({ code: "conflict", messageKey: "delivery.cr.notApproved" });
    expect(w.jobs).toHaveLength(0);
  });

  it("an approved fast-route change builds: building, version, change.build queued", async () => {
    const { w, crId } = world({ Status: "approved", Analysis: serializeChangeAnalysis(analysisWith({ questions: [] })), DecidedAt: FX.now });
    const a = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(crRow(w, crId)).toMatchObject({ Status: "building", Version: "1.1.0" });
    expect(w.jobs[0]).toMatchObject({ kind: "change.build", input: { projectId: FX.project, changeRequestId: crId } });
  });

  it("a failed build of an approved change builds again; a failed analysis does not", async () => {
    const built = world({ Status: "failed", Analysis: serializeChangeAnalysis(analysisWith({ questions: [] })), DecidedAt: FX.now });
    expect((await call(built.w, crStartBuildOp, "cr.startBuild", { changeRequestId: built.crId })).ok).toBe(true);
    const analysed = world({ Status: "failed" });
    expect(err(await call(analysed.w, crStartBuildOp, "cr.startBuild", { changeRequestId: analysed.crId }))).toMatchObject({ messageKey: "delivery.cr.notApproved" });
  });

  it("still building after its change.build job failed: the same approved change builds again, a new job", async () => {
    const analysis = serializeChangeAnalysis(analysisWith({ questions: [] }));
    const { w, crId } = world({ Status: "approved", Analysis: analysis, DecidedAt: FX.now });
    const first = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(crRow(w, crId).Status).toBe("building");
    // while the job runs, a second start answers with it
    const running = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "r-sb-2");
    expect(data(running)).toMatchObject({ jobId: data(first).jobId, existing: true });
    // the engine fails the job and leaves the change at "building"
    await w.ports.update("EngineJob", data(first).jobId, { Status: "failed" });
    const retry = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "r-sb-3");
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
    expect(data(retry).jobId).not.toBe(data(first).jobId);
    expect(w.jobs.map((j) => j.dedupeKey)).toEqual([`change.build:${crId}:1`, `change.build:${crId}:2`]);
    expect(crRow(w, crId).Status).toBe("building");
  });

  it("still building after its change.build job was cancelled: it builds again too", async () => {
    const { w, crId } = world({ Status: "approved", Analysis: serializeChangeAnalysis(analysisWith({ questions: [] })), DecidedAt: FX.now });
    const first = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    await w.ports.update("EngineJob", data(first).jobId, { Status: "cancelled" });
    const retry = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "r-sb-c2");
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
    expect(w.jobs.map((j) => j.dedupeKey)).toEqual([`change.build:${crId}:1`, `change.build:${crId}:2`]);
  });

  it("building without a failed job, or building on the scope route, is not a retry", async () => {
    const legacy = world({ Status: "building" });
    expect(err(await call(legacy.w, crStartBuildOp, "cr.startBuild", { changeRequestId: legacy.crId }))).toMatchObject({ messageKey: "delivery.cr.notApproved" });
    const scope = world({ Status: "building", Analysis: serializeChangeAnalysis(analysisWith({ kind: "feature", questions: [] })), DecidedAt: FX.now });
    scope.w.seed("EngineJob", {
      ProjectId: FX.project, Kind: "change.build", Status: "failed", ActiveKey: "x", TargetType: "", TargetId: "",
      InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: scope.crId }), OutputRefs: [], Progress: 0, Message: "",
      Attempts: 1, ClaimedBy: "", ErrorCode: "", RequestedByUserId: FX.owner, ...stamps,
    });
    expect(err(await call(scope.w, crStartBuildOp, "cr.startBuild", { changeRequestId: scope.crId }))).toMatchObject({ messageKey: "delivery.cr.scopeRoute" });
  });

  it("the whole way: draft -> analysing -> questions -> review -> approved -> building", async () => {
    const { w, crId } = world({ Status: "draft" }, { approvers: [FX.owner] });
    expect((await call(w, crSubmitOp, "cr.submit", { changeRequestId: crId })).ok).toBe(true);
    // the engine's part (change.analyse): write the analysis and the status, finish the job
    const job = w.rows("EngineJob")[0];
    const engine = w.ports.update;
    await engine("ChangeRequest", crId, { Analysis: serializeChangeAnalysis(analysisWith()), AnalysedAt: FX.now, Status: "questions" });
    await engine("EngineJob", job.ItemId, { Status: "succeeded" });
    expect(data(await call(w, crAnswerOp, "cr.answer", { changeRequestId: crId, answers: [{ id: "q1", answer: "Date only" }, { id: "q2", answer: "Yes" }] })).complete).toBe(true);
    const refine = w.rows("EngineJob").find((j) => j.ItemId !== job.ItemId)!;
    await engine("ChangeRequest", crId, { Status: "review" });
    await engine("EngineJob", refine.ItemId, { Status: "succeeded" });
    expect(data(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }))).toMatchObject({ status: "approved", selfApproved: true });
    expect(data(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }))).toMatchObject({ version: "1.1.0" });
    expect(crRow(w, crId).Status).toBe("building");
    expect(w.rows("Ticket").filter((t) => t.ChangeRequestId === crId)).toHaveLength(2);
  });
});

describe("existing behaviour keeps working", () => {
  it("cr.saveDraft still creates and edits a draft", async () => {
    const w = createFakeWorld();
    w.seed("Milestone", { ProjectId: FX.project, ScopeVersion: 1, Number: 1, Name: "M1", Goal: "", FeatureRefs: ["feature:orders"], SortOrder: 1, PreviewPoint: "", Status: "done", ...stamps });
    const a = await runOp(w.ports, { op: "cr.saveDraft", requestId: "s-1" }, crSaveDraftOp, { projectId: FX.project, lane: "change", featureRef: "feature:orders", title: "T", description: "D" });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(w.rows("ChangeRequest")[0].Status).toBe("draft");
  });

  it("the web parses older rows (no new fields) and new rows with the decision fields", () => {
    const base = { ItemId: "cr-1", ProjectId: FX.project, Number: 1, Lane: "change", FeatureRef: "", Title: "T", Description: "D", Version: "1.1.0", RequestedByUserId: FX.owner };
    const old = parseChangeRequest({ ...base, Status: "released-dev" });
    expect(old.ok && old.value).toMatchObject({ status: "released-dev", analysis: null, decidedAt: null, selfApproved: false });
    const now = parseChangeRequest({ ...base, Status: "approved", Version: null, Analysis: JSON.stringify(SPEC_SAMPLE), DecidedAt: FX.now, DecidedByUserId: FX.owner, DecisionNote: "ok", SelfApproved: true });
    expect(now.ok && now.value).toMatchObject({ status: "approved", decidedAt: FX.now, decidedByUserId: FX.owner, decisionNote: "ok", selfApproved: true });
    expect(now.ok && parseChangeAnalysis(now.value.analysis)?.route).toBe("fast");
    for (const s of ["analysing", "questions", "review", "rejected", "failed"]) expect(parseChangeRequest({ ...base, Status: s }).ok).toBe(true);
  });
});

describe("a new feature on a product without a Factory scope (route feature)", () => {
  const plan = {
    kind: "feature",
    questions: [],
    tickets: [
      { title: "Overdue list", description: "List overdue invoices.", increment: 1 },
      { title: "Send a reminder", description: "Send one.", increment: 2 },
      { title: "Reminder history", description: "Show them.", increment: 2 },
    ],
    feature: { basis: "existing-product", parts: { api: true, web: true, data: true }, increments: [{ title: "Find overdue invoices", goal: "" }, { title: "Send reminders", goal: "" }] },
  };

  it("cr.decide puts every increment's tickets on the board in build order, and cr.startBuild builds it", async () => {
    const { w, crId } = world({ Status: "review", Lane: "add", Analysis: serializeChangeAnalysis(analysisWith(plan)) }, { approvers: [FX.owner] });
    const a = await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }, "d-feature");
    expect(data(a)).toMatchObject({ status: "approved", route: "feature" });
    const tickets = w.rows("Ticket").filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.SortOrder) - Number(y.SortOrder));
    expect(tickets.map((t) => [t.PlanRef, t.Title, t.TicketType, t.Source])).toEqual([
      [`cr:${crId}:0`, "Overdue list", "story", "change-request"],
      [`cr:${crId}:1`, "Send a reminder", "story", "change-request"],
      [`cr:${crId}:2`, "Reminder history", "story", "change-request"],
    ]);
    const b = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId });
    expect(b.ok, JSON.stringify(b)).toBe(true);
    expect(crRow(w, crId)).toMatchObject({ Status: "building", Version: "1.1.0" });
  });

  it("the next increment gets its own job: increment 1 succeeded, increment 2 is a new change.build (not the old one)", async () => {
    const { w, crId } = world({ Status: "review", Lane: "add", Analysis: serializeChangeAnalysis(analysisWith(plan)) }, { approvers: [FX.owner] });
    await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }, "d-inc");
    const first = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "sb-inc-1");
    // the engine finishes increment 1 and puts the change back to approved for the next one
    await w.ports.update("EngineJob", data(first).jobId, { Status: "succeeded" });
    await w.ports.update("ChangeRequest", crId, { Status: "approved" });
    const second = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "sb-inc-2");
    expect(second.ok, JSON.stringify(second)).toBe(true);
    expect(data(second)).toMatchObject({ existing: false });
    expect(data(second).jobId).not.toBe(data(first).jobId);
    expect(w.jobs.map((j) => j.dedupeKey)).toEqual([`change.build:${crId}:1`, `change.build:${crId}:2`]);
  });

  it("left at building after its last increment succeeded (a start that queued nothing): the next increment starts", async () => {
    const { w, crId } = world({ Status: "review", Lane: "add", Analysis: serializeChangeAnalysis(analysisWith(plan)) }, { approvers: [FX.owner] });
    await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }, "d-stuck");
    const first = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "sb-stuck-1");
    await w.ports.update("EngineJob", data(first).jobId, { Status: "succeeded" });
    expect(crRow(w, crId).Status).toBe("building");
    const next = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }, "sb-stuck-2");
    expect(next.ok, JSON.stringify(next)).toBe(true);
    expect(data(next).jobId).not.toBe(data(first).jobId);
    expect(w.jobs).toHaveLength(2);
  });

  it("the same feature without its plan (a product with a scope) still goes through Scope & success", async () => {
    const { feature: _f, ...scoped } = plan;
    const { w, crId } = world({ Status: "review", Lane: "add", Analysis: serializeChangeAnalysis(analysisWith(scoped)) }, { approvers: [FX.owner] });
    expect(data(await call(w, crDecideOp, "cr.decide", { changeRequestId: crId, decision: "approve" }, "d-scoped"))).toMatchObject({ status: "approved", route: "scope", ticketIds: [] });
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crId }))).toMatchObject({ messageKey: "delivery.cr.scopeRoute" });
  });
});

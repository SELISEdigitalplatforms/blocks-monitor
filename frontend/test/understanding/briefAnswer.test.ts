// Step 1 of Business Analysis after the hand-over ("Objective and the people who will use it"): the answer is recorded
// with the business analyst's own brief question in ONE call (clarification.answerBrief), through the real client
// caller and the real router. Live case of 08.11.2026: the box called clarification.save, then read the new row's id
// from the wrong place of the answer ({ data } was not unwrapped), so every attempt showed "Something went wrong" and
// left one more open copy of the question, with the generic suggested answers, in "A few questions".
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { SANITIZATION_DEFS } from "../../functions/project/ops/sanitization/register";
import { createFunctionCaller, FunctionError } from "../../src/blocks/fn";
import { FUNCTION_IDS, resolveFunction } from "../../src/blocks/functions";
import { SANITIZATION_OP_SCHEMAS } from "../../src/blocks/sanitization/ops";
import { briefAnswers, briefFacts, briefQuestions } from "../../src/domain/projectBrief";

const ME = { userId: "member-1", email: "member@selisegroup.com" };
const VIEWER = { userId: "viewer-1", email: "viewer@selisegroup.com" };
const NAME = "Design test – Clinic appointment booking";
const GOAL = "Let our patients book, move and cancel physio appointments themselves on their phones, so the front desk spends less time on the phone.";
const USERS = "Patients on their phones, and the front desk team on the clinic's computers.";

async function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }] });
  const ops = [...PROJECT_OPS, ...SANITIZATION_DEFS];
  // the web app's own caller, posting to the real router (as the local function host does)
  const callerOf = (who: typeof ME) => createFunctionCaller({
    request: (() => { throw new Error("Host B is not used here"); }) as never,
    sleep: async () => undefined,
    now: () => Date.now(),
    resolve: (n) => resolveFunction(n, FUNCTION_IDS, "local"),
    post: async (_path, body) => {
      const r = await runOp("project", ops, { ctx: fakeCtx(who), gateway, request: body as Record<string, unknown> });
      return { status: r.status, body: r.body };
    },
  });
  const call = callerOf(ME);
  // since 08.11 Project Setup asks for neither: a word or two is too thin, so step 1 asks for both
  const made = await call<{ project: { ItemId: string } }>("project", "project.create", { workspaceId, name: NAME, goal: "Bookings", targetUsers: "Patients" });
  const projectId = made.data.project.ItemId;
  const project = gateway.rows("Project").find((p) => p.ItemId === projectId)!;
  seedRow(gateway, "DocNote", {
    WorkspaceId: workspaceId, ReaderIds: project.ReaderIds, ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId,
    Title: "Kick-off", BodyMd: "Patients book physio online.", SortOrder: 1, IsScratchPad: false,
  });
  await call("project", "business.handOver", { projectId });
  const q = briefQuestions(NAME);
  const rows = () => gateway.rows("Clarification").filter((r) => r.ProjectId === projectId && r.IsDeleted !== true);
  const asked = () => rows().map((r) => ({ Question: String(r.Question), Answer: String(r.Answer ?? ""), Status: String(r.Status) }));
  const projectRow = () => gateway.rows("Project").find((p) => p.ItemId === projectId)!;
  return { gateway, call, viewer: callerOf(VIEWER), projectId, q, rows, asked, projectRow };
}

describe("step 1: the objective and the users after the hand-over", () => {
  it("one call records the answer with the business analyst's question, where What we understood and the engine read it", async () => {
    const { call, projectId, q, rows, asked, projectRow } = await setup();
    expect(briefAnswers({ name: NAME, goal: "Bookings", users: "Patients", asked: asked() }).missing).toEqual(["goal", "users"]);

    const res = await call<{ clarification: Record<string, unknown> }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL });
    expect(res.data.clarification).toMatchObject({ Question: q.goal, Answer: GOAL, Status: "answered", AnsweredByUserId: ME.userId });
    expect(rows().filter((r) => r.Question === q.goal)).toHaveLength(1);
    expect(rows().filter((r) => r.Status === "open")).toHaveLength(0); // never an open question without its answer

    await call("project", "clarification.answerBrief", { projectId, about: "users", answer: USERS });
    // the Business Analysis page (briefAnswers) and every engine kind (briefFacts) read the same answers
    expect(briefAnswers({ name: NAME, goal: "Bookings", users: "Patients", asked: asked() })).toEqual({ goal: GOAL, users: USERS, missing: [] });
    const facts = briefFacts(projectRow(), { clarifications: rows() });
    expect(facts.goal).toBe(GOAL);
    expect(facts.targetUsers).toBe(USERS);
  });

  it("a retry writes nothing new, and new words replace the answer in the same record", async () => {
    const { gateway, call, projectId, q, rows } = await setup();
    const first = await call<{ clarification: { ItemId: string } }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL });
    const id = first.data.clarification.ItemId;
    const audits = () => gateway.rows("AuditEvent").filter((e) => e.Action === "clarification.answer").length;
    const before = audits();
    // the same answer again (a new request, e.g. after a lost connection): the one record answers it
    const again = await call<{ clarification: { ItemId: string } }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL });
    expect(again.data.clarification.ItemId).toBe(id);
    expect(rows().filter((r) => r.Question === q.goal)).toHaveLength(1);
    expect(audits()).toBe(before + 1);
    const changed = await call<{ clarification: { ItemId: string; Answer: string } }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: `${GOAL} And fewer missed appointments.` });
    expect(changed.data.clarification.ItemId).toBe(id);
    expect(rows().filter((r) => r.Question === q.goal).map((r) => r.Answer)).toEqual([`${GOAL} And fewer missed appointments.`]);
  });

  it("a refused answer writes nothing", async () => {
    const { call, viewer, projectId, rows } = await setup();
    const refused = async (p: Promise<unknown>, code: string) => {
      const e = await p.then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(FunctionError);
      expect((e as FunctionError).code).toBe(code);
    };
    await refused(call("project", "clarification.answerBrief", { projectId, about: "goal", answer: "   " }), "invalid_input");
    await refused(call("project", "clarification.answerBrief", { projectId, about: "goal", answer: "x".repeat(2001) }), "invalid_input");
    await refused(call("project", "clarification.answerBrief", { projectId, about: "budget", answer: GOAL }), "invalid_input");
    await refused(viewer("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL }), "forbidden");
    expect(rows()).toHaveLength(0);
  });

  it("the open copies the two-call box left are folded into the one answer (a copy a decision names stays)", async () => {
    const { gateway, call, projectId, q, rows } = await setup();
    // what the box did before: clarification.save for every attempt, the answer never landed
    const copies: string[] = [];
    for (let i = 0; i < 3; i++) {
      const saved = await call<{ clarification: { ItemId: string } }>("project", "clarification.save", { projectId, question: q.goal });
      copies.push(saved.data.clarification.ItemId);
    }
    await call("project", "decision.save", { projectId, title: "Online booking first", decisionText: "Patients book online first.", clarificationId: copies[2] });
    expect(rows().filter((r) => r.Status === "open")).toHaveLength(3);

    const res = await call<{ clarification: { ItemId: string }; removed?: string[] }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL });
    expect(res.data.clarification.ItemId).toBe(copies[0]);
    expect(res.data.removed).toEqual([copies[1]]);
    const left = rows().filter((r) => r.Question === q.goal);
    expect(left.map((r) => [r.ItemId, r.Status])).toEqual([[copies[0], "answered"], [copies[2], "open"]]);
    expect(gateway.rows("Decision").find((d) => d.ClarificationId === copies[2])).toBeTruthy();
  });

  it("an answer that comes after the first requirements queues their refresh, so the objective follows it", async () => {
    const { gateway, call, projectId } = await setup();
    const project = gateway.rows("Project").find((p) => p.ItemId === projectId)!;
    for (const j of gateway.rows("EngineJob")) gateway.update("EngineJob", String(j.ItemId), { Status: "succeeded", ActiveKey: String(j.ItemId) });
    const stamp = { WorkspaceId: project.WorkspaceId, ReaderIds: project.ReaderIds, ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
    seedRow(gateway, "EngineJob", { ...stamp, Kind: "requirements.draft", Status: "succeeded", ActiveKey: "draft-1", InputJson: JSON.stringify({ projectId, refs: { clarificationIds: [] } }), Progress: 100, Attempts: 1, RequestedByUserId: ME.userId, Message: "" });
    seedRow(gateway, "Requirement", { ...stamp, Number: 1, Key: "booking", Title: "Patients book online", Text: "", Category: "functional", Priority: "must", Status: "draft", AcceptanceCriteria: ["A booking is confirmed"], SourceRefs: [], SpecVersion: 1, SortOrder: 1000 });

    const res = await call<{ draftJobId?: string }>("project", "clarification.answerBrief", { projectId, about: "goal", answer: GOAL });
    const refresh = gateway.rows("EngineJob").find((j) => j.ItemId === res.data.draftJobId);
    expect(refresh).toMatchObject({ Kind: "requirements.draft", Status: "queued" });
    expect(JSON.parse(String(refresh!.InputJson)).purpose).toBe("refresh");
  });

  it("the web app's hook clears the questions and the jobs it may change", () => {
    expect(SANITIZATION_OP_SCHEMAS["clarification.answerBrief"]).toEqual(["Clarification", "EngineJob"]);
  });
});

// The design intent carries what the project is about after Project Setup stopped asking for the goal and the users
// (08.11): the description from the Project brief note, the goal and the users from the business analyst's brief
// questions answered in Business Analysis, the objective statement as the last goal. The functions (the op that
// queues design.generate, the client's context) and the engine (its stale checks) read the same records.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { DESIGN_OPS } from "../../functions/project/ops/design";
import { REQUIREMENT_OPS } from "../../functions/project/ops/requirements";
import { designIntent, designIntentOf, designProject, designSourceCurrent, designSources, designSourcesOf, factoryDesignSource } from "../../src/domain/factoryDesign";
import { screenPreviewPath } from "../../src/domain/figmaScreens";
import { briefMarkdown, briefQuestions } from "../../src/domain/projectBrief";

const NAME = "Field services";
const DESCRIPTION = "A booking tool for our repair technicians and their customers.";
const GOAL_ANSWER = "Let customers book a repair visit online without calling us";
const USERS_ANSWER = "Our service desk, the technicians, and customers on their phones";
const q = briefQuestions(NAME);
const note = (o: Record<string, unknown> = {}) => ({
  ItemId: "n1", IsProjectBrief: true,
  BodyMd: briefMarkdown({ name: NAME, existing: false, description: DESCRIPTION, goal: "", targetUsers: "" }), ...o,
});
const answered = (Number: number, Question: string, Answer: string, Status = "answered") => ({ ItemId: `c${Number}`, Number, Question, Answer, Status });

describe("designProject: the project part of the design intent", () => {
  it("fills Brief, Goal and TargetUsers from the brief note and the answered brief questions", () => {
    const p = designProject({ Name: NAME, Goal: "", TargetUsers: "", Brief: "" }, { Statement: "Book repairs online" }, {
      notes: [note(), { ItemId: "n0", IsScratchPad: true, BodyMd: "## About the project\n\nScratch words" }],
      clarifications: [answered(1, "How many bookings a day?", "About 40"), answered(2, q.goal, GOAL_ANSWER), answered(3, q.users, USERS_ANSWER)],
    });
    expect(p).toEqual({ Goal: GOAL_ANSWER, TargetUsers: USERS_ANSWER, Brief: DESCRIPTION, SetupWorkflows: "", SetupExclusions: "", SetupConstraints: "", SetupMustHaves: "" });
  });
  it("keeps the project's own fields when they say enough, and the saved setup details as stored", () => {
    const project = { Name: NAME, Goal: "Reduce double bookings across all branches", TargetUsers: "Dispatchers at every branch", Brief: "Own brief",
      SetupMustHaves: '[{"text":"Calendar","priority":"must"}]', SetupWorkflows: '["Desk books a visit"]', SetupExclusions: '["Payments"]', SetupConstraints: '[]' };
    const p = designProject(project, { Statement: "Something else" }, { notes: [note()], clarifications: [answered(1, q.goal, GOAL_ANSWER), answered(2, q.users, USERS_ANSWER)] });
    expect(p).toEqual({ Goal: project.Goal, TargetUsers: project.TargetUsers, Brief: "Own brief", SetupMustHaves: project.SetupMustHaves,
      SetupWorkflows: project.SetupWorkflows, SetupExclusions: project.SetupExclusions, SetupConstraints: project.SetupConstraints });
  });
  it("takes the answer over a thin goal, the objective when nothing else says it, and ignores open or deleted answers", () => {
    expect(designProject({ Name: NAME, Goal: "Sell online" }, null, { clarifications: [answered(1, q.goal, GOAL_ANSWER)] }).Goal).toBe(GOAL_ANSWER);
    expect(designProject({ Name: NAME, Goal: "Sell online" }, { Statement: "Book repairs online" }, {}).Goal).toBe("Sell online");
    const p = designProject({ Name: NAME }, { Statement: "  Book repairs online " }, {
      notes: [note({ IsDeleted: true })],
      clarifications: [answered(1, q.goal, GOAL_ANSWER, "open"), { ...answered(2, q.users, USERS_ANSWER), IsDeleted: true }],
    });
    expect(p).toMatchObject({ Goal: "Book repairs online", TargetUsers: "", Brief: "" });
  });
  it("leaves a project without these records exactly as before (its design source does not change)", () => {
    const project = { Name: NAME, Goal: "Reduce double bookings across all branches", TargetUsers: "", Brief: "" };
    const before = { version: 1, project: { Goal: project.Goal, TargetUsers: "", Brief: "", SetupWorkflows: "", SetupExclusions: "", SetupConstraints: "", SetupMustHaves: "" },
      objective: { statement: "", criteria: [] }, requirements: [], extras: [] };
    expect(designIntent(project, null, [], [], { notes: [], clarifications: [] })).toEqual(before);
    expect(designIntent(project, null, [], [])).toEqual(before);
  });
});

describe("the design intent through the ops and the engine's rows", () => {
  const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
  function setup() {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    // past the hand-over: no goal or users on the project, the description only in the Project brief note
    const { projectId } = seedProject(gateway, { workspaceId, Name: NAME, Stage: "requirements", CreatedByUserId: ME.userId, Goal: "", TargetUsers: "", Brief: "" });
    const own = { ProjectId: projectId, WorkspaceId: workspaceId, ReaderIds: [ME.userId] };
    seedRow(gateway, "DocNote", { ...own, FolderId: "", Title: "Project brief", BodyMd: note().BodyMd, SortOrder: 0, IsScratchPad: false, IsProjectBrief: true });
    seedRow(gateway, "DocNote", { ...own, FolderId: "", Title: "Scratch pad", BodyMd: "Call the client on Monday", SortOrder: 0, IsScratchPad: true, IsProjectBrief: false });
    seedRow(gateway, "Clarification", { ...own, Number: 1, Question: q.goal, Answer: GOAL_ANSWER, Status: "answered" });
    seedRow(gateway, "Clarification", { ...own, Number: 2, Question: q.users, Answer: USERS_ANSWER, Status: "answered" });
    seedRow(gateway, "Clarification", { ...own, Number: 3, Question: "Which regions?", Answer: "", Status: "open" });
    seedRow(gateway, "Objective", { ...own, Statement: "Repairs are booked online", AcceptanceCriteria: ["A booking is confirmed by e-mail"], Status: "draft" });
    seedRow(gateway, "Requirement", { ...own, Key: "book-visit", Number: 1, Title: "Book a visit", Text: "Customers pick a slot.", AcceptanceCriteria: ["The slot is held"], Priority: "must", Status: "draft", SortOrder: 0 });
    seedRow(gateway, "DesignBrief", { ...own, Mode: "figma", Instructions: "Calm", Status: "draft" });
    const call = (op: string, args: Record<string, unknown>, ops: unknown = DESIGN_OPS) => runOp("project", ops, { ctx: fakeCtx({ ...ME, env: { FACTORY_DESIGN_WORKER_ID: "factory-worker-1" } }), gateway, request: { op, args: { projectId, ...args } } });
    // the engine's ProjectView over the same rows
    const view = {
      project: gateway.rows("Project").find((r) => r.ItemId === projectId)!,
      objective: () => gateway.rows("Objective")[0],
      requirements: () => gateway.rows("Requirement"),
      rows: (schema: string) => gateway.rows(schema).filter((r) => r.ProjectId === projectId),
    };
    return { gateway, call, view, projectId };
  }

  it("queues design.generate with the recorded facts, and the client and the engine compute the same source", async () => {
    const t = setup();
    const res = await t.call("designBrief.generate", { workflow: "factory" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const input = JSON.parse(String(t.gateway.rows("EngineJob").find((j) => j.Kind === "design.generate")!.InputJson));
    expect(input.intent.project).toEqual({ Goal: GOAL_ANSWER, TargetUsers: USERS_ANSWER, Brief: DESCRIPTION, SetupWorkflows: "", SetupExclusions: "", SetupConstraints: "", SetupMustHaves: "" });
    const context = await t.call("designBrief.context", {});
    expect(context.status).toBe(200);
    expect(context.body.data.intent).toEqual(input.intent);
    expect(context.body.data.source).toBe(input.source);
    expect(factoryDesignSource(designIntentOf(t.view))).toBe(input.source);
  });
});

// A design made before the intent read the Project brief note and the brief answers (efa41697, 08.11) carries the
// source of the intent as it was then: the project's own Goal, TargetUsers and Brief only. Reading those records since
// is no change of the project, so it never makes such a design out of date by itself (on DEV it flagged every approved
// design of an existing project and forced a paid revision); a change of what that intent read still does. The
// functions, the client (through designBrief.context) and the engine judge it by the same rule.
describe("a design made before the intent read the brief note and the answers", () => {
  const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
  const OLD_KEYS = ["Goal", "TargetUsers", "Brief", "SetupWorkflows", "SetupExclusions", "SetupConstraints", "SetupMustHaves"];
  /** The design source exactly as it was worked out before 08.11 (the project's own fields, nothing else). */
  const oldSource = (project: Record<string, unknown>, objective: Record<string, unknown>, requirements: Record<string, unknown>[]) =>
    factoryDesignSource({ version: 1, project: Object.fromEntries(OLD_KEYS.map((k) => [k, project[k] ?? ""])),
      objective: { statement: String(objective.Statement), criteria: objective.AcceptanceCriteria as string[] },
      requirements: requirements.map((r) => ({ key: String(r.Key), title: String(r.Title), text: String(r.Text), criteria: r.AcceptanceCriteria as string[] })), extras: [] });
  function setup(status: "draft" | "confirmed", made: "before" | "now" = "before") {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    const { projectId } = seedProject(gateway, { workspaceId, Name: NAME, Stage: "requirements", CreatedByUserId: ME.userId, Goal: "", TargetUsers: "", Brief: "" });
    const own = { ProjectId: projectId, WorkspaceId: workspaceId, ReaderIds: [ME.userId] };
    const noteId = seedRow(gateway, "DocNote", { ...own, FolderId: "", Title: "Project brief", BodyMd: note().BodyMd, SortOrder: 0, IsScratchPad: false, IsProjectBrief: true });
    seedRow(gateway, "Clarification", { ...own, Number: 1, Question: q.goal, Answer: GOAL_ANSWER, Status: "answered" });
    seedRow(gateway, "Clarification", { ...own, Number: 2, Question: q.users, Answer: USERS_ANSWER, Status: "answered" });
    seedRow(gateway, "Objective", { ...own, Statement: "Repairs are booked online", AcceptanceCriteria: ["A booking is confirmed by e-mail"], Status: "draft" });
    const requirementId = seedRow(gateway, "Requirement", { ...own, Key: "book-visit", Number: 1, Title: "Book a visit", Text: "Customers pick a slot.", AcceptanceCriteria: ["The slot is held"], Priority: "must", Status: "draft", SortOrder: 0 });
    const rows = (schema: string) => gateway.rows(schema).filter((r) => r.ProjectId === projectId);
    const view = { project: gateway.rows("Project").find((r) => r.ItemId === projectId)!, objective: () => rows("Objective")[0], requirements: () => rows("Requirement"), rows };
    const source = made === "before" ? oldSource(view.project, rows("Objective")[0]!, rows("Requirement")) : factoryDesignSource(designIntentOf(view));
    const revision = "c".repeat(64);
    const prototype = { provider: "figma-design", projectId, projectUrl: "https://www.figma.com/design/abc/Screens", previewUrl: screenPreviewPath(projectId, revision), revision,
      source, jobId: "j1", artifactFileId: "f1", screens: [{ name: "Book a visit", nodeId: "1:2", requirementKeys: ["book-visit"] }] };
    const briefId = seedRow(gateway, "DesignBrief", { ...own, Mode: "figma", Instructions: "Calm", Status: status, PrototypeJson: JSON.stringify(prototype),
      ...(status === "confirmed" ? { ConfirmedByUserId: ME.userId, ConfirmedAt: "2026-11-07T10:00:00.000Z" } : {}) });
    const call = (op: string, ops: unknown = DESIGN_OPS) => runOp("project", ops, { ctx: fakeCtx(ME), gateway, request: { op, args: { projectId } } });
    const brief = () => gateway.rows("DesignBrief").find((r) => r.ItemId === briefId)!;
    return { gateway, call, view, source, brief, noteId, requirementId };
  }

  it("works out the old source beside the current one, alike in the functions, the client and the engine", async () => {
    const t = setup("confirmed");
    const context = await t.call("designBrief.context");
    expect(context.status).toBe(200);
    expect(context.body.data.legacySource).toBe(t.source);
    expect(context.body.data.source).not.toBe(t.source); // the description, goal and users are read now
    expect(context.body.data.source).toBe(factoryDesignSource(context.body.data.intent));
    expect(designSourcesOf(t.view)).toEqual({ source: context.body.data.source, legacySource: context.body.data.legacySource });
    expect(designSourceCurrent(t.source, context.body.data)).toBe(true);
  });

  it("keeps an approved design current: the requirements are approved without a new revision", async () => {
    const t = setup("confirmed");
    const res = await t.call("requirements.confirm", REQUIREMENT_OPS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stage).toBe("scope");
  });

  it("lets a design waiting for approval be approved as it is", async () => {
    const t = setup("draft");
    const res = await t.call("designBrief.confirm");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(t.brief().Status).toBe("confirmed");
  });

  it("makes it out of date once something it was made from changes", async () => {
    const t = setup("draft");
    t.gateway.update("Requirement", t.requirementId, { Text: "Customers pick a slot and a technician." } as never);
    const refused = await t.call("designBrief.confirm");
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ messageKey: "design.notConfirmable", params: { reason: "prototype_stale" } });
    const approved = setup("confirmed");
    approved.gateway.update("Project", approved.view.project.ItemId as string, { Goal: "Cut the phone queue at the service desk in half" } as never);
    const context = await approved.call("designBrief.context");
    expect(designSourceCurrent(approved.source, context.body.data)).toBe(false);
    expect((await approved.call("requirements.confirm", REQUIREMENT_OPS)).body.error).toMatchObject({ messageKey: "design.notConfirmable" });
  });

  it("judges a design made now by today's records only: a changed description makes it out of date", async () => {
    const t = setup("draft", "now");
    const context = await t.call("designBrief.context");
    expect(context.body.data.source).toBe(t.source);
    t.gateway.update("DocNote", t.noteId, { BodyMd: briefMarkdown({ name: NAME, existing: false, description: "Repair visits and spare parts for our branches.", goal: "", targetUsers: "" }) } as never);
    const after = await t.call("designBrief.context");
    expect(designSourceCurrent(t.source, after.body.data)).toBe(false);
    expect((await t.call("designBrief.confirm")).status).toBe(400);
  });

  it("never takes a missing, pending or empty source for a current one", () => {
    const sources = designSources(designIntent({ Goal: "Reduce double bookings across all branches" }, null, [], []), { Goal: "Reduce double bookings across all branches" });
    expect(sources.legacySource).toBe(sources.source); // a project with its own fields keeps one source
    for (const stored of [undefined, null, "", "pending:job-1"]) expect(designSourceCurrent(stored, sources)).toBe(false);
    expect(designSourceCurrent(sources.source, undefined)).toBe(false);
    expect(designSourceCurrent(sources.source, { source: sources.source })).toBe(true);
  });
});

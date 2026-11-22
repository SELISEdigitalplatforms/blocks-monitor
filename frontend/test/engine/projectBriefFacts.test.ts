// What the project is about, as every engine kind reads it (src/domain/projectBrief.ts briefFacts). Since 08.11 Project
// Setup no longer asks for the goal or the users: the description lives in the "Project brief" note and, after the
// hand-over, the business analyst's two brief questions are answered as Clarification rows. Each kind gets those facts
// for such a project, and a project with its own fields reads exactly as before.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/projectBriefFacts.test.ts
import { describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { ProjectView } from "../../server/local/engine/context.ts";
import type { RowStore } from "../../server/local/rowStore.ts";
import type { JobRun } from "../../server/local/engine/run.ts";
import { briefFacts, briefFactsOf, briefMarkdown, briefQuestions } from "../../src/domain/projectBrief";
import { designIntentOf } from "../../src/domain/factoryDesign";
import { descriptionOf, hasSetup, setupLines, setupOf } from "../../server/local/engine/kinds/analysis/setup.ts";
import { readFacts } from "../../server/local/engine/kinds/analysis/facts.ts";
import { planQuestions } from "../../server/local/engine/kinds/analysis/clarify.ts";
import { landingContext } from "../../server/local/engine/kinds/analysis/landing.ts";
import { draftInputOf } from "../../server/local/engine/kinds/scope/draft.ts";
import { factsOf } from "../../server/local/engine/kinds/scope/success.ts";
import { loadFacts } from "../../server/local/engine/kinds/collab/facts.ts";
import { findingsContextOf } from "../../server/local/engine/kinds/setup.ts";
import { productBrief } from "../../server/local/engine/build/prompt.ts";
import { buildSections } from "../../server/engine-context/snapshot.ts";

const PID = "p1";
const WS = "ws1";
const NAME = "Field services";
const DESCRIPTION = "A booking tool for our repair technicians and their customers.";
const GOAL = "Let customers book a repair visit online without calling us";
const USERS = "Our service desk, the technicians, and customers on their phones";
const OWN_GOAL = "Reduce double bookings across all branches";
const OWN_USERS = "Dispatchers at every branch and the field technicians";
const OWN_BRIEF = "A dispatch board for the branches.";
const q = briefQuestions(NAME);

const own = { ProjectId: PID, WorkspaceId: WS };
const briefNote = (o: Row = {}): Row => ({
  ...own, ItemId: "n1", Title: "Project brief", IsProjectBrief: true, IsScratchPad: false,
  BodyMd: briefMarkdown({ name: NAME, existing: false, description: DESCRIPTION, goal: "", targetUsers: "" }), ...o,
});
const answer = (n: number, Question: string, Answer: string, Status = "answered"): Row => ({ ...own, ItemId: `c${n}`, Number: n, Question, Answer, Status });

function storeOf(tables: Record<string, Row[]>): RowStore {
  return {
    rows: (s: string) => tables[s] ?? [],
    get: (s: string, id: string) => (tables[s] ?? []).find((r) => r.ItemId === id),
  } as unknown as RowStore;
}

/** A project past the hand-over: no goal, users or brief of its own; the note and the analyst's answers say them. */
function newProject(o: { answers?: boolean; project?: Row; notes?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    Project: [{ ItemId: PID, WorkspaceId: WS, Name: NAME, ClientName: "Rapid Repairs", Stage: "scope", CurrentScopeVersion: 1, Goal: "", TargetUsers: "", Brief: "", ...o.project }],
    DocNote: o.notes ?? [briefNote(), { ...own, ItemId: "n2", Title: "Scratch pad", IsScratchPad: true, BodyMd: "Call the client on Monday" }],
    Clarification: o.answers === false ? [] : [answer(1, q.goal, GOAL), answer(2, q.users, USERS), answer(3, "Which regions?", "", "open")],
    Objective: [{ ...own, ItemId: "o1", Statement: "Repairs are booked online", AcceptanceCriteria: [] }],
    Requirement: [{ ...own, ItemId: "r1", Key: "book-visit", Number: 1, Title: "Book a visit", Text: "Customers pick a slot.", Priority: "must", Status: "draft", SortOrder: 0, AcceptanceCriteria: ["The slot is held"] }],
    Feature: [{ ...own, ItemId: "f1", Key: "booking", Title: "Booking", Description: "Customers book a visit", ScopeVersion: 1, SortOrder: 0, Status: "included" }],
  };
  const p = new ProjectView(storeOf(tables), PID);
  const run = { id: "job-1", input: {}, p, projectId: PID, workspaceId: WS, requester: "u1", deps: { store: p.store } } as unknown as JobRun;
  return { p, run, tables };
}
/** The same project before 08.11: its own goal, users and brief (the answers would not change them). */
const ownProject = () => newProject({ project: { Goal: OWN_GOAL, TargetUsers: OWN_USERS, Brief: OWN_BRIEF } });

describe("briefFacts: the one rule", () => {
  it("reads the description from the Project brief note and the goal and the users from the analyst's answers", () => {
    expect(briefFactsOf(newProject().p)).toEqual({ description: DESCRIPTION, goal: GOAL, targetUsers: USERS });
  });
  it("keeps the project's own fields when they say enough", () => {
    expect(briefFactsOf(ownProject().p)).toEqual({ description: OWN_BRIEF, goal: OWN_GOAL, targetUsers: OWN_USERS });
  });
  it("takes the answer over a thin field, never an open, deleted or unrelated answer", () => {
    expect(briefFacts({ Name: NAME, Goal: "Sell online" }, { clarifications: [answer(1, q.goal, GOAL)] }).goal).toBe(GOAL);
    expect(briefFacts({ Name: NAME, Goal: "Sell online" }, {}).goal).toBe("Sell online");
    expect(briefFacts({ Name: NAME }, {
      clarifications: [answer(1, q.goal, GOAL, "open"), { ...answer(2, q.users, USERS), IsDeleted: true }, answer(3, "Who approves it?", USERS)],
    })).toEqual({ description: "", goal: "", targetUsers: "" });
  });
  it("finds a note a person titled Project brief when the guided start wrote none, never a scratch pad or a deleted note", () => {
    const body = briefMarkdown({ name: NAME, existing: false, description: DESCRIPTION, goal: "", targetUsers: "" });
    expect(briefFacts({ Name: NAME }, { notes: [{ ItemId: "a", Title: "Project brief", BodyMd: body }] }).description).toBe(DESCRIPTION);
    expect(briefFacts({ Name: NAME }, { notes: [{ ItemId: "a", Title: "Project brief", IsScratchPad: true, BodyMd: body }] }).description).toBe("");
    expect(briefFacts({ Name: NAME }, { notes: [briefNote({ IsDeleted: true })] }).description).toBe("");
  });
  it("leaves the design intent reading only the flagged note, as the functions do", () => {
    const body = briefMarkdown({ name: NAME, existing: false, description: DESCRIPTION, goal: "", targetUsers: "" });
    const { p } = newProject({ notes: [{ ...own, ItemId: "a", Title: "Project brief", BodyMd: body }] });
    expect(briefFactsOf(p).description).toBe(DESCRIPTION);
    expect(designIntentOf(p).project.Brief).toBe("");
    expect(designIntentOf(newProject().p).project).toMatchObject({ Brief: DESCRIPTION, Goal: GOAL, TargetUsers: USERS });
  });
});

describe("Business Analysis (analysis/setup.ts, facts, questions)", () => {
  it("setupOf and descriptionOf read the note and the answers", () => {
    const { p } = newProject();
    expect(setupOf(p)).toMatchObject({ goal: GOAL, targetUsers: USERS });
    expect(descriptionOf(p)).toBe(DESCRIPTION);
    expect(hasSetup(setupOf(p))).toBe(true);
    expect(setupLines(setupOf(p))).toEqual(expect.arrayContaining([
      expect.objectContaining({ heading: "Goal", kind: "wish" }),
      { text: `${USERS}.`, kind: "fact", heading: "Who will use it" },
    ]));
    expect(readFacts(p).lines.some((l) => l.source.type === "brief" && l.heading === "Goal")).toBe(true);
  });
  it("a project with its own fields reads them as before", () => {
    const { p } = ownProject();
    expect(setupOf(p)).toMatchObject({ goal: OWN_GOAL, targetUsers: OWN_USERS });
    expect(descriptionOf(p)).toBe(OWN_BRIEF);
  });
  it("never asks the objective or the users again once the analyst recorded the answers", () => {
    const { run } = newProject();
    expect(planQuestions(run).map((x) => x.topic)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^setup-(goal|users)$/)]));
    expect(planQuestions(run, { only: "setup-goal" })).toEqual([]);
    expect(planQuestions(run, { only: "setup-users" })).toEqual([]);
    // without the answers (and without the analyst's questions) the objective is still asked
    expect(planQuestions(newProject({ answers: false, notes: [] }).run).map((x) => x.topic)).toContain("setup-goal");
  });
});

describe("the landing page section (analysis/landing.ts)", () => {
  it("is written from the note's description and the answers", () => {
    const { run, p } = newProject();
    expect(landingContext(run, p.project)).toMatchObject({ name: NAME, description: DESCRIPTION, goal: GOAL, users: USERS });
  });
  it("keeps the project's own fields", () => {
    const { run, p } = ownProject();
    expect(landingContext(run, p.project)).toMatchObject({ description: OWN_BRIEF, goal: OWN_GOAL, users: OWN_USERS });
  });
});

describe("Scope & success (scope/draft.ts, scope/success.ts) and the scope board's team facts", () => {
  it("the draft and the targets read the note and the answers", () => {
    const { run, p } = newProject();
    expect(draftInputOf(run).targetUsers).toBe(USERS);
    expect(factsOf(run, 1)).toMatchObject({ goal: GOAL, targetUsers: USERS, brief: DESCRIPTION });
    expect(loadFacts(p).brief).toBe(DESCRIPTION);
  });
  it("a project with its own fields drafts from them", () => {
    const { run, p } = ownProject();
    expect(draftInputOf(run).targetUsers).toBe(OWN_USERS);
    expect(factsOf(run, 1)).toMatchObject({ goal: OWN_GOAL, targetUsers: OWN_USERS, brief: OWN_BRIEF });
    expect(loadFacts(p).brief).toBe(OWN_BRIEF);
  });
});

describe("Project setup's document reading (kinds/setup.ts)", () => {
  it("does not suggest a goal or users the analyst already has", () => {
    expect(findingsContextOf(newProject().p)).toMatchObject({ productName: NAME, goal: GOAL, users: USERS });
    expect(findingsContextOf(newProject({ answers: false }).p)).toMatchObject({ goal: "", users: "" });
    expect(findingsContextOf(ownProject().p)).toMatchObject({ goal: OWN_GOAL, users: OWN_USERS });
  });
});

describe("the project context (engine-context/snapshot.ts) and the build prompt (build/prompt.ts)", () => {
  it("the basics carry the description, goal and users", () => {
    expect(buildSections({ p: newProject().p, kbDir: null, projectDir: null }).basics).toMatchObject({ description: DESCRIPTION, goal: GOAL, targetUsers: USERS });
    expect(buildSections({ p: ownProject().p, kbDir: null, projectDir: null }).basics).toMatchObject({ description: OWN_BRIEF, goal: OWN_GOAL, targetUsers: OWN_USERS });
  });
  it("the product part of the build prompt names the users and the brief", () => {
    const fresh = productBrief(newProject().p);
    expect(fresh).toContain(`- Users: ${USERS}`);
    expect(fresh).toContain(`## Brief\n${DESCRIPTION}`);
    const before = productBrief(ownProject().p);
    expect(before).toContain(`- Users: ${OWN_USERS}`);
    expect(before).toContain(`## Brief\n${OWN_BRIEF}`);
  });
});

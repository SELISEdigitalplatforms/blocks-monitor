// The requirements refresh (requirements.draft, purpose "refresh") rewrites what nobody changed: the engine's own
// earlier writes (the first draft, an earlier refresh) are not "edited by the team", a person's real change is, and the
// objective follows the person's own objective answer while nobody edited it. Without Claude's answer the refresh
// stops plainly (ai.failed) and changes nothing: no built-in wording is written. Live case of 08.11.2026: two refreshes
// ended in 0.3 s with "The team has edited the requirements already" because an earlier refresh had rewritten the rows.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/refreshEdits.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { AI_FAILED_CODE, AI_FAILED_MESSAGE, setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { editedByPerson } from "../../server/local/engine/kinds/analysis/edited.ts";
import { briefFacts, briefQuestions } from "../../src/domain/projectBrief";
import { makeWorld, type World } from "./harness";

// These tests drive the focused AI calls; the planner agent mode (analysis/agent.ts) is off here, as on a host without
// the official engine's planner AGENT.md.
vi.mock("../../server/local/engine/kinds/analysis/agent.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), hasAgentPlanner: () => false }));


const s = (v: unknown) => (typeof v === "string" ? v : "");
const props = (r: AiRequest): string[] => Object.keys((r.schema as { properties?: object }).properties ?? {});
const PROJECT = "Supplier Quality Portal";
const GOAL = "Suppliers upload their certificates and temperature logs themselves, so our quality team finds problems before the goods arrive.";

let worlds: World[] = [];
afterEach(async () => {
  setAiRunner(null);
  await Promise.all(worlds.map((w) => w.close()));
  worlds = [];
});

const req = (title: string) => ({
  title, text: `${title}, as the quality team agreed.`, category: "functional", priority: "must",
  acceptanceCriteria: [`${title} works for every supplier`, `${title} is refused when data is missing`], sources: [],
});
const objective = (statement: string) => ({
  statement,
  acceptanceCriteria: ["Suppliers keep their documents up to date themselves", "The quality team sees every open issue"],
  highLevelMd: `## Goal\n- ${statement}\n\n## Users\n- Suppliers and the quality team`,
  architectureMd: "## Components\n- A web portal with sign-in, records and file storage",
  lookAndFeel: "Calm, clear screens for suppliers on laptops and for the quality team in the office.",
  workflows: [], notIncluded: [], constraints: [],
});
/** Claude's answers for the next job: the requirements and the objective (null: Claude has no answer). */
const answer = (reqs: string[] | null, statement: string | null) =>
  setAiRunner(async (r) => {
    const k = props(r);
    if (k.includes("requirements")) return reqs ? { requirements: reqs.map(req) } : null;
    if (k.includes("statement")) return statement ? objective(statement) : null;
    throw new Error(`unexpected ${k.join(",")}`);
  });

async function world() {
  const w = await makeWorld({ engine: { waitScale: () => 0, backgroundProgress: true, pickupDelay: false } });
  worlds.push(w);
  const p = w.project(PROJECT);
  const pid = s(p.ItemId);
  // since 08.11 Project Setup no longer asks for the goal: it comes from the business analyst's own question
  await w.gw.update("Project", pid, { Goal: "" });
  const run = async (key: string, purpose = "") => {
    const id = await w.queue({ project: PROJECT, kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, ...(purpose ? { purpose } : {}) }, key });
    await w.settle();
    const job = w.get("EngineJob", id);
    if (job.Status !== "succeeded") throw new Error(`job ${s(job.Status)}: ${s(job.Message)}\n${w.log.join("\n")}`);
    return job;
  };
  /** Everything the first draft wrote happened 40 s before the refreshes (as on the platform), not a moment before. */
  const earlier = (jobId: string) => {
    const back = (v: unknown) => new Date(Date.parse(s(v)) - 40_000).toISOString();
    for (const schema of ["Requirement", "Objective"]) {
      for (const r of w.rows(schema, pid)) w.store.update(schema, [s(r.ItemId)], { CreatedDate: back(r.CreatedDate), LastUpdatedDate: back(r.LastUpdatedDate) });
    }
    const job = w.get("EngineJob", jobId);
    w.store.update("EngineJob", [jobId], { CreatedDate: back(job.CreatedDate), LastUpdatedDate: back(job.LastUpdatedDate) });
  };
  /** The person's answer to "What is the main objective of …?", recorded as clarification.answerBrief does. */
  const answerGoal = async (by: string) => {
    const top = w.rows("Clarification", pid).reduce((m, r) => Math.max(m, Number(r.Number) || 0), 0);
    await w.gw.insert("Clarification", {
      ProjectId: pid, WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: "test:brief:goal",
      Number: top + 1, Question: briefQuestions(PROJECT).goal, Answer: GOAL, Status: "answered", OwnerUserId: "", SourceType: "", SourceRef: "",
      AnsweredByUserId: by, AnsweredAt: new Date().toISOString(),
    });
  };
  const reqs = () => w.rows("Requirement", pid).sort((a, b) => Number(a.Number) - Number(b.Number));
  const objectiveRow = () => w.rows("Objective", pid)[0]!;
  return { w, p, pid, run, earlier, answerGoal, reqs, objectiveRow };
}

describe("the requirements refresh and the team's edits", () => {
  it("an earlier refresh's own writes are not the team's edits: the next refresh rewrites them and the objective follows the answer", async () => {
    const { w, p, run, earlier, answerGoal, reqs, objectiveRow } = await world();
    answer(["Suppliers upload certificates", "Quality team reviews issues", "Monthly supplier report"], "The analyst's first wording of the portal's purpose for Alpine Fresh.");
    const first = await run("first");
    expect(reqs()).toHaveLength(3);
    earlier(s(first.ItemId));

    answer(["Suppliers upload certificates and logs", "Quality team follows up issues", "Monthly supplier scorecard"], "The analyst's second wording, written before the objective was answered.");
    const second = await run("second", "refresh");
    expect(s(second.Message)).toMatch(/^Updated the requirements with/);
    expect(objectiveRow().Statement).toBe("The analyst's second wording, written before the objective was answered.");

    // the person answers the objective later; nobody edited the requirements or the objective
    await answerGoal(s(p.CreatedByUserId));
    const statement = `${GOAL} The portal is for Alpine Fresh's suppliers and its quality team.`;
    answer(["Suppliers upload certificates and temperature logs", "Quality team finds problems before delivery", "Supplier scorecard each month"], statement);
    const third = await run("third", "refresh");
    expect(s(third.Message), w.log.join("\n")).toMatch(/^Updated the requirements with/);
    expect(s(third.Message)).not.toMatch(/edited/);
    expect(reqs().map((r) => r.Title)).toEqual(["Suppliers upload certificates and temperature logs", "Quality team finds problems before delivery", "Supplier scorecard each month"]);
    expect(objectiveRow().Statement).toBe(statement);
    expect(third.OutputRefs).toContain(`Objective:${s(objectiveRow().ItemId)}`);
  });

  it("a person's real change stays: another person's save, or a later save of the requester's", async () => {
    const { w, pid, run, earlier, reqs, objectiveRow } = await world();
    answer(["Suppliers upload certificates", "Quality team reviews issues", "Monthly supplier report"], "The analyst's first wording of the portal's purpose for Alpine Fresh.");
    const first = await run("first");
    earlier(s(first.ItemId));
    answer(["Suppliers upload certificates and logs", "Quality team follows up issues", "Monthly supplier scorecard"], "The analyst's second wording, written before the objective was answered.");
    await run("second", "refresh");

    const [a, b, c] = reqs();
    const later = new Date(Date.now() + 120_000).toISOString();
    // b: someone else saved it; c and the objective: the requester saved them a while after the refresh
    await w.gw.update("Requirement", s(b!.ItemId), { Text: "Anna's own words.", UpdatedByUserId: "someone-else" });
    await w.gw.update("Requirement", s(c!.ItemId), { Text: "The requester's own words.", LastUpdatedDate: later });
    await w.gw.update("Objective", s(objectiveRow().ItemId), { Statement: "Our own objective, written by the team.", LastUpdatedDate: later });
    const jobs = w.rows("EngineJob", pid);
    expect(editedByPerson(w.get("Requirement", s(a!.ItemId)), "Requirement", jobs)).toBe(false);
    expect(editedByPerson(w.get("Requirement", s(b!.ItemId)), "Requirement", jobs)).toBe(true);
    expect(editedByPerson(w.get("Requirement", s(c!.ItemId)), "Requirement", jobs)).toBe(true);
    expect(editedByPerson(objectiveRow(), "Objective", jobs)).toBe(true);

    answer(["Suppliers upload certificates and temperature logs"], "A statement the team must not get over their own.");
    const third = await run("third", "refresh");
    expect(s(third.Message)).toMatch(/^Updated the requirements with/);
    expect(w.get("Requirement", s(a!.ItemId)).Title).toBe("Suppliers upload certificates and temperature logs");
    expect(w.get("Requirement", s(b!.ItemId)).Text).toBe("Anna's own words.");
    expect(w.get("Requirement", s(c!.ItemId)).Text).toBe("The requester's own words.");
    expect(objectiveRow().Statement).toBe("Our own objective, written by the team.");
  });

  it("without Claude's answer the refresh stops plainly and changes nothing (no objective in built-in wording)", async () => {
    const { w, p, pid, run, earlier, answerGoal, reqs, objectiveRow } = await world();
    answer(["Suppliers upload certificates", "Quality team reviews issues", "Monthly supplier report"], "The analyst's first wording of the portal's purpose for Alpine Fresh.");
    const first = await run("first");
    earlier(s(first.ItemId));
    answer(["Suppliers upload certificates and logs", "Quality team follows up issues", "Monthly supplier scorecard"], "The analyst's second wording, written before the objective was answered.");
    await run("second", "refresh");
    const titles = reqs().map((r) => r.Title);
    const statement = s(objectiveRow().Statement);

    await answerGoal(s(p.CreatedByUserId));
    expect(briefFacts(w.get("Project", pid), { clarifications: w.rows("Clarification", pid) }).goal).toBe(GOAL);
    answer(null, null);
    const id = await w.queue({ project: PROJECT, kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, purpose: "refresh" }, key: "third" });
    await w.settle();
    const third = w.get("EngineJob", id);
    expect(third.Status).toBe("failed");
    expect(third.ErrorCode).toBe(AI_FAILED_CODE);
    expect(third.Message).toBe(AI_FAILED_MESSAGE);
    expect(reqs().map((r) => r.Title)).toEqual(titles); // the requirements wait for Claude
    expect(s(objectiveRow().Statement)).toBe(statement); // and so does the objective
  });

  it("a row a person created is theirs; an engine row nobody touched is not edited", () => {
    const jobs: Row[] = [{ ItemId: "j1", Kind: "requirements.draft", Status: "succeeded", LastUpdatedDate: "2026-11-09T04:54:11.685Z", OutputRefs: ["Requirement:r1"] }];
    const row = (o: Row): Row => ({ ItemId: "r1", RequestKey: "engine:j1:1:r-1", CreatedByUserId: "u1", UpdatedByUserId: "u1", CreatedDate: "2026-11-09T04:54:05.000Z", LastUpdatedDate: "2026-11-09T04:54:05.000Z", ...o });
    expect(editedByPerson(row({}), "Requirement", jobs)).toBe(false);
    expect(editedByPerson(row({ RequestKey: "requirement:abc" }), "Requirement", jobs)).toBe(true);
    // rewritten by a later refresh (it names the row in its outputs): still the engine's
    const refreshed = [...jobs, { ItemId: "j2", Kind: "requirements.draft", Status: "succeeded", LastUpdatedDate: "2026-11-09T04:54:51.538Z", OutputRefs: ["Requirement:r1"] }];
    expect(editedByPerson(row({ LastUpdatedDate: "2026-11-09T04:54:50.000Z" }), "Requirement", refreshed)).toBe(false);
    expect(editedByPerson(row({ LastUpdatedDate: "2026-11-09T04:54:50.000Z" }), "Requirement", jobs)).toBe(true);
    // a save minutes after the last job that wrote it
    expect(editedByPerson(row({ LastUpdatedDate: "2026-11-09T04:58:00.000Z" }), "Requirement", refreshed)).toBe(true);
  });
});

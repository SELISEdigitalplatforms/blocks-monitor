// A new feature on an existing product without a Factory scope, on the engine with a stub runner instead of the Claude
// CLI: change.analyse asks for a feature delivery (increments, parts) against the product as it is today and stores
// route "feature"; change.build builds one increment per run (the request goes back to "approved" between increments,
// each one released to dev), and after the last one the request is released-dev.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/featureOnExistingProduct.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { incrementsOf, parseChangeAnalysis } from "../../src/domain/changeAnalysis";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { ProjectView } from "../../server/local/engine/context.ts";
import { hasFactoryScope } from "../../server/local/engine/kinds/changes/ai.ts";
import { featureBriefOf, featureIncrementOf } from "../../server/local/engine/kinds/delivery.ts";
import { changeBlock } from "../../server/local/engine/build/prompt.ts";
import { changeBriefOf } from "../../server/local/engine/kinds/delivery.ts";
import { makeWorld, type World } from "./harness";

const PROJECT = "Service Technician Portal";
const s = (v: unknown) => (typeof v === "string" ? v : "");

let w: World;
let pid = "";
let calls: AiRequest[] = [];

beforeAll(async () => {
  w = await makeWorld();
  pid = s(w.project(PROJECT).ItemId);
  // the product as an existing one attached as it is live: no Factory scope (no features)
  for (const f of w.rows("Feature", pid)) await w.gw.update("Feature", s(f.ItemId), { IsDeleted: true });
});
afterAll(() => w?.close());
afterEach(() => {
  setAiRunner(null);
  calls = [];
});

const FEATURE_ANSWER = {
  kind: "feature",
  scopeChange: true,
  summary: "Office staff can plan recurring maintenance visits, and technicians see them in their day plan.",
  impact: { features: [], stories: [], screens: [], milestones: [] },
  conflicts: [],
  risks: ["The day plan is shared with emergency jobs; they must keep their place on top."],
  acceptanceCriteria: ["A maintenance plan creates its visits.", "The visits show in the technician's day plan.", "A cancelled plan removes its future visits."],
  tickets: [
    { title: "Maintenance plan records", description: "Store plans and their visits.", increment: 1 },
    { title: "Plan editor", description: "Create and edit a plan.", increment: 1 },
    { title: "Visits in the day plan", description: "Show the visits to technicians.", increment: 2 },
    { title: "Cancel a plan", description: "Remove future visits.", increment: 2 },
  ],
  increments: [{ title: "Plan maintenance", goal: "The office can create plans and see their visits." }, { title: "Visits for technicians", goal: "Technicians see the visits." }],
  parts: { api: true, web: true, data: true },
  questions: [],
};

describe("a new feature on an existing product", () => {
  let crId = "";

  it("is analysed as a feature delivery on the product as it is: increments, parts, route feature", async () => {
    const p = w.project(PROJECT);
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: 90, Lane: "add", FeatureRef: "", Title: "Recurring maintenance", Description: "Plan maintenance visits that repeat every few months.",
      Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: "t:cr:90",
    });
    crId = res.itemId!;
    expect(hasFactoryScope(new ProjectView(w.store, pid))).toBe(false);
    setAiRunner(async (r) => { calls.push(r); return FEATURE_ANSWER; });
    const id = await w.queue({ project: PROJECT, kind: "change.analyse", input: { projectId: pid, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId }, key: "feature-analyse" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-10).join("\n")}`).toBe("succeeded");
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain("It came to the Factory as an existing product: there is no locked scope");
    expect(prompt).toContain("Feature it is about: the product as a whole");
    expect(prompt).toContain("increments: 1 to 4 builds in order");
    expect(prompt).toContain("Locked scope: none.");
    expect((calls[0]!.schema as { required: string[] }).required).toEqual(expect.arrayContaining(["increments", "parts"]));
    const cr = w.get("ChangeRequest", crId);
    expect(cr.Status).toBe("review");
    const a = parseChangeAnalysis(cr.Analysis)!;
    expect(a).toMatchObject({ kind: "feature", route: "feature", scopeChange: false, estimate: { tickets: 4 } });
    expect(a.feature!.increments.map((i) => i.title)).toEqual(["Plan maintenance", "Visits for technicians"]);
    expect(s(job.Message)).toContain("a new feature on the existing product, 4 tickets in 2 builds");
  });

  it("builds one increment per change.build, released to dev each time; released-dev after the last", async () => {
    const cr = w.get("ChangeRequest", crId);
    const a = parseChangeAnalysis(cr.Analysis)!;
    await w.gw.update("ChangeRequest", crId, { Status: "approved", DecidedAt: "2026-11-05T10:00:00.000Z", DecidedByUserId: s(cr.RequestedByUserId), SelfApproved: true, Version: "1.4.0" });
    const first = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId }, key: "feature-build-1" });
    await w.settle();
    const job1 = w.get("EngineJob", first);
    expect(job1.Status, `${s(job1.Message)}\n${w.log.slice(-10).join("\n")}`).toBe("succeeded");
    expect(s(job1.Message)).toContain("increment 1 of 2 released to dev as 1.4.0");
    const tickets = () => w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.SortOrder) - Number(y.SortOrder));
    expect(tickets().map((t) => [t.Title, t.Column])).toEqual([
      ["Maintenance plan records", "done"], ["Plan editor", "done"], ["Visits in the day plan", "planned"], ["Cancel a plan", "planned"],
    ]);
    expect(w.get("ChangeRequest", crId).Status).toBe("approved");
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev" && r.Version === "1.4.0")).toBe(true);
    // the next build: what the page and the engine see
    const inc = featureIncrementOf(a, crId, tickets());
    expect(inc).toMatchObject({ n: 2, of: 2, final: true });
    expect(inc.rows.map((r) => r.Title)).toEqual(["Visits in the day plan", "Cancel a plan"]);

    await w.gw.update("ChangeRequest", crId, { Status: "building", Version: "1.5.0" });
    const second = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId }, key: "feature-build-2" });
    await w.settle();
    expect(w.get("EngineJob", second).Status).toBe("succeeded");
    expect(tickets().every((t) => t.Column === "done")).toBe(true);
    expect(w.get("ChangeRequest", crId).Status).toBe("released-dev");
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev" && r.Version === "1.5.0")).toBe(true);
  });

  it("the build's ask names this increment, the parts, the earlier and later ones", () => {
    const a = parseChangeAnalysis(w.get("ChangeRequest", crId).Analysis)!;
    expect(incrementsOf(a)).toHaveLength(2);
    const block = changeBlock({ ...changeBriefOf(a), feature: featureBriefOf(a, 1)! });
    expect(block).toContain("Kind: a new feature built on the existing product, increment by increment.");
    expect(block).toContain("### This build: increment 1 of 2: Plan maintenance");
    expect(block).toContain("It changes: API, web app, data.");
    expect(block).toContain("- Increment 2: Visits for technicians: Technicians see the visits.");
    expect(changeBlock({ ...changeBriefOf(a), feature: featureBriefOf(a, 2)! })).toContain("Built in the earlier increments (on dev already, keep working):\n- Increment 1: Plan maintenance");
  });
});

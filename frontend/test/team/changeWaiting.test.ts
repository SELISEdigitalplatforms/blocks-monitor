// What change requests wait for from the signed-in person is ONE rule (src/components/team/changeWaiting.ts): the Team
// panel marks its messages with it, and the Dashboard / Projects count it (src/domain/projectNow.ts). Here: the rule
// itself, and that the Team panel's "waiting for you" numbers are exactly the rule's.
import { describe, expect, it } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import type { ChangeDecideRight } from "../../src/domain/delivery";
import { ANALYSIS, NAMES, OTHER, OWNER, answered } from "../changes/fixtures";
import {
  changeWaitCount, changeWaitJobOf, changeWaitNext, changeWaitText, changesWaiting, sortChangeWaits, type ChangeWaitInput,
} from "../../src/components/team/changeWaiting";
import { analystThread, leadThread } from "../../src/components/team/teamMessages";

const cr = (o: Partial<DeliveryChangeRequest> = {}): DeliveryChangeRequest => ({
  id: "cr-1", number: 3, lane: "change", featureRef: "feature:assets", title: "Price filter", description: "Filter assets by price.",
  status: "questions", version: null, createdByUserId: OWNER, createdByName: "", analysis: JSON.stringify(ANALYSIS), analysedAt: "2026-11-07T22:20:00.000Z",
  decidedAt: null, decidedByUserId: null, decisionNote: null, selfApproved: false, ...o,
});

const job = (o: Partial<EngineJob> & Pick<EngineJob, "id" | "kind" | "status">): EngineJob => ({
  workspaceId: "w-1", projectId: "p-1", inputJson: null, outputRefs: [], progress: 0, message: null, errorCode: null, attempts: 1,
  claimedBy: null, claimedAt: null, finishedAt: null, createdBy: OWNER, createdAt: "2026-11-08T09:00:00.000Z", updatedAt: null, ...o,
});
const forCr = (id: string, more: Record<string, unknown> = {}) => JSON.stringify({ changeRequestId: id, ...more });

const approver: ChangeDecideRight = { ok: true, self: false };
const notApprover: ChangeDecideRight = { ok: false, reason: "ownRequest", others: [OTHER] };
const run = (changes: DeliveryChangeRequest[], jobs: EngineJob[], o: Partial<ChangeWaitInput> = {}) =>
  changesWaiting({ changes, jobs: jobs.map(changeWaitJobOf), canRun: true, rightOf: () => approver, ...o });

const decided = { decidedAt: "2026-11-07T22:26:00.000Z", decidedByUserId: OWNER };
const approvedAnalysis = JSON.stringify(answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }));

describe("what a change request waits for from you", () => {
  it("counts each open question for a role that may answer, none for a role that may not", () => {
    expect(run([cr()], [])).toEqual([expect.objectContaining({ kind: "answer", who: "analyst", count: 2, code: "CR-003" })]);
    expect(run([cr()], [], { canRun: false })).toEqual([]);
    // every question answered: the analysis is being refined, nothing waits
    expect(run([cr({ analysis: approvedAnalysis })], [job({ id: "a1", kind: "change.analyse", status: "running", inputJson: forCr("cr-1") })])).toEqual([]);
  });

  it("asks for the approval only of the person with the right to decide", () => {
    const review = cr({ status: "review", analysis: approvedAnalysis });
    expect(run([review], [])).toEqual([expect.objectContaining({ kind: "approve", count: 1 })]);
    expect(run([review], [], { rightOf: () => notApprover })).toEqual([]);
  });

  it("offers a stopped build (failed or cancelled) again, while nothing else builds", () => {
    const building = cr({ status: "building", analysis: approvedAnalysis, ...decided });
    const cancelled = job({ id: "b1", kind: "change.build", status: "cancelled", inputJson: forCr("cr-1") });
    expect(run([building], [cancelled])).toEqual([expect.objectContaining({ kind: "buildAgain", who: "lead", jobId: "b1" })]);
    expect(run([building], [{ ...cancelled, status: "failed" }])).toEqual([expect.objectContaining({ kind: "buildAgain", jobId: "b1" })]);
    // another build runs: it waits until that one has finished
    const other = job({ id: "m1", kind: "build.run", status: "running", inputJson: JSON.stringify({ milestoneId: "ms-1" }) });
    expect(run([building], [cancelled, other])).toEqual([]);
    // a release deploy is no build: it does not hold the start back
    const deploy = job({ id: "d1", kind: "preview.deploy", status: "running", inputJson: JSON.stringify({ environment: "stage" }) });
    expect(run([building], [cancelled, deploy])).toHaveLength(1);
    // only the newest build counts: a later one that runs is not stopped
    const later = job({ id: "b2", kind: "change.build", status: "running", inputJson: forCr("cr-1"), createdAt: "2026-11-08T10:00:00.000Z" });
    expect(run([building], [cancelled, later])).toEqual([]);
    // a run of only the steps after the deploy is never the build to start again
    expect(run([building], [{ ...cancelled, inputJson: forCr("cr-1", { afterDeploy: true }) }])).toEqual([]);
    // a role that can't start builds is not asked
    expect(run([building], [cancelled], { canRun: false })).toEqual([]);
  });

  it("asks for the go of an approved change and the restart of a stopped analysis", () => {
    const approved = cr({ status: "approved", analysis: approvedAnalysis, ...decided });
    expect(run([approved], [])).toEqual([expect.objectContaining({ kind: "startBuild", who: "lead" })]);
    const analysing = cr({ status: "analysing", analysis: null });
    const stopped = job({ id: "a1", kind: "change.analyse", status: "failed", inputJson: forCr("cr-1") });
    expect(run([analysing], [stopped])).toEqual([expect.objectContaining({ kind: "analyseAgain", who: "analyst", jobId: "a1" })]);
    expect(run([cr({ status: "failed", analysis: null })], [])).toEqual([expect.objectContaining({ kind: "analyseAgain", jobId: null })]);
  });

  it("says nothing waits for a draft, a decided, rejected or released change", () => {
    expect(run([
      cr({ id: "d", status: "draft", analysis: null }),
      cr({ id: "r", status: "rejected", analysis: approvedAnalysis, ...decided }),
      cr({ id: "x", status: "released-dev", analysis: approvedAnalysis, ...decided }),
    ], [])).toEqual([]);
  });

  it("words each wait plainly, decisions first, and names the rest in Next for you", () => {
    const waits = run([
      cr({ id: "c7", number: 7 }),
      cr({ id: "c5", number: 5, status: "review", analysis: approvedAnalysis }),
      cr({ id: "c6", number: 6, status: "building", analysis: approvedAnalysis, ...decided }),
    ], [job({ id: "b6", kind: "change.build", status: "cancelled", inputJson: forCr("c6") })]);
    expect(sortChangeWaits(waits).map((w) => changeWaitText(w).text)).toEqual([
      "CR-005 is waiting for your approval",
      "CR-007: 2 questions from your business analyst",
      "The build of CR-006 stopped. It can start again",
    ]);
    const next = changeWaitNext("p-1", waits)!;
    expect(next).toMatchObject({ title: "Approve CR-005", button: "Review", href: "/p/p-1/build?cr=5" });
    expect(next.detail).toContain("2 more change requests wait for you too.");
    for (const t of [next.title, next.detail, ...waits.map((w) => changeWaitText(w).text)]) expect(t).not.toMatch(/\bAI\b|AGIS/);
    expect(changeWaitNext("p-1", [])).toBeNull();
  });
});

describe("the Team panel counts with the same rule", () => {
  const nameOf = (id: string | null) => (id ? NAMES[id] ?? "Former member" : "");
  // a live product's change requests: one to approve, one stopped build, one with two questions
  const changes = [
    cr({ id: "c5", number: 5, status: "review", analysis: approvedAnalysis }),
    cr({ id: "c6", number: 6, status: "building", analysis: approvedAnalysis, ...decided }),
    cr({ id: "c7", number: 7 }),
  ];
  const jobs = [
    job({ id: "a5", kind: "change.analyse", status: "succeeded", inputJson: forCr("c5") }),
    job({ id: "b6", kind: "change.build", status: "cancelled", inputJson: forCr("c6"), finishedAt: "2026-11-07T22:27:00.000Z" }),
    job({ id: "a7", kind: "change.analyse", status: "succeeded", inputJson: forCr("c7") }),
  ];

  it("waits for you exactly as many times as the rule says (business analyst 3, tech lead 1)", () => {
    const base = { projectId: "p-1", changes, jobs, meId: OWNER, nameOf, canRun: true };
    const analyst = analystThread({ ...base, rightOf: () => approver, hasDev: true });
    const lead = leadThread({ ...base, milestones: [], previews: [] });
    const waits = run(changes, jobs);
    expect(analyst.needsYou).toBe(changeWaitCount(waits.filter((w) => w.who === "analyst")));
    expect(lead.needsYou).toBe(changeWaitCount(waits.filter((w) => w.who === "lead")));
    expect([analyst.needsYou, lead.needsYou]).toEqual([3, 1]);
  });

  it("asks nothing of a role without the rights", () => {
    const base = { projectId: "p-1", changes, jobs, meId: OTHER, nameOf, canRun: false };
    expect(analystThread({ ...base, rightOf: () => ({ ok: false, reason: "notApprover", others: [OWNER] }), hasDev: true }).needsYou).toBe(0);
    expect(leadThread({ ...base, milestones: [], previews: [] }).needsYou).toBe(0);
    expect(run(changes, jobs, { canRun: false, rightOf: () => ({ ok: false, reason: "notApprover", others: [OWNER] }) })).toEqual([]);
  });
});

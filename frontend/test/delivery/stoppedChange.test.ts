// One rule for a change request whose build stopped (src/components/changes/changeStopped.ts), the engine's lane step
// words never shown to people (src/blocks/engine/laneLine.ts on the web read path), and the places that read the rule:
// the Queue (buildQueue) and the live feed (feedItems). Software Engineering's header: liveBuildWords.test.ts.
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import { toEngineJob } from "@/blocks/engine/types";
import { laneStepWords, plainLaneLine } from "@/blocks/engine/laneLine";
import type { DeliveryChangeRequest } from "@/blocks/delivery/types";
import { STOPPED_WORD, changeStatusWord, changeStopped, stoppedLine, stoppedText } from "@/components/changes/changeStopped";
import { buildQueue, queueNote, queueStatusText, type QueueTicket } from "@/domain/buildQueue";
import { feedItems } from "@/components/build/model";

const ENGINE_WORDS = /file-map|chars for|repo\(s\)|\bgate\[|02-dev|commit\+push|\bsmoke\b/;

const analysis = JSON.stringify({
  kind: "change", route: "fast", summary: "Number partial invoices", touches: [], conflicts: [], risks: [], acceptance: ["a"],
  tickets: [{ title: "Numbering", detail: "d" }], estimate: { tickets: 1 }, questions: [],
});
const cr = (o: Partial<DeliveryChangeRequest> = {}): DeliveryChangeRequest => ({
  id: "c6", number: 6, lane: "change", featureRef: "", title: "Partial invoices", description: "d", status: "building", version: "0.9.0",
  createdByUserId: null, createdByName: "", analysis, analysedAt: "2026-11-07T22:20:00.000Z", decidedAt: "2026-11-07T22:26:00.000Z",
  decidedByUserId: "u1", decisionNote: null, selfApproved: true, ...o,
});
const job = (status: EngineJob["status"], o: Partial<EngineJob> = {}): EngineJob => ({
  id: `cb-${status}`, workspaceId: "w", projectId: "p", kind: "change.build", status, inputJson: JSON.stringify({ changeRequestId: "c6" }), outputRefs: [],
  progress: 24, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: "2026-11-07T22:26:10.000Z", finishedAt: "2026-11-07T22:26:29.000Z",
  createdBy: null, createdAt: "2026-11-07T22:26:05.000Z", updatedAt: null, ...o,
});

describe("a build's lane steps read in plain words (never the engine's step names)", () => {
  it("the audit's line: running, stopped (failed or cancelled) and finished", () => {
    const raw = "Building CR-006: file-map 24986 chars for 2 repo(s)";
    expect(plainLaneLine("running", raw)).toBe("Building CR-006: reading the code");
    expect(plainLaneLine("cancelled", raw)).toBe("The build of CR-006 stopped while reading the code.");
    expect(plainLaneLine("failed", raw)).toBe("The build of CR-006 stopped while reading the code.");
    expect(plainLaneLine("succeeded", raw)).toBe("The build of CR-006 finished.");
  });
  it("every step form the lanes write: order, repo, retry, compound names", () => {
    expect(laneStepWords("02-dev[api] wrote 3 files")).toBe("writing the code");
    expect(laneStepWords("gate[web]-2 passed")).toBe("running the automatic checks");
    expect(laneStepWords("commit+push[web] ok")).toBe("saving the changes");
    expect(laneStepWords("04-test suites (after send-back) 12 passed")).toBe("running the tests");
    expect(laneStepWords("post-deploy e2e ok")).toBe("finishing the steps after the deploy");
    expect(laneStepWords("HOLD waiting for the lock")).toBe("waiting");
    expect(plainLaneLine("running", "Updating milestone 2: smoke[web] 200 OK")).toBe("Updating milestone 2: trying the app on development");
    expect(plainLaneLine("cancelled", "Updating milestone 2: review approve")).toBe("The update of milestone 2 stopped while reviewing the code.");
  });
  it("any other line is left as it is (plain lines, the simulated build's counts, unknown words)", () => {
    for (const line of [
      "Building milestone 2: 3 of 5 tickets done, reviewing “Orders”.",
      "Building CR-006: reading the code",
      "The change build stopped while building the change. The engine team has the details; start it again once they confirm it is fixed.",
      "CR-004 is on development as version 0.8.0.",
      "Building CR-006: Something new happened",
    ]) expect(plainLaneLine("running", line)).toBe(line);
  });
  it("on the web read path: a stored job never shows the engine's step words", () => {
    const j = toEngineJob({ ItemId: "j1", ProjectId: "p", Kind: "change.build", Status: "cancelled", Message: "Building CR-006: file-map 24986 chars for 2 repo(s)" })!;
    expect(j.message).toBe("The build of CR-006 stopped while reading the code.");
    const f = toEngineJob({ ItemId: "j2", ProjectId: "p", Kind: "change.build", Status: "failed", Message: "Building CR-006: gate[api] failed 2 checks" })!;
    expect(f.message).not.toMatch(ENGINE_WORDS);
    expect(f.message).toMatch(/^The build of CR-006 stopped while running the automatic checks\.$/);
  });
});

describe("one rule for a change request whose build stopped", () => {
  it("still building, newest build cancelled or failed: stopped; running or queued: not", () => {
    expect(changeStopped(cr(), job("cancelled"))).toBe(true);
    expect(changeStopped(cr(), job("failed"))).toBe(true);
    expect(changeStopped(cr(), job("running"))).toBe(false);
    expect(changeStopped(cr(), job("queued"))).toBe(false);
    expect(changeStopped(cr(), null)).toBe(false);
  });
  it("an approved request that failed is stopped; one whose analysis failed is not a stopped build", () => {
    expect(changeStopped(cr({ status: "failed" }), null)).toBe(true);
    expect(changeStopped(cr({ status: "failed", decidedAt: null }), null)).toBe(false);
  });
  it("released, approved, in review: never stopped, whatever an older build did", () => {
    for (const status of ["released-dev", "approved", "review", "questions"] as const) expect(changeStopped(cr({ status }), job("cancelled"))).toBe(false);
  });
  it("a request saved before the analysis existed counts the same way while it is building", () => {
    expect(changeStopped(cr({ analysis: null }), job("cancelled"))).toBe(true);
    expect(changeStopped(cr({ analysis: null }), job("running"))).toBe(false);
  });
  it("one word and one sentence, never 'cancelled'", () => {
    expect(changeStatusWord(cr(), job("cancelled"))).toBe(STOPPED_WORD);
    expect(changeStatusWord(cr(), job("failed"))).toBe("Stopped");
    expect(changeStatusWord(cr(), job("running"))).toBe("Being built");
    expect(changeStatusWord(cr({ status: "released-dev" }), job("succeeded"))).toBe("Released to development");
    expect(stoppedText("CR-006")).toBe("The build of CR-006 stopped");
    expect(stoppedLine("CR-006", null)).toBe("The build of CR-006 stopped. It starts again from the change request.");
    expect(stoppedLine("CR-006", "The build of CR-006 stopped while reading the code."))
      .toBe("The build of CR-006 stopped while reading the code. It starts again from the change request.");
    // a failure sentence that already says what to do is not repeated
    const own = "The change build stopped while building the change. The engine team has the details; start it again once they confirm it is fixed.";
    expect(stoppedLine("CR-006", own)).toBe(own);
    expect(stoppedLine("milestone 2", null, false)).toBe("The build of milestone 2 stopped.");
    for (const s of [stoppedText("CR-006"), stoppedLine("CR-006", null)]) expect(s).not.toMatch(/cancel/i);
  });
});

describe("the Queue reads the rule: a stopped change's tasks are 'Stopped', never 'Ready to start'", () => {
  const tk = (n: number, o: Partial<QueueTicket> = {}): QueueTicket => ({
    id: `t${n}`, number: n, planRef: `cr:c6:${n}`, title: `Task ${n}`, type: "fix", agent: "planner", column: "planned", isDone: false,
    doneAt: null, milestoneId: null, sortOrder: n, source: "plan", dependsOn: [], ...o,
  });
  const qjob = (status: EngineJob["status"]) => ({ id: `j-${status}`, kind: "change.build" as const, status, inputJson: JSON.stringify({ changeRequestId: "c6" }), createdAt: "2026-11-07T22:26:05.000Z" });
  it("planned tasks of a change whose newest build was cancelled: Stopped, the build stopped, named by their change request", () => {
    const items = buildQueue({ tickets: [tk(15), tk(16)], events: [], milestones: [], jobs: [qjob("cancelled")], changes: [cr()] });
    expect(items.map((i) => i.status)).toEqual(["failed", "failed"]);
    expect(queueStatusText(items[0]!, items)).toBe("Stopped");
    expect(queueNote(items[0]!, items)).toEqual({ note: "the build stopped", tone: "danger" });
    expect(items[0]!.change).toBe("CR-006");
    expect(items[0]!.milestone).toBe("CR-006");
  });
  it("the same tasks while the build runs again, or before it ever started: waiting to start as before", () => {
    const running = buildQueue({ tickets: [tk(15)], events: [], milestones: [], jobs: [qjob("running")], changes: [cr()] });
    expect(running[0]!.status).toBe("pending");
    const approved = buildQueue({ tickets: [tk(15)], events: [], milestones: [], jobs: [], changes: [cr({ status: "approved" })] });
    expect(queueStatusText(approved[0]!, approved)).toBe("Ready to start");
  });
  it("without the change requests the newest build alone decides, and the lane keeps its general name", () => {
    const items = buildQueue({ tickets: [tk(15)], events: [], milestones: [], jobs: [qjob("cancelled")] });
    expect(items[0]!.status).toBe("failed");
    expect(items[0]!.milestone).toBe("Changes and fixes");
    expect(items[0]!.change).toBeNull();
  });
  it("a milestone's planned task is untouched by the rule (it is about change requests)", () => {
    const m = buildQueue({ tickets: [tk(1, { planRef: "r1.1", milestoneId: "m1" })], events: [], milestones: [{ id: "m1", number: 1, sortOrder: 1 }],
      jobs: [{ id: "b", kind: "build.run", status: "cancelled", inputJson: JSON.stringify({ milestoneId: "m1" }), createdAt: "2026-11-07T22:00:00.000Z" }] });
    expect(m[0]!.status).toBe("pending");
  });
});

describe("the live feed says 'stopped' for a build that ended without finishing", () => {
  it("cancelled and failed builds both stop; their plain line is used as it is", () => {
    const items = feedItems({
      jobs: [job("cancelled", { message: "The build of CR-006 stopped while reading the code." }), job("failed", { id: "cb-2", message: null })],
      events: [], tickets: [], ticketCode: () => "", columnName: (c) => c,
      jobLabel: () => "The build of CR-006",
    });
    const ends = items.filter((i) => i.key.endsWith(":end")).map((i) => i.text);
    expect(ends).toContain("The build of CR-006 stopped while reading the code.");
    expect(ends).toContain("The build of CR-006 stopped.");
    for (const t of ends) expect(t).not.toMatch(/cancel/i);
  });
});

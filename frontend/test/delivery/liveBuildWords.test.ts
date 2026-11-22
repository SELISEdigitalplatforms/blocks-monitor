// Software Engineering, Board and Timeline for a product that works through change requests (an existing product
// attached as it is live, without milestones): no milestone words, the change request on each of its tickets, and each
// ticket credited to the role that did (or will do) its work.
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import { BUILD_ROLE, CHANGE_BUILD_ROLE, buildStep, worksByChanges, type StepChangeBuild } from "@/components/build/buildStep";
import { changeTickets } from "@/components/build/ChangesOverview";
import { changeFilterValue, creditedAgent, filterBlocksTickets, agentName, ticketStatusLine } from "@/components/board/blocksBoard";
import type { DeliveryTicket, DeliveryTicketEvent } from "@/blocks/delivery/types";

const MILESTONE = /milestone/i;

const tk = (o: Partial<DeliveryTicket> = {}): DeliveryTicket => ({
  id: "t1", number: 15, title: "Numbering", type: "fix", featureRef: "", agent: "planner", column: "planned", isDone: false, doneAt: null,
  milestoneId: null, sortOrder: 1, description: "", acceptance: [], planRef: "cr:c6:1", source: "change", estimateHours: null, dependsOn: [], ...o,
});
const mv = (from: string, to: string, by: string, at: string): Pick<DeliveryTicketEvent, "kind" | "fromColumn" | "toColumn" | "authorLabel" | "at"> =>
  ({ kind: "move", fromColumn: from as never, toColumn: to as never, authorLabel: by, at });

describe("a product that works through change requests", () => {
  it("is one without milestones that is live as it is, or already has change requests", () => {
    expect(worksByChanges({ milestones: 0, attachedLive: true, changes: 0 })).toBe(true);
    expect(worksByChanges({ milestones: 0, attachedLive: false, changes: 7 })).toBe(true);
    expect(worksByChanges({ milestones: 3, attachedLive: true, changes: 7 })).toBe(false);
    expect(worksByChanges({ milestones: 0, attachedLive: false, changes: 0 })).toBe(false);
  });
  it("its role line never speaks of milestones, previews to accept or the locked scope", () => {
    expect(BUILD_ROLE.delivers).toMatch(MILESTONE);
    for (const t of Object.values(CHANGE_BUILD_ROLE)) expect(t).not.toMatch(/milestone|locked scope|accept the/i);
    expect(CHANGE_BUILD_ROLE.delivers).toBe("builds each approved change request and puts it on the development environment");
  });
  it("without a change build yet: the step says so, with no milestone chips and no milestone words", () => {
    const s = buildStep({
      milestones: [], tickets: [], previewOf: () => null, jobs: [], gate: { milestone: null, enabled: false, reason: null }, tests: () => null,
      canAccept: true, feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false, byChanges: true,
    });
    expect(s.status).toBe("No change request is being built");
    expect(s.chips).toEqual([]);
    expect(s.primary).toMatchObject({ kind: "release", label: "Go to Release" });
    for (const t of [s.status, s.primary.label, s.primary.reason ?? ""]) expect(t).not.toMatch(MILESTONE);
  });
});

describe("each ticket is credited to the role that did (or will do) its work", () => {
  it("a finished ticket: the role that took it out of development, never the release gate that closed it", () => {
    const done = tk({ column: "done", isDone: true, agent: "shipper" });
    expect(creditedAgent(done, [mv("planned", "dev", "dev", "1"), mv("dev", "review", "dev", "2"), mv("review", "test", "reviewer", "3"), mv("gate", "done", "shipper", "4")])).toBe("dev");
    expect(agentName(creditedAgent(done, []))).toBe("Tech lead");
    expect(agentName(creditedAgent(done, [mv("gate", "done", "shipper", "4")]))).toBe("Tech lead");
    // sent back and built again: the last time it left development counts
    expect(creditedAgent(done, [mv("dev", "review", "dev", "2"), mv("test", "dev", "qa", "3"), mv("dev", "review", "secops", "5")])).toBe("secops");
  });
  it("a ticket waiting in Planned that still names the business analyst is the tech lead's work", () => {
    expect(agentName(creditedAgent(tk({ agent: "planner" })))).toBe("Tech lead");
    expect(agentName(creditedAgent(tk({ agent: "01" })))).toBe("Tech lead");
    expect(creditedAgent(tk({ agent: "secops" }))).toBe("secops");
  });
  it("a ticket being worked on names its column's role", () => {
    expect(creditedAgent(tk({ column: "test", agent: "qa" }))).toBe("qa");
    expect(agentName(creditedAgent(tk({ column: "review", agent: "reviewer" })))).toBe("Reviewer");
  });
  it("the agent filter matches the credited role", () => {
    const a = tk({ id: "a", column: "done", isDone: true, agent: "shipper" });
    const out = filterBlocksTickets([a], { milestone: "", feature: "", agent: "Tech lead", type: "", q: "" }, () => "", (t) => creditedAgent(t));
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("the tickets of a change show their change request", () => {
  it("the card's line: its change request, 'build stopped' when that build stopped, and on a finished ticket too", () => {
    expect(ticketStatusLine({ done: false, doneAt: null, milestone: "Changes and fixes", change: "CR-006" })).toBe("CR-006");
    expect(ticketStatusLine({ done: false, doneAt: null, milestone: "Changes and fixes", change: "CR-006", stopped: true })).toBe("CR-006 · build stopped");
    expect(ticketStatusLine({ done: true, doneAt: "Thu 5 Nov, 03:20", change: "CR-001" })).toBe("Done · Thu 5 Nov, 03:20 · CR-001");
    expect(ticketStatusLine({ done: false, doneAt: null, milestone: "Milestone 2" })).toBe("Milestone 2");
  });
  it("the board filters by change request", () => {
    const a = tk({ id: "a", planRef: "cr:c6:1" });
    const b = tk({ id: "b", planRef: "cr:c5:1" });
    const c = tk({ id: "c", planRef: "fx:3:c6" });
    const d = tk({ id: "d", planRef: "r1.1", milestoneId: "m1" });
    const pick = (value: string) => filterBlocksTickets([a, b, c, d], { milestone: value, feature: "", agent: "", type: "", q: "" }, () => "").map((t) => t.id);
    expect(pick(changeFilterValue("c6"))).toEqual(["a", "c"]);
    expect(pick(changeFilterValue("c5"))).toEqual(["b"]);
    expect(pick("")).toEqual(["a", "b", "c", "d"]);
  });
});

const cbJob = (status: EngineJob["status"]): EngineJob => ({
  id: `cb-${status}`, workspaceId: "w", projectId: "p", kind: "change.build", status, inputJson: JSON.stringify({ changeRequestId: "c6" }), outputRefs: [],
  progress: 24, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: "2026-11-07T22:26:10.000Z", finishedAt: "2026-11-07T22:26:29.000Z",
  createdBy: null, createdAt: "2026-11-07T22:26:05.000Z", updatedAt: null,
});

describe("Software Engineering's header reads the one stopped rule (src/components/changes/changeStopped.ts)", () => {
  const change = (status: EngineJob["status"]): StepChangeBuild => ({
    job: cbJob(status), code: "CR-006", number: 6, title: "Partial invoices", increment: null, tickets: { total: 5, done: 0 }, tests: null,
  });
  const step = (ch: StepChangeBuild, byChanges = true) => buildStep({
    milestones: [], tickets: [], previewOf: () => null, jobs: [ch.job], gate: { milestone: null, enabled: false, reason: null }, tests: () => null,
    canAccept: true, feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false, change: ch, byChanges,
  });
  it("a cancelled build reads exactly like a failed one: 'The build of CR-006 stopped', opened from the change request", () => {
    const cancelled = step(change("cancelled"));
    const failed = step(change("failed"));
    expect(cancelled.status).toBe("The build of CR-006 stopped");
    expect(failed.status).toBe(cancelled.status);
    expect(cancelled.status).not.toMatch(/cancel/i);
    expect(cancelled.primary).toMatchObject({ kind: "change", label: "Open CR-006" });
  });
});

describe("the change list on the Overview and the Timeline", () => {
  it("the tickets of each change request are counted for the change list", () => {
    const counts = changeTickets([{ planRef: "cr:c6:1", isDone: false, column: "planned" }, { planRef: "cr:c6:2", isDone: true, column: "done" }, { planRef: "r1.1", isDone: true, column: "done" }]);
    expect(counts.get("c6")).toEqual({ done: 1, total: 2 });
    expect(counts.size).toBe(1);
  });
});

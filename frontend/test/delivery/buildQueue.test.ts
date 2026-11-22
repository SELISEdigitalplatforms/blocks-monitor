// The Build queue (src/domain/buildQueue.ts): Studio's depth / waiting-on logic over the project's tickets, the status
// mapping of QUEUE-SPEC.md (tickets + their events + milestones + build jobs) and the FlowMap adapter.
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import {
  buildQueue, nextUp, queueColumns, queueCounts, queueDepths, queueEdgeState, queueFlow, queueFlowStatus, queueGroups,
  queueNote, queueStatusText, swissStamp, waitingOn, type QueueItem, type QueueTicket,
} from "@/domain/buildQueue";

const FORBIDDEN = /\b(simulat\w*|mock\w*|demo|sample|example|test data|fake|prototype|engine|ops)\b/i;

const tk = (n: number, o: Partial<QueueTicket> = {}): QueueTicket => ({
  id: `t${n}`, number: n, planRef: `r1.${n}`, title: `Task ${n}`, type: "story", agent: "dev", column: "planned", isDone: false,
  doneAt: null, milestoneId: "m1", sortOrder: n, source: "plan", dependsOn: [], ...o,
});
const MS = [{ id: "m1", number: 1, name: "Orders", sortOrder: 1 }, { id: "m2", number: 2, name: "Payments", sortOrder: 2 }];
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, createdAt = "2026-10-26T08:00:00.000Z") =>
  ({ id: `${kind}-${status}-${createdAt}`, kind, status, inputJson: JSON.stringify(input), createdAt });
const move = (ticketId: string, from: string | null, to: string, at: string) =>
  ({ ticketId, kind: "move" as const, fromColumn: from as never, toColumn: to as never, text: "", at });
const note = (ticketId: string, text: string, at: string) => ({ ticketId, kind: "artifact" as const, fromColumn: null, toColumn: null, text, at });
const q = (tickets: QueueTicket[], extra: Partial<Parameters<typeof buildQueue>[0]> = {}) =>
  buildQueue({ tickets, events: [], milestones: MS, jobs: [], ...extra });
const item = (id: string, deps: string[], status: QueueItem["status"] = "pending") => ({ id, deps, status });

describe("Studio's queue logic", () => {
  it("depth = one column right of the deepest dependency; cycles and unknown ids are ignored", () => {
    const items = [item("a", []), item("b", ["a"]), item("c", ["a", "b"]), item("d", []), item("e", ["zz"]), item("x", ["y"]), item("y", ["x"])];
    expect(queueDepths(items)).toEqual({ a: 0, b: 1, c: 2, d: 0, e: 0, x: 1, y: 0 });
    expect(queueColumns(items).map((c) => c.map((t) => t.id))).toEqual([["a", "d", "e", "y"], ["b", "x"], ["c"]]);
  });
  it("waits only for dependencies that are not done (unknown ones count as not done)", () => {
    const items = [item("a", [], "landed"), item("b", [], "running"), item("c", ["a", "b", "zz"])];
    expect(waitingOn(items[2], items)).toEqual(["b", "zz"]);
    expect(waitingOn(item("d", ["a"]), items)).toEqual([]);
  });
  it("next up: the ready ones first", () => {
    const items = q([tk(1, { column: "dev" }), tk(2, { dependsOn: ["t1"] }), tk(3)]);
    expect(nextUp(items).map((p) => [p.item.key, p.waitingOn])).toEqual([["MF-3", []], ["MF-2", ["t1"]]]);
  });
});

describe("status mapping", () => {
  it("planned → pending (waiting / ready), dev…gate → running with the stage, done → landed", () => {
    const items = q([
      tk(1, { column: "done", isDone: true, doneAt: "2026-10-26T09:30:00.000Z" }),
      tk(2, { column: "review", dependsOn: ["t1"] }),
      tk(3, { dependsOn: ["t2"] }),
      tk(4, { dependsOn: ["t1"] }),
    ]);
    expect(items.map((t) => t.status)).toEqual(["landed", "running", "pending", "pending"]);
    expect(items.map((t) => queueFlowStatus(t, items))).toEqual(["done", "active", "waiting", "ready"]);
    expect(items.map((t) => queueStatusText(t, items))).toEqual(["Done", "In progress · In review", "Waiting for MF-2", "Ready to start"]);
    expect(items[1]).toMatchObject({ stage: "In review", agent: expect.any(String), milestone: "Milestone 1", deps: ["t1"] });
    expect(items[0]).toMatchObject({ stage: null, endedAt: "2026-10-26T09:30:00.000Z" });
  });
  it("every stage in plain words", () => {
    const cols = ["dev", "review", "test", "security", "docs", "gate"] as const;
    const items = q(cols.map((column, i) => tk(i + 1, { column })));
    expect(items.map((t) => t.stage)).toEqual(["In development", "In review", "Testing", "Security check", "Docs", "Final check"]);
  });
  it("sent back and not yet past the stage that sent it back → recovering; once past it, running again", () => {
    const events = [
      move("t1", null, "planned", "2026-10-26T08:00:00.000Z"), move("t1", "planned", "dev", "2026-10-26T08:01:00.000Z"),
      move("t1", "dev", "review", "2026-10-26T08:02:00.000Z"), move("t1", "review", "test", "2026-10-26T08:03:00.000Z"),
      move("t1", "test", "dev", "2026-10-26T08:04:00.000Z"),
    ];
    const fixing = q([tk(1, { column: "review" })], { events });
    expect(fixing[0]).toMatchObject({ status: "recovering", sentBackFrom: "test", startedAt: "2026-10-26T08:01:00.000Z" });
    expect(queueStatusText(fixing[0], fixing)).toBe("Being fixed");
    expect(queueNote(fixing[0], fixing).note).toBe("sent back from testing");
    const past = q([tk(1, { column: "security" })], { events });
    expect(past[0]).toMatchObject({ status: "running", sentBackFrom: null });
  });
  it("a feedback fix in progress → recovering; while planned it waits like any task", () => {
    const items = q([tk(1, { column: "dev", source: "feedback", type: "fix" }), tk(2, { source: "feedback", type: "fix" })]);
    expect(items.map((t) => t.status)).toEqual(["recovering", "pending"]);
    expect(queueNote(items[0], items).note).toBe("fixing your feedback");
  });
  it("its milestone's latest build failed or was cancelled → a started task is stopped; a newer build runs it again", () => {
    const tickets = [tk(1, { column: "test" }), tk(2), tk(3, { column: "done", isDone: true })];
    const failed = q(tickets, { jobs: [job("build.run", "failed", { milestoneId: "m1" })] });
    expect(failed.map((t) => t.status)).toEqual(["failed", "pending", "landed"]);
    expect(queueStatusText(failed[0], failed)).toBe("Stopped");
    expect(queueNote(failed[0], failed)).toEqual({ note: "stopped in testing", tone: "danger" });
    expect(q(tickets, { jobs: [job("build.run", "cancelled", { milestoneId: "m1" })] })[0].status).toBe("failed");
    const again = q(tickets, { jobs: [job("build.run", "failed", { milestoneId: "m1" }), job("build.run", "running", { milestoneId: "m1" }, "2026-10-26T09:00:00.000Z")] });
    expect(again[0].status).toBe("running");
    // another milestone's failed build changes nothing here
    expect(q(tickets, { jobs: [job("build.run", "failed", { milestoneId: "m2" })] })[0].status).toBe("running");
  });
  it("change work follows its change request's build", () => {
    const t = tk(9, { milestoneId: null, planRef: "cr:cr1:0", column: "dev" });
    const fx = tk(10, { milestoneId: null, planRef: "fx:2:cr2", column: "review", type: "fix" });
    const items = q([t, fx], { jobs: [job("change.build", "failed", { changeRequestId: "cr1" }), job("change.build", "running", { changeRequestId: "cr2" })] });
    expect(items.map((x) => [x.key, x.status, x.milestone])).toEqual([["MF-9", "failed", "Changes and fixes"], ["FX-2", "running", "Changes and fixes"]]);
  });
  it("orders by milestone, then the board's order; change work last; drops dependencies on unknown tickets and itself", () => {
    const items = q([tk(5, { milestoneId: null, planRef: "cr:x:0" }), tk(3, { milestoneId: "m2", sortOrder: 0 }), tk(2, { sortOrder: 2, dependsOn: ["t2", "nope", "t1"] }), tk(1, { sortOrder: 1 })]);
    expect(items.map((t) => t.key)).toEqual(["MF-1", "MF-2", "MF-3", "MF-5"]);
    expect(items[1].deps).toEqual(["t1"]);
  });
  it("reads the pull request (and a commit) from the ticket's events", () => {
    const events = [note("t1", "Pull request #52 opened: Task 1.", "2026-10-26T08:02:00.000Z"), note("t1", "Merged as commit 3f2a9c1d.", "2026-10-26T08:09:00.000Z")];
    const [a] = q([tk(1, { column: "docs" })], { events });
    expect(a).toMatchObject({ pullRequest: "#52", commit: "3f2a9c1d" });
    expect(q([tk(1)])[0]).toMatchObject({ pullRequest: null, commit: null });
  });
});

describe("words", () => {
  it("Swiss date and time", () => {
    const d = new Date(2026, 9, 6, 7, 5);
    expect(swissStamp(d.toISOString())).toBe("06.10.2026 07:05");
    expect(swissStamp(null)).toBe("–");
    expect(swissStamp("nope")).toBe("–");
  });
  it("plain words only", () => {
    const items = q([tk(1, { column: "done", isDone: true }), tk(2, { column: "test", dependsOn: ["t1"] }), tk(3, { dependsOn: ["t2"] }), tk(4, { column: "dev", source: "feedback" })]);
    for (const t of items) {
      expect(queueStatusText(t, items)).not.toMatch(FORBIDDEN);
      expect(queueNote(t, items).note).not.toMatch(FORBIDDEN);
    }
  });
});

describe("FlowMap adapter", () => {
  const items = q([
    tk(1, { column: "done", isDone: true }),
    tk(2, { column: "dev", dependsOn: ["t1"] }),
    tk(3, { dependsOn: ["t1"] }),
    tk(4, { dependsOn: ["t2", "t3"] }),
    tk(5, { milestoneId: "m2", dependsOn: ["t4"] }),
  ]);
  it("one node per task with its key, state, note and milestone lane", () => {
    const { nodes } = queueFlow(items);
    expect(nodes.map((n) => [n.id, n.key, n.status, n.note, n.group, n.linkLabel])).toEqual([
      ["t1", "MF-1", "done", undefined, "m1", "Open task"],
      ["t2", "MF-2", "active", expect.stringMatching(/^In development/), "m1", "Open task"],
      ["t3", "MF-3", "ready", "ready to start", "m1", undefined],
      ["t4", "MF-4", "waiting", "waits for MF-2, MF-3", "m1", undefined],
      ["t5", "MF-5", "waiting", "waits for MF-4", "m2", undefined],
    ]);
  });
  it("edges from the dependency to the task that waits: moving while it runs, dashed while the dependency isn't done", () => {
    const { edges } = queueFlow(items);
    expect(edges).toEqual([
      { from: "t1", to: "t2", state: "active" },
      { from: "t1", to: "t3", state: "done" },
      { from: "t2", to: "t4", state: "pending" },
      { from: "t3", to: "t4", state: "pending" },
      { from: "t4", to: "t5", state: "pending" },
    ]);
    expect(queueEdgeState({ status: "landed" }, { status: "recovering" })).toBe("active");
  });
  it("a filtered map keeps naming what it waits for in another milestone, without a dangling edge", () => {
    const m2 = items.filter((t) => t.milestoneId === "m2");
    const { nodes, edges } = queueFlow(m2, items);
    expect(nodes[0]).toMatchObject({ status: "waiting", note: "waits for MF-4" });
    expect(edges).toEqual([]);
  });
  it("counts per state and the milestone lanes in order", () => {
    expect(queueCounts(items)).toEqual({ done: 1, active: 1, ready: 1, waiting: 2 });
    expect(queueGroups([MS[1], MS[0]]).map((g) => g.label)).toEqual(["Milestone 1 · Orders", "Milestone 2 · Payments", "Changes and fixes"]);
  });
});

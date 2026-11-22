// The Studio, the Timeline and the 3D floor follow the build in focus, a milestone's (build.run) or a change request's
// (change.build): its tickets, its increment (a new feature on an existing product), its stages, gates and feed lines,
// read only from the records the engine writes (the job, the change request, the tickets' PlanRef and their moves).
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import type { DeliveryChangeRequest, DeliveryMilestone, DeliveryTicket, DeliveryTicketEvent } from "@/blocks/delivery/types";
import type { TicketColumn } from "@/domain/delivery";
import {
  buildFocus, changeBuildScope, feedItems, focusAt, focusName, qualityGates, stageStates,
} from "@/components/build/model";

const T0 = Date.parse("2026-11-05T09:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const job = (id: string, kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, createdMin: number, o: Partial<EngineJob> = {}): EngineJob => ({
  id, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify({ projectId: "p", ...input }), outputRefs: [],
  progress: 40, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: at(createdMin + 1), finishedAt: null,
  createdBy: null, createdAt: at(createdMin), updatedAt: null, ...o,
});

const ticket = (id: string, planRef: string, column: TicketColumn, o: Partial<DeliveryTicket> = {}): DeliveryTicket => ({
  id, number: Number(id.replace(/\D/g, "")) || 1, title: `Ticket ${id}`, type: "story", featureRef: "", agent: "planner", column,
  isDone: column === "done", doneAt: null, milestoneId: null, sortOrder: 0, description: "", acceptance: [], planRef, source: "change-request",
  estimateHours: 2, dependsOn: [], ...o,
});

let evN = 0;
const move = (ticketId: string, from: TicketColumn | null, to: TicketColumn, min: number): DeliveryTicketEvent => ({
  id: `ev${++evN}`, ticketId, kind: "move", fromColumn: from, toColumn: to, authorUserId: null, authorLabel: "dev", text: "", at: at(min), isAuto: true,
});

/** A new feature on an existing product in two increments of two tickets each. */
const FEATURE = {
  v: 1, kind: "feature", summary: "Accountants send payment reminders for overdue invoices.",
  impact: { features: [], stories: [], screens: [], milestones: [] }, scopeChange: false, conflicts: [], risks: [],
  acceptanceCriteria: ["An overdue invoice offers a reminder."],
  tickets: [
    { title: "Overdue list", description: "List them.", increment: 1 }, { title: "Reminder API", description: "Send one.", increment: 1 },
    { title: "Reminder letter", description: "Write it.", increment: 2 }, { title: "Reminder history", description: "Keep it.", increment: 2 },
  ],
  questions: [], contextVersion: 3,
  feature: { basis: "existing-product", parts: { api: true, web: true, data: false }, increments: [{ title: "Find overdue invoices", goal: "" }, { title: "Send reminders", goal: "" }] },
};
const FAST = { ...FEATURE, kind: "change", feature: undefined, tickets: FEATURE.tickets.slice(0, 2).map(({ title, description }) => ({ title, description })) };

const cr = (analysis: unknown, o: Partial<DeliveryChangeRequest> = {}): DeliveryChangeRequest => ({
  id: "c1", number: 2, lane: "add", featureRef: "", title: "Payment reminders", description: "Remind customers of overdue invoices.",
  status: "building", version: "1.1.0", createdByUserId: null, createdByName: "", analysis: analysis ? JSON.stringify(analysis) : null,
  analysedAt: null, decidedAt: at(-60), decidedByUserId: null, decisionNote: null, selfApproved: false, ...o,
});

const milestone: DeliveryMilestone = {
  id: "m1", scopeVersion: 1, number: 1, name: "Basics", goal: "", featureRefs: [], sortOrder: 1, status: "done", acceptedAt: at(-500), acceptedByUserId: null,
} as DeliveryMilestone;

const columnName = (c: string) => c;

describe("the build in focus follows a change build too", () => {
  it("a running change build (feature, increment 1, started before its tickets exist) is the focus over an older milestone build", () => {
    const jobs = [
      job("b1", "build.run", "succeeded", { milestoneId: "m1" }, -600, { finishedAt: at(-500) }),
      job("j1", "change.build", "running", { changeRequestId: "c1" }, 0),
    ];
    const old = ticket("t1", "m1:1", "done", { milestoneId: "m1", source: "plan" });
    const f = buildFocus({ jobs, milestones: [milestone], tickets: [old], events: [], changes: [cr(FEATURE)] });
    expect(f.job?.id).toBe("j1");
    expect(f.milestone).toBeNull();
    expect(f.change).toMatchObject({ id: "c1", code: "CR-002", number: 2, increment: { n: 1, of: 2, title: "Find overdue invoices" }, planned: 2 });
    expect(f.tickets).toEqual([]);
    expect(f.live).toBe(true);
    // the build plans its own tickets first: Plan works, the gates wait for the change's tickets
    expect(f.planning).toBe(true);
    expect(stageStates(f).find((s) => s.id === "01")?.status).toBe("active");
    expect(qualityGates(f, columnName)[0]).toMatchObject({ state: "pending", detail: "Waits for the change's tickets." });
    expect(focusName(f)).toBe("CR-002 increment 1 of 2: Find overdue invoices");
  });

  it("follows the tickets of the increment as the lane moves them; Plan is done once a ticket left Planned", () => {
    const tickets = [
      ticket("t1", "cr:c1:0", "dev"), ticket("t2", "cr:c1:1", "review"),
      ticket("t3", "cr:c1:2", "planned"), ticket("t4", "cr:c1:3", "planned"),
      ticket("t9", "cr:other:0", "dev"),
    ];
    const events = [
      move("t1", null, "planned", 1), move("t2", null, "planned", 1), move("t3", null, "planned", 1), move("t4", null, "planned", 1),
      move("t1", "planned", "dev", 5), move("t2", "planned", "dev", 5), move("t2", "dev", "review", 8),
    ];
    const f = buildFocus({ jobs: [job("j1", "change.build", "running", { changeRequestId: "c1" }, 0)], milestones: [], tickets, events, changes: [cr(FEATURE)] });
    expect(f.tickets.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(f.events.every((e) => e.ticketId === "t1" || e.ticketId === "t2")).toBe(true);
    expect(f.planning).toBe(false);
    const st = new Map(stageStates(f).map((s) => [s.id, s.status]));
    expect(st.get("01")).toBe("done");
    expect(st.get("02")).toBe("active");
    expect(st.get("03")).toBe("active");
    expect(st.get("deploy")).toBe("planned");
  });

  it("the second build of the feature is increment 2: the first increment's tickets were done before it was requested", () => {
    const tickets = [ticket("t1", "cr:c1:0", "done"), ticket("t2", "cr:c1:1", "done"), ticket("t3", "cr:c1:2", "dev"), ticket("t4", "cr:c1:3", "planned")];
    const events = [
      move("t1", "gate", "done", -100), move("t2", "gate", "done", -100),
      move("t3", null, "planned", -200), move("t4", null, "planned", -200), move("t3", "planned", "dev", 5),
    ];
    const jobs = [
      job("j1", "change.build", "succeeded", { changeRequestId: "c1" }, -300, { finishedAt: at(-99) }),
      job("j2", "change.build", "running", { changeRequestId: "c1" }, 0),
    ];
    const f = buildFocus({ jobs, milestones: [], tickets, events, changes: [cr(FEATURE)] });
    expect(f.job?.id).toBe("j2");
    expect(f.change?.increment).toEqual({ n: 2, of: 2, title: "Send reminders" });
    expect(f.tickets.map((t) => t.id)).toEqual(["t3", "t4"]);
    // the earlier build stays increment 1 (its tickets were not done when it was requested)
    const first = buildFocus({ jobs, milestones: [], tickets, events, changes: [cr(FEATURE)], pickedJobId: "j1" });
    expect(first.change?.increment?.n).toBe(1);
    expect(first.tickets.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(stageStates(first).find((s) => s.id === "deploy")?.status).toBe("done");
  });

  it("stays on its increment once its tickets are done while it still runs, and shows the release to dev at work", () => {
    const tickets = [ticket("t1", "cr:c1:0", "done"), ticket("t2", "cr:c1:1", "done"), ticket("t3", "cr:c1:2", "planned"), ticket("t4", "cr:c1:3", "planned")];
    const events = [move("t1", "gate", "done", 30), move("t2", "gate", "done", 30)];
    const running = job("j1", "change.build", "running", { changeRequestId: "c1" }, 0, { message: "Releasing the change to dev." });
    const f = buildFocus({ jobs: [running], milestones: [], tickets, events, changes: [cr(FEATURE)] });
    expect(f.change?.increment?.n).toBe(1);
    expect(f.tickets.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(stageStates(f).find((s) => s.id === "deploy")).toMatchObject({ status: "active", caption: "Releasing the change to dev." });
  });

  it("a change on the fast route builds all of its tickets in one build (no increment); an unread change request stays unnamed", () => {
    const tickets = [ticket("t1", "cr:c1:0", "test"), ticket("t2", "cr:c1:1", "dev"), ticket("t5", "fx:3:c9", "planned")];
    const jobs = [job("j1", "change.build", "running", { changeRequestId: "c1" }, 0)];
    const f = buildFocus({ jobs, milestones: [], tickets, events: [], changes: [cr(FAST)] });
    expect(f.change).toMatchObject({ code: "CR-002", increment: null, planned: 2 });
    expect(f.tickets.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(focusName(f)).toBe("CR-002: Payment reminders");
    const unread = buildFocus({ jobs, milestones: [], tickets, events: [] });
    expect(unread.change).toMatchObject({ code: null, number: null, increment: null });
    expect(unread.tickets.map((t) => t.id)).toEqual(["t1", "t2"]);
    // a fix's tickets (PlanRef fx:<n>:<id>) belong to its change request
    const fix = changeBuildScope({ job: job("j9", "change.build", "running", { changeRequestId: "c9" }, 0), changes: [], tickets, events: [] });
    expect(fix?.tickets.map((t) => t.id)).toEqual(["t5"]);
  });

  it("milestone builds are unchanged: a newer milestone build is the focus with the milestone's tickets", () => {
    const jobs = [
      job("j1", "change.build", "succeeded", { changeRequestId: "c1" }, -300, { finishedAt: at(-250) }),
      job("b2", "build.run", "running", { milestoneId: "m1" }, 0),
    ];
    const tickets = [ticket("t1", "m1:1", "dev", { milestoneId: "m1" }), ticket("t2", "cr:c1:0", "done")];
    const f = buildFocus({ jobs, milestones: [milestone], tickets, events: [], changes: [cr(FAST)] });
    expect(f.job?.id).toBe("b2");
    expect(f.change).toBeNull();
    expect(f.milestone?.id).toBe("m1");
    expect(f.tickets.map((t) => t.id)).toEqual(["t1"]);
    expect(qualityGates({ ...f, tickets: [] }, columnName)[0]?.detail).toBe("Waits for the milestone's tickets.");
    // nothing ever ran: no focus
    expect(buildFocus({ jobs: [], milestones: [milestone], tickets, events: [] })).toMatchObject({ job: null, milestone: null, change: null, tickets: [] });
  });

  it("the replay of a change build: Plan works until the first ticket leaves Planned", () => {
    const tickets = [ticket("t1", "cr:c1:0", "done"), ticket("t2", "cr:c1:1", "done")];
    const events = [
      move("t1", null, "planned", 2), move("t2", null, "planned", 2),
      move("t1", "planned", "dev", 6), move("t2", "planned", "dev", 6), move("t1", "dev", "done", 20), move("t2", "dev", "done", 20),
    ];
    const done = job("j1", "change.build", "succeeded", { changeRequestId: "c1" }, 0, { finishedAt: at(25) });
    const f = buildFocus({ jobs: [done], milestones: [], tickets, events, changes: [cr(FAST)] });
    expect(f.planning).toBe(false);
    const early = focusAt(f, Date.parse(at(4)));
    expect(early.live).toBe(true);
    expect(early.planning).toBe(true);
    expect(stageStates(early).find((s) => s.id === "01")?.status).toBe("active");
    const later = focusAt(f, Date.parse(at(10)));
    expect(later.planning).toBe(false);
    expect(stageStates(later).find((s) => s.id === "02")?.status).toBe("active");
  });

  it("the feed names a change build by its change request", () => {
    const jobs = [job("j1", "change.build", "running", { changeRequestId: "c1" }, 0)];
    const items = feedItems({
      jobs, events: [], tickets: [], ticketCode: (t) => `T-${t.number}`, columnName,
      jobLabel: (j) => (j.id === "j1" ? "The build of CR-002 increment 1 of 2" : null),
    });
    expect(items.map((i) => i.text)).toEqual(["The build of CR-002 increment 1 of 2 started.", "The build of CR-002 increment 1 of 2 was requested."]);
    // without a label the kind's words stay
    expect(feedItems({ jobs, events: [], tickets: [], ticketCode: () => "", columnName })[0]?.text).toBe("The build of a change started.");
  });
});

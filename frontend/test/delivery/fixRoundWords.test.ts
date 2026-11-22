// The Build step says what the records say about a change built in increments, the same way in the header, the team's
// line, the Queue's stream line and the Overview: a fix round of increment 1 (its checks failed on development) is
// "Fixing what the checks found in CR-018 increment 1 of 2 (round 1)", never "Building CR-018 increment 2 of 2"; with
// nothing running and increment 1's checks still failing it says so; increment 1 passed: increment 2 is next; increment
// 2 building: increment 2 (PrimaBook CR-018, 09.11.2026).
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/fixRoundWords.test.ts
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { toEngineJob, type EngineJob } from "@/blocks/engine/types";
import type { DeliveryChangeRequest, DeliveryTicket, DeliveryTicketEvent } from "@/blocks/delivery/types";
import type { TicketColumn } from "@/domain/delivery";
import { buildFocus, changeBuildScope, qualityGates, stepChangeOf } from "@/components/build/model";
import { buildStep, changeRunOf } from "@/components/build/buildStep";
import { openAfterDeploy } from "@/components/build/afterDeployUi";
import { ChangesOverview } from "@/components/build/ChangesOverview";
import { streamLine } from "@/components/build/queue/ParallelStreams";

const T0 = Date.parse("2026-11-09T08:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const job = (id: string, status: EngineJob["status"], input: Record<string, unknown>, createdMin: number, o: Partial<EngineJob> = {}): EngineJob => ({
  id, workspaceId: "w", projectId: "p", kind: "change.build", status, inputJson: JSON.stringify({ projectId: "p", changeRequestId: "c18", ...input }),
  outputRefs: [], progress: 40, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: at(createdMin + 1),
  finishedAt: status === "succeeded" || status === "failed" ? at(createdMin + 20) : null, createdBy: null, createdAt: at(createdMin), updatedAt: null, ...o,
});

const ticket = (k: number, column: TicketColumn): DeliveryTicket => ({
  id: `t${k}`, number: 100 + k, title: `Ticket ${k}`, type: "story", featureRef: "", agent: "dev", column, isDone: column === "done", doneAt: null,
  milestoneId: null, sortOrder: k, description: "", acceptance: [], planRef: `cr:c18:${k}`, source: "change-request", estimateHours: 2, dependsOn: [],
});
let evN = 0;
const move = (k: number, from: TicketColumn | null, to: TicketColumn, min: number): DeliveryTicketEvent => ({
  id: `ev${++evN}`, ticketId: `t${k}`, kind: "move", fromColumn: from, toColumn: to, authorUserId: null, authorLabel: "dev", text: "", at: at(min), isAuto: true,
});

/** CR-018: a new feature in two increments, five tickets and two. */
const ANALYSIS = {
  v: 1, kind: "feature", summary: "Accountants close a period and lock its bookings.",
  impact: { features: [], stories: [], screens: [], milestones: [] }, scopeChange: false, conflicts: [], risks: [],
  acceptanceCriteria: ["A closed period takes no new booking."],
  tickets: [
    ...[0, 1, 2, 3, 4].map((i) => ({ title: `Close ${i}`, description: "Close it.", increment: 1 })),
    ...[5, 6].map((i) => ({ title: `Report ${i}`, description: "Report it.", increment: 2 })),
  ],
  questions: [], contextVersion: 4,
  feature: { basis: "existing-product", parts: { api: true, web: true, data: true }, increments: [{ title: "Close a period", goal: "" }, { title: "Period report", goal: "" }] },
};
const CR: DeliveryChangeRequest = {
  id: "c18", number: 18, lane: "add", featureRef: "", title: "Period closing", description: "Close accounting periods.",
  status: "approved", version: "2.3.0", createdByUserId: null, createdByName: "", analysis: JSON.stringify(ANALYSIS),
  analysedAt: null, decidedAt: at(-60), decidedByUserId: null, decisionNote: null, selfApproved: false,
};

// increment 1 built in the first build (its five tickets moved to done by it); increment 2 still planned
const INC1_DONE = [0, 1, 2, 3, 4].map((k) => ticket(k, "done"));
const INC2_PLANNED = [5, 6].map((k) => ticket(k, "planned"));
const TICKETS = [...INC1_DONE, ...INC2_PLANNED];
const EVENTS = [0, 1, 2, 3, 4].flatMap((k) => [move(k, null, "planned", -5), move(k, "planned", "dev", 2), move(k, "gate", "done", 15)]);

/** The first build of CR-018: increment 1, on development, its own checks failing (2 of 38). */
const BUILD1_RED = job("j-build", "succeeded", {}, 0, { errorCode: "after-deploy:accept-failed=2/38" });
const BUILD1_GREEN = job("j-build", "succeeded", {}, 0);
const fixRound = (status: EngineJob["status"], o: Partial<EngineJob> = {}) =>
  job("j-fix", status, { fixChecks: true, afterJobId: "j-build", baseJobId: "j-build", round: 1, auto: true, version: "2.3.1" }, 30, o);

/** The Build step as BlocksBuildView builds it from the records (a product that works through change requests). */
function page(jobs: EngineJob[], tickets = TICKETS, events = EVENTS) {
  const focus = buildFocus({ jobs, milestones: [], tickets, events, changes: [CR] });
  const tests = qualityGates(focus, (c) => c).find((g) => g.id === "04");
  const unfinished = focus.change ? openAfterDeploy(jobs, { kind: "change.build", id: focus.change.id }) : null;
  const change = stepChangeOf(focus, { tests: tests ? { state: tests.state, detail: tests.detail } : null, unfinished: unfinished?.attention ?? null });
  const step = buildStep({
    milestones: [], tickets: [], previewOf: () => null, jobs, gate: { milestone: null, enabled: false, reason: null }, tests: () => null,
    canAccept: true, feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false, change, byChanges: true,
  });
  const overview = renderToStaticMarkup(h(MemoryRouter, null, h(ChangesOverview, {
    projectId: "p", changes: [CR], tickets, jobs, focusNumber: step.change?.number ?? null, now: step.change, onOpenBoard: () => undefined,
  }))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const running = jobs.find((j) => j.status === "running" || j.status === "queued");
  const stream = running ? streamLine(running, { jobs, changes: [CR], tickets, events }) : null;
  const words = [step.status, step.agent?.text ?? "", step.change?.line ?? "", ...step.chips.flatMap((c) => [c.value, c.title]), overview, stream ?? ""];
  return { focus, step, overview, stream, words };
}
const chip = (s: ReturnType<typeof buildStep>, id: string) => s.chips.find((c) => c.id === id);

describe("a change built in increments, while a fix round of increment 1 runs", () => {
  const jobs = [BUILD1_RED, fixRound("running", { message: "Fixing what the checks found in CR-018 (round 1): reading the code", step: "reading the code" })];

  it("is about increment 1 everywhere: the header, the team's line, the chips, the Queue and the Overview", () => {
    const { focus, step, overview, stream, words } = page(jobs);
    expect(focus.change?.increment).toEqual({ n: 1, of: 2, title: "Close a period" });
    expect(focus.tickets.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(step.status).toBe("Fixing what the checks found in CR-018 increment 1 of 2 (round 1)");
    expect(step.tone).toBe("progress");
    expect(step.agent).toEqual({ text: "The development team is fixing what the checks found in CR-018 increment 1 of 2 (round 1)", progress: 40 });
    expect(step.primary).toMatchObject({ kind: "watch" });
    expect(chip(step, "increment")?.value).toBe("1 of 2");
    expect(chip(step, "tickets")?.value).toBe("5 of 5 done");
    // the board passed its tickets, the checks on development did not: never "passing"
    expect(chip(step, "tests")).toMatchObject({ value: "being fixed", state: "attention" });
    expect(chip(step, "tests")?.title).toContain("2 of its 38 checks fail");
    expect(stream).toBe("Fixing what the checks found in CR-018 increment 1 of 2 (round 1): reading the code");
    expect(overview).toContain("The development team is fixing what the checks found in CR-018 increment 1 of 2 (round 1).");
    expect(overview).toContain("5 of 5 tickets done in increment 1 of 2");
    // the list of every change request counts the whole change, and says so
    expect(overview).toContain("5 of 7 tickets done over 2 increments");
    // the increment that has not started is named nowhere, and no count over the whole change stands in for it
    for (const w of words) expect(w.replace("5 of 7 tickets done over 2 increments", "")).not.toMatch(/increment 2 of 2|Building CR-018|0 of 2 tickets|5 of 7/);
  });

  it("queued: the fix round is next in line, still increment 1", () => {
    const { step } = page([BUILD1_RED, fixRound("queued", { claimedAt: null, progress: 0 })]);
    expect(step.status).toBe("Fix round 1 of CR-018 increment 1 of 2 is next in line for the development team");
    expect(step.agent?.text).toBe("The development team is picking up fix round 1 of CR-018 increment 1 of 2");
  });

  it("names increment 1 even when the build it fixes is no longer among the jobs read", () => {
    const only = [fixRound("running")];
    const scope = changeBuildScope({ job: only[0]!, changes: [CR], tickets: TICKETS, events: EVENTS, jobs: only });
    expect(scope?.change.increment?.n).toBe(1);
    expect(changeRunOf(only[0])).toEqual({ kind: "fix", round: 1 });
  });

  it("the job's own line reads in plain words: what runs and the step it is at", () => {
    const raw = { ItemId: "j-fix", ProjectId: "p", Kind: "change.build", Status: "running", Message: "Fixing CR-018 (round 1): file-map 24986 chars for 2 repo(s)" };
    expect(toEngineJob(raw)).toMatchObject({ message: "Fixing what the checks found in CR-018 (round 1): reading the code", step: "reading the code" });
    expect(toEngineJob({ ...raw, Status: "failed" })?.message).toBe("Fix round 1 of CR-018 stopped while reading the code.");
    expect(toEngineJob({ ...raw, Status: "failed" })?.step).toBeUndefined();
    const back = { ...raw, Message: "Putting development back without CR-018: 03-deploy ok" };
    expect(toEngineJob(back)?.message).toBe("Putting development back without CR-018: putting it on the development environment");
  });
});

describe("a change built in increments, with nothing running", () => {
  it("increment 1 on development with its checks failing: says so, and the next increment does not start on top of it", () => {
    for (const jobs of [[BUILD1_RED], [BUILD1_RED, fixRound("succeeded", { errorCode: "after-deploy:accept-failed=2/38" })]]) {
      const { step, overview, words } = page(jobs);
      expect(step.status).toBe("CR-018 increment 1 of 2 is on development, but not usable yet: 2 of its 38 checks fail");
      expect(step.tone).toBe("attention");
      expect(step.agent).toBeNull();
      expect(step.primary).toMatchObject({ kind: "change", label: "Open CR-018" });
      expect(step.primary.reason).toMatch(/checks found is fixed first/);
      expect(chip(step, "tests")).toMatchObject({ value: "failing", state: "attention" });
      expect(chip(step, "increment")).toMatchObject({ value: "1 of 2", state: "info" });
      expect(overview).toContain("CR-018 increment 1 of 2 is on development, but not usable yet: 2 of its 38 checks fail.");
      for (const w of words) expect(w).not.toMatch(/increment 2 of 2|Building/);
    }
  });

  it("increment 1 passed: on development, increment 2 starts from the change request", () => {
    const { step } = page([BUILD1_GREEN]);
    expect(step.status).toBe("CR-018 increment 1 of 2 is on development");
    expect(step.primary).toMatchObject({ kind: "change", label: "Open CR-018", reason: "Try it on development; the next increment starts from the change request." });
    expect(chip(step, "increment")).toMatchObject({ value: "1 of 2", state: "done" });
    expect(chip(step, "tests")?.value).toBe("passing");
    // a fix round that made the checks pass: the same
    const fixed = page([BUILD1_RED, fixRound("succeeded")]);
    expect(fixed.step.status).toBe("CR-018 increment 1 of 2 is on development");
    expect(fixed.step.primary.reason).toBe("Try it on development; the next increment starts from the change request.");
  });

  it("a fix round that stopped says so, about increment 1", () => {
    const { step } = page([BUILD1_RED, fixRound("failed", { message: "Fix round 1 of CR-018 stopped while reading the code." })]);
    expect(step.status).toBe("Fix round 1 of CR-018 increment 1 of 2 stopped");
    expect(step.stopReason).toBe("Fix round 1 of CR-018 stopped while reading the code.");
  });
});

describe("a change built in increments, while increment 2 is built", () => {
  it("is about increment 2: its tickets, its count, the team's line", () => {
    const build2 = job("j-build2", "running", {}, 60, { message: "Building CR-018 increment 2 of 2: writing the code", step: "writing the code" });
    const events = [...EVENTS, move(5, "planned", "dev", 62)];
    const tickets = [...INC1_DONE, ticket(5, "dev"), ticket(6, "planned")];
    const { focus, step, stream, overview } = page([BUILD1_GREEN, build2], tickets, events);
    expect(focus.change?.increment?.n).toBe(2);
    expect(step.status).toBe("Building CR-018 increment 2 of 2 · 0 of 2 tickets done");
    expect(step.agent?.text).toBe("The development team is building CR-018 increment 2 of 2");
    expect(chip(step, "tickets")?.value).toBe("0 of 2 done");
    // a build's own line, as the engine writes it (it names its increment)
    expect(stream).toBe("Building CR-018 increment 2 of 2: writing the code");
    expect(overview).toContain("The development team is building CR-018 increment 2 of 2.");
    expect(overview).toContain("0 of 2 tickets done in increment 2 of 2");
  });
});

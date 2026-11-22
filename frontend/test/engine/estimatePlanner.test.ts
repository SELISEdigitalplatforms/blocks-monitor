// The planners write the real estimate (src/domain/engineEstimate.ts) from now on: board.plan stores each ticket's
// EstimateHours (the build time it adds on MADP, as a fraction of an hour) and the board's PlanHours (every
// milestone's build), a change build its new tickets' EstimateHours, all from the calibration the screens show; with
// too few measured builds they store none (never a guessed figure).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { assertRowValid } from "../../functions/_lib/testing";
import { engineEstimates, readMeasuredBuilds } from "../../functions/_lib/engineEstimates";
import { calibrate, estimateBuild, planEstimateHours, ticketEstimateHours, type EstimateCalibration } from "../../src/domain/engineEstimate";
import { makeWorld, type World } from "./harness";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const USAGE = JSON.stringify({ v: 1, tokens: { in: 10, out: 900, cacheRead: 9000, cacheWrite: 90, total: 10000 }, costUsd: 3.2, models: ["m"], agents: 4, lanes: 1 });

/** `n` finished builds of the official engine on a project, with their times, tickets and usage. */
async function seedMeasuredBuilds(w: World, project: Row, n: number): Promise<void> {
  const end = w.now().getTime() - 60 * 60_000;
  for (let i = 0; i < n; i += 1) {
    const tickets = 1 + (i % 10);
    const minutes = (12 + 0.8 * tickets) * [0.85, 1, 1.15][i % 3]!;
    const finish = end - i * 30 * 60_000;
    const res = await w.gw.insert("EngineJob", {
      WorkspaceId: s(project.WorkspaceId), ProjectId: s(project.ItemId), ReaderIds: project.ReaderIds ?? [],
      Kind: "build.run", Status: "succeeded", ActiveKey: `measured-${i}`, RequestKey: `measured-${i}`,
      InputJson: JSON.stringify({ projectId: s(project.ItemId), milestoneId: "earlier" }),
      OutputRefs: Array.from({ length: tickets }, (_, k) => `Ticket:earlier-${i}-${k}`),
      Progress: 100, Attempts: 1, Message: "Built.",
      ClaimedAt: new Date(finish - minutes * 60_000).toISOString(), StartedAt: new Date(finish - minutes * 60_000).toISOString(), FinishedAt: new Date(finish).toISOString(),
      UsageJson: USAGE,
    });
    expect(res.created).toBe(true);
  }
}

function job(w: World, id: string): Row {
  const j = w.get("EngineJob", id);
  if (j.Status !== "succeeded") throw new Error(`job ${s(j.Kind)} ${s(j.Status)}: ${s(j.Message)}\n${w.log.join("\n")}`);
  return j;
}

describe("the planners and the real estimates", () => {
  let w: World;
  let order: Row;
  beforeAll(async () => {
    w = await makeWorld();
    order = w.project("B2B Order Portal");
  });
  afterAll(() => w?.close());
  beforeEach(() => engineEstimates.clear());

  async function plan(key: string): Promise<{ tickets: Row[]; board: Row }> {
    const pid = s(order.ItemId);
    const v = w.rows("ScopeVersion", pid).find((r) => r.Number === 1)!;
    if (v.Status !== "locked") {
      const sid = await w.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "estimate-ms" });
      await w.settle();
      job(w, sid);
      const at = w.now().toISOString();
      await w.gw.update("ScopeVersion", s(v.ItemId), { Status: "locked", LockedAt: at, LockedByUserId: s(order.AssigneeUserId) });
      await w.gw.update("Project", pid, { Stage: "board", CurrentScopeVersion: 1, ScopeLockedAt: at });
    }
    const id = await w.queue({ project: "B2B Order Portal", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key });
    await w.settle();
    job(w, id);
    return { tickets: w.rows("Ticket", pid).filter((t) => t.Source === "plan"), board: w.rows("Board", pid)[0]! };
  }

  it("with too few measured builds, the plan stores no estimate at all", async () => {
    const before = calibrate(await readMeasuredBuilds(w.gw));
    expect(before.all.time).toBeNull();
    const { tickets, board } = await plan("estimate-none");
    expect(tickets.length).toBeGreaterThan(3);
    for (const t of tickets) {
      expect(t.EstimateHours, s(t.Title)).toBeUndefined();
      expect(() => assertRowValid("Ticket", t, { read: true })).not.toThrow();
    }
    expect(board.PlanHours).toBeUndefined();
    expect(board.Status).toBe("ready");
  });

  it("with enough, every planned ticket stores what it adds on MADP and the board every milestone's build", async () => {
    await seedMeasuredBuilds(w, order, 24);
    const cal: EstimateCalibration = calibrate(await readMeasuredBuilds(w.gw));
    expect(cal.feature.time).not.toBeNull();
    // the re-plan brings every ticket still in Planned up to the plan, with its estimate
    const { tickets, board } = await plan("estimate-real");
    const per = ticketEstimateHours(cal, "story")!;
    expect(per).toBeGreaterThan(0);
    expect(per).toBeLessThan(0.1);
    for (const t of tickets) {
      expect(t.EstimateHours, s(t.Title)).toBe(ticketEstimateHours(cal, t.TicketType));
      expect(() => assertRowValid("Ticket", t, { read: true })).not.toThrow();
    }
    // the board: each milestone's build (its per-build part plus its tickets), the same as the screens compute
    const milestones = w.rows("Milestone", s(order.ItemId)).filter((m) => m.ScopeVersion === 1);
    const builds = milestones.map((m) => tickets.filter((t) => t.MilestoneId === m.ItemId).map((t) => t.TicketType));
    expect(board.PlanHours).toBe(planEstimateHours(cal, builds));
    const shown = builds.filter((b) => b.length).reduce((h, b) => h + estimateBuild(cal, b)!.minutes.value / 60, 0);
    expect(Number(board.PlanHours)).toBeCloseTo(shown, 3);
    // build time, not person-hours: a plan of a few milestones takes MADP about an hour, not days
    expect(Number(board.PlanHours)).toBeLessThan(3);
    expect(() => assertRowValid("Board", board, { read: true })).not.toThrow();
  });

  it("a change build's new tickets store the estimate of their kind", async () => {
    const p = w.project("Service Technician Portal");
    const pid = s(p.ItemId);
    const draft = w.rows("ChangeRequest", pid).find((c) => c.Status === "draft")!;
    expect(draft).toBeTruthy();
    await w.gw.update("ChangeRequest", s(draft.ItemId), { Status: "building", Version: draft.Lane === "fix" ? "1.2.1" : "1.9.0" });
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: { projectId: pid, changeRequestId: draft.ItemId }, key: "estimate-cr" });
    await w.settle();
    job(w, id);
    const cal = calibrate(await readMeasuredBuilds(w.gw));
    const tickets = w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === draft.ItemId);
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) expect(t.EstimateHours, s(t.Title)).toBe(ticketEstimateHours(cal, t.TicketType));
  });
});

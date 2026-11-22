// The scope writers on the seeded store: milestone suggestion, second opinion, screen designs and the board plan,
// checked with the app's own readers and rules (scope records, the lock's milestone rules, the delivery parsers,
// nextMilestoneToBuild) and the schema validations.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRowValid } from "../../functions/_lib/testing";
import type { Row } from "../../functions/_lib/gateway";
import { validateMilestonePlan } from "../../src/domain/milestones";
import { nextMilestoneToBuild } from "../../src/domain/delivery";
import * as scope from "../../src/blocks/scope/records";
import * as delivery from "../../src/blocks/delivery/types";
import { agentName } from "../../src/components/board/blocksBoard";
import { planTickets, tasksFor } from "../../server/local/engine/kinds/scope/board.ts";
import { acceptTasks } from "../../server/local/engine/kinds/scope/ai.ts";
import { makeWorld, type World } from "./harness";

const FORBIDDEN = /simulat|\bmock|\bdemo\b|\bsample\b|\bexample\b|test data|\bfake\b|prototype|lorem/i;
const s = (v: unknown) => (typeof v === "string" ? v : "");

function scopeVersionOf(w: World, projectId: string): Row {
  const v = w.rows("ScopeVersion", projectId).find((r) => r.Number === 1);
  if (!v) throw new Error("no scope v1");
  return v;
}

function included(w: World, projectId: string): string[] {
  return w.rows("Feature", projectId).filter((f) => f.ScopeVersion === 1 && f.Status !== "dropped").map((f) => `feature:${s(f.Key)}`);
}

async function lock(w: World, projectId: string): Promise<Row> {
  const v = scopeVersionOf(w, projectId);
  const at = w.now().toISOString();
  await w.gw.update("ScopeVersion", s(v.ItemId), { Status: "locked", LockedAt: at, LockedByUserId: s(w.get("Project", projectId).AssigneeUserId) });
  await w.gw.update("Project", projectId, { Stage: "board", CurrentScopeVersion: 1, ScopeLockedAt: at });
  return v;
}

function job(w: World, id: string): Row {
  const j = w.get("EngineJob", id);
  if (j.Status !== "succeeded") throw new Error(`job ${s(j.Kind)} ${s(j.Status)}: ${s(j.Message)}\n${w.log.join("\n")}`);
  return j;
}

describe("scope writers", () => {
  let w: World;
  let order: Row;
  beforeAll(async () => {
    w = await makeWorld();
    order = w.project("B2B Order Portal");
  });
  afterAll(() => w?.close());

  it("milestones.suggest places every included feature exactly once and passes the lock rules", async () => {
    const pid = s(order.ItemId);
    const v = scopeVersionOf(w, pid);
    const id = await w.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) } });
    await w.settle();
    const j = job(w, id);
    const ms = w.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
    expect(ms.length).toBe(3);
    expect(j.OutputRefs).toHaveLength(3);
    expect(String(j.Message)).toBe("Proposed 3 milestones.");
    const plan = ms.map((m) => ({ id: s(m.ItemId), number: Number(m.Number), name: s(m.Name), goal: s(m.Goal), featureRefs: m.FeatureRefs as string[] }));
    expect(validateMilestonePlan(plan, included(w, pid), "lock")).toEqual([]);
    expect(plan.flatMap((m) => m.featureRefs).sort()).toEqual(included(w, pid).sort());
    ms.forEach((m, i) => {
      expect(m.Number).toBe(i + 1);
      expect(m.Status).toBe("planned");
      expect(m.EngineJobId).toBe(id);
      expect(scope.milestoneFromRow(m)).not.toBeNull();
      expect(() => assertRowValid("Milestone", m, { read: true })).not.toThrow();
      expect(s(m.Goal).length).toBeGreaterThan(20);
      expect(s(m.PreviewPoint)).toMatch(/^In the preview/);
      for (const t of [m.Name, m.Goal, m.PreviewPoint]) expect(s(t)).not.toMatch(FORBIDDEN);
    });
    // The must features come before the later one.
    expect((ms[ms.length - 1]!.FeatureRefs as string[]).includes("feature:delivery-windows")).toBe(true);
    expect((ms[0]!.FeatureRefs as string[]).includes("feature:catalogue-and-prices")).toBe(true);
  });

  it("milestones.suggest honours the requester's note", async () => {
    const pid = s(order.ItemId);
    const v = scopeVersionOf(w, pid);
    const id = await w.queue({
      project: "B2B Order Portal",
      kind: "milestones.suggest",
      input: { projectId: pid, scopeVersion: 1, note: "Two milestones please. The ERP export first." },
      target: { type: "scope-version", id: s(v.ItemId) },
      key: "note",
    });
    await w.settle();
    job(w, id);
    const ms = w.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1).sort((a, b) => Number(a.Number) - Number(b.Number));
    expect(ms.length).toBe(2);
    expect((ms[0]!.FeatureRefs as string[])[0]).toBe("feature:erp-export");
    expect(validateMilestonePlan(ms.map((m) => ({ id: s(m.ItemId), number: Number(m.Number), name: s(m.Name), goal: s(m.Goal), featureRefs: m.FeatureRefs as string[] })), included(w, pid), "lock")).toEqual([]);
  });

  it("scope.grill writes a second opinion with concrete points on the project's own features and stories", async () => {
    const pid = s(order.ItemId);
    const v = scopeVersionOf(w, pid);
    const id = await w.queue({ project: "B2B Order Portal", kind: "scope.grill", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) } });
    await w.settle();
    const j = job(w, id);
    const opinion = w.rows("SecondOpinion", pid).find((o) => o.EngineJobId === id)!;
    expect(opinion).toBeTruthy();
    expect(scope.secondOpinionFromRow(opinion)).not.toBeNull();
    const points = w.rows("Challenge", pid).filter((c) => c.OpinionId === opinion.ItemId);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.length).toBeLessThanOrEqual(6);
    expect(j.OutputRefs).toHaveLength(points.length + 1);
    const ids = new Set([...w.rows("Feature", pid), ...w.rows("Story", pid)].map((r) => s(r.ItemId)));
    const titles = [...w.rows("Feature", pid), ...w.rows("Story", pid)].map((r) => s(r.Title));
    for (const c of points) {
      const rec = scope.challengeFromRow(c)!;
      expect(rec).not.toBeNull();
      expect(rec.status).toBe("open");
      expect(rec.target && ids.has(rec.target.id)).toBe(true);
      expect(() => assertRowValid("Challenge", c, { read: true })).not.toThrow();
      for (const t of [c.Question, c.Why, c.SuggestedFix]) expect(s(t)).not.toMatch(FORBIDDEN);
    }
    expect(points.some((c) => titles.some((t) => t && s(c.Question).includes(t)))).toBe(true);
    const n = (sev: string) => points.filter((c) => c.Severity === sev).length;
    expect(opinion.OpenHigh).toBe(n("high"));
    expect(opinion.OpenMedium).toBe(n("medium"));
    expect(opinion.Readiness).toBe(Math.max(35, 100 - 18 * n("high") - 8 * n("medium") - 3 * n("low")));
    expect(String(j.Message)).toMatch(/^Raised \d+ points on scope v1\.$/);
  });

  it("scope.grill does not raise again what a person already decided", async () => {
    const pid = s(order.ItemId);
    const v = scopeVersionOf(w, pid);
    const before = w.rows("Challenge", pid).filter((c) => c.Status === "open" && w.get("SecondOpinion", s(c.OpinionId)).EngineJobId);
    const decided = before[0]!;
    await w.gw.update("Challenge", s(decided.ItemId), { Status: "dismissed", DismissReason: "Handled by the order desk by phone." });
    const id = await w.queue({ project: "B2B Order Portal", kind: "scope.grill", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "again" });
    await w.settle();
    job(w, id);
    const opinion = w.rows("SecondOpinion", pid).find((o) => o.EngineJobId === id)!;
    const again = w.rows("Challenge", pid).filter((c) => c.OpinionId === opinion.ItemId).map((c) => c.Question);
    expect(again).not.toContain(decided.Question);
  });

  it("design.generate refuses old screenshot requests without replacing existing screen records", async () => {
    const pid = s(order.ItemId);
    const brief = w.rows("DesignBrief", pid)[0]!;
    const old = w.rows("DesignScreen", pid);
    const id = await w.queue({ project: "B2B Order Portal", kind: "design.generate", input: { projectId: pid, designBriefId: s(brief.ItemId) }, target: { type: "design-brief", id: s(brief.ItemId) } });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status).toBe("failed");
    expect(j.ErrorCode).toBe("design.figmaRequestRequired");
    const fresh = w.rows("DesignScreen", pid).filter((x) => x.EngineJobId === id);
    expect(fresh).toEqual([]);
    expect(w.rows("DesignScreen", pid)).toEqual(old);
  });

  it("design.generate does not synthesize a first screenshot set from requirements", async () => {
    const payroll = w.project("Payroll Self-Service");
    const pid = s(payroll.ItemId);
    const brief = w.rows("DesignBrief", pid)[0]!;
    await w.gw.update("DesignBrief", s(brief.ItemId), { Status: "confirmed", ConfirmedAt: w.now().toISOString(), ConfirmedByUserId: s(payroll.AssigneeUserId) });
    const id = await w.queue({ project: "Payroll Self-Service", kind: "design.generate", input: { projectId: pid, designBriefId: s(brief.ItemId) }, target: { type: "design-brief", id: s(brief.ItemId) } });
    await w.settle();
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaRequestRequired");
    const screens = w.rows("DesignScreen", pid).filter((x) => x.EngineJobId === id).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
    expect(screens).toEqual([]);
  });

  it("board.plan writes the tickets of the locked scope, the first board events and a ready board", async () => {
    const pid = s(order.ItemId);
    // Back to the three-milestone arrangement, then lock as scope.lock does.
    const v0 = scopeVersionOf(w, pid);
    const sid = await w.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v0.ItemId) }, key: "three" });
    await w.settle();
    job(w, sid);
    const v = await lock(w, pid);
    const id = await w.queue({ project: "B2B Order Portal", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) } });
    await w.settle();
    const j = job(w, id);
    const tickets = w.rows("Ticket", pid);
    const stories = w.rows("Story", pid).filter((st) => included(w, pid).includes(s(st.FeatureRef)));
    expect(tickets.filter((t) => t.TicketType === "story").length).toBe(stories.length);
    expect(tickets.filter((t) => t.TicketType === "task").length).toBeGreaterThanOrEqual(1);
    expect(new Set(tickets.map((t) => t.Number)).size).toBe(tickets.length);
    expect(new Set(tickets.map((t) => t.PlanRef)).size).toBe(tickets.length);
    expect(j.OutputRefs).toHaveLength(tickets.length);
    const milestones = w.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1);
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      expect(delivery.parseTicket(t).ok, JSON.stringify(t)).toBe(true);
      expect(() => assertRowValid("Ticket", t, { read: true })).not.toThrow();
      expect(t.Column).toBe("planned");
      // the role that does the work, not the planner (who reads as the business analyst since 08.11): the tech lead
      // builds every story and build task, SecOps does a security review
      expect(t.AgentRole, s(t.Title)).toBe(s(t.PlanRef).startsWith("x.sec") ? "secops" : "dev");
      expect(agentName(s(t.AgentRole))).not.toBe("Business analyst");
      counts[s(t.MilestoneId)] = (counts[s(t.MilestoneId)] ?? 0) + 1;
      const ev = w.rows("TicketEvent", pid).filter((e) => e.TicketId === t.ItemId);
      expect(ev).toHaveLength(1);
      expect(delivery.parseTicketEvent(ev[0]).ok).toBe(true);
      expect(ev[0]!.Text).toBe(`Created in Planned: ${s(t.Title)}.`);
      if (t.TicketType === "task") for (const x of [t.Title, t.Description, ...(t.Acceptance as string[])]) expect(s(x)).not.toMatch(FORBIDDEN);
    }
    for (const m of milestones) expect(counts[s(m.ItemId)]).toBeGreaterThan(0);
    const next = nextMilestoneToBuild(
      milestones.map((m) => ({ id: s(m.ItemId), number: Number(m.Number), name: s(m.Name), sortOrder: Number(m.SortOrder), status: s(m.Status) })),
      counts,
    );
    expect(next.messageKey).toBeNull();
    expect(next.milestone?.number).toBe(1);
    const board = w.rows("Board", pid)[0]!;
    expect(board.Status).toBe("ready");
    expect(board.EngineJobId).toBe(id);
    expect(() => assertRowValid("Board", board, { read: true })).not.toThrow();
    expect(String(j.Message)).toBe(`Planned ${tickets.length} tickets for 3 milestones.`);
  });

  it("board.plan again keeps the tickets (no duplicates) and leaves moved tickets alone", async () => {
    const pid = s(order.ItemId);
    const before = w.rows("Ticket", pid);
    const moved = before[0]!;
    await w.gw.update("Ticket", s(moved.ItemId), { Column: "dev", AgentRole: "reviewer", Title: "Changed by the build" });
    // a ticket planned before the fix (E2E 08.11): every planned ticket was stored with the planner's role
    const old = before.find((t) => t.TicketType === "story" && t.ItemId !== moved.ItemId)!;
    await w.gw.update("Ticket", s(old.ItemId), { AgentRole: "planner" });
    const v = scopeVersionOf(w, pid);
    const id = await w.queue({ project: "B2B Order Portal", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "replan" });
    await w.settle();
    job(w, id);
    const after = w.rows("Ticket", pid);
    expect(after.length).toBe(before.length);
    expect(w.get("Ticket", s(moved.ItemId)).Title).toBe("Changed by the build");
    expect(w.get("Ticket", s(moved.ItemId)).AgentRole).toBe("reviewer");
    // the re-plan gives a ticket still in Planned the role that does its work
    expect(w.get("Ticket", s(old.ItemId)).AgentRole).toBe("dev");
    expect(w.rows("TicketEvent", pid).length).toBe(before.length);
  });

  it("board.plan on a board the team already works on adds nothing twice", async () => {
    const shop = w.project("Spare Parts Webshop");
    const pid = s(shop.ItemId);
    const before = w.rows("Ticket", pid).map((t) => [t.ItemId, t.Column, t.Title]);
    const v = scopeVersionOf(w, pid);
    const id = await w.queue({ project: "Spare Parts Webshop", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) } });
    await w.settle();
    job(w, id);
    const after = w.rows("Ticket", pid);
    expect(new Set(after.map((t) => t.PlanRef)).size).toBe(after.length);
    for (const [tid, col] of before) expect(w.get("Ticket", s(tid)).Column).toBe(col);
  });

  it("each planned ticket names the role that does its work (built-in and Claude's tasks)", () => {
    const st = { id: "s", key: "p-1", title: "See my payslip", text: "As an employee, I want to see my payslip.", actor: "employee", criteria: ["It opens"], hours: 2, sortOrder: 0 };
    const f = { id: "f", key: "p", ref: "feature:p", title: "Payslips", description: "Employees see their payslips and export them to SAP.", priority: "must" as const, requirementRefs: [], sortOrder: 0, stories: [st], hours: 2, words: new Set<string>(), text: "payslips salary sap export" };
    const milestones = [{ id: "m1", number: 1, features: [f] }];
    const builtIn = tasksFor({ milestones, all: [f], projectName: "Payroll", client: "Acme AG", existingProduct: false, repoName: "", brief: "" });
    const roles = (tasks: Parameters<typeof planTickets>[0]["tasks"]) =>
      Object.fromEntries(planTickets({ milestones, tasks }).map((t) => [t.planRef, t.agentRole]));
    const plan = roles(builtIn);
    expect(plan["r1.0"]).toBe("dev");
    expect(plan["x.ci"]).toBe("dev");
    expect(Object.entries(plan).filter(([, r]) => r === "planner")).toEqual([]);
    const ai = acceptTasks({ tasks: [
      { milestone: 1, role: "pipeline", title: "Build pipeline and preview", description: "Every change is built.", acceptance: ["A preview per milestone"], hours: 3, feature: "" },
      { milestone: 1, role: "review", title: "Security review of the payslips", description: "Who can open a payslip.", acceptance: ["Only the employee and payroll"], hours: 2, feature: "F1" },
    ] }, milestones)!;
    expect(roles(ai)).toEqual({ "r1.0": "dev", "x.ci": "dev", "x.sec": "secops" });
    expect(roles([[{ tag: "sec", kind: "review", title: "Security review of payroll data", hours: 3, description: "", acceptance: [] }]])["x.sec"]).toBe("secops");
  });

  it("is deterministic: the same data gives the same milestones, points and tickets", async () => {
    const w2 = await makeWorld();
    try {
      const run = async (x: World) => {
        const p = x.project("B2B Order Portal");
        const pid = s(p.ItemId);
        const v = scopeVersionOf(x, pid);
        await x.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "det" });
        await x.settle();
        await x.queue({ project: "B2B Order Portal", kind: "scope.grill", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "det" });
        await x.settle();
        return {
          milestones: x.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1).map((m) => [m.Number, m.Name, m.Goal, m.FeatureRefs]),
          points: x.rows("Challenge", pid).filter((c) => c.Status === "open" && x.rows("SecondOpinion", pid).some((o) => o.ItemId === c.OpinionId && o.EngineJobId)).map((c) => [c.Severity, c.Question]),
        };
      };
      const w3 = await makeWorld();
      try {
        expect(await run(w2)).toEqual(await run(w3));
      } finally {
        w3.close();
      }
    } finally {
      w2.close();
    }
  });
});

describe("scope writers after a restart", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());

  it("an old design request retried after restart never resumes the removed screenshot writer", async () => {
    const payroll = w.project("Payroll Self-Service");
    const pid = s(payroll.ItemId);
    const brief = w.rows("DesignBrief", pid)[0]!;
    await w.gw.update("DesignBrief", s(brief.ItemId), { Status: "confirmed", ConfirmedAt: w.now().toISOString() });
    const id = await w.queue({ project: "Payroll Self-Service", kind: "design.generate", input: { projectId: pid, designBriefId: s(brief.ItemId) }, target: { type: "design-brief", id: s(brief.ItemId) } });
    const before = w.rows("DesignScreen", pid);
    await w.settle();
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaRequestRequired");
    await w.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "", Progress: 70 });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status).toBe("failed");
    expect(j.ErrorCode).toBe("design.figmaRequestRequired");
    const screens = w.rows("DesignScreen", pid);
    expect(screens).toEqual(before);
  });
});

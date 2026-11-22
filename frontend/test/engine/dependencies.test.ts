// Ticket dependencies (Ticket.DependsOn): the planner's rules (src/domain/ticketDeps.ts) on hand-made and random plans
// (never a cycle, deterministic), board.plan writing them for the B2B Order Portal, and the builds respecting them: a
// ticket leaves Planned only after every ticket it waits for is done, independent tickets run side by side, a build
// interrupted half-way resumes in dependency order, a cycle in stored data does not stop a build, an open ticket of
// another milestone that a ticket waits for is built first, and a change's tickets wait for each other where planned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import * as delivery from "../../src/blocks/delivery/types";
import { nextMilestoneToBuild } from "../../src/domain/delivery";
import {
  changeDependencies,
  dropCycles,
  hasCycle,
  planDependencies,
  teamOrder,
  workOrder,
  type DepFeature,
  type DepItem,
} from "../../src/domain/ticketDeps";
import { rand } from "../../seed/core/rng";
import { createEngine } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { makeWorld, type World } from "./harness";

const s = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const depsOf = (t: Row): string[] => (Array.isArray(t.DependsOn) ? (t.DependsOn as string[]) : []);

// ------------------------------------------------------------------ the planner (pure)

const story = (ref: string, milestone: number, feature: string, title: string, text = ""): DepItem => ({ ref, milestone, kind: "story", feature, tag: "", title, text });
const task = (tag: string, milestone: number, title: string, text = "", feature = ""): DepItem => ({ ref: `x.${tag}`, milestone, kind: "task", feature, tag, title, text });
const feature = (key: string, milestone: number, title: string, description: string, actors: string[]): DepFeature => ({ key, milestone, title, description, actors });

describe("planDependencies", () => {
  const features = [
    feature("catalogue", 1, "Catalogue and prices", "Customers browse their own articles at their own prices.", ["customer"]),
    feature("order", 1, "Order builder", "Build an order before the cut-off.", ["customer"]),
    feature("tracking", 2, "Order tracking", "Customers follow an order until it is delivered.", ["customer"]),
  ];
  const items = [
    story("r1.0", 1, "catalogue", "See my articles", "As a customer I see only my articles."),
    story("r1.1", 1, "catalogue", "See my own prices", "As a customer I see my net price on every article."),
    story("r1.2", 1, "order", "Add articles to an order", "As a customer I add articles with quantities to an order."),
    story("r1.3", 1, "order", "Send the order", "As a customer I send the order before the cut-off."),
    task("ci", 1, "Build pipeline and preview environment", "Pipeline with a preview per milestone."),
    task("auth", 1, "Sign-in and roles", "Customers sign in with their own accounts."),
    story("r2.0", 2, "tracking", "See the status of my order", "As a customer I see the status of my order."),
    story("r2.1", 2, "tracking", "Follow the shipment", "As a customer I open the tracking link."),
    task("sec", 2, "Security review of pricing data", "Check that net prices never leak across customers."),
  ];
  const deps = planDependencies({ items, features });

  it("plans like a team: set-up first, features side by side, stories on their foundation, reviews last", () => {
    expect(deps.get("x.ci")).toEqual([]);
    expect(deps.get("x.auth")).toEqual([]);
    // nothing waits for the pipeline; the screens of milestone 1 wait for the sign-in
    expect([...deps.values()].some((d) => d.includes("x.ci"))).toBe(false);
    expect(deps.get("r1.0")).toEqual(["x.auth"]);
    expect(deps.get("r1.2")).toEqual(["x.auth"]);
    // the two features of milestone 1 run side by side
    expect(deps.get("r1.0")).not.toContain("r1.2");
    expect(deps.get("r1.2")).not.toContain("r1.0");
    expect(deps.get("r1.1")).toEqual(["r1.0"]);
    expect(deps.get("r1.3")).toEqual(["r1.2"]);
    // tracking builds on the order of milestone 1 (one cross-milestone link), the shipment on the status
    expect(deps.get("r2.0")).toEqual(["r1.2"]);
    expect(deps.get("r2.1")).toEqual(["r2.0"]);
    // the security review of pricing data waits for the price story
    expect(deps.get("x.sec")).toContain("r1.1");
    expect(hasCycle(deps)).toBe(false);
  });

  it("is deterministic and never plans a cycle, on random plans", () => {
    const words = ["order", "price", "photo", "signature", "route", "report", "visit", "parts", "stock", "invoice", "export", "status", "offline", "signal", "review", "tests", "user guide"];
    const actors = ["customer", "driver", "service desk", "dispatcher", "technician"];
    const tags = ["ci", "auth", "api", "int-erp", "offline-store", "sec", "migration"];
    for (let n = 0; n < 150; n++) {
      const r = rand(`deps:${n}`);
      const ms = r.int(1, 4);
      const fs: DepFeature[] = [];
      const its: DepItem[] = [];
      for (let m = 1; m <= ms; m++) {
        for (let f = 0; f < r.int(1, 3); f++) {
          const key = `f${m}-${f}`;
          const title = `${r.pick(words)} ${r.pick(words)}`;
          fs.push(feature(key, m, title, `${r.pick(words)} and ${r.pick(words)} for the ${r.pick(words)}`, [r.pick(actors)]));
          for (let k = 0; k < r.int(1, 4); k++) its.push(story(`r${m}.${its.length}`, m, key, `${r.pick(words)} the ${r.pick(words)}`, `${r.pick(words)} ${r.pick(words)} ${r.pick(words)}`));
        }
        for (let k = 0; k < r.int(0, 3); k++) {
          const tag = r.pick(tags);
          if (its.some((x) => x.ref === `x.${tag}`)) continue;
          its.push(task(tag, m, tag === "sec" ? `Security review of ${r.pick(words)}` : `${tag} ${r.pick(words)}`, r.pick(words), tag.startsWith("int-") ? fs[fs.length - 1]!.key : ""));
        }
      }
      const a = planDependencies({ items: its, features: fs });
      const b = planDependencies({ items: its, features: fs });
      expect([...a]).toEqual([...b]);
      expect(hasCycle(a), `plan ${n}`).toBe(false);
      const byRef = new Map(its.map((x) => [x.ref, x]));
      expect([...a.keys()].sort()).toEqual(its.map((x) => x.ref).sort());
      for (const [ref, ds] of a) {
        expect(ds.length).toBeLessThanOrEqual(4);
        for (const d of ds) {
          expect(d).not.toBe(ref);
          expect(byRef.has(d)).toBe(true);
          // never on later work
          expect(byRef.get(d)!.milestone).toBeLessThanOrEqual(byRef.get(ref)!.milestone);
        }
      }
    }
  });
});

describe("dependency helpers", () => {
  it("dropCycles keeps the earlier edges and drops the one that closes a cycle", () => {
    const cyclic = new Map([["a", ["c"]], ["b", ["a"]], ["c", ["b"]], ["d", ["d", "x"]]]);
    expect(hasCycle(cyclic)).toBe(true);
    const kept = dropCycles(["a", "b", "c", "d"], cyclic);
    expect(hasCycle(kept)).toBe(false);
    expect(kept.get("a")).toEqual(["c"]);
    expect(kept.get("b")).toEqual(["a"]);
    expect(kept.get("c")).toEqual([]);
    expect(kept.get("d")).toEqual([]);
  });

  it("workOrder and teamOrder put every ticket after the ones it waits for; teamOrder picks set-up work first", () => {
    const deps = new Map([["1", ["5"]], ["2", ["1"]], ["3", []], ["4", ["3"]], ["5", []], ["6", []]]);
    const get = (id: string) => deps.get(id) ?? [];
    for (const order of [workOrder(["1", "2", "3", "4", "5", "6"], get), teamOrder(["1", "2", "3", "4", "5", "6"], get)]) {
      expect(new Set(order).size).toBe(6);
      for (const [id, ds] of deps) for (const d of ds) expect(order.indexOf(d)).toBeLessThan(order.indexOf(id));
    }
    // "5" (sign-in) has the longest chain waiting for it: picked up first
    expect(teamOrder(["1", "2", "3", "4", "5", "6"], get)[0]).toBe("5");
    // a cycle is broken, never a deadlock
    expect(workOrder(["a", "b"], (id) => (id === "a" ? ["b"] : ["a"]))).toEqual(["a", "b"]);
  });

  it("changeDependencies: tests and docs wait for the work, same subject chains, the rest runs side by side", () => {
    expect(changeDependencies(["Photos in the service report", "Photos in the service report: tests and user guide"])).toEqual([[], [0]]);
    expect(changeDependencies(["Take and attach photos to the report", "Show photos in the PDF report"])).toEqual([[], [0]]);
    expect(changeDependencies(["Fix the export", "Regression test: fix the export"])).toEqual([[], [0]]);
    expect(changeDependencies(["Add a region to every visit", "Filter technicians by country", "Show the region on the visit list"])).toEqual([[], [], [0]]);
    expect(changeDependencies(["One ticket only"])).toEqual([[]]);
  });
});

// ------------------------------------------------------------------ the engine

function nextMilestone(w: World, projectId: string): Row | null {
  const ms = w.rows("Milestone", projectId);
  const counts: Record<string, number> = {};
  for (const t of w.rows("Ticket", projectId)) if (t.MilestoneId) counts[s(t.MilestoneId)] = (counts[s(t.MilestoneId)] ?? 0) + 1;
  const next = nextMilestoneToBuild(
    ms.map((m) => ({ id: s(m.ItemId), number: Number(m.Number), name: s(m.Name), sortOrder: Number(m.SortOrder), status: s(m.Status) })),
    counts,
  );
  return next.milestone ? ms.find((m) => m.ItemId === next.milestone!.id) ?? null : null;
}

/** When the ticket left Planned (its first move out of Planned), or null. */
function startOf(w: World, ticketId: string): string | null {
  const at = w.rows("TicketEvent").filter((e) => e.TicketId === ticketId && e.Kind === "move" && e.FromColumn === "planned").map((e) => s(e.At)).sort();
  return at[0] ?? null;
}

/** Every ticket of the project that left Planned did so after each ticket it waits for was done. */
function expectDependencyOrder(w: World, projectId: string): void {
  for (const t of w.rows("Ticket", projectId)) {
    const start = startOf(w, s(t.ItemId));
    if (!start) continue;
    for (const d of depsOf(t)) {
      const dep = w.get("Ticket", d);
      expect(dep.Column, `#${s(t.Number)} started while #${s(dep.Number)} was not done`).toBe("done");
      expect(s(dep.DoneAt) < start, `#${s(t.Number)} started at ${start}, before #${s(dep.Number)} was done at ${s(dep.DoneAt)}`).toBe(true);
    }
  }
}

/** Two tickets of the list were worked on at the same time. */
function someRunSideBySide(w: World, tickets: Row[]): boolean {
  const spans = tickets.map((t) => [startOf(w, s(t.ItemId)) ?? "", s(t.DoneAt)] as const).filter(([a, b]) => a && b);
  return spans.some(([a1, b1], i) => spans.some(([a2, b2], j) => i !== j && a1 < b2 && a2 < b1));
}

async function insertTicket(w: World, p: Row, fields: Row): Promise<string> {
  const pid = s(p.ItemId);
  const number = Math.max(0, ...w.rows("Ticket", pid).map((t) => Number(t.Number))) + 1;
  const by = s(p.AssigneeUserId || p.CreatedByUserId);
  const res = await w.gw.insert("Ticket", {
    ProjectId: pid, Number: number, PlanRef: `chat-${number}`, TicketType: "task", FeatureRef: "", StoryRef: "", AgentRole: "planner", Column: "planned",
    EstimateHours: 2, Acceptance: ["Done as asked."], SortOrder: 500 + number, Description: "", IsDone: false, Source: "chat", DependsOn: [],
    WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: `test:ticket:${number}`,
    ...fields,
  });
  return s(res.itemId);
}

describe("dependencies in the engine", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());

  it("the seeded running builds finish in dependency order", async () => {
    await w.settle();
    for (const name of ["Driver Delivery App", "Service Technician Portal"]) expectDependencyOrder(w, s(w.project(name).ItemId));
    // the change being built: its second ticket waited for the first
    const sp = w.project("Service Technician Portal");
    const waited = w.rows("Ticket", s(sp.ItemId)).filter((t) => t.ChangeRequestId && depsOf(t).length > 0);
    expect(waited.length).toBeGreaterThan(0);
  });

  it("board.plan writes the dependencies of the B2B Order Portal: same project, no cycle, chains and parallel work", async () => {
    const p = w.project("B2B Order Portal");
    const pid = s(p.ItemId);
    const v = w.rows("ScopeVersion", pid).sort((a, b) => Number(a.Number) - Number(b.Number))[0]!;
    const at = w.now().toISOString();
    await w.gw.update("ScopeVersion", s(v.ItemId), { Status: "locked", LockedAt: at, LockedByUserId: s(p.AssigneeUserId) });
    await w.gw.update("Project", pid, { Stage: "board", CurrentScopeVersion: 1, ScopeLockedAt: at });
    const id = await w.queue({ project: "B2B Order Portal", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) } });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const tickets = w.rows("Ticket", pid);
    const ids = new Set(tickets.map((t) => s(t.ItemId)));
    for (const t of tickets) {
      expect(Array.isArray(t.DependsOn), `#${s(t.Number)} has DependsOn`).toBe(true);
      for (const d of depsOf(t)) expect(ids.has(d)).toBe(true);
      const parsed = delivery.parseTicket(t);
      expect(parsed.ok && parsed.value.dependsOn).toEqual(depsOf(t));
    }
    const graph = new Map(tickets.map((t) => [s(t.ItemId), depsOf(t)]));
    expect(hasCycle(graph)).toBe(false);
    const byId = new Map(tickets.map((t) => [s(t.ItemId), t]));
    const depth = (tid: string): number => 1 + Math.max(0, ...depsOf(byId.get(tid)!).map(depth));
    expect(Math.max(...tickets.map((t) => depth(s(t.ItemId))))).toBeGreaterThanOrEqual(3);
    // every milestone starts with at least one ticket, the first with work side by side
    const ms = w.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1).sort((a, b) => Number(a.Number) - Number(b.Number));
    for (const m of ms) {
      const mine = tickets.filter((t) => t.MilestoneId === m.ItemId);
      const free = mine.filter((t) => depsOf(t).every((d) => byId.get(d)!.MilestoneId !== m.ItemId));
      expect(free.length, `milestone ${s(m.Number)}`).toBeGreaterThanOrEqual(1);
      if (Number(m.Number) === 1) expect(free.length).toBeGreaterThanOrEqual(2);
      // never on a later milestone
      for (const t of mine) for (const d of depsOf(t)) expect(Number(ms.find((x) => x.ItemId === byId.get(d)!.MilestoneId)!.Number)).toBeLessThanOrEqual(Number(m.Number));
    }

    // planned again: the same dependencies, nothing doubled
    const before = new Map(tickets.map((t) => [s(t.ItemId), depsOf(t)]));
    await w.queue({ project: "B2B Order Portal", kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "replan-deps" });
    await w.settle();
    const after = w.rows("Ticket", pid);
    expect(after.length).toBe(tickets.length);
    for (const t of after) expect(depsOf(t)).toEqual(before.get(s(t.ItemId)));
  });

  it("build.run starts a ticket only when its dependencies are done, and runs independent tickets side by side", async () => {
    const p = w.project("B2B Order Portal");
    const pid = s(p.ItemId);
    for (let guard = 0; guard < 5; guard++) {
      const m = nextMilestone(w, pid);
      if (!m) break;
      const id = await w.queue({ project: "B2B Order Portal", kind: "build.run", input: { projectId: pid, milestoneId: m.ItemId }, key: `deps-build-${s(m.ItemId)}` });
      await w.settle();
      expect(w.get("EngineJob", id).Status).toBe("succeeded");
      const mine = w.rows("Ticket", pid).filter((t) => t.MilestoneId === m.ItemId);
      for (const t of mine) expect(t.Column).toBe("done");
      expectDependencyOrder(w, pid);
      if (Number(m.Number) === 1) expect(someRunSideBySide(w, mine)).toBe(true);
    }
    expect(nextMilestone(w, pid)).toBeNull();
  });

  it("a build interrupted half-way resumes without starting a ticket before its dependencies are done", async () => {
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const m = nextMilestone(w, pid)!;
    const id = await w.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: pid, milestoneId: m.ItemId }, key: "deps-restart" });
    let sleeps = 0;
    const first = createEngine({
      store: w.store,
      gateway: w.gw,
      config: () => w.config,
      log: () => undefined,
      writers: writerOf,
      now: () => w.now(),
      sleep: (_ms, signal) =>
        new Promise((resolve, reject) => {
          sleeps += 1;
          if (signal.aborted) return reject(new Error("aborted"));
          setImmediate(resolve);
        }),
      sweepMs: 0,
    });
    first.tick();
    while (sleeps < 14) await new Promise((r) => setImmediate(r));
    first.stop();
    await first.idle();
    expect(w.get("EngineJob", id).Status).toBe("running");
    const half = w.rows("Ticket", pid).filter((t) => t.MilestoneId === m.ItemId);
    expect(half.some((t) => t.Column !== "planned")).toBe(true);
    // waiting tickets are still in Planned while what they wait for is not done
    for (const t of half) if (depsOf(t).some((d) => w.get("Ticket", d).Column !== "done")) expect(t.Column).toBe("planned");

    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    for (const t of w.rows("Ticket", pid).filter((x) => x.MilestoneId === m.ItemId)) expect(t.Column).toBe("done");
    expectDependencyOrder(w, pid);
  });

  it("a cycle in stored dependencies does not stop the build", async () => {
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const m = nextMilestone(w, pid)!;
    const planned = w.rows("Ticket", pid).filter((t) => t.MilestoneId === m.ItemId && t.Column === "planned").sort((a, b) => Number(a.Number) - Number(b.Number));
    expect(planned.length).toBeGreaterThanOrEqual(2);
    const [a, b] = planned;
    await w.gw.update("Ticket", s(a!.ItemId), { DependsOn: [...depsOf(a!), s(b!.ItemId)] });
    await w.gw.update("Ticket", s(b!.ItemId), { DependsOn: [...depsOf(b!), s(a!.ItemId)] });
    const id = await w.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: pid, milestoneId: m.ItemId }, key: "deps-cycle" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    for (const t of w.rows("Ticket", pid).filter((x) => x.MilestoneId === m.ItemId)) expect(t.Column).toBe("done");
    // back to the planned dependencies (a cycle cannot be honoured both ways) for the checks that follow
    await w.gw.update("Ticket", s(a!.ItemId), { DependsOn: depsOf(a!) });
    await w.gw.update("Ticket", s(b!.ItemId), { DependsOn: depsOf(b!) });
  });

  it("an open ticket of another milestone that a ticket waits for is built first, in the same build", async () => {
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const m = nextMilestone(w, pid)!;
    const first = w.rows("Milestone", pid).find((x) => Number(x.Number) === 1 && x.ScopeVersion === m.ScopeVersion)!;
    // a task from the chat lands in the first milestone (already built); a ticket of this milestone waits for it
    const extra = await insertTicket(w, p, { MilestoneId: first.ItemId, Title: "Show the article number on the parts list" });
    const waiting = w.rows("Ticket", pid).filter((t) => t.MilestoneId === m.ItemId && t.Column === "planned").sort((x, y) => Number(x.Number) - Number(y.Number))[0]!;
    await w.gw.update("Ticket", s(waiting.ItemId), { DependsOn: [...depsOf(waiting), extra] });
    const id = await w.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: pid, milestoneId: m.ItemId }, key: "deps-pull" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    expect(w.get("Ticket", extra).Column).toBe("done");
    expect(job.OutputRefs).toContain(`Ticket:${extra}`);
    expect(s(w.get("Ticket", extra).DoneAt) < startOf(w, s(waiting.ItemId))!).toBe(true);
    expectDependencyOrder(w, pid);
  });

  it("change.build plans the change's tickets with their dependencies and builds them in that order", async () => {
    const p = w.project("Service Technician Portal");
    const pid = s(p.ItemId);
    const by = s(p.AssigneeUserId || p.CreatedByUserId);
    const number = Math.max(0, ...w.rows("ChangeRequest", pid).map((c) => Number(c.Number))) + 1;
    const res = await w.gw.insert("ChangeRequest", {
      ProjectId: pid, Number: number, Lane: "enhance", FeatureRef: "feature:visit-list", Title: "Regions for visits",
      Description: "Every visit in the planning gets the region of its customer site. The visit list can be filtered by the region of the visit. Regional managers receive a weekly summary e-mail.",
      Status: "building", Version: "1.4.0", RequestedByUserId: by,
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: `test:cr:${number}`,
    });
    const crId = s(res.itemId);
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: { projectId: pid, changeRequestId: crId }, key: "deps-change" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const tickets = w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === crId).sort((a, b) => Number(a.Number) - Number(b.Number));
    expect(tickets.length).toBe(3);
    const planned = changeDependencies(tickets.map((t) => s(t.Title)));
    tickets.forEach((t, k) => expect(depsOf(t)).toEqual(planned[k]!.map((j) => s(tickets[j]!.ItemId))));
    expect(tickets.some((t) => depsOf(t).length > 0)).toBe(true);
    for (const t of tickets) expect(t.Column).toBe("done");
    expectDependencyOrder(w, pid);
  });
});

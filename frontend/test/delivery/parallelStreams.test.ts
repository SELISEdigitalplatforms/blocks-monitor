// Parallel streams (src/domain/parallelStreams.ts) on the delivery side: what two builds share (overlap), the plan of
// streams (who runs in which stream, who waits for what, in order), the tech lead's suggestion and the 1..5 control,
// and the ops: cr.parallelStreams (the choice, never above the suggestion; business.edit or build.run holders only) and
// cr.startBuild / cr.fixChecks / build.retryAfterDeploy queueing a build beside others only with more than one stream.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/parallelStreams.test.ts
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { crStartBuildOp } from "../../functions/delivery/ops/changes/crStartBuild";
import { crFixChecksOp } from "../../functions/delivery/ops/changes/crFixChecks";
import { crParallelStreamsOp } from "../../functions/delivery/ops/changes/crStreams";
import { buildRetryAfterDeployOp } from "../../functions/delivery/ops/build/retryAfterDeploy";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, guardCases, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import {
  STARTING_WORDS, areasMeet, codeAreaOf, footprintOf, friendlyAreas, heldSuggestion, holdOf, independentChanges, landsAfterWords, narrowAreas, productFriendly, mayQueueBuild, mergeFriendly, overlapOf, overlapWords, parseStreamsAdvice, parseStreamsChoice, pathsIn, planStreams,
  queuedWords, repoKeysOf, serializeStreamsAdvice, serializeStreamsChoice, streamNumbers, streamOptions, streamsInUse, suggestStreams, type StreamChange, type StreamJob,
} from "../../src/domain/parallelStreams";

const analysis = (codeAreas: string[], o: { data?: boolean } = {}) => serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: o.data ? "feature" : "change", route: o.data ? "feature" : "fast", summary: "A change.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: !!o.data, conflicts: [], risks: [], acceptanceCriteria: ["Works."], tickets: [{ title: "Do it", description: "Do it.", ...(o.data ? { increment: 1 } : {}) }],
  ...(o.data ? { feature: { basis: "existing-product", increments: [{ title: "One", goal: "Done." }], parts: { api: true, web: false, data: true } } } : {}),
  estimate: { tickets: 1 }, questions: [], contextVersion: null, codeAreas,
})!);

const ch = (n: number, codeAreas: string[] | null, o: { status?: string; data?: boolean; title?: string } = {}): StreamChange => ({
  id: `cr-${n}`, lane: "change", number: n, title: o.title ?? `Change ${n}`, status: o.status ?? "approved", analysis: codeAreas === null ? null : analysis(codeAreas, o),
});
/** A change request with an analysis of its own shape (code areas, summary, tickets, a data part). */
function own(n: number, o: { codeAreas: string[]; kind?: "fix" | "change" | "feature"; title?: string; summary?: string; data?: boolean; tickets?: { title: string; description: string }[] }): StreamChange {
  const tickets = o.tickets ?? [{ title: "Do it", description: "Do it." }];
  const feature = o.kind === "feature";
  return {
    id: `cr-${n}`, lane: o.kind === "fix" ? "change" : "change", number: n, title: o.title ?? `Change ${n}`, status: "approved",
    analysis: serializeChangeAnalysis(parseChangeAnalysis({
      v: 1, kind: o.kind ?? "change", route: feature ? "feature" : "fast", summary: o.summary ?? "A change.", impact: { features: [], stories: [], screens: [], milestones: [] },
      scopeChange: feature, conflicts: [], risks: [], acceptanceCriteria: ["Works."], tickets: tickets.map((x) => ({ ...x, ...(feature ? { increment: 1 } : {}) })),
      ...(feature ? { feature: { basis: "existing-product", increments: [{ title: "One", goal: "Done." }], parts: { api: true, web: true, data: !!o.data } } } : {}),
      estimate: { tickets: tickets.length }, questions: [], contextVersion: null, codeAreas: o.codeAreas,
    })!),
  };
}
const t = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();
const job = (id: string, crId: string, status: string, o: { created?: number; claimed?: number; finished?: number; kind?: string; input?: Record<string, unknown> } = {}): StreamJob => ({
  id, kind: o.kind ?? "change.build", status, inputJson: JSON.stringify(o.kind === "build.run" ? { milestoneId: crId } : { changeRequestId: crId, ...o.input }),
  createdAt: t(o.created ?? 0), claimedAt: o.claimed !== undefined ? t(o.claimed) : null, finishedAt: o.finished !== undefined ? t(o.finished) : null,
});

describe("what two builds share", () => {
  it("reads code areas as the analysis names them", () => {
    expect(codeAreaOf("api: src/invoices/")).toEqual({ repo: "api", path: "src/invoices/" });
    expect(codeAreaOf("web:src\\pages\\Profile.tsx")).toEqual({ repo: "web", path: "src/pages/Profile.tsx" });
    expect(codeAreaOf("src/shared/date.ts")).toEqual({ repo: "", path: "src/shared/date.ts" });
    expect(codeAreaOf("api: src/x.ts (the totals)")).toEqual({ repo: "api", path: "src/x.ts" });
    expect(codeAreaOf("  ")).toBeNull();
    expect(codeAreaOf("api: ../etc/passwd")).toEqual({ repo: "api", path: "" });
  });

  it("a file inside a folder, the same file, never another repo", () => {
    const a = (x: string) => codeAreaOf(x)!;
    expect(areasMeet(a("api: src/invoices/"), a("api: src/invoices/total.ts"))).toBe(true);
    expect(areasMeet(a("api: src/invoices"), a("api: src/invoices/total.ts"))).toBe(true);
    expect(areasMeet(a("api: src/invoices/total.ts"), a("api: src/invoices/total.ts"))).toBe(true);
    expect(areasMeet(a("api: src/invoices/total.ts"), a("api: src/invoices/export.ts"))).toBe(false);
    expect(areasMeet(a("api: src/invoices-old/"), a("api: src/invoices/"))).toBe(false);
    expect(areasMeet(a("api: src/invoices/"), a("web: src/invoices/"))).toBe(false);
    // a path without a repo meets that path in any repo
    expect(areasMeet(a("src/invoices/"), a("web: src/invoices/list.tsx"))).toBe(true);
  });

  it("the same change, a milestone build, an unknown analysis, the data tables, shared code; else independent", () => {
    const inv = footprintOf(ch(1, ["api: src/invoices/"]));
    const exp = footprintOf(ch(2, ["api: src/invoices/export.ts", "web: src/pages/Invoices.tsx"]));
    const prof = footprintOf(ch(3, ["web: src/profile/"]));
    expect(overlapOf(inv, exp)).toEqual({ kind: "code", area: "api: src/invoices/export.ts" });
    expect(overlapOf(inv, prof)).toBeNull();
    expect(overlapOf(exp, prof)).toBeNull();
    expect(overlapOf(inv, footprintOf(ch(1, ["web: x/"])))).toEqual({ kind: "same-change" });
    expect(overlapOf(inv, footprintOf(null, { chain: "m-1", exclusive: true }))).toEqual({ kind: "exclusive" });
    // an analysis that names no code (or no analysis) runs alone
    expect(overlapOf(footprintOf(ch(4, [])), inv)).toEqual({ kind: "unknown", mine: true });
    expect(overlapOf(inv, footprintOf(ch(5, null)))).toEqual({ kind: "unknown", mine: false });
    // changing data on its own is no overlap (the data tables step lands one at a time anyway)
    const plans = footprintOf(ch(6, ["api: src/plans/"], { data: true }));
    const users = footprintOf(ch(8, ["api: src/users/"], { data: true }));
    expect(overlapOf(plans, users)).toBeNull();
    // two different migrations are no overlap; the same migration file is
    const m42 = footprintOf(ch(7, ["api: migrations/0042_add_plan.sql"]));
    expect(overlapOf(m42, footprintOf(ch(9, ["api: migrations/0043_add_user.sql"])))).toBeNull();
    expect(overlapOf(m42, footprintOf(ch(10, ["api: migrations/0042_add_plan.sql"])))).toEqual({ kind: "code", area: "api: migrations/0042_add_plan.sql" });
  });

  it("the same data table: a schema file, or a table the analysis or its tickets name", () => {
    const schema = footprintOf(own(20, { codeAreas: ["api: blocks/data/schemas/Membership.json", "api: src/rbac.ts"] }));
    expect(schema.tables).toEqual(["membership"]);
    const named = footprintOf(own(21, { codeAreas: ["api: src/members/list.ts"], tickets: [{ title: "Add the start date to the Membership table", description: "A new field." }] }));
    expect(named.tables).toEqual(["membership"]);
    expect(overlapOf(named, schema)).toEqual({ kind: "table", table: "membership" });
    expect(overlapWords({ kind: "table", table: "membership" }, "CR-020")).toBe("both change the Membership table");
    // "the data table" or "a schema" names no table
    const vague = footprintOf(own(22, { codeAreas: ["api: src/reports/"], summary: "Adds a field to the data table and the schema." }));
    expect(vague.tables).toEqual([]);
    expect(overlapOf(vague, schema)).toBeNull();
  });

  it("no code areas: the paths its planned tickets name; none anywhere: it runs alone", () => {
    expect(pathsIn("Fix the rounding in api/src/projects/entries.ts and cover it in api/test/projects.mjs.", ["api", "web"])).toEqual([
      { repo: "api", path: "src/projects/entries.ts" }, { repo: "api", path: "test/projects.mjs" },
    ]);
    expect(pathsIn("Touch web: src/pages/Team.tsx, src/shared/date.ts and the src/purchases/* pages.", ["api", "web"])).toEqual([
      { repo: "web", path: "src/pages/Team.tsx" }, { repo: "", path: "src/shared/date.ts" }, { repo: "", path: "src/purchases/" },
    ]);
    // never a web address or words with a slash
    expect(pathsIn("See https://example.org/docs/a.html and/or ask.", ["api"])).toEqual([]);
    const fromTickets = footprintOf(own(23, { codeAreas: [], tickets: [{ title: "Fix entries", description: "api/src/projects/entries.ts" }] }), { repoKeys: ["api", "web"] });
    expect(fromTickets).toMatchObject({ from: "tickets", known: true, areas: [{ repo: "api", path: "src/projects/entries.ts" }] });
    const none = footprintOf(own(24, { codeAreas: [], tickets: [{ title: "Make it faster", description: "Everything is slow." }] }));
    expect(none).toMatchObject({ from: "none", known: false });
    // a glob stands for its folder
    expect(codeAreaOf("api: src/purchases/*")).toEqual({ repo: "api", path: "src/purchases/" });
    expect(codeAreaOf("web: src/pages/team/**/*.tsx")).toEqual({ repo: "web", path: "src/pages/team/" });
  });
});

/** PrimaBook, 09.11.2026: CR-020 (employee master data, a feature with a data part) builds; CR-021, a fix whose analysis
 *  names no code areas and whose tickets name the API's project entries, is started. */
const CR020 = own(20, {
  kind: "feature", title: "Employee master data", data: true,
  codeAreas: [
    "api: blocks/data/schemas/Membership.json", "api: src/rbac.ts", "api: src/session.ts", "api: src/approvals/engine.ts", "api: src/purchases/*",
    "web: src/pages/team/", "web: src/pages/settings/", "web: src/pages/purchases/",
  ],
  summary: "Employees get master data on their Membership: start date, cost centre, approval limits.",
});
const CR021 = own(21, {
  kind: "fix", title: "Project time entries round wrongly", codeAreas: [],
  summary: "Time entries on projects are rounded to the wrong quarter hour. Nothing else in the scope is touched.",
  tickets: [{ title: "Round project time entries to the quarter hour", description: "Fix the rounding in api/src/projects/entries.ts and cover it in api/test/projects.mjs." }],
});

describe("the PrimaBook case: CR-020 and CR-021 build at once", () => {
  it("they share no file and no table: both build side by side", () => {
    const keys = ["api", "web"];
    const a = footprintOf(CR020, { repoKeys: keys });
    const b = footprintOf(CR021, { repoKeys: keys });
    expect(a.tables).toEqual(["membership"]);
    expect(b).toMatchObject({ from: "tickets", tables: [], areas: [{ repo: "api", path: "src/projects/entries.ts" }, { repo: "api", path: "test/projects.mjs" }] });
    expect(overlapOf(b, a)).toBeNull();
    const running = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j21", "cr-21", "queued", { created: 2 })], changes: [CR020, CR021], limit: 2, repoKeys: keys });
    expect(running.startable).toEqual(["j21"]);
    expect(running.starting).toEqual([expect.objectContaining({ jobId: "j21", code: "CR-021", state: "starting", words: STARTING_WORDS })]);
    expect(running.waiting).toEqual([]);
    // with one stream it is listed too, waiting for a free stream
    const one = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j21", "cr-21", "queued", { created: 2 })], changes: [CR020, CR021], limit: 1, repoKeys: keys });
    expect(one.waiting).toEqual([expect.objectContaining({ jobId: "j21", behind: null, words: "Waits for a free stream: one build at a time." })]);
    expect(queuedWords(one, "j21")).toBe("Waits for a free stream: one build at a time.");
  });

  it("a change that does touch CR-020's code develops beside it and lands after it, saying which file", () => {
    const session = own(22, { codeAreas: ["api: src/session.ts", "web: src/pages/login/"] });
    const plan = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j22", "cr-22", "queued", { created: 2 })], changes: [CR020, session], limit: 3 });
    expect(plan.waiting).toEqual([]);
    expect(plan.starting).toEqual([expect.objectContaining({
      jobId: "j22", state: "starting",
      words: "Starting: developing in parallel; lands after CR-020 (both change api: src/session.ts — will be rebased and checked again).",
    })]);
    // once it runs, its note says the same
    const both = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j22", "cr-22", "running", { created: 2, claimed: 2 })], changes: [CR020, session], limit: 3 });
    expect(both.running.map((r) => r.note)).toEqual(["", "Developing in parallel; lands after CR-020 (both change api: src/session.ts — will be rebased and checked again)."]);
    // a change whose analysis and tickets name no code develops in parallel too: its landing is checked like any other
    const blind = own(23, { codeAreas: [], tickets: [{ title: "Make it faster", description: "Everything is slow." }] });
    const alone = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j23", "cr-23", "queued", { created: 2 })], changes: [CR020, blind], limit: 3 });
    expect(alone.startable).toEqual(["j23"]);
    expect(alone.starting[0]!.words).toBe(STARTING_WORDS);
  });
});

describe("files that merge without harm", () => {
  it("tests, the changes' records and translations never make changes wait; shared source does", () => {
    for (const f of ["test/rbac.mjs", "tests/unit/a.ts", "e2e/login.spec.ts", "src/x/__tests__/y.ts", "src/a.test.ts", "src/b.spec.tsx", "docs/changes/CR-018.md", "src/i18n/de.json", "public/locales/fr/team.json", "locales/en.json"]) {
      expect(mergeFriendly(f), f).toBe(true);
    }
    for (const f of ["src/projects/entries.ts", "src/testing/helpers.ts", "docs/guide.md", "src/locale.ts", "src/contest/index.ts"]) expect(mergeFriendly(f), f).toBe(false);
    const a = footprintOf(own(18, { codeAreas: ["api: src/rbac.ts", "api: test/rbac.mjs", "api: docs/changes/CR-018.md"] }));
    const b = footprintOf(own(21, { codeAreas: ["api: src/projects/entries.ts", "api: test/rbac.mjs", "api: docs/changes/CR-021.md", "web: src/i18n/de.json"] }));
    expect(overlapOf(b, a)).toBeNull();
    // real source overlap still waits
    const c = footprintOf(own(22, { codeAreas: ["api: src/projects/entries.ts"] }));
    expect(overlapOf(c, b)).toEqual({ kind: "code", area: "api: src/projects/entries.ts" });
    // a change that only changes tests still names code: it never waits on its tests, and never runs alone
    const testsOnly = footprintOf(own(23, { codeAreas: ["api: test/rbac.mjs"] }));
    expect(testsOnly.known).toBe(true);
    expect(overlapOf(testsOnly, a)).toBeNull();
    const plan = planStreams({ jobs: [job("j18", "cr-18", "running", { created: 1, claimed: 1 }), job("j21", "cr-21", "queued", { created: 2 })], changes: [own(18, { codeAreas: ["api: src/rbac.ts", "api: test/rbac.mjs"] }), own(21, { codeAreas: ["api: src/projects/entries.ts", "api: test/rbac.mjs"] })], limit: 2 });
    expect(plan.startable).toEqual(["j21"]);
  });
});

describe("a folder narrowed to the files the tickets name; the product's merge-friendly files", () => {
  it("a folder area with files named inside it is those files; a folder alone stays the folder", () => {
    expect(narrowAreas([{ repo: "api", path: "src/routes/" }], [{ repo: "api", path: "src/routes/workingTime.ts" }, { repo: "api", path: "src/workingTime/service.ts" }]))
      .toEqual([{ repo: "api", path: "src/routes/workingTime.ts" }]);
    expect(narrowAreas([{ repo: "api", path: "src/routes/" }], [{ repo: "api", path: "src/workingTime/service.ts" }])).toEqual([{ repo: "api", path: "src/routes/" }]);
    expect(narrowAreas([{ repo: "api", path: "src/routes" }], [{ repo: "", path: "src/routes/index.ts" }])).toEqual([{ repo: "api", path: "src/routes/index.ts" }]);
    // a file area stays as it is; a file of another repo does not narrow it
    expect(narrowAreas([{ repo: "api", path: "src/rbac.ts" }, { repo: "web", path: "src/pages/" }], [{ repo: "api", path: "src/pages/x.ts" }]))
      .toEqual([{ repo: "api", path: "src/rbac.ts" }, { repo: "web", path: "src/pages/" }]);
  });

  it("PrimaBook: CR-022 adds a route file and no longer meets the projects route", () => {
    const cr22 = own(22, { codeAreas: ["api: src/routes/", "web: src/pages/time/"], tickets: [
      { title: "Working time API", description: "Add api/src/routes/workingTime.ts and api/src/workingTime/service.ts." },
      { title: "Working time page", description: "A new page under web/src/pages/time/WorkingTime.tsx." },
    ] });
    const projects = own(18, { codeAreas: ["api: src/routes/projects.ts", "api: src/projects/entries.ts"] });
    const fp = footprintOf(cr22, { repoKeys: ["api", "web"] });
    expect(fp.areas).toEqual([{ repo: "api", path: "src/routes/workingTime.ts" }, { repo: "web", path: "src/pages/time/WorkingTime.tsx" }]);
    expect(overlapOf(fp, footprintOf(projects, { repoKeys: ["api", "web"] }))).toBeNull();
    // with no file named in it, the folder still meets the projects route
    const blunt = own(25, { codeAreas: ["api: src/routes/"], tickets: [{ title: "Routes", description: "Some routes." }] });
    expect(overlapOf(footprintOf(blunt), footprintOf(projects))).toEqual({ kind: "code", area: "api: src/routes/projects.ts" });
  });

  it("the product's append-only registration files never make changes wait; their other code still does", () => {
    const friendly = ["api: src/rbac.ts", "web: src/pages/team/permissionCatalog.tsx", "api: src/routes/index.ts"];
    const cr20 = own(20, { codeAreas: ["api: src/rbac.ts", "api: src/members/", "web: src/pages/team/permissionCatalog.tsx"] });
    const cr23 = own(23, { codeAreas: ["api: src/rbac.ts", "api: src/approvals/", "web: src/pages/team/permissionCatalog.tsx", "api: src/routes/index.ts"] });
    expect(overlapOf(footprintOf(cr23), footprintOf(cr20))).toEqual({ kind: "code", area: "api: src/rbac.ts" });
    expect(overlapOf(footprintOf(cr23, { friendly }), footprintOf(cr20, { friendly }))).toBeNull();
    const members = own(26, { codeAreas: ["api: src/rbac.ts", "api: src/members/list.ts"] });
    expect(overlapOf(footprintOf(members, { friendly }), footprintOf(cr20, { friendly }))).toEqual({ kind: "code", area: "api: src/members/list.ts" });
    // the advice carries them; the plan and the suggestion use them
    const advice = parseStreamsAdvice(serializeStreamsAdvice({ v: 1, cap: 5, why: "", repos: 2, keys: ["api", "web"], friendly, at: t(0) }));
    expect(productFriendly(advice)).toEqual(friendly);
    expect(friendlyAreas(friendly)).toEqual([{ repo: "api", path: "src/rbac.ts" }, { repo: "web", path: "src/pages/team/permissionCatalog.tsx" }, { repo: "api", path: "src/routes/index.ts" }]);
    expect(independentChanges([cr20, cr23])).toBe(1);
    expect(independentChanges([cr20, cr23], ["api", "web"], friendly)).toBe(2);
    expect(suggestStreams({ changes: [cr20, cr23], advice }).reason).toBe("2 approved changes touch separate code; the environment allows 5.");
    const plan = planStreams({ jobs: [job("j20", "cr-20", "running", { created: 1, claimed: 1 }), job("j23", "cr-23", "running", { created: 2, claimed: 2 })], changes: [cr20, cr23], limit: 3, friendly });
    expect(plan.running.map((r) => r.note)).toEqual(["", ""]);
  });
});

describe("the plan of streams", () => {
  const changes = [ch(1, ["api: src/invoices/"]), ch(2, ["web: src/profile/"]), ch(3, ["api: src/invoices/export.ts"]), ch(4, ["web: src/reports/"]), ch(5, ["api: src/users/"])];

  it("optimistic parallel development: the streams hold a start, shared code only orders the landing", () => {
    const jobs = [job("j1", "cr-1", "queued", { created: 1 }), job("j2", "cr-2", "queued", { created: 2 }), job("j3", "cr-3", "queued", { created: 3 })];
    // three streams: all three develop at once, the one that shares code with CR-001 lands after it
    const three = planStreams({ jobs, changes, limit: 3 });
    expect(three.startable).toEqual(["j1", "j2", "j3"]);
    expect(three.starting.map((x) => x.words)).toEqual([
      STARTING_WORDS, STARTING_WORDS,
      "Starting: developing in parallel; lands after CR-001 (both change api: src/invoices/export.ts — will be rebased and checked again).",
    ]);
    // two streams: the third waits for a free stream, whatever it shares
    const two = planStreams({ jobs, changes, limit: 2 });
    expect(two.startable).toEqual(["j1", "j2"]);
    expect(two.waiting).toEqual([expect.objectContaining({ jobId: "j3", behind: null, words: "Waits for a free stream: all 2 are busy." })]);
  });

  it("beside running builds, overlapping or not, a queued one starts when a stream is free", () => {
    const jobs = [
      job("j1", "cr-1", "running", { created: 1, claimed: 2 }),
      job("j3", "cr-3", "queued", { created: 3 }),
      job("j4", "cr-4", "queued", { created: 4 }),
    ];
    const plan = planStreams({ jobs, changes, limit: 3 });
    expect(plan.running).toEqual([{ jobId: "j1", targetId: "cr-1", code: "CR-001", title: "Change 1", stream: 1, note: "" }]);
    expect(plan.startable).toEqual(["j3", "j4"]);
    expect(holdOf(footprintOf(changes[2]!), footprintOf(changes[0]!))).toBeNull();
    expect(landsAfterWords("CR-018", { kind: "code", area: "api: src/projects/entries.ts" })).toBe("Developing in parallel; lands after CR-018 (both change api: src/projects/entries.ts — will be rebased and checked again).");
  });

  it("all streams busy: waits for a free one; one stream: one build at a time, as before", () => {
    const busy = [job("j1", "cr-1", "running", { created: 1, claimed: 1 }), job("j2", "cr-2", "running", { created: 2, claimed: 2 }), job("j5", "cr-5", "queued", { created: 5 })];
    expect(planStreams({ jobs: busy, changes, limit: 2 }).waiting).toEqual([expect.objectContaining({ jobId: "j5", behind: null, words: "Waits for a free stream: all 2 are busy." })]);
    const one = planStreams({ jobs: [job("j2", "cr-2", "queued", { created: 2 }), job("j5", "cr-5", "queued", { created: 5 })], changes, limit: 1 });
    expect(one.startable).toEqual(["j2"]);
    expect(one.waiting).toEqual([expect.objectContaining({ jobId: "j5", words: "Waits for a free stream: one build at a time." })]);
  });

  it("a fix round of a change follows that change's build; a milestone build runs alone", () => {
    const jobs = [job("j1", "cr-1", "running", { created: 1, claimed: 1 }), job("f1", "cr-1", "queued", { created: 2, input: { fixChecks: true, round: 1 } })];
    expect(planStreams({ jobs, changes, limit: 3 }).waiting).toEqual([expect.objectContaining({ jobId: "f1", words: "Waits for CR-001: the next build of the same change follows it." })]);
    const ms = [job("m1", "ms-1", "running", { kind: "build.run", created: 1, claimed: 1 }), job("j2", "cr-2", "queued", { created: 2 })];
    expect(planStreams({ jobs: ms, changes, limit: 3 }).waiting).toEqual([expect.objectContaining({ jobId: "j2", words: "Waits for the milestone build: the milestone build builds alone." })]);
  });

  it("stream numbers stay with a running build", () => {
    const jobs = [
      job("a", "cr-1", "succeeded", { claimed: 1, finished: 10 }),
      job("b", "cr-2", "running", { claimed: 2 }),
      job("c", "cr-4", "running", { claimed: 12 }),
      job("d", "cr-5", "running", { claimed: 13 }),
    ];
    // a held stream 1 until minute 10; b keeps 2; c took 1 after a ended; d took 3
    expect(Object.fromEntries(streamNumbers(jobs))).toEqual({ a: 1, b: 2, c: 1, d: 3 });
    expect(planStreams({ jobs, changes, limit: 3 }).running.map((r) => [r.jobId, r.stream])).toEqual([["b", 2], ["c", 1], ["d", 3]]);
  });
});

describe("the suggestion and the choice", () => {
  it("counts the approved changes that touch separate code, at least 2, never above what the set-up allows", () => {
    const advice = parseStreamsAdvice(serializeStreamsAdvice({ v: 1, cap: 5, why: "", repos: 2, keys: ["api", "web"], at: t(0) }));
    const four = [ch(1, ["api: src/invoices/"]), ch(2, ["web: src/profile/"]), ch(3, ["api: src/reports/"], { status: "building" }), ch(4, ["web: src/team/"])];
    expect(independentChanges(four)).toBe(4);
    expect(suggestStreams({ changes: four, advice })).toEqual({ suggested: 4, cap: 5, reason: "4 approved changes touch separate code; the environment allows 5." });
    // shared code, tests aside: they count once; released or rejected changes and ones waiting for approval do not count
    const shared = [ch(1, ["api: src/invoices/", "api: test/a.mjs"]), ch(2, ["api: src/invoices/export.ts"]), ch(3, ["web: src/x/"], { status: "released-dev" }), ch(4, ["web: src/y/"], { status: "review" })];
    expect(independentChanges(shared)).toBe(1);
    expect(suggestStreams({ changes: shared, advice })).toEqual({ suggested: 2, cap: 5, reason: "One approved change waits right now; 2 is a safe start, and the environment allows 5." });
    expect(suggestStreams({ changes: [], advice }).reason).toBe("No approved change waits right now; 2 is a safe start, and the environment allows 5.");
    // never above the cap, with its reason; one at a time when the set-up says so
    const tight = parseStreamsAdvice(serializeStreamsAdvice({ v: 1, cap: 2, why: "The development environment allows 2 sms codes an hour and does not reset that with a deploy, while one change's checks need 3; 2 at most.", repos: 2, at: t(0) }));
    expect(suggestStreams({ changes: four, advice: tight })).toEqual({
      suggested: 2, cap: 2, reason: "4 approved changes touch separate code; the environment allows 2 (the development environment allows 2 sms codes an hour and does not reset that with a deploy, while one change's checks need 3; 2 at most).",
    });
    expect(suggestStreams({ changes: four, advice: { v: 1, cap: 1, why: "The product's repositories are not set up for separate working copies yet.", repos: 1, at: "" } })).toEqual({ suggested: 1, cap: 1, reason: "The product's repositories are not set up for separate working copies yet." });
    // before the build host checked the set-up: 2 for now
    expect(suggestStreams({ changes: four, advice: null })).toEqual({ suggested: 2, cap: 2, reason: "4 approved changes touch separate code; the build host has not checked the product's set-up yet, so 2 for now." });
    // what is queued or running right now does not move it (only the change requests and their analyses do), and the
    // page holds it while it is open: it only rises, or follows a new cap
    expect(suggestStreams({ changes: four, advice })).toEqual(suggestStreams({ changes: [...four], advice }));
    const shown = suggestStreams({ changes: four, advice });
    const fewer = suggestStreams({ changes: four.slice(0, 1), advice });
    expect(heldSuggestion(shown, fewer)).toBe(shown);
    expect(heldSuggestion(fewer, shown)).toBe(shown);
    expect(heldSuggestion(shown, suggestStreams({ changes: four, advice: tight }))).toMatchObject({ suggested: 2, cap: 2 });
    expect(heldSuggestion(null, fewer)).toBe(fewer);
    // the repo keys a ticket's path may start with
    const keyed = parseStreamsAdvice(serializeStreamsAdvice({ v: 1, cap: 2, why: "x", repos: 2, keys: ["api", "web"], at: t(0) }));
    expect(keyed!.keys).toEqual(["api", "web"]);
    expect(repoKeysOf(keyed)).toEqual(["api", "web"]);
    expect(repoKeysOf(null)).toEqual(["api", "web", "app"]);
  });

  it("the 1..5 control: above the suggestion disabled with a plain reason; read-only without the right", () => {
    const opts = streamOptions({ suggested: 3, cap: 4 }, true);
    expect(opts.map((o) => [o.n, o.disabled, o.suggested])).toEqual([[1, false, false], [2, false, false], [3, false, true], [4, true, false], [5, true, false]]);
    expect(opts[3]!.why).toBe("Above the tech lead's suggestion of 3.");
    expect(opts[4]!.why).toBe("The product's set-up does not allow this many yet.");
    expect(streamOptions({ suggested: 3, cap: 5 }, false).every((o) => o.disabled && o.why.includes("run builds or edit the business context"))).toBe(true);
    // the person's own saved choice is never shown as above the suggestion
    const saved = streamOptions({ suggested: 2, cap: 2 }, true, 3);
    expect(saved.map((o) => [o.n, o.disabled])).toEqual([[1, false], [2, false], [3, false], [4, true], [5, true]]);
  });

  it("the stored values and the streams in use (1 without a choice; never above the advice)", () => {
    const c = { v: 1 as const, chosen: 3, suggested: 3, reason: "x", by: "u-1", at: t(0) };
    expect(parseStreamsChoice(serializeStreamsChoice(c))).toEqual(c);
    expect(parseStreamsChoice('{"chosen": 9}')).toMatchObject({ chosen: 5 });
    expect(parseStreamsChoice("nonsense")).toBeNull();
    expect(streamsInUse(null, null)).toBe(1);
    expect(streamsInUse(c, null)).toBe(3);
    expect(streamsInUse(c, { v: 1, cap: 2, why: "", repos: 1, at: "" })).toBe(2);
  });

  it("whether a build may be asked for now", () => {
    const running = [job("j1", "cr-1", "running")];
    expect(mayQueueBuild({ jobs: [], limit: 1, targetId: "cr-2" })).toEqual({ ok: true });
    expect(mayQueueBuild({ jobs: running, limit: 1, targetId: "cr-2" })).toEqual({ ok: false, messageKey: "delivery.build.active" });
    expect(mayQueueBuild({ jobs: running, limit: 2, targetId: "cr-2" })).toEqual({ ok: true });
    expect(mayQueueBuild({ jobs: running, limit: 2, targetId: "cr-1" })).toMatchObject({ ok: false });
    expect(mayQueueBuild({ jobs: [job("m1", "ms-1", "running", { kind: "build.run" })], limit: 3, targetId: "cr-2" })).toMatchObject({ ok: false });
    expect(mayQueueBuild({ jobs: [job("j1", "cr-1", "succeeded")], limit: 1, targetId: "cr-2" })).toEqual({ ok: true });
  });
});

// ------------------------------------------------------------------ the ops

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };
type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : ({} as Record<string, any>));
const call = (w: FakeWorld, def: Parameters<typeof runOp>[2], op: string, args: Record<string, unknown>, requestId = `r-${op}-1`) =>
  runOp(w.ports, { op: op as never, requestId }, def, { projectId: FX.project, ...args });

/** v1.0.0 on dev and approved change requests with their analyses. */
async function world(areas: string[][], streams?: number) {
  const w = createFakeWorld();
  w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "https://app.dev.client.ch", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
  const crs = areas.map((a, i) => String(w.seed("ChangeRequest", {
    ProjectId: FX.project, Number: i + 1, Lane: "change", FeatureRef: "", Title: `Change ${i + 1}`, Description: "Do it.", Status: "approved", Version: "",
    RequestedByUserId: FX.owner, Analysis: analysis(a), DecidedAt: FX.now, ...stamps,
  }).ItemId));
  if (streams) await w.ports.update("Project", FX.project, { ParallelStreams: serializeStreamsChoice({ v: 1, chosen: streams, suggested: streams, reason: "", by: FX.owner, at: FX.now }) });
  return { w, crs };
}
const runningBuild = (w: FakeWorld, crId: string) =>
  String(w.seed("EngineJob", { ProjectId: FX.project, Kind: "change.build", Status: "running", ActiveKey: `change.build:${crId}`, InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: crId, version: "1.1.0" }), Progress: 40, Attempts: 1, RequestedByUserId: FX.owner, ...stamps } as never).ItemId);

describe("cr.parallelStreams: the person's choice", () => {
  it("is a delivery op for business.edit or build.run holders", async () => {
    expect(deliveryOps["cr.parallelStreams"]).toBe(crParallelStreamsOp);
    expect(crParallelStreamsOp.permission).toEqual(["business.edit", "build.run"]);
    for (const g of guardCases(["business.edit", "build.run"])) {
      const { w } = await world([["api: src/a/"], ["web: src/b/"]]);
      w.as(g.userId, { superAdmin: g.superAdmin });
      const res = await call(w, crParallelStreamsOp, "cr.parallelStreams", { chosen: 2 });
      if (g.code === null) expect(res.ok, `${g.name}: ${JSON.stringify(res)}`).toBe(true);
      else expect(err(res)?.code, g.name).toBe(g.code);
    }
  });

  it("stores the choice with the suggestion it was chosen from; never above it; 1..5 only", async () => {
    const { w } = await world([["api: src/a/"], ["api: src/a/b.ts"], ["api: src/a/c.ts"]]);
    // the engine host found the product allows 3; the waiting changes overlapping each other do not lower it
    await w.ports.update("Project", FX.project, { StreamsAdvice: serializeStreamsAdvice({ v: 1, cap: 3, why: "The development environment limits how often its checks may run; 3 at most.", repos: 2, keys: ["api", "web"], at: FX.now }) });
    // the three waiting changes share code: the tech lead suggests 2; the page held 3 while it was open: allowed, the
    // set-up allows 3
    const res = await call(w, crParallelStreamsOp, "cr.parallelStreams", { chosen: 3 });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res).suggestion).toMatchObject({ suggested: 2, cap: 3 });
    const stored = parseStreamsChoice(w.rows("Project").find((p) => p.ItemId === FX.project)!.ParallelStreams);
    expect(stored).toMatchObject({ chosen: 3, suggested: 2, by: FX.owner, reason: "One approved change waits right now; 2 is a safe start, and the environment allows 3." });
    expect(w.audits.find((a) => a.action === "cr.parallelStreams")?.details).toMatchObject({ chosen: 3, suggested: 2 });
    // never above what the set-up allows
    expect(err(await call(w, crParallelStreamsOp, "cr.parallelStreams", { chosen: 4 }, "r-4"))).toMatchObject({ code: "invalid_input", messageKey: "delivery.streams.aboveSuggestion", params: { suggested: 3 } });
    for (const bad of [0, 6, 2.5, "2"]) expect(err(await call(w, crParallelStreamsOp, "cr.parallelStreams", { chosen: bad }, `r-${bad}`))).toMatchObject({ code: "invalid_input" });
    // back to one at a time is always allowed
    expect((await call(w, crParallelStreamsOp, "cr.parallelStreams", { chosen: 1 }, "r-1b")).ok).toBe(true);
  });
});

describe("starting builds with parallel streams", () => {
  it("one stream (no choice): another build is running, as before", async () => {
    const { w, crs } = await world([["api: src/a/"], ["web: src/b/"]]);
    runningBuild(w, crs[0]!);
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crs[1] }))).toMatchObject({ code: "conflict", messageKey: "delivery.build.active" });
    expect(w.jobs).toHaveLength(0);
  });

  it("two streams: queued beside the running build (the engine starts it when the plan lets it)", async () => {
    const { w, crs } = await world([["api: src/a/"], ["web: src/b/"], ["api: src/a/x.ts"]], 2);
    runningBuild(w, crs[0]!);
    const res = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crs[1] });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(data(res)).toMatchObject({ existing: false, jobStatus: "queued" });
    // one that overlaps the running build is queued too: it waits in the engine's plan, in order
    const overlapping = await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crs[2] }, "r-3");
    expect(overlapping.ok, JSON.stringify(overlapping)).toBe(true);
    expect(w.jobs.map((j) => (j.input as { changeRequestId: string }).changeRequestId)).toEqual([crs[1], crs[2]]);
    // every build still gets a version of its own
    expect(new Set(w.jobs.map((j) => (j.input as { version: string }).version)).size).toBe(2);
  });

  it("never beside a milestone build or a build of the same change; a fix round queues beside other changes", async () => {
    const { w, crs } = await world([["api: src/a/"], ["web: src/b/"]], 3);
    w.seed("EngineJob", { ProjectId: FX.project, Kind: "build.run", Status: "running", InputJson: JSON.stringify({ milestoneId: "m-x" }), ...stamps } as never);
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crs[1] }))).toMatchObject({ messageKey: "delivery.build.active" });

    const two = await world([["api: src/a/"], ["web: src/b/"]], 3);
    // CR-2's build is on dev with failing checks; CR-1 builds now
    String(two.w.seed("EngineJob", {
      ProjectId: FX.project, Kind: "change.build", Status: "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: two.crs[1], version: "1.1.0" }),
      OutputRefs: [], Progress: 100, Message: "Done.", Attempts: 1, ErrorCode: "after-deploy:accept-failed=1/3", FinishedAt: FX.now, RequestedByUserId: FX.owner, ...stamps,
    } as never).ItemId);
    runningBuild(two.w, two.crs[0]!);
    const fix = await call(two.w, crFixChecksOp, "cr.fixChecks", { changeRequestId: two.crs[1] });
    expect(fix.ok, JSON.stringify(fix)).toBe(true);
    expect(two.w.jobs.at(-1)).toMatchObject({ kind: "change.build", input: { fixChecks: true, changeRequestId: two.crs[1] } });
    // a second build of CR-2 while its fix round is on its way: no
    const same = await call(two.w, buildRetryAfterDeployOp, "build.retryAfterDeploy", { jobId: String(two.w.rows("EngineJob").find((j) => j.Status === "succeeded")!.ItemId) }, "r-ad");
    expect(err(same)).toMatchObject({ messageKey: "delivery.build.active" });

    // the steps after a deploy of another change are queued beside a running build too (the engine runs them in the
    // merge turn); with one stream they wait for it, as before
    for (const [streams, ok] of [[3, true], [undefined, false]] as const) {
      const three = await world([["api: src/a/"], ["web: src/b/"]], streams);
      const built = String(three.w.seed("EngineJob", {
        ProjectId: FX.project, Kind: "change.build", Status: "succeeded", ActiveKey: "", InputJson: JSON.stringify({ projectId: FX.project, changeRequestId: three.crs[1], version: "1.1.0" }),
        OutputRefs: [], Progress: 100, Message: "Done.", Attempts: 1, ErrorCode: "after-deploy:texts-failed", FinishedAt: FX.now, RequestedByUserId: FX.owner, ...stamps,
      } as never).ItemId);
      runningBuild(three.w, three.crs[0]!);
      const res = await call(three.w, buildRetryAfterDeployOp, "build.retryAfterDeploy", { jobId: built });
      if (ok) expect(res.ok, JSON.stringify(res)).toBe(true);
      else expect(err(res)).toMatchObject({ messageKey: "delivery.build.active" });
    }
  });

  it("a tenant without the stream fields answers one stream", async () => {
    const { w, crs } = await world([["api: src/a/"], ["web: src/b/"]]);
    const real = w.ports.query;
    w.ports.query = (async (schema, filter, opts) => {
      if (schema === "Project" && opts?.fields?.includes("ParallelStreams")) throw new Error("unknown field ParallelStreams");
      return real(schema, filter, opts);
    }) as typeof real;
    runningBuild(w, crs[0]!);
    expect(err(await call(w, crStartBuildOp, "cr.startBuild", { changeRequestId: crs[1] }))).toMatchObject({ messageKey: "delivery.build.active" });
  });
});

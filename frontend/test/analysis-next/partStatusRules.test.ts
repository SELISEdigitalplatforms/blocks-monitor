/** Zero data mismatches on the Business Analysis rows (owner rule): a part's status never contradicts its own text.
 *  Three whole projects, all nine rows each, through the same pure summaries the page's hooks call:
 *  an existing product attached to the Factory as it is live (no analysis records of its own), a greenfield project in
 *  progress, and a fully analysed project. */
import { describe, expect, it } from "vitest";
import {
  featuresSummary, filesSummary, objectiveSummary, understoodSummary, workflowsSummary, type FeatureItem, type WorkflowItem,
} from "../../src/components/analysis-next/parts/brief/summaries";
import {
  featuresSummary as scopeFeaturesSummary, milestonesSummary, screensSummary, successSummaryRow,
} from "../../src/components/analysis-next/parts/scope/summaryModel";
import { LIVE_PRODUCT_TEXT, attachedLive, readiness, type PartSummary } from "../../src/components/analysis-next/model";
import { nextActionFrom } from "../../src/components/analysis-next/next/nextAction";
import type { ScopePhase } from "../../src/components/scope/blocks/pageState";
import { emptyTargets, type SuccessTargets } from "../../src/domain/successTargets";

/** Words that say a part is empty, unfinished or still being worked on. */
const PENDING = /being (read|written|planned|proposed|designed|re-planned)|not written|\byet\b|^no\b|^none\b/i;
/** Words that say someone is working on it right now. */
const WORKING = /\bbeing (read|written|planned|proposed|designed|re-planned)\b/i;

function expectConsistent(rows: readonly PartSummary[], o: { working: boolean }) {
  for (const r of rows) {
    expect(r.summary.trim(), r.id).not.toBe("");
    if (r.status === "confirmed") expect(r.summary, `${r.id} is Confirmed`).not.toMatch(PENDING);
    if (r.status === "skipped") expect(r.summary, `${r.id} is Not used`).not.toMatch(/\byet\b|being /i);
    if (!o.working) expect(r.summary, `${r.id}: nothing is running`).not.toMatch(WORKING);
  }
}

const files = (n: number, status = "ready") =>
  Array.from({ length: n }, (_, i) => ({ fileId: `f${i}`, name: `research-${i + 1}.pdf`, status, observationCount: 3 }));
const req = (id: string): FeatureItem => ({ id, title: `Requirement ${id}`, priority: "must", criteria: ["works"], status: "confirmed", sourceRefs: [] });
const known = { files: new Map<string, string>(), answers: new Set<string>() };
const feature = (id: string) => ({ id, ref: `feature:${id}`, name: `Feature ${id}`, priority: "must" as const, description: "", requirementIds: ["r1"], sortOrder: 1 });
const story = (id: string, featureId: string) => ({ id, featureId, actor: "customer", text: `do ${id}`, acceptanceCriteria: ["It works"], sortOrder: 0 });
const milestone = (id: string, refs: string[]) => ({ id, number: 1, name: "Booking", goal: "", featureRefs: refs, sortOrder: 1, status: "planned" });
function agreedTargets(): SuccessTargets {
  const t = emptyTargets();
  t.outcome.value = "70% of orders online";
  t.users.value = "300 buyers";
  t.responseTime.value = "under 1 second";
  t.dataVolume.value = "25,000 orders a year";
  return t;
}

/** The scope parts for a phase, with or without a plan. */
function scopeRows(phase: ScopePhase, o: { open: boolean; planned: boolean; live: boolean }): PartSummary[] {
  const base = { open: o.open, loading: false, error: null, phase, drafting: false, live: o.live };
  const features = o.planned ? [feature("f1")] : [];
  const stories = o.planned ? [story("s1", "f1")] : [];
  const milestones = o.planned ? [milestone("m1", ["feature:f1"])] : [];
  return [
    scopeFeaturesSummary({ ...base, features, stories, milestones, canEdit: false }),
    screensSummary({
      designOpen: o.open, scopeOpen: o.open, loading: false, phase, live: o.live,
      design: {
        busy: false, hasPrototype: o.planned, confirmed: o.planned, current: o.planned, incomplete: false, hasPreview: o.planned,
        unavailable: false, readsFailed: false, canApprove: false, key: "k",
      },
      screens: { items: o.planned ? [{ id: "x", name: "Home" }] : [], reviewedAt: o.planned ? "2026-11-08" : null, designing: false, canReview: false },
    }),
    milestonesSummary({ ...base, features, stories, milestones, plan: o.planned ? [{ name: "Booking", done: false }] : [], replanning: false, canEdit: false }),
    successSummaryRow({ ...base, targets: o.planned ? agreedTargets() : null, working: false, canEdit: false }),
  ];
}

describe("an existing product attached as it is live (no analysis records of its own)", () => {
  // PrimaBook: brownfield, never handed over, the stored step far past the scope, 12 research files read
  const project = { type: "brownfield", handedOverAt: null };
  const live = attachedLive(project);
  const rows: PartSummary[] = [
    understoodSummary({
      open: true, loading: false, signed: true, canAct: true, about: "", objective: "", users: "", conflictsOpen: 0, toCheck: 0,
      reading: 0, filesRead: 12, changes: [], live, sources: [], content: 1,
    }),
    filesSummary({ open: true, loading: false, error: false, signed: true, canAct: true, files: files(12), live }),
    objectiveSummary({ open: true, loading: false, approved: true, canAct: false, text: "", criteria: [], origin: null, drafting: false, live }),
    featuresSummary({ open: true, loading: false, approved: true, canAct: false, requirements: [], openSuggestions: 0, known, drafting: false, live }),
    workflowsSummary({ open: true, loading: false, approved: true, items: [], drafting: false, live }),
    ...scopeRows("buildStarted", { open: true, planned: false, live }),
  ];

  it("is recognised by the setup's own rule", () => {
    expect(live).toBe(true);
    expect(attachedLive({ type: "brownfield", handedOverAt: "2026-10-01" })).toBe(false);
    expect(attachedLive({ type: "greenfield", handedOverAt: null })).toBe(false);
    expect(attachedLive(null)).toBe(false);
  });

  it("never shows Confirmed over an empty part, and says why each part is not used", () => {
    expectConsistent(rows, { working: false });
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["understood", "skipped"], ["files", "confirmed"], ["objective", "skipped"], ["features", "skipped"], ["workflows", "skipped"],
      ["scope", "skipped"], ["screens", "skipped"], ["milestones", "skipped"], ["success", "skipped"],
    ]);
    expect(rows[0].summary).toBe("Read 12 files; no summary was written for this project.");
    expect(rows[1].summary).toBe("12 files read");
    for (const r of rows.slice(2)) expect(r.summary, r.id).toBe(LIVE_PRODUCT_TEXT);
  });

  it("counts only the parts it uses in the readiness, and the next card claims no scope", () => {
    expect(readiness(rows)).toEqual({ ready: 1, total: 1, needsYou: 0 });
    const next = nextActionFrom({ step: "build", loading: false, attachedLive: live });
    expect(next.title).toBe("All done here");
    expect(next.detail).not.toMatch(/scope/i);
  });

  it("says what it understood when the setup has a summary", () => {
    const s = understoodSummary({
      open: true, loading: false, signed: true, canAct: true, about: "Swiss accounting for small firms. More.", objective: "", users: "",
      conflictsOpen: 0, toCheck: 0, reading: 0, filesRead: 12, live, sources: [], content: 2,
    });
    expect(s).toMatchObject({ status: "confirmed", summary: "Swiss accounting for small firms" });
  });
});

describe("a greenfield project in progress", () => {
  const understood = {
    open: true, loading: false, canAct: true, about: "", objective: "", users: "", conflictsOpen: 0, toCheck: 0,
    reading: 0, filesRead: 0, live: false, sources: [], content: 1,
  };

  it("says files are being read only while they are, and 'not written yet' only at the current step", () => {
    expect(understoodSummary({ ...understood, signed: false, reading: 2, filesRead: 1 })).toMatchObject({ status: "needs-you", summary: "2 files are being read." });
    const idle = understoodSummary({ ...understood, signed: false, filesRead: 3 });
    expect(idle.summary).toBe("Read 3 files. The summary comes from your answers about the objective and who will use it.");
    expect(idle.status).toBe("needs-you");
    expect(understoodSummary({ ...understood, signed: false }).summary).toMatch(/^Not written yet/);
  });

  it("at the requirements step: 'being written' while the draft job runs, 'not written yet' when it does not", () => {
    const at = (drafting: boolean) => [
      understoodSummary({ ...understood, signed: true, about: "A web app where customers book repair slots. They pay online.", filesRead: 3 }),
      filesSummary({ open: true, loading: false, error: false, signed: true, canAct: true, files: files(3) }),
      objectiveSummary({ open: true, loading: false, approved: false, canAct: true, text: "", criteria: [], origin: null, drafting }),
      featuresSummary({ open: true, loading: false, approved: false, canAct: true, requirements: [], openSuggestions: 0, known, drafting }),
      workflowsSummary({ open: true, loading: false, approved: false, items: [], drafting }),
      ...scopeRows("beforeStep", { open: false, planned: false, live: false }),
    ];
    const writing = at(true);
    expectConsistent(writing, { working: true });
    expect(writing.map((r) => r.status)).toEqual(["confirmed", "confirmed", "draft", "draft", "draft", "not-started", "not-started", "not-started", "not-started"]);
    expect(writing.slice(2, 5).map((r) => r.summary)).toEqual(["Being written from your answers…", "Being written from your answers…", "Being written from your answers…"]);
    expect(writing[2].issues).toBeUndefined();

    const idle = at(false);
    expectConsistent(idle, { working: false });
    expect(idle[2]).toMatchObject({ status: "needs-you", summary: "Not written yet.", issues: ["Write the objective"] });
    expect(idle[3]).toMatchObject({ summary: "None written yet.", issues: ["Add at least one requirement"] });
    expect(idle[4].summary).toBe("No workflows, constraints or exclusions yet.");
    expect(readiness(idle)).toEqual({ ready: 2, total: 9, needsYou: 1 });
  });
});

describe("a fully analysed project", () => {
  const workflows: WorkflowItem[] = [
    { id: "w", kind: "workflow", title: "Book a slot", who: "Customer", steps: ["Pick", "Pay"], origin: "engine" },
    { id: "c", kind: "constraint", title: "GDPR", who: "", steps: [], origin: "engine" },
  ];
  const rows: PartSummary[] = [
    understoodSummary({
      open: true, loading: false, signed: true, canAct: true, about: "A web app where customers book repair slots.", objective: "Fewer calls",
      users: "Bike shop customers", conflictsOpen: 0, toCheck: 0, reading: 0, filesRead: 3, live: false, sources: [], content: 1,
    }),
    filesSummary({ open: true, loading: false, error: false, signed: true, canAct: true, files: files(3) }),
    objectiveSummary({ open: true, loading: false, approved: true, canAct: false, text: "Customers book online.", criteria: ["Half the calls"], origin: "engine" }),
    featuresSummary({ open: true, loading: false, approved: true, canAct: false, requirements: [req("a"), req("b")], openSuggestions: 1, known }),
    workflowsSummary({ open: true, loading: false, approved: true, items: workflows }),
    ...scopeRows("locked", { open: true, planned: true, live: false }),
  ];

  it("is Confirmed everywhere, with what each part holds", () => {
    expectConsistent(rows, { working: false });
    expect(rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(rows.map((r) => r.summary)).toEqual([
      "A web app where customers book repair slots", "3 files read", "Customers book online", "2 master features",
      "1 workflow · 1 constraint · 0 not included", "1 feature · 1 user story", "1 screen · reviewed", "1 milestone · first: Booking", "4 metrics · agreed",
    ]);
    expect(readiness(rows)).toEqual({ ready: 9, total: 9, needsYou: 0 });
    expect(nextActionFrom({ step: "board", loading: false, attachedLive: false }).detail).toBe("The scope is locked. The team is building it in Software Engineering.");
  });

  it("an empty part of an analysed project is Not used with its own words, not the live product's", () => {
    expect(workflowsSummary({ open: true, loading: false, approved: true, items: [] }))
      .toMatchObject({ status: "skipped", summary: "No workflows, constraints or exclusions in this project." });
    expect(filesSummary({ open: true, loading: false, error: false, signed: true, canAct: true, files: [] }))
      .toMatchObject({ status: "skipped", summary: "No files were shared for this project." });
    const [scope, screens, milestones, success] = scopeRows("locked", { open: true, planned: false, live: false });
    expect([scope.summary, screens.summary, milestones.summary, success.summary]).toEqual([
      "No features were planned for this project.", "No screens were designed for this project.",
      "No milestones were planned for this project.", "No success targets were set for this project.",
    ]);
  });
});

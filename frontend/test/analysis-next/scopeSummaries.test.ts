import { describe, expect, it } from "vitest";
import {
  LOOK_AND_FEEL_CHIP, featuresSummary, fingerprint, lookAndFeelFacts, lookAndFeelState, milestonesSummary, screensSummary, successIssues,
  successSummaryRow, type FeaturesFacts, type LookAndFeelFacts, type LookAndFeelReads, type MilestonesFacts, type ScreensFacts,
} from "../../src/components/analysis-next/parts/scope/summaryModel";
import { designStatus } from "../../src/components/design/designActions";
import type { EngineJob } from "../../src/blocks/engine/types";
import { SUCCESS_KEYS, emptyTargets, type SuccessTargets } from "../../src/domain/successTargets";

const base = { open: true, loading: false, error: null, phase: "draft" as const, drafting: false };

const feature = (id: string, priority: "must" | "nice" | "later" | "excluded" = "must") => ({
  id, ref: `feature:${id}`, name: `Feature ${id}`, priority, description: "", requirementIds: ["r1"], sortOrder: Number(id.replace(/\D/g, "")) || 0,
});
const story = (id: string, featureId: string, criteria: string[] = ["It works"]) => ({
  id, featureId, actor: "customer", text: `do ${id}`, acceptanceCriteria: criteria, sortOrder: 0,
});
const milestone = (id: string, number: number, refs: string[]) => ({
  id, number, name: `Milestone ${id}`, goal: "", featureRefs: refs, sortOrder: number, status: "planned",
});

function features(over: Partial<FeaturesFacts> = {}): FeaturesFacts {
  return {
    ...base,
    features: [feature("f1"), feature("f2"), feature("f3", "excluded")],
    stories: [story("s1", "f1"), story("s2", "f1"), story("s3", "f2")],
    milestones: [milestone("m1", 1, ["feature:f1", "feature:f2"])],
    canEdit: true,
    ...over,
  };
}

function milestones(over: Partial<MilestonesFacts> = {}): MilestonesFacts {
  return {
    ...base,
    features: [feature("f1"), feature("f2")],
    stories: [story("s1", "f1"), story("s2", "f2")],
    milestones: [milestone("m1", 1, ["feature:f1"]), milestone("m2", 2, ["feature:f2"])],
    plan: [{ name: "Booking and price list", done: false }, { name: "Payments", done: false }],
    replanning: false,
    canEdit: true,
    ...over,
  };
}

function targets(edit: (t: SuccessTargets) => void = () => {}): SuccessTargets {
  const t = emptyTargets();
  t.outcome.value = "70% of orders online";
  t.users.value = "300 buyers";
  t.responseTime.value = "under 1 second";
  t.dataVolume.value = "25,000 orders a year";
  t.availability.value = "weekdays";
  edit(t);
  return t;
}

const question = (status: "open" | "proposed") => ({
  status, text: "How fast?", askedAt: "", askedBy: "", answer: status === "proposed" ? "under 2 seconds" : "", reason: "", answeredAt: "", resolvedAt: "", resolvedBy: "",
});

describe("features & user stories row", () => {
  it("counts the included features and their stories", () => {
    const s = featuresSummary(features());
    expect(s.summary).toBe("2 features · 3 user stories · 1 left out");
    expect(s.status).toBe("draft");
    expect(s.issues).toEqual([]);
    expect(s.sources).toEqual(["Approved requirements"]);
  });

  it("is not started before the scope step, and confirmed once the scope is locked", () => {
    expect(featuresSummary(features({ open: false })).status).toBe("not-started");
    expect(featuresSummary(features({ phase: "beforeStep" })).status).toBe("not-started");
    expect(featuresSummary(features({ phase: "locked" })).status).toBe("confirmed");
    expect(featuresSummary(features({ phase: "locked", stories: [] })).issues).toBeUndefined();
  });

  it("lists the lock blockers (lockChecklist) and stories without an acceptance check", () => {
    const s = featuresSummary(features({ stories: [story("s1", "f1", []), story("s2", "f1", ["  "])] }));
    expect(s.status).toBe("needs-you");
    expect(s.issues).toEqual(["1 included feature has no user stories", "2 user stories have no acceptance check"]);
  });

  it("stays a draft for someone who cannot change it, and while the plan is drafted", () => {
    expect(featuresSummary(features({ stories: [], canEdit: false })).status).toBe("draft");
    const drafting = featuresSummary(features({ features: [], stories: [], drafting: true }));
    expect(drafting).toMatchObject({ status: "draft", summary: "Being written from the approved requirements" });
  });

  it("shows a quiet placeholder while loading", () => {
    expect(featuresSummary(features({ loading: true, phase: "beforeStep" }))).toMatchObject({ loading: true, status: "draft" });
  });
});

describe("milestones row", () => {
  it("names the first milestone", () => {
    const s = milestonesSummary(milestones());
    expect(s.summary).toBe("2 milestones · first: Booking and price list");
    expect(s.status).toBe("draft");
    expect(s.issues).toEqual([]);
  });

  it("needs you when a feature is in no milestone or a milestone is empty", () => {
    const s = milestonesSummary(milestones({ milestones: [milestone("m1", 1, ["feature:f1"]), milestone("m2", 2, [])] }));
    expect(s.status).toBe("needs-you");
    expect(s.issues).toEqual(["1 included feature is not in a milestone", "1 milestone is empty"]);
  });

  it("says only that no milestone is planned when there is none", () => {
    const s = milestonesSummary(milestones({ milestones: [], plan: [] }));
    expect(s.summary).toBe("No milestones planned yet");
    expect(s.issues).toEqual(["Add at least one milestone"]);
  });

  it("waits while the milestones are re-planned, and counts done ones after the lock", () => {
    expect(milestonesSummary(milestones({ replanning: true, milestones: [] , plan: [{ name: "A", done: false }] })).status).toBe("draft");
    const locked = milestonesSummary(milestones({ phase: "buildStarted", plan: [{ name: "A", done: true }, { name: "B", done: false }] }));
    expect(locked).toMatchObject({ status: "confirmed", summary: "2 milestones · 1 done" });
  });
});

describe("success metrics row", () => {
  it("all agreed", () => {
    const s = successSummaryRow({ ...base, targets: targets(), working: false, canEdit: true });
    expect(s).toMatchObject({ status: "draft", summary: "5 metrics · all agreed", issues: [] });
  });

  it("needs you while a target is missing, a question is open or an answer waits", () => {
    const t = targets((x) => {
      x.dataVolume.value = "";
      x.responseTime = { ...x.responseTime, value: "", unsure: true, question: question("open") };
      x.users = { ...x.users, value: "", unsure: true, question: question("proposed") };
    });
    const s = successSummaryRow({ ...base, targets: t, working: false, canEdit: true });
    expect(s.status).toBe("needs-you");
    expect(s.summary).toBe("4 metrics · 3 targets still open");
    expect(s.issues).toEqual([
      "1 success target is not set yet (data volume)",
      "1 success question is still open (response time)",
      "1 answer waits for your review (expected users)",
    ]);
    expect(successSummaryRow({ ...base, targets: t, working: true, canEdit: true }).status).toBe("draft");
  });

  it("says Proposed, not agreed, for the business analyst's untouched proposals until the scope is locked", () => {
    // E2E 08.11: every metric read "Agreed" although the person never agreed any of them
    const proposed = targets((x) => { for (const k of SUCCESS_KEYS) x[k].suggested = true; });
    expect(successSummaryRow({ ...base, targets: proposed, working: false, canEdit: true }))
      .toMatchObject({ status: "draft", summary: "5 metrics · all proposed by your business analyst", issues: [] });
    const some = targets((x) => { x.outcome.suggested = true; x.users.suggested = true; });
    expect(successSummaryRow({ ...base, targets: some, working: false, canEdit: true }).summary).toBe("5 metrics · 3 agreed · 2 proposed by your business analyst");
    // the lock agrees the scope with its targets
    expect(successSummaryRow({ ...base, phase: "locked", targets: proposed, working: false, canEdit: false }))
      .toMatchObject({ status: "confirmed", summary: "5 metrics · agreed with the scope" });
    expect(successSummaryRow({ ...base, phase: "locked", targets: targets(), working: false, canEdit: false }).summary).toBe("5 metrics · agreed");
  });

  it("no words for the analyst's role or the machine", () => {
    const t = targets((x) => { x.outcome = { ...x.outcome, value: "", unsure: true, question: question("open") }; });
    expect(successIssues(t).join(" ")).not.toMatch(/product manager|\bAI\b/);
  });

  it("blank targets", () => {
    expect(successSummaryRow({ ...base, targets: emptyTargets(), working: false, canEdit: true, drafting: true }).summary).toBe("Being proposed with the scope");
    const s = successSummaryRow({ ...base, targets: emptyTargets(), working: false, canEdit: true });
    expect(s.status).toBe("needs-you");
    expect(s.issues).toEqual(["4 success targets are not set yet (success outcome, expected users, response time and data volume)"]);
  });
});

describe("screens and look & feel row", () => {
  const facts = (over: Partial<ScreensFacts> = {}): ScreensFacts => ({
    designOpen: true, scopeOpen: true, loading: false, phase: "draft",
    design: {
      busy: false, hasPrototype: true, confirmed: true, current: true, incomplete: false, hasPreview: true, unavailable: false,
      readsFailed: false, canApprove: false, key: "k",
    },
    screens: { items: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Screen ${i}` })), reviewedAt: null, designing: false, canReview: true },
    ...over,
  });

  it("asks for the review of the scope's screens", () => {
    expect(screensSummary(facts())).toMatchObject({ status: "needs-you", summary: "10 screens to review", issues: ["Screens not reviewed yet"] });
    expect(screensSummary(facts({ screens: { ...facts().screens, reviewedAt: "2026-11-08T10:00:00Z" } })))
      .toMatchObject({ status: "draft", summary: "10 screens · reviewed" });
    expect(screensSummary(facts({ phase: "locked" })).status).toBe("confirmed");
  });

  it("follows the look & feel while the requirements are written", () => {
    const req = (design: Partial<ScreensFacts["design"]>) => screensSummary(facts({
      scopeOpen: false, phase: "beforeStep", design: { ...facts().design, ...design },
    }));
    expect(req({ confirmed: false, canApprove: true }))
      .toMatchObject({ status: "needs-you", summary: "Design ready to review and approve", issues: ["Design not approved yet"] });
    expect(req({ busy: true })).toMatchObject({ status: "draft", summary: "The design is being made" });
    expect(req({ confirmed: true })).toMatchObject({ status: "draft", summary: "Design approved · the screens follow with the scope" });
    expect(screensSummary(facts({ designOpen: false })).status).toBe("not-started");
  });

  it("says the design needs a new revision when the panel does, never 'ready to approve'", () => {
    const req = (design: Partial<ScreensFacts["design"]>) => screensSummary(facts({
      scopeOpen: false, phase: "beforeStep", design: { ...facts().design, ...design },
    }));
    // the bug: a saved design made from older goals and requirements; the panel says "Needs a new revision", Approve off
    const stale = { confirmed: false, current: false, canApprove: true };
    expect(designStatus({ ...facts().design, ...stale }).label).toBe("Needs a new revision");
    expect(req(stale)).toMatchObject({ status: "needs-you", summary: "The design needs a new revision", issues: ["Request an updated design"] });
    // an approved design that no longer matches is not "approved" either
    expect(req({ ...stale, confirmed: true }).summary).toBe("The design needs a new revision");
    // someone who may not change the design: the same words, nothing for them to do
    expect(req({ ...stale, canApprove: false }).status).toBe("draft");
    // while the updated design is made, it is being made (the panel: "Designing")
    expect(req({ ...stale, busy: true })).toMatchObject({ status: "draft", summary: "The design is being made" });
    // a read that failed is said as such, not guessed
    expect(req({ readsFailed: true }).summary).toBe("Couldn't read the design just now. Open this part to try again.");
    // the scope step without its own screens yet
    expect(screensSummary(facts({ screens: { ...facts().screens, items: [] }, design: { ...facts().design, current: false } })).summary)
      .toBe("Design needs a new revision · no screens for this scope yet");
  });

  it("follows every status of the panel's chip", () => {
    const keys = ["busy", "incomplete", "unavailable", "hasPrototype", "current", "hasPreview", "confirmed"] as const;
    for (let bits = 0; bits < 1 << keys.length; bits++) {
      const d = Object.fromEntries(keys.map((k, i) => [k, Boolean(bits & (1 << i))])) as unknown as LookAndFeelFacts;
      expect(Object.keys(LOOK_AND_FEEL_CHIP)).toContain(designStatus(d).label);
    }
  });
});

describe("the look & feel's facts (MakeDesignPanel's rules)", () => {
  const SOURCE = "factory-v1:ux-current";
  const design = (source: string, over: Record<string, unknown> = {}) => JSON.stringify({
    provider: "figma-design", projectId: "p1", projectUrl: "[private]", previewUrl: `/api/design-preview/p1/${"a".repeat(64)}`,
    revision: "a".repeat(64), source, jobId: "job-1", artifactFileId: "art-1", screens: [{ name: "Home", nodeId: "1:2", requirementKeys: ["R-1"] }],
    ...over,
  });
  const reads = (over: Partial<LookAndFeelReads> = {}): LookAndFeelReads => ({
    brief: { id: "b1", mode: "figma", status: "draft", prototypeJson: design(SOURCE) },
    briefFetching: false,
    requirements: [{ id: "r1", key: "R-1", title: "Book a slot", detail: "Customers book a slot", criteria: ["A booking is saved"] }],
    requirementsRead: true,
    jobs: [],
    intentSource: SOURCE,
    ...over,
  });
  const job = (status: EngineJob["status"], input: Record<string, unknown>): EngineJob => ({
    id: `j-${status}`, workspaceId: "w", projectId: "p1", kind: "design.generate", status, inputJson: JSON.stringify(input), outputRefs: [],
    progress: 0, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: null, finishedAt: null, createdBy: null,
    createdAt: "2026-11-08T10:00:00Z", updatedAt: null,
  });

  it("is current when the saved design was made from today's design intent", () => {
    const f = lookAndFeelFacts(reads());
    expect(f).toMatchObject({ hasPrototype: true, current: true, busy: false, hasPreview: true, incomplete: false, unavailable: false });
    expect(screensSummary({
      designOpen: true, scopeOpen: false, loading: false, phase: "beforeStep",
      design: { ...f, readsFailed: false, canApprove: true, key: "k" },
      screens: { items: [], reviewedAt: null, designing: false, canReview: false },
    })).toMatchObject({ status: "needs-you", summary: "Design ready to review and approve" });
  });

  it("is stale once the goals and requirements moved on (a new intent source), as the panel says", () => {
    const f = lookAndFeelFacts(reads({ intentSource: "factory-v1:ux-newer" }));
    expect(f.current).toBe(false);
    expect(designStatus(f).label).toBe("Needs a new revision");
    expect(screensSummary({
      designOpen: true, scopeOpen: false, loading: false, phase: "beforeStep",
      design: { ...f, readsFailed: false, canApprove: true, key: "k" },
      screens: { items: [], reviewedAt: null, designing: false, canReview: false },
    })).toMatchObject({ status: "needs-you", summary: "The design needs a new revision", issues: ["Request an updated design"] });
  });

  it("keeps a design made before 08.11 current while the records its intent read are unchanged (designBrief.context legacySource)", () => {
    const old = lookAndFeelFacts(reads({ intentSource: "factory-v1:ux-newer", intentLegacySource: SOURCE, brief: { ...reads().brief!, status: "confirmed" } }));
    expect(old.current).toBe(true);
    expect(designStatus(old).label).toBe("Approved");
    expect(lookAndFeelFacts(reads({ intentSource: "factory-v1:ux-newer", intentLegacySource: "factory-v1:ux-older" })).current).toBe(false);
  });

  it("is never current while the requirements are not read, or for a brief not in figma mode", () => {
    expect(lookAndFeelFacts(reads({ requirementsRead: false })).current).toBe(false);
    expect(lookAndFeelFacts(reads({ brief: { ...reads().brief!, mode: "describe" } })).current).toBe(false);
  });

  it("is busy while this brief's design job runs, and unavailable when its attempt failed", () => {
    expect(lookAndFeelFacts(reads({ jobs: [job("running", { designBriefId: "b1", source: SOURCE })] })).busy).toBe(true);
    expect(lookAndFeelFacts(reads({ jobs: [job("running", { designBriefId: "other", source: SOURCE })] })).busy).toBe(false);
    expect(lookAndFeelFacts(reads({ jobs: [job("failed", { designBriefId: "b1", source: SOURCE })] })).unavailable).toBe(true);
    expect(lookAndFeelFacts(reads({ brief: { ...reads().brief!, prototypeJson: design(SOURCE, { reviewComplete: false }) } })).incomplete).toBe(true);
  });

  it("never calls the job that made the design on screen a new design while its row still says running", () => {
    const maker = { ...job("running", { designBriefId: "b1", source: SOURCE }), id: "job-1" };
    const f = lookAndFeelFacts(reads({ jobs: [maker] }));
    expect(f.busy).toBe(false);
    expect(lookAndFeelState(f)).toBe("review");
    // with screens still missing, that job is still finishing the same design
    expect(lookAndFeelFacts(reads({ jobs: [maker], brief: { ...reads().brief!, prototypeJson: design(SOURCE, { reviewComplete: false }) } })).busy).toBe(true);
  });
});

describe("fingerprint", () => {
  it("is stable for the same content and changes with it", () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    const a = featuresSummary(features()).fingerprint;
    expect(featuresSummary(features()).fingerprint).toBe(a);
    expect(featuresSummary(features({ stories: [story("s1", "f1"), story("s3", "f2")] })).fingerprint).not.toBe(a);
  });
});

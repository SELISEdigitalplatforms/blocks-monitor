// New features on existing products (no Factory scope): the route, the stored FeatureDeliveryPlan, its increments and
// the build's step budget; the analysis's acceptance of a feature on an existing product; products with a scope still
// send a new feature through Scope & success.
import { describe, expect, it } from "vitest";
import {
  FEATURE_DELIVERY_LIMITS,
  changeRouteFor,
  featureMaxSteps,
  featureSize,
  incrementOfTicket,
  incrementsOf,
  nextIncrement,
  normaliseFeaturePlan,
  parseChangeAnalysis,
  planIndexOf,
  serializeChangeAnalysis,
  splitIncrements,
} from "../../src/domain/changeAnalysis";
import { checkChangeForBuild } from "../../src/domain/delivery";
import { acceptAnalysis, analysisSchema } from "../../server/local/engine/kinds/changes/ai";
import { laneFor, laneSteps } from "../../server/local/engine/official/build";
import { featureProgress, partsText } from "../../src/components/changes/changeFlow";

const ticket = (title: string, increment?: number) => ({ title, description: `Build ${title}.`, ...(increment ? { increment } : {}) });

const FEATURE = {
  v: 1,
  kind: "feature",
  summary: "Accountants can send payment reminders for overdue invoices.",
  impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: false,
  conflicts: [],
  risks: ["Invoices already paid must never get a reminder."],
  acceptanceCriteria: ["An overdue invoice offers a reminder.", "A paid invoice never gets one."],
  tickets: [ticket("Reminder letter", 2), ticket("Overdue list", 1), ticket("Reminder API", 1), ticket("Reminder history", 2)],
  questions: [],
  contextVersion: 3,
  feature: { basis: "existing-product", parts: { api: true, web: true, data: true }, increments: [{ title: "Find overdue invoices", goal: "See which invoices are overdue." }, { title: "Send reminders", goal: "Send and track reminders." }] },
};

describe("the route of a new feature", () => {
  it("builds as a feature delivery on a product without a Factory scope, and goes through Scope & success with one", () => {
    expect(changeRouteFor("feature", false, undefined, null, true)).toBe("feature");
    expect(changeRouteFor("feature", true, "scope", null, true)).toBe("feature");
    expect(changeRouteFor("feature", false)).toBe("scope");
    expect(changeRouteFor("feature", true, undefined, null, false)).toBe("scope");
    expect(changeRouteFor("change", false, undefined, null, true)).toBe("fast");
    // a person's decision to build it as a change still wins
    expect(changeRouteFor("feature", true, undefined, { route: "fast", by: "u", at: "t" }, true)).toBe("fast");
  });

  it("an approved feature delivery may build; a scope-route feature may not", () => {
    const cr = { status: "approved", title: "Payment reminders", description: "Remind customers.", decidedAt: "2026-11-05T10:00:00.000Z" };
    expect(checkChangeForBuild({ ...cr, route: "feature" }, 1).ok).toBe(true);
    const scope = checkChangeForBuild({ ...cr, route: "scope" }, 1);
    expect(scope.ok ? null : scope.messageKey).toBe("delivery.cr.scopeRoute");
  });
});

describe("the stored plan", () => {
  it("parses a feature with its plan: tickets in increment order, route feature, stable when stored again", () => {
    const a = parseChangeAnalysis(FEATURE)!;
    expect(a.route).toBe("feature");
    expect(a.feature).toEqual({ basis: "existing-product", parts: { api: true, web: true, data: true }, increments: FEATURE.feature.increments });
    expect(a.tickets.map((t) => [t.title, t.increment])).toEqual([["Overdue list", 1], ["Reminder API", 1], ["Reminder letter", 2], ["Reminder history", 2]]);
    expect(a.estimate.tickets).toBe(4);
    expect(parseChangeAnalysis(serializeChangeAnalysis(a))).toEqual(a);
  });

  it("a feature without a plan stays on the scope route, and no other analysis keeps increments", () => {
    const { feature: _f, ...noPlan } = FEATURE;
    const scoped = parseChangeAnalysis(noPlan)!;
    expect(scoped.route).toBe("scope");
    expect(scoped.feature).toBeUndefined();
    expect(scoped.tickets.every((t) => t.increment === undefined)).toBe(true);
    const change = parseChangeAnalysis({ ...FEATURE, kind: "change" })!;
    expect(change).toMatchObject({ route: "fast" });
    expect(change.feature).toBeUndefined();
    expect(change.tickets.every((t) => t.increment === undefined)).toBe(true);
  });

  it("normalises: unknown increments to the last, none to the first, empty increments left out and renumbered", () => {
    const n = normaliseFeaturePlan({ basis: "existing-product", increments: [{ title: "A" }, { title: "B" }, { title: "C" }] }, [ticket("x", 3), ticket("y"), ticket("z", 9)])!;
    expect(n.plan.increments.map((i) => i.title)).toEqual(["A", "C"]);
    expect(n.tickets.map((t) => [t.title, t.increment])).toEqual([["y", 1], ["x", 2], ["z", 2]]);
    expect(normaliseFeaturePlan({ basis: "other" }, [])).toBeNull();
    expect(normaliseFeaturePlan({ basis: "existing-product" }, [ticket("x")])!.plan.increments).toHaveLength(1);
  });

  it("splits an increment that is too big into builds of at most 6 tickets", () => {
    const many = Array.from({ length: 8 }, (_v, i) => ticket(`t${i}`, 1));
    const n = normaliseFeaturePlan({ basis: "existing-product", increments: [{ title: "Core" }, { title: "Extras" }] }, [...many, ticket("e", 2)])!;
    const s = splitIncrements(n.plan, n.tickets);
    expect(s.plan.increments.map((i) => i.title)).toEqual(["Core (part 1 of 2)", "Core (part 2 of 2)", "Extras"]);
    expect(s.tickets.map((t) => t.increment)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 3]);
    expect(Math.max(...incrementsOf({ tickets: s.tickets, feature: s.plan }).map((i) => i.tickets.length))).toBeLessThanOrEqual(FEATURE_DELIVERY_LIMITS.ticketsPerIncrement);
  });
});

describe("the increments", () => {
  const a = parseChangeAnalysis(FEATURE)!;

  it("groups the tickets by increment and finds the next one to build", () => {
    expect(incrementsOf(a).map((i) => [i.n, i.title, i.tickets])).toEqual([[1, "Find overdue invoices", [0, 1]], [2, "Send reminders", [2, 3]]]);
    expect(incrementOfTicket(a, 3)).toBe(2);
    expect(nextIncrement(a, () => false)).toBe(1);
    expect(nextIncrement(a, (k) => k < 2)).toBe(2);
    expect(nextIncrement(a, () => true)).toBeNull();
    // a change is one build of all of its tickets
    const change = parseChangeAnalysis({ ...FEATURE, kind: "change" })!;
    expect(incrementsOf(change)).toEqual([{ n: 1, title: "", goal: "", tickets: [0, 1, 2, 3] }]);
  });

  it("reads the planned ticket's index from its PlanRef", () => {
    expect(planIndexOf("cr:abc:3", "abc")).toBe(3);
    expect(planIndexOf("cr:other:3", "abc")).toBeNull();
    expect(planIndexOf("fx:4:abc", "abc")).toBe(0);
    expect(planIndexOf("fx:4:abc:2", "abc")).toBe(2);
    expect(planIndexOf("feature:abc", "abc")).toBeNull();
  });

  it("the page's progress: built increments, the next one, from the tickets on the board", () => {
    const board = [
      { planRef: "cr:c1:0", isDone: true }, { planRef: "cr:c1:1", isDone: true },
      { planRef: "cr:c1:2", isDone: false }, { planRef: "cr:c1:3", isDone: false }, { planRef: "cr:c2:0", isDone: true },
    ];
    const p = featureProgress(a, "c1", board)!;
    expect(p).toMatchObject({ next: 2, built: 1 });
    expect(p.increments.map((i) => [i.n, i.done, i.built])).toEqual([[1, 2, true], [2, 0, false]]);
    expect(featureProgress(parseChangeAnalysis({ ...FEATURE, kind: "change" }), "c1", board)).toBeNull();
    expect(partsText(a.feature!.parts)).toBe("API, web app and data");
  });

  it("sizes each build of the official feature lane: tickets x parts, 4 to the hard cap 12", () => {
    const all = { api: true, web: true, data: true };
    expect(featureMaxSteps(1, { api: false, web: true, data: false })).toBe(4);
    expect(featureMaxSteps(3, { api: true, web: true, data: false })).toBe(6);
    expect(featureMaxSteps(6, all)).toBe(12);
    expect(featureMaxSteps(18, all)).toBe(FEATURE_DELIVERY_LIMITS.laneMaxSteps);
    expect(featureSize(a)).toBe("large");
    expect(featureSize({ tickets: a.tickets.slice(0, 2), feature: { ...a.feature!, increments: a.feature!.increments.slice(0, 1) } })).toBe("small");
    // the lane: a feature always goes through the feature lane (even with one ticket), with the caller's step budget
    expect(laneFor("feature", 1)).toBe("feature");
    expect(laneFor("change", 1)).toBe("quick");
    expect(laneSteps(2, 9)).toBe(9);
    expect(laneSteps(2, 40)).toBe(12);
    expect(laneSteps(5)).toBe(5);
  });
});

describe("the analysis of a feature on an existing product", () => {
  const names = { features: [], stories: [], screens: [], milestones: [] };
  const raw = {
    kind: "feature",
    scopeChange: true,
    summary: "Accountants can send payment reminders for overdue invoices.",
    impact: { features: [], stories: [], screens: [], milestones: [] },
    conflicts: [],
    risks: ["Paid invoices must never get a reminder."],
    acceptanceCriteria: ["An overdue invoice offers a reminder.", "A paid invoice never gets one.", "Every reminder is listed on the invoice."],
    tickets: [...Array.from({ length: 8 }, (_v, i) => ticket(`Reminder part ${i + 1}`, 2)), ticket("Overdue list", 1)],
    increments: [{ title: "Find overdue invoices", goal: "See which invoices are overdue." }, { title: "Send reminders", goal: "Send and track reminders." }],
    parts: { api: true, web: true, data: false },
    questions: [],
  };

  it("plans a feature delivery: route feature, no scope change, every build at most 6 tickets", () => {
    const a = acceptAnalysis(raw, { names, prior: null, contextVersion: 4, existing: true });
    expect(a).toMatchObject({ kind: "feature", route: "feature", scopeChange: false, estimate: { tickets: 9 } });
    expect(a.feature!.parts).toEqual({ api: true, web: true, data: false });
    expect(a.feature!.increments.map((i) => i.title)).toEqual(["Find overdue invoices", "Send reminders (part 1 of 2)", "Send reminders (part 2 of 2)"]);
    expect(a.tickets[0]).toMatchObject({ title: "Overdue list", increment: 1 });
    expect(incrementsOf(a).map((i) => i.tickets.length)).toEqual([1, 6, 2]);
    // stored and read back, it is the same plan
    expect(parseChangeAnalysis(serializeChangeAnalysis(a))).toEqual(a);
  });

  it("a change on an existing product stays a small change on the fast route, without a clash question", () => {
    const a = acceptAnalysis({ ...raw, kind: "change", scopeChange: true, conflicts: ["Differs from the scope"] }, { names, prior: null, contextVersion: 4, existing: true });
    expect(a).toMatchObject({ kind: "change", route: "fast", scopeChange: false, questions: [] });
    expect(a.tickets).toHaveLength(6);
    expect(a.feature).toBeUndefined();
  });

  it("on a product with a scope the same answer still goes through Scope & success", () => {
    const { increments: _i, parts: _p, ...plain } = raw;
    const a = acceptAnalysis(plain, { names, prior: null, contextVersion: 4 });
    expect(a).toMatchObject({ kind: "feature", route: "scope", scopeChange: true });
    expect(a.feature).toBeUndefined();
    expect(a.tickets).toHaveLength(6);
  });

  it("asks for increments and parts only on an existing product", () => {
    const existing = analysisSchema(names, 3, null, true) as { properties: Record<string, any>; required: string[] };
    expect(existing.required).toEqual(expect.arrayContaining(["increments", "parts", "tickets"]));
    expect(existing.properties.tickets.maxItems).toBe(FEATURE_DELIVERY_LIMITS.tickets);
    expect(existing.properties.tickets.items.required).toContain("increment");
    expect(existing.properties.increments.maxItems).toBe(FEATURE_DELIVERY_LIMITS.proposedIncrements);
    const scoped = analysisSchema(names, 3, null) as { properties: Record<string, any> };
    expect(scoped.properties.increments).toBeUndefined();
    expect(scoped.properties.parts).toBeUndefined();
    expect(scoped.properties.tickets.maxItems).toBe(6);
  });
});

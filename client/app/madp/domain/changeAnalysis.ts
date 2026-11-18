/**
 * ChangeRequest.Analysis (version 1): the engine's analysis of a change
 * request, plus the answers added by cr.answer. Shape is fixed by
 * engine-host/CHANGE-PROCESS-31.10.md. Pure and import-free: the mf-delivery
 * function, the engine worker and the web all use this file.
 *
 * parseChangeAnalysis is safe on anything (stored text, model output,
 * objects): it never throws, trims and clamps every field, drops unusable
 * items and returns null only when there is no usable analysis at all.
 */

export const CHANGE_ANALYSIS_VERSION = 1 as const;

export const CHANGE_KINDS = ["fix", "change", "feature"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** fast: a change or a fix, built on approval; scope: a new feature on a product with a Factory scope, added through
 *  Scope & success; feature: a new feature on a product without a Factory scope (an existing product attached as it is
 *  live), built on approval in increments (FeatureDeliveryPlan). */
export const CHANGE_ROUTES = ["fast", "scope", "feature"] as const;
export type ChangeRoute = (typeof CHANGE_ROUTES)[number];

export const CHANGE_ANALYSIS_LIMITS = {
  /** Stored JSON text, in characters. */
  json: 100_000,
  summary: 1000,
  item: 500,
  listItems: 20,
  /** Planned tickets a stored analysis keeps (a change plans at most 6, a feature on an existing product at most 18). */
  tickets: 24,
  ticketTitle: 120,
  ticketDescription: 4000,
  questions: 3,
  questionText: 500,
  options: 4,
  option: 200,
  answer: 2000,
  /** Builds a feature on an existing product is split into (FeatureDeliveryPlan.increments). */
  increments: 6,
  incrementTitle: 120,
} as const;

/** A feature on an existing product: at most this many tickets in all, and at most this many in one build (increment),
 *  so no build becomes one huge risky change. */
export const FEATURE_DELIVERY_LIMITS = {
  tickets: 18,
  ticketsPerIncrement: 6,
  /** Increments the analysis may propose (splitting an increment that is too big may add up to two more). */
  proposedIncrements: 4,
  /** The official feature lane's hard cap on --max-steps. */
  laneMaxSteps: 12,
  laneMinSteps: 4,
} as const;

export interface ChangeAnalysisImpact {
  features: string[];
  stories: string[];
  screens: string[];
  milestones: string[];
}

export interface ChangeAnalysisTicket {
  title: string;
  description: string;
  /** The increment (1-based) the ticket is built in; only in an analysis with a FeatureDeliveryPlan. */
  increment?: number;
}

/** One build of a feature on an existing product: deployed to dev and shown to people before the next one starts. */
export interface ChangeIncrement {
  title: string;
  /** What people can try on dev once it is built. */
  goal: string;
}

/**
 * How a new feature is delivered on a product that has no Factory scope (an existing product attached as it is live):
 * built on the existing product, in increments like milestones. Every ticket names its increment; increments are in
 * build order and each has at least one ticket (except in an analysis without tickets).
 */
export interface FeatureDeliveryPlan {
  basis: "existing-product";
  /** The parts of the product the feature changes. */
  parts: { api: boolean; web: boolean; data: boolean };
  increments: ChangeIncrement[];
}

export interface ChangeAnalysisQuestion {
  id: string;
  text: string;
  options: string[];
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
}

export interface ChangeAnalysis {
  v: 1;
  kind: ChangeKind;
  /** "feature" for a feature with a FeatureDeliveryPlan (a product without a Factory scope); otherwise "scope" whenever
   *  kind is "feature" or scopeChange is true. */
  route: ChangeRoute;
  summary: string;
  impact: ChangeAnalysisImpact;
  scopeChange: boolean;
  conflicts: string[];
  risks: string[];
  acceptanceCriteria: string[];
  tickets: ChangeAnalysisTicket[];
  estimate: { tickets: number };
  questions: ChangeAnalysisQuestion[];
  /** Project context version the analysis was made from; null when unknown. */
  contextVersion: number | null;
  /**
   * Where in the product's code the change lands, as "<repo key>: <path>" (a folder ends in "/"), checked against the
   * product's file map. Only when the engine could read the product's code for the analysis; absent otherwise.
   */
  codeAreas?: string[];
  /**
   * The person's decision to build a scope-route change in the fast lane as a change to what is there (cr.decide with
   * route "fast"): who decided and when. The analysis keeps its own kind, scopeChange and conflicts; only the route
   * follows the decision. Absent when nobody overrode the route.
   */
  routeDecision?: ChangeRouteDecision;
  /** A new feature on a product without a Factory scope: built on the existing product in increments. Only with kind
   *  "feature"; absent otherwise. */
  feature?: FeatureDeliveryPlan;
}

export interface ChangeRouteDecision {
  route: "fast";
  by: string;
  at: string;
}

export function isChangeKind(x: unknown): x is ChangeKind {
  return typeof x === "string" && (CHANGE_KINDS as readonly string[]).includes(x);
}

export function isChangeRoute(x: unknown): x is ChangeRoute {
  return typeof x === "string" && (CHANGE_ROUTES as readonly string[]).includes(x);
}

/** The route rule: a feature planned for an existing product without a Factory scope (`existingProduct`, the analysis
 *  has a FeatureDeliveryPlan) builds as a feature delivery; otherwise features and scope changes go through Scope &
 *  success, unless a person decided to build the change in the fast lane as a change to what is there (`decision`,
 *  recorded by cr.decide). */
export function changeRouteFor(kind: ChangeKind, scopeChange: boolean, claimed?: unknown, decision?: ChangeRouteDecision | null, existingProduct = false): ChangeRoute {
  if (decision?.route === "fast") return "fast";
  if (kind === "feature" && existingProduct) return "feature";
  if (kind === "feature" || scopeChange || claimed === "scope") return "scope";
  return "fast";
}

/** The stored route decision, or null when it is missing or malformed. */
export function parseRouteDecision(x: unknown): ChangeRouteDecision | null {
  if (!isObject(x) || x.route !== "fast") return null;
  const by = typeof x.by === "string" ? x.by.trim().slice(0, 128) : "";
  const at = typeof x.at === "string" ? x.at.trim().slice(0, 40) : "";
  return by && at ? { route: "fast", by, at } : null;
}

/** True when the analysis itself (before any decision) sends the change through Scope & success. */
export const analysisWantsScope = (a: Pick<ChangeAnalysis, "kind" | "scopeChange">): boolean => a.kind === "feature" || a.scopeChange;

const QUESTION_ID = /^[A-Za-z0-9_-]{1,32}$/;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function text(x: unknown, max: number): string {
  if (typeof x !== "string") return "";
  const t = x.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** Keeps line breaks (ticket descriptions), trims each end, clamps. */
function longText(x: unknown, max: number): string {
  if (typeof x !== "string") return "";
  const t = x.replace(/\r\n?/g, "\n").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function textList(x: unknown, maxItems: number = CHANGE_ANALYSIS_LIMITS.listItems, maxLen: number = CHANGE_ANALYSIS_LIMITS.item): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of x) {
    const t = text(v, maxLen);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function nullableText(x: unknown, max: number): string | null {
  const t = text(x, max);
  return t ? t : null;
}

function parseTickets(x: unknown): ChangeAnalysisTicket[] {
  if (!Array.isArray(x)) return [];
  const out: ChangeAnalysisTicket[] = [];
  for (const v of x) {
    if (!isObject(v)) continue;
    const title = text(v.title, CHANGE_ANALYSIS_LIMITS.ticketTitle);
    if (!title) continue;
    const inc = v.increment;
    out.push({
      title,
      description: longText(v.description, CHANGE_ANALYSIS_LIMITS.ticketDescription),
      ...(typeof inc === "number" && Number.isInteger(inc) && inc >= 1 && inc <= 99 ? { increment: inc } : {}),
    });
    if (out.length >= CHANGE_ANALYSIS_LIMITS.tickets) break;
  }
  return out;
}

/**
 * A FeatureDeliveryPlan and its tickets, normalised: at most 6 increments (one when none is usable), every ticket in an
 * increment that exists (the first when it names none, the last when it names one past the end), the tickets in
 * increment order (their own order kept within one), increments without a ticket left out and the rest renumbered.
 * Null when `x` is not a plan for an existing product. Idempotent (pure).
 */
export function normaliseFeaturePlan(x: unknown, tickets: readonly ChangeAnalysisTicket[]): { plan: FeatureDeliveryPlan; tickets: ChangeAnalysisTicket[] } | null {
  if (!isObject(x) || x.basis !== "existing-product") return null;
  const parts = isObject(x.parts) ? x.parts : {};
  const incs: ChangeIncrement[] = [];
  for (const v of Array.isArray(x.increments) ? x.increments : []) {
    if (!isObject(v)) continue;
    const title = text(v.title, CHANGE_ANALYSIS_LIMITS.incrementTitle);
    if (!title) continue;
    incs.push({ title, goal: text(v.goal, CHANGE_ANALYSIS_LIMITS.item) });
    if (incs.length >= CHANGE_ANALYSIS_LIMITS.increments) break;
  }
  if (incs.length === 0) incs.push({ title: "The whole feature", goal: "" });
  const at = (t: ChangeAnalysisTicket) => (t.increment && t.increment >= 1 ? Math.min(t.increment, incs.length) : 1);
  const sorted = tickets.map((t, i) => ({ t, n: at(t), i })).sort((a, b) => a.n - b.n || a.i - b.i);
  const used = [...new Set(sorted.map((s) => s.n))];
  const renumber = new Map(used.map((n, k) => [n, k + 1]));
  return {
    plan: {
      basis: "existing-product",
      parts: { api: parts.api === true, web: parts.web === true, data: parts.data === true },
      increments: used.length ? used.map((n) => ({ ...incs[n - 1]! })) : incs,
    },
    tickets: sorted.map(({ t, n }) => ({ title: t.title, description: t.description, increment: renumber.get(n)! })),
  };
}

/**
 * Splits every increment with more tickets than `max` into consecutive builds of at most `max` tickets ("<title> (part
 * 2 of 3)"), so no build of a feature on an existing product is bigger than a change's. Expects a normalised plan;
 * answers a normalised one (pure).
 */
export function splitIncrements(plan: FeatureDeliveryPlan, tickets: readonly ChangeAnalysisTicket[], max: number = FEATURE_DELIVERY_LIMITS.ticketsPerIncrement): { plan: FeatureDeliveryPlan; tickets: ChangeAnalysisTicket[] } {
  const per = Math.max(1, Math.floor(max));
  const increments: ChangeIncrement[] = [];
  const out: ChangeAnalysisTicket[] = [];
  plan.increments.forEach((inc, i) => {
    const own = tickets.filter((t) => (t.increment ?? 1) === i + 1);
    const pieces = Math.max(1, Math.ceil(own.length / per));
    for (let k = 0; k < pieces; k++) {
      increments.push(pieces === 1 ? { ...inc } : { title: `${inc.title} (part ${k + 1} of ${pieces})`.slice(0, CHANGE_ANALYSIS_LIMITS.incrementTitle), goal: inc.goal });
      for (const t of own.slice(k * per, (k + 1) * per)) out.push({ ...t, increment: increments.length });
    }
  });
  return { plan: { ...plan, parts: { ...plan.parts }, increments }, tickets: out };
}

/** The increments of a feature delivery with the indexes (into analysis.tickets) of their tickets; an analysis without
 *  a plan is one build of every ticket (pure). */
export function incrementsOf(a: Pick<ChangeAnalysis, "tickets" | "feature">): { n: number; title: string; goal: string; tickets: number[] }[] {
  if (!a.feature) return [{ n: 1, title: "", goal: "", tickets: a.tickets.map((_t, k) => k) }];
  return a.feature.increments.map((inc, i) => ({
    n: i + 1,
    title: inc.title,
    goal: inc.goal,
    tickets: a.tickets.flatMap((t, k) => ((t.increment ?? 1) === i + 1 ? [k] : [])),
  }));
}

/** The increment (1-based) the k-th planned ticket is built in (1 without a plan). */
export function incrementOfTicket(a: Pick<ChangeAnalysis, "tickets" | "feature">, k: number): number {
  return a.feature ? a.tickets[k]?.increment ?? 1 : 1;
}

/** The index in analysis.tickets of a change ticket from its PlanRef ("cr:<id>:<k>", "fx:<n>:<id>" for 0 or
 *  "fx:<n>:<id>:<k>"), or null when it is not one of this change's planned tickets. */
export function planIndexOf(planRef: string, changeRequestId: string): number | null {
  const parts = planRef.split(":");
  if (parts[0] === "cr" && parts.length === 3 && parts[1] === changeRequestId) return /^\d+$/.test(parts[2]!) ? Number(parts[2]) : null;
  if (parts[0] === "fx" && parts[2] === changeRequestId) {
    if (parts.length === 3) return 0;
    if (parts.length === 4 && /^\d+$/.test(parts[3]!)) return Number(parts[3]);
  }
  return null;
}

/** The increment to build next: the first with a ticket that is not done (`done(k)`: the k-th planned ticket is done);
 *  null when every increment is built (pure). */
export function nextIncrement(a: Pick<ChangeAnalysis, "tickets" | "feature">, done: (k: number) => boolean): number | null {
  for (const inc of incrementsOf(a)) if (inc.tickets.some((k) => !done(k))) return inc.n;
  return null;
}

/** How many parts of the product a feature changes (API, web, data), at least 1. */
export const featureParts = (p: FeatureDeliveryPlan["parts"]): number => Math.max(1, [p.api, p.web, p.data].filter(Boolean).length);

/**
 * The official feature lane's --max-steps for one build of a feature on an existing product, by its size: a step for
 * each ticket in each part of the product it changes (API, web, data), at least 4 and at most the lane's hard cap 12.
 */
export function featureMaxSteps(tickets: number, parts: FeatureDeliveryPlan["parts"]): number {
  const n = Math.max(1, Math.floor(tickets)) * featureParts(parts);
  return Math.min(FEATURE_DELIVERY_LIMITS.laneMaxSteps, Math.max(FEATURE_DELIVERY_LIMITS.laneMinSteps, n));
}

/** small: one build of up to 3 tickets; medium: one build; large: several builds. */
export function featureSize(a: Pick<ChangeAnalysis, "tickets" | "feature">): "small" | "medium" | "large" {
  const builds = a.feature?.increments.length ?? 1;
  return builds > 1 ? "large" : a.tickets.length > 3 ? "medium" : "small";
}

function parseQuestions(x: unknown): ChangeAnalysisQuestion[] {
  if (!Array.isArray(x)) return [];
  const out: ChangeAnalysisQuestion[] = [];
  const ids = new Set<string>();
  for (const v of x) {
    if (!isObject(v)) continue;
    const q = text(v.text, CHANGE_ANALYSIS_LIMITS.questionText);
    if (!q) continue;
    let id = typeof v.id === "string" && QUESTION_ID.test(v.id) && !ids.has(v.id) ? v.id : "";
    if (!id) {
      let n = out.length + 1;
      while (ids.has(`q${n}`)) n++;
      id = `q${n}`;
    }
    ids.add(id);
    const answer = nullableText(v.answer, CHANGE_ANALYSIS_LIMITS.answer);
    out.push({
      id,
      text: q,
      options: textList(v.options, CHANGE_ANALYSIS_LIMITS.options, CHANGE_ANALYSIS_LIMITS.option),
      answer,
      answeredBy: answer === null ? null : nullableText(v.answeredBy, 128),
      answeredAt: answer === null ? null : nullableText(v.answeredAt, 40),
    });
    if (out.length >= CHANGE_ANALYSIS_LIMITS.questions) break;
  }
  return out;
}

/**
 * Parses stored Analysis text or a model result (string or object) into a
 * normalised ChangeAnalysis. Returns null when the input is empty, not JSON,
 * too large, of another version, or has no valid kind.
 */
export function parseChangeAnalysis(raw: unknown): ChangeAnalysis | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t.length > CHANGE_ANALYSIS_LIMITS.json) return null;
    try {
      value = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (!isObject(value)) return null;
  if (value.v !== undefined && value.v !== CHANGE_ANALYSIS_VERSION) return null;
  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (!isChangeKind(kind)) return null;

  const scopeChange = value.scopeChange === true;
  const impact = isObject(value.impact) ? value.impact : {};
  const parsedTickets = parseTickets(value.tickets);
  // a feature on an existing product keeps its plan (its tickets in increment order); no other analysis has increments
  const featured = kind === "feature" ? normaliseFeaturePlan(value.feature, parsedTickets) : null;
  const tickets = featured ? featured.tickets : parsedTickets.map((t) => ({ title: t.title, description: t.description }));
  const est = isObject(value.estimate) ? value.estimate.tickets : undefined;
  const estimate =
    typeof est === "number" && Number.isInteger(est) && est >= 0 && est <= 999 ? est : tickets.length;
  const cv = value.contextVersion;
  const contextVersion = typeof cv === "number" && Number.isInteger(cv) && cv >= 0 ? cv : null;
  const routeDecision = parseRouteDecision(value.routeDecision);
  const codeAreas = textList(value.codeAreas);

  return {
    v: CHANGE_ANALYSIS_VERSION,
    kind,
    route: changeRouteFor(kind, scopeChange, value.route, routeDecision, !!featured),
    summary: text(value.summary, CHANGE_ANALYSIS_LIMITS.summary),
    impact: {
      features: textList(impact.features),
      stories: textList(impact.stories),
      screens: textList(impact.screens),
      milestones: textList(impact.milestones),
    },
    scopeChange,
    conflicts: textList(value.conflicts),
    risks: textList(value.risks),
    acceptanceCriteria: textList(value.acceptanceCriteria),
    tickets,
    estimate: { tickets: estimate },
    questions: parseQuestions(value.questions),
    contextVersion,
    ...(codeAreas.length ? { codeAreas } : {}),
    ...(routeDecision ? { routeDecision } : {}),
    ...(featured ? { feature: featured.plan } : {}),
  };
}

/** The text stored in ChangeRequest.Analysis. */
export function serializeChangeAnalysis(a: ChangeAnalysis): string {
  return JSON.stringify(a);
}

export function unansweredQuestions(a: ChangeAnalysis): ChangeAnalysisQuestion[] {
  return a.questions.filter((q) => q.answer === null);
}

export function allQuestionsAnswered(a: ChangeAnalysis): boolean {
  return a.questions.every((q) => q.answer !== null);
}

/** "questions" while any question is open, otherwise "review". */
export function statusAfterAnalysis(a: ChangeAnalysis): "questions" | "review" {
  return allQuestionsAnswered(a) ? "review" : "questions";
}

export type ChangeAnswerInput = { id: string; answer: string };

export type ChangeAnswerResult =
  | { ok: true; value: ChangeAnalysis }
  | { ok: false; code: "invalid_input"; messageKey: string; reason: string; field?: string };

/**
 * Applies answers ({id, answer}[]) to the analysis questions. An answer is one
 * of the options or free text ("Other…"). Re-answering replaces the answer.
 * Returns a new analysis; the input is not changed.
 */
export function applyChangeAnswers(
  a: ChangeAnalysis,
  answers: unknown,
  userId: string,
  at: string,
): ChangeAnswerResult {
  const bad = (messageKey: string, reason: string, field?: string): ChangeAnswerResult =>
    field === undefined
      ? { ok: false, code: "invalid_input", messageKey, reason }
      : { ok: false, code: "invalid_input", messageKey, reason, field };
  if (a.questions.length === 0) return bad("delivery.cr.noQuestions", "This change has no questions to answer.");
  if (!Array.isArray(answers) || answers.length === 0) {
    return bad("delivery.cr.noAnswers", "Answer at least one question.", "answers");
  }
  if (answers.length > a.questions.length) {
    return bad("delivery.args.invalid", "Check the answers and try again.", "answers");
  }
  const byId = new Map<string, string>();
  for (let i = 0; i < answers.length; i++) {
    const item: unknown = answers[i];
    const field = `answers.${i}`;
    if (!isObject(item) || typeof item.id !== "string" || typeof item.answer !== "string") {
      return bad("delivery.args.invalid", "Check the answers and try again.", field);
    }
    if (!a.questions.some((q) => q.id === item.id) || byId.has(item.id)) {
      return bad("delivery.cr.unknownQuestion", "That question is not part of this change.", field);
    }
    const t = item.answer.replace(/\s+/g, " ").trim();
    if (!t) return bad("delivery.cr.emptyAnswer", "Pick an option or write an answer.", field);
    if (t.length > CHANGE_ANALYSIS_LIMITS.answer) {
      return bad("delivery.cr.answerTooLong", "Keep the answer under 2 000 characters.", field);
    }
    byId.set(item.id, t);
  }
  return {
    ok: true,
    value: {
      ...a,
      questions: a.questions.map((q) => {
        const answer = byId.get(q.id);
        return answer === undefined ? { ...q } : { ...q, answer, answeredBy: userId, answeredAt: at };
      }),
    },
  };
}

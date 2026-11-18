/** The one-line summaries of the four scope parts (Features & user stories, Screens and look & feel, Milestones,
 *  Success metrics) for their collapsed rows on the next Business Analysis page. Pure: no React, no hooks; the hooks in
 *  ./summaries.ts read the records (the same reads as the open parts) and hand them here.
 *
 *  The issues are the scope page's own lock rules, split by part: lockChecklist (features, stories, milestones,
 *  placed, empty) and successBlockers (the scope.lock op runs both again). Two reminders the lock does not wait for
 *  are added where they belong: screens not reviewed (the scope page's "What to do now" list) and user stories
 *  without an acceptance check. Words: "Needs you" only when the person can act on it themselves.
 *
 *  Zero mismatches (owner rule): "Confirmed" only for a locked scope part WITH content; a locked (or passed) scope
 *  part without content is "Not used" (skipped) with the reason, e.g. an existing product attached as it is live,
 *  which never had a Factory scope. "Being written / planned / proposed" only while that engine job runs. */
import { successShortInSentence } from "@/madp/components/requirements/domainLabels";
import { t } from "@/madp/i18n";
import type { EngineJob } from "@/madp/blocks/engine/types";
import type { DesignBriefRecord, RequirementRecord } from "@/madp/blocks/requirements/records";
import type { FeatureRecord, MilestoneRecord, StoryRecord } from "@/madp/blocks/scope/records";
import { designStatus, type DesignFacts } from "@/madp/components/design/designActions";
import { designJobInput, makeDesignState } from "@/madp/components/design/makeDesignState";
import { designSourceCurrent, parseProductPrototype } from "@/madp/domain/factoryDesign";
import { automaticDesignDirection, designSource } from "@/madp/domain/figmaMake";
import { lockChecklist, type ChecklistItem, type ScopePhase } from "@/madp/components/scope/blocks/pageState";
import {
  SUCCESS_KEYS, isBlank, setAgreement, successBlockers, targetState, type SuccessKey, type SuccessTargets,
} from "@/madp/domain/successTargets";
import { notUsed, type PartStatus, type PartSummary } from "../../model";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("")
  : t("analysis.scopeSummary.listAnd", "{items} and {last}", { items: xs.slice(0, -1).join(", "), last: xs[xs.length - 1] }));

/** One of two texts by count: the singular for exactly one. */
const byCount = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A short, stable fingerprint of any JSON-like value (FNV-1a over its JSON; object keys sorted). */
export function fingerprint(value: unknown): string {
  const text = stableJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}.${text.length.toString(36)}`;
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

/** Where the scope stands for a row, before the part's own detail. */
export interface ScopeRowBase {
  /** the project has reached the step that writes this part (partOpen) */
  open: boolean;
  loading: boolean;
  error: string | null;
  /** the scope page's phase (scopePageState) */
  phase: ScopePhase;
  /** the plan is being drafted from the requirements (scope.draft queued or running) */
  drafting: boolean;
  /** an existing product attached to the Factory as it is live (never had a Factory scope) */
  live?: boolean;
}

type Early = Pick<PartSummary, "status" | "summary" | "loading" | "issues">;

/** Not open, loading, unreadable, or not reached on the scope page yet: the same answer for every scope part. */
function early(base: ScopeRowBase, before: string): Early | null {
  if (!base.open || (base.phase === "beforeStep" && !base.loading && !base.error)) return { status: "not-started", summary: before };
  if (base.error) return { status: "draft", summary: t("analysis.scopeSummary.planReadError", "Couldn't read the plan just now. Open this part to try again.") };
  if (base.loading) return { status: "draft", summary: t("analysis.scopeSummary.planReading", "Reading the plan…"), loading: true };
  return null;
}

const isDraft = (phase: ScopePhase) => phase === "draft";
const lockedStatus = (phase: ScopePhase): PartStatus | null => (phase === "locked" || phase === "buildStarted" || phase === "released" ? "confirmed" : null);
const draftStatus = (issues: readonly string[], canAct: boolean): PartStatus => (issues.length > 0 && canAct ? "needs-you" : "draft");

/* ── Features & user stories ───────────────────────────────────────────── */

export interface FeaturesFacts extends ScopeRowBase {
  features: readonly Pick<FeatureRecord, "id" | "ref" | "name" | "priority" | "description" | "requirementIds" | "sortOrder">[];
  stories: readonly Pick<StoryRecord, "id" | "featureId" | "actor" | "text" | "acceptanceCriteria" | "sortOrder">[];
  milestones: readonly Pick<MilestoneRecord, "featureRefs">[];
  /** the person may change features and stories (scopePageState.canEditFeatures) */
  canEdit: boolean;
}

export const scopeBefore = () => t("analysis.scopeSummary.featuresBefore", "Features and their user stories, written once you approve the requirements.");

/** The lock conditions of lockChecklist that belong to each part. */
const FEATURE_KEYS = new Set(["features", "stories"]);
const MILESTONE_KEYS = new Set(["milestones", "placed", "empty"]);

function checklistOf(f: { features: Parameters<typeof lockChecklist>[0]; stories: Parameters<typeof lockChecklist>[1]; milestones: Parameters<typeof lockChecklist>[2] }): ChecklistItem[] {
  return lockChecklist(f.features, f.stories, f.milestones);
}

export function featuresSummary(f: FeaturesFacts): PartSummary {
  const included = f.features.filter((x) => x.priority !== "excluded");
  const ids = new Set(included.map((x) => x.id));
  const stories = f.stories.filter((s) => ids.has(s.featureId));
  const fp = fingerprint({
    f: [...f.features].sort((a, b) => a.sortOrder - b.sortOrder).map((x) => [x.id, x.name, x.priority, x.description]),
    s: [...f.stories].sort((a, b) => a.featureId.localeCompare(b.featureId) || a.sortOrder - b.sortOrder).map((s) => [s.id, s.featureId, s.actor, s.text, s.acceptanceCriteria]),
    p: f.phase,
  });
  const sources = f.features.some((x) => x.requirementIds.length > 0) ? [t("analysis.scopeSummary.approvedRequirements", "Approved requirements")] : undefined;
  const pre = early(f, scopeBefore());
  if (pre) return { id: "scope", ...pre, fingerprint: fp };
  if (included.length === 0 && f.drafting) {
    return { id: "scope", status: "draft", summary: t("analysis.scopeSummary.featuresBeingWritten", "Being written from the approved requirements"), fingerprint: fp };
  }
  const excluded = f.features.length - included.length;
  const locked = lockedStatus(f.phase);
  if (locked && included.length === 0) {
    return notUsed("scope", f.live === true && excluded === 0,
      excluded ? t("analysis.scopeSummary.noFeaturesLeftOut", "No features included · {count} left out", { count: excluded })
        : t("analysis.scopeSummary.featuresNotUsed", "No features were planned for this project."), fp);
  }
  const summary = included.length === 0 ? t("analysis.scopeSummary.noFeaturesYet", "No features included yet")
    : [
      byCount(included.length, t("analysis.scopeSummary.featuresOne", "1 feature"), t("analysis.scopeSummary.featuresMany", "{count} features", { count: included.length })),
      byCount(stories.length, t("analysis.scopeSummary.storiesOne", "1 user story"), t("analysis.scopeSummary.storiesMany", "{count} user stories", { count: stories.length })),
      ...(excluded ? [t("analysis.scopeSummary.leftOut", "{count} left out", { count: excluded })] : []),
    ].join(" · ");
  if (locked || !isDraft(f.phase)) return { id: "scope", status: locked ?? "draft", summary, sources, fingerprint: fp };

  const issues = checklistOf(f).filter((i) => FEATURE_KEYS.has(i.key) && !i.ok).map((i) => i.text);
  // a reminder the lock does not wait for: a written story without a check that proves it works
  const unchecked = stories.filter((s) => s.text.trim() !== "" && s.acceptanceCriteria.every((c) => !c.trim())).length;
  if (unchecked > 0) {
    issues.push(byCount(unchecked,
      t("analysis.scopeSummary.uncheckedOne", "1 user story has no acceptance check"),
      t("analysis.scopeSummary.uncheckedMany", "{count} user stories have no acceptance check", { count: unchecked })));
  }
  return { id: "scope", status: draftStatus(issues, f.canEdit), summary, sources, issues, fingerprint: fp };
}

/* ── Milestones ────────────────────────────────────────────────────────── */

export interface MilestonesFacts extends ScopeRowBase {
  features: readonly Pick<FeatureRecord, "id" | "ref" | "priority">[];
  stories: readonly Pick<StoryRecord, "featureId" | "text">[];
  milestones: readonly Pick<MilestoneRecord, "id" | "number" | "name" | "goal" | "featureRefs" | "sortOrder" | "status">[];
  /** the milestones in delivery order (milestonePlan), with whether each is done */
  plan: readonly { name: string; done: boolean }[];
  /** the milestones are being arranged again (milestones.suggest queued or running): the lock waits for the new plan */
  replanning: boolean;
  /** the person may change the milestones (scopePageState.canEditMilestones) */
  canEdit: boolean;
}

export const milestonesBefore = () => t("analysis.scopeSummary.milestonesBefore", "The features split into milestones in the order they are built, planned with the scope.");

export function milestonesSummary(m: MilestonesFacts): PartSummary {
  const fp = fingerprint({
    m: [...m.milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number).map((x) => [x.id, x.number, x.name, x.goal, x.featureRefs, x.status]),
    p: m.phase,
  });
  const pre = early(m, milestonesBefore());
  if (pre) return { id: "milestones", ...pre, fingerprint: fp };
  const included = m.features.filter((x) => x.priority !== "excluded");
  if (m.plan.length === 0 && m.drafting) {
    return { id: "milestones", status: "draft", summary: t("analysis.scopeSummary.milestonesBeingPlanned", "Being planned from the features"), fingerprint: fp };
  }
  const done = m.plan.filter((r) => r.done).length;
  const locked = lockedStatus(m.phase);
  if (locked && m.plan.length === 0) return notUsed("milestones", m.live === true, t("analysis.scopeSummary.milestonesNotUsed", "No milestones were planned for this project."), fp);
  const summary = m.plan.length === 0 ? t("analysis.scopeSummary.noMilestonesYet", "No milestones planned yet")
    : [
      byCount(m.plan.length, t("analysis.scopeSummary.milestonesOne", "1 milestone"), t("analysis.scopeSummary.milestonesMany", "{count} milestones", { count: m.plan.length })),
      done > 0 ? t("analysis.scopeSummary.milestonesDone", "{count} done", { count: done }) : t("analysis.scopeSummary.milestonesFirst", "first: {name}", { name: m.plan[0].name }),
    ].join(" · ");
  if (locked || !isDraft(m.phase)) return { id: "milestones", status: locked ?? "draft", summary, fingerprint: fp };
  if (m.replanning) return { id: "milestones", status: "draft", summary: [summary, t("analysis.scopeSummary.beingReplanned", "being re-planned")].join(" · "), fingerprint: fp };

  const open = checklistOf(m).filter((i) => MILESTONE_KEYS.has(i.key) && !i.ok);
  // "no milestone yet" says it all: "every feature must be in one" and "none may be empty" follow from it
  const noneYet = open.some((i) => i.key === "milestones");
  const issues = (noneYet ? open.filter((i) => i.key === "milestones") : open)
    // with no feature included yet the features part says so; placing them comes after
    .filter((i) => included.length > 0 || i.key !== "placed")
    .map((i) => i.text);
  return { id: "milestones", status: draftStatus(issues, m.canEdit), summary, issues, fingerprint: fp };
}

/* ── Success metrics ───────────────────────────────────────────────────── */

export interface SuccessFacts extends ScopeRowBase {
  /** null: no scope version yet */
  targets: SuccessTargets | null;
  /** the success targets are being proposed or answered (scope.success queued or running) */
  working: boolean;
  /** the person may change the targets (scopePageState.canEditFeatures) */
  canEdit: boolean;
}

export const successBefore = () => t("analysis.scopeSummary.successBefore", "How success is measured: the outcome, expected users, speed and data volume, agreed before the scope is locked.");

/** The success blockers (successBlockers, the scope.lock op's own rule) in plain words, grouped by kind. */
export function successIssues(targets: SuccessTargets): string[] {
  const blockers = successBlockers(targets);
  const names = (keys: SuccessKey[]) => list(keys.map((k) => successShortInSentence(k)));
  const asked = blockers.filter((b) => b.kind === "openQuestion" && targetState(targets[b.key]) === "open").map((b) => b.key);
  const answered = blockers.filter((b) => b.kind === "openQuestion" && targetState(targets[b.key]) === "proposed").map((b) => b.key);
  const missing = blockers.filter((b) => b.kind === "missing").map((b) => b.key);
  const out: string[] = [];
  if (missing.length) {
    out.push(byCount(missing.length,
      t("analysis.scopeSummary.targetsMissingOne", "1 success target is not set yet ({names})", { names: names(missing) }),
      t("analysis.scopeSummary.targetsMissingMany", "{count} success targets are not set yet ({names})", { count: missing.length, names: names(missing) })));
  }
  if (asked.length) {
    out.push(byCount(asked.length,
      t("analysis.scopeSummary.questionsOpenOne", "1 success question is still open ({names})", { names: names(asked) }),
      t("analysis.scopeSummary.questionsOpenMany", "{count} success questions are still open ({names})", { count: asked.length, names: names(asked) })));
  }
  if (answered.length) {
    out.push(byCount(answered.length,
      t("analysis.scopeSummary.answersWaitOne", "1 answer waits for your review ({names})", { names: names(answered) }),
      t("analysis.scopeSummary.answersWaitMany", "{count} answers wait for your review ({names})", { count: answered.length, names: names(answered) })));
  }
  return out;
}

export function successSummaryRow(s: SuccessFacts): PartSummary {
  const tg = s.targets;
  const fp = fingerprint({ t: tg ? SUCCESS_KEYS.map((k) => [k, tg[k].value, tg[k].unsure, tg[k].question?.status ?? null, tg[k].question?.answer ?? null]) : null, p: s.phase });
  const pre = early(s, successBefore());
  if (pre) return { id: "success", ...pre, fingerprint: fp };
  if (!tg || isBlank(tg)) {
    if (lockedStatus(s.phase)) return notUsed("success", s.live === true, t("analysis.scopeSummary.successNotUsed", "No success targets were set for this project."), fp);
    if (s.drafting || s.working) return { id: "success", status: "draft", summary: t("analysis.scopeSummary.successBeingProposed", "Being proposed with the scope"), fingerprint: fp };
    const issues = isDraft(s.phase) && tg ? successIssues(tg) : [];
    return { id: "success", status: draftStatus(issues, s.canEdit), summary: t("analysis.scopeSummary.noTargetsYet", "No targets yet"), issues, fingerprint: fp };
  }
  const metrics = SUCCESS_KEYS.filter((k) => targetState(tg[k]) !== "missing").length;
  const open = successBlockers(tg).length;
  const head = byCount(metrics, t("analysis.scopeSummary.metricsOne", "1 metric"), t("analysis.scopeSummary.metricsMany", "{count} metrics", { count: metrics }));
  const locked = lockedStatus(s.phase);
  // the business analyst's untouched proposals are agreed by nobody until the scope is locked (setAgreement)
  const proposals = SUCCESS_KEYS.filter((k) => targetState(tg[k]) === "set" && setAgreement(tg[k], false) === "proposed").length;
  if (locked || !isDraft(s.phase)) {
    return {
      id: "success", status: locked ?? "draft", fingerprint: fp,
      summary: [head, proposals ? t("analysis.scopeSummary.agreedWithScope", "agreed with the scope") : t("analysis.scopeSummary.agreed", "agreed")].join(" · "),
    };
  }
  const agreedLine = proposals === 0 ? t("analysis.scopeSummary.allAgreed", "all agreed")
    : proposals === metrics ? t("analysis.scopeSummary.allProposed", "all proposed by your business analyst")
    : t("analysis.scopeSummary.someProposed", "{agreed} agreed · {proposed} proposed by your business analyst", { agreed: metrics - proposals, proposed: proposals });
  const summary = [
    head,
    open ? byCount(open, t("analysis.scopeSummary.targetsOpenOne", "1 target still open"), t("analysis.scopeSummary.targetsOpenMany", "{count} targets still open", { count: open })) : agreedLine,
    ...(s.working ? [t("analysis.scopeSummary.beingAnswered", "being answered")] : []),
  ].join(" · ");
  const issues = successIssues(tg);
  // while an answer is on its way, nothing waits on the person yet
  return { id: "success", status: s.working ? "draft" : draftStatus(issues, s.canEdit), summary, issues, fingerprint: fp };
}

/* ── Screens and look & feel ───────────────────────────────────────────── */

/** The look & feel's facts as its panel (MakeDesignPanel) has them: the inputs of its status chip (designStatus). */
export type LookAndFeelFacts = Pick<DesignFacts, "busy" | "incomplete" | "unavailable" | "hasPrototype" | "current" | "hasPreview" | "confirmed">;

/** The reads the look & feel's panel works from, as the row has them (the same queries, shared through React Query). */
export interface LookAndFeelReads {
  brief: Pick<DesignBriefRecord, "id" | "mode" | "status" | "prototypeJson"> | null;
  /** the design brief is being read again (a finished job's design may still be on its way) */
  briefFetching: boolean;
  requirements: readonly Pick<RequirementRecord, "id" | "key" | "title" | "detail" | "criteria">[];
  /** the requirements are read: neither loading nor failed */
  requirementsRead: boolean;
  /** the design.generate jobs */
  jobs: readonly EngineJob[];
  /** the design intent's source (designBrief.context); undefined while it is not read */
  intentSource: string | undefined;
  /** the source a design made before 08.11 carries (designBrief.context legacySource, designSourceCurrent) */
  intentLegacySource?: string;
}

/** Whether the design is compared with the design intent (designBrief.context) rather than with a source worked out from
 *  the requirements: MakeDesignPanel's `factory`. The row reads the intent only then, as the panel needs it only then. */
export function designFromIntent(prototypeJson: string | null | undefined, jobs: readonly EngineJob[]): boolean {
  const prototype = parseProductPrototype(prototypeJson);
  return prototype?.provider === "factory" || prototype?.provider === "figma-design" || !prototype
    || jobs.some((j) => ["factory", "screens"].includes(String(designJobInput(j).workflow)));
}

/** The look & feel's facts, worked out line for line as MakeDesignPanel works them out (prototype, source, current,
 *  busy, incomplete, unavailable; the panel keeps these lines inline, so they are repeated here and pinned by tests).
 *  `current`: the saved design was made from today's goals and requirements; when it is not, the panel shows
 *  "Needs a new revision" and keeps Approve off until an updated design is requested. Two things only the panel knows
 *  are left out: an approval or a design request it is sending right now, and the error of that request. */
export function lookAndFeelFacts(r: LookAndFeelReads): LookAndFeelFacts {
  const prototype = parseProductPrototype(r.brief?.prototypeJson);
  const designRequirements = r.requirements.map((x) => ({ key: x.key || x.id, title: x.title, text: x.detail, criteria: x.criteria }));
  const fromIntent = designFromIntent(r.brief?.prototypeJson, r.jobs);
  const source = fromIntent ? r.intentSource ?? "" : designSource(automaticDesignDirection(designRequirements), designRequirements);
  const incomplete = prototype?.provider === "figma-design" && prototype.reviewComplete === false;
  // the job that made the design on screen is never a new design (makeDesignState)
  const { active, attempt } = makeDesignState(r.jobs, r.brief?.id, source, prototype ? { jobId: prototype.jobId, complete: !incomplete } : null);
  const busy = !!active;
  const failed = attempt?.status === "failed" || attempt?.status === "cancelled";
  const missingResult = attempt?.status === "succeeded" && !prototype && !r.briefFetching;
  return {
    busy,
    hasPrototype: !!prototype,
    confirmed: r.brief?.status === "confirmed",
    current: r.brief?.mode === "figma" && r.requirementsRead && designSourceCurrent(prototype?.source, fromIntent ? { source, legacySource: r.intentLegacySource } : { source }),
    incomplete,
    hasPreview: !!prototype?.previewUrl,
    unavailable: !busy && (failed || missingResult),
  };
}

/** Where the look & feel stands, by the panel's own status chip (designStatus), so the row never says otherwise. */
export type LookAndFeelState = "making" | "incomplete" | "unavailable" | "preparing" | "stale" | "preview" | "approved" | "review";
export const LOOK_AND_FEEL_CHIP: Readonly<Record<string, LookAndFeelState>> = {
  Designing: "making",
  "Preview incomplete": "incomplete",
  "Design unavailable": "unavailable",
  "Preparing design": "preparing",
  "Needs a new revision": "stale",
  "Preparing live preview": "preview",
  Approved: "approved",
  "Ready for review": "review",
};
/** By the chip's state, not its words (they follow the chosen language). */
export const lookAndFeelState = (d: LookAndFeelFacts): LookAndFeelState => designStatus(d).state;

export interface ScreensFacts {
  /** the look & feel is made while the requirements are written: the part opens with the requirements */
  designOpen: boolean;
  /** the scope step is reached (its screens join the look & feel) */
  scopeOpen: boolean;
  loading: boolean;
  phase: ScopePhase;
  /** the look & feel (lookAndFeelFacts) */
  design: LookAndFeelFacts & {
    /** a read of the design (brief, requirements, design jobs or design intent) failed */
    readsFailed: boolean;
    /** the person may act on it now (the requirements step is open and they may change the design) */
    canApprove: boolean;
    /** a content key of the design (its revision) */
    key: string;
  };
  screens: {
    items: readonly { id: string; name: string }[];
    reviewedAt: string | null;
    /** the scope's screens are still being drawn */
    designing: boolean;
    /** the person may mark them reviewed (scopePageState.canEditFeatures) */
    canReview: boolean;
  };
  /** an existing product attached to the Factory as it is live (never had a Factory scope or design) */
  live?: boolean;
}

export const screensBefore = () => t("analysis.scopeSummary.screensBefore", "The look & feel and the screens, designed from the requirements for you to review.");

export function screensSummary(f: ScreensFacts): PartSummary {
  const n = f.screens.items.length;
  const d = f.design;
  const state = d.readsFailed ? null : lookAndFeelState(d);
  const fp = fingerprint({ d: [d.hasPrototype, d.confirmed, d.current, state, d.key], s: f.screens.items.map((x) => [x.id, x.name]), r: f.screens.reviewedAt, p: f.phase });
  const row = (status: PartStatus, summary: string, issues?: string[]): PartSummary => ({ id: "screens", status, summary, issues, fingerprint: fp });
  if (!f.designOpen) return row("not-started", screensBefore());
  if (f.loading) return { ...row("draft", t("analysis.scopeSummary.designReading", "Reading the design…")), loading: true };
  const screens = byCount(n, t("analysis.scopeSummary.screensOne", "1 screen"), t("analysis.scopeSummary.screensMany", "{count} screens", { count: n }));

  if (f.scopeOpen && f.phase !== "beforeStep") {
    const locked = lockedStatus(f.phase);
    const reviewed = () => [screens, t("analysis.scopeSummary.reviewed", "reviewed")].join(" · ");
    if (locked && n === 0 && !d.confirmed) return notUsed("screens", f.live === true, t("analysis.scopeSummary.screensNotUsed", "No screens were designed for this project."), fp);
    if (locked) return row(locked, n > 0 ? (f.screens.reviewedAt ? reviewed() : screens) : t("analysis.scopeSummary.designApproved", "Design approved"));
    if (n > 0 && f.screens.reviewedAt) return row("draft", reviewed());
    if (n > 0) {
      const issues = [t("analysis.scopeSummary.screensNotReviewed", "Screens not reviewed yet")];
      return row(draftStatus(issues, f.screens.canReview), byCount(n,
        t("analysis.scopeSummary.screensToReviewOne", "1 screen to review"),
        t("analysis.scopeSummary.screensToReviewMany", "{count} screens to review", { count: n })), issues);
    }
    if (f.screens.designing) return row("draft", t("analysis.scopeSummary.screensBeingDesigned", "Screens are being designed"));
    return row("draft", state === "approved" ? t("analysis.scopeSummary.noScreensDesignApproved", "Design approved · no screens for this scope yet")
      : state === "stale" ? t("analysis.scopeSummary.noScreensDesignStale", "Design needs a new revision · no screens for this scope yet")
      : state === "review" ? t("analysis.scopeSummary.noScreensDesignReview", "Design to review · no screens for this scope yet")
      : t("analysis.scopeSummary.noScreensYet", "No screens for this scope yet"));
  }

  // the requirements step: the look & feel is designed, reviewed and approved with the requirements. The row follows
  // the panel's status chip: a design that no longer matches the latest goals and requirements is never offered for
  // approval (the panel keeps Approve off until an updated design is requested).
  if (state === null) return row("draft", t("analysis.scopeSummary.designReadError", "Couldn't read the design just now. Open this part to try again."));
  const ask = (summary: string, issue: string) => row(draftStatus([issue], d.canApprove), summary, [issue]);
  switch (state) {
    case "making": return row("draft", t("analysis.scopeSummary.designMaking", "The design is being made"));
    case "incomplete": return row("draft", t("analysis.scopeSummary.designIncomplete", "Some screen previews are still missing"));
    case "unavailable": return ask(t("analysis.scopeSummary.designUnavailable", "The last design attempt did not finish"), t("analysis.scopeSummary.designTryAgain", "Try the design again"));
    case "stale": return ask(t("analysis.scopeSummary.designStale", "The design needs a new revision"), t("analysis.scopeSummary.designRequestUpdate", "Request an updated design"));
    case "preview": return row("draft", t("analysis.scopeSummary.designPreview", "The live preview is being prepared"));
    case "review": return ask(t("analysis.scopeSummary.designReview", "Design ready to review and approve"), t("analysis.scopeSummary.designNotApproved", "Design not approved yet"));
    case "approved": return row("draft", t("analysis.scopeSummary.designApprovedScreensFollow", "Design approved · the screens follow with the scope"));
    case "preparing": return row("draft", t("analysis.scopeSummary.designPreparing", "The look & feel is designed from the requirements"));
  }
}

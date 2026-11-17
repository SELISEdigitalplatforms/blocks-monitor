/** The "What to do now" checklist of the Scope & success page: five live items and what the lock still waits for.
 *  Pure (no React): the card renders it, the tests check it. Features and Success & performance block the lock (the
 *  scope.lock op checks both again); screens, comments and approvals are reminders the lock does not wait for. */
import { successBlockers, successSummary, type SuccessTargets } from "../../../domain/successTargets";
import { successDetailWords, successLockReasonWords } from "@/components/requirements/domainLabels";
import type { ChecklistItem } from "./pageState";
import { getCulture, t } from "@/i18n";

export type NowId = "features" | "screens" | "success" | "comments" | "approvals";

/** `short` is the chip's value ("7 · 3 milestones", "2 to review"); `detail` the full sentence (title / window). */
export interface NowItem { id: NowId; label: string; done: boolean; detail: string; short: string; blocking: boolean }

export interface NowInput {
  /** today's lock conditions (lockChecklist) */
  lockItems: readonly ChecklistItem[];
  counts: { features: number; stories: number; milestones: number };
  screens: { count: number; reviewedAt: string | null; reviewedBy: string | null; designing: boolean };
  success: SuccessTargets;
  openComments: { threads: number; comments: number };
  approvals: { loading: boolean; stage: boolean; production: boolean };
  /** the business analyst is drafting the plan from the requirements (scope.draft) */
  drafting?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const dateOf = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(getCulture() === "de-CH" ? "de-CH" : "en-GB", { day: "numeric", month: "short" });
};

export function nowChecklist(i: NowInput): NowItem[] {
  const featuresOpen = i.lockItems.find((x) => !x.ok);
  const s = i.screens;
  const approvalsSet = i.approvals.stage && i.approvals.production;
  return [
    {
      id: "features", label: t("analysis.scope.now.featuresLabel", "Features agreed"), blocking: true, done: !featuresOpen,
      short: featuresOpen ? (i.drafting ? t("analysis.scope.now.beingDrafted", "being drafted") : featuresOpen.short ?? t("analysis.scope.now.toFinish", "to finish"))
        : `${i.counts.features} · ${plural(i.counts.milestones, t("analysis.scope.word.milestone", "milestone"), t("analysis.scope.word.milestones", "milestones"))}`,
      detail: featuresOpen ? (i.drafting ? t("analysis.scope.now.draftingFeatures", "Your business analyst is drafting the features from the requirements") : featuresOpen.text)
        : `${plural(i.counts.features, t("analysis.scope.word.feature", "feature"), t("analysis.scope.word.features", "features"))} · ${plural(i.counts.stories, t("analysis.scope.word.userStory", "user story"), t("analysis.scope.word.userStories", "user stories"))} · ${plural(i.counts.milestones, t("analysis.scope.word.milestone", "milestone"), t("analysis.scope.word.milestones", "milestones"))}`,
    },
    {
      id: "screens", label: t("analysis.scope.now.screensLabel", "Screens reviewed"), blocking: false, done: s.count > 0 && s.reviewedAt !== null,
      short: s.count === 0 ? (s.designing ? t("analysis.scope.now.beingDesigned", "being designed") : t("analysis.scope.now.noneYet", "none yet"))
        : s.reviewedAt ? t("analysis.scope.now.nReviewed", "{count} reviewed", { count: s.count }) : t("analysis.scope.now.nToReview", "{count} to review", { count: s.count }),
      detail: s.count === 0 ? (s.designing ? t("analysis.scope.now.screensDesigning", "The screens are still being designed") : t("analysis.scope.now.noScreens", "No screens for this scope yet"))
        : s.reviewedAt ? `${plural(s.count, t("analysis.scope.word.screen", "screen"), t("analysis.scope.word.screens", "screens"))} · ${t("analysis.scope.now.reviewed", "reviewed")}${s.reviewedBy ? ` ${t("analysis.scope.now.byName", "by {name}", { name: s.reviewedBy })}` : ""}${dateOf(s.reviewedAt) ? ` ${t("analysis.scope.now.onDate", "on {date}", { date: dateOf(s.reviewedAt) })}` : ""}`
        : `${plural(s.count, t("analysis.scope.word.screen", "screen"), t("analysis.scope.word.screens", "screens"))} ${t("analysis.scope.now.toLookThrough", "to look through")}`,
    },
    {
      id: "success", label: t("analysis.scope.now.successLabel", "Success & performance set"), blocking: true, done: successBlockers(i.success).length === 0,
      short: successShort(i.success),
      detail: successDetailWords(i.success),
    },
    {
      id: "comments", label: t("analysis.scope.now.commentsLabel", "Open comments resolved"), blocking: false, done: i.openComments.threads === 0,
      short: i.openComments.threads === 0 ? t("analysis.scope.now.noneOpen", "none open") : t("analysis.scope.now.nOpen", "{count} open", { count: i.openComments.comments }),
      detail: i.openComments.threads === 0 ? t("analysis.scope.now.noOpenComments", "No open comments")
        : t("analysis.scope.now.commentsOpen", "{comments} on {items} still open", {
          comments: plural(i.openComments.comments, t("analysis.scope.word.comment", "comment"), t("analysis.scope.word.comments", "comments")),
          items: plural(i.openComments.threads, t("analysis.scope.word.item", "item"), t("analysis.scope.word.items", "items")),
        }),
    },
    {
      id: "approvals", label: t("analysis.scope.now.approvalsLabel", "Approvals"), blocking: false, done: approvalsSet,
      short: i.approvals.loading ? "…" : approvalsSet ? t("analysis.scope.now.setUp", "set up") : t("analysis.scope.now.notSetUp", "not set up"),
      detail: i.approvals.loading ? t("analysis.scope.now.loadingApprovals", "Loading the approvals…")
        : approvalsSet ? t("analysis.scope.now.approvalsSet", "Staging and production approvals are set up")
        : i.approvals.stage ? t("analysis.scope.now.productionMissing", "Production approvals are not set up yet")
        : i.approvals.production ? t("analysis.scope.now.stagingMissing", "Staging approvals are not set up yet")
        : t("analysis.scope.now.approvalsMissing", "Who approves staging and production is not set up yet"),
    },
  ];
}

function successShort(targets: SuccessTargets): string {
  const sum = successSummary(targets);
  if (sum.openQuestions) return sum.openQuestions === 1 ? t("analysis.scope.now.questionForBaOne", "1 question for your business analyst") : t("analysis.scope.now.questionsForBa", "{count} questions for your business analyst", { count: sum.openQuestions });
  if (sum.waitingForTeam) return t("analysis.scope.now.nToReview", "{count} to review", { count: sum.waitingForTeam });
  return t("analysis.scope.now.nOfM", "{n} of {total}", { n: sum.set, total: sum.required });
}

/** The scope jobs working behind the scenes, as the frame's agent line ("Your business analyst is …"). Null when idle. */
export function agentLine(jobs: readonly { kind: string; status: string; progress?: number | null }[]): { text: string; progress: number; running: boolean } | null {
  const active = jobs.filter((j) => j.status === "queued" || j.status === "claimed" || j.status === "running");
  if (!active.length) return null;
  const order = ["scope.draft", "scope.success", "scope.grill", "milestones.suggest", "design.generate", "board.plan"];
  const j = [...active].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]!;
  const text = j.kind === "scope.draft" ? t("analysis.scope.agent.draft", "Your business analyst is drafting the features, user stories and milestones")
    : j.kind === "scope.success" ? t("analysis.scope.agent.success", "Your business analyst is working on the success & performance targets")
    : j.kind === "scope.grill" ? t("analysis.scope.agent.grill", "Your solution architect is giving a second opinion on the scope")
    : j.kind === "milestones.suggest" ? t("analysis.scope.agent.milestones", "Your business analyst is arranging the milestones")
    : j.kind === "design.generate" ? t("analysis.scope.agent.design", "Your designer is drawing the screens")
    : t("analysis.scope.agent.board", "Your business analyst is planning the board from the locked scope");
  // running: picked up and working (the bar eases only then; a job still waiting in the queue does not creep)
  return { text, progress: Math.max(0, Math.min(100, Number(j.progress ?? 0))), running: j.status !== "queued" };
}

/** The lock's checklist line for Success & performance (joins today's five lines on the lock card). */
export function successLockItem(targets: SuccessTargets): ChecklistItem {
  const reason = successLockReasonWords(targets);
  return { key: "success", ok: reason === null, text: reason ?? t("analysis.scope.now.successSet", "Success & performance targets are set") };
}

/** The headline sentence of the card. */
export function nowSentence(items: readonly NowItem[], locked: boolean): string {
  if (locked) return t("analysis.scope.now.sentenceLocked", "The scope is locked. MADP plans the board from it, milestone by milestone.");
  const blocking = items.filter((x) => x.blocking && !x.done);
  if (blocking.length === 0) {
    const reminders = items.filter((x) => !x.blocking && !x.done).length;
    return reminders ? t("analysis.scope.now.sentenceReminders", "Everything the lock needs is in place. Check the reminders below, then lock the scope.") : t("analysis.scope.now.sentenceReady", "Everything is in place. Lock the scope when you're ready.");
  }
  if (blocking.length === 2) return t("analysis.scope.now.sentenceBoth", "Agree the features and set what success looks like, then lock the scope.");
  return blocking[0].id === "features" ? t("analysis.scope.now.sentenceFeatures", "Agree the features and their user stories, then lock the scope.")
    : t("analysis.scope.now.sentenceSuccess", "Set what success looks like and how fast it should be, then lock the scope.");
}

/** A finished job's "Done" line is news for a few minutes, not days later: a job shows while it is queued or running,
 *  when it failed or was cancelled, or for five minutes after it succeeded. */
export function jobWorthShowing<J extends { status: string; finishedAt: string | null }>(job: J | null | undefined, now = Date.now()): J | null {
  if (!job) return null;
  if (job.status !== "succeeded") return job;
  const at = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  return Number.isFinite(at) && now - at < 5 * 60_000 ? job : null;
}

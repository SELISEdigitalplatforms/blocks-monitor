/** What change requests wait for from the signed-in person: ONE rule, used by the Team panel (its "waiting for you"
 *  marks, teamMessages.ts needsYou), the Dashboard and Projects ("Waiting for you", the project cards, the switcher:
 *  src/domain/projectNow.ts) and the leave guard. Pure: worked out from the ChangeRequest rows (status, Analysis,
 *  decision, requester) and the project's jobs, with the person's rights; nothing is invented.
 *
 *   answer        the business analyst's open questions on the change (one per question), for a role that may run it
 *   approve       the change waits for this person's approval (the four-eyes rule, changeDecideRight)
 *   analyseAgain  the analysis stopped before it finished; a role that may run it can start it again
 *   startBuild    approved; the tech lead starts the build when told (nothing else is building)
 *   buildAgain    the newest build of the change stopped (failed or cancelled: "Stopped"); it can start again
 */
import type { EngineJob } from "@/blocks/engine/types";
import { isAfterDeployRetry } from "@/domain/afterDeploy";
import { releaseDeployInput } from "@/domain/dashboard";
import type { ChangeDecideRight } from "@/domain/delivery";
import { changeCode } from "@/domain/delivery";
import { unansweredQuestions } from "@/domain/changeAnalysis";
import { isTerminal, type EngineJobKind, type EngineJobStatus } from "@/domain/engineJob";
import { analysisOf, changeStage } from "@/components/changes/changeFlow";
import { t } from "@/i18n";

export type ChangeWaitKind = "answer" | "approve" | "analyseAgain" | "startBuild" | "buildAgain";

/** A change request as the rule reads it (the Team panel's DeliveryChangeRequest, the dashboard's open change). */
export interface ChangeWaitChange {
  id: string;
  number: number;
  lane: string;
  status: string;
  /** the stored Analysis text (DeliveryChangeRequest.analysis) */
  analysis: string | null;
  decidedAt: string | null;
  createdByUserId: string | null;
  /** when the row was last written (a start writes "building" right after its job is queued); absent: not known */
  updatedAt?: string | null;
}

/** A job as the rule reads it (from an EngineJob or the dashboard's job row). */
export interface ChangeWaitJob {
  id: string;
  kind: EngineJobKind;
  status: EngineJobStatus;
  createdAt: string | null;
  /** the change request a change.analyse or change.build is for ("" for any other job) */
  changeRequestId: string;
  /** a release's deployment (a preview.deploy naming a release or an environment): the release manager's, not a build */
  releaseDeploy: boolean;
  /** a run of only the steps after a deploy (afterDeploy): never the build itself to start again */
  afterDeploy: boolean;
}

export interface ChangeWait {
  changeRequestId: string;
  number: number;
  /** "CR-006" */
  code: string;
  kind: ChangeWaitKind;
  /** who in the team asks: the business analyst (questions, approval, the analysis) or the tech lead (builds) */
  who: "analyst" | "lead";
  /** how many things wait: the open questions for `answer`, else 1 */
  count: number;
  /** buildAgain: the stopped build; analyseAgain: the stopped analysis (null when the request itself says it failed) */
  jobId: string | null;
  /** buildAgain: the start never queued a build of the change (changeFlow.ts buildLost) */
  lost?: boolean;
}

export interface ChangeWaitInput {
  changes: readonly ChangeWaitChange[];
  jobs: readonly ChangeWaitJob[];
  /** build.run: may send, answer and start (cr.submit, cr.answer, cr.startBuild declare it) */
  canRun: boolean;
  /** the person's right to approve or reject a change (src/components/changes/changeDecide.ts changeRightFor) */
  rightOf: (cr: ChangeWaitChange) => ChangeDecideRight;
  /** the time now: with it, a change at "building" without any build of its own for a while waits for its build to be
   *  started again (changeFlow.ts buildLost) */
  now?: number;
}

/** The kinds the tech lead builds with (a release deploy is not one of them). */
const BUILD_KINDS: readonly EngineJobKind[] = ["build.run", "change.build", "preview.deploy"];

export { releaseDeployInput };

/** An EngineJob as the rule reads it. */
export function changeWaitJobOf(j: Pick<EngineJob, "id" | "kind" | "status" | "createdAt" | "inputJson">): ChangeWaitJob {
  let changeRequestId = "";
  try {
    const v = JSON.parse(j.inputJson ?? "{}") as { changeRequestId?: unknown } | null;
    if (v && typeof v.changeRequestId === "string") changeRequestId = v.changeRequestId;
  } catch {
    /* not JSON: no change request */
  }
  return {
    id: j.id, kind: j.kind, status: j.status, createdAt: j.createdAt, changeRequestId,
    releaseDeploy: j.kind === "preview.deploy" && releaseDeployInput(j.inputJson), afterDeploy: isAfterDeployRetry(j),
  };
}

const at = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};
/** Oldest first (jobs without a date first, in list order), as the Team panel orders them. */
const byCreated = (a: ChangeWaitJob, b: ChangeWaitJob) => at(a.createdAt) - at(b.createdAt);

/** A build is running or queued on the project: nothing new starts until it has finished. */
export function anyBuildActive(jobs: readonly ChangeWaitJob[]): boolean {
  return jobs.some((j) => BUILD_KINDS.includes(j.kind) && !j.releaseDeploy && !isTerminal(j.status));
}

/** Everything the change requests wait for from the person, in change-request order. */
export function changesWaiting(i: ChangeWaitInput): ChangeWait[] {
  const out: ChangeWait[] = [];
  const busy = anyBuildActive(i.jobs);
  for (const cr of [...i.changes].sort((a, b) => a.number - b.number)) {
    const mine = (kind: EngineJobKind) => i.jobs.filter((j) => j.kind === kind && j.changeRequestId === cr.id).sort(byCreated);
    const analyses = mine("change.analyse");
    const builds = mine("change.build");
    const lastAnalyse = analyses[analyses.length - 1] ?? null;
    const lastBuild = builds[builds.length - 1] ?? null;
    const analysis = analysisOf(cr);
    const stage = changeStage(cr.status, analysis, { decidedAt: cr.decidedAt ?? null }, lastBuild, lastAnalyse,
      i.now !== undefined ? { updatedAt: cr.updatedAt ?? null, now: i.now } : null);
    const add = (kind: ChangeWaitKind, who: ChangeWait["who"], count = 1, jobId: string | null = null, lost = false) =>
      out.push({ changeRequestId: cr.id, number: cr.number, code: changeCode(cr), kind, who, count, jobId, ...(lost ? { lost: true } : {}) });

    if (stage === "analysisFailed" && i.canRun) add("analyseAgain", "analyst", 1, lastAnalyse?.id ?? null);
    if (!analysis) continue;
    if (stage === "questions" && i.canRun) {
      const open = unansweredQuestions(analysis).length;
      if (open > 0) add("answer", "analyst", open);
    }
    if (stage === "review" && i.rightOf(cr).ok) add("approve", "analyst");
    if (stage === "approved" && i.canRun && !busy) add("startBuild", "lead");
    // the newest build stopped: it can start again while nothing else builds (cr.startBuild takes it as a retry)
    if (stage === "buildFailed" && i.canRun && !busy && lastBuild && !lastBuild.afterDeploy
      && (lastBuild.status === "failed" || lastBuild.status === "cancelled")) add("buildAgain", "lead", 1, lastBuild.id);
    // its start never queued a build: it starts again (cr.startBuild takes it as a retry)
    if (stage === "buildLost" && i.canRun && !busy) add("buildAgain", "lead", 1, null, true);
  }
  return out;
}

/** The wait of one kind on one change request, if any. */
export function waitOf(waits: readonly ChangeWait[], changeRequestId: string, kind: ChangeWaitKind): ChangeWait | null {
  return waits.find((w) => w.changeRequestId === changeRequestId && w.kind === kind) ?? null;
}

/** How many things wait in all (each open question counts). */
export function changeWaitCount(waits: readonly ChangeWait[]): number {
  return waits.reduce((n, w) => n + w.count, 0);
}

/** "1 question" / "3 questions" in the current language. */
const questions = (n: number): string => (n === 1 ? t("team.waits.questionOne", "1 question") : t("team.waits.questionMany", "{count} questions", { count: n }));

/** Which waits come first: a decision, then answers, then the builds and analyses to start. */
const ORDER: Record<ChangeWaitKind, number> = { approve: 0, answer: 1, buildAgain: 2, startBuild: 3, analyseAgain: 4 };

/** The waits in the order they are shown (a decision first; within a kind the newest change request first). */
export function sortChangeWaits(waits: readonly ChangeWait[]): ChangeWait[] {
  return [...waits].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.number - a.number);
}

/** Where a wait is acted on: its change request. */
export function changeWaitHref(projectId: string, w: Pick<ChangeWait, "number">): string {
  return `/p/${projectId}/build?cr=${w.number}`;
}

/** A wait in the client's words, as one line of "Waiting for you" with its button's word. */
export function changeWaitText(w: ChangeWait): { text: string; action: string } {
  switch (w.kind) {
    case "approve": return { text: t("team.waits.approveText", "{code} is waiting for your approval", { code: w.code }), action: t("team.waits.review", "Review") };
    case "answer": return { text: t("team.waits.answerText", "{code}: {questions} from your business analyst", { code: w.code, questions: questions(w.count) }), action: t("team.waits.answer", "Answer") };
    case "startBuild": return { text: t("team.waits.startBuildText", "{code} is approved and ready to build", { code: w.code }), action: t("team.waits.open", "Open") };
    case "buildAgain": return {
      text: w.lost ? t("team.waits.buildLostText", "The build request of {code} did not reach the development team. It can start again", { code: w.code })
        : t("team.waits.buildAgainText", "The build of {code} stopped. It can start again", { code: w.code }),
      action: t("team.waits.open", "Open"),
    };
    case "analyseAgain": return { text: t("team.waits.analyseAgainText", "The analysis of {code} stopped. It can start again", { code: w.code }), action: t("team.waits.open", "Open") };
  }
}

/** The first wait as "Next for you" says it (a title, one calm sentence, the button and where it goes); null when
 *  nothing waits. The rest are named in the sentence ("2 more change requests wait for you"). */
export function changeWaitNext(projectId: string, waits: readonly ChangeWait[]): { title: string; detail: string; button: string; href: string } | null {
  const [w, ...rest] = sortChangeWaits(waits);
  if (!w) return null;
  const more = new Set(rest.map((r) => r.changeRequestId).filter((id) => id !== w.changeRequestId)).size;
  const tail = more
    ? ` ${more === 1 ? t("team.waits.moreOne", "1 more change request waits for you too.") : t("team.waits.moreMany", "{count} more change requests wait for you too.", { count: more })}`
    : "";
  const code = w.code;
  const open = t("team.waits.open", "Open");
  const next = ((): { title: string; detail: string; button: string } => {
    switch (w.kind) {
      case "approve": return {
        title: t("team.waits.approveTitle", "Approve {code}", { code }),
        detail: t("team.waits.approveDetail", "Your business analyst analysed the change and waits for your decision."), button: t("team.waits.review", "Review"),
      };
      case "answer": return {
        title: t("team.waits.answerTitle", "Answer {questions} on {code}", { questions: questions(w.count), code }),
        detail: t("team.waits.answerDetail", "Your business analyst needs your call before planning the change."), button: t("team.waits.answer", "Answer"),
      };
      case "buildAgain": return {
        title: t("team.waits.buildAgainTitle", "Start the build of {code} again", { code }),
        detail: w.lost ? t("team.waits.buildLostDetail", "The build request did not reach the development team, so nothing is being built; its tickets stay on the board.")
          : t("team.waits.buildAgainDetail", "It stopped before it finished; its tickets stay on the board."),
        button: open,
      };
      case "startBuild": return {
        title: t("team.waits.startBuildTitle", "Start the build of {code}", { code }),
        detail: t("team.waits.startBuildDetail", "It is approved; your tech lead starts the build when you say so."), button: open,
      };
      case "analyseAgain": return {
        title: t("team.waits.analyseAgainTitle", "Start the analysis of {code} again", { code }),
        detail: t("team.waits.analyseAgainDetail", "It stopped before it finished; nothing was changed."), button: open,
      };
    }
  })();
  return { ...next, detail: `${next.detail}${tail}`, href: changeWaitHref(projectId, w) };
}

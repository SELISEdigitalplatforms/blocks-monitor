import type { EngineJob } from "@/blocks/engine/types";
import { COVERAGE_FAILURE_PREFIX } from "@/domain/factoryDesign";
import { t } from "@/i18n";

export function designJobInput(job: Pick<EngineJob, "inputJson">): Record<string, unknown> {
  try {
    const input = JSON.parse(job.inputJson ?? "{}");
    return input && typeof input === "object" && !Array.isArray(input) ? input : {};
  } catch { return {}; }
}

/** What the person looking at the failure has: an earlier design that is still there, and the retry button. */
export interface DesignFailureContext { hasDesign?: boolean; canRetry?: boolean }
/** The next step the panel actually offers this person. */
function retryStep({ hasDesign = false, canRetry = false }: DesignFailureContext): string {
  if (!canRetry) return hasDesign ? t("analysis.design.retry.unchangedOthers", "Your current design is unchanged. Someone who can edit this project can try again.") : t("analysis.design.retry.others", "Someone who can edit this project can try again.");
  return hasDesign ? t("analysis.design.retry.unchangedFresh", "Your current design is unchanged. Select Generate fresh design to try again.") : t("analysis.design.retry.retry", "Select Retry design to try again.");
}

export function designJobFailureMessage(failure: Pick<EngineJob, "errorCode" | "message">, context: DesignFailureContext = {}): string {
  switch (failure.errorCode) {
    case "design.coverageIncomplete": {
      const detail = failure.message?.startsWith(COVERAGE_FAILURE_PREFIX) ? failure.message.slice(COVERAGE_FAILURE_PREFIX.length).trim() : "";
      const what = detail ? ` ${t("analysis.design.failure.details", "Details: {detail}", { detail: `${detail.charAt(0).toUpperCase()}${detail.slice(1)}` })}` : "";
      return `${t("analysis.design.failure.coverage", "The screens were made, but they could not be matched to every requirement, so this attempt was not saved.")}${what} ${retryStep(context)} ${t("analysis.design.failure.coverageAgain", "If it fails the same way again, check that requirement's wording in Goals & requirements.")}`;
    }
    case "design.requirementsChangeRequired":
      if (failure.message?.startsWith('This design change conflicts with the agreed requirements.')) return failure.message.slice(0, 2000);
      return t("analysis.design.failure.requirementsChangeRequired", "This feedback changes or conflicts with the agreed goals, requirements or constraints. Update or clarify them first; the previous design has been retained.");
    case 'design.feedbackReviewUnavailable':
      return t("analysis.design.failure.feedbackReviewUnavailable", "The business analyst could not check this feedback against the requirements. No new Figma design was started; your existing preview has been kept.");
    case "design.alignmentFailed":
      return t("analysis.design.failure.alignmentFailed", "The revision did not pass its goals and requirements review. The previous design has been retained for review.");
    case "design.sourceUnavailable":
      return t("analysis.design.failure.sourceUnavailable", "The editable source of the previous design could not be verified. It must be restored before applying feedback; nothing was silently replaced.");
    case "design.factoryLimit":
      return t("analysis.design.failure.factoryLimit", "Design revisions are paused because the daily iteration limit has been reached. Your existing preview has been kept.");
    case "design.figmaProviderFailed":
      return /usage limit before contacting Figma; nothing was created/i.test(failure.message ?? "")
        ? t("analysis.design.failure.runnerLimit", "The design runner reached its usage limit before contacting Figma. Nothing was created. The engine owner can resume it once capacity is available.")
        : t("analysis.design.failure.runnerStopped", "The design runner stopped before completing this attempt. The engine owner needs to check whether Figma saved any work before resuming it.");
    case "design.figmaRecoveryRequired":
      return t("analysis.design.failure.figmaRecoveryRequired", "An earlier design attempt must be recovered by the engine owner before a new one can start.");
    case 'design.figmaInvalidResult':
      return `${t("analysis.design.failure.invalidResult", "The screen design attempt finished, but its result did not pass the checks needed to save it, so nothing new was saved for review.")} ${retryStep(context)}`;
    case 'design.figmaCapabilityUnavailable':
      return t("analysis.design.failure.figmaCapabilityUnavailable", "The design connection is missing a required editing or export capability. No new design was started; your existing designs have been kept.");
    case 'design.figmaRateLimited':
      return t("analysis.design.failure.figmaRateLimited", "Figma’s MCP request allowance has been reached. Existing Figma frames have been kept, but their previews and review are incomplete. The engine owner must resume this design after Figma access is restored.");
    case 'design.figmaWorkspaceRequired':
      return t("analysis.design.failure.figmaWorkspaceRequired", "The business analyst needs a destination Figma workspace. The engine owner must select it once before screen generation can start. No design was created.");
    case "design.figmaBillingNotApproved":
    case "design.figmaImportNotApproved":
      return t("analysis.design.failure.figmaImportNotApproved", "The engine owner has not approved this design generation yet, so nothing was started.");
    case "design.figmaPolishFailed":
      return failure.message?.trim() || t("analysis.design.failure.polish", "The design was drawn, but its polish round could not reach Figma. The drawing so far has been kept; the engine owner can resume it.");
    case "design.figmaSkillMissing":
    case "design.principlesMissing":
    case "design.stylesMissing":
      return t("analysis.design.failure.stylesMissing", "The designer's house guides are missing from the engine, so no design was started. The engine owner must install the matching engine release.");
    case "design.figmaUnsupported":
    case "design.figmaUnavailable":
      return t("analysis.design.failure.figmaUnavailable", "The engine's design connection could not support this design. The engine owner should check it and retry.");
    case "design.stale":
    case "design.figmaStale":
      return t("analysis.design.failure.figmaStale", "Requirements changed while the design was being made. Request a fresh design to match them.");
    case "design.figmaRefinementUnavailable":
      return t("analysis.design.failure.figmaRefinementUnavailable", "This design connection cannot update an imported Make file in place. The existing design has been kept for the engine owner to review.");
    case "design.figmaImportIncomplete":
      return t("analysis.design.failure.figmaImportIncomplete", "The Make file is not fully imported yet. The engine owner must finish importing into the same file before its live preview can be shown.");
    default:
      return t("analysis.design.failure.default", "Your screen designs could not be completed. Your team needs to check the design service before trying again.");
  }
}

/** The design on screen as its saved record names it: the job that made it, and whether every screen of it is saved. */
export interface SavedDesign { jobId: string; complete: boolean }

const LIVE: readonly string[] = ["queued", "claimed", "running"];

/** The request's source identifies an intended Make attempt, not the worker implementation that claimed it.
 * An older worker can accept that request and return screenshots. Check outputs as well as request metadata.
 * A failed attempt is still an attempt: rendering/polling must not silently start another paid operation.
 *
 * `saved` is the design on screen. The job that made it is never a new design: the engine saves the design a moment
 * before that job's row turns succeeded, and the job list is read on its own clock, so for a few seconds the page can
 * hold the finished design and its job still marked running. With the design complete that job is done (it is not
 * `active`, nothing waits on it); with screens still missing it is finishing that same design (`finishing`).
 * `makerUnread`: that job is not read as finished yet (still marked active, or not in the list), so the list is due a read. */
export function makeDesignState(jobs: readonly EngineJob[], briefId: string | undefined, source: string, saved?: SavedDesign | null) {
  const relevant = jobs.filter((j) => !briefId || designJobInput(j).designBriefId === briefId)
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0));
  const madeIt = (j: EngineJob) => !!saved && j.id === saved.jobId;
  const active = relevant.find((j) => LIVE.includes(j.status) && !(madeIt(j) && saved?.complete));
  const finishing = !!active && madeIt(active);
  const maker = saved ? jobs.find(madeIt) : undefined;
  const makerUnread = !!saved && (!maker || LIVE.includes(maker.status));
  const makeJobs = relevant.filter((j) => typeof designJobInput(j).source === "string");
  const attempt = makeJobs.find((j) => designJobInput(j).source === source);
  const failures = relevant.filter((j) => j.status === "failed" && designJobInput(j).source === source)
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  const screenshotResult = attempt?.status === "succeeded" && attempt.outputRefs?.some((r) => r.schema === "DesignScreen") === true;
  return { active, finishing, makerUnread, attempt, screenshotResult, failures, history: makeJobs.filter((j) => designJobInput(j).requestType === "design-change") };
}

/** A design request this page sent and has no answer to yet: whether the page itself started it (the first design,
 *  started on its own when there is none) and the design jobs it knew when it sent it. */
export interface SentDesignRequest { automatic: boolean; knownJobIds: readonly string[] }

/** Whether the page may still say it is sending `sent`. Once a design job appears that was not there when it was sent,
 *  the request has been taken: that job tells the rest, even when the request's own answer is lost or late. The page's
 *  own first-design request never stands for a new design once a design is saved (it asks for no change, so it can
 *  start none). */
export function designRequestSending(sent: SentDesignRequest | null, jobs: readonly Pick<EngineJob, "id">[], hasDesign: boolean): boolean {
  if (!sent || (sent.automatic && hasDesign)) return false;
  return !jobs.some((j) => !sent.knownJobIds.includes(j.id));
}

/** Whether the page may start the first design on its own: never while a design is saved or a job for the current
 *  requirements exists (whatever its status), never while the design or the job list is being read again (what is
 *  shown may be about to change), and once per project and source. */
export function startsFirstDesign(f: { editable: boolean; canGenerate: boolean; hasDesign: boolean; hasAttempt: boolean; rereading: boolean; startedBefore: boolean }): boolean {
  return f.editable && f.canGenerate && !f.hasDesign && !f.hasAttempt && !f.rereading && !f.startedBefore;
}

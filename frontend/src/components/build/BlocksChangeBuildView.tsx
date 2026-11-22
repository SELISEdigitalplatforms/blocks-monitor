/** /p/:id/build?cr=N for a Blocks project: one change request on the shared step frame (STEP-STANDARD.md), through
 *  the light SDLC of CHANGE-PROCESS-31.10: Requested → Analysis → Questions → Approval → Build → Development → Staging →
 *  Production. The business analyst analyses the change (change.analyse), asks what is unclear (cr.answer), you approve
 *  or reject it (cr.decide), then the development team builds it (cr.startBuild, change.build) and the release manager
 *  takes it on from the Release page. Status, analysis and progress come from the change request and its jobs (nothing
 *  is invented). A change request saved before the analysis existed keeps its old view. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTalkAttachments, type TalkFile } from "@/blocks/collab/talkUpload";
import { SentFiles } from "@/components/feedback/AttachFiles";
import { Link } from "react-router-dom";
import { Hammer, RotateCcw, Send, Wrench } from "lucide-react";
import { Button, Card, EmptyState } from "@/ui/kit";
import { EasedJobBar } from "@/components/engine/EasedJobBar";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { crStatusLabel } from "@/components/delivery/releaseUi";
import { StepFrame, type StepChip, type StepPrimary } from "@/components/step/StepFrame";
import type { useDeliveryContext } from "@/blocks/delivery/context";
import { useChecksPolicy, useCrStartBuild, useFixChecks, useMarkKnown, useRetryAfterDeploy } from "@/blocks/delivery/actions";
import { latestJobFor, useApprovalPolicies, useChangeRequests, useDeliveryJobs, useMilestones, useReleases, useTickets } from "@/blocks/delivery/hooks";
import type { DeliveryChangeRequest } from "@/blocks/delivery/types";
import { cancelEngineJob, engineErrorMessage } from "@/blocks/engine/actions";
import { isActiveEngineJob } from "@/blocks/engine/types";
import { changeCode } from "@/domain/delivery";
import { BUILD_ROLE, changeTeamLine, failureReason, waitingForYou, waitsForPerson } from "./buildStep";
import { WaitingForYouLine } from "./WaitingForYouLine";
import {
  ChangeAgentLine, ChangeAnalysisCard, ChangeApprovalCard, ChangeDecisionLine, ChangeLifecycleBar, ChangeQuestionsCard, ScopeRouteNotice,
} from "@/components/changes/ChangeLifecycle";
import {
  KIND_WORD, analysisOf, changeStage, decisionOf, featureProgress, lifecycleSteps, ticketCount, type ChangeDecision, type ChangeStage,
} from "@/components/changes/changeFlow";
import { useChangeDecideRight } from "@/components/changes/changeDecide";
import { useBuildClock } from "@/components/changes/buildClock";
import {
  blocksChangeMessage, useAnswerBlocksChange, useChangeWait, useDecideBlocksChange, useStartChangeBuild, useSubmitBlocksChange,
} from "@/components/changes/blocksChanges";
import type { ChangeAnalysis } from "@/domain/changeAnalysis";
import { BlocksConnectNotice } from "@/components/engine/BlocksConnectCard";
import { isAfterDeployRetry, jobAttention } from "@/domain/afterDeploy";
import { openAfterDeploy, unfinishedWords, withoutClearedChecks } from "./afterDeployUi";
import { AfterDeployNotice, finishLabel } from "./AfterDeployNotice";
import { checksSettled, fileVerdicts } from "@/domain/changeChecks";
import { changeChecksState, failingWords } from "./changeChecksUi";
import { ChangeChecksCard } from "./ChangeChecksCard";
import { useChecksPolicyValue } from "./checksPolicy";
import { t, useT } from "@/i18n";

export const FIX_LABEL = "Fix what the checks found";
/** A change at "building" without any build of its own (changeFlow.ts buildLost). */
export const LOST_LINE = "The build request did not reach the development team";
export const LOST_TEXT = "No build of this change was queued, so nothing is being built. The approved tickets stay on the board; start the build again.";
/** FIX_LABEL, LOST_LINE and LOST_TEXT in the current language (the constants stay the English source). */
export const fixLabel = (): string => t("changes.page.fixLabel", "Fix what the checks found");
export const lostLine = (): string => t("changes.page.lostLine", "The build request did not reach the development team");
export const lostText = (): string => t("changes.page.lostText", "No build of this change was queued, so nothing is being built. The approved tickets stay on the board; start the build again.");

type DeliveryContext = ReturnType<typeof useDeliveryContext>;

/** The kind of change in plain words (the same words as the change request window). */
const laneWord = (lane: string): string | undefined => ({
  change: t("changes.lane.change", "Change to a feature"), enhance: t("changes.lane.enhance", "Feature enhancement"),
  add: t("changes.lane.add", "New feature"), fix: t("changes.lane.fix", "Fix of a problem"),
} as Record<string, string>)[lane];

/** A change request's status as a chip's value ("approved"), written as each language writes it there. */
const statusChipWord = (status: string): string => {
  switch (status) {
    case "draft": return t("changes.page.chip.state.draft", "draft");
    case "analysing": return t("changes.page.chip.state.analysing", "being analysed");
    case "questions": return t("changes.page.chip.state.questions", "questions for you");
    case "review": return t("changes.page.chip.state.review", "waiting for approval");
    case "approved": return t("changes.page.chip.state.approved", "approved");
    case "rejected": return t("changes.page.chip.state.rejected", "rejected");
    case "failed": return t("changes.page.chip.state.failed", "stopped");
    case "building": return t("changes.page.chip.state.building", "being built");
    case "released-dev": return t("changes.page.chip.state.releasedDev", "released to development");
    case "promoted-stage": return t("changes.page.chip.state.promotedStage", "on staging");
    case "promoted-production": return t("changes.page.chip.state.promotedProduction", "in production");
    default: return crStatusLabel(status).toLowerCase();
  }
};
const versionChip = (version: string | null | undefined): StepChip => ({
  id: "version", label: t("changes.page.chip.version", "Version"), value: version ?? t("changes.page.chip.whenBuilt", "when built"), state: version ? "done" : "info",
  title: version ? t("changes.page.chip.versionTitle", "Version {version}", { version }) : t("changes.page.chip.versionLater", "The version is set when the build starts"),
});

export function BlocksChangeBuildView({ ctx, number }: { ctx: DeliveryContext; number: number }) {
  const t = useT();
  const requests = useChangeRequests(ctx);
  // the change.build jobs: a change still "building" whose job stopped is offered the build again
  const { jobs } = useDeliveryJobs(ctx);
  const waitingForJob = requests.data.some((r) => r.number === number && r.status === "building");
  const clock = useBuildClock(waitingForJob);
  const releasePath = `/p/${ctx.projectId}/delivered`;
  const project = ctx.project;

  if (requests.isLoading) return <p role="status" className="text-[14px] text-ink3">{t("changes.page.loading", "Loading the change request…")}</p>;
  const cr = requests.data.find((r) => r.number === number);
  if (!cr) {
    return (
      <StepFrame title={t("changes.page.title", "Change request")} subject={project?.name} status={t("changes.page.notFound", "Not found")} statusTone="attention"
        primary={{ label: t("changes.page.openRelease", "Open the Release page"), href: releasePath }}>
        <Card><EmptyState title={t("changes.page.notFoundTitle", "This change request doesn't exist")} text={t("changes.page.notFoundText", "Check the number, or open the Release page to see the saved change requests.")} /></Card>
      </StepFrame>
    );
  }
  const analysis = analysisOf(cr);
  const decision = decisionOf(cr);
  const newestBuild = latestJobFor(jobs, "change.build", { changeRequestId: cr.id });
  // "building" is a build of its own, queued or running: a change at "building" without any build of its own for longer
  // than a moment is a start that never reached the development team (buildLost), never "being built"
  const stage = changeStage(cr.status, analysis, decision, newestBuild, latestJobFor(jobs, "change.analyse", { changeRequestId: cr.id }),
    { updatedAt: cr.updatedAt ?? null, now: clock });
  if (stage === "legacy") return <LegacyChangeBuildView ctx={ctx} cr={cr} />;
  return <ChangeFlowView ctx={ctx} cr={cr} analysis={analysis} decision={decision} stage={stage} />;
}

const NO_FILES: readonly TalkFile[] = [];

const PM_ROLE = {
  get who() { return t("changes.page.pmRole.who", "Business analyst"); },
  get delivers() { return t("changes.page.pmRole.delivers", "analyses the change, asks what is unclear and plans its tickets"); },
  get you() { return t("changes.page.pmRole.you", "answer the questions, then approve or reject the change"); },
};

const focusEl = (id: string) => window.setTimeout(() => {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus({ preventScroll: true });
}, 60);

/** The change request through analysis, questions, approval, build and release. */
function ChangeFlowView({ ctx, cr, analysis, decision, stage }: {
  ctx: DeliveryContext; cr: DeliveryChangeRequest; analysis: ChangeAnalysis | null; decision: ChangeDecision; stage: ChangeStage;
}) {
  const t = useT();
  const releases = useReleases(ctx);
  const milestones = useMilestones(ctx);
  const policies = useApprovalPolicies(ctx);
  const boardTickets = useTickets(ctx);
  const { jobs } = useDeliveryJobs(ctx);
  const submit = useSubmitBlocksChange(ctx.workspaceId, ctx.projectId);
  const answer = useAnswerBlocksChange(ctx.workspaceId, ctx.projectId);
  const decide = useDecideBlocksChange(ctx.workspaceId, ctx.projectId);
  const start = useStartChangeBuild(ctx.workspaceId, ctx.projectId);
  const [busy, setBusy] = useState<"submit" | "start" | "decide" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  // the files sent with the request and its answers (designs, screenshots, documents)
  const crFiles = useTalkAttachments(ctx.projectId, "change-request", [cr.id]).data?.get(cr.id) ?? NO_FILES;

  const code = changeCode(cr);
  const releasePath = `/p/${ctx.projectId}/delivered`;
  const scopePath = `/p/${ctx.projectId}/scope`;
  const boardPath = `/p/${ctx.projectId}/build?tab=board`;
  const project = ctx.project;
  const hasDev = releases.data.some((r) => r.environment === "dev");
  const firstNumber = milestones.data.length ? Math.min(...milestones.data.map((m) => m.number)) : null;
  const analyseJob = latestJobFor(jobs, "change.analyse", { changeRequestId: cr.id });
  const buildJob = latestJobFor(jobs, "change.build", { changeRequestId: cr.id });
  const buildActive = Boolean(buildJob && isActiveEngineJob(buildJob));
  const canRun = ctx.can("build.run");
  // its code is on development, but the steps after the deploy (data tables, texts) are not all finished
  // every change's checks: a failing check of this one that passes since on a later version (any change's run) is not its
  const allChanges = useChangeRequests(ctx).data;
  const settled = useMemo(() => checksSettled(allChanges), [allChanges]);
  const verdicts = useMemo(() => fileVerdicts(allChanges), [allChanges]);
  const codeOf = (id: string) => { const c = allChanges.find((x) => x.id === id); return c ? changeCode(c) : ""; };
  const unfinished = stage === "released" || stage === "approved" ? openAfterDeploy(jobs, { kind: "change.build", id: cr.id, checks: cr.checks, settled }) : null;
  const retry = useRetryAfterDeploy(ctx);
  const onFinish = () => { if (unfinished) { setDone(null); setError(null); void retry.run({ jobId: unfinished.job.id }); } };
  // its own checks on development (src/domain/changeChecks.ts): failed, it is there but NOT usable; a fix round or
  // putting development back is what happens next
  const policy = useChecksPolicyValue(ctx.projectId);
  const checks = useMemo(() => changeChecksState(cr, jobs, policy, verdicts), [cr, jobs, policy, verdicts]);
  const fixing = checks.next?.who === "team" ? checks.next : null;
  const broken = checks.broken;
  const fix = useFixChecks(ctx);
  const savePolicy = useChecksPolicy(ctx);
  // a failing check marked "known before this change" (or the mark taken back): the answer carries the stored record
  const markKnown = useMarkKnown(ctx);
  const onMark = (c: { repo: string; name: string }, reason: string) => markKnown.run({ changeRequestId: cr.id, repo: c.repo, name: c.name, reason, action: "mark" });
  const onUnmark = (c: { repo: string; name: string }) => void markKnown.run({ changeRequestId: cr.id, repo: c.repo, name: c.name, action: "unmark" });
  const onFix = () => { setDone(null); setError(null); void fix.run({ changeRequestId: cr.id, action: "fix" }); };
  const onRevert = () => { setDone(null); setError(null); void fix.run({ changeRequestId: cr.id, action: "revert" }); };
  const steps = useMemo(() => lifecycleSteps(cr.status, stage, analysis, decision.decidedAt, stage === "released" && (broken ? "broken" : !!unfinished)),
    [cr.status, stage, analysis, decision.decidedAt, unfinished, broken]);
  const right = useChangeDecideRight(ctx, cr, policies.data);
  const nameOf = (id: string | null) => (id ? ctx.memberName(id) : "");
  // a new feature on an existing product: built increment by increment, each one tried on development before the next
  const progress = useMemo(() => featureProgress(analysis, cr.id, boardTickets.data), [analysis, cr.id, boardTickets.data]);
  const builds = progress?.increments.length ?? 0;
  const nextBuild = progress?.next ?? null;
  const between = !!progress && builds > 1 && progress.built > 0 && nextBuild !== null;
  const buildWord = progress && builds > 1 && nextBuild !== null ? t("changes.page.incrementOf", "increment {n} of {of}", { n: nextBuild, of: builds }) : "";
  // "CR-018 increment 2 of 3" (the increment to build next), else "CR-018"
  const codeNext = buildWord ? t("build.step.changeIncrement", "{code} increment {n} of {of}", { code, n: nextBuild!, of: builds }) : code;

  // the analysis and the build are engine jobs: the page reads the change request again until they settle
  useChangeWait(ctx.workspaceId, stage === "analysing" || stage === "refining" || stage === "building" || buildActive);

  // a message about the previous stage goes once the stage moves on
  const lastStage = useRef(stage);
  useEffect(() => {
    if (lastStage.current !== stage) { lastStage.current = stage; setDone(null); setError(null); }
  }, [stage]);

  const act = async (kind: "submit" | "start", run: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(kind); setError(null); setDone(null);
    try { await run(); setDone(ok); } catch (e) { setError(blocksChangeMessage(e)); } finally { setBusy(null); }
  };
  const onSubmit = () => act("submit", () => submit.submit(cr.id), t("changes.page.sent", "Sent. The business analyst starts the analysis in a moment."));
  // start.start throws when the answer names a build that is not running: the page never shows a build that isn't there
  // shown only once the write that queues its build succeeded and named a build of this change
  const onStart = () => act("start", () => start.start(cr.id, jobs), t("changes.page.requested", "The build was requested. The development team picks it up in a moment."));
  const onAnswer = async (id: string, a: string, files?: { attachmentIds: string[]; draftKey: string }): Promise<boolean> => {
    if (savingId) return false;
    setSavingId(id); setAnswerError(null);
    try { await answer.answer(cr.id, [{ id, answer: a }], files); return true; } catch (e) { setAnswerError(blocksChangeMessage(e)); return false; } finally { setSavingId(null); }
  };
  const onDecide = async (d: "approve" | "reject", note: string, route?: "fast"): Promise<boolean> => {
    if (busy) return false;
    setBusy("decide"); setDecideError(null); setDone(null);
    try {
      await decide.decide(cr.id, d, note, route);
      setDone(d === "reject" ? t("changes.page.done.rejected", "The change was rejected.")
        : route === "fast" ? t("changes.page.done.asChange", "Approved as a change. The planned tickets are on the board; start the build when you're ready.")
        : analysis?.route === "feature" ? (builds > 1 ? t("changes.page.done.featureFirst", "Approved. The feature's planned tickets are on the board; start the first build when you're ready.")
          : t("changes.page.done.feature", "Approved. The feature's planned tickets are on the board; start the build when you're ready."))
        : analysis?.route === "scope" ? t("changes.page.done.scope", "Kept for Scope & success. It's listed on the Scope & success page.")
        : t("changes.page.done.approved", "Approved. The planned tickets are on the board."));
      return true;
    } catch (e) { setDecideError(blocksChangeMessage(e)); return false; } finally { setBusy(null); }
  };
  // an approved change kept for Scope & success can still be built now as a change (never a dead end)
  const onBuildAsChange = () => void onDecide("approve", "", "fast");
  const cancel = async () => {
    if (!buildJob || busy) return;
    setBusy("cancel"); setError(null); setDone(null);
    try { await cancelEngineJob(buildJob.id); setDone(t("build.page.cancelled", "The build was cancelled.")); } catch (e) { setError(engineErrorMessage(e)); } finally { setBusy(null); }
  };

  const open = analysis ? analysis.questions.filter((q) => q.answer === null).length : 0;
  const approved = stage === "approved" || stage === "scope" || stage === "building" || stage === "released" || stage === "buildFailed" || stage === "buildLost";
  let statusText: string;
  let tone: "done" | "progress" | "waiting" | "attention";
  switch (stage) {
    case "draft": statusText = hasDev ? t("changes.page.status.draft", "{code} is saved; send it for analysis", { code })
      : firstNumber !== null ? t("changes.page.status.draftWaits", "{code} is saved; it can be sent once milestone {number} is on the development environment", { code, number: firstNumber })
        : t("changes.page.status.draftWaitsFirst", "{code} is saved; it can be sent once the first milestone is on the development environment", { code });
      tone = "waiting"; break;
    case "analysing": statusText = t("changes.page.status.analysing", "The business analyst is analysing {code}", { code }); tone = "progress"; break;
    case "questions": statusText = open === 1 ? t("changes.page.status.question", "{code} has a question for you", { code }) : t("changes.page.status.questions", "{code} has {count} questions for you", { code, count: open }); tone = "attention"; break;
    case "refining": statusText = t("changes.page.status.refining", "Refining the analysis of {code} with your answers", { code }); tone = "progress"; break;
    case "review": statusText = right.ok ? t("changes.page.status.reviewYours", "{code} is waiting for your approval", { code }) : t("changes.page.status.review", "{code} is waiting for approval", { code }); tone = right.ok ? "attention" : "waiting"; break;
    case "approved":
      statusText = between ? t("changes.page.status.between", "Increment {built} of {of} of {code} is on development; try it, then build {next}", { built: progress!.built, of: builds, code, next: buildWord })
        : buildWord ? t("changes.page.status.approvedNext", "{code} is approved; {next} is ready to build", { code, next: buildWord }) : t("changes.page.status.approved", "{code} is approved and ready to build", { code });
      tone = "attention"; break;
    case "scope": statusText = t("changes.page.status.scope", "{code} is kept for Scope & success; it can be built now as a change", { code }); tone = "attention"; break;
    case "rejected": statusText = t("changes.page.status.rejected", "{code} was rejected", { code }); tone = "attention"; break;
    case "analysisFailed": statusText = t("changes.page.status.analysisFailed", "The analysis of {code} stopped", { code }); tone = "attention"; break;
    case "buildFailed": statusText = t("changes.stopped.buildOf", "The build of {code} stopped", { code }); tone = "attention"; break;
    case "buildLost": statusText = lostLine(); tone = "attention"; break;
    case "building":
      // the build waits for a person to connect the product to Blocks (the card above): nothing is built until then
      if (waitsForPerson(buildJob)) { statusText = waitingForYou(); tone = "attention"; break; }
      // being built only with a build of its own on its way; a moment after the start its job may not be read yet
      if (!buildActive) { statusText = t("changes.page.status.requested", "The build of {what} was requested; the development team picks it up in a moment", { what: codeNext }); tone = "waiting"; break; }
      statusText = t("changes.page.status.building", "{what} is being built", { what: codeNext }); tone = "progress"; break;
    default:
      statusText = unfinished
        ? (cr.version ? t("changes.page.status.onDevVersionUnfinished", "{code} is on development as version {version}, {unfinished}", { code, version: cr.version, unfinished: unfinishedWords(unfinished.attention) })
          : t("changes.page.status.onDevUnfinished", "{code} is on development, {unfinished}", { code, unfinished: unfinishedWords(unfinished.attention) }))
        : cr.version ? t("changes.page.status.stateVersion", "{code} · {state} as version {version}", { code, state: crStatusLabel(cr.status), version: cr.version })
          : `${code} · ${crStatusLabel(cr.status)}`;
      tone = unfinished ? "attention" : "done";
  }

  // a change whose own checks failed is never shown as delivered: on development, not usable, and what happens next
  const codeBuilt = progress && builds > 1 && progress.built > 0 ? t("build.step.changeIncrement", "{code} increment {n} of {of}", { code, n: progress.built, of: builds }) : code;
  if ((stage === "approved" || stage === "released") && fixing) {
    statusText = fixing.what === "fixing"
      ? t("changes.page.status.fixing", "{what} is on development, but not usable yet; the development team is fixing what its checks found (round {round})", { what: codeBuilt, round: fixing.round })
      : t("changes.page.status.reverting", "Development is being put back to the last build whose checks passed, without {code}", { code });
    tone = "progress";
  } else if ((stage === "approved" || stage === "released") && broken) {
    statusText = checks.version
      ? t("changes.page.status.brokenVersion", "{what} is on development as {version}, but not usable yet: {failing}", { what: codeBuilt, version: checks.version, failing: failingWords(checks) })
      : t("changes.page.status.broken", "{what} is on development, but not usable yet: {failing}", { what: codeBuilt, failing: failingWords(checks) });
    tone = "attention";
  }

  const noRun = canRun ? undefined : t("changes.page.noRun", "Your role can't change this; the project team does.");
  let primary: StepPrimary | null = null;
  switch (stage) {
    case "draft":
      primary = {
        label: t("changes.page.primary.send", "Send for analysis"), icon: <Send size={16} strokeWidth={1.75} aria-hidden />,
        disabled: !canRun || !hasDev || !cr.title.trim() || !cr.description.trim(),
        reason: noRun ?? (!cr.title.trim() || !cr.description.trim() ? t("changes.page.primary.titleFirst", "Add a title and a description first.") : undefined),
        pending: busy === "submit", pendingLabel: t("changes.page.primary.sending", "Sending…"), onClick: () => void onSubmit(),
      };
      break;
    case "questions": primary = { label: t("changes.page.primary.answer", "Answer the questions"), onClick: () => focusEl("cr-questions") }; break;
    case "review": primary = right.ok ? { label: t("changes.page.primary.decide", "Approve or reject"), onClick: () => focusEl("cr-approval") } : { label: t("changes.page.openRelease", "Open the Release page"), href: releasePath }; break;
    case "approved":
      primary = {
        // while the steps after the previous deploy are being finished (a change.build of this change), a start would only
        // answer that running job: it waits for it
        label: buildWord ? t("changes.page.primary.buildNext", "Build {next}", { next: buildWord }) : t("build.step.primary.start", "Start the build"), icon: <Hammer size={16} strokeWidth={1.75} aria-hidden />, disabled: !canRun || buildActive,
        reason: noRun ?? (buildActive ? t("changes.page.primary.finishingFirst", "The steps after the deploy are being finished; the build can start right after.") : undefined),
        pending: busy === "start", pendingLabel: t("build.page.starting", "Starting the build…"), onClick: () => void onStart(),
      };
      break;
    case "scope":
      primary = right.ok
        ? { label: t("changes.page.primary.asChange", "Build it as a change"), icon: <Hammer size={16} strokeWidth={1.75} aria-hidden />, pending: busy === "decide", pendingLabel: t("changes.page.primary.approving", "Approving…"), onClick: onBuildAsChange }
        : { label: t("changes.page.primary.openScope", "Open Scope & success"), href: scopePath };
      break;
    case "analysisFailed":
      primary = {
        label: t("changes.page.primary.analyseAgain", "Try the analysis again"), icon: <RotateCcw size={16} strokeWidth={1.75} aria-hidden />, disabled: !canRun, reason: noRun,
        pending: busy === "submit", pendingLabel: t("changes.page.primary.sending", "Sending…"), onClick: () => void onSubmit(),
      };
      break;
    case "buildFailed":
    case "buildLost":
      primary = {
        label: t("changes.page.primary.startAgain", "Start the build again"), icon: <RotateCcw size={16} strokeWidth={1.75} aria-hidden />, disabled: !canRun, reason: noRun,
        pending: busy === "start", pendingLabel: t("build.page.starting", "Starting the build…"), onClick: () => void onStart(),
      };
      break;
    case "analysing": case "refining": case "building": primary = null; break;
    default:
      // released, but the steps after the deploy can still be finished: that is the one action now
      primary = unfinished?.attention.retry && !unfinished.finishing
        ? { label: finishLabel(), icon: <RotateCcw size={16} strokeWidth={1.75} aria-hidden />, disabled: !canRun, reason: noRun, pending: retry.pending, pendingLabel: t("changes.page.primary.requesting", "Requesting…"), onClick: onFinish }
        : { label: t("changes.page.openRelease", "Open the Release page"), href: releasePath };
  }
  // the checks failed: the one action is to fix what they found (never the next increment on top of a broken one);
  // while a round or the revert runs, nothing (the line above follows it)
  if ((stage === "approved" || stage === "released") && (fixing || broken)) {
    primary = fixing ? null : {
      label: fixLabel(), icon: <Wrench size={16} strokeWidth={1.75} aria-hidden />, disabled: !canRun || buildActive,
      reason: noRun ?? (buildActive ? t("changes.page.primary.anotherRuns", "Another build of this change runs; the fix round can start right after.") : undefined),
      pending: fix.pending, pendingLabel: t("changes.page.primary.requesting", "Requesting…"), onClick: onFix,
    };
  }

  const pmStage = stage === "draft" || stage === "analysing" || stage === "questions" || stage === "refining" || stage === "review" || stage === "analysisFailed" || stage === "rejected" || stage === "scope";
  const kindWord = analysis ? KIND_WORD[analysis.kind] : laneWord(cr.lane) ?? cr.lane;
  const chips: StepChip[] = [
    { id: "kind", label: t("changes.page.chip.kind", "Kind"), value: kindWord, state: "info", title: `${code}: ${kindWord}` },
    { id: "status", label: t("changes.page.chip.status", "Status"), value: broken || fixing ? t("changes.page.chip.notUsable", "not usable yet") : statusChipWord(stage === "buildFailed" ? "failed" : cr.status), state: stage === "released" && !unfinished ? "done" : "info", title: statusText },
    { id: "estimate", label: t("changes.page.chip.estimate", "Estimate"), value: analysis ? ticketCount(analysis.estimate.tickets) : t("changes.page.chip.afterAnalysis", "after the analysis"), state: analysis ? "done" : "info",
      title: analysis ? t("changes.page.chip.plans", "The business analyst plans {tickets}", { tickets: ticketCount(analysis.estimate.tickets) }) : t("changes.page.chip.estimates", "The business analyst estimates the change in the analysis") },
    versionChip(cr.version),
  ];

  const progressOf = (j: typeof analyseJob) => (j && Number.isFinite(j.progress) ? j.progress : null);
  const agentLine = stage === "analysing"
    ? <ChangeAgentLine text={t("changes.page.agent.analysing", "The business analyst is analysing your change")} progress={progressOf(analyseJob)} working={analyseJob?.status !== "queued"} resetKey={analyseJob?.id ?? "analyse"} />
    : stage === "refining"
    ? <ChangeAgentLine text={t("changes.page.agent.refining", "The business analyst is refining the analysis with your answers")} progress={progressOf(analyseJob)} working={analyseJob?.status !== "queued"} resetKey={analyseJob?.id ?? "refine"} />
    : buildActive && waitsForPerson(buildJob)
    ? <WaitingForYouLine />
    // a queued build (parallel streams): the engine's own line on the job says what it waits for, the same line as on
    // the Build step's queue ("Waits for CR-020: both change api: src/session.ts.")
    : buildActive && buildJob?.status === "queued" && buildJob.message
    ? <p role="status" className="rounded-block bg-surface2 px-3.5 py-2.5 text-[13px] text-ink2 [overflow-wrap:anywhere]">{buildJob.message}</p>
    : fixing && buildActive
    ? <ChangeAgentLine text={changeTeamLine(codeBuilt, fixing.what === "fixing" ? { kind: "fix", round: fixing.round } : { kind: "revert" }, false)}
        progress={progressOf(buildJob)} working={buildJob?.status !== "queued"} resetKey={buildJob?.id ?? "fix"} />
    : buildActive && isAfterDeployRetry(buildJob)
    ? <ChangeAgentLine text={t("build.step.team.finish", "The development team is finishing the steps after the deploy of {what}", { what: code })} progress={progressOf(buildJob)} working={buildJob?.status !== "queued"} resetKey={buildJob?.id ?? "finish"} />
    : buildActive
    ? <ChangeAgentLine text={t("build.step.team.build", "The development team is building {what}", { what: codeNext })} progress={progressOf(buildJob)} working={buildJob?.status !== "queued"} resetKey={buildJob?.id ?? "build"} />
    : undefined;

  const showJob = stage === "building" || stage === "buildFailed" || stage === "released" || unfinished ? buildJob : stage === "analysisFailed" || stage === "analysing" || stage === "refining" ? analyseJob : null;
  const details = showJob ? (
    <div className="flex flex-col gap-4">
      <EngineJobStatus job={showJob} {...(showJob ? { attention: withoutClearedChecks(jobAttention(showJob), showJob, cr.checks, settled(cr.id, showJob.id)) } : {})} />
      {showJob === buildJob && buildActive && canRun && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button size="sm" disabled={busy !== null} onClick={() => void cancel()}>{t("build.page.cancel", "Cancel the build")}</Button>
          <span className="text-[12px] text-ink3">{t("build.page.stops.change", "Stops the build of {what}; it can be started again.", { what: code })}</span>
        </div>
      )}
    </div>
  ) : undefined;

  const questions = analysis && analysis.questions.length > 0 ? (
    <div id="cr-questions" tabIndex={-1} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
      <ChangeQuestionsCard questions={analysis.questions} canAnswer={canRun && stage === "questions"} refining={stage === "refining"}
        savingId={savingId} error={answerError} onAnswer={onAnswer} nameOf={nameOf}
        attach={{ projectId: ctx.projectId, changeRequestId: cr.id }} files={crFiles} />
    </div>
  ) : null;
  const stageCard = stage === "analysisFailed" ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{t("changes.page.card.analysisStopped", "The analysis stopped before it finished")}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink2">{t("changes.page.card.analysisStoppedText", "Nothing was changed. Try the analysis again; the business analyst starts over with the change as it is written.")}</p>
    </Card>
  ) : stage === "buildLost" ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{lostLine()}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink2">{lostText()}</p>
    </Card>
  ) : stage === "buildFailed" ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{t("changes.page.card.buildStopped", "The build stopped before it finished")}</p>
      {failureReason(buildJob) && <p className="mt-1 text-[13px] leading-relaxed text-danger">{failureReason(buildJob)}</p>}
      <p className="mt-1 text-[13px] leading-relaxed text-ink2">{t("changes.page.card.buildStoppedText", "The approved tickets stay on the board. Start the build again; the report is in Details.")}</p>
    </Card>
  ) : stage === "rejected" ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{t("changes.page.card.rejected", "This change was rejected")}</p>
      <div className="mt-1"><ChangeDecisionLine decision={decision} approved={false} nameOf={nameOf} /></div>
    </Card>
  ) : stage === "approved" && between && !broken && !fixing ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{t("changes.page.card.incrementOnDev", "Increment {built} of {of} is on development.", { built: progress!.built, of: builds })}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink2">
        {t("changes.page.card.incrementTry", "Try it there and tell the team what to change. Then build {next}: it builds on what is on development now, so every build stays small.", { next: buildWord })}
      </p>
      <Link to={releasePath} className="mt-2 inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">{t("changes.page.openRelease", "Open the Release page")}</Link>
    </Card>
  ) : stage === "approved" && !broken && !fixing ? (
    <Card tone="soft">
      <p className="text-[14px] font-medium text-ink">{progress && builds > 1 ? t("changes.page.card.approvedIncrements", "Approved. The planned tickets are on the board; the feature is built in {count} increments.", { count: builds }) : t("changes.page.done.approved", "Approved. The planned tickets are on the board.")}</p>
      <div className="mt-1"><ChangeDecisionLine decision={decision} approved nameOf={nameOf} /></div>
      <Link to={boardPath} className="mt-2 inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">{t("build.queue.openBoard", "Open the board")}</Link>
    </Card>
  ) : null;

  return (
    <StepFrame
      eyebrow={project?.name ? t("changes.page.eyebrow", "{project} · change request", { project: project.name }) : t("changes.page.title", "Change request")}
      title={code}
      subject={cr.title || undefined}
      status={statusText}
      statusTone={tone}
      role={pmStage ? PM_ROLE.who : BUILD_ROLE.who}
      deliverable={pmStage ? PM_ROLE.delivers : t("changes.page.deliverable", "builds the change and puts it on the development environment")}
      yourPart={stage === "scope" ? (right.ok ? t("changes.page.yourPart.scopeApprover", "build it now as a change, or keep it for a new scope version") : t("changes.page.yourPart.scope", "follow it; an approver can build it now as a change")) : pmStage ? PM_ROLE.you : t("changes.page.yourPart.build", "try it on development; the release manager takes it to staging and production")}
      primary={primary}
      chips={chips}
      chipsLabel={t("changes.page.title", "Change request")}
      agentLine={agentLine}
      notices={<>
        <BlocksConnectNotice jobs={jobs} />
        {done && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{done}</p>}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {unfinished && !broken && !fixing && (
          <AfterDeployNotice open={unfinished} what={code} canRun={canRun} onFinish={onFinish} pending={retry.pending}
            error={retry.error} success={retry.success} action={stage !== "released"} />
        )}
        {unfinished && (broken || fixing) && checks.other && (
          <AfterDeployNotice open={{ ...unfinished, attention: checks.other }} what={code} canRun={canRun} onFinish={onFinish} pending={retry.pending}
            error={retry.error} success={retry.success} />
        )}
        {fix.success && !fix.error && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{fix.success}</p>}
        {fix.error && <p role="alert" className="text-[13px] text-danger">{fix.error}</p>}
      </>}
      mainTitle={t("changes.page.mainTitle", "What changes")}
      details={details}
      detailsLabel={showJob === analyseJob ? t("changes.page.detailsAnalysis", "Details · the analysis report") : t("changes.page.detailsBuild", "Details · the build report")}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <ChangeLifecycleBar steps={steps} />
        </Card>
        {stageCard}
        {(stage === "approved" || stage === "released") && (
          <ChangeChecksCard state={checks} what={codeBuilt} policy={policy} canRun={canRun} onRevert={onRevert}
            onRecheck={unfinished?.attention.retry && !unfinished.finishing ? onFinish : undefined}
            onPolicy={(p) => void savePolicy.run({ autoFixRounds: p.autoFixRounds, autoRevert: p.autoRevert })}
            onMark={onMark} onUnmark={onUnmark} codeOf={codeOf}
            busy={fix.pending || savePolicy.pending || retry.pending || markKnown.pending} error={markKnown.error ?? savePolicy.error ?? retry.error}
            success={markKnown.success ?? savePolicy.success ?? retry.success} />
        )}
        {stage === "scope" && (
          <ScopeRouteNotice scopeHref={scopePath} canBuildAsChange={right.ok} approvers={right.ok ? [] : right.others.map((u) => nameOf(u)).filter(Boolean)}
            busy={busy === "decide"} error={decideError} onBuildAsChange={onBuildAsChange} />
        )}
        {stage === "questions" && questions}
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-[12px] font-medium uppercase tracking-wider text-ink3">{laneWord(cr.lane) ?? cr.lane}</p>
            <h3 className="text-[17px] font-medium text-ink">{cr.title || code}</h3>
            {cr.description
              ? <p className="max-w-[75ch] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink2">{cr.description}</p>
              : <p className="text-[14px] text-ink3">{t("changes.page.noDescription", "No description yet.")}</p>}
            <SentFiles projectId={ctx.projectId} files={crFiles.filter((f) => !f.questionId)} className="-mt-2" />
            {cr.createdByUserId && <p className="text-[12px] text-ink3">{t("changes.page.askedBy", "Asked for by {name}", { name: ctx.memberName(cr.createdByUserId) })}</p>}
            {approved && stage !== "approved" && <ChangeDecisionLine decision={decision} approved nameOf={nameOf} />}
          </div>
        </Card>
        {analysis && <ChangeAnalysisCard analysis={analysis} refreshing={stage === "refining"} progress={approved ? progress?.increments ?? null : null} />}
        {stage !== "questions" && questions}
        {stage === "review" && !policies.isLoading && (
          <div id="cr-approval" tabIndex={-1} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
            <ChangeApprovalCard right={right} busy={busy !== null} error={decideError} onDecide={onDecide} nameOf={nameOf}
              scopeRoute={analysis?.route === "scope"} isFeature={analysis?.kind === "feature"}
              featurePlan={analysis?.route === "feature" && analysis.feature ? { builds: analysis.feature.increments.length, tickets: analysis.tickets.length } : null} />
          </div>
        )}
      </div>
    </StepFrame>
  );
}

/** The view of a change request saved before the analysis existed (no Analysis; building or released): unchanged. */
function LegacyChangeBuildView({ ctx, cr }: { ctx: DeliveryContext; cr: DeliveryChangeRequest }) {
  const t = useT();
  const releases = useReleases(ctx);
  const milestones = useMilestones(ctx);
  const { jobs } = useDeliveryJobs(ctx);
  const start = useCrStartBuild(ctx);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const releasePath = `/p/${ctx.projectId}/delivered`;
  const project = ctx.project;

  const code = changeCode(cr);
  const hasDev = releases.data.some((r) => r.environment === "dev");
  const firstNumber = milestones.data.length ? Math.min(...milestones.data.map((m) => m.number)) : null;
  const job = latestJobFor(jobs, "change.build", { changeRequestId: cr.id });
  const active = Boolean(job && isActiveEngineJob(job));
  const canRun = ctx.can("build.run");
  const draft = cr.status === "draft";
  const stopped = draft && job && (job.status === "failed" || job.status === "cancelled");
  // on development, but the steps after its deploy (data tables, texts) are not all finished
  const unfinished = !draft ? openAfterDeploy(jobs, { kind: "change.build", id: cr.id, checks: cr.checks }) : null;
  const retry = useRetryAfterDeploy(ctx);

  const cancel = async () => {
    if (!job) return;
    setError(null); setCancelled(false);
    try { await cancelEngineJob(job.id); setCancelled(true); } catch (e) { setError(engineErrorMessage(e)); }
  };

  const statusText = active ? (isAfterDeployRetry(job) ? t("changes.page.status.finishing", "{code}: the steps after the deploy are being finished", { code }) : t("changes.page.status.building", "{what} is being built", { what: code }))
    : draft ? (hasDev ? (stopped ? t("changes.stopped.buildOf", "The build of {code} stopped", { code }) : t("changes.page.status.ready", "{code} is ready to build", { code }))
      : firstNumber !== null ? t("changes.page.status.savedWaits", "{code} is saved; it can be built once milestone {number} is on the development environment", { code, number: firstNumber })
        : t("changes.page.status.savedWaitsFirst", "{code} is saved; it can be built once the first milestone is on the development environment", { code }))
      : unfinished ? t("changes.page.status.onDevUnfinished", "{code} is on development, {unfinished}", { code, unfinished: unfinishedWords(unfinished.attention) })
        : cr.version ? t("changes.page.status.stateVersion", "{code} · {state} as version {version}", { code, state: crStatusLabel(cr.status), version: cr.version }) : `${code} · ${crStatusLabel(cr.status)}`;
  const tone = active ? "progress" : stopped || unfinished ? "attention" : draft ? "waiting" : "done";

  // the one primary action: start the build of a saved change, else back to the Release page
  const primary: StepPrimary = draft && hasDev && !active
    ? {
      label: stopped ? t("changes.page.primary.startAgain", "Start the build again") : t("build.step.primary.start", "Start the build"), icon: <Hammer size={16} strokeWidth={1.75} aria-hidden />,
      disabled: !canRun, reason: canRun ? undefined : t("build.gate.roleCannot", "Your role can't start builds; the project team starts them."),
      pending: start.pending, pendingLabel: t("build.page.starting", "Starting the build…"), onClick: () => void start.run({ changeRequestId: cr.id }),
    }
    : { label: t("changes.page.openRelease", "Open the Release page"), href: releasePath };

  const chips: StepChip[] = [
    { id: "kind", label: t("changes.page.chip.kind", "Kind"), value: laneWord(cr.lane) ?? cr.lane, state: "info", title: `${code}: ${laneWord(cr.lane) ?? cr.lane}` },
    { id: "status", label: t("changes.page.chip.status", "Status"), value: active ? t("build.step.chip.previewBuilding", "being built") : statusChipWord(cr.status), state: draft || active || unfinished ? "info" : "done", title: statusText },
    versionChip(cr.version),
  ];

  const agentLine = active && job ? (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-[rgb(var(--c-ai-text))]">
        <Hammer size={15} aria-hidden className="shrink-0 animate-pulse motion-reduce:animate-none" />
        {isAfterDeployRetry(job) ? t("build.step.team.finish", "The development team is finishing the steps after the deploy of {what}", { what: code }) : t("build.step.team.build", "The development team is building {what}", { what: code })}…
      </p>
      <EasedJobBar progress={Number.isFinite(job.progress) ? job.progress : null} working={job.status !== "queued"} resetKey={job.id}
        ticks={false} active label={t("build.step.doing.build", "Building {what}", { what: code })} size="sm" />
    </div>
  ) : undefined;

  const details = job ? (
    <div className="flex flex-col gap-4">
      <EngineJobStatus job={job} />
      {active && canRun && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button size="sm" onClick={() => void cancel()}>{t("build.page.cancel", "Cancel the build")}</Button>
          <span className="text-[12px] text-ink3">{t("build.page.stops.change", "Stops the build of {what}; it can be started again.", { what: code })}</span>
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <StepFrame
      eyebrow={project?.name ? t("changes.page.eyebrow", "{project} · change request", { project: project.name }) : t("changes.page.title", "Change request")}
      title={code}
      subject={cr.title || undefined}
      status={statusText}
      statusTone={tone}
      role={BUILD_ROLE.who}
      deliverable={t("changes.page.deliverable", "builds the change and puts it on the development environment")}
      yourPart={t("changes.page.yourPart.build", "try it on development; the release manager takes it to staging and production")}
      primary={primary}
      chips={chips}
      chipsLabel={t("changes.page.title", "Change request")}
      agentLine={agentLine}
      notices={<>
        <BlocksConnectNotice jobs={jobs} />
        {start.success && draft && !active && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("changes.page.requested", "The build was requested. The development team picks it up in a moment.")}</p>}
        {cancelled && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("build.page.cancelled", "The build was cancelled.")}</p>}
        {(error ?? start.error) && <p role="alert" className="text-[13px] text-danger">{error ?? start.error}</p>}
        {unfinished && !active && (
          <AfterDeployNotice open={unfinished} what={code} canRun={canRun} onFinish={() => void retry.run({ jobId: unfinished.job.id })}
            pending={retry.pending} error={retry.error} success={retry.success} />
        )}
      </>}
      mainTitle={t("changes.page.mainTitle", "What changes")}
      details={details}
      detailsLabel={t("changes.page.detailsBuild", "Details · the build report")}
    >
      <Card>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] font-medium uppercase tracking-wider text-ink3">{laneWord(cr.lane) ?? cr.lane}</p>
          <h3 className="text-[17px] font-medium text-ink">{cr.title || code}</h3>
          {cr.description
            ? <p className="max-w-[75ch] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink2">{cr.description}</p>
            : <p className="text-[14px] text-ink3">{t("changes.page.noDescription", "No description yet.")}</p>}
          {cr.createdByUserId && <p className="text-[12px] text-ink3">{t("changes.page.askedBy", "Asked for by {name}", { name: ctx.memberName(cr.createdByUserId) })}</p>}
        </div>
      </Card>
    </StepFrame>
  );
}

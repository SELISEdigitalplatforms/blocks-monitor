/** The scope section on SELISE Blocks ("Scope & success", /p/:id/analysis#scope), the last part of step 2 "Business
 *  Analysis" of the project stepper, on the shared step frame (STEP-STANDARD.md): the business analyst and the solution architect deliver the Scope & delivery plan
 *  (features, screens, milestones, success & performance targets); you review the screens and settle the targets;
 *  "Lock the scope" is the approver's sign-off (the plan is approved for building). The main area is the plan; the assistant, the second opinion,
 *  the summary counts, the lock checklist (and unlock), approvals and "Needed later" are in the collapsed Details.
 *  Reads go through the s7 hooks (Data Gateway, row policies); every write is an operation of the `project` function
 *  (s8 mutations). Nothing here is invented: the screens and the second opinion are MADP engine jobs. */
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckSquare, Eye, FileText, Lock, Share2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { scopeProjectKey, useScopeContext } from "@/blocks/scope/context";
import {
  useApprovalPolicies, useBuildJobs, useChallenges, useDesignScreens, useFeatures, useLatestSecondOpinion, useMilestones, useObjective,
  useScopeJobs, useScopeThreads, useScopeVersion, useStories,
} from "@/blocks/scope/hooks";
import type { PolicyState } from "@/blocks/scope/records";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import { useScopeOpen, useScreensReview } from "@/blocks/scope/mutations";
import { phaseName, stepName as journeyStepName } from "@/components/project/stepNames";
import { useT } from "@/i18n";
import type { WorkspacePermission } from "@/domain/rbac";
import { SUCCESS_KEYS, emptyTargets, type SuccessKey } from "@/domain/successTargets";
import { successShortName } from "@/components/requirements/domainLabels";
import { StepFrame, type StepChip, type StepChipState } from "@/components/step/StepFrame";
import { chipsStatusText, signOffText } from "@/components/step/stepModel";
import { ChangeRequestLayer } from "@/components/changes/ChangeRequestLayer";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { Button, Card, EmptyState } from "@/ui/kit";
import { APPROVALS_PARAM, APPROVALS_SETUP, APPROVALS_SETUP_PATH, boardPath, deliveredPath, stepName, stepPath } from "../links";
import { ApprovalsEntry } from "./ApprovalsEntry";
import { ScopeApprovalsEditor } from "./ScopeApprovalsEditor";
import { BlocksScopePrint } from "./BlocksScopePrint";
import { FeaturesSection } from "./FeaturesSection";
import { FeaturesPlan } from "./FeaturesPlan";
import { MilestonesPlan } from "./MilestonesPlan";
import { LockCard, lockDisabledReason } from "./LockCard";
import { LockDialog } from "./LockDialog";
import { agentLine, nowChecklist, successLockItem, type NowItem } from "./nowChecklist";
import { ScopeAgentLine } from "./ScopeAgentLine";
import { NeededLater } from "./NeededLater";
import { ScopeChangesWaiting } from "@/components/changes/ScopeChangesWaiting";
import { SUCCESS_SECTION_ID, SuccessSection } from "./SuccessSection";
import { MilestonesSection } from "../../milestones/MilestonesSection";
import { SecondOpinionAside } from "./SecondOpinionAside";
import { scopeName, versionLine } from "./ScopeHeader";
import { ScopeFeedbackProvider, openScopeFeedback, scopeFeedbackTarget } from "./ScopeFeedback";
import { ScreensSection } from "./ScreensSection";
import { SummarySection, countSummary } from "./SummarySection";
import type { ApplyRequest } from "./applyRequest";
import { attachedStoryCount, lockChecklist, scopePageState, scopeShareTarget } from "./pageState";
import { useJobRefresh } from "./useJobRefresh";

/** the page fills the shell's main area */
const PAGE = "flex w-full min-w-0 flex-col";
const EMPTY: never[] = [];
const WATCHED: readonly WorkspacePermission[] = ["requirements.edit", "milestones.edit", "scope.lock", "comment", "release.manage-approvals"];

/** The plan's place while the step loads: the same frame, a calm placeholder (as the other steps). */
function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="hatched h-40 rounded-card bg-surface/60" />
      <div className="hatched h-56 rounded-card bg-surface/60" />
    </div>
  );
}

type ShareTarget = NonNullable<ComponentProps<typeof ShareDialog>["target"]>;

const policySet = (p: PolicyState | undefined): boolean => Boolean(p && p !== "unreadable" && p.steps.length > 0);
const NO_TARGETS = emptyTargets();
/** What the scope draft writes: read again as soon as it is done. */
const DRAFT_SCHEMAS = ["ScopeVersion", "Feature", "Story", "Milestone"] as const;

/** Brings a section of the page into view and gives it focus (the frame's chips). */
function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

export function BlocksScopeView({ projectId }: { projectId: string }) {
  const t = useT();
  const TITLE = journeyStepName("scope");
  const ROLE = t("analysis.scope.view.role", "Business analyst + solution architect");
  const DELIVERABLE = t("analysis.scope.view.deliverable", "deliver your Scope & delivery plan");
  const ctx = useScopeContext(projectId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const approvalsOpen = params.get(APPROVALS_PARAM) === APPROVALS_SETUP;
  const versionQuery = useScopeVersion(ctx);
  const version = versionQuery.data ?? null;
  const featuresQuery = useFeatures(ctx, version);
  const storiesQuery = useStories(ctx, version);
  const milestonesQuery = useMilestones(ctx, version);
  const features = featuresQuery.data?.items ?? EMPTY;
  const stories = storiesQuery.data?.items ?? EMPTY;
  const milestones = milestonesQuery.data?.items ?? EMPTY;
  // the plan is read in a few rounds: until then the step shows its frame with a placeholder, never "No features yet"
  const planLoading = versionQuery.isLoading || featuresQuery.isLoading || storiesQuery.isLoading || milestonesQuery.isLoading;
  const screens = useDesignScreens(ctx).data?.items ?? EMPTY;
  const opinion = useLatestSecondOpinion(ctx).data ?? null;
  const challenges = useChallenges(ctx, opinion?.id).data?.items ?? EMPTY;
  const policiesQuery = useApprovalPolicies(ctx);
  const policies = policiesQuery.data;
  const policiesLoading = policiesQuery.isLoading && !policies;
  const objective = useObjective(ctx).data ?? null;
  const threads = useScopeThreads(ctx).data?.items ?? EMPTY;
  const jobs = useScopeJobs(ctx);
  // the business analyst drafts the plan from the requirements when the step opens (scope.draft): it shows itself
  const drafting = Boolean(jobs.draft && ["queued", "claimed", "running"].includes(jobs.draft.status));
  // a milestone re-plan (an accepted second-opinion fix, or "Suggest milestones") still on its way: the lock waits for it
  const replanning = Boolean(jobs.suggest && ["queued", "claimed", "running"].includes(jobs.suggest.status));
  useJobRefresh(ctx, jobs.draft, DRAFT_SCHEMAS);
  const buildJobs = useBuildJobs(ctx).jobs;
  const open = useScopeOpen(ctx);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [apply, setApply] = useState<ApplyRequest | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [successWin, setSuccessWin] = useState<{ open: boolean; key: SuccessKey | null }>({ open: false, key: null });
  const screensReview = useScreensReview(ctx);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [editingFeatures, setEditingFeatures] = useState(false);
  const [editingMilestones, setEditingMilestones] = useState(false);

  const project = ctx.status === "ready" ? ctx.project : null;
  const permissions = WATCHED.filter((p) => ctx.can(p));
  const st = scopePageState({ stage: project?.stage ?? "business", version, permissions, buildJobs });

  // scope.open runs ONCE per project on entry: it applies the consequences of state that was already authorised
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!project || st.phase === "beforeStep" || opened.current === projectId) return;
    opened.current = projectId;
    open.mutate({ projectId }, { onError: (e: unknown) => setOpenError(scopeErrorMessage(e)) });
  }, [project, st.phase, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeApprovals = () => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete(APPROVALS_PARAM); return n; }, { replace: true });
    requestAnimationFrame(() => document.getElementById("scope-approvals-setup")?.focus());
  };

  // a change applied from the second opinion lands in the editor
  useEffect(() => { if (apply) setEditingFeatures(true); }, [apply]);

  const success = version?.successTargets ?? NO_TARGETS;
  const featureChecklist = useMemo(() => lockChecklist(features, stories, milestones, drafting), [features, stories, milestones, drafting]);
  const checklist = useMemo(() => [...featureChecklist, successLockItem(success)], [featureChecklist, success]);

  // loading, a missing project, an error and "not open yet" keep the step's frame (title, role line), like every step
  if (ctx.status === "loading") {
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} status={t("analysis.scope.view.loading", "Loading…")} statusTone="progress" role={ROLE} deliverable={DELIVERABLE}><Skeleton /></StepFrame>
      </div>
    );
  }
  if (ctx.status === "notFound") {
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} role={ROLE} deliverable={DELIVERABLE}>
          <Card>
            <EmptyState icon={<FileText size={28} strokeWidth={1.75} aria-hidden />} title={t("analysis.scope.view.notAvailable", "This project isn't available.")}
              action={<Link to="/projects" className="font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("analysis.scope.view.backToProjects", "Back to projects")}</Link>} />
          </Card>
        </StepFrame>
      </div>
    );
  }
  if (!project) {
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} status={t("analysis.scope.view.couldNotLoad", "Couldn't load")} statusTone="attention" role={ROLE} deliverable={DELIVERABLE}>
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink2">
            <span>{scopeErrorMessage(ctx.error)}</span>
            <Button size="sm" variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: scopeProjectKey(projectId) })}>{t("analysis.scope.retry", "Retry")}</Button>
          </div>
        </StepFrame>
      </div>
    );
  }

  if (st.phase === "beforeStep") {
    const stage = project.stage;
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} subject={project.name || undefined} status={t("analysis.scope.view.notStarted", "Not started yet")} statusTone="waiting"
          role={ROLE} deliverable={DELIVERABLE}
          primary={{ label: t("analysis.scope.view.openStep", "Open {step}", { step: stepName(stage) }), onClick: () => navigate(stepPath(projectId, stage)) }}>
          <Card>
            <EmptyState icon={<FileText size={28} strokeWidth={1.75} aria-hidden />} title={t("analysis.scope.view.beforeStep", "Scope & success opens once the goals and requirements are confirmed.")} />
          </Card>
        </StepFrame>
      </div>
    );
  }

  if (versionQuery.isError && !version) {
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} subject={project.name || undefined} status={t("analysis.scope.view.couldNotLoad", "Couldn't load")} statusTone="attention" role={ROLE} deliverable={DELIVERABLE}>
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink2">
            <span>{scopeErrorMessage(versionQuery.error)}</span>
            <Button size="sm" variant="ghost" onClick={() => void versionQuery.refetch()}>{t("analysis.scope.retry", "Retry")}</Button>
          </div>
        </StepFrame>
      </div>
    );
  }
  if (planLoading) {
    return (
      <div className={PAGE}>
        <StepFrame title={TITLE} subject={project.name || undefined} status={t("analysis.scope.view.loading", "Loading…")} statusTone="progress" role={ROLE} deliverable={DELIVERABLE}>
          <Skeleton />
        </StepFrame>
      </div>
    );
  }

  const included = features.filter((f) => f.priority !== "excluded");
  const designJob = jobs.design;
  const advisories: string[] = [];
  if (designJob && ["queued", "claimed", "running"].includes(designJob.status)) advisories.push(t("analysis.scope.advisory.screensDesigning", "The screens are still being designed. The scope locks without them."));
  const highOpen = challenges.filter((c) => c.severity === "high" && c.status === "open").length;
  if (highOpen) advisories.push(highOpen === 1
    ? t("analysis.scope.advisory.secondOpinionOne", "The solution architect's second opinion has an important point still open (under Details). You can lock anyway.")
    : t("analysis.scope.advisory.secondOpinionMany", "The solution architect's second opinion has {count} important points still open (under Details). You can lock anyway.", { count: highOpen }));
  if (!policiesLoading && (!policies || policies.stage === null || policies.production === null)) advisories.push(t("analysis.scope.advisory.approversMissing", "Who approves a release is not set up yet. You can set it up before the release."));
  const storyCount = attachedStoryCount(features, stories);
  const counts = { features: included.length, stories: storyCount, screens: screens.length };
  const objectiveText = objective?.text ?? null;
  const isLocked = st.phase !== "draft";
  const memberName = (id: string) => ctx.memberName(id);
  const openThreads = threads.filter((t) => t.status === "open" && t.commentCount > 0);
  const threadLabel = (th: { targetType: string; targetId: string }): string =>
    th.targetType === "feature" ? features.find((f) => f.id === th.targetId)?.name ?? t("analysis.scope.view.thread.feature", "Feature")
    : th.targetType === "story" ? stories.find((x) => x.id === th.targetId)?.text ?? t("analysis.scope.view.thread.story", "User story")
    : th.targetType === "screen" ? screens.find((x) => x.id === th.targetId)?.name ?? t("analysis.scope.view.thread.screen", "Screen")
    : th.targetType === "success" ? ((SUCCESS_KEYS as readonly string[]).includes(th.targetId) ? successShortName(th.targetId as SuccessKey) : t("analysis.scope.success.title", "Success & performance"))
    : milestones.find((m) => m.id === th.targetId)?.name ?? t("analysis.scope.view.thread.milestone", "Milestone");
  // the "Comments" chip opens the card of the first open thread whose item is on the page
  const openFirstThread = () => {
    for (const th of openThreads) {
      if (openScopeFeedback(scopeFeedbackTarget({ type: th.targetType, id: th.targetId }, threadLabel(th), isLocked))) return;
    }
  };
  const nowItems = nowChecklist({
    lockItems: featureChecklist,
    counts: { features: included.length, stories: storyCount, milestones: milestones.length },
    screens: {
      count: screens.length, reviewedAt: version?.screensReviewedAt ?? null,
      reviewedBy: version?.screensReviewedBy ? memberName(version.screensReviewedBy) : null,
      designing: Boolean(designJob && designJob.status !== "succeeded" && designJob.status !== "failed" && designJob.status !== "cancelled"),
    },
    success,
    openComments: { threads: openThreads.length, comments: openThreads.reduce((n, t) => n + t.commentCount, 0) },
    approvals: { loading: policiesLoading, stage: policySet(policies?.stage), production: policySet(policies?.production) },
    drafting: drafting && included.length === 0,
  });
  const lockMilestones = milestones.map((m) => ({ id: m.id, number: m.number, name: m.name, featureCount: m.featureRefs.length }));
  const draft = st.phase === "draft";
  const lockReason = draft ? (drafting && included.length === 0 && st.canLock ? t("analysis.scope.view.draftingPlan", "Your business analyst is drafting the plan") : lockDisabledReason(st.canLock, checklist, replanning)) : null;
  const lockReady = draft && version !== null;
  const canManageApprovals = ctx.can("release.manage-approvals");
  const markReviewed = (reviewed: boolean) => {
    if (!version) return;
    setReviewError(null);
    screensReview.mutate({ projectId, scopeVersionId: version.id, reviewed }, { onError: (e: unknown) => setReviewError(scopeErrorMessage(e)) });
  };

  // the five chips: what the plan needs (features, success) and the reminders (screens, comments, approvals)
  const chipState = (it: NowItem): StepChipState => (it.done ? "done" : it.id === "comments" ? "attention" : "todo");
  const chipAction = (it: NowItem): (() => void) | undefined => {
    switch (it.id) {
      case "features": {
        // the chip goes where the open condition is fixed: the milestones editor for placing / empty milestones
        const open = featureChecklist.find((x) => !x.ok)?.key;
        if (st.canEditMilestones && (open === "milestones" || open === "placed" || open === "empty")) {
          return () => { setEditingMilestones(true); requestAnimationFrame(() => goTo("scope-milestones")); };
        }
        return () => goTo("scope-features");
      }
      case "screens": return screens.length > 0 ? () => goTo("scope-screens") : undefined;
      case "success": return draft && st.canEditFeatures && version ? () => setSuccessWin({ open: true, key: null }) : () => goTo(SUCCESS_SECTION_ID);
      case "comments": return openThreads.length > 0 ? openFirstThread : undefined;
      case "approvals": return canManageApprovals && draft ? () => navigate(APPROVALS_SETUP_PATH(projectId)) : undefined;
    }
  };
  // the chip's short name (the checklist item's label without its "agreed" / "reviewed" / "set" / "resolved")
  const chipLabel = (id: NowItem["id"]): string => {
    switch (id) {
      case "features": return t("analysis.scope.view.chip.features", "Features");
      case "screens": return t("analysis.scope.view.chip.screens", "Screens");
      case "success": return t("analysis.scope.success.title", "Success & performance");
      case "comments": return t("analysis.scope.view.chip.comments", "Comments");
      case "approvals": return t("analysis.scope.approvals.title", "Approvals");
    }
  };
  // the value already says what is open ("6 to review", "4 open"): the chip only adds the opening sign
  const chips: StepChip[] = nowItems.map((it) => ({
    id: it.id, label: chipLabel(it.id), state: chipState(it), value: it.short, title: it.detail,
    onClick: chipAction(it), todoLabel: "",
  }));
  const working = agentLine(jobs.jobs);
  const locked = !draft;
  const lockedBy = version?.lockedByUserId ? memberName(version.lockedByUserId) : null;
  // "Ready to lock" / "2 things left"; a later version names itself ("Scope version 2 · ready to lock")
  const lockText = chipsStatusText(chips.filter((c) => c.id === "features" || c.id === "success"), t("analysis.scope.view.readyToLock", "ready to lock"));
  const status = draft
    ? (version && version.number > 1 ? `${scopeName(version.number)} · ${lockText}` : lockText.charAt(0).toUpperCase() + lockText.slice(1))
    : versionLine(version, memberName);
  const screensReviewed = nowItems.find((i) => i.id === "screens")?.done ?? false;
  // your part follows what your role may do: edit and lock, give feedback, or follow along
  const canFeedback = ctx.can("comment");
  const mayLock = ctx.can("scope.lock"), mayEdit = ctx.can("requirements.edit");
  const yourPart = mayLock && mayEdit ? t("analysis.scope.view.partLock", "review the screens, settle the targets, then lock the scope")
    : mayEdit ? t("analysis.scope.view.partEdit", "review the screens and settle the targets; the project team locks the scope")
    : canFeedback ? t("analysis.scope.view.partFeedback", "look through the plan and give feedback; the project team locks the scope")
    : t("analysis.scope.view.partFollow", "follow the plan; the project team locks the scope");


  const details = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6">
        <SummarySection objective={objectiveText} counts={countSummary(features, storyCount, screens.length, milestones.length)} />
        <SecondOpinionAside ctx={ctx} version={version} canDecide={st.canEditFeatures} onApply={setApply} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <LockCard ctx={ctx} projectId={projectId} phase={st.phase} versionId={version?.id ?? null} versionNumber={version?.number ?? null}
          lockedAt={version?.lockedAt ?? null} lockedBy={lockedBy}
          canLock={st.canLock} showUnlock={st.showUnlock} items={checklist} advisories={advisories} counts={counts} milestones={lockMilestones}
          replanning={replanning} />
        <ApprovalsEntry projectId={projectId} policies={policies ?? null} loading={policiesLoading} canManage={canManageApprovals} nameOf={memberName} />
        <NeededLater projectId={projectId} />
      </div>
    </div>
  );

  return (
    <div className={PAGE}>
      {openError && <p role="alert" className="mb-3 text-[13px] text-danger">{openError}</p>}
      {reviewError && <p role="alert" className="mb-3 text-[13px] text-danger">{reviewError}</p>}
      <ScopeFeedbackProvider locked={isLocked}>
        <StepFrame
          title={TITLE}
          subject={project.name}
          status={status}
          statusTone={locked ? "done" : working ? "progress" : lockReason ? "waiting" : "done"}
          role={ROLE}
          deliverable={DELIVERABLE}
          yourPart={yourPart}
          primary={draft ? {
            label: t("analysis.scope.lock.lockScope", "Lock the scope"), icon: <Lock size={16} aria-hidden />, onClick: () => setLockOpen(true),
            disabled: !lockReady || lockReason !== null, reason: lockReason ?? undefined,
          } : { label: t("analysis.scope.view.openStep", "Open {step}", { step: phaseName("engineering") }), href: boardPath(projectId) }}
          extras={<>
            <Button size="sm" variant="ghost" icon={<Share2 size={15} strokeWidth={1.75} aria-hidden />}
              onClick={() => setShare(scopeShareTarget(project.name, version?.id ?? null))}>{t("analysis.scope.header.share", "Share")}</Button>
          </>}
          chips={chips}
          agentLine={working ? <ScopeAgentLine text={working.text} progress={working.progress} running={working.running} /> : undefined}
          signedOff={locked ? {
            text: <>{signOffText({ verb: t("analysis.scope.view.lockedVerb", "{scope} locked", { scope: scopeName(version?.number) }), by: lockedBy, at: version?.lockedAt ?? null })} · {t("analysis.scope.view.approvedForBuilding", "approved for building")}
              {st.phase === "released" && <> · {t("analysis.scope.view.changesViaRequests", "changes now go through change requests on the")}{" "}
                <Link to={deliveredPath(projectId)} className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("analysis.scope.view.releasePage", "Release page")}</Link></>}</>,
            // the locked scope ends Business Analysis: the same "Open <next step>" link as every other step leads to
            // Software Engineering (the board is its first view)
            next: { label: t("analysis.scope.view.openStep", "Open {step}", { step: phaseName("engineering") }), href: boardPath(projectId) },
          } : undefined}
          details={details}
          detailsLabel={t("analysis.scope.view.details", "Details · assistant, second opinion, lock checklist, approvals")}
        >
          <div className="flex min-w-0 flex-col gap-6">
            {approvalsOpen && <ScopeApprovalsEditor projectId={projectId} onClose={closeApprovals} />}
            {locked && <ScopeChangesWaiting projectId={projectId} />}
            <div id="scope-features" tabIndex={-1} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
              {!editingFeatures && features.length > 0 && (
                <FeaturesPlan features={features} stories={stories} milestones={milestones} canEdit={st.canEditFeatures}
                  onEdit={() => setEditingFeatures(true)}
                  onPlace={st.canEditMilestones ? () => { setEditingMilestones(true); requestAnimationFrame(() => goTo("scope-milestones")); } : undefined} />
              )}
              {/* the editor stays mounted while the plan is shown, so its autosave always finishes */}
              <div hidden={!editingFeatures && features.length > 0}>
                {editingFeatures && (
                  <div className="mb-2 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => { setEditingFeatures(false); goTo("scope-features"); }}>{t("analysis.scope.view.doneEditing", "Done editing")}</Button>
                  </div>
                )}
                <FeaturesSection ctx={ctx} version={version} editable={st.canEditFeatures} readOnlyReason={st.readOnlyReason}
                  apply={apply} onApplyHandled={() => setApply(null)} drafting={drafting} />
              </div>
            </div>
            <div id="scope-screens" tabIndex={-1} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] space-y-3 outline-none">
              {screens.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-block bg-surface2 px-4 py-2.5 text-[13px] text-ink2">
                  <span className="min-w-0 flex-1">{nowItems.find((i) => i.id === "screens")?.detail}</span>
                  <Button size="sm" variant="ghost" icon={<Eye size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setPreview(0)}>{t("analysis.scope.view.preview", "Preview")}</Button>
                  {draft && st.canEditFeatures && (screensReviewed
                    ? <Button size="sm" variant="ghost" disabled={screensReview.isPending} onClick={() => markReviewed(false)}>{t("analysis.scope.view.notReviewed", "Not reviewed yet")}</Button>
                    : <Button size="sm" variant="secondary" icon={<CheckSquare size={14} aria-hidden />} disabled={screensReview.isPending} onClick={() => markReviewed(true)}>
                      {screensReview.isPending ? t("analysis.scope.saving", "Saving…") : t("analysis.scope.view.markReviewed", "Mark reviewed")}
                    </Button>)}
                </div>
              )}
              <ScreensSection ctx={ctx} locked={isLocked} preview={preview} onPreviewChange={setPreview} />
            </div>
            <div id="scope-milestones" tabIndex={-1} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
              {!editingMilestones && milestones.length > 0 && (
                <MilestonesPlan milestones={milestones} features={features} canEdit={st.canEditMilestones}
                  onEdit={() => { setEditingMilestones(true); requestAnimationFrame(() => goTo("scope-milestones")); }} />
              )}
              {/* the editor stays mounted while the plan is shown, so its autosave always finishes */}
              <div hidden={!editingMilestones && milestones.length > 0}>
                {editingMilestones && (
                  <div className="mb-2 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => { setEditingMilestones(false); goTo("scope-milestones"); }}>{t("analysis.scope.view.doneEditing", "Done editing")}</Button>
                  </div>
                )}
                <MilestonesSection ctx={ctx} version={version} editable={st.canEditMilestones} locked={isLocked} />
              </div>
            </div>
            <SuccessSection ctx={ctx} versionId={version?.id ?? null} targets={success} editable={draft && st.canEditFeatures && version !== null}
              locked={st.phase === "locked" || st.phase === "buildStarted" || st.phase === "released"}
              projectName={project.name} windowOpen={successWin.open} focusKey={successWin.key}
              onWindow={(o, k) => setSuccessWin({ open: o, key: k ?? null })} />
          </div>
        </StepFrame>
      </ScopeFeedbackProvider>
      {lockReady && version && (
        <LockDialog ctx={ctx} open={lockOpen} onClose={() => setLockOpen(false)} projectId={projectId} versionId={version.id} versionNumber={version.number}
          counts={counts} milestones={lockMilestones} advisories={advisories} replanning={replanning} />
      )}
      {/* the Change / Enhance drawer the released feature rows open */}
      <ChangeRequestLayer />
      <ShareDialog open={share !== null} onClose={() => setShare(null)} projectId={projectId} projectName={project.name} target={share} />
      <BlocksScopePrint data={{ projectName: project.name, clientName: project.clientName, lockedAt: isLocked ? version?.lockedAt ?? null : null, lockedBy: isLocked && version?.lockedByUserId ? memberName(version.lockedByUserId) : null, objective: objectiveText, versionNumber: version?.number ?? null, features, stories, milestones, screens, success }} />
    </div>
  );
}

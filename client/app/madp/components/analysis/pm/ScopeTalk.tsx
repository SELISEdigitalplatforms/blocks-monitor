/** "Agree and lock the scope": a short word from the business analyst and the Scope & success step's own lock card
 *  (LockCard + LockDialog, unchanged: the same checklist, advisories, permission and lock op). The inputs are read
 *  with the same hooks and worked out the same way as BlocksScopeView. */
import { useMemo } from "react";
import { useScopeContext } from "@/madp/blocks/scope/context";
import {
  useApprovalPolicies, useBuildJobs, useChallenges, useDesignScreens, useFeatures, useLatestSecondOpinion, useMilestones,
  useScopeJobs, useScopeVersion, useStories,
} from "@/madp/blocks/scope/hooks";
import type { WorkspacePermission } from "@/madp/domain/rbac";
import { emptyTargets } from "@/madp/domain/successTargets";
import { LockCard } from "@/madp/components/scope/blocks/LockCard";
import { successLockItem } from "@/madp/components/scope/blocks/nowChecklist";
import { attachedStoryCount, lockChecklist, planBeingDrafted, scopePageState } from "@/madp/components/scope/blocks/pageState";
import { PmSays } from "./Talk";
import { useT } from "@/madp/i18n";

const EMPTY: never[] = [];
const WATCHED: readonly WorkspacePermission[] = ["requirements.edit", "milestones.edit", "scope.lock", "comment", "release.manage-approvals"];
const NO_TARGETS = emptyTargets();

export function ScopeTalk({ projectId }: { projectId: string }) {
  const t = useT();
  const ctx = useScopeContext(projectId);
  const versionQuery = useScopeVersion(ctx);
  const version = versionQuery.data ?? null;
  const features = useFeatures(ctx, version).data?.items ?? EMPTY;
  const stories = useStories(ctx, version).data?.items ?? EMPTY;
  const milestones = useMilestones(ctx, version).data?.items ?? EMPTY;
  const screens = useDesignScreens(ctx).data?.items ?? EMPTY;
  const opinion = useLatestSecondOpinion(ctx).data ?? null;
  const challenges = useChallenges(ctx, opinion?.id).data?.items ?? EMPTY;
  const policiesQuery = useApprovalPolicies(ctx);
  const policies = policiesQuery.data;
  const policiesLoading = policiesQuery.isLoading && !policies;
  const jobs = useScopeJobs(ctx);
  const buildJobs = useBuildJobs(ctx).jobs;
  const success = version?.successTargets ?? NO_TARGETS;
  const drafting = Boolean(jobs.draft && ["queued", "claimed", "running"].includes(jobs.draft.status));
  const featureChecklist = useMemo(() => lockChecklist(features, stories, milestones, drafting), [features, stories, milestones, drafting]);
  const checklist = useMemo(() => [...featureChecklist, successLockItem(success)], [featureChecklist, success]);

  if (ctx.status === "loading" || versionQuery.isLoading) return <PmSays>{t("analysis.workspace.scope.opening", "Opening the scope…")}</PmSays>;
  if (ctx.status !== "ready" || !ctx.project) return <PmSays>{t("analysis.workspace.scope.openFailed", "I couldn't open the scope just now. Try again in a moment.")}</PmSays>;

  const project = ctx.project;
  const permissions = WATCHED.filter((p) => ctx.can(p));
  const st = scopePageState({ stage: project.stage, version, permissions, buildJobs });
  const replanning = Boolean(jobs.suggest && ["queued", "claimed", "running"].includes(jobs.suggest.status));
  const included = features.filter((f) => f.priority !== "excluded");
  const advisories: string[] = [];
  if (jobs.design && ["queued", "claimed", "running"].includes(jobs.design.status)) advisories.push(t("analysis.workspace.scope.screensDesigning", "The screens are still being designed. The scope locks without them."));
  const highOpen = challenges.filter((c) => c.severity === "high" && c.status === "open").length;
  if (highOpen) advisories.push(highOpen === 1
    ? t("analysis.workspace.scope.secondOpinionOne", "The solution architect's second opinion has an important point still open. You can lock anyway.")
    : t("analysis.workspace.scope.secondOpinionMany", "The solution architect's second opinion has {count} important points still open. You can lock anyway.", { count: highOpen }));
  if (!policiesLoading && (!policies || policies.stage === null || policies.production === null)) advisories.push(t("analysis.workspace.scope.approversMissing", "Who approves a release is not set up yet. You can set it up before the release."));
  const counts = { features: included.length, stories: attachedStoryCount(features, stories), screens: screens.length };
  const lockMilestones = milestones.map((m) => ({ id: m.id, number: m.number, name: m.name, featureCount: m.featureRefs.length }));
  const lockedBy = version?.lockedByUserId ? ctx.memberName(version.lockedByUserId) : null;
  const draft = st.phase === "draft";

  return (
    <div className="flex flex-col gap-3">
      <PmSays>
        {planBeingDrafted(drafting, included.length, milestones.length)
          ? t("analysis.workspace.scope.drafting", "I'm turning the approved requirements into features, user stories and milestones. They appear on the right as I go.")
          : draft
            ? t("analysis.workspace.scope.planDraft", "The plan has {features} in {milestones}. Check the features, screens, milestones and success targets on the right. When it all looks right, lock the scope and the team starts planning the work.", {
                features: included.length === 1 ? t("analysis.workspace.scope.oneFeature", "one feature") : t("analysis.workspace.scope.features", "{count} features", { count: included.length }),
                milestones: milestones.length === 1 ? t("analysis.workspace.scope.oneMilestone", "one milestone") : t("analysis.workspace.scope.milestones", "{count} milestones", { count: milestones.length }),
              })
            : t("analysis.workspace.scope.locked", "The scope is locked. The team plans the work on the board from here.")}
      </PmSays>
      <LockCard ctx={ctx} projectId={projectId} phase={st.phase} versionId={version?.id ?? null} versionNumber={version?.number ?? null}
        lockedAt={version?.lockedAt ?? null} lockedBy={lockedBy}
        canLock={st.canLock} showUnlock={st.showUnlock} items={checklist} advisories={advisories} counts={counts} milestones={lockMilestones}
        replanning={replanning} />
    </div>
  );
}

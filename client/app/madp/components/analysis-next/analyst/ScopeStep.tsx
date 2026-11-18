/** "Agree and lock the scope": a short word from the analyst and the Scope & success step's own lock card (LockCard +
 *  LockDialog, unchanged: the same checklist, advisories, permission and lock op), as in today's panel
 *  (analysis/pm/ScopeTalk.tsx). The inputs are read with the same hooks and worked out the same way as BlocksScopeView. */
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
import type { DocPart } from "../model";
import { AnalystSays, ErrorNote, PartLink } from "./Talk";
import { Working } from "./Working";
import { useScopeOpenError } from "../next/scopeOpen";
import { useT } from "@/madp/i18n";

const EMPTY: never[] = [];
const WATCHED: readonly WorkspacePermission[] = ["requirements.edit", "milestones.edit", "scope.lock", "comment", "release.manage-approvals"];
const NO_TARGETS = emptyTargets();

export function ScopeStep({ projectId, onPart }: { projectId: string; onPart: (part: DocPart) => void }) {
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
  const openError = useScopeOpenError(projectId);

  if (ctx.status === "loading" || versionQuery.isLoading) return <AnalystSays className="text-ink2">{t("analysis.analyst.scope.opening", "Opening the scope…")}</AnalystSays>;
  if (ctx.status !== "ready" || !ctx.project) {
    return <ErrorNote text={ctx.status === "notFound" ? t("analysis.analyst.scope.notFound", "I couldn't find this project's scope.") : t("analysis.analyst.scope.openFailed", "I couldn't open the scope just now. Try again in a moment.")} />;
  }

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
    <div className="flex flex-col gap-3.5">
      {openError && <ErrorNote text={openError} />}
      {/* the draft writes the features first and the milestones after them: no "0 milestones" while it is still at it */}
      {planBeingDrafted(drafting, included.length, milestones.length) ? (
        <Working text={t("analysis.analyst.scope.drafting", "I'm turning the approved requirements into features, user stories and milestones. They appear in the analysis as I go.")} />
      ) : draft ? (
        <>
          <AnalystSays>
            {t("analysis.analyst.scope.planHas", "The plan has {features} in {milestones}.", {
              features: included.length === 1 ? t("analysis.workspace.scope.oneFeature", "one feature") : t("analysis.workspace.scope.features", "{count} features", { count: included.length }),
              milestones: milestones.length === 1 ? t("analysis.workspace.scope.oneMilestone", "one milestone") : t("analysis.workspace.scope.milestones", "{count} milestones", { count: milestones.length }),
            })}
          </AnalystSays>
          <AnalystSays className="text-ink2">
            {t("analysis.analyst.scope.checkThe", "Check the")} <PartLink onClick={() => onPart("scope")}>{t("analysis.analyst.scope.linkFeatures", "features")}</PartLink>, <PartLink onClick={() => onPart("screens")}>{t("analysis.analyst.scope.linkScreens", "screens")}</PartLink>,{" "}
            <PartLink onClick={() => onPart("milestones")}>{t("analysis.analyst.scope.linkMilestones", "milestones")}</PartLink> {t("analysis.analyst.and", "and")} <PartLink onClick={() => onPart("success")}>{t("analysis.analyst.scope.linkSuccess", "success targets")}</PartLink>.
            {" "}{t("analysis.analyst.scope.lockHint", "When it all looks right, lock the scope and the team starts planning the work.")}
          </AnalystSays>
        </>
      ) : (
        <AnalystSays>{t("analysis.workspace.scope.locked", "The scope is locked. The team plans the work on the board from here.")}</AnalystSays>
      )}
      <div tabIndex={-1} data-analyst-action="" className="rounded-card outline-none focus:ring-2 focus:ring-accent/45">
        <LockCard ctx={ctx} projectId={projectId} phase={st.phase} versionId={version?.id ?? null} versionNumber={version?.number ?? null}
          lockedAt={version?.lockedAt ?? null} lockedBy={lockedBy}
          canLock={st.canLock} showUnlock={st.showUnlock} items={checklist} advisories={advisories} counts={counts} milestones={lockMilestones}
          replanning={replanning} />
      </div>
    </div>
  );
}

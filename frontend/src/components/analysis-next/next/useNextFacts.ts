/**
 * The facts behind "Next for you", read with the SAME hooks and worked out with the SAME rules as today's Business
 * Analysis page (src/components/analysis/*): the product manager's panel and its talks (BriefTalk, UnderstoodTalk,
 * QuestionsTalk, RequirementsTalk, ScopeTalk + LockCard). Front end only; no new reads: every query shares its cache key
 * with the page's own readers, and each step's reads are switched on only while the project is at that step (a hook
 * given no id or no workspace stays idle).
 */
import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/blocks/projects/reads";
import { useCan } from "@/blocks/projects/context";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "@/blocks/engine/types";
import { clarificationsOptions, latestAssistJob, useBusinessRefs, useRequirementsV1, useStepAccess } from "@/blocks/sanitization/hooks";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { useDesignBrief, useObjective, useRequirements } from "@/blocks/requirements/hooks";
import { useRequirementsExtras } from "@/blocks/requirements/extras";
import { useDesignContext } from "@/blocks/requirements/designContext";
import { useScopeContext } from "@/blocks/scope/context";
import { useBuildJobs, useFeatures, useMilestones, useScopeJobs, useScopeVersion, useStories } from "@/blocks/scope/hooks";
import type { WorkspacePermission } from "@/domain/rbac";
import { confirmBlockers } from "@/domain/requirements";
import { automaticDesignDirection, designSource, parseMakePrototype } from "@/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "@/domain/factoryDesign";
import { isLandingJob } from "@/domain/landingPage";
import { emptyTargets } from "@/domain/successTargets";
import { blockerKey, blockerText, type ConfirmBlocker } from "@/components/requirements/glance";
import { useLandingSection } from "@/components/requirements/LandingPageSection";
import { nowItems } from "@/components/requirements/goalsNow";
import { countPriorities } from "@/components/requirements/priority";
import { lockChecklist, planBeingDrafted, scopePageState } from "@/components/scope/blocks/pageState";
import { successLockItem } from "@/components/scope/blocks/nowChecklist";
import { understandingNow } from "@/components/sanitization/understandingModel";
import { jobView } from "@/components/sanitization/SanitizationStep";
import { fileCounts } from "@/components/understanding/model";
import { useAnalysisBrief } from "@/components/analysis/doc/briefQuery";
import { briefAnswers } from "@/components/analysis/pm/pmModel";
import { attachedLive, type AnalysisCtx } from "../model";
import type { NextFacts } from "./nextAction";
import { t } from "@/i18n";

/** A query whose answer is not in yet (an error counts as answered: it shows as trouble, not as loading). */
const pending = (q: { data: unknown; isError: boolean }) => q.data === undefined && !q.isError;
const ACTIVE = ["queued", "claimed", "running"];

interface Part<G> { loading: boolean; trouble: boolean; group?: G }

/** The facts for the step the project is at (the other steps' reads stay idle). */
export function useNextFacts(ctx: AnalysisCtx): NextFacts {
  const { step } = ctx;
  const project = useProject(ctx.projectId);
  // the job list is one read per project (kinds only filter it): the panel, the talks and the parts share it
  const jobsQ = useEngineJobs(ctx.projectId, ["sanitization.assist", "requirements.draft"]);
  const access = useStepAccess({ workspaceId: ctx.workspaceId ?? "", projectId: ctx.projectId });
  const asking = step === "understanding" || step === "sanitization";
  const askedQ = useQuery({ ...clarificationsOptions({ workspaceId: asking ? ctx.workspaceId ?? "" : "", projectId: ctx.projectId }) });

  const understanding = useUnderstandingPart(ctx, step === "understanding", project.data, askedQ, access.canEdit);
  const questions = useQuestionsPart(ctx, step === "sanitization", askedQ, jobsQ.data, pending(jobsQ), access.canEdit);
  const requirements = useRequirementsPart(ctx.projectId, step === "requirements", jobsQ.data, pending(jobsQ));
  const scope = useScopePart(ctx.projectId, step === "scope");

  const own: Part<unknown> =
    step === "understanding" ? understanding
    : step === "sanitization" ? questions
    : step === "requirements" ? requirements
    : step === "scope" ? scope
    : { loading: false, trouble: false };

  return {
    step,
    loading: own.loading,
    trouble: own.trouble,
    attachedLive: attachedLive(project.data ?? null),
    brief: understanding.group?.brief,
    understood: understanding.group?.understood,
    questions: questions.group,
    requirements: requirements.group,
    scope: scope.group,
  };
}

/* ── step "understanding": the objective and end users, and what I understood ── */

type AskedRow = { Question: string; Answer?: string | null; Status: string };

function useUnderstandingPart(
  ctx: AnalysisCtx, on: boolean, project: ReturnType<typeof useProject>["data"],
  askedQ: { data: unknown; isError: boolean }, canAnswer: boolean,
): Part<{ brief: NonNullable<NextFacts["brief"]>; understood: NonNullable<NextFacts["understood"]> }> {
  // the same reads as the analyst column (AnalystColumn): the brief and the answers to my own questions
  const briefQ = useAnalysisBrief(ctx.projectId, on && Boolean(project));
  const canConfirm = useCan("business.edit");
  if (!on) return { loading: false, trouble: false };
  if (project === undefined) return { loading: true, trouble: false };
  if (project === null) return { loading: false, trouble: true };
  if (pending(briefQ) || pending(askedQ)) return { loading: true, trouble: false };
  if (briefQ.isError || askedQ.isError) return { loading: false, trouble: true };

  const brief = briefQ.data!;
  // the column's rule (projectBrief briefAnswers, the facts every agent reads): the project's own fields, else the
  // answers to my own questions; what the reading or the business agent only found is not an answer
  const answers = briefAnswers({ name: project.name, goal: project.goal, users: project.targetUsers, asked: (askedQ.data ?? []) as AskedRow[] });
  const files = fileCounts(brief.attachmentStatus);
  return {
    loading: false, trouble: false,
    group: {
      brief: { missing: answers.missing.length, canAnswer },
      understood: {
        filesReading: files.reading,
        filesFailed: files.failed,
        conflicts: brief.conflicts.filter((c) => !c.resolution).length,
        confirmed: Boolean(brief.confirmedAt),
        canConfirm,
      },
    },
  };
}

/* ── step "sanitization": my questions, then the step's own next move ── */

function useQuestionsPart(
  ctx: AnalysisCtx, on: boolean, askedQ: { data: unknown; isError: boolean },
  jobs: EngineJob[] | undefined, jobsPending: boolean, canEdit: boolean,
): Part<NonNullable<NextFacts["questions"]>> {
  const sctx = { workspaceId: on ? ctx.workspaceId ?? "" : "", projectId: ctx.projectId };
  const v1 = useRequirementsV1(sctx);
  const business = useBusinessRefs(sctx);
  if (!on) return { loading: false, trouble: false };
  if (pending(askedQ) || jobsPending || business.isLoading || (!v1.isError && (v1.requirements === undefined || !v1.objectiveLoaded))) {
    return { loading: true, trouble: false };
  }
  if (askedQ.isError) return { loading: false, trouble: true };

  // the same counts and rules as QuestionsTalk (understandingNow decides the move once none is open)
  const rows = (askedQ.data ?? []) as { Status: string }[];
  const counts = {
    open: rows.filter((r) => r.Status === "open").length,
    answered: rows.filter((r) => r.Status === "answered").length,
    deferred: rows.filter((r) => r.Status === "deferred").length,
  };
  const list = jobs ?? [];
  const questionsJob = jobView(latestAssistJob(list, "clarifications"));
  const draftJob = jobView(latestEngineJob(list.filter((j) => !isLandingJob(j)), "requirements.draft"));
  const refs = business.refs ?? [];
  const now = understandingNow({
    existing: ctx.type === "brownfield", completed: false, canEdit,
    notes: refs.filter((r) => r.type === "note").length, files: refs.filter((r) => r.type === "file").length,
    questions: counts, requirements: (v1.requirements ?? []).length, hasObjective: !!v1.objective?.Statement?.trim(),
    questionsJob, draftJob,
  });
  return {
    loading: false, trouble: false,
    group: {
      open: counts.open,
      next: now.primary.kind,
      readFailed: questionsJob.state === "failed" || questionsJob.state === "cancelled",
      stopped: now.stopped ?? null,
      canEdit,
    },
  };
}

/* ── step "requirements": the approval's blockers, exactly as RequirementsTalk / RequirementsPage ── */

function useRequirementsPart(
  projectId: string, on: boolean, jobs: EngineJob[] | undefined, jobsPending: boolean,
): Part<NonNullable<NextFacts["requirements"]>> {
  const id = on ? projectId : null;
  const rctx = useRequirementsContext(id);
  const reqs = useRequirements(id);
  const objective = useObjective(id);
  const designBrief = useDesignBrief(id);
  const extras = useRequirementsExtras(id, rctx.project?.setup);
  const landing = useLandingSection(id ?? "");
  const designIntent = useDesignContext(id ?? "");
  if (!on) return { loading: false, trouble: false };

  const requirements = reqs.data ?? [];
  const brief = designBrief.data ?? null;
  const designRequirements = requirements.map((r) => ({ key: r.key || r.id, title: r.title, text: r.detail, criteria: r.criteria }));
  const parsedDesign = parseProductPrototype(brief?.prototypeJson);
  const factoryDesign = parsedDesign?.provider !== "figma-make" ? parsedDesign : null;
  const waitingForIntent = brief?.mode === "figma" && !!factoryDesign && pending(designIntent);
  if (pending(reqs) || pending(objective) || pending(designBrief) || jobsPending || extras.loading || waitingForIntent) {
    return { loading: true, trouble: false };
  }
  if (reqs.isError || objective.isError || designBrief.isError) return { loading: false, trouble: true };

  const obj = objective.data ?? null;
  const landingOpen = landing.review === "preparing" || landing.review === "review";
  const blockers = confirmBlockers({ requirements, objective: obj, designBrief: brief, landingPageOpen: landingOpen } as never) as unknown as ConfirmBlocker[];
  // the design must match today's requirements. Today's page also counts a re-read of the design source (every 10 s)
  // as "not current"; here the last answer stands while it is re-read, so the card does not flicker.
  const designCurrent = brief?.mode === "figma" && (factoryDesign
    ? !designIntent.isError && designSourceCurrent(factoryDesign.source, designIntent.data)
    : parseMakePrototype(brief.prototypeJson)?.source === designSource(automaticDesignDirection(designRequirements), designRequirements));
  if (!designCurrent && !blockers.some((b) => blockerKey(b) === "design")) blockers.push({ code: "design_not_confirmed" });
  const reasons = [...new Set(blockers.map((b) => (blockerKey(b) === "design" ? t("analysis.workspace.req.reviewDesign", "Review and approve the interactive product design.") : blockerText(b))))];
  const openItems = nowItems({
    objective: obj, priorities: countPriorities(requirements),
    workflows: extras.byKind.workflow.length, exclusions: extras.byKind.exclusion.length, constraints: extras.byKind.constraint.length,
    openComments: 0,
  }).filter((i) => !i.done).length;
  // the same job RequirementsPage watches: an active requirements.draft (not the landing page's)
  const job = (jobs ?? []).find((j) => j.kind === "requirements.draft" && !isLandingJob(j) && ACTIVE.includes(j.status)) ?? null;
  const drafting = job ? (/"purpose"\s*:\s*"suggestions"/.test(job.inputJson ?? "") ? "review" : "draft") : null;
  return {
    loading: false, trouble: false,
    group: { drafting, count: requirements.length, blockers: reasons, openItems, canApprove: Boolean(rctx.canEditRequirements) },
  };
}

/* ── step "scope": the lock's checklist, exactly as ScopeTalk + LockCard ── */

const WATCHED: readonly WorkspacePermission[] = ["requirements.edit", "milestones.edit", "scope.lock", "comment", "release.manage-approvals"];
const NO_TARGETS = emptyTargets();

function useScopePart(projectId: string, on: boolean): Part<NonNullable<NextFacts["scope"]>> {
  const sc = useScopeContext(on ? projectId : "");
  const versionQ = useScopeVersion(sc);
  const version = versionQ.data ?? null;
  const featuresQ = useFeatures(sc, version);
  const storiesQ = useStories(sc, version);
  const milestonesQ = useMilestones(sc, version);
  const jobs = useScopeJobs(sc);
  const build = useBuildJobs(sc);
  if (!on) return { loading: false, trouble: false };
  if (sc.status === "loading" || pending(versionQ)) return { loading: true, trouble: false };
  if (sc.status !== "ready" || !sc.project || versionQ.isError) return { loading: false, trouble: true };
  if ((version && (pending(featuresQ) || pending(storiesQ) || pending(milestonesQ))) || jobs.isLoading || build.isLoading) {
    return { loading: true, trouble: false };
  }
  if (featuresQ.isError || storiesQ.isError || milestonesQ.isError) return { loading: false, trouble: true };

  const features = featuresQ.data?.items ?? [];
  const stories = storiesQ.data?.items ?? [];
  const milestones = milestonesQ.data?.items ?? [];
  const st = scopePageState({ stage: sc.project.stage, version, permissions: WATCHED.filter((p) => sc.can(p)), buildJobs: build.jobs });
  // the scope's own copy of the project has not caught up with the step yet: wait, never a wrong "ask the team"
  if (st.phase === "beforeStep") return { loading: true, trouble: false };
  const active = (j: EngineJob | null) => Boolean(j && isActiveEngineJob(j));
  const checklist = [...lockChecklist(features, stories, milestones, active(jobs.draft)), successLockItem(version?.successTargets ?? NO_TARGETS)];
  const included = features.filter((f) => f.priority !== "excluded");
  return {
    loading: false, trouble: false,
    group: {
      // the draft writes the features, then the milestones: never "Add at least one milestone" before they are in
      drafting: planBeingDrafted(active(jobs.draft), included.length, milestones.length),
      replanning: active(jobs.suggest),
      locked: st.phase === "locked" || st.phase === "buildStarted" || st.phase === "released",
      blockers: checklist.filter((i) => !i.ok).map((i) => i.text),
      canLock: st.canLock,
    },
  };
}

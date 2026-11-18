/** The collapsed-row summaries of the first five parts, each `use<Name>Summary(ctx)`. They read the SAME queries
 *  today's parts read (src/components/analysis/doc/*: same query keys, so one cached copy and no extra request), and
 *  hand plain values to the pure summaries (./summaries.ts). Queries a part does not need yet stay off until its step. */
import { useQuery } from "@tanstack/react-query";
import { useCan } from "@/madp/blocks/projects/context";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { isLandingJob } from "@/madp/domain/landingPage";
import { useProject } from "@/madp/blocks/projects/reads";
import { useDocNoteBody, useDocTree } from "@/madp/blocks/projects/docReads";
import { sharedNoteCount } from "@/madp/components/business/setupChips";
import { useActiveWorkspaceId, useRequirementsContext } from "@/madp/blocks/requirements/context";
import { useRequirementsExtras } from "@/madp/blocks/requirements/extras";
import { requirementsQueryOptions, suggestionsQueryOptions, useItemVersionsMeta, useObjective } from "@/madp/blocks/requirements/hooks";
import type { SuggestionRow } from "@/madp/blocks/requirements/records";
import { clarificationsOptions } from "@/madp/blocks/sanitization/hooks";
import { OBJECTIVE_ITEM_KEY } from "@/madp/domain/requirements";
import { useSetup } from "@/madp/components/sanitization/UnderstoodSection";
import { detailsFromRow } from "@/madp/domain/setupDetails";
import { fileCounts, fileState } from "@/madp/components/understanding/model";
import { useAnalysisBrief } from "@/madp/components/analysis/doc/briefQuery";
import { partOpen } from "@/madp/components/analysis/model";
import { attachedLive, type AnalysisCtx, type PartSummary } from "../../model";
import type { AskedRow } from "@/madp/domain/projectBrief";
import {
  featuresSummary, filesSummary, objectiveSummary, requirementsApproved, selectFeatureItems, understandingSigned, understoodAnswers,
  understoodSummary, workflowsSummary, type WorkflowItem,
} from "./summaries";

export { requirementsApproved, understandingSigned };

/** An existing product attached to the Factory as it is live (the shared project read; false while it loads). */
export function useAttachedLive(projectId: string): boolean {
  return attachedLive(useProject(projectId).data ?? null);
}

const DRAFT_JOBS = ["requirements.draft"] as const;

/** The requirements (objective, master features, workflows) are being written right now: a requirements.draft job,
 *  not the landing page's, is queued, claimed or running. The project's one job list (every kinds list shares it). */
export function useRequirementsDrafting(projectId: string, open: boolean): boolean {
  const jobs = useEngineJobs(open ? projectId : null, DRAFT_JOBS).data;
  return (jobs ?? []).some((j) => !isLandingJob(j) && isActiveEngineJob(j));
}

/** The lines of "What we understood": what it is about (the description, else the reading's), and the objective and
 *  the users from the facts every agent reads and the checklist marks (understoodAnswers: the project's own fields,
 *  else the answers to the business analyst's own questions; the objective last the drafted objective statement). */
export function useUnderstoodLines({ projectId, workspaceId, step, type }: AnalysisCtx) {
  const open = partOpen("understood", step);
  const project = useProject(projectId).data ?? null;
  const briefQ = useAnalysisBrief(projectId, open);
  const setup = useSetup(workspaceId ?? "", projectId);
  // the same reads as the analyst column (the answers to my own questions) and the Objective part (the drafted statement)
  const claO = clarificationsOptions({ workspaceId: workspaceId ?? "", projectId });
  const asked = useQuery({ ...claO, enabled: claO.enabled && open });
  const objectiveQ = useObjective(projectId);
  const brief = briefQ.data ?? null;
  const row = setup.row;
  const existing = type === "brownfield";
  const first = (...xs: (string | null | undefined)[]) => xs.map((x) => (x ?? "").trim()).find(Boolean) ?? "";
  const about = first(setup.brief, brief?.project.desiredOutcome);
  const { objective, users } = understoodAnswers({
    name: project?.name ?? "",
    goal: first(project?.goal, row?.Goal), users: first(project?.targetUsers, row?.TargetUsers),
    asked: (asked.data ?? []) as AskedRow[], objectiveStatement: objectiveQ.data?.text ?? "",
  });
  const d = detailsFromRow((row ?? {}) as Record<string, unknown>);
  const changes = existing ? [...d.changeTags, d.intendedChanges.trim()].map((c) => c.replace(/[.;]+$/, "").trim()).filter(Boolean) : [];
  // from the project setup: the setup's own answers (not the brief, which names its sources itself)
  const fromSetup = Boolean(setup.brief.trim() || (row?.Goal ?? "").trim() || (row?.TargetUsers ?? "").trim() || project?.goal.trim() || project?.targetUsers.trim());
  return {
    open, brief, briefQ, existing, about, objective, users, changes, fromSetup,
    loading: open && !brief && !row && !project,
  };
}

export function useUnderstoodSummary(ctx: AnalysisCtx): PartSummary {
  const u = useUnderstoodLines(ctx);
  const canEdit = useCan("business.edit");
  const brief = u.brief;
  const signed = understandingSigned(brief, ctx.step);
  const reqs = brief?.features.flatMap((f) => [...f.confirmedRequirements, ...f.proposedRequirements]) ?? [];
  const toCheck = brief?.features.reduce((n, f) => n + f.proposedRequirements.length, 0) ?? 0;
  const conflicts = brief?.conflicts ?? [];
  const reading = brief?.attachmentStatus.filter((f) => ["processing", "pending"].includes(fileState(f.status))).length ?? 0;
  const live = useAttachedLive(ctx.projectId);
  const sources = [
    ...(u.fromSetup ? ["Your project setup"] : []),
    ...reqs.flatMap((r) => r.sources ?? []),
    ...conflicts.flatMap((c) => c.sources),
  ];
  return understoodSummary({
    open: u.open, loading: u.loading, signed, canAct: canEdit,
    about: u.about, objective: u.objective, users: u.users,
    conflictsOpen: conflicts.filter((c) => !c.resolution).length, toCheck, reading, sources,
    filesRead: fileCounts(brief?.attachmentStatus ?? []).read, changes: u.changes, live,
    content: [u.about, u.objective, u.users, u.changes, conflicts.map((c) => [c.key, c.resolution]), reqs.map((r) => [r.id, r.basis]), brief?.confirmedAt ?? null],
  });
}

/** The notes the person shared, counted as Project setup's Material chip counts them (setupChips sharedNoteCount: every
 *  note besides the Project brief, the scratch pad once it has text), from the same tree and scratch pad reads as
 *  Project setup (one cached copy). null while they load; 0 when they can't be read (the files alone are then shown). */
export function useSharedNotes(projectId: string): number | null {
  const tree = useDocTree(projectId);
  const scratchId = tree.data?.scratch?.id ?? null;
  const scratch = useDocNoteBody(scratchId);
  if (tree.error) return 0;
  if (!tree.data) return null;
  if (scratchId && scratch.isLoading) return null;
  // as Project setup reads it (SetupChecklistCard): a scratch pad whose text can't be read counts as written
  const scratchHasText = Boolean(scratchId) && (scratch.data == null || (scratch.data.bodyMd ?? "").trim() !== "");
  return sharedNoteCount(tree.data, scratchHasText);
}

export function useFilesSummary({ projectId, step }: AnalysisCtx): PartSummary {
  const open = partOpen("files", step);
  const briefQ = useAnalysisBrief(projectId, open);
  const canEdit = useCan("business.edit");
  const live = useAttachedLive(projectId);
  const notes = useSharedNotes(projectId);
  const brief = briefQ.data ?? null;
  return filesSummary({
    open, loading: (!brief && !briefQ.isError) || (!!brief && notes === null), error: !brief && briefQ.isError,
    signed: understandingSigned(brief, step), canAct: canEdit, files: brief?.attachmentStatus ?? [], live, notes: notes ?? 0,
  });
}

export function useObjectiveSummary({ projectId, step }: AnalysisCtx): PartSummary {
  const open = partOpen("objective", step);
  const rctx = useRequirementsContext(projectId);
  const objective = useObjective(projectId);
  const meta = useItemVersionsMeta(projectId);
  const drafting = useRequirementsDrafting(projectId, open);
  const live = useAttachedLive(projectId);
  const rec = objective.data ?? null;
  return objectiveSummary({
    open, loading: objective.isLoading,
    approved: requirementsApproved(step, rctx.project?.requirementsConfirmedAt),
    canAct: rctx.open && Boolean(rctx.canEditRequirements),
    text: rec?.text ?? "", criteria: rec?.criteria ?? [],
    origin: meta.data?.byKey.get(OBJECTIVE_ITEM_KEY)?.[0]?.origin ?? null,
    drafting, live,
  });
}

const countOpen = (rows: readonly SuggestionRow[]) => rows.filter((r) => (r.Status ?? "open") === "open").length;
const answeredIds = (rows: readonly { ItemId: string }[]) => rows.map((r) => r.ItemId);

export function useFeaturesSummary({ projectId, workspaceId, step }: AnalysisCtx): PartSummary {
  const open = partOpen("features", step);
  const ws = useActiveWorkspaceId();
  const rctx = useRequirementsContext(projectId);
  const reqO = requirementsQueryOptions(ws, projectId);
  const reqs = useQuery({ ...reqO, enabled: reqO.enabled && open, select: selectFeatureItems });
  const sugO = suggestionsQueryOptions(ws, projectId);
  const openSuggestions = useQuery({ ...sugO, enabled: sugO.enabled && open, select: countOpen });
  // the answered questions a requirement names in its sources (the same query as the questions in the conversation)
  const claO = clarificationsOptions({ workspaceId, projectId });
  const answers = useQuery({ ...claO, enabled: claO.enabled && open, select: answeredIds });
  const brief = useAnalysisBrief(projectId, open).data ?? null;
  const drafting = useRequirementsDrafting(projectId, open);
  const live = useAttachedLive(projectId);
  return featuresSummary({
    open, loading: reqs.isLoading,
    approved: requirementsApproved(step, rctx.project?.requirementsConfirmedAt),
    canAct: rctx.open && Boolean(rctx.canEditRequirements),
    requirements: reqs.data ?? [], openSuggestions: openSuggestions.data ?? 0,
    known: {
      files: new Map((brief?.attachmentStatus ?? []).map((f) => [f.fileId, f.name])),
      answers: new Set(answers.data ?? []),
    },
    drafting, live,
  });
}

export function useWorkflowsSummary({ projectId, step }: AnalysisCtx): PartSummary {
  const open = partOpen("workflows", step);
  const rctx = useRequirementsContext(projectId);
  const extras = useRequirementsExtras(projectId, rctx.project?.setup);
  const drafting = useRequirementsDrafting(projectId, open);
  const live = useAttachedLive(projectId);
  const items: WorkflowItem[] = [...extras.byKind.workflow, ...extras.byKind.constraint, ...extras.byKind.exclusion]
    .map((e) => ({ id: e.id, kind: e.kind, title: e.title, who: e.who, steps: e.steps, origin: e.origin }));
  return workflowsSummary({
    open, loading: extras.loading,
    approved: requirementsApproved(step, rctx.project?.requirementsConfirmedAt),
    items, drafting, live,
  });
}

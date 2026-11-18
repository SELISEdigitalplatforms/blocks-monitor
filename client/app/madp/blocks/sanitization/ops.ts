// Product sanitization writes: one typed mutation per op of the Logic Function "project".
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { callFunction, newRequestId, useFunctionMutation, type FunctionMutationConfig, type FunctionResult } from "../fn";
import { blocksKeys } from "../data/keys";
import type {
  AssistArgs, BriefAnswerArgs, ClarificationAnswerArgs, ClarificationDeferArgs, ClarificationDeleteArgs, ClarificationReopenArgs,
  ClarificationSaveArgs, ClarificationSaveResult, CommentAddArgs, CommentAddResult, CommentDeleteArgs, CompleteArgs,
  CompleteResult, DecisionDeleteArgs, DecisionDeleteResult, DecisionSaveArgs, DecisionSaveResult, DraftInitialArgs, IdResult,
  InitialRequirementsSaveArgs, InitialRequirementsSaveResult, JobCreateResult, ObjectiveRow, RequirementRow, SanitizationCtx,
  TechDecisionDeleteArgs, TechDecisionSaveArgs, TechDecisionSaveResult,
} from "./types";

export type SanitizationOp =
  | "clarification.save" | "clarification.answer" | "clarification.defer" | "clarification.reopen" | "clarification.delete"
  | "clarification.answerBrief"
  | "decision.save" | "decision.delete"
  | "techDecision.save" | "techDecision.delete"
  | "discussion.add" | "discussion.delete"
  | "initialRequirements.save"
  | "sanitization.complete" | "sanitization.draftInitial" | "sanitization.assist";

/** The schemas an op changes (their cached reads are invalidated). */
export const SANITIZATION_OP_SCHEMAS: Readonly<Record<SanitizationOp, readonly string[]>> = {
  "clarification.save": ["Clarification"],
  // the answer that handles the last open question queues the first requirements draft (functions/…/autoDraft.ts)
  "clarification.answer": ["Clarification", "EngineJob", "Attachment"],
  "clarification.defer": ["Clarification", "EngineJob"],
  // the brief answer may queue the requirements draft or its refresh, like the last answer does
  "clarification.answerBrief": ["Clarification", "EngineJob"],
  "clarification.reopen": ["Clarification"],
  "clarification.delete": ["Clarification"],
  "decision.save": ["Decision"],
  "decision.delete": ["Decision"],
  "techDecision.save": ["TechDecision"],
  "techDecision.delete": ["TechDecision"],
  "discussion.add": ["FeedbackThread", "FeedbackComment"],
  "discussion.delete": ["FeedbackComment"],
  "initialRequirements.save": [],
  "sanitization.complete": ["Project", "ItemVersion", "Requirement", "Objective"],
  "sanitization.draftInitial": ["EngineJob"],
  "sanitization.assist": ["EngineJob"],
};

export function sanitizationMutationConfig<TArgs, TData>(
  op: SanitizationOp,
  workspaceId: string | null,
): FunctionMutationConfig<TArgs, TData> {
  return {
    fn: "project",
    op,
    invalidate: workspaceId ? SANITIZATION_OP_SCHEMAS[op].map((s) => blocksKeys.schema(workspaceId, s)) : [],
  };
}

const op = <A extends Record<string, unknown>, R>(name: SanitizationOp, ctx: SanitizationCtx) =>
  useFunctionMutation<A, R>(sanitizationMutationConfig<A, R>(name, ctx.workspaceId));

export const useSaveClarification = (ctx: SanitizationCtx) => op<ClarificationSaveArgs, ClarificationSaveResult>("clarification.save", ctx);
export const useAnswerClarification = (ctx: SanitizationCtx) => op<ClarificationAnswerArgs, ClarificationSaveResult>("clarification.answer", ctx);
/** Step 1 of Business Analysis after the hand-over: the objective or the users, one call, one record. */
export const useAnswerBrief = (ctx: SanitizationCtx) => op<BriefAnswerArgs, ClarificationSaveResult>("clarification.answerBrief", ctx);
export const useDeferClarification = (ctx: SanitizationCtx) => op<ClarificationDeferArgs, ClarificationSaveResult>("clarification.defer", ctx);
export const useReopenClarification = (ctx: SanitizationCtx) => op<ClarificationReopenArgs, ClarificationSaveResult>("clarification.reopen", ctx);
export const useDeleteClarification = (ctx: SanitizationCtx) => op<ClarificationDeleteArgs, IdResult>("clarification.delete", ctx);
export const useSaveDecision = (ctx: SanitizationCtx) => op<DecisionSaveArgs, DecisionSaveResult>("decision.save", ctx);
export const useDeleteDecision = (ctx: SanitizationCtx) => op<DecisionDeleteArgs, DecisionDeleteResult>("decision.delete", ctx);
export const useSaveTechDecision = (ctx: SanitizationCtx) => op<TechDecisionSaveArgs, TechDecisionSaveResult>("techDecision.save", ctx);
export const useDeleteTechDecision = (ctx: SanitizationCtx) => op<TechDecisionDeleteArgs, IdResult>("techDecision.delete", ctx);
export const useAddComment = (ctx: SanitizationCtx) => op<CommentAddArgs, CommentAddResult>("discussion.add", ctx);
export const useDeleteComment = (ctx: SanitizationCtx) => op<CommentDeleteArgs, IdResult>("discussion.delete", ctx);
export const useCompleteSanitization = (ctx: SanitizationCtx) => op<CompleteArgs, CompleteResult>("sanitization.complete", ctx);
export const useDraftInitial = (ctx: SanitizationCtx) => op<DraftInitialArgs, JobCreateResult>("sanitization.draftInitial", ctx);
export const useAskMadp = (ctx: SanitizationCtx) => op<AssistArgs, JobCreateResult>("sanitization.assist", ctx);

const bySort = (a: RequirementRow, b: RequirementRow) =>
  (a.SortOrder ?? 0) - (b.SortOrder ?? 0) || a.Number - b.Number || (a.ItemId < b.ItemId ? -1 : a.ItemId > b.ItemId ? 1 : 0);

/** Writes the saved rows into the cached Requirement and Objective reads: replace by ItemId, append new, drop removed, re-sort. */
export function mergeSavedRequirements(
  client: QueryClient,
  workspaceId: string,
  result: InitialRequirementsSaveResult,
  projectId?: string,
): void {
  const removed = new Set(result.removed);
  client.setQueriesData<RequirementRow[]>({ queryKey: blocksKeys.schema(workspaceId, "Requirement") }, (old) => {
    if (!old) return old;
    const next = new Map(old.filter((r) => !removed.has(r.ItemId)).map((r) => [r.ItemId, r]));
    for (const r of result.requirements) if (!projectId || r.ProjectId === projectId) next.set(r.ItemId, r);
    return [...next.values()].sort(bySort);
  });
  if (result.objective) {
    const obj: ObjectiveRow = result.objective;
    client.setQueriesData<ObjectiveRow[]>({ queryKey: blocksKeys.schema(workspaceId, "Objective") }, (old) => {
      if (!old) return old;
      return old.some((o) => o.ItemId === obj.ItemId) ? old.map((o) => (o.ItemId === obj.ItemId ? obj : o)) : [...old, obj];
    });
  }
}

export interface SaveRequirementsVars {
  args: InitialRequirementsSaveArgs;
  /** One id per user action: a Retry of the same flush reuses it. */
  requestId: string;
}

export const newSaveRequirementsVars = (args: InitialRequirementsSaveArgs): SaveRequirementsVars => ({ args, requestId: newRequestId() });

export function useSaveInitialRequirements(ctx: SanitizationCtx) {
  const client = useQueryClient();
  return useMutation<FunctionResult<InitialRequirementsSaveResult>, Error, SaveRequirementsVars>({
    mutationFn: ({ args, requestId }) =>
      callFunction<InitialRequirementsSaveResult>("project", "initialRequirements.save", args, { requestId }),
    retry: 0,
    onSuccess: (res) => {
      if (ctx.workspaceId) mergeSavedRequirements(client, ctx.workspaceId, res.data, ctx.projectId);
    },
  });
}

export type { QueryKey };

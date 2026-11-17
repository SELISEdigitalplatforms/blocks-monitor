// Scope writes: one hook per op of the Logic Function `project` (fn.ts is the only write path).
// One mutate = one user action = one requestId. The answer rows go straight into the cache (read-your-write),
// then the touched schemas are invalidated in the background.
import { useMutation, type QueryClient, type QueryKey, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { callFunction, FunctionError, functionMutationOptions, type createFunctionCaller, type FunctionResult } from "../fn";
import { queryClient } from "../queryClient";
import { blocksKeys } from "../data/keys";
import { isEngineJobQuery } from "../engine/actions";
import { scopeProjectKey, type ScopeContext } from "./context";
import { deliveryProjectKey } from "../delivery/context";
import { mergeRows, type Row } from "./cache";
import { projectFromRow, type ProjectRecord, type ScopeFeedbackTarget } from "./records";
import type { WorkspacePermission } from "../../domain/rbac";
import { scopeErrorMessage } from "./messages";

export type { Row };

export const SCOPE_SCHEMAS = {
  version: "ScopeVersion",
  feature: "Feature",
  story: "Story",
  milestone: "Milestone",
  project: "Project",
  job: "EngineJob",
  secondOpinion: "SecondOpinion",
  challenge: "Challenge",
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
} as const;

const S = SCOPE_SCHEMAS;

/**
 * The permission scope.feedback.setStatus needs on top of membership (the server rule of functions/project/ops/scope/feedback.ts):
 * feature, story, milestone and success target -> scope.lock, screen -> design.edit. "comment" alone (a viewer) cannot resolve.
 */
export const FEEDBACK_RESOLVE_PERMISSION: Readonly<Record<ScopeFeedbackTarget, WorkspacePermission>> = {
  feature: "scope.lock",
  story: "scope.lock",
  milestone: "scope.lock",
  success: "scope.lock",
  screen: "design.edit",
};

export const SCOPE_WRITE_OPS = [
  "scope.open",
  "scope.save",
  "milestones.save",
  "milestones.suggest",
  "scope.grill",
  "scope.challenge.decide",
  "scope.challenge.undo",
  "scope.lock",
  "scope.unlock",
  "scope.feedback.add",
  "scope.feedback.setStatus",
  "scope.attachment.presign",
  "scope.attachment.commit",
  "scope.attachment.delete",
  "scope.success.save",
  "scope.success.ask",
  "scope.screens.review",
] as const;
export type ScopeWriteOp = (typeof SCOPE_WRITE_OPS)[number];

/** The schemas each op touches: these query families are invalidated after it succeeds. */
export const SCOPE_OP_SCHEMAS: Record<ScopeWriteOp, readonly string[]> = {
  "scope.open": [S.job, S.version, S.project],
  "scope.save": [S.version, S.feature, S.story, S.milestone],
  "milestones.save": [S.milestone],
  "milestones.suggest": [S.job],
  "scope.grill": [S.job],
  // an accepted fix that moves work between milestones queues milestones.suggest: the job list is read again so the
  // page sees the re-plan running and re-reads the milestones when it finishes
  "scope.challenge.decide": [S.challenge, S.job],
  "scope.challenge.undo": [S.challenge],
  "scope.lock": [S.version, S.milestone, S.project, S.job],
  "scope.unlock": [S.version, S.project, S.job],
  "scope.feedback.add": [S.thread, S.comment, S.attachment],
  "scope.feedback.setStatus": [S.thread],
  "scope.attachment.presign": [S.attachment],
  "scope.attachment.commit": [S.attachment],
  "scope.attachment.delete": [S.attachment],
  "scope.success.save": [S.version],
  "scope.success.ask": [S.job],
  "scope.screens.review": [S.version],
};

// ---------------------------------------------------------------- argument and answer shapes

export interface FeatureInput {
  id?: string;
  clientKey?: string;
  expectedUpdatedAt?: string;
  name: string;
  description: string;
  priority: "must" | "nice" | "later" | "excluded";
  excludedReason?: string;
  requirementIds: string[];
  screenIds: string[];
  sortOrder: number;
}

export interface StoryInput {
  id?: string;
  clientKey?: string;
  expectedUpdatedAt?: string;
  /** An id, or the clientKey of a new feature in the same save. */
  featureId: string;
  actor: string;
  text: string;
  acceptanceCriteria: string[];
  sortOrder: number;
}

export type ScopeSaveArgs = {
  projectId: string;
  upsertFeatures?: FeatureInput[];
  removeFeatureIds?: string[];
  upsertStories?: StoryInput[];
  removeStoryIds?: string[];
};
export interface ScopeConflict {
  kind: string;
  id: string;
}
export interface ScopeSaveAnswer {
  version: Row | null;
  features: Row[];
  stories: Row[];
  removedFeatureIds: string[];
  removedStoryIds: string[];
  milestones: Row[];
  conflicts: ScopeConflict[];
  idsByClientKey: Record<string, string>;
}

export interface PlanInput {
  id?: string;
  clientKey?: string;
  name: string;
  goal: string;
  featureRefs: string[];
}
export type MilestonesSaveArgs = {
  projectId: string;
  scopeVersionId: string;
  plan: PlanInput[];
  expected: { id: string; updatedAt: string }[];
};
export interface MilestonesSaveAnswer {
  milestones: Row[];
  removedIds: string[];
}

export type ScopeOpenArgs = { projectId: string };
export interface ScopeOpenAnswer {
  designJobId: string | null;
  repaired: string[];
}

export type JobArgs = { projectId: string; scopeVersionId: string; note?: string };
export interface JobAnswer {
  job: Row;
  existing: boolean;
}

export type ChallengeDecideArgs = { projectId: string; challengeId: string; decision: "accepted" | "answered" | "dismissed"; text?: string };
export type ChallengeUndoArgs = { projectId: string; challengeId: string };
export interface ChallengeAnswer {
  challenge: Row;
}

export type LockArgs = { projectId: string; scopeVersionId: string };
export interface LockAnswer {
  version: Row;
  milestones: Row[];
  project: Row;
  boardPlanJobId: string | null;
}
export interface UnlockAnswer {
  version: Row;
  project: Row;
  cancelledJobId: string | null;
}

export type FeedbackTargetType = ScopeFeedbackTarget;
export type FeedbackAddArgs = {
  projectId: string;
  target: { type: FeedbackTargetType; id: string };
  commentKey: string;
  text: string;
  attachmentIds: string[];
};
export interface FeedbackAddAnswer {
  thread: Row;
  comment: Row;
  attachments: Row[];
}
/** A person reopens a thread or accepts and closes it; `decision` says what happened to a suggested change
 *  ("applied": it was saved through the item's own edit, "kept": the item stays as it was). */
export type FeedbackStatusArgs = { projectId: string; threadId: string; status: "open" | "resolved"; decision?: "applied" | "kept" };
export interface FeedbackStatusAnswer {
  thread: Row;
}

export type PresignArgs = { projectId: string; commentKey: string; fileName: string; mime: string; sizeBytes: number };
export interface PresignAnswer {
  attachmentId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  storedName: string;
  attachment?: Row;
}
export type AttachmentArgs = { projectId: string; attachmentId: string };
export interface CommitAnswer {
  attachment: Row;
  rejected: boolean;
}
export interface AttachmentAnswer {
  attachment: Row;
}
export interface AttachmentUrlAnswer {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------- cache writes

interface RowPart {
  schema: string;
  rows: Row[];
  removed?: string[];
}

const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x): x is Row => typeof x === "object" && x !== null) : []);
const rowOf = (v: unknown): Row[] => (typeof v === "object" && v !== null && !Array.isArray(v) ? [v as Row] : []);
const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const get = (d: unknown, k: string): unknown => (typeof d === "object" && d !== null ? (d as Record<string, unknown>)[k] : undefined);

/** Which rows of an op's answer go into which schema's cache. */
const ANSWER_PARTS: Record<ScopeWriteOp, (d: unknown) => RowPart[]> = {
  "scope.open": () => [],
  "scope.save": (d) => [
    { schema: S.version, rows: rowOf(get(d, "version")) },
    { schema: S.feature, rows: rowsOf(get(d, "features")), removed: idsOf(get(d, "removedFeatureIds")) },
    { schema: S.story, rows: rowsOf(get(d, "stories")), removed: idsOf(get(d, "removedStoryIds")) },
    { schema: S.milestone, rows: rowsOf(get(d, "milestones")) },
  ],
  "milestones.save": (d) => [{ schema: S.milestone, rows: rowsOf(get(d, "milestones")), removed: idsOf(get(d, "removedIds")) }],
  "milestones.suggest": (d) => [{ schema: S.job, rows: rowOf(get(d, "job")) }],
  "scope.grill": (d) => [{ schema: S.job, rows: rowOf(get(d, "job")) }],
  "scope.challenge.decide": (d) => [{ schema: S.challenge, rows: rowOf(get(d, "challenge")) }],
  "scope.challenge.undo": (d) => [{ schema: S.challenge, rows: rowOf(get(d, "challenge")) }],
  "scope.lock": (d) => [
    { schema: S.version, rows: rowOf(get(d, "version")) },
    { schema: S.milestone, rows: rowsOf(get(d, "milestones")) },
    { schema: S.project, rows: rowOf(get(d, "project")) },
  ],
  "scope.unlock": (d) => [
    { schema: S.version, rows: rowOf(get(d, "version")) },
    { schema: S.project, rows: rowOf(get(d, "project")) },
  ],
  "scope.feedback.add": (d) => [
    { schema: S.thread, rows: rowOf(get(d, "thread")) },
    { schema: S.comment, rows: rowOf(get(d, "comment")) },
    { schema: S.attachment, rows: rowsOf(get(d, "attachments")) },
  ],
  "scope.feedback.setStatus": (d) => [{ schema: S.thread, rows: rowOf(get(d, "thread")) }],
  "scope.attachment.presign": (d) => [{ schema: S.attachment, rows: rowOf(get(d, "attachment")) }],
  "scope.attachment.commit": (d) => [{ schema: S.attachment, rows: rowOf(get(d, "attachment")) }],
  "scope.attachment.delete": (d) => [{ schema: S.attachment, rows: rowOf(get(d, "attachment")) }],
  "scope.success.save": (d) => [{ schema: S.version, rows: rowOf(get(d, "version")) }],
  "scope.success.ask": (d) => [{ schema: S.job, rows: rowOf(get(d, "job")) }],
  "scope.screens.review": (d) => [{ schema: S.version, rows: rowOf(get(d, "version")) }],
};

export interface MutationDeps {
  client?: QueryClient;
  call?: ReturnType<typeof createFunctionCaller>;
}

/**
 * Mutation options for one scope op. onSuccess writes the answer rows into the cache first, then runs the
 * base invalidation in the background (not awaited), so the screen updates at once.
 */
export function scopeMutationOptions<TArgs extends Record<string, unknown>, TData>(
  workspaceId: string,
  op: ScopeWriteOp,
  deps: MutationDeps = {},
): UseMutationOptions<FunctionResult<TData>, Error, TArgs> {
  const client = deps.client ?? queryClient;
  const keys: QueryKey[] = SCOPE_OP_SCHEMAS[op].map((schema) => [...blocksKeys.schema(workspaceId, schema)]);
  const base = functionMutationOptions<TArgs, TData>({ fn: "project", op, invalidate: keys }, client, deps.call ?? callFunction);
  const baseOnSuccess = base.onSuccess as ((...a: unknown[]) => unknown) | undefined;
  return {
    ...base,
    onSuccess: (result, args, ...rest) => {
      for (const part of ANSWER_PARTS[op](result.data)) {
        if (part.rows.length > 0 || (part.removed && part.removed.length > 0)) {
          mergeRows(client, workspaceId, part.schema, part.rows, part.removed);
        }
        if (part.schema === S.project && part.rows[0]) patchProjectCaches(client, part.rows[0], (args as Record<string, unknown>).projectId);
      }
      void Promise.resolve(baseOnSuccess?.(result, args, ...rest)).catch(() => undefined);
      if (SCOPE_OP_SCHEMAS[op].includes(S.job)) void client.invalidateQueries({ predicate: isEngineJobQuery }).catch(() => undefined);
    },
  };
}

/** A write whose answer never arrived (timeout, SELISE Blocks unavailable): it may still have landed on the server. */
export function isPendingScopeError(e: unknown): boolean {
  return e instanceof FunctionError && (e.code === "timeout" || e.code === "unavailable");
}

/**
 * After a lock or unlock that timed out on the client: refetch everything the op touches (the version list, the two
 * private Project caches, the Project item and the engine jobs) and resolve once the active queries have the server's state.
 */
export async function rereadScope(client: QueryClient, workspaceId: string, op: "scope.lock" | "scope.unlock", projectId: string): Promise<void> {
  await Promise.all([
    ...SCOPE_OP_SCHEMAS[op].map((schema) => client.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, schema) })),
    client.invalidateQueries({ queryKey: scopeProjectKey(projectId) }),
    client.invalidateQueries({ queryKey: deliveryProjectKey(projectId) }),
    client.invalidateQueries({ queryKey: blocksKeys.item(workspaceId, S.project, projectId) }),
    client.invalidateQueries({ predicate: isEngineJobQuery }),
  ]);
}

/** The raw Status of one ScopeVersion row in the cached version queries (pages, arrays or items), or null if none holds it. */
export function cachedScopeVersionStatus(client: QueryClient, workspaceId: string, versionId: string): string | null {
  const entries = client.getQueriesData({ queryKey: blocksKeys.schema(workspaceId, S.version) }) as [QueryKey, unknown][];
  for (const [, data] of entries) {
    const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(get(data, "items")) ? (get(data, "items") as unknown[]) : [data];
    for (const r of rows) {
      if (get(r, "ItemId") === versionId && typeof get(r, "Status") === "string") return get(r, "Status") as string;
    }
  }
  return null;
}

/** Patch the two private Project caches (scope page, delivery pages) from an answer's project row. */
function patchProjectCaches(client: QueryClient, row: Row, fallbackId: unknown): void {
  const id = typeof row.ItemId === "string" && row.ItemId ? row.ItemId : typeof fallbackId === "string" ? fallbackId : "";
  if (!id) return;
  client.setQueryData<ProjectRecord | "unreadable" | null>(scopeProjectKey(id), (old) => {
    if (!old || old === "unreadable") return old;
    const base: Row = { ItemId: old.id, WorkspaceId: old.workspaceId, Name: old.name, ClientName: old.clientName, Stage: old.stage, CurrentScopeVersion: old.currentScopeVersion, ScopeLockedAt: old.scopeLockedAt };
    // a Stage in the answer replaces the cached effective stage; a stale ResumeTo must not win over it
    return projectFromRow({ ...base, ...row, ItemId: id }) ?? old;
  });
  client.setQueryData<Row | null>(deliveryProjectKey(id), (old) => (old ? { ...old, ...row } : old));
  void client.invalidateQueries({ queryKey: scopeProjectKey(id) }).catch(() => undefined);
  void client.invalidateQueries({ queryKey: deliveryProjectKey(id) }).catch(() => undefined);
}

type Ctx = Pick<ScopeContext, "workspaceId">;
const wsOf = (ctx: Ctx): string => ctx.workspaceId ?? "";
type Hook<A, D> = UseMutationResult<FunctionResult<D>, Error, A>;

function useScopeOp<A extends Record<string, unknown>, D>(ctx: Ctx, op: ScopeWriteOp): Hook<A, D> {
  return useMutation(scopeMutationOptions<A, D>(wsOf(ctx), op));
}

export const useScopeOpen = (ctx: Ctx): Hook<ScopeOpenArgs, ScopeOpenAnswer> => useScopeOp(ctx, "scope.open");
export const useScopeSave = (ctx: Ctx): Hook<ScopeSaveArgs, ScopeSaveAnswer> => useScopeOp(ctx, "scope.save");
export const useMilestonesSave = (ctx: Ctx): Hook<MilestonesSaveArgs, MilestonesSaveAnswer> => useScopeOp(ctx, "milestones.save");
export const useMilestonesSuggest = (ctx: Ctx): Hook<JobArgs, JobAnswer> => useScopeOp(ctx, "milestones.suggest");
export const useScopeGrill = (ctx: Ctx): Hook<JobArgs, JobAnswer> => useScopeOp(ctx, "scope.grill");
export const useChallengeDecide = (ctx: Ctx): Hook<ChallengeDecideArgs, ChallengeAnswer> => useScopeOp(ctx, "scope.challenge.decide");
export const useChallengeUndo = (ctx: Ctx): Hook<ChallengeUndoArgs, ChallengeAnswer> => useScopeOp(ctx, "scope.challenge.undo");
export const useScopeLock = (ctx: Ctx): Hook<LockArgs, LockAnswer> => useScopeOp(ctx, "scope.lock");
export const useScopeUnlock = (ctx: Ctx): Hook<LockArgs, UnlockAnswer> => useScopeOp(ctx, "scope.unlock");
export interface SuccessSaveArgs extends Record<string, unknown> { projectId: string; scopeVersionId: string; targets: unknown }
export interface SuccessAskArgs extends Record<string, unknown> { projectId: string; scopeVersionId: string; mode: "propose" | "answer"; keys?: string[] }
export interface ScreensReviewArgs extends Record<string, unknown> { projectId: string; scopeVersionId: string; reviewed: boolean }
export const useSuccessSave = (ctx: Ctx): Hook<SuccessSaveArgs, { version: Row }> => useScopeOp(ctx, "scope.success.save");
export const useSuccessAsk = (ctx: Ctx): Hook<SuccessAskArgs, JobAnswer> => useScopeOp(ctx, "scope.success.ask");
export const useScreensReview = (ctx: Ctx): Hook<ScreensReviewArgs, { version: Row }> => useScopeOp(ctx, "scope.screens.review");
export const useFeedbackAdd = (ctx: Ctx): Hook<FeedbackAddArgs, FeedbackAddAnswer> => useScopeOp(ctx, "scope.feedback.add");
export const useFeedbackSetStatus = (ctx: Ctx): Hook<FeedbackStatusArgs, FeedbackStatusAnswer> => useScopeOp(ctx, "scope.feedback.setStatus");
export const useAttachmentPresign = (ctx: Ctx): Hook<PresignArgs, PresignAnswer> => useScopeOp(ctx, "scope.attachment.presign");
export const useAttachmentCommit = (ctx: Ctx): Hook<AttachmentArgs, CommitAnswer> => useScopeOp(ctx, "scope.attachment.commit");
export const useAttachmentDelete = (ctx: Ctx): Hook<AttachmentArgs, AttachmentAnswer> => useScopeOp(ctx, "scope.attachment.delete");

/** A short-lived download URL for a ready attachment of this project (a query-style call, not a mutation). */
export async function fetchAttachmentUrl(projectId: string, attachmentId: string): Promise<AttachmentUrlAnswer> {
  const res = await callFunction<AttachmentUrlAnswer>("project", "scope.attachment.url", { projectId, attachmentId });
  return res.data;
}

/** The plain sentence for any failure of a scope write. Server free text is never shown. */
export function failureText(e: unknown): string {
  return scopeErrorMessage(e);
}

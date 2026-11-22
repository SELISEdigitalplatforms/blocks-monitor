// Requirements & objective + Screens & design: the WRITE side.
// The browser holds no write rights. EVERY write is an operation of the Logic Function "project" (mf-project),
// called through src/blocks/fn.ts callFunction (one mutate = one user action = one requestId, reused by its own retries).
// The server checks membership and permissions and stamps ids; this file only sends intent and writes the answer
// (the changed rows) into the TanStack cache so the screen updates without waiting for a refetch.
import { useMutation, type QueryClient, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { callFunction } from "../fn";
import { queryClient } from "../queryClient";
import { blocksKeys } from "../data/keys";
import { ENGINE_JOB_SCHEMA } from "../engine/types";
import { useActiveWorkspaceId } from "./context";
import type { AnyRow, ChangedRows, RemovedIds } from "./records";
import { SCHEMA } from "./records";
import {
  designBriefQueryOptions,
  designSamplesQueryOptions,
  itemVersionsMetaQueryOptions,
  itemVersionTextQueryOptions,
  objectiveQueryOptions,
  requirementsQueryOptions,
  suggestionsQueryOptions,
} from "./hooks";

export interface VersionedAnswer {
  version: number;
  changed: ChangedRows;
  removed?: RemovedIds;
}

export interface SaveRequirementArgs {
  id?: string;
  clientKey?: string;
  title?: string;
  detail?: string;
  priority?: string;
  /** Only with a NEW requirement (clientKey): an update answers invalid_input (criteria, useAcceptance); use acceptance.save. */
  criteria?: string[];
  baseVersion?: number;
  restore?: boolean;
}
export interface SaveRequirementAnswer extends VersionedAnswer {
  requirementId: string;
}
export interface DeleteRequirementArgs {
  id: string;
}
export interface DeleteRequirementAnswer {
  requirementId: string;
  changed: ChangedRows;
  removed?: RemovedIds;
}
export interface ReorderRequirementsArgs {
  orderedIds: string[];
}
export interface ChangedAnswer {
  changed: ChangedRows;
  removed?: RemovedIds;
}
export interface SaveObjectiveArgs {
  text: string;
  baseVersion: number;
}
export interface SaveObjectiveAnswer extends VersionedAnswer {
  objectiveId: string;
}
export interface SaveAcceptanceArgs {
  parent: { type: "objective" } | { type: "requirement"; id: string };
  criteria: string[];
  baseVersion: number;
  /** reused by a retry of the same save, so the server replays its stored outcome */
  requestId?: string;
}
export interface SaveAcceptanceAnswer extends VersionedAnswer {
  itemKey: string;
}
export interface DecideSuggestionArgs {
  suggestionId: string;
  decision: "accepted" | "dismissed" | "open";
}
export interface DecideSuggestionAnswer {
  suggestionId: string;
  status: string;
  requirementId: string | null;
  requirementRemoved: boolean;
  keptEdited: boolean;
  changed: ChangedRows;
  removed?: RemovedIds;
}
export interface RestoreVersionArgs {
  itemKey: string;
  restoreN: number;
  baseVersion: number;
}
export interface RestoreVersionAnswer extends VersionedAnswer {
  itemKey: string;
}
export interface ConfirmRequirementsAnswer {
  alreadyConfirmed: boolean;
  stage: string;
  changed: ChangedRows;
}
export interface RequestReviewAnswer {
  jobId: string;
  created: boolean;
  changed: ChangedRows;
}
export interface SaveDesignBriefArgs {
  mode?: "figma" | "sample" | "describe";
  instructions?: string;
  sampleOrder?: string[];
  requestId?: string;
}
export interface ConfirmDesignBriefAnswer {
  alreadyConfirmed: boolean;
  changed: ChangedRows;
}
export interface DeleteSampleArgs {
  attachmentId: string;
}
export interface PresignArgs {
  fileName: string;
  mime: string;
  sizeBytes: number;
}
export interface PresignAnswer {
  attachmentId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  storedName: string;
  changed: ChangedRows;
}
export interface CommitAnswer {
  status: "ready" | "rejected";
  reason: "size" | "type" | null;
  changed: ChangedRows;
  removed?: RemovedIds;
}

type Cache = QueryClient;
const idOf = (r: AnyRow): string | undefined => {
  const v = (r as Record<string, unknown>).ItemId;
  return typeof v === "string" ? v : undefined;
};
const field = (r: AnyRow, k: string): unknown => (r as Record<string, unknown>)[k];

/** Replace by ItemId, append when new; drop removed ids. Skips a list that is not cached (a partial list must not look complete). */
function patchList(
  client: Cache,
  key: readonly unknown[],
  rows: readonly AnyRow[],
  removed: readonly string[],
  opts: { drop?: (r: AnyRow) => boolean; sort?: boolean } = {},
): void {
  client.setQueryData<AnyRow[]>(key, (old) => {
    if (!Array.isArray(old)) return old;
    let next = old.filter((r) => !removed.includes(idOf(r) ?? ""));
    for (const row of rows) {
      const id = idOf(row);
      if (!id) continue;
      const at = next.findIndex((r) => idOf(r) === id);
      const gone = opts.drop?.(row) === true;
      if (gone) {
        if (at >= 0) next = next.filter((_, i) => i !== at);
      } else if (at >= 0) next = next.map((r, i) => (i === at ? row : r));
      else next = [...next, row];
    }
    if (opts.sort) {
      next = [...next].sort((a, b) => (Number(field(a, "SortOrder")) || 0) - (Number(field(b, "SortOrder")) || 0));
    }
    return next;
  });
}

const ofProject = (projectId: string) => (r: AnyRow) => {
  const p = field(r, "ProjectId");
  return p === undefined || p === projectId;
};

/** Write the answer's rows into the exact lane cache keys, then refresh in the background (not awaited). */
export function applyAnswer(
  client: Cache,
  ws: string,
  projectId: string,
  answer: { changed?: ChangedRows; removed?: RemovedIds },
): void {
  const changed = (answer.changed ?? {}) as Record<string, AnyRow[] | undefined>;
  const removed = (answer.removed ?? {}) as Record<string, string[] | undefined>;
  const touched = new Set<string>([...Object.keys(changed), ...Object.keys(removed)]);
  const rowsOf = (k: string) => (changed[k] ?? []).filter(ofProject(projectId));
  const goneOf = (k: string) => removed[k] ?? [];

  const lists: Record<string, { key: readonly unknown[]; drop?: (r: AnyRow) => boolean; sort?: boolean }> = {
    Requirement: {
      key: requirementsQueryOptions(ws, projectId).queryKey,
      drop: (r) => field(r, "Status") === "dropped",
      sort: true,
    },
    Objective: { key: objectiveQueryOptions(ws, projectId).queryKey },
    Suggestion: { key: suggestionsQueryOptions(ws, projectId).queryKey },
    DesignBrief: { key: designBriefQueryOptions(ws, projectId).queryKey },
    Attachment: { key: designSamplesQueryOptions(ws, projectId).queryKey, drop: (r) => field(r, "Status") === "deleted" },
  };
  for (const [k, cfg] of Object.entries(lists)) {
    if (!touched.has(k)) continue;
    patchList(client, cfg.key, k === "Attachment" ? (changed[k] ?? []) : rowsOf(k), goneOf(k), cfg);
  }

  if (touched.has("ItemVersion")) {
    const versions = rowsOf("ItemVersion");
    const meta = versions.map((r) => {
      const { Text: _text, ...rest } = r as Record<string, unknown>;
      return rest as AnyRow;
    });
    patchList(client, itemVersionsMetaQueryOptions(ws, projectId).queryKey, meta, goneOf("ItemVersion"));
    for (const row of versions) {
      const itemKey = field(row, "ItemKey");
      if (typeof itemKey !== "string" || typeof field(row, "Text") !== "string") continue;
      patchList(client, itemVersionTextQueryOptions(ws, projectId, itemKey).queryKey, [row], []);
    }
  }

  if (touched.has("Project")) {
    const key = blocksKeys.item(ws, "Project", projectId);
    for (const row of changed.Project ?? []) {
      if (idOf(row) !== projectId) continue;
      client.setQueryData<AnyRow>(key, (old) => (old ? ({ ...old, ...row } as AnyRow) : old));
    }
  }

  // the design context (src/blocks/requirements/designContext.ts) is drawn from these records: read it again at once
  if ([...touched].some((k) => DESIGN_SOURCES.has(k))) {
    void client.invalidateQueries({
      queryKey: blocksKeys.schema(ws, "DesignBrief"),
      predicate: (q) => (q.queryKey[3] as { kind?: unknown } | undefined)?.kind === "design-intent",
    });
  }

  for (const k of touched) {
    const schema = (SCHEMA as Record<string, string>)[k] ?? k;
    if (k === "EngineJob") {
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] === "ws" && q.queryKey[1] === ws && q.queryKey[2] === ENGINE_JOB_SCHEMA });
    } else {
      void client.invalidateQueries({ queryKey: blocksKeys.schema(ws, schema) });
    }
  }
}

/** The records the design context is drawn from (functions/project/ops/design/context.ts loadDesignSources). */
const DESIGN_SOURCES: ReadonlySet<string> = new Set(["Project", "Objective", "Requirement", "RequirementExtra", "DocNote", "Clarification", "DesignBrief"]);

export interface MutationCtx {
  projectId: string;
  workspaceId: string | null;
}
export interface MutationDeps {
  call?: typeof callFunction;
  client?: QueryClient;
}

/** Options for one op: mutationFn sends {projectId, ...args}; onSuccess writes the answer into the cache. */
export function requirementsMutationOptions<A, D>(
  op: string,
  ctx: MutationCtx,
  deps: MutationDeps = {},
): UseMutationOptions<D, Error, A> {
  const call = deps.call ?? callFunction;
  const client = deps.client ?? queryClient;
  return {
    mutationFn: async (args: A) => {
      const { requestId, ...rest } = (args ?? {}) as Record<string, unknown>;
      // an explicit requestId (a retry of the same user action) lets the server replay the stored outcome
      const body = { ...rest, projectId: ctx.projectId };
      const result = typeof requestId === "string" && requestId ? await call<D>("project", op, body, { requestId }) : await call<D>("project", op, body);
      return result.data;
    },
    retry: 0,
    onSuccess: (data) => {
      if (ctx.workspaceId && data && typeof data === "object") {
        applyAnswer(client, ctx.workspaceId, ctx.projectId, data as { changed?: ChangedRows; removed?: RemovedIds });
      }
    },
  };
}

function useOp<A, D>(op: string, projectId: string): UseMutationResult<D, Error, A> {
  const workspaceId = useActiveWorkspaceId();
  return useMutation(requirementsMutationOptions<A, D>(op, { projectId, workspaceId: workspaceId ?? null }));
}

export const useSaveRequirement = (p: string) => useOp<SaveRequirementArgs, SaveRequirementAnswer>("requirement.save", p);
export const useDeleteRequirement = (p: string) => useOp<DeleteRequirementArgs, DeleteRequirementAnswer>("requirement.delete", p);
export const useReorderRequirements = (p: string) => useOp<ReorderRequirementsArgs, ChangedAnswer>("requirement.reorder", p);
export const useSaveObjective = (p: string) => useOp<SaveObjectiveArgs, SaveObjectiveAnswer>("objective.save", p);
export const useSaveAcceptance = (p: string) => useOp<SaveAcceptanceArgs, SaveAcceptanceAnswer>("acceptance.save", p);
export const useDecideSuggestion = (p: string) => useOp<DecideSuggestionArgs, DecideSuggestionAnswer>("suggestion.decide", p);
export const useRestoreVersion = (p: string) => useOp<RestoreVersionArgs, RestoreVersionAnswer>("item.version", p);
export const useConfirmRequirements = (p: string) => useOp<Record<string, never>, ConfirmRequirementsAnswer>("requirements.confirm", p);
export const useRequestReview = (p: string) => useOp<Record<string, never>, RequestReviewAnswer>("requirements.review", p);
export const useSaveDesignBrief = (p: string) => useOp<SaveDesignBriefArgs, ChangedAnswer>("designBrief.save", p);
export const useConfirmDesignBrief = (p: string) => useOp<Record<string, never>, ConfirmDesignBriefAnswer>("designBrief.confirm", p);
export const useGenerateDesign = (p: string) => useOp<{ feedback: string; workflow?: "factory" | "figma" | "screens" }, RequestReviewAnswer>("designBrief.generate", p);
export const useDeleteSample = (p: string) => useOp<DeleteSampleArgs, ChangedAnswer>("sample.delete", p);

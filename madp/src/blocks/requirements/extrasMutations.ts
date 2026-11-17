// Writes of the Goals & requirements extras (key workflows, not included, constraints): project function ops
// extra.save / extra.remove / extra.move (functions/project/ops/requirements/extras.ts). The answer's rows go straight
// into the extras list cache (removed rows stay in it: they tell that the setup answers were imported), then the list
// is refreshed in the background.
import { useMutation, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { callFunction } from "../fn";
import { queryClient } from "../queryClient";
import { blocksKeys } from "../data/keys";
import { EXTRA_SCHEMA, type ConstraintKind, type ExtraKind } from "../../domain/requirementsExtras";
import { useActiveWorkspaceId } from "./context";
import { extrasQueryOptions, type ExtraRow } from "./extras";

export interface SaveExtraArgs {
  /** A row id, or a "setup:<kind>:<n>" id of an item shown from the setup answers; absent for a new item (clientKey). */
  id?: string;
  clientKey?: string;
  kind: ExtraKind;
  title?: string;
  who?: string;
  steps?: string[];
  constraintKind?: ConstraintKind;
  restore?: boolean;
}
export interface ExtrasAnswer { extra?: ExtraRow; changed: { RequirementExtra?: ExtraRow[] } }

/** Upserts the answer's rows into the cached list (by ItemId), kept in SortOrder. */
export function mergeExtraRows(old: readonly ExtraRow[] | undefined, rows: readonly ExtraRow[]): ExtraRow[] | undefined {
  if (!Array.isArray(old)) return old as undefined;
  let next = [...old];
  for (const row of rows) {
    if (!row?.ItemId) continue;
    const at = next.findIndex((r) => r.ItemId === row.ItemId);
    next = at >= 0 ? next.map((r, i) => (i === at ? { ...r, ...row } : r)) : [...next, row];
  }
  return next.sort((a, b) => (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0));
}

export function applyExtrasAnswer(client: QueryClient, ws: string, projectId: string, answer: ExtrasAnswer | null | undefined): void {
  const rows = (answer?.changed?.RequirementExtra ?? []).filter((r) => !r.ProjectId || r.ProjectId === projectId);
  if (rows.length) client.setQueryData<ExtraRow[]>(extrasQueryOptions(ws, projectId).queryKey, (old) => mergeExtraRows(old, rows));
  void client.invalidateQueries({ queryKey: blocksKeys.schema(ws, EXTRA_SCHEMA) });
}

function useExtraOp<A>(op: string, projectId: string): UseMutationResult<ExtrasAnswer, Error, A> {
  const ws = useActiveWorkspaceId();
  return useMutation<ExtrasAnswer, Error, A>({
    mutationFn: async (args: A) => (await callFunction<ExtrasAnswer>("project", op, { ...(args as object), projectId })).data,
    retry: 0,
    onSuccess: (data) => { if (ws) applyExtrasAnswer(queryClient, ws, projectId, data); },
  });
}

export const useSaveExtra = (projectId: string) => useExtraOp<SaveExtraArgs>("extra.save", projectId);
export const useRemoveExtra = (projectId: string) => useExtraOp<{ id: string }>("extra.remove", projectId);
export const useMoveExtra = (projectId: string) => useExtraOp<{ id: string; dir: -1 | 1 }>("extra.move", projectId);

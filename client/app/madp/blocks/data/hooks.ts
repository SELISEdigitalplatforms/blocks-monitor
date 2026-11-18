// Read hooks over the Blocks Data Gateway: workspace queries are scoped to the active workspace, in the key and in the filter.
// Platform-level queries (usePlatformAll) carry no workspace clause; the Blocks row policies limit them to platform admins.
import { useQuery, type QueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { queryClient } from "../queryClient";
import { blocksKeys } from "./keys";
import {
  queryPage,
  queryList,
  queryListResult,
  clampPage,
  clampPageSize,
  MAX_PAGE_SIZE,
  type ListResult,
  type Where,
  type PageParams,
  type Page,
  type FieldOf,
  type SortSpec,
} from "./gql";
import type { BlocksDataError } from "./errors";

/** A remount within this window shows the cached list without a request. */
export const LIST_STALE_MS = 30_000;

/** Keeps the previous data of a list while its page or filter changes, never across another workspace or schema. */
function keepSameSchema<D>(ws: string, schema: string) {
  return (previous: D | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): D | undefined => {
    const key = previousQuery?.queryKey;
    return key && key[1] === ws && key[2] === schema ? previous : undefined;
  };
}

export interface BlocksListParams<T> extends PageParams<T> {
  workspaceId: string | null | undefined;
}

export interface BlocksItemParams<T> {
  workspaceId: string | null | undefined;
  fields: readonly FieldOf<T>[];
}

/** The always-present workspace clause (the row policy enforces it too). */
function eqClause<T>(field: string, value: string): Where<T> {
  return { op: "eq", field, value } as unknown as Where<T>;
}

/** Query options for a paged list; the filter is always AND-ed with the workspace. */
export function blocksListOptions<T>(schema: string, params: BlocksListParams<T>) {
  const ws = params.workspaceId ?? "";
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  return {
    queryKey: blocksKeys.list(ws, schema, {
      where: params.where,
      sort: params.sort,
      page,
      pageSize,
      fields: params.fields,
    }),
    queryFn: (): Promise<Page<T>> => {
      const scope = eqClause<T>("WorkspaceId", ws);
      const where: Where<T> = params.where
        ? ({ op: "and", clauses: [scope, params.where] } as Where<T>)
        : scope;
      return queryPage<T>(schema, {
        fields: params.fields,
        where,
        sort: params.sort,
        page,
        pageSize,
      });
    },
    enabled: Boolean(params.workspaceId),
    staleTime: LIST_STALE_MS,
    placeholderData: keepSameSchema<Page<T>>(ws, schema),
  };
}

export function useBlocksList<T>(schema: string, params: BlocksListParams<T>): UseQueryResult<Page<T>, BlocksDataError> {
  return useQuery<Page<T>, BlocksDataError>(blocksListOptions<T>(schema, params));
}

export interface BlocksAllParams<T> {
  workspaceId: string | null | undefined;
  fields: readonly FieldOf<T>[];
  where?: Where<T>;
  sort?: readonly SortSpec<T>[];
  maxItems?: number;
}

/** How many rows the list held when it was last read (its pages are then asked in one request); undefined before. */
function rowsBefore(context: { client?: QueryClient; queryKey?: QueryKey } | undefined): number | undefined {
  if (!context?.client || !context.queryKey) return undefined;
  const data = context.client.getQueryData(context.queryKey) as unknown;
  if (Array.isArray(data)) return data.length;
  const items = (data as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items.length : undefined;
}

/** Query options for every record of a workspace schema (all pages); the filter is AND-ed with the workspace. */
export function blocksAllOptions<T>(schema: string, params: BlocksAllParams<T>) {
  const ws = params.workspaceId ?? "";
  return {
    queryKey: blocksKeys.list(ws, schema, {
      mode: "all",
      where: params.where,
      sort: params.sort,
      fields: params.fields,
      maxItems: params.maxItems,
    }),
    queryFn: (context?: { client?: QueryClient; queryKey?: QueryKey }): Promise<T[]> => {
      const scope = eqClause<T>("WorkspaceId", ws);
      const where: Where<T> = params.where
        ? ({ op: "and", clauses: [scope, params.where] } as Where<T>)
        : scope;
      return queryList<T>(schema, {
        fields: params.fields,
        where,
        sort: params.sort,
        pageSize: MAX_PAGE_SIZE,
        maxItems: params.maxItems,
        expectedCount: rowsBefore(context),
      });
    },
    enabled: Boolean(params.workspaceId),
    staleTime: LIST_STALE_MS,
    placeholderData: keepSameSchema<T[]>(ws, schema),
  };
}

export function useBlocksAll<T>(schema: string, params: BlocksAllParams<T>): UseQueryResult<T[], BlocksDataError> {
  return useQuery<T[], BlocksDataError>(blocksAllOptions<T>(schema, params));
}

/** Like blocksAllOptions, but the result also says whether the list was capped (and the total count). */
export function blocksAllResultOptions<T>(schema: string, params: BlocksAllParams<T>) {
  const ws = params.workspaceId ?? "";
  return {
    queryKey: blocksKeys.list(ws, schema, {
      mode: "all-result",
      where: params.where,
      sort: params.sort,
      fields: params.fields,
      maxItems: params.maxItems,
    }),
    queryFn: (context?: { client?: QueryClient; queryKey?: QueryKey }): Promise<ListResult<T>> => {
      const scope = eqClause<T>("WorkspaceId", ws);
      const where: Where<T> = params.where
        ? ({ op: "and", clauses: [scope, params.where] } as Where<T>)
        : scope;
      return queryListResult<T>(schema, {
        fields: params.fields,
        where,
        sort: params.sort,
        pageSize: MAX_PAGE_SIZE,
        maxItems: params.maxItems,
        expectedCount: rowsBefore(context),
      });
    },
    enabled: Boolean(params.workspaceId),
    staleTime: LIST_STALE_MS,
    placeholderData: keepSameSchema<ListResult<T>>(ws, schema),
  };
}

export function useBlocksAllResult<T>(
  schema: string,
  params: BlocksAllParams<T>,
): UseQueryResult<ListResult<T>, BlocksDataError> {
  return useQuery<ListResult<T>, BlocksDataError>(blocksAllResultOptions<T>(schema, params));
}

/** Query options for the number of workspace records matching a filter (one row requested, only the count read). */
export function blocksCountOptions<T>(
  schema: string,
  params: { workspaceId: string | null | undefined; where?: Where<T> },
) {
  const ws = params.workspaceId ?? "";
  return {
    queryKey: blocksKeys.list(ws, schema, { mode: "count", where: params.where }),
    queryFn: async (): Promise<number> => {
      const scope = eqClause<T>("WorkspaceId", ws);
      const where: Where<T> = params.where
        ? ({ op: "and", clauses: [scope, params.where] } as Where<T>)
        : scope;
      const res = await queryPage<T>(schema, {
        fields: ["ItemId"] as FieldOf<T>[],
        where,
        page: 1,
        pageSize: 1,
      });
      return res.totalCount;
    },
    enabled: Boolean(params.workspaceId),
    staleTime: LIST_STALE_MS,
    placeholderData: keepSameSchema<number>(ws, schema),
  };
}

export function useBlocksCount<T>(
  schema: string,
  params: { workspaceId: string | null | undefined; where?: Where<T> },
): UseQueryResult<number, BlocksDataError> {
  return useQuery<number, BlocksDataError>(blocksCountOptions<T>(schema, params));
}

export interface PlatformAllParams<T> {
  fields: readonly FieldOf<T>[];
  where?: Where<T>;
  sort?: readonly SortSpec<T>[];
  maxItems?: number;
  enabled?: boolean;
}

/** Query options for every record of a platform-level schema (no workspace clause). */
export function platformAllOptions<T>(schema: string, params: PlatformAllParams<T>) {
  return {
    queryKey: blocksKeys.platformList(schema, {
      mode: "all",
      where: params.where,
      sort: params.sort,
      fields: params.fields,
      maxItems: params.maxItems,
    }),
    queryFn: (): Promise<T[]> =>
      queryList<T>(schema, {
        fields: params.fields,
        where: params.where,
        sort: params.sort,
        pageSize: MAX_PAGE_SIZE,
        maxItems: params.maxItems,
      }),
    enabled: params.enabled ?? true,
  };
}

export function usePlatformAll<T>(schema: string, params: PlatformAllParams<T>): UseQueryResult<T[], BlocksDataError> {
  return useQuery<T[], BlocksDataError>(platformAllOptions<T>(schema, params));
}

/** The cached list query of this workspace + schema that holds the item with every requested field. */
function findSeed<T>(
  ws: string,
  schema: string,
  id: string | null | undefined,
  fields: readonly FieldOf<T>[],
): { row: T; updatedAt: number } | undefined {
  if (!ws || !id) return undefined;
  for (const q of queryClient.getQueryCache().findAll({ queryKey: blocksKeys.schema(ws, schema) })) {
    const key = q.queryKey[3] as { kind?: string; mode?: string; fields?: unknown } | undefined;
    if (key?.kind !== "list" || key.mode === "count") continue;
    const data = q.state.data as unknown;
    const rows: unknown = Array.isArray(data) ? data : (data as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(rows)) continue;
    const row = rows.find(
      (r): r is Record<string, unknown> => typeof r === "object" && r !== null && (r as { ItemId?: unknown }).ItemId === id,
    );
    if (!row) continue;
    if (fields.every((f) => (f as string) in row)) return { row: row as T, updatedAt: q.state.dataUpdatedAt };
    // A draft row leaves unset fields out: when the list asked for every field, an absent one is null.
    const asked = Array.isArray(key.fields) ? (key.fields as unknown[]) : [];
    if (fields.every((f) => asked.includes(f))) {
      const nulls: Record<string, null> = {};
      for (const f of fields) nulls[f as string] = null;
      return { row: { ...nulls, ...row } as T, updatedAt: q.state.dataUpdatedAt };
    }
  }
  return undefined;
}

function seedFromLists<T>(ws: string, schema: string, id: string | null | undefined, fields: readonly FieldOf<T>[]) {
  return findSeed<T>(ws, schema, id, fields)?.row;
}

function seedUpdatedAt<T>(ws: string, schema: string, id: string | null | undefined, fields: readonly FieldOf<T>[]) {
  return findSeed<T>(ws, schema, id, fields)?.updatedAt;
}

/** Query options for one item by id; an item of another workspace is never cached under this one. */
export function blocksItemOptions<T>(schema: string, id: string | null | undefined, params: BlocksItemParams<T>) {
  const ws = params.workspaceId ?? "";
  return {
    queryKey: blocksKeys.item(ws, schema, id ?? ""),
    queryFn: async (): Promise<T | null> => {
      const where = {
        op: "and",
        clauses: [eqClause<T>("ItemId", id ?? ""), eqClause<T>("WorkspaceId", ws)],
      } as Where<T>;
      const res = await queryPage<T>(schema, { fields: params.fields, where, page: 1, pageSize: 1 });
      return res.items[0] ?? null;
    },
    enabled: Boolean(params.workspaceId && id),
    staleTime: LIST_STALE_MS,
    initialData: (): T | null | undefined => seedFromLists<T>(ws, schema, id, params.fields),
    initialDataUpdatedAt: () => seedUpdatedAt(ws, schema, id, params.fields),
  };
}

export function useBlocksItem<T>(
  schema: string,
  id: string | null | undefined,
  params: BlocksItemParams<T>,
): UseQueryResult<T | null, BlocksDataError> {
  return useQuery<T | null, BlocksDataError>(blocksItemOptions<T>(schema, id, params));
}

/** Drops every cached query of one workspace. */
export function forgetWorkspace(workspaceId: string): void {
  queryClient.removeQueries({ queryKey: blocksKeys.workspace(workspaceId) });
}

/** Drops the cached queries of every workspace except the active one. */
export function forgetOtherWorkspaces(activeWorkspaceId: string | null): void {
  queryClient.removeQueries({
    queryKey: blocksKeys.all(),
    predicate: (q) => q.queryKey[1] !== activeWorkspaceId,
  });
}

const pendingInvalidations = new Set<string>();

/** Marks the list and count queries of one workspace schema stale (not the item queries); same-tick calls make one invalidation. */
export function invalidateSchemaLists(workspaceId: string, schema: string): void {
  const token = JSON.stringify([workspaceId, schema]);
  if (pendingInvalidations.has(token)) return;
  pendingInvalidations.add(token);
  queueMicrotask(() => {
    pendingInvalidations.delete(token);
    void queryClient.invalidateQueries({
      queryKey: blocksKeys.schema(workspaceId, schema),
      predicate: (q) => (q.queryKey[3] as { kind?: string } | undefined)?.kind === "list",
      refetchType: "active",
    });
  });
}

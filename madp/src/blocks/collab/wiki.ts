// Project wiki on SELISE Blocks: reads straight from the Data Gateway (tree fields only, bodies on demand), writes through
// the Logic Function "collab". One requestId per user action; answered rows go into the cache (read-your-write).
import { useEffect, useRef } from "react";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryClient } from "../queryClient";
import { callFunction, FunctionError, newRequestId } from "../fn";
import { blocksAllOptions, blocksItemOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { blocksKeys } from "../data/keys";
import { useEngineJobs } from "../engine/jobs";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "../engine/types";
import { sortPages, type WikiPage, type WikiSource } from "@/data/wiki/types";
import { isWikiGroup, parseSources } from "@/domain/wiki";
import {
  WIKI_BODY_FIELDS,
  WIKI_COUNT_FIELDS,
  WIKI_PAGE_FIELDS,
  WIKI_HISTORY_FIELDS,
  WIKI_TREE_FIELDS,
  toWikiHistory,
  toWikiPage,
  type WikiHistoryRecord,
  type WikiPageRecord,
} from "./records";
import { useCollabContext } from "./context";

export const WIKI_PAGE_SCHEMA = "WikiPage";
export const WIKI_HISTORY_SCHEMA = "WikiPageHistory";

const MAX_PAGES = 300;
const HISTORY_SHOWN = 50;
const MAX_DELETE_CALLS = 400;

type RawRow = Record<string, unknown>;
const w = whereOf<RawRow>();

const isRow = (v: unknown): v is RawRow => typeof v === "object" && v !== null && typeof (v as RawRow).ItemId === "string";

// ---------------------------------------------------------------- view model

/** A page record as the screen reads it. A record whose group is unknown is dropped, never guessed. */
export function toViewPage(r: WikiPageRecord): WikiPage | null {
  if (!isWikiGroup(r.group)) return null;
  const s = parseSources(r.sourcesJson);
  const sources: WikiSource[] = s.items.map((x) => ({ kind: x.ref.split(":")[0] ?? "", label: x.label, ref: x.ref }));
  return {
    id: r.id,
    projectId: r.projectId,
    slug: r.slug,
    group: r.group,
    title: r.title,
    order: s.order ?? Number.MAX_SAFE_INTEGER,
    bodyMd: r.bodyMd ?? "",
    sources,
    origin: r.origin,
    updatedWithVersion: r.updatedWithVersion,
    updatedAt: r.updatedAt,
  };
}

const compact = <T,>(xs: (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined);

export const mapTree = (rows: RawRow[]): WikiPage[] =>
  sortPages(compact(compact(rows.map((row) => toWikiPage(row) as WikiPageRecord | null)).map(toViewPage)));

// ---------------------------------------------------------------- reads

export function wikiTreeOptions(workspaceId: string | null | undefined, projectId: string | null | undefined) {
  return blocksAllOptions<RawRow>(WIKI_PAGE_SCHEMA, {
    workspaceId,
    fields: WIKI_TREE_FIELDS,
    where: w.eq("ProjectId", projectId ?? ""),
    sort: [{ field: "Slug", dir: "asc" }],
    maxItems: MAX_PAGES,
  });
}

/** The project's pages without their bodies, in tree order. */
export function useWikiPages(projectId: string | null | undefined): UseQueryResult<WikiPage[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  const base = wikiTreeOptions(workspaceId, projectId);
  return useQuery({ ...base, enabled: base.enabled && Boolean(projectId), select: mapTree });
}

/** A page's body and the time it was last written (the article and the editor). */
export interface WikiBody { bodyMd: string; updatedAt: string }

export function toWikiBody(row: RawRow | null): WikiBody | null {
  if (!row || typeof row.BodyMd !== "string") return null;
  return { bodyMd: row.BodyMd, updatedAt: typeof row.LastUpdatedDate === "string" ? row.LastUpdatedDate : "" };
}

export function wikiBodyOptions(workspaceId: string | null | undefined, pageId: string | null | undefined) {
  return blocksItemOptions<RawRow>(WIKI_PAGE_SCHEMA, pageId, { workspaceId, fields: WIKI_BODY_FIELDS });
}

export function useWikiBody(pageId: string | null | undefined): UseQueryResult<WikiBody | null, BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({ ...wikiBodyOptions(workspaceId, pageId), select: toWikiBody });
}

export function wikiBodiesOptions(workspaceId: string | null | undefined, projectId: string | null | undefined) {
  return blocksAllOptions<RawRow>(WIKI_PAGE_SCHEMA, {
    workspaceId,
    fields: WIKI_PAGE_FIELDS,
    where: w.eq("ProjectId", projectId ?? ""),
    sort: [{ field: "Slug", dir: "asc" }],
    maxItems: MAX_PAGES,
  });
}

/** Every page with its body, read lazily (search and questions) and only when `enabled`. */
export function useWikiBodies(projectId: string | null | undefined, enabled: boolean): UseQueryResult<WikiPage[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  const base = wikiBodiesOptions(workspaceId, projectId);
  return useQuery({ ...base, enabled: base.enabled && enabled && Boolean(projectId), select: mapTree });
}

export function wikiHistoryOptions(workspaceId: string | null | undefined, pageId: string | null | undefined) {
  return blocksAllOptions<RawRow>(WIKI_HISTORY_SCHEMA, {
    workspaceId,
    fields: WIKI_HISTORY_FIELDS,
    where: w.eq("PageId", pageId ?? ""),
    sort: [{ field: "At", dir: "desc" }],
    maxItems: HISTORY_SHOWN,
  });
}

/** A page's earlier bodies, newest first (at most 50). */
export function useWikiHistory(pageId: string | null | undefined): UseQueryResult<WikiHistoryRecord[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  const base = wikiHistoryOptions(workspaceId, pageId);
  return useQuery({
    ...base,
    enabled: base.enabled && Boolean(pageId),
    select: (rows: RawRow[]) => compact(rows.map((r) => toWikiHistory(r) as WikiHistoryRecord | null)),
  });
}

export function wikiCountsOptions(workspaceId: string | null | undefined) {
  return blocksAllOptions<RawRow>(WIKI_PAGE_SCHEMA, { workspaceId, fields: WIKI_COUNT_FIELDS, maxItems: 5000 });
}

/** Pages per project over the whole workspace: one read, counted in the browser. */
export function useWikiPageCounts(): UseQueryResult<Map<string, number>, BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({ ...wikiCountsOptions(workspaceId), select: countByProject });
}

export function countByProject(rows: RawRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = typeof r.ProjectId === "string" ? r.ProjectId : "";
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------- writes

/** Put one answered page row into the caches (item, tree list, counts) and refresh the schema. */
export function cachePageRow(workspaceId: string, projectId: string, row: RawRow): void {
  if (!isRow(row)) return;
  const id = String(row.ItemId);
  queryClient.setQueryData(blocksKeys.item(workspaceId, WIKI_PAGE_SCHEMA, id), (old: unknown) => (isRow(old) ? { ...old, ...row } : row));
  const pick = (r: RawRow, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
  const tree = wikiTreeOptions(workspaceId, projectId).queryKey;
  queryClient.setQueryData(tree, (old: RawRow[] | undefined) => {
    if (!old) return old;
    const next = pick(row, WIKI_TREE_FIELDS);
    return old.some((x) => x.ItemId === id) ? old.map((x) => (x.ItemId === id ? { ...x, ...next } : x)) : [...old, next];
  });
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_PAGE_SCHEMA) });
}

function cacheHistoryRows(workspaceId: string, rows: readonly RawRow[]): void {
  for (const row of rows) {
    if (isRow(row)) queryClient.setQueryData(blocksKeys.item(workspaceId, WIKI_HISTORY_SCHEMA, String(row.ItemId)), row);
  }
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_HISTORY_SCHEMA) });
}

function dropPage(workspaceId: string, projectId: string, pageId: string): void {
  queryClient.removeQueries({ queryKey: blocksKeys.item(workspaceId, WIKI_PAGE_SCHEMA, pageId) });
  queryClient.setQueryData(wikiTreeOptions(workspaceId, projectId).queryKey, (old: RawRow[] | undefined) => old?.filter((x) => x.ItemId !== pageId));
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_PAGE_SCHEMA) });
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_HISTORY_SCHEMA) });
}

export interface WriteOpts {
  /** Reuse the id of a failed attempt so the server answers a finished one again. */
  requestId?: string;
}

export interface WikiSaved {
  page: WikiPage;
  history: WikiHistoryRecord[];
  unchanged: boolean;
}

function savedFrom(workspaceId: string, projectId: string, data: { page?: RawRow; history?: RawRow[]; unchanged?: boolean }): WikiSaved {
  const page = data.page ? (mapTree([data.page])[0] ?? null) : null;
  if (!page || !data.page) throw new FunctionError("unknown", "The wiki page could not be read.", "");
  cachePageRow(workspaceId, projectId, data.page);
  const history = Array.isArray(data.history) ? data.history : [];
  cacheHistoryRows(workspaceId, history);
  return { page, history: compact(history.map((r) => toWikiHistory(r) as WikiHistoryRecord | null)), unchanged: data.unchanged === true };
}

export interface CreateWikiPageArgs { projectId: string; title: string; pageGroup: string; bodyMd?: string }
export interface SaveWikiPageArgs { projectId: string; pageId: string; bodyMd: string; title?: string; expectedUpdatedAt?: string }
export interface RestoreWikiPageArgs { projectId: string; pageId: string; historyId: string; expectedUpdatedAt?: string }
export interface DeleteWikiPageArgs { projectId: string; pageId: string }

export async function createWikiPage(workspaceId: string, args: CreateWikiPageArgs, opts: WriteOpts = {}): Promise<WikiPage> {
  const res = await callFunction<{ page?: RawRow }>("collab", "wiki.page.create", { ...args }, { requestId: opts.requestId ?? newRequestId() });
  return savedFrom(workspaceId, args.projectId, res.data).page;
}

export async function saveWikiPage(workspaceId: string, args: SaveWikiPageArgs, opts: WriteOpts = {}): Promise<WikiSaved> {
  const res = await callFunction<{ page?: RawRow; history?: RawRow[]; unchanged?: boolean }>("collab", "wiki.page.save", { ...args }, { requestId: opts.requestId ?? newRequestId() });
  return savedFrom(workspaceId, args.projectId, res.data);
}

export async function restoreWikiPage(workspaceId: string, args: RestoreWikiPageArgs, opts: WriteOpts = {}): Promise<WikiSaved> {
  const res = await callFunction<{ page?: RawRow; history?: RawRow[]; unchanged?: boolean }>("collab", "wiki.page.restore", { ...args }, { requestId: opts.requestId ?? newRequestId() });
  return savedFrom(workspaceId, args.projectId, res.data);
}

/** Deletes a person page: the server removes it in steps, so this calls again until it says done. */
export async function deleteWikiPage(
  workspaceId: string,
  args: DeleteWikiPageArgs,
  onProgress?: (remaining: number) => void,
): Promise<void> {
  for (let i = 0; i < MAX_DELETE_CALLS; i++) {
    const res = await callFunction<{ done?: boolean; remaining?: number }>("collab", "wiki.page.delete", { ...args }, { requestId: newRequestId() });
    const remaining = typeof res.data.remaining === "number" ? res.data.remaining : 0;
    onProgress?.(remaining);
    if (res.data.done === true) {
      dropPage(workspaceId, args.projectId, args.pageId);
      return;
    }
  }
  throw new FunctionError("unknown", "The page is still being deleted. Try again.", "");
}

export interface GeneratedWikiJob { jobId: string; existing: boolean }

export async function generateWiki(projectId: string, opts: WriteOpts = {}): Promise<GeneratedWikiJob> {
  const res = await callFunction<{ jobId?: unknown; existing?: unknown }>("collab", "wiki.generate", { projectId }, { requestId: opts.requestId ?? newRequestId() });
  if (typeof res.data.jobId !== "string" || res.data.jobId === "") throw new FunctionError("unknown", "The wiki job could not be queued.", res.requestId);
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "ws" && q.queryKey[2] === "EngineJob" });
  return { jobId: res.data.jobId, existing: res.data.existing === true };
}

export function useCreateWikiPage() {
  const { workspaceId } = useCollabContext();
  return useMutation<WikiPage, Error, CreateWikiPageArgs & WriteOpts>({
    retry: 0,
    mutationFn: ({ requestId, ...args }) => createWikiPage(workspaceId ?? "", args, { requestId }),
  });
}

export function useSaveWikiPage() {
  const { workspaceId } = useCollabContext();
  return useMutation<WikiSaved, Error, SaveWikiPageArgs & WriteOpts>({
    retry: 0,
    mutationFn: ({ requestId, ...args }) => saveWikiPage(workspaceId ?? "", args, { requestId }),
  });
}

export function useRestoreWikiPage() {
  const { workspaceId } = useCollabContext();
  return useMutation<WikiSaved, Error, RestoreWikiPageArgs & WriteOpts>({
    retry: 0,
    mutationFn: ({ requestId, ...args }) => restoreWikiPage(workspaceId ?? "", args, { requestId }),
  });
}

export function useDeleteWikiPage() {
  const { workspaceId } = useCollabContext();
  return useMutation<void, Error, DeleteWikiPageArgs & { onProgress?: (remaining: number) => void }>({
    retry: 0,
    mutationFn: ({ onProgress, ...args }) => deleteWikiPage(workspaceId ?? "", args, onProgress),
  });
}

export function useGenerateWiki() {
  return useMutation<GeneratedWikiJob, Error, { projectId: string } & WriteOpts>({
    retry: 0,
    mutationFn: ({ projectId, requestId }) => generateWiki(projectId, { requestId }),
  });
}

// ---------------------------------------------------------------- the generate job

/** True when a job was active and no longer is: the engine may have written pages. */
export const jobLeftActive = (wasActive: boolean, active: boolean): boolean => wasActive && !active;

/** Re-reads pages and history after a wiki.generate job finished. */
export function refreshWikiAfterJob(workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_PAGE_SCHEMA) });
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, WIKI_HISTORY_SCHEMA) });
}

/** The project's wiki.generate jobs; a job that leaves the active states refreshes the pages. */
export function useWikiJob(projectId: string | null | undefined): { job: EngineJob | null; jobs: EngineJob[] } {
  const { workspaceId } = useCollabContext();
  const q = useEngineJobs(projectId, ["wiki.generate"]);
  const jobs = q.data ?? [];
  const job = latestEngineJob(jobs, "wiki.generate");
  const wasActive = useRef(false);
  const active = jobs.some(isActiveEngineJob);
  useEffect(() => {
    if (jobLeftActive(wasActive.current, active) && workspaceId) refreshWikiAfterJob(workspaceId);
    wasActive.current = active;
  }, [active, workspaceId]);
  return { job, jobs };
}

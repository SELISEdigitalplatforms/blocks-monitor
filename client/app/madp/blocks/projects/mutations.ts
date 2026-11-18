// Project, share and business writes: one hook per op of the Logic Function `project`. One requestId per user action.
import { useCallback, useRef, useState } from "react";
import { queryClient } from "../queryClient";
import { callFunction, FunctionError, newRequestId } from "../fn";
import { blocksKeys } from "../data/keys";
import { invalidateSchemaLists } from "../data/hooks";
import { deliveryProjectKey } from "../delivery/context";
import { scopeProjectKey } from "../scope/context";
import { useProjectsContext } from "./context";
import {
  SCHEMA,
  assignmentFromRow,
  noteFromRow,
  projectFromRow,
  shareFromRow,
  type AssignmentRecord,
  type DocNoteRecord,
  type ProjectRecord,
  type RawRow,
  type ShareRecord,
} from "./records";

/** Calls one op of mf-project and returns its `data`. Reused by the doc mutations. */
export async function callProjectOp<T>(op: string, args: Record<string, unknown>, opts?: { requestId?: string; timeoutMs?: number }): Promise<T> {
  const res = await callFunction<T>("project", op, args, opts);
  return res.data;
}

const isRow = (v: unknown): v is RawRow => typeof v === "object" && v !== null && typeof (v as RawRow).ItemId === "string";

function merge(old: unknown, row: RawRow): unknown {
  return isRow(old) && old.ItemId === row.ItemId ? { ...old, ...row } : old;
}

/** Writes rows into the item keys and into cached lists of the schema (read-your-write), then marks the schema lists stale (one refetch per tick; item queries are not refetched). */
export function putRows(workspaceId: string, schema: string, rows: readonly RawRow[]): void {
  const byId = new Map(rows.filter(isRow).map((r) => [String(r.ItemId), r]));
  if (byId.size > 0) {
    for (const [id, row] of byId) {
      queryClient.setQueryData(blocksKeys.item(workspaceId, schema, id), (old: unknown) => (isRow(old) ? { ...old, ...row } : row));
    }
    queryClient.setQueriesData({ queryKey: blocksKeys.schema(workspaceId, schema) }, (old: unknown) => {
      if (Array.isArray(old)) return old.map((x) => (isRow(x) && byId.has(String(x.ItemId)) ? merge(x, byId.get(String(x.ItemId))!) : x));
      if (typeof old === "object" && old !== null && Array.isArray((old as { items?: unknown }).items)) {
        const page = old as { items: unknown[] };
        return { ...page, items: page.items.map((x) => (isRow(x) && byId.has(String(x.ItemId)) ? merge(x, byId.get(String(x.ItemId))!) : x)) };
      }
      return old;
    });
    // the Scope and Build/Release pages keep the project row under their own keys: a rename, a setup save or a hand-over
    // is read there again too (they kept the old name and stage until their own refresh)
    if (schema === "Project") {
      for (const id of byId.keys()) {
        void queryClient.invalidateQueries({ queryKey: deliveryProjectKey(id) });
        void queryClient.invalidateQueries({ queryKey: scopeProjectKey(id) });
      }
    }
  }
  invalidateSchemaLists(workspaceId, schema);
}

/** Removes a row from the cache (item key and cached lists) and marks the schema lists stale. */
export function dropRow(workspaceId: string, schema: string, id: string): void {
  queryClient.removeQueries({ queryKey: blocksKeys.item(workspaceId, schema, id) });
  queryClient.setQueriesData({ queryKey: blocksKeys.schema(workspaceId, schema) }, (old: unknown) => {
    if (Array.isArray(old)) return old.filter((x) => !(isRow(x) && x.ItemId === id));
    if (typeof old === "object" && old !== null && Array.isArray((old as { items?: unknown }).items)) {
      const page = old as { items: unknown[] };
      return { ...page, items: page.items.filter((x) => !(isRow(x) && x.ItemId === id)) };
    }
    return old;
  });
  invalidateSchemaLists(workspaceId, schema);
}

export interface ProjectMutationHook<A, R> {
  run: (args: A, opts?: { requestId?: string }) => Promise<R>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * Opt-in single flight for a runner, held in a synchronous holder (a ref): while a run is in flight a further run
 * gets the SAME promise and starts nothing, so one user action sends one write with one requestId.
 */
export function exclusive<P>(holder: { current: Promise<P> | null }, start: () => Promise<P>): Promise<P> {
  if (holder.current) return holder.current;
  const p = start();
  const clear = () => { if (holder.current === p) holder.current = null; };
  p.then(clear, clear);
  holder.current = p;
  return p;
}

/** Shared state wrapper: pending flag and the last error; the caller gets the result or the thrown error. `once` = single flight. */
function useRunner<A, R>(fn: (args: A, opts?: { requestId?: string }) => Promise<R>, once = false): ProjectMutationHook<A, R> {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef(fn);
  ref.current = fn;
  const flight = useRef<Promise<R> | null>(null);
  const exec = useCallback(async (args: A, opts?: { requestId?: string }): Promise<R> => {
    setPending(true);
    setError(null);
    try {
      return await ref.current(args, opts);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setPending(false);
    }
  }, []);
  const run = useCallback(
    (args: A, opts?: { requestId?: string }): Promise<R> => (once ? exclusive(flight, () => exec(args, opts)) : exec(args, opts)),
    [exec, once],
  );
  const reset = useCallback(() => setError(null), []);
  return { run, isPending, error, reset };
}

/** An answer is `{project}` or the row itself. */
function rowOf(data: unknown, key: string): RawRow {
  const inner = (data as Record<string, unknown> | null)?.[key];
  if (isRow(inner)) return inner;
  if (isRow(data)) return data;
  throw new FunctionError("unknown", "", "", undefined, undefined);
}

function rowsOf(data: unknown, key: string): RawRow[] {
  const inner = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? inner.filter(isRow) : [];
}

function useWorkspace(): string {
  return useProjectsContext().workspaceId ?? "";
}

export interface CreateProjectArgs {
  workspaceId?: string;
  name?: string;
  clientName?: string;
  clientContact?: string;
  clientIndustry?: string;
  clientRegion?: string;
  scratchMd?: string;
  projectType?: "greenfield" | "brownfield";
  /**
   * An existing repository (brownfield, or greenfield into a prepared repo): owner/name or the github.com address, with
   * repoBranch. Not together with newRepo* (project.repoMixed).
   */
  repo?: string;
  /** The existing repository's branch; for a new repository optional (default "main"). */
  repoBranch?: string;
  /** Greenfield only: the new repository MADP creates (all three together). */
  newRepoOwner?: string;
  newRepoName?: string;
  repoVisibility?: "private" | "internal";
  // The guided project start; each optional, an empty string is not stored.
  /** At most 2000 characters (trimmed). */
  goal?: string;
  /** At most 1000 characters (trimmed). */
  targetUsers?: string;
  /** An http(s) address, at most 500 characters; a bare "app.example.com" is stored as https://app.example.com. */
  appUrl?: string;
  /** The official website: an http(s) address, at most 500 characters; a bare "yourcompany.com" is stored as https://yourcompany.com. */
  websiteUrl?: string;
  /** JSON string {"available":"yes"|"no"|"unsure","url"?:string,"accessHow"?:string}, at most 2000 characters. */
  testEnv?: string;
  /** At most 5000 characters (trimmed). */
  runInstructions?: string;
  /** At most 200 characters (trimmed). */
  blocksProjectRef?: string;
  /** JSON string of an object, at most 20 000 characters. */
  setupAnswers?: string;
  setupStatus?: "draft" | "complete";
  /** The guided start's description: written into the Project brief note with the other answers (at most 2000 characters). */
  description?: string;
}

export function useCreateProject(): ProjectMutationHook<CreateProjectArgs, { project: ProjectRecord; scratchNote: DocNoteRecord | null }> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const workspaceId = args.workspaceId ?? ws;
    const data = await callProjectOp<{ project: RawRow; scratchNote?: RawRow | null; briefNote?: RawRow | null }>(
      "project.create",
      { ...args, workspaceId },
      opts,
    );
    putRows(workspaceId, SCHEMA.project, [data.project]);
    if (data.scratchNote) putRows(workspaceId, SCHEMA.note, [data.scratchNote]);
    if (data.briefNote) putRows(workspaceId, SCHEMA.note, [data.briefNote]);
    return { project: projectFromRow(data.project), scratchNote: data.scratchNote ? noteFromRow(data.scratchNote) : null };
  });
}

/** One call at a time: while a call is in flight every further call gets the SAME promise and `run` does not run again. */
export function singleFlight<A, R>(
  run: (args: A, requestId: string) => Promise<R>,
  mintId: () => string = newRequestId,
): { call: (args: A, requestId?: string) => Promise<R>; inFlight: () => boolean } {
  let current: Promise<R> | null = null;
  const call = (args: A, requestId?: string): Promise<R> => {
    if (current) return current;
    const p = (async () => run(args, requestId ?? mintId()))();
    const clear = () => { if (current === p) current = null; };
    p.then(clear, clear);
    current = p;
    return p;
  };
  return { call, inFlight: () => current !== null };
}

/** Create once per user action: a second click while the first create runs gets the first answer, with one requestId. */
export function useCreateProjectOnce(): {
  create: (args: CreateProjectArgs, requestId?: string) => Promise<{ project: ProjectRecord; scratchNote: DocNoteRecord | null }>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
} {
  const creator = useCreateProject();
  const latest = useRef(creator);
  latest.current = creator;
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const flight = useRef<ReturnType<typeof singleFlight<CreateProjectArgs, { project: ProjectRecord; scratchNote: DocNoteRecord | null }>> | null>(null);
  if (!flight.current) flight.current = singleFlight((args, requestId) => latest.current.run(args, { requestId }));
  const create = useCallback((args: CreateProjectArgs, requestId?: string) => {
    const f = flight.current!;
    if (f.inFlight()) return f.call(args, requestId);
    setPending(true);
    setError(null);
    const p = f.call(args, requestId);
    p.then(
      () => setPending(false),
      (e) => { setError(e); setPending(false); },
    );
    return p;
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { create, isPending, error, reset };
}

export function useRenameProject(): ProjectMutationHook<{ projectId: string; name: string }, ProjectRecord> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const row = rowOf(await callProjectOp("project.rename", args, opts), "project");
    putRows(ws, SCHEMA.project, [row]);
    return projectFromRow(row);
  }, true);
}

export interface UpdateProjectArgs {
  projectId: string;
  clientName?: string;
  clientContact?: string;
  clientIndustry?: string;
  clientRegion?: string;
  /** The official website (http(s)); "" clears it. Can change at any step. */
  websiteUrl?: string;
  /** An existing repository (existing product, or a new product built in one), before the hand-over: sent together with repoBranch. */
  repo?: string;
  /** With repo; or, optionally, the new repository's starting branch (main when left out). */
  repoBranch?: string;
  /** New product, until the build starts: the new repository MADP creates, sent together (repoBranch optional). */
  repoOwner?: string;
  repoName?: string;
  repoVisibility?: "private" | "internal";
}

export function useUpdateProject(): ProjectMutationHook<UpdateProjectArgs, ProjectRecord> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const row = rowOf(await callProjectOp("project.update", { ...args }, opts), "project");
    putRows(ws, SCHEMA.project, [row]);
    return projectFromRow(row);
  });
}

/** The guided start's answers changed on the Project setup page (project.setup): the fields and the Project brief note. */
export interface SetupProjectArgs {
  projectId: string;
  name?: string;
  description: string;
  goal: string;
  targetUsers: string;
  appUrl?: string;
  /** "" clears the website. */
  websiteUrl?: string;
  testEnv?: string;
  runInstructions?: string;
  blocksProjectRef?: string;
  setupAnswers: string;
}

export function useSetupProject(): ProjectMutationHook<SetupProjectArgs, ProjectRecord> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const data = await callProjectOp<{ project: RawRow; briefNote?: RawRow }>("project.setup", { ...args }, opts);
    putRows(ws, SCHEMA.project, [data.project]);
    if (data.briefNote) putRows(ws, SCHEMA.note, [data.briefNote]);
    return projectFromRow(data.project);
  });
}

export function useAssignProject(): ProjectMutationHook<{ projectId: string; assigneeUserId: string }, { project: ProjectRecord; assignment: AssignmentRecord }> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const data = await callProjectOp<{ project: RawRow; assignment: RawRow }>("project.assign", args, opts);
    putRows(ws, SCHEMA.project, [data.project]);
    putRows(ws, SCHEMA.assignment, [data.assignment]);
    return { project: projectFromRow(data.project), assignment: assignmentFromRow(data.assignment) };
  }, true);
}

export function useCreateShare(): ProjectMutationHook<
  { projectId: string; itemType: string; itemRef: string; userIds: string[] },
  { shares: ShareRecord[]; created: string[] }
> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    const data = await callProjectOp<{ shares: RawRow[]; created?: unknown[] }>("share.create", args, opts);
    const rows = rowsOf(data, "shares");
    putRows(ws, SCHEMA.share, rows);
    const created = (data.created ?? []).map((c) => (isRow(c) ? c.ItemId : c)).filter((c): c is string => typeof c === "string");
    return { shares: rows.map(shareFromRow), created };
  }, true);
}

export function useDeleteShare(): ProjectMutationHook<{ projectId: string; shareId: string }, void> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    await callProjectOp("share.delete", args, opts);
    dropRow(ws, SCHEMA.share, args.shareId);
  }, true);
}

export function useHandOver(): ProjectMutationHook<{ projectId: string }, ProjectRecord> {
  const ws = useWorkspace();
  return useRunner(async (args, opts) => {
    try {
      const row = rowOf(await callProjectOp("business.handOver", args, opts), "project");
      putRows(ws, SCHEMA.project, [row]);
      // the hand-over queued the business analyst's readings: lists that stopped polling (nothing was active) read again
      invalidateSchemaLists(ws, "EngineJob");
      return projectFromRow(row);
    } catch (e) {
      if (e instanceof FunctionError && e.code === "conflict" && e.messageKey === "business.alreadyHandedOver") {
        queryClient.removeQueries({ queryKey: blocksKeys.item(ws, SCHEMA.project, args.projectId) });
        void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(ws, SCHEMA.project) });
      }
      throw e;
    }
  }, true);
}

type DeleteStep = { done: boolean; remaining: number; deleted?: unknown; queued?: boolean };
const MAX_DELETE_CALLS = 500;

/** Client-only marker on a cached Project row while its delete is in flight; never sent to the server. */
export const PENDING_DELETE = "_mfPendingDelete";

/** Applies `fn` to every row of a cached list (array or page) whose ItemId is `id`. */
function mapRowIn(old: unknown, id: string, fn: (r: RawRow) => RawRow): unknown {
  const one = (x: unknown) => (isRow(x) && x.ItemId === id ? fn(x) : x);
  if (Array.isArray(old)) return old.map(one);
  if (typeof old === "object" && old !== null && Array.isArray((old as { items?: unknown }).items)) {
    const page = old as { items: unknown[] };
    return { ...page, items: page.items.map(one) };
  }
  return isRow(old) ? one(old) : old;
}

/**
 * Delete a project: the row turns "deleting" in every cached list at once, ONE project.delete call queues the purge
 * (an older server may answer done:false: then it is called again with a NEW requestId), then the row is dropped.
 * A failure restores the cache exactly as it was.
 */
export function useDeleteProject(): {
  run: (projectId: string) => Promise<void>;
  remaining: number | null;
  isRunning: boolean;
  error: unknown;
} {
  const ws = useWorkspace();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const flight = useRef<Promise<void> | null>(null);
  const exec = useCallback(
    async (projectId: string): Promise<void> => {
      setRunning(true);
      setError(null);
      const itemKey = blocksKeys.item(ws, SCHEMA.project, projectId);
      const snapshot = queryClient.getQueriesData({ queryKey: blocksKeys.schema(ws, SCHEMA.project) });
      const itemBefore = queryClient.getQueryData(itemKey);
      const mark = (r: RawRow): RawRow => ({ ...r, Status: "deleting", [PENDING_DELETE]: true });
      queryClient.setQueriesData({ queryKey: blocksKeys.schema(ws, SCHEMA.project) }, (old: unknown) => mapRowIn(old, projectId, mark));
      queryClient.setQueryData(itemKey, (old: unknown) => (isRow(old) ? mark(old) : old));
      try {
        for (let i = 0; i < MAX_DELETE_CALLS; i++) {
          const step = await callProjectOp<DeleteStep>("project.delete", { projectId }, { requestId: newRequestId() });
          setRemaining(step.remaining);
          if (step.done) {
            dropRow(ws, SCHEMA.project, projectId);
            setRemaining(0);
            return;
          }
        }
        throw new FunctionError("timeout", "", "");
      } catch (e) {
        for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
        if (itemBefore !== undefined) queryClient.setQueryData(itemKey, itemBefore);
        invalidateSchemaLists(ws, SCHEMA.project);
        setError(e);
        throw e;
      } finally {
        setRunning(false);
      }
    },
    [ws],
  );
  const run = useCallback((projectId: string): Promise<void> => exclusive(flight, () => exec(projectId)), [exec]);
  return { run, remaining, isRunning, error };
}

// Business document writes: one function per op (testable without React) and thin hooks over them.
// Every write goes through callProjectOp; answers are put into the cache (read-your-write) and the Doc* schemas invalidated.
import { useCallback, useRef, useState } from "react";
import { queryClient } from "../queryClient";
import { blocksKeys } from "../data/keys";
import { placeBefore, type DocRef } from "../../domain/docs";
import {
  SCHEMA,
  folderFromRow,
  noteFromRow,
  fileFromRow,
  type DocFolderRecord,
  type DocNoteRecord,
  type DocFileRecord,
} from "./records";
import { useProjectsContext } from "./context";
import { callProjectOp, putRows, dropRow, exclusive } from "./mutations";
import { docTreeKeys, type DocRow } from "./docReads";

type DocSchema = typeof SCHEMA.folder | typeof SCHEMA.note | typeof SCHEMA.file;

const MAX_RESUME_CALLS = 400;
const MAX_STALLED_CALLS = 5;

// ---------------------------------------------------------------- cache helpers

const idOf = (r: DocRow): string => String(r.ItemId ?? "");
const orderOf = (r: DocRow): number => (typeof r.SortOrder === "number" ? r.SortOrder : 0);

function listKey(ws: string, projectId: string, schema: DocSchema) {
  const k = docTreeKeys(ws, projectId);
  return schema === SCHEMA.folder ? k.folders : schema === SCHEMA.note ? k.notes : k.files;
}

function setList(key: readonly unknown[], fn: (rows: DocRow[]) => DocRow[]): void {
  queryClient.setQueryData<DocRow[]>(key, (old) => (old ? fn(old) : old));
}

function upsert(rows: DocRow[], row: DocRow): DocRow[] {
  const id = idOf(row);
  return rows.some((r) => idOf(r) === id) ? rows.map((r) => (idOf(r) === id ? { ...r, ...row } : r)) : [...rows, row];
}

/** Put one answered row into the item cache and the project's tree list, then refresh the schema. */
export function cacheRow(ws: string, projectId: string, schema: DocSchema, row: DocRow): void {
  putRows(ws, schema, [row]);
  const treeRow: DocRow = { ...row };
  if (schema === SCHEMA.note) delete treeRow.BodyMd;
  setList(listKey(ws, projectId, schema), (rows) => upsert(rows, treeRow));
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(ws, schema) });
}

function uncacheRow(ws: string, projectId: string, schema: DocSchema, id: string): void {
  dropRow(ws, schema, id);
  setList(listKey(ws, projectId, schema), (rows) => rows.filter((r) => idOf(r) !== id));
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(ws, schema) });
}

// ---------------------------------------------------------------- optimistic placement

type Snapshot = [readonly unknown[], DocRow[] | undefined][];

function applyOptimisticMove(
  ws: string,
  a: { projectId: string; ref: DocRef; folderId: string; beforeId: string | null },
): Snapshot {
  const keys = docTreeKeys(ws, a.projectId);
  const all = [keys.folders, keys.notes, keys.files];
  const snapshot: Snapshot = all.map((k) => [k, queryClient.getQueryData<DocRow[]>(k)]);
  const folders = queryClient.getQueryData<DocRow[]>(keys.folders) ?? [];
  const notes = queryClient.getQueryData<DocRow[]>(keys.notes) ?? [];
  const files = queryClient.getQueryData<DocRow[]>(keys.files) ?? [];
  const isFolder = a.ref.kind === "folder";
  const siblings = (isFolder
    ? folders.filter((r) => String(r.ParentId ?? "") === a.folderId)
    : [...notes, ...files].filter((r) => String(r.FolderId ?? "") === a.folderId)
  ).map((r) => ({ id: idOf(r), sortOrder: orderOf(r) }));
  const rest = siblings.filter((s) => s.id !== a.ref.id).sort((x, y) => x.sortOrder - y.sortOrder);
  const placed = placeBefore(rest, a.beforeId);
  if (!placed.ok) return snapshot;
  const renumbered = new Map(placed.renumber.map((r) => [r.id, r.sortOrder]));
  const place = (rows: DocRow[], parentField: "ParentId" | "FolderId"): DocRow[] =>
    rows.map((r) => {
      const id = idOf(r);
      if (id === a.ref.id) return { ...r, [parentField]: a.folderId, SortOrder: placed.sortOrder };
      const renumberedTo = renumbered.get(id);
      return renumberedTo === undefined ? r : { ...r, SortOrder: renumberedTo };
    });
  if (isFolder) setList(keys.folders, (rows) => place(rows, "ParentId"));
  else {
    setList(a.ref.kind === "note" ? keys.notes : keys.files, (rows) => place(rows, "FolderId"));
    if (renumbered.size > 0) setList(a.ref.kind === "note" ? keys.files : keys.notes, (rows) => place(rows, "FolderId"));
  }
  return snapshot;
}

function restore(snapshot: Snapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

// ---------------------------------------------------------------- the ops

export interface SaveNoteArgs {
  projectId: string;
  noteId?: string;
  folderId: string;
  title: string;
  bodyMd: string;
  expectedUpdatedAt?: string;
  scratch?: boolean;
}

export async function createFolder(
  ws: string,
  args: { projectId: string; parentId: string; name: string; kind: string; beforeId?: string | null },
): Promise<DocFolderRecord> {
  const data = await callProjectOp<{ folder: DocRow }>("doc.folder.create", args);
  cacheRow(ws, args.projectId, SCHEMA.folder, data.folder);
  return folderFromRow(data.folder);
}

export async function renameFolder(
  ws: string,
  args: { projectId: string; folderId: string; name: string; kind?: string },
): Promise<DocFolderRecord> {
  const data = await callProjectOp<{ folder: DocRow }>("doc.folder.rename", args);
  cacheRow(ws, args.projectId, SCHEMA.folder, data.folder);
  return folderFromRow(data.folder);
}

/** Optimistic move; on failure the caches are restored and the error is rethrown. */
export async function moveDocItem(
  ws: string,
  a: { projectId: string; ref: DocRef; folderId: string; beforeId: string | null },
): Promise<void> {
  const snapshot = applyOptimisticMove(ws, a);
  try {
    if (a.ref.kind === "folder") {
      const data = await callProjectOp<{ folder: DocRow; renumbered?: boolean }>("doc.folder.move", {
        projectId: a.projectId,
        folderId: a.ref.id,
        parentId: a.folderId,
        beforeId: a.beforeId,
      });
      finishMove(ws, a.projectId, SCHEMA.folder, data.folder, data.renumbered);
    } else if (a.ref.kind === "note") {
      const data = await callProjectOp<{ note: DocRow; renumbered?: boolean }>("doc.note.move", {
        projectId: a.projectId,
        noteId: a.ref.id,
        folderId: a.folderId,
        beforeId: a.beforeId,
      });
      finishMove(ws, a.projectId, SCHEMA.note, data.note, data.renumbered);
    } else {
      const data = await callProjectOp<{ file: DocRow; renumbered?: boolean }>("doc.file.move", {
        projectId: a.projectId,
        fileId: a.ref.id,
        folderId: a.folderId,
        beforeId: a.beforeId,
      });
      finishMove(ws, a.projectId, SCHEMA.file, data.file, data.renumbered);
    }
  } catch (e) {
    restore(snapshot);
    throw e;
  }
}

function finishMove(ws: string, projectId: string, schema: DocSchema, row: DocRow, renumbered: boolean | undefined): void {
  cacheRow(ws, projectId, schema, row);
  if (renumbered) {
    for (const s of [SCHEMA.folder, SCHEMA.note, SCHEMA.file]) {
      void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(ws, s) });
    }
  }
}

/** The folder ids of a folder's subtree (itself included) in a cached folder list. */
function subtreeIds(folders: DocRow[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (!ids.has(idOf(f)) && ids.has(String(f.ParentId ?? ""))) {
        ids.add(idOf(f));
        grew = true;
      }
    }
  }
  return ids;
}

/** Resume loop: a NEW requestId per call (the default) until the server answers done. */
export async function deleteFolderLoop(
  ws: string,
  args: { projectId: string; folderId: string },
  onProgress?: (remaining: number) => void,
): Promise<void> {
  const keys = docTreeKeys(ws, args.projectId);
  let last = Infinity;
  let stalled = 0;
  for (let i = 0; i < MAX_RESUME_CALLS; i++) {
    const data = await callProjectOp<{ done: boolean; remaining: number; deleted?: number }>("doc.folder.delete", args);
    if (data.done) {
      const folders = queryClient.getQueryData<DocRow[]>(keys.folders) ?? [];
      const gone = subtreeIds(folders, args.folderId);
      setList(keys.folders, (rows) => rows.filter((r) => !gone.has(idOf(r))));
      setList(keys.notes, (rows) => rows.filter((r) => !gone.has(String(r.FolderId ?? ""))));
      setList(keys.files, (rows) => rows.filter((r) => !gone.has(String(r.FolderId ?? ""))));
      for (const s of [SCHEMA.folder, SCHEMA.note, SCHEMA.file]) {
        void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(ws, s) });
      }
      onProgress?.(0);
      return;
    }
    if (i === 0) setList(keys.folders, (rows) => rows.map((r) => (idOf(r) === args.folderId ? { ...r, Status: "deleting" } : r)));
    onProgress?.(data.remaining);
    stalled = data.remaining >= last ? stalled + 1 : 0;
    if (stalled >= MAX_STALLED_CALLS) break;
    last = data.remaining;
  }
  throw new Error("Deleting stopped making progress.");
}

export async function saveNote(ws: string, args: SaveNoteArgs): Promise<DocNoteRecord> {
  const data = await callProjectOp<{ note: DocRow }>("doc.note.save", args as unknown as Record<string, unknown>);
  cacheRow(ws, args.projectId, SCHEMA.note, data.note);
  return noteFromRow(data.note);
}

export async function deleteNote(ws: string, args: { projectId: string; noteId: string }): Promise<void> {
  await callProjectOp<{ noteId: string }>("doc.note.delete", args);
  uncacheRow(ws, args.projectId, SCHEMA.note, args.noteId);
}

export async function renameFile(ws: string, args: { projectId: string; fileId: string; name: string }): Promise<DocFileRecord> {
  const data = await callProjectOp<{ file: DocRow }>("doc.file.rename", args);
  cacheRow(ws, args.projectId, SCHEMA.file, data.file);
  return fileFromRow(data.file);
}

export async function deleteFile(ws: string, args: { projectId: string; fileId: string }): Promise<void> {
  await callProjectOp<{ fileId: string }>("doc.file.delete", args);
  uncacheRow(ws, args.projectId, SCHEMA.file, args.fileId);
}

/** A short-lived URL, requested on demand. Never cached, stored or logged by this module. */
export async function getFileUrl(projectId: string, fileId: string): Promise<{ url: string; expiresAt: string }> {
  const data = await callProjectOp<{ url: string; expiresAt: string }>("doc.file.url", { projectId, fileId });
  return { url: data.url, expiresAt: data.expiresAt };
}

// ---------------------------------------------------------------- hooks

export interface MutationHook<A, R> {
  run: (args: A) => Promise<R>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

function useWorkspaceId(): string {
  const { workspaceId } = useProjectsContext();
  return workspaceId ?? "";
}

/** `once` = single flight: a run while one is in flight returns the same promise and writes nothing. */
function useRunner<A, R>(fn: (args: A) => Promise<R>, once = false): MutationHook<A, R> {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef(fn);
  ref.current = fn;
  const flight = useRef<Promise<R> | null>(null);
  const exec = useCallback(async (args: A): Promise<R> => {
    setPending(true);
    setError(null);
    try {
      return await ref.current(args);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setPending(false);
    }
  }, []);
  const run = useCallback((args: A): Promise<R> => (once ? exclusive(flight, () => exec(args)) : exec(args)), [exec, once]);
  const reset = useCallback(() => setError(null), []);
  return { run, isPending, error, reset };
}

function withWorkspace<A, R>(ws: string, fn: (ws: string, args: A) => Promise<R>): (args: A) => Promise<R> {
  return (args) => {
    if (!ws) return Promise.reject(new Error("No active workspace."));
    return fn(ws, args);
  };
}

export const useCreateFolder = () => useRunner(withWorkspace(useWorkspaceId(), createFolder), true);
export const useRenameFolder = () => useRunner(withWorkspace(useWorkspaceId(), renameFolder), true);
export const useMoveDocItem = () => useRunner(withWorkspace(useWorkspaceId(), moveDocItem), true);
export const useSaveNote = () => useRunner(withWorkspace(useWorkspaceId(), saveNote));
export const useDeleteNote = () => useRunner(withWorkspace(useWorkspaceId(), deleteNote), true);
export const useRenameFile = () => useRunner(withWorkspace(useWorkspaceId(), renameFile), true);
export const useDeleteFile = () => useRunner(withWorkspace(useWorkspaceId(), deleteFile), true);

export function useDeleteFolder(): {
  run: (args: { projectId: string; folderId: string }) => Promise<void>;
  remaining: number | null;
  isRunning: boolean;
  error: unknown;
} {
  const ws = useWorkspaceId();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const flight = useRef<Promise<void> | null>(null);
  const exec = useCallback(
    async (args: { projectId: string; folderId: string }): Promise<void> => {
      if (!ws) throw new Error("No active workspace.");
      setRunning(true);
      setError(null);
      try {
        await deleteFolderLoop(ws, args, setRemaining);
        setRemaining(null);
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setRunning(false);
      }
    },
    [ws],
  );
  const run = useCallback((args: { projectId: string; folderId: string }): Promise<void> => exclusive(flight, () => exec(args)), [exec]);
  return { run, remaining, isRunning, error };
}

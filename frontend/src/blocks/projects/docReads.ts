// Business document reads: the folder/note/file tree, one note's body, search, and the "new since hand-over" count.
// Reads go only through the src/blocks/data hooks; the workspace clause is AND-ed by them.
import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { blocksAllOptions, blocksItemOptions } from "../data/hooks";
import { whereOf, type FieldOf } from "../data/gql";
import { buildTree, searchDocs, isNewSinceHandOver, SCRATCH_TITLE, type DocTree, type SearchEntry, type SearchHit } from "../../domain/docs";
import {
  SCHEMA,
  FOLDER_FIELDS,
  NOTE_TREE_FIELDS,
  NOTE_BODY_FIELDS,
  FILE_FIELDS,
  folderFromRow,
  noteFromRow,
  fileFromRow,
  type DocFolderRecord,
  type DocNoteRecord,
  type DocFileRecord,
} from "./records";
import { useProjectsContext } from "./context";
import { useProject } from "./reads";
import { SCRATCH_ID } from "../../components/business/treeModel";

/** A raw S1 row as the gateway returns it. */
export type DocRow = Record<string, unknown>;

export interface DocTreeData {
  folders: DocFolderRecord[];
  notes: DocNoteRecord[];
  files: DocFileRecord[];
  tree: DocTree;
  scratch: DocNoteRecord | null;
  /** Folders being deleted whose parent is not itself being deleted (the roots of an interrupted delete). */
  deletingFolders: DocFolderRecord[];
  counts: { folders: number; notes: number; files: number; readyFiles: number; usedBytes: number };
}

const rows = whereOf<DocRow>();

function treeParams(workspaceId: string | null | undefined, projectId: string) {
  const byProject = rows.eq("ProjectId", projectId);
  return {
    folders: { workspaceId, fields: FOLDER_FIELDS as readonly FieldOf<DocRow>[], where: byProject },
    notes: { workspaceId, fields: NOTE_TREE_FIELDS as readonly FieldOf<DocRow>[], where: byProject },
    files: {
      workspaceId,
      fields: FILE_FIELDS as readonly FieldOf<DocRow>[],
      where: rows.and(byProject, rows.in("Status", ["pending", "ready"])),
    },
  };
}

/** The exact query keys of the three tree queries (for optimistic writes). */
export function docTreeKeys(ws: string, projectId: string) {
  const p = treeParams(ws, projectId);
  return {
    folders: blocksAllOptions<DocRow>(SCHEMA.folder, p.folders).queryKey,
    notes: blocksAllOptions<DocRow>(SCHEMA.note, p.notes).queryKey,
    files: blocksAllOptions<DocRow>(SCHEMA.file, p.files).queryKey,
  };
}

/** The three tree queries' options, exactly as useDocTree runs them (also used to prefetch the Business page). */
export function docTreeQueries(workspaceId: string | null | undefined, projectId: string) {
  const p = treeParams(workspaceId, projectId);
  return {
    folders: blocksAllOptions<DocRow>(SCHEMA.folder, p.folders),
    notes: blocksAllOptions<DocRow>(SCHEMA.note, p.notes),
    files: blocksAllOptions<DocRow>(SCHEMA.file, p.files),
  };
}

/** Assemble the tree data from the three record lists (pure). */
export function assembleDocTree(folders: DocFolderRecord[], notes: DocNoteRecord[], files: DocFileRecord[]): DocTreeData {
  const deleting = new Set(folders.filter((f) => f.status === "deleting").map((f) => f.id));
  const live = files.filter((f) => f.status === "pending" || f.status === "ready");
  return {
    folders,
    notes,
    files: live,
    tree: buildTree(folders, notes, live),
    scratch: notes.find((n) => n.isScratch) ?? null,
    deletingFolders: folders.filter((f) => f.status === "deleting" && !deleting.has(f.parentId)),
    counts: {
      folders: folders.length,
      notes: notes.length,
      files: live.length,
      readyFiles: live.filter((f) => f.status === "ready").length,
      usedBytes: live.reduce((sum, f) => sum + (f.sizeBytes || 0), 0),
    },
  };
}

export function useDocTree(projectId: string): {
  data: DocTreeData | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { workspaceId } = useProjectsContext();
  const q = docTreeQueries(workspaceId, projectId);
  const folders = useQuery(q.folders);
  const notes = useQuery(q.notes);
  const files = useQuery(q.files);
  const data = useMemo(() => {
    if (!folders.data || !notes.data || !files.data) return undefined;
    return assembleDocTree(folders.data.map(folderFromRow), notes.data.map(noteFromRow), files.data.map(fileFromRow));
  }, [folders.data, notes.data, files.data]);
  return {
    data,
    isLoading: folders.isLoading || notes.isLoading || files.isLoading,
    error: folders.error ?? notes.error ?? files.error ?? null,
    refetch: () => {
      void folders.refetch();
      void notes.refetch();
      void files.refetch();
    },
  };
}

/** One note with its body (the tree queries leave BodyMd out). */
export function useDocNoteBody(noteId: string | null): UseQueryResult<DocNoteRecord | null> {
  const { workspaceId } = useProjectsContext();
  const opts = blocksItemOptions<DocRow>(SCHEMA.note, noteId, {
    workspaceId,
    fields: NOTE_BODY_FIELDS as readonly FieldOf<DocRow>[],
  });
  return useQuery({ ...opts, select: (row: DocRow | null) => (row ? noteFromRow(row) : null) });
}

/** The search index: names filtered at once; bodies by `bodies` (id → text) once loaded. */
export function buildSearchIndex(data: DocTreeData, bodies: ReadonlyMap<string, string>): SearchEntry[] {
  const scratchId = data.scratch?.id ?? null;
  // The Scratch pad row selects SCRATCH_ID, so its hit does too; its title is fixed whatever the stored Title.
  const scratchEntry: SearchEntry = {
    kind: "note",
    id: SCRATCH_ID,
    title: SCRATCH_TITLE,
    path: scratchId ? data.tree.path(scratchId) : [],
    body: scratchId ? bodies.get(scratchId) ?? "" : "",
  };
  return [
    scratchEntry,
    ...data.folders
      .filter((f) => f.status !== "deleting")
      .map((f): SearchEntry => ({ kind: "folder", id: f.id, title: f.name, path: data.tree.path(f.id) })),
    ...data.notes
      .filter((n) => n.id !== scratchId)
      .map((n): SearchEntry => ({ kind: "note", id: n.id, title: n.title, path: data.tree.path(n.id), body: bodies.get(n.id) ?? "" })),
    ...data.files.map((f): SearchEntry => ({ kind: "file", id: f.id, title: f.name, path: data.tree.path(f.id) })),
  ];
}

export function useDocSearch(
  projectId: string,
  query: string,
): { hits: SearchHit[]; bodiesLoading: boolean; error: unknown } {
  const { workspaceId } = useProjectsContext();
  const tree = useDocTree(projectId);
  // Armed by the first non-empty query and then kept, so the single body query is loaded once.
  const [armed, setArmed] = useState(false);
  const wanted = query.trim() !== "";
  useEffect(() => {
    if (wanted) setArmed(true);
  }, [wanted]);
  const opts = blocksAllOptions<DocRow>(SCHEMA.note, {
    workspaceId,
    fields: ["ItemId", "BodyMd"] as readonly FieldOf<DocRow>[],
    where: rows.eq("ProjectId", projectId),
  });
  const bodiesQuery = useQuery({ ...opts, enabled: opts.enabled && (armed || wanted) });
  const bodies = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of bodiesQuery.data ?? []) m.set(String(r.ItemId), typeof r.BodyMd === "string" ? r.BodyMd : "");
    return m;
  }, [bodiesQuery.data]);
  const hits = useMemo(() => {
    if (!wanted || !tree.data) return [];
    return searchDocs(buildSearchIndex(tree.data, bodies), query);
  }, [wanted, tree.data, bodies, query]);
  return {
    hits,
    bodiesLoading: wanted && bodiesQuery.isFetching && !bodiesQuery.data,
    error: tree.error ?? bodiesQuery.error ?? null,
  };
}

/** Records created after the hand-over carry the "New since hand-over" chip. */
export function useNewSinceHandOver(projectId: string): { count: number; isNew: (createdDate: string | null | undefined) => boolean } {
  const tree = useDocTree(projectId);
  const handedOverAt = useProject(projectId).data?.handedOverAt ?? null;
  const isNew = (createdDate: string | null | undefined): boolean =>
    Boolean(handedOverAt && createdDate && isNewSinceHandOver(createdDate, handedOverAt));
  const count = useMemo(() => {
    if (!tree.data || !handedOverAt) return 0;
    const all: { createdDate: string }[] = [...tree.data.folders, ...tree.data.notes, ...tree.data.files];
    return all.filter((r) => Boolean(r.createdDate) && isNewSinceHandOver(r.createdDate, handedOverAt)).length;
  }, [tree.data, handedOverAt]);
  return { count, isNew };
}

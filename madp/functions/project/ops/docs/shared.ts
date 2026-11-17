// Shared helpers of the docs area (folders, notes, files). Everything goes through the ports of ../projects/ports.
import { buildTree, placeBefore } from "../../../../src/domain/docs";
import type { DocTree } from "../../../../src/domain/docs";
import type { Check } from "../../../../src/domain/projects";
import type { ReadEnv, Row } from "../projects/ports";
import { strictArgs } from "../projects/op";
import type { FieldSpec, OpEnv } from "../projects/op";
import { SCHEMA, folderLite, noteLite, fileLite, rowStr } from "../projects/records";

export interface DocRows {
  folders: Row[];
  notes: Row[]; // without BodyMd
  files: Row[];
}

const NOTE_TREE_FIELDS = [
  "ProjectId", "WorkspaceId", "FolderId", "Title", "SortOrder", "IsScratchPad",
  "CreatedDate", "LastUpdatedDate", "UpdatedByUserId",
] as const;

/** Op args parser over strictArgs, typed for the op tables. */
export const parseArgs =
  (spec: Record<string, FieldSpec>) =>
  (a: unknown): Check<any> =>
    strictArgs(a, spec) as Check<any>;

export const ID: FieldSpec = { type: "string", max: 128 };

export async function queryDocRows(ports: OpEnv["ports"], projectId: string): Promise<DocRows> {
  const q = { ProjectId: projectId } as const;
  const [folders, notes, files] = await Promise.all([
    ports.db.query(SCHEMA.folder, q),
    ports.db.query(SCHEMA.note, q, { fields: NOTE_TREE_FIELDS }),
    ports.db.query(SCHEMA.file, q),
  ]);
  return { folders, notes, files };
}

/** Three parallel queries by ProjectId, all statuses. Note bodies are left out of the tree read. */
export const loadDocRows = (env: OpEnv): Promise<DocRows> => queryDocRows(env.ports, env.project!.id);

/** Round-1 prefetch of the tree read (and, for inserts, the readers the stamps need). */
export function prefetchTree(withReaders = false) {
  return (env: ReadEnv): unknown => Promise.all([queryDocRows(env.ports, env.projectId), withReaders ? env.readerIds?.() : undefined]);
}

/** Round-1 prefetch of one row by id (the same read as getDocRow). */
export function prefetchRow(schema: string, key: string, opts: { removes?: boolean } = {}) {
  return (env: ReadEnv, a: unknown): unknown => {
    const id = (a as Record<string, unknown> | null)?.[key];
    if (typeof id !== "string" || !id) return undefined;
    // A removal checks the row's ownership first: warming that read lets a known id go in one round.
    return Promise.all([env.ports.db.query(schema, { ItemId: id }, { limit: 1 }), opts.removes ? env.warmRemove?.(schema, id) : undefined]);
  };
}

export function treeOf(rows: DocRows): DocTree {
  return buildTree(rows.folders.map(folderLite), rows.notes.map(noteLite), rows.files.map(fileLite));
}

/** The row, only when it belongs to THIS project and workspace. Deleting folders are hidden unless allowed. */
export async function getDocRow(
  env: OpEnv,
  schema: string,
  id: unknown,
  opts?: { allowDeleting?: boolean },
): Promise<Row | null> {
  if (typeof id !== "string" || !id) return null;
  const row = (await env.ports.db.query(schema, { ItemId: id }, { limit: 1 }))[0];
  if (!row) return null;
  if (rowStr(row, "ProjectId") !== env.project!.id) return null;
  if (rowStr(row, "WorkspaceId") !== env.workspaceId) return null;
  if (schema === SCHEMA.folder && rowStr(row, "Status") === "deleting" && !opts?.allowDeleting) return null;
  return row;
}

/** "" (root) or a visible folder of the tree. */
export function folderOk(tree: DocTree, folderId: string): boolean {
  if (folderId === "") return true;
  return tree.byId.get(folderId)?.kind === "folder";
}

const schemaOf = (kind: string) => (kind === "folder" ? SCHEMA.folder : kind === "note" ? SCHEMA.note : SCHEMA.file);

/**
 * Position among the siblings. When no gap is left the others are renumbered; those writes start here and run
 * beside the caller's own write: the caller awaits `settled` together with it (one round, not two).
 */
export async function placeAmong(
  env: OpEnv,
  tree: DocTree,
  set: "folders" | "items",
  targetFolderId: string,
  movingId: string | null,
  beforeId: string | null,
): Promise<{ ok: true; sortOrder: number; renumbered: boolean; settled: Promise<unknown> } | { ok: false }> {
  const sibs = tree
    .siblings(targetFolderId)
    .filter((s) => (set === "folders") === (s.kind === "folder") && s.id !== movingId);
  const placed = placeBefore(sibs.map((s) => ({ id: s.id, sortOrder: s.sortOrder })), beforeId);
  if (!placed.ok) return { ok: false };
  const settled = Promise.all(
    placed.renumber.map((r) =>
      env.ports.db.update(schemaOf(tree.byId.get(r.id)?.kind ?? "file"), r.id, env.stampUpdate({ SortOrder: r.sortOrder })),
    ),
  );
  settled.catch(() => undefined); // observed by the caller's Promise.all
  return { ok: true, sortOrder: placed.sortOrder, renumbered: placed.renumber.length > 0, settled };
}

/** The row of an already loaded set (loadDocRows), under the same project/workspace/status rules as getDocRow. */
export function rowOf(
  env: OpEnv,
  rows: DocRows,
  kind: "folder" | "note" | "file",
  id: unknown,
  opts?: { allowDeleting?: boolean },
): Row | null {
  if (typeof id !== "string" || !id) return null;
  const row = (kind === "folder" ? rows.folders : kind === "note" ? rows.notes : rows.files).find((r) => r.ItemId === id);
  if (!row) return null;
  if (rowStr(row, "ProjectId") !== env.project!.id) return null;
  if (rowStr(row, "WorkspaceId") !== env.workspaceId) return null;
  if (kind === "folder" && rowStr(row, "Status") === "deleting" && !opts?.allowDeleting) return null;
  return row;
}

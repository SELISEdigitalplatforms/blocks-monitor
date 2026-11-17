import { DOC_KINDS, canCreateFolder, canMove, checkCount, checkFolderName, subtreeOf } from "../../../../src/domain/docs";
import { SCHEMA, folderLite, rowStr } from "../projects/records";
import { fail, ok } from "../projects/op";
import type { OpDef } from "../projects/op";
import { ID, folderOk, getDocRow, loadDocRows, parseArgs, placeAmong, prefetchRow, prefetchTree, queryDocRows, rowOf, treeOf } from "./shared";
import type { DocRows } from "./shared";

const isKind = (k: unknown): boolean => typeof k === "string" && (DOC_KINDS as readonly string[]).includes(k);
const BEFORE = { type: "string|null", max: 128 } as const;

const create: OpDef<any, any> = {
  op: "doc.folder.create",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchTree(true),
  parse: parseArgs({ projectId: ID, parentId: { type: "string", max: 128 }, name: { type: "string", max: 400 }, kind: { type: "string", max: 20 }, beforeId: { ...BEFORE, optional: true } }),
  async run(env, args) {
    const name = checkFolderName(args.name);
    if (!name.ok) return fail("invalid_input", name.messageKey, name.params);
    if (!isKind(args.kind)) return fail("invalid_input", "doc.badKind");
    const tree = treeOf(await loadDocRows(env));
    if (!folderOk(tree, args.parentId)) return fail("not_found", "doc.notFound");
    const can = canCreateFolder(tree, args.parentId);
    if (!can.ok) return fail("invalid_input", can.messageKey);
    const count = checkCount("folder", [...tree.byId.values()].filter((n) => n.kind === "folder").length);
    if (!count.ok) return fail(count.code, count.messageKey, count.params);
    const at = await placeAmong(env, tree, "folders", args.parentId, null, args.beforeId ?? null);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    const [folder] = await Promise.all([
      env.insertOnce(
        SCHEMA.folder,
        { ProjectId: env.project!.id, ParentId: args.parentId, Name: name.value, Kind: args.kind, SortOrder: at.sortOrder, Status: "active" },
        "folder",
      ),
      at.settled,
    ]);
    await env.audit("doc.folder.create", SCHEMA.folder, folder.ItemId, { parentId: args.parentId, kind: args.kind });
    return ok({ folder });
  },
};

const rename: OpDef<any, any> = {
  op: "doc.folder.rename",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.folder, "folderId"),
  parse: parseArgs({ projectId: ID, folderId: ID, name: { type: "string", max: 400 }, kind: { type: "string", max: 20, optional: true } }),
  async run(env, args) {
    const name = checkFolderName(args.name);
    if (!name.ok) return fail("invalid_input", name.messageKey, name.params);
    if (args.kind !== undefined && !isKind(args.kind)) return fail("invalid_input", "doc.badKind");
    if (!(await getDocRow(env, SCHEMA.folder, args.folderId))) return fail("not_found", "doc.notFound");
    const patch: Record<string, unknown> = { Name: name.value };
    if (args.kind !== undefined) patch.Kind = args.kind;
    const folder = await env.ports.db.update(SCHEMA.folder, args.folderId, env.stampUpdate(patch));
    await env.audit("doc.folder.rename", SCHEMA.folder, args.folderId, { fields: Object.keys(patch).map((k) => k.toLowerCase()) });
    return ok({ folder });
  },
};

const move: OpDef<any, any> = {
  op: "doc.folder.move",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchTree(),
  parse: parseArgs({ projectId: ID, folderId: ID, parentId: { type: "string", max: 128 }, beforeId: BEFORE }),
  async run(env, args) {
    const rows = await loadDocRows(env);
    if (!rowOf(env, rows, "folder", args.folderId)) return fail("not_found", "doc.notFound");
    const tree = treeOf(rows);
    if (!folderOk(tree, args.parentId)) return fail("not_found", "doc.notFound");
    const can = canMove(tree, { kind: "folder", id: args.folderId }, args.parentId);
    if (!can.ok) return fail(can.messageKey === "doc.notFound" ? "not_found" : "invalid_input", can.messageKey);
    const at = await placeAmong(env, tree, "folders", args.parentId, args.folderId, args.beforeId);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    const [folder] = await Promise.all([
      env.ports.db.update(SCHEMA.folder, args.folderId, env.stampUpdate({ ParentId: args.parentId, SortOrder: at.sortOrder })),
      at.settled,
    ]);
    await env.audit("doc.folder.move", SCHEMA.folder, args.folderId, { parentId: args.parentId });
    return ok({ folder, renumbered: at.renumbered });
  },
};

/** Rows removed per call: one bounded write round, so a large folder takes several calls (the client repeats until done). */
const DELETE_BATCH = 20;

/** What one call of doc.folder.delete removes. Pure, so the round-1 prefetch warms exactly the rows the handler then removes. */
function planDelete(rows: DocRows, workspaceId: string, folderId: string) {
  const row = rows.folders.find((r) => r.ItemId === folderId && r.WorkspaceId === workspaceId);
  if (!row) return null;
  const descendants = subtreeOf(rows.folders.map(folderLite), folderId); // deepest first
  const ids = new Set([folderId, ...descendants]);
  const content = [
    ...rows.files.filter((r) => ids.has(rowStr(r, "FolderId"))).map((r) => ({ schema: SCHEMA.file, row: r })),
    ...rows.notes.filter((r) => ids.has(rowStr(r, "FolderId"))).map((r) => ({ schema: SCHEMA.note, row: r })),
  ];
  const folders = [...descendants, folderId];
  const now = content.slice(0, DELETE_BATCH);
  // The folder rows go only in a call that also clears the last of the content.
  const folderNow = now.length === content.length ? folders.slice(0, DELETE_BATCH) : [];
  return { row, now, folderNow, remaining: content.length + folders.length - now.length - folderNow.length };
}

const del: OpDef<any, any> = {
  op: "doc.folder.delete",
  permission: "business.edit",
  scope: "project",
  record: () => false, // every write is a status write or a delete: a repeat is harmless
  async prefetch(env, a) {
    const folderId = (a as { folderId?: unknown } | null)?.folderId;
    if (typeof folderId !== "string" || !env.warmRemove) return undefined;
    const plan = planDelete(await queryDocRows(env.ports, env.projectId), env.workspaceId, folderId);
    if (!plan) return undefined;
    await Promise.all([
      ...plan.now.map((c) => env.warmRemove!(c.schema, c.row.ItemId)),
      ...plan.folderNow.map((id) => env.warmRemove!(SCHEMA.folder, id)),
    ]);
    return undefined;
  },
  parse: parseArgs({ projectId: ID, folderId: ID }),
  async run(env, args) {
    // The tree read gives the row, its subtree and the content to remove: no other read.
    const plan = planDelete(await loadDocRows(env), env.workspaceId, args.folderId);
    if (!plan) return fail("not_found", "doc.notFound");
    const { row, now, folderNow, remaining } = plan;
    const done = remaining === 0;
    const deleted: Record<string, number> = {};
    for (const c of now) deleted[c.schema] = (deleted[c.schema] ?? 0) + 1;
    if (folderNow.length) deleted[SCHEMA.folder] = folderNow.length;

    // One write round: the folder is hidden (first call) beside the removals. The bytes go first, then every row at once
    // (content, then the folder rows, the folder itself last); the audit trail rides along with the final call.
    const hiding =
      row.Status !== "deleting" ? env.ports.db.update(SCHEMA.folder, args.folderId, env.stampUpdate({ Status: "deleting" })) : undefined;
    hiding?.catch(() => undefined); // observed below
    await Promise.all(
      now.flatMap((c) => {
        const sid = c.schema === SCHEMA.file ? rowStr(c.row, "StorageObjectId") : "";
        return sid ? [env.ports.files.remove(sid, { permanent: true })] : [];
      }),
    );
    if (done) await env.audit("doc.folder.delete", SCHEMA.folder, args.folderId, deleted);
    await Promise.all([
      hiding,
      ...now.map((c) => env.ports.db.remove(c.schema, c.row.ItemId)),
      ...folderNow.map((id) => env.ports.db.remove(SCHEMA.folder, id)),
      done ? env.flush() : undefined,
    ]);
    return ok({ done, remaining, deleted });
  },
};

export const FOLDER_OPS: readonly OpDef<any, any>[] = [create, rename, move, del];

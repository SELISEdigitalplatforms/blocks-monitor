import { canMove, checkCount, checkNoteBody, checkNoteTitle } from "../../../../src/domain/docs";
import type { Row } from "../projects/ports";
import { SCHEMA, rowStr } from "../projects/records";
import { fail, ok } from "../projects/op";
import type { OpDef, OpEnv } from "../projects/op";
import { ID, folderOk, getDocRow, loadDocRows, parseArgs, placeAmong, prefetchRow, prefetchTree, rowOf, treeOf } from "./shared";
import type { ReadEnv } from "../projects/ports";

async function findScratch(env: OpEnv): Promise<Row | null> {
  return (await env.ports.db.query(SCHEMA.note, { ProjectId: env.project!.id, IsScratchPad: true }, { limit: 1 }))[0] ?? null;
}

/** The round-1 reads of doc.note.save: the same ones the handler makes for its case. */
function prefetchSave(env: ReadEnv, a: unknown): unknown {
  const args = (a ?? {}) as Record<string, unknown>;
  if (args.scratch === true) {
    return Promise.all([env.ports.db.query(SCHEMA.note, { ProjectId: env.projectId, IsScratchPad: true }, { limit: 1 }), env.readerIds?.()]);
  }
  if (typeof args.noteId === "string") return prefetchRow(SCHEMA.note, "noteId")(env, a);
  return prefetchTree(true)(env);
}

/** The stored stamps (what Blocks wrote, never the server clock) are read back beside the audit flush: the client echoes them on its next save. */
async function withStored(env: OpEnv, row: Row): Promise<Row> {
  const stored = (await env.ports.db.query(SCHEMA.note, { ItemId: row.ItemId }, { limit: 1, fields: ["CreatedDate", "LastUpdatedDate"] }))[0];
  return stored ? { ...row, CreatedDate: stored.CreatedDate, LastUpdatedDate: stored.LastUpdatedDate } : row;
}

const save: OpDef<any, any> = {
  op: "doc.note.save",
  permission: "business.edit",
  scope: "project",
  record: () => false, // keyed or idempotent writes; the stamps are read back beside the audit flush
  prefetch: prefetchSave,
  parse: parseArgs({
    projectId: ID,
    noteId: { ...ID, optional: true },
    folderId: { type: "string", max: 128 },
    title: { type: "string", max: 400 },
    bodyMd: { type: "string" },
    expectedUpdatedAt: { type: "string", max: 64, optional: true },
    scratch: { type: "boolean", optional: true },
  }),
  async run(env, args) {
    const scratch = args.scratch === true;
    const body = checkNoteBody(args.bodyMd);
    if (!body.ok) return fail("too_large", body.messageKey, body.params);

    let existing: Row | null = null;
    if (scratch) existing = await findScratch(env);
    else if (args.noteId !== undefined) {
      existing = await getDocRow(env, SCHEMA.note, args.noteId);
      if (!existing) return fail("not_found", "doc.notFound");
    }
    const isScratch = scratch || existing?.IsScratchPad === true;
    const title = checkNoteTitle(args.title, { scratch: isScratch });
    if (!title.ok) return fail("invalid_input", title.messageKey, title.params);

    if (existing) {
      const stored = rowStr(existing, "LastUpdatedDate");
      // An omitted stamp on an existing note is stale too (only a new note may omit it).
      if (stored !== "" && args.expectedUpdatedAt !== stored) {
        // A save of this user that already landed (the first answer was lost) is not a conflict.
        if (env.isOwnWrite(existing, { Title: title.value, BodyMd: body.value })) {
          return ok({ note: existing });
        }
        return fail("conflict", "note.stale", { updatedAt: stored, updatedByUserId: rowStr(existing, "UpdatedByUserId") });
      }
      // The audit event goes out in the same round as the write.
      await env.audit("doc.note.save", SCHEMA.note, existing.ItemId, { fields: ["title", "bodyMd"], scratch: isScratch });
      const [saved] = await Promise.all([
        env.ports.db.update(SCHEMA.note, existing.ItemId, env.stampUpdate({ Title: title.value, BodyMd: body.value })),
        env.flush(),
      ]);
      return ok({ note: await withStored(env, { ...existing, ...saved }) });
    }

    if (scratch) {
      const note = await env.insertOnce(
        SCHEMA.note,
        { ProjectId: env.project!.id, FolderId: "", Title: title.value, BodyMd: body.value, SortOrder: 0, IsScratchPad: true },
        `natural:scratch:${env.project!.id}`,
      );
      await env.audit("doc.note.save", SCHEMA.note, note.ItemId, { created: true, scratch: true });
      const [stored] = await Promise.all([withStored(env, note), env.flush()]);
      return ok({ note: stored });
    }

    const tree = treeOf(await loadDocRows(env));
    if (!folderOk(tree, args.folderId)) return fail("not_found", "doc.notFound");
    const count = checkCount("note", [...tree.byId.values()].filter((n) => n.kind === "note").length);
    if (!count.ok) return fail(count.code, count.messageKey, count.params);
    const at = await placeAmong(env, tree, "items", args.folderId, null, null);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    const [note] = await Promise.all([
      env.insertOnce(
        SCHEMA.note,
        { ProjectId: env.project!.id, FolderId: args.folderId, Title: title.value, BodyMd: body.value, SortOrder: at.sortOrder, IsScratchPad: false },
        "note",
      ),
      at.settled,
    ]);
    await env.audit("doc.note.save", SCHEMA.note, note.ItemId, { created: true, scratch: false });
    const [stored] = await Promise.all([withStored(env, note), env.flush()]);
    return ok({ note: stored });
  },
};

const move: OpDef<any, any> = {
  op: "doc.note.move",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchTree(),
  parse: parseArgs({ projectId: ID, noteId: ID, folderId: { type: "string", max: 128 }, beforeId: { type: "string|null", max: 128 } }),
  async run(env, args) {
    const rows = await loadDocRows(env);
    const row = rowOf(env, rows, "note", args.noteId);
    if (!row) return fail("not_found", "doc.notFound");
    if (row.IsScratchPad === true) return fail("invalid_input", "doc.scratchFixed");
    const tree = treeOf(rows);
    if (!folderOk(tree, args.folderId)) return fail("not_found", "doc.notFound");
    const can = canMove(tree, { kind: "note", id: args.noteId }, args.folderId);
    if (!can.ok) return fail(can.messageKey === "doc.notFound" ? "not_found" : "invalid_input", can.messageKey);
    const at = await placeAmong(env, tree, "items", args.folderId, args.noteId, args.beforeId);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    const [note] = await Promise.all([
      env.ports.db.update(SCHEMA.note, args.noteId, env.stampUpdate({ FolderId: args.folderId, SortOrder: at.sortOrder })),
      at.settled,
    ]);
    await env.audit("doc.note.move", SCHEMA.note, args.noteId, { folderId: args.folderId });
    return ok({ note, renumbered: at.renumbered });
  },
};

const del: OpDef<any, any> = {
  op: "doc.note.delete",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.note, "noteId", { removes: true }),
  parse: parseArgs({ projectId: ID, noteId: ID }),
  async run(env, args) {
    const row = await getDocRow(env, SCHEMA.note, args.noteId);
    if (!row) return fail("not_found", "doc.notFound");
    if (row.IsScratchPad === true) return fail("invalid_input", "doc.scratchFixed");
    await env.ports.db.remove(SCHEMA.note, args.noteId);
    await env.audit("doc.note.delete", SCHEMA.note, args.noteId, {});
    return ok({ noteId: args.noteId });
  },
};

export const NOTE_OPS: readonly OpDef<any, any>[] = [save, move, del];

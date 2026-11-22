// Docs-area file ops on Blocks Storage: presign, commit, url, rename, move, delete.
// Storage only through env.ports.files (StoragePort); no fetch, no directory creation here.
import {
  FILE_MAX_BYTES,
  checkCount,
  checkUpload,
  cleanDisplayName,
  fileTypeFor,
  magicMatches,
  normaliseStoredName,
  ACCEPTED_EXTENSIONS,
} from "../../../../src/domain/docs";
import { fail, ok } from "../projects/op";
import type { OpDef, OpEnv } from "../projects/op";
import { rowInt, rowStr, SCHEMA } from "../projects/records";
import type { Row } from "../projects/ports";
import { ID, folderOk, getDocRow, loadDocRows, parseArgs, placeAmong, prefetchRow, prefetchTree, rowOf, treeOf } from "./shared";

const STALE_PENDING_MS = 60 * 60 * 1000;
const URL_TTL_SECONDS = 300;
const HEAD_BYTES = 512;

const FOLDER = { type: "string", max: 128 } as const;

async function dropFile(env: OpEnv, row: Row): Promise<void> {
  const sid = rowStr(row, "StorageObjectId");
  if (sid) await env.ports.files.remove(sid, { permanent: true });
  await env.ports.db.remove(SCHEMA.file, row.ItemId);
}

const presign: OpDef<any, any> = {
  op: "doc.file.presign",
  permission: "business.edit",
  scope: "project",
  storeAnswer: false,
  record: () => false,
  prefetch: prefetchTree(true),
  parse: parseArgs({
    projectId: ID, folderId: FOLDER, fileName: { type: "string", max: 400 }, mime: { type: "string", max: 200 },
    sizeBytes: { type: "int" }, sha256: { type: "string", max: 128, optional: true },
  }),
  async run(env, a) {
    const name = cleanDisplayName(a.fileName);
    if (!name.ok) return fail("invalid_input", name.messageKey, name.params);
    const type = fileTypeFor(a.fileName, a.mime);
    if (!type) return fail("invalid_input", "doc.typeNotAllowed", { accepted: ACCEPTED_EXTENSIONS });
    const rows = await loadDocRows(env);
    const tree = treeOf(rows);
    if (!folderOk(tree, a.folderId)) return fail("not_found", "doc.notFound");

    const now = env.now.getTime();
    const stale = rows.files.filter(
      (f) => rowStr(f, "Status") === "pending" && now - Date.parse(rowStr(f, "CreatedDate")) > STALE_PENDING_MS,
    );
    const live = rows.files.filter((f) => !stale.includes(f) && ["ready", "pending"].includes(rowStr(f, "Status")));
    const used = live.reduce((n, f) => n + rowInt(f, "SizeBytes"), 0);
    const limit = checkUpload({ sizeBytes: a.sizeBytes, usedBytes: used, fileCount: live.length });
    if (!limit.ok) return fail(limit.code, limit.messageKey, limit.params);
    const count = checkCount("file", live.length);
    if (!count.ok) return fail(count.code, count.messageKey, count.params);

    // The stored name is checked before any row exists (same verdict as with the real id).
    const probe = normaliseStoredName("probe", a.fileName, a.mime);
    if (!probe.ok) return fail("invalid_input", probe.messageKey, probe.params);

    const at = await placeAmong(env, tree, "items", a.folderId, null, null);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    // Stale pending rows go in parallel with the new row and the directory lookup; a failed drop is left to the next sweep.
    const dropping = stale.map((f) => dropFile(env, f).catch(() => undefined));
    const dirPromise = env.ports.files.projectDirectory(env.workspaceId, env.project!.id);
    dirPromise.catch(() => undefined);
    let row: Row;
    try {
      [row] = await Promise.all([
        env.insertOnce(
          SCHEMA.file,
          {
            ProjectId: env.project!.id, FolderId: a.folderId, Name: name.value, StoredName: "", Mime: type.mimes[0],
            SizeBytes: a.sizeBytes, StorageObjectId: "", Status: "pending", SortOrder: at.sortOrder,
          },
          "file",
        ),
        at.settled,
      ]);
    } finally {
      await Promise.all(dropping);
    }
    try {
      const stored = normaliseStoredName(row.ItemId, a.fileName, a.mime);
      if (!stored.ok) throw new Error("unreachable: stored name verdict changed");
      const dir = await dirPromise;
      const presigned = await env.ports.files.presignUpload({
        fileName: stored.storedName,
        contentType: type.mimes[0],
        sizeInBytes: a.sizeBytes,
        parentDirectoryId: dir,
        objectAccessLevel: "Creator",
        inheritsParentAccess: false,
        accessModifier: "Private",
        ...(a.sha256 ? { checksum: a.sha256, checksumAlgorithm: "SHA256" as const } : {}),
      });
      const file = await env.ports.db.update(
        SCHEMA.file, row.ItemId, env.stampUpdate({ StoredName: stored.storedName, StorageObjectId: presigned.storageObjectId }),
      );
      return ok({ fileId: row.ItemId, uploadUrl: presigned.uploadUrl, requiredHeaders: presigned.requiredHeaders, file });
    } catch (err) {
      // No ghost file: take the pending row back (best effort, the 1 h sweep catches a failed removal) and rethrow as is.
      await env.ports.db.remove(SCHEMA.file, row.ItemId).catch(() => undefined);
      throw err;
    }
  },
};

const commit: OpDef<any, any> = {
  op: "doc.file.commit",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.file, "fileId"),
  parse: parseArgs({ projectId: ID, fileId: ID }),
  async run(env, a) {
    const row = await getDocRow(env, SCHEMA.file, a.fileId);
    if (!row) return fail("not_found", "doc.notFound");
    const status = rowStr(row, "Status");
    if (status === "ready") return ok({ file: row });
    if (status !== "pending") return fail("invalid_input", "doc.uploadRejected");

    const sid = rowStr(row, "StorageObjectId");
    let good = false;
    if (sid) {
      const info = await env.ports.files.info(sid);
      if (info && info.sizeBytes === rowInt(row, "SizeBytes") && info.sizeBytes <= FILE_MAX_BYTES) {
        const head = await env.ports.files.head(sid, HEAD_BYTES);
        const ext = rowStr(row, "StoredName").split(".").pop()!.toLowerCase();
        good = magicMatches(ext, head);
      }
    }
    if (!good) {
      await env.ports.db.update(SCHEMA.file, row.ItemId, env.stampUpdate({ Status: "rejected" }));
      if (sid) await env.ports.files.remove(sid, { permanent: true });
      return fail("invalid_input", "doc.uploadRejected");
    }
    const file = await env.ports.db.update(SCHEMA.file, row.ItemId, env.stampUpdate({ Status: "ready" }));
    await env.audit("doc.file.commit", SCHEMA.file, row.ItemId, { status: "ready", sizeBytes: rowInt(row, "SizeBytes") });
    // The MADP engine reads the file (file.extract), on the engine host. The upload is kept even when the job cannot be
    // queued now: the page then lists the file as not read yet and offers to read it (doc.file.extract).
    const reading = await queueReading(env, row.ItemId).catch(() => null);
    return ok({ file, readingJobId: reading?.jobId ?? null });
  },
};

/** Queues the MADP engine's reading of one ready file (one active file.extract job per file). `again`: a reading asked
 *  for once more (its own job per request; a retried request answers the job it queued). */
async function queueReading(env: OpEnv, fileId: string, again = false): Promise<{ jobId: string; existing: boolean } | null> {
  if (!env.ports.jobs.create) return null;
  return env.ports.jobs.create({
    kind: "file.extract",
    projectId: env.project!.id,
    targetType: "doc-file",
    targetId: fileId,
    eventKey: again ? `file-extract:${fileId}:${env.requestId}` : `file-extract:${fileId}`,
    input: { fileId },
  });
}

/** "Read again": asks the MADP engine to read a ready file once more (an active reading of it is answered as is). */
const extract: OpDef<any, any> = {
  op: "doc.file.extract",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.file, "fileId"),
  parse: parseArgs({ projectId: ID, fileId: ID }),
  async run(env, a) {
    const row = await getDocRow(env, SCHEMA.file, a.fileId);
    if (!row || rowStr(row, "Status") !== "ready") return fail("not_found", "doc.notFound");
    const job = await queueReading(env, row.ItemId, true);
    if (!job) return fail("conflict", "doc.readingUnavailable");
    return ok({ jobId: job.jobId, queued: !job.existing });
  },
};

const url: OpDef<any, any> = {
  op: "doc.file.url",
  permission: "view",
  scope: "project",
  storeAnswer: false,
  prefetch: prefetchRow(SCHEMA.file, "fileId"),
  parse: parseArgs({ projectId: ID, fileId: ID }),
  async run(env, a) {
    const row = await getDocRow(env, SCHEMA.file, a.fileId);
    const sid = row ? rowStr(row, "StorageObjectId") : "";
    if (!row || rowStr(row, "Status") !== "ready" || !sid) return fail("not_found", "doc.notFound");
    const { url: u, expiresAt } = await env.ports.files.downloadUrl(sid, URL_TTL_SECONDS);
    return ok({ url: u, expiresAt });
  },
};

const rename: OpDef<any, any> = {
  op: "doc.file.rename",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.file, "fileId"),
  parse: parseArgs({ projectId: ID, fileId: ID, name: { type: "string", max: 400 } }),
  async run(env, a) {
    if (!(await getDocRow(env, SCHEMA.file, a.fileId))) return fail("not_found", "doc.notFound");
    const name = cleanDisplayName(a.name);
    if (!name.ok) return fail("invalid_input", name.messageKey, name.params);
    const file = await env.ports.db.update(SCHEMA.file, a.fileId, env.stampUpdate({ Name: name.value }));
    await env.audit("doc.file.rename", SCHEMA.file, a.fileId, { fields: ["name"] });
    return ok({ file });
  },
};

const move: OpDef<any, any> = {
  op: "doc.file.move",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchTree(),
  parse: parseArgs({ projectId: ID, fileId: ID, folderId: FOLDER, beforeId: { type: "string|null", max: 128 } }),
  async run(env, a) {
    const rows = await loadDocRows(env);
    if (!rowOf(env, rows, "file", a.fileId)) return fail("not_found", "doc.notFound");
    const tree = treeOf(rows);
    if (!folderOk(tree, a.folderId)) return fail("not_found", "doc.notFound");
    const at = await placeAmong(env, tree, "items", a.folderId, a.fileId, a.beforeId);
    if (!at.ok) return fail("invalid_input", "doc.badPosition");
    const [file] = await Promise.all([
      env.ports.db.update(SCHEMA.file, a.fileId, env.stampUpdate({ FolderId: a.folderId, SortOrder: at.sortOrder })),
      at.settled,
    ]);
    await env.audit("doc.file.move", SCHEMA.file, a.fileId, { folderId: a.folderId });
    return ok({ file, renumbered: at.renumbered });
  },
};

const remove: OpDef<any, any> = {
  op: "doc.file.delete",
  permission: "business.edit",
  scope: "project",
  prefetch: prefetchRow(SCHEMA.file, "fileId", { removes: true }),
  parse: parseArgs({ projectId: ID, fileId: ID }),
  async run(env, a) {
    const row = await getDocRow(env, SCHEMA.file, a.fileId);
    if (!row) return fail("not_found", "doc.notFound");
    await dropFile(env, row);
    await env.audit("doc.file.delete", SCHEMA.file, row.ItemId, {});
    return ok({ fileId: row.ItemId });
  },
};

export const FILE_OPS: readonly OpDef<any, any>[] = [presign, commit, extract, url, rename, move, remove];

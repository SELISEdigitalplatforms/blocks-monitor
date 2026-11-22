// Scope feedback attachments on Blocks Storage: presign, commit, delete, url (design 5).
// Bytes never pass through a function: the browser uploads to the presigned URL; commit only reads the size and the first bytes.
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_COMMENT,
  ATTACHMENT_MIMES,
  MAGIC_BYTES,
  attachmentIssue,
  isStaleUpload,
  magicMatches,
  normaliseStoredName,
} from "../../../../src/domain/scopeFeedback";
import { ok, fail, parseArgs } from "./ports";
import type { ScopeEnv, ScopeOpDef, ScopeReadEnv } from "./ports";
import { findInProject, naturalKey } from "./shared";
import { beforeLock, readGate } from "./feedback";

type Row = Record<string, unknown>;
const ATT = "Attachment";
const COMMENT = "FeedbackComment";
const str = (r: Row, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
const int = (r: Row, k: string): number => (typeof r[k] === "number" ? (r[k] as number) : 0);
const ID = { type: "string", max: 128 } as const;

type Rejection = "attachment.size" | "attachment.type" | "attachment.missing";

/** Only the uploader, and only for an attachment of this project. */
async function ownAttachment(env: ScopeEnv, id: string): Promise<{ row: Row } | { code: "not_found" | "forbidden" }> {
  const row = (await findInProject(env, ATT, id)) as Row | null;
  if (!row || str(row, "OwnerType") !== "feedback-comment") return { code: "not_found" };
  if (str(row, "CreatedByUserId") !== env.userId) return { code: "forbidden" };
  return { row };
}

/** The row as it is after the patch, carrying this request's issued stamp (no read-back). */
const patched = (env: ScopeEnv, row: Row, patch: Row): Row => ({ ...row, ...patch, LastUpdatedDate: env.issuedStamp });

const ownRead = (env: ScopeReadEnv, id: string) => findInProject(env as unknown as ScopeEnv, ATT, id);
const mineQuery = (env: Pick<ScopeReadEnv, "projectId" | "userId" | "db">) =>
  env.db.query(ATT, { ProjectId: env.projectId, OwnerType: "feedback-comment", CreatedByUserId: env.userId }) as Promise<Row[]>;

const presign: ScopeOpDef = {
  op: "scope.attachment.presign",
  kind: "command",
  permission: "comment",
  parse: parseArgs({
    projectId: ID,
    commentKey: { type: "string", max: 64 },
    fileName: { type: "string", max: 255 },
    mime: { type: "string", max: 200 },
    sizeBytes: { type: "int" },
  }),
  prefetch: (env: ScopeReadEnv) => Promise.all([readGate(env), mineQuery(env)]),
  async run(env, a) {
    // Round 1: the gate and this caller's attachments are independent reads.
    const [gate, mine] = await Promise.all([beforeLock(env), mineQuery(env)]);
    if (!gate.ok) return fail("conflict", "scope.locked");
    if (!a.commentKey) return fail("invalid_input", "input.wrongType", { key: "commentKey" });

    const issue = attachmentIssue({ mime: a.mime, sizeBytes: a.sizeBytes });
    if (issue === "attachment.type") return fail("invalid_input", issue);
    if (issue === "attachment.size") return fail("too_large", issue);
    if (issue) return fail("invalid_input", issue);

    const live = mine.filter((r) => str(r, "OwnerId") === a.commentKey && ["pending", "ready"].includes(str(r, "Status")));
    if (live.length >= ATTACHMENT_MAX_PER_COMMENT) {
      return fail("limit_reached", "attachment.count", { max: ATTACHMENT_MAX_PER_COMMENT });
    }

    // Lazy, idempotent cleanup of this caller's abandoned uploads, started only on the accepted path (always awaited).
    // Pending rows stay counted as live until their cleanup has run.
    const stale = mine.filter((r) => str(r, "Status") === "pending" && isStaleUpload({ status: "pending", createdAt: str(r, "CreatedDate") }, env.now));
    const cleanup = () =>
      Promise.all(
        stale.map(async (r) => {
          const fid = str(r, "FileId");
          if (fid) await env.files.remove(fid);
          await env.db.update(ATT, str(r, "ItemId"), { Status: "deleted" });
          return r;
        }),
      );

    const storedName = normaliseStoredName(a.fileName, a.mime);
    // Presign first: a refusal (the library's OpError passes through unchanged) leaves no row behind.
    const upload = async () => {
      const p = await env.files.presign({
        fileName: storedName,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        maxBytes: ATTACHMENT_MAX_BYTES,
        allowedMimes: ATTACHMENT_MIMES,
        objectAccessLevel: "Creator",
        accessModifier: "Private",
        inheritsParentAccess: false,
      });
      const fields = {
        ProjectId: env.projectId,
        OwnerType: "feedback-comment",
        OwnerId: a.commentKey,
        FileId: p.storageObjectId,
        FileName: a.fileName,
        StoredName: p.storedName || storedName,
        Mime: a.mime,
        SizeBytes: a.sizeBytes,
        Origin: "upload",
        Status: "pending",
      };
      const ins = await env.db.insert(ATT, fields, naturalKey(env.requestId, "attachment"));
      return { p, fields, ins };
    };
    const [{ p, fields, ins }] = await Promise.all([upload(), cleanup()]);
    // A new row is answered from what was written (no read-back); only a retry reads the stored row.
    let attachment: Row = { ItemId: ins.id, ...fields, CreatedByUserId: env.userId, CreatedDate: env.issuedStamp, LastUpdatedDate: env.issuedStamp };
    if (!ins.created) {
      attachment = ((await env.db.byIds(ATT, [ins.id]))[0] ?? attachment) as Row;
      if (str(attachment, "FileId") !== p.storageObjectId) {
        // A retry presigned a new object: point the row at it and drop the old one.
        const old = str(attachment, "FileId");
        await env.db.update(ATT, ins.id, { FileId: p.storageObjectId, StoredName: fields.StoredName });
        attachment = patched(env, attachment, { FileId: p.storageObjectId, StoredName: fields.StoredName });
        if (old) await env.files.remove(old);
      }
    }
    return ok({
      attachmentId: ins.id,
      uploadUrl: p.uploadUrl,
      requiredHeaders: p.requiredHeaders,
      storedName: fields.StoredName,
      attachment,
    });
  },
};

const commit: ScopeOpDef = {
  op: "scope.attachment.commit",
  kind: "command",
  permission: "comment",
  parse: parseArgs({ projectId: ID, attachmentId: ID }),
  prefetch: (env: ScopeReadEnv, a) => ownRead(env, a.attachmentId),
  record: () => false,
  async run(env, a) {
    const own = await ownAttachment(env, a.attachmentId);
    if ("code" in own) return fail(own.code);
    const row = own.row;
    const status = str(row, "Status");
    if (status === "ready") return ok({ attachment: row, rejected: null });
    if (status === "rejected") return ok({ attachment: row, rejected: "attachment.type" as Rejection });
    if (status !== "pending") return fail("not_found");

    const fid = str(row, "FileId");
    const info = fid ? await env.files.info(fid) : null;
    let rejected: Rejection | null = null;
    if (!info) rejected = "attachment.missing";
    else if (info.sizeBytes !== int(row, "SizeBytes") || info.sizeBytes > ATTACHMENT_MAX_BYTES) rejected = "attachment.size";
    else if (!magicMatches(str(row, "Mime"), await env.files.head(fid, MAGIC_BYTES))) rejected = "attachment.type";

    if (rejected) {
      await Promise.all([fid ? env.files.remove(fid) : Promise.resolve(), env.db.update(ATT, str(row, "ItemId"), { Status: "rejected" }), env.flush()]);
      return ok({ attachment: patched(env, row, { Status: "rejected" }), rejected });
    }
    await Promise.all([env.db.update(ATT, str(row, "ItemId"), { Status: "ready" }), env.flush()]);
    return ok({ attachment: patched(env, row, { Status: "ready" }), rejected: null });
  },
};

/** The comment that lists the attachment in its AttachmentIds. */
const holderOf = async (env: ScopeReadEnv | ScopeEnv, id: string): Promise<Row | null> =>
  (await env.db.query(COMMENT, { ProjectId: env.projectId, AttachmentIds: id }, { limit: 1 }))[0] ?? null;

/** The comment the attachment's OwnerId names (it reads the attachment first, which the memo already holds). */
const ownerOf = async (env: ScopeReadEnv | ScopeEnv, id: string): Promise<Row | null> => {
  const row = await ownRead(env as ScopeReadEnv, id);
  const owner = row ? str(row, "OwnerId") : "";
  return owner ? findInProject(env as unknown as ScopeEnv, COMMENT, owner) : null;
};

const remove: ScopeOpDef = {
  op: "scope.attachment.delete",
  kind: "command",
  permission: "comment",
  parse: parseArgs({ projectId: ID, attachmentId: ID }),
  // The attachment, the comment that lists it and the comment its OwnerId names: all read in round 1 (no chain).
  prefetch: (env: ScopeReadEnv, a) =>
    Promise.all([ownRead(env, a.attachmentId), holderOf(env, a.attachmentId), ownerOf(env, a.attachmentId)]),
  record: () => false,
  async run(env, a) {
    const [row, holder, owner] = await Promise.all([ownRead(env, a.attachmentId), holderOf(env, a.attachmentId), ownerOf(env, a.attachmentId)]);
    if (!row || str(row, "OwnerType") !== "feedback-comment") return fail("not_found");
    if (str(row, "CreatedByUserId") !== env.userId) return fail("forbidden");
    if (str(row, "Status") === "deleted") return ok({ attachment: row });
    if (holder || owner) return fail("conflict", "attachment.inUse");
    const fid = str(row, "FileId");
    // One round: the file goes (permanent, never a rename) beside the row; the answer is the row as written.
    await Promise.all([fid ? env.files.remove(fid) : Promise.resolve(), env.db.update(ATT, str(row, "ItemId"), { Status: "deleted" }), env.flush()]);
    return ok({ attachment: patched(env, row, { Status: "deleted" }) });
  },
};

const url: ScopeOpDef = {
  op: "scope.attachment.url",
  kind: "view",
  permission: "view",
  parse: parseArgs({ projectId: ID, attachmentId: ID }),
  prefetch: (env: ScopeReadEnv, a) => ownRead(env, a.attachmentId),
  async run(env, a) {
    const row = (await findInProject(env, ATT, a.attachmentId)) as Row | null;
    const fid = row ? str(row, "FileId") : "";
    if (!row || str(row, "Status") !== "ready" || !fid) return fail("not_found");
    const d = await env.files.downloadUrl(fid);
    return ok({ url: d.url, expiresAt: d.expiresAt });
  },
};

export const ATTACHMENT_HANDLERS: readonly ScopeOpDef[] = [presign, commit, remove, url];

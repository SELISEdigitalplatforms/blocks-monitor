// The upload pipeline of the files people attach (comment boxes, answers, change requests, chat, preview feedback), on
// Blocks Storage: presign → browser PUT → commit (size + magic bytes) → url → delete. Shared by feedback/attachments.ts
// (OwnerType "feedback-comment") and attachments/talk.ts (the other owner types); every step is the same for all of
// them, only the owner type, the gate before a presign and the visibility of an owned file differ.
// Bytes never pass through a function: the browser PUTs to the presigned URL; commit reads only the size and the first bytes.
// sha256 = SHA-256 of the file bytes; canonical wire form is 64 lowercase hex (what doc.file.presign's client sends);
// base64 is accepted because feedbackUpload.ts sends it today; the server always passes lowercase hex to Blocks Storage.
import { OpError, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import {
  ACCEPTED_EXTENSIONS,
  cleanDisplayName,
  fileTypeFor,
  magicMatches,
  normaliseStoredName,
} from "../../../../src/domain/docs";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, attachmentKind, draftOwnerId, isStaleDraftAttachment } from "../../../../src/domain/feedback";
import { listOf } from "./loaders";
import { MSG } from "./messages";
import { FIELDS, SCHEMA, num, pick, str } from "./records";

const HEAD_BYTES = 512;
const SHA_HEX = /^[a-fA-F0-9]{64}$/;
const SHA_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** The optional sha256 argument of a presign. */
export const shaArg = () => v.optional(v.string({ pattern: new RegExp(`${SHA_HEX.source}|${SHA_BASE64.source}`) }));

/** Lowercase hex of a SHA-256 given as 64 hex characters or as base64 of the 32-byte digest; null for anything else. */
export function sha256Hex(value: string): string | null {
  if (SHA_HEX.test(value)) return value.toLowerCase();
  if (!SHA_BASE64.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 ? bytes.toString("hex") : null;
}

export const OWN_FIELDS = [...FIELDS.attachment, "FileId", "StoredName"] as const;

/** The caller's open uploads of one owner type in this project (pending or ready). */
export const openUploads = (deps: OpDeps, projectId: string, ownerType: string, userId: string): Promise<Row[]> =>
  listOf(
    deps,
    SCHEMA.attachment,
    f.and(f.eq("ProjectId", projectId), f.eq("OwnerType", ownerType), f.eq("CreatedByUserId", userId), f.in("Status", ["pending", "ready"])),
    ["ItemId", "OwnerId", "Status", "FileId", "CreatedDate"],
  );

/** The permanent byte removal. A file that is already gone counts as removed. */
export async function removeBytes(deps: OpDeps, fileId: string): Promise<void> {
  if (!fileId) return;
  try {
    await deps.files.remove(fileId);
  } catch (e) {
    if (!(e instanceof OpError && e.code === "not_found")) throw e;
  }
}

export interface CheckedUpload {
  type: NonNullable<ReturnType<typeof fileTypeFor>>;
  name: string;
  sha: string | undefined;
}

/** The type, size, name and sha256 checks of a presign: before any read or Storage call. */
export function checkUpload(deps: OpDeps, a: { fileName: string; mime: string; sizeBytes: number; sha256?: string | undefined }): CheckedUpload {
  const type = fileTypeFor(a.fileName, a.mime);
  if (!type) return deps.fail("invalid_input", MSG.typeNotAllowed, { accepted: ACCEPTED_EXTENSIONS });
  if (a.sizeBytes > MAX_ATTACHMENT_BYTES) return deps.fail("too_large", MSG.tooLarge, { maxBytes: MAX_ATTACHMENT_BYTES });
  const name = cleanDisplayName(a.fileName);
  if (!name.ok) return deps.fail("invalid_input", undefined, { field: "fileName", rule: "invalid" });
  const sha = a.sha256 === undefined ? undefined : sha256Hex(a.sha256);
  if (sha === null) return deps.fail("invalid_input", undefined, { field: "sha256", rule: "pattern" });
  return { type, name: name.ok ? name.value : a.fileName, sha };
}

/**
 * The presign after the gate: the limit per draft, the stale-pending sweep, the pending row (its ItemId names the
 * stored file) and the presigned upload. `mine` = openUploads of this owner type (read in the op's first round).
 */
export async function presignDraft(
  ctx: OpCtx,
  deps: OpDeps,
  o: { projectId: string; ownerType: string; draftKey: string; fileName: string; sizeBytes: number; checked: CheckedUpload; mine: readonly Row[] },
) {
  const { projectId, ownerType, checked } = o;
  const { type, name, sha } = checked;
  const owner = draftOwnerId(o.draftKey);
  const stale = o.mine.filter((r) => isStaleDraftAttachment({ status: str(r, "Status"), createdAt: str(r, "CreatedDate") }, ctx.now));
  const live = o.mine.filter((r) => !stale.includes(r) && str(r, "OwnerId") === owner);
  if (live.length >= MAX_ATTACHMENTS) return deps.fail("limit_reached", MSG.tooManyFiles, { max: MAX_ATTACHMENTS });

  // Stale pending uploads: bytes first (permanent); a failed removal leaves the row for next time.
  const cleaned = (
    await Promise.all(
      stale.map(async (r) => {
        try {
          await removeBytes(deps, str(r, "FileId"));
          return r;
        } catch {
          return null;
        }
      }),
    )
  ).filter((r): r is Row => r !== null);

  // R2: the pending row together with the cleanup updates.
  const [ins] = await Promise.all([
    deps.gw.insert(
      SCHEMA.attachment,
      {
        ProjectId: projectId,
        OwnerType: ownerType,
        OwnerId: owner,
        FileId: "",
        FileName: name,
        StoredName: "",
        Kind: attachmentKind(type),
        Mime: type.mimes[0],
        SizeBytes: o.sizeBytes,
        Origin: "upload",
        Status: "pending",
      },
      { key: "attachment" },
    ),
    ...cleaned.map((r) => deps.gw.update(SCHEMA.attachment, str(r, "ItemId"), { Status: "deleted" })),
  ]);
  if (!ins.itemId) throw new OpError("internal");
  const attachmentId = ins.itemId;
  // A retry finds the row from the first attempt in the list read above: it may already point at an object, which the new presign replaces.
  const previous = ins.created ? null : (o.mine.find((r) => str(r, "ItemId") === attachmentId) ?? null);
  if (previous && str(previous, "Status") !== "pending") return deps.fail("conflict");

  const stored = normaliseStoredName(attachmentId, o.fileName, type.mimes[0]);
  if (!stored.ok) return deps.fail("invalid_input", MSG.typeNotAllowed, { accepted: ACCEPTED_EXTENSIONS });
  let p: Awaited<ReturnType<typeof deps.files.presignUpload>>;
  try {
    p = await deps.files.presignUpload({
      projectId,
      fileName: stored.storedName,
      mime: type.mimes[0],
      sizeBytes: o.sizeBytes,
      maxBytes: MAX_ATTACHMENT_BYTES,
      allowedMimes: type.mimes,
      ...(sha ? { sha256: sha } : {}),
    });
  } catch (e) {
    // No ghost row: a row this attempt created is removed; a row of an earlier attempt is left to the stale sweep.
    if (ins.created) await deps.gw.remove(SCHEMA.attachment, attachmentId).catch(() => undefined);
    throw e;
  }

  // The closing write points the row at the object; a replaced object of an earlier attempt goes after it.
  const oldFile = previous ? str(previous, "FileId") : "";
  deps.after(async () => {
    await deps.gw.update(SCHEMA.attachment, attachmentId, { FileId: p.fileId, StoredName: p.storedName });
    if (oldFile && oldFile !== p.fileId) await removeBytes(deps, oldFile);
  });
  return {
    attachmentId,
    uploadUrl: p.uploadUrl,
    requiredHeaders: {} as Record<string, string>,
    contentType: type.mimes[0],
    attachment: pick(
      {
        ItemId: attachmentId,
        ProjectId: projectId,
        OwnerType: ownerType,
        OwnerId: owner,
        FileName: name,
        Kind: attachmentKind(type),
        Mime: type.mimes[0],
        SizeBytes: o.sizeBytes,
        Status: "pending",
        CreatedByUserId: ctx.caller.userId,
      },
      FIELDS.attachment,
    ),
  };
}

/** The commit of an uploaded file: the stored size and the first bytes must match what was announced. */
export async function commitUpload(ctx: OpCtx, deps: OpDeps, row: Row, o: { attachmentId: string; auditType: string }) {
  if (str(row, "CreatedByUserId") !== ctx.caller.userId) return deps.fail("forbidden", MSG.notUploader);
  const status = str(row, "Status");
  if (status === "deleted") return deps.fail("not_found");
  if (status === "ready") return { attachment: pick(row, FIELDS.attachment), rejected: null };
  if (status === "rejected") return { attachment: pick(row, FIELDS.attachment), rejected: MSG.fileType };

  const fileId = str(row, "FileId");
  const type = fileTypeFor(str(row, "FileName"), str(row, "Mime"));
  let rejected: string | null = null;
  if (!fileId) rejected = MSG.fileMissing;
  else {
    let info: { sizeBytes: number } | null = null;
    try {
      info = await deps.files.info(fileId);
    } catch (e) {
      if (!(e instanceof OpError && e.code === "not_found")) throw e;
    }
    if (!info) rejected = MSG.fileMissing;
    else if (info.sizeBytes !== num(row, "SizeBytes") || info.sizeBytes > MAX_ATTACHMENT_BYTES) rejected = MSG.fileSize;
    else if (!type || !magicMatches(type.ext, await deps.files.head(fileId, HEAD_BYTES))) rejected = MSG.fileType;
  }
  const details = (s: string) => ({ ownerId: str(row, "OwnerId"), status: s, ...(o.auditType === "attachment" ? { ownerType: str(row, "OwnerType") } : {}) });
  if (rejected) {
    await removeBytes(deps, fileId);
    deps.after(async () => {
      await deps.gw.update(SCHEMA.attachment, o.attachmentId, { Status: "rejected" });
    });
    deps.audit({ targetType: o.auditType, targetId: o.attachmentId, details: details("rejected") });
    return { attachment: pick({ ...row, Status: "rejected" }, FIELDS.attachment), rejected };
  }
  deps.after(async () => {
    await deps.gw.update(SCHEMA.attachment, o.attachmentId, { Status: "ready" });
  });
  deps.audit({ targetType: o.auditType, targetId: o.attachmentId, details: details("ready") });
  return { attachment: pick({ ...row, Status: "ready" }, FIELDS.attachment), rejected: null };
}

/** The removal of a draft file the person took out again; a sent file stays with what it was sent with. */
export async function deleteDraft(ctx: OpCtx, deps: OpDeps, row: Row, o: { attachmentId: string; auditType: string; isDraft: boolean }) {
  if (str(row, "CreatedByUserId") !== ctx.caller.userId) return deps.fail("forbidden", MSG.notUploader);
  if (str(row, "Status") === "deleted") return { attachment: pick(row, FIELDS.attachment) };
  if (!o.isDraft) return deps.fail("conflict", MSG.attachmentInUse);
  await removeBytes(deps, str(row, "FileId"));
  deps.after(async () => {
    await deps.gw.update(SCHEMA.attachment, o.attachmentId, { Status: "deleted" });
  });
  deps.audit({
    targetType: o.auditType,
    targetId: o.attachmentId,
    details: { ownerId: str(row, "OwnerId"), ...(o.auditType === "attachment" ? { ownerType: str(row, "OwnerType") } : {}) },
  });
  return { attachment: pick({ ...row, Status: "deleted" }, FIELDS.attachment) };
}

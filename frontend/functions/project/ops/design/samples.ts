// Sample ops of mf-project (lane L6, step s6): sample.presign, sample.commit, sample.url, sample.delete.
// Bytes never pass through a function: presign hands the browser a short-lived upload URL, commit
// verifies size and magic bytes through deps.files only (no fetch, no local storage helper).
import {
  applyPatch,
  checkSampleUpload,
  isStaleUpload,
  magicMatches,
  normaliseStoredName,
  SAMPLE_LIMITS,
} from '../../../../src/domain/designBrief';
import { defineLaneOp, OpError, addChanged, argString } from '../requirements/ports';
import { SCHEMA, wire } from '../requirements/records';
import { checkAttachment, ensureDesignBrief, findAttachment, loadProjectBriefAttachments, loadDesignBrief } from '../requirements/loaders';

type Any = any;

function changedOf(brief: Any | null, atts: Any[]): Any {
  const c: Any = {};
  if (brief) addChanged(c, 'DesignBrief', wire(brief));
  for (const a of atts) addChanged(c, 'Attachment', wire(a));
  return c;
}

/** One AuditEvent per op (queued, written in the router's bookkeeping round); no names or free text in details. */
function audit(ctx: Any, attachmentId: string, details: Record<string, unknown>): void {
  ctx.deps.audit?.({ targetType: 'attachment', targetId: attachmentId, details });
}

function briefState(row: Any) {
  return {
    mode: row.Mode,
    instructions: row.Instructions ?? '',
    sampleIds: [...(row.SampleFileIds ?? [])] as string[],
    status: row.Status,
  };
}

/** Writes a new SampleFileIds list through applyPatch (a confirmed brief goes back to draft). */
async function patchSampleIds(ctx: Any, row: Any, mutate: (ids: string[]) => string[]): Promise<Any> {
  const state = briefState(row);
  const { next, changed } = applyPatch(state, { sampleIds: mutate(state.sampleIds) });
  if (!changed) return row;
  return ctx.db.update(SCHEMA.designBrief, row.ItemId, {
    Mode: next.mode,
    Instructions: next.instructions,
    SampleFileIds: next.sampleIds,
    Status: next.status,
  });
}

/** Round-1 reads: the brief and the project's brief attachments, or the brief and the one attachment (the handler's own reads). */
const prefetchBrief = (env: Any) => Promise.all([loadDesignBrief(env), loadProjectBriefAttachments(env)]);
const prefetchOne = (env: Any, args: Any) => Promise.all([loadDesignBrief(env), findAttachment(env, args.attachmentId)]);
/** Commit also reads the brief's attachments, to settle the sample limits against the rows that exist. */
const prefetchCommit = (env: Any, args: Any) => Promise.all([loadDesignBrief(env), findAttachment(env, args.attachmentId), loadProjectBriefAttachments(env)]);

const isNotFound = (e: unknown): boolean => (e as Any)?.code === 'not_found';

/**
 * The first bytes of an object: null when it is missing. A transient Storage failure is retried once at once
 * (Storage calls are not gateway rounds), then surfaces as the storage error, never as a type mismatch.
 */
async function readHead(files: Any, fileId: string, length: Any): Promise<Uint8Array | null> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await files.head(fileId, length);
    } catch (e) {
      if (isNotFound(e)) return null;
      last = e;
    }
  }
  if (last instanceof Error && typeof (last as Any).code === 'string') throw last;
  throw new OpError('unavailable' as Any, 'storage.unavailable');
}

const byCreatedThenId = (a: Any, b: Any): number =>
  String(a.CreatedDate ?? '').localeCompare(String(b.CreatedDate ?? '')) || String(a.ItemId).localeCompare(String(b.ItemId));

export const presignSample = defineLaneOp({
  op: 'sample.presign',
  permission: 'design.edit',
  requireOpenStep: true,
  record: () => false, // the answer carries an upload URL; the attachment insert is keyed by the request
  prefetch: prefetchBrief,
  parse(raw: Any) {
    const projectId = argString(raw, 'projectId');
    const fileName = typeof raw?.fileName === 'string' ? raw.fileName.trim() : '';
    if (fileName.length < 1 || fileName.length > 255) throw new OpError('invalid_input', 'input.invalid', { field: 'fileName' });
    const mime = typeof raw?.mime === 'string' ? raw.mime : '';
    if (!mime) throw new OpError('invalid_input', 'input.invalid', { field: 'mime' });
    const sizeBytes = raw?.sizeBytes;
    if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
      throw new OpError('invalid_input', 'input.invalid', { field: 'sizeBytes' });
    }
    return { projectId, fileName, mime, sizeBytes };
  },
  async run(ctx: Any, args: Any) {
    const files = ctx.deps.files;
    // the brief and its attachments (round 1 of the router) beside the project folder
    const [found, projectAtts, parentDirectoryId] = await Promise.all([
      loadDesignBrief(ctx),
      loadProjectBriefAttachments(ctx),
      files.projectDirectory(ctx.workspaceId, ctx.project.id),
    ]);
    if (found && found.Mode === 'describe') throw new OpError('conflict', 'design.notSampleMode');

    // This brief's stale pending uploads are cleaned up lazily (idempotent), in the same round as the presign.
    const all = found ? projectAtts.filter((a: Any) => a.OwnerId === found.ItemId) : [];
    const nowMs = ctx.now.getTime();
    const stale: Any[] = [];
    const live: Any[] = [];
    for (const a of all) {
      if (a.Status === 'pending' && isStaleUpload({ status: a.Status, createdAt: a.CreatedDate as string | number | Date | null | undefined }, nowMs)) {
        stale.push(a);
      } else if (a.Status === 'pending' || a.Status === 'ready') {
        live.push(a);
      }
    }

    const check = checkSampleUpload({
      mime: args.mime,
      sizeBytes: args.sizeBytes,
      existing: live.map((a) => ({ sizeBytes: a.SizeBytes, status: a.Status })),
    } as Any) as Any;
    if (!check.ok) {
      switch (check.reason) {
        case 'type':
          throw new OpError('invalid_input', 'design.type');
        case 'empty':
          throw new OpError('invalid_input', 'input.invalid', { field: 'sizeBytes' });
        case 'size':
          throw new OpError('too_large', 'design.fileTooLarge', { maxBytes: SAMPLE_LIMITS.maxFileBytes });
        case 'count':
          throw new OpError('limit_reached', 'design.tooManySamples', { max: SAMPLE_LIMITS.maxSamples });
        case 'total':
          throw new OpError('limit_reached', 'design.totalTooLarge', { maxBytes: SAMPLE_LIMITS.maxTotalBytes });
        default:
          throw new OpError('invalid_input', 'input.invalid', { reason: check.reason });
      }
    }

    const storedName = normaliseStoredName(args.fileName, args.mime);
    if (!storedName) throw new OpError('invalid_input', 'input.invalid', { field: 'fileName' });

    // Presign first: a storage refusal (an OpError from deps.files) reaches the client unchanged and no row exists yet.
    // The brief insert (when it is the first sample) and the stale clean-up ride along in the same round.
    const [presigned, briefMade, ...removed] = await Promise.all([
      files.presignUpload({
        fileName: storedName,
        contentType: args.mime,
        sizeInBytes: args.sizeBytes,
        objectAccessLevel: 'Creator',
        inheritsParentAccess: false,
        accessModifier: 'Private',
        parentDirectoryId,
      }),
      ensureDesignBrief(ctx, 'sample', found),
      ...stale.map(async (a: Any) => {
        await files.remove(a.FileId).catch((e: unknown) => {
          if (!isNotFound(e)) throw e; // a never written object is fine
        });
        return ctx.db.update(SCHEMA.attachment, a.ItemId, { Status: 'deleted' });
      }),
    ]);
    const brief = briefMade.row;
    if (brief.Mode === 'describe') {
      await files.remove(presigned.fileId);
      throw new OpError('conflict', 'design.notSampleMode');
    }
    const changedAtts: Any[] = [...removed];
    let att: Any;
    try {
      att = await ctx.db.insert(SCHEMA.attachment, {
        ProjectId: ctx.project.id,
        OwnerType: 'design-brief',
        OwnerId: brief.ItemId,
        FileId: presigned.fileId,
        FileName: args.fileName.slice(0, 255),
        StoredName: presigned.storedName ?? storedName,
        Mime: args.mime,
        SizeBytes: args.sizeBytes,
        Status: 'pending',
      });
    } catch (e) {
      // No ghost file: the presigned object goes when its row could not be written.
      await files.remove(presigned.fileId).catch(() => undefined);
      throw e;
    }
    if (att.FileId !== presigned.fileId) {
      // A replayed request: the keyed insert answered the first attempt's row. The row now points at this attempt's object.
      if (att.Status !== 'pending') {
        await files.remove(presigned.fileId).catch(() => undefined);
        throw new OpError('conflict', 'design.uploadMissing');
      }
      const oldFileId = att.FileId;
      const [moved] = await Promise.all([
        ctx.db.update(SCHEMA.attachment, att.ItemId, { FileId: presigned.fileId, StoredName: presigned.storedName ?? storedName }),
        Promise.resolve(files.remove(oldFileId)).catch(() => undefined), // an already removed object is fine
      ]);
      att = moved;
    }
    changedAtts.push(att);
    return {
      attachmentId: att.ItemId,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      storedName: presigned.storedName ?? storedName,
      changed: changedOf(null, changedAtts),
    };
  },
});

export const commitSample = defineLaneOp({
  op: 'sample.commit',
  permission: 'design.edit',
  requireOpenStep: true,
  prefetch: prefetchCommit,
  parse(raw: Any) {
    return { projectId: argString(raw, 'projectId'), attachmentId: argString(raw, 'attachmentId') };
  },
  async run(ctx: Any, args: Any) {
    // the brief, the attachment and the brief's attachments in one round
    const [brief, found, projectAtts] = await Promise.all([loadDesignBrief(ctx), findAttachment(ctx, args.attachmentId), loadProjectBriefAttachments(ctx)]);
    if (!brief) throw new OpError('not_found', 'attachment.notFound');
    const att = checkAttachment(found, ctx, brief.ItemId);
    if (att.Status === 'ready') {
      audit(ctx, att.ItemId, { status: 'ready', reason: null });
      return { status: 'ready', reason: null, changed: changedOf(null, [att]) };
    }
    if (att.Status === 'rejected') {
      const limit = limitReason(att.Meta as string);
      if (limit) throw limitError(limit);
      audit(ctx, att.ItemId, { status: 'rejected', reason: att.Meta ? safeReason(att.Meta as string) : null });
      return { status: 'rejected', reason: att.Meta ? safeReason(att.Meta as string) : null, changed: changedOf(null, [att]) };
    }
    const files = ctx.deps.files;
    // The first bytes are read alongside the file info (a missing file just gives no bytes).
    const [info, bytes] = await Promise.all([files.info(att.FileId), readHead(files, att.FileId as string, SAMPLE_LIMITS.magicBytes)]);
    if (!info) throw new OpError('conflict', 'design.uploadMissing');
    if (!bytes) throw new OpError('conflict', 'design.uploadMissing');

    let reason: 'size' | 'type' | null = null;
    if (info.sizeInBytes !== att.SizeBytes || info.sizeInBytes > SAMPLE_LIMITS.maxFileBytes) {
      reason = 'size';
    } else if (!magicMatches(att.Mime as string, bytes)) {
      reason = 'type';
    }
    if (reason) {
      const [, rejected] = await Promise.all([
        files.remove(att.FileId),
        ctx.db.update(SCHEMA.attachment, att.ItemId, { Status: 'rejected', Meta: JSON.stringify({ reason }) }),
      ]);
      audit(ctx, att.ItemId, { status: 'rejected', reason });
      return { status: 'rejected', reason, changed: changedOf(null, [rejected]) };
    }

    // The limits hold under parallel uploads: the live rows of this brief, oldest first, decide who keeps a slot.
    const nowMs = ctx.now.getTime();
    const live = projectAtts
      .filter((a: Any) => a.OwnerId === brief.ItemId && a.ItemId !== att.ItemId)
      .filter(
        (a: Any) =>
          a.Status === 'ready' ||
          (a.Status === 'pending' && !isStaleUpload({ status: a.Status, createdAt: a.CreatedDate as string | number | Date | null | undefined }, nowMs)),
      )
      .concat([att])
      .sort(byCreatedThenId);
    const position = live.findIndex((a: Any) => a.ItemId === att.ItemId);
    const totalBytes = live.slice(0, position + 1).reduce((sum: number, a: Any) => sum + Number(a.SizeBytes ?? 0), 0);
    const over: 'count' | 'total' | null =
      position >= SAMPLE_LIMITS.maxSamples ? 'count' : totalBytes > SAMPLE_LIMITS.maxTotalBytes ? 'total' : null;
    if (over) {
      await Promise.all([
        files.remove(att.FileId),
        ctx.db.update(SCHEMA.attachment, att.ItemId, { Status: 'rejected', Meta: JSON.stringify({ reason: over }) }),
      ]);
      throw limitError(over);
    }
    const [ready, updated] = await Promise.all([
      ctx.db.update(SCHEMA.attachment, att.ItemId, { Status: 'ready' }),
      patchSampleIds(ctx, brief, (ids) => (ids.includes(att.ItemId) ? ids : [...ids, att.ItemId])),
    ]);
    audit(ctx, att.ItemId, { status: 'ready', reason: null });
    return { status: 'ready', reason: null, changed: changedOf(updated, [ready]) };
  },
});

function limitReason(meta: string | null | undefined): 'count' | 'total' | null {
  try {
    const r = meta ? JSON.parse(meta)?.reason : null;
    return r === 'count' || r === 'total' ? r : null;
  } catch {
    return null;
  }
}

function limitError(reason: 'count' | 'total'): OpError {
  return reason === 'count'
    ? new OpError('limit_reached', 'design.tooManySamples', { max: SAMPLE_LIMITS.maxSamples })
    : new OpError('limit_reached', 'design.totalTooLarge', { maxBytes: SAMPLE_LIMITS.maxTotalBytes });
}

function safeReason(meta: string): 'size' | 'type' | null {
  try {
    const r = JSON.parse(meta)?.reason;
    return r === 'size' || r === 'type' ? r : null;
  } catch {
    return null;
  }
}

export const sampleUrl = defineLaneOp({
  op: 'sample.url',
  permission: 'view',
  requireOpenStep: false,
  readOnly: true,
  prefetch: prefetchOne,
  parse(raw: Any) {
    return { projectId: argString(raw, 'projectId'), attachmentId: argString(raw, 'attachmentId') };
  },
  async run(ctx: Any, args: Any) {
    // the brief and the attachment in one round
    const [brief, found] = await Promise.all([loadDesignBrief(ctx), findAttachment(ctx, args.attachmentId)]);
    if (!brief) throw new OpError('not_found', 'attachment.notFound');
    const att = checkAttachment(found, ctx, brief.ItemId);
    if (att.Status !== 'ready') throw new OpError('not_found', 'attachment.notFound');
    const { url, expiresAt } = await ctx.deps.files.downloadUrl(att.FileId);
    return { url, expiresAt, changed: {} };
  },
});

export const deleteSample = defineLaneOp({
  op: 'sample.delete',
  permission: 'design.edit',
  requireOpenStep: true,
  prefetch: prefetchOne,
  parse(raw: Any) {
    return { projectId: argString(raw, 'projectId'), attachmentId: argString(raw, 'attachmentId') };
  },
  async run(ctx: Any, args: Any) {
    // the brief and the attachment in one round
    const [brief, found] = await Promise.all([loadDesignBrief(ctx), findAttachment(ctx, args.attachmentId)]);
    if (!brief) throw new OpError('not_found', 'attachment.notFound');
    const att = checkAttachment(found, ctx, brief.ItemId);
    const pending = att.Status === 'pending';
    const [, deleted, updated] = await Promise.all([
      Promise.resolve(ctx.deps.files.remove(att.FileId)).catch((e: unknown) => {
        // a pending upload may never have been written: its release must not fail on that
        if (!(pending && isNotFound(e))) throw e;
      }),
      ctx.db.update(SCHEMA.attachment, att.ItemId, { Status: 'deleted' }),
      patchSampleIds(ctx, brief, (ids) => ids.filter((id) => id !== att.ItemId)),
    ]);
    audit(ctx, att.ItemId, { previousStatus: att.Status });
    return { changed: changedOf(updated, [deleted]) };
  },
});

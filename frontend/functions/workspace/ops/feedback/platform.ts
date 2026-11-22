// feedback.platform.presign / feedback.platform.submit: a beta tester's feedback on the MADP Factory itself, sent from
// the feedback bubble on every page to any signed-in person, outside any project or workspace. The engine turns each
// one into a ticket on the team's GitHub board (server/local/engine/kinds/platformFeedback.ts); the hand-over is ONE
// EngineJob row of kind "platform.feedback" that belongs to no project, like the daily skills sync
// (server/blocks/engineWorker/dailySync.ts): ProjectId and WorkspaceId "system", no ReaderIds (super admin and service
// read it), written through the service gateway.
//
// Files (a page screenshot, anything else) take the attachment pipeline's rules (collab/ops/common/uploads.ts
// checkUpload: type by name and mime, MAX_ATTACHMENT_BYTES): presign → the browser PUTs the bytes → submit names the
// files and checks each in Storage (it exists, its size is what was announced, its first bytes match its type). No
// Attachment row: the files live in Storage at mf/platform-feedback/<callerUserId>/, and their stored name starts with
// the caller's owner tag, so submit refuses a file another person (or another pipeline) uploaded.
import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import { MAX_JOB_INPUT_CHARS } from "../../../_lib/jobs";
import { checkUpload, shaArg } from "../../../collab/ops/common/uploads";
import { MSG } from "../../../collab/ops/common/messages";
import { magicMatches } from "../../../../src/domain/docs";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "../../../../src/domain/feedback";
import { QUOTA_MESSAGE_KEY, quotaVerdict, type OpQuota } from "../../../../src/domain/security";

export const PLATFORM_FEEDBACK_KIND: EngineJobKind = "platform.feedback";
/** The Storage folder below the mf root; one sub-folder per person. */
export const PLATFORM_FEEDBACK_FOLDER = "platform-feedback";
/** At most this many submissions per person per hour (counted on the person's EngineJob rows of this kind). */
export const PLATFORM_FEEDBACK_PER_HOUR = 20;
export const PLATFORM_FEEDBACK_TITLE_MAX = 120;
export const PLATFORM_FEEDBACK_DESCRIPTION_MAX = 5000;

const SUBMIT_OP = "feedback.platform.submit";
const SUBMIT_QUOTA: OpQuota = { op: SUBMIT_OP, max: PLATFORM_FEEDBACK_PER_HOUR, windowMinutes: 60, source: "operation" };
const SYSTEM = "system";
const HEAD_BYTES = 512;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const str = (row: Row | null | undefined, key: string): string => {
  const x = row?.[key];
  return typeof x === "string" ? x : "";
};
const line = (s: string): string => s.replace(CONTROL, " ").trim();

/** The first 12 hex characters of the caller's uuid5: every stored name of the caller's feedback files starts with it. */
export const ownerTag = (deps: Pick<OpDeps, "ids">, userId: string): string =>
  deps.ids.uuid5(`platform-feedback:owner:${userId}`).replace(/-/g, "").slice(0, 12);

/** The job's RequestKey and ActiveKey: a retried submit finds the same job. */
export const platformFeedbackKey = (requestId: string): string => `${PLATFORM_FEEDBACK_KIND}:${requestId.toLowerCase()}`;

export interface PlatformFeedbackFile {
  fileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/** What the engine reads from EngineJob.InputJson. */
export interface PlatformFeedbackInput {
  title: string;
  description: string;
  page: { path: string; title: string };
  client: { userAgent: string; viewport: string; language: string };
  files: PlatformFeedbackFile[];
  reporter: { userId: string; name: string; email: string; impersonated?: true };
  submittedAt: string;
}

const PRESIGN_ARGS = v.object({
  fileName: v.string({ min: 1, max: 255 }),
  mime: v.string({ min: 1, max: 100 }),
  sizeBytes: v.int({ min: 1 }),
  sha256: shaArg(),
});

const FILE_ARGS = v.object({
  fileId: v.id(),
  fileName: v.string({ min: 1, max: 255 }),
  mime: v.string({ min: 1, max: 100 }),
  sizeBytes: v.int({ min: 1 }),
});

const SUBMIT_ARGS = v.object({
  requestId: v.string({ pattern: UUID }),
  title: v.string({ min: 1, max: PLATFORM_FEEDBACK_TITLE_MAX, trim: true }),
  description: v.string({ min: 1, max: PLATFORM_FEEDBACK_DESCRIPTION_MAX, trim: true }),
  page: v.object({ path: v.string({ max: 300 }), title: v.string({ max: 200 }) }),
  client: v.object({ userAgent: v.string({ max: 400 }), viewport: v.string({ max: 20 }), language: v.string({ max: 20 }) }),
  files: v.optional(v.array(FILE_ARGS, { max: MAX_ATTACHMENTS })),
});

type FileVerdict = { ok: true; file: PlatformFeedbackFile } | { ok: false; messageKey: string; rule: string };

const isNotFound = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "not_found";

/** One named file in Storage: the caller's, the announced size (within the limit), and first bytes of its type. */
async function verifyFile(deps: OpDeps, tag: string, a: { fileId: string; sizeBytes: number }, checked: ReturnType<typeof checkUpload>): Promise<FileVerdict> {
  let info: { name: string; sizeBytes: number } | null = null;
  try {
    info = await deps.files.info(a.fileId);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  // Another person's file (or another pipeline's) answers exactly like a missing one.
  if (!info || !info.name.startsWith(`${tag}-`)) return { ok: false, messageKey: MSG.fileMissing, rule: "missing" };
  if (info.sizeBytes !== a.sizeBytes || info.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, messageKey: MSG.fileSize, rule: "size" };
  let head: Uint8Array;
  try {
    head = await deps.files.head(a.fileId, HEAD_BYTES);
  } catch (e) {
    if (isNotFound(e)) return { ok: false, messageKey: MSG.fileMissing, rule: "missing" };
    throw e;
  }
  if (!magicMatches(checked.type.ext, head)) return { ok: false, messageKey: MSG.fileType, rule: "type" };
  return { ok: true, file: { fileId: a.fileId, fileName: checked.name, mime: checked.type.mimes[0] as string, sizeBytes: a.sizeBytes } };
}

export const PLATFORM_FEEDBACK_OPS = [
  defineOp({
    op: "feedback.platform.presign",
    kind: "command",
    // Any signed-in, active person (the me.* ops' level): no workspace or project role.
    scope: "self",
    args: PRESIGN_ARGS,
    async handler(ctx: OpCtx, args, deps: OpDeps) {
      // The type, size, name and sha256 checks come before any Storage call.
      const checked = checkUpload(deps, args);
      const userId = ctx.caller.userId;
      const fileUuid = deps.ids.uuid5(`platform-feedback:file:${userId}:${ctx.requestId}:${args.fileName}`);
      const upload = await deps.files.presignUpload({
        folder: [PLATFORM_FEEDBACK_FOLDER, userId],
        // Stored as <ownerTag>-<uuid>-<safe name>.<ext> (functions/_lib/storage.ts normaliseFileName).
        fileName: `${ownerTag(deps, userId)}-${fileUuid}-${checked.name}`,
        mime: checked.type.mimes[0] as string,
        sizeBytes: args.sizeBytes,
        maxBytes: MAX_ATTACHMENT_BYTES,
        allowedMimes: checked.type.mimes,
        ...(checked.sha ? { sha256: checked.sha } : {}),
      });
      return { fileId: upload.fileId, upload };
    },
  }),

  defineOp({
    op: SUBMIT_OP,
    kind: "command",
    scope: "self",
    args: SUBMIT_ARGS,
    async handler(ctx: OpCtx, args, deps: OpDeps) {
      const svc = deps.svc;
      if (!svc) return deps.fail("forbidden");
      const userId = ctx.caller.userId;
      const key = platformFeedbackKey(args.requestId);
      const files = args.files ?? [];
      // Type and size of every file before any read (the presign's rules).
      const checked = files.map((file) => checkUpload(deps, file));

      // R1: the caller's newest feedback jobs: a retry of this request answers its job; more than the hourly limit is refused.
      const mine = await svc.find("EngineJob", {
        where: f.and(f.eq("ProjectId", SYSTEM), f.eq("Kind", PLATFORM_FEEDBACK_KIND), f.eq("CreatedByUserId", userId)),
        fields: ["ItemId", "RequestKey", "CreatedDate"],
        sort: { field: "CreatedDate", dir: "desc" },
        page: 1,
        pageSize: PLATFORM_FEEDBACK_PER_HOUR,
      });
      const same = mine.items.find((r) => str(r, "RequestKey") === key);
      if (same) return { jobId: str(same, "ItemId") };
      const verdict = quotaVerdict(SUBMIT_QUOTA, mine.items.map((r) => r.CreatedDate), ctx.now.getTime());
      if (verdict.limited) {
        return deps.fail("limit_reached", QUOTA_MESSAGE_KEY, {
          op: SUBMIT_OP,
          max: SUBMIT_QUOTA.max,
          windowMinutes: SUBMIT_QUOTA.windowMinutes,
          retryAfterSeconds: verdict.retryAfterSeconds,
        });
      }

      // R2: every file in Storage, in parallel; the first refused file (in the order sent) answers.
      const tag = ownerTag(deps, userId);
      const verdicts = await Promise.all(files.map((file, i) => verifyFile(deps, tag, file, checked[i] as ReturnType<typeof checkUpload>)));
      const sent: PlatformFeedbackFile[] = [];
      for (const [i, verdictOf] of verdicts.entries()) {
        if (!verdictOf.ok) {
          return deps.fail("invalid_input", verdictOf.messageKey, { field: `files[${i}]`, rule: verdictOf.rule, index: i, fileName: (checked[i] as ReturnType<typeof checkUpload>).name });
        }
        sent.push(verdictOf.file);
      }

      // The reporter from the verified token, else the Account row the router already read (no extra read).
      const name = line(ctx.caller.displayName || str(ctx.account, "DisplayName")).slice(0, 200);
      const email = (ctx.caller.email || str(ctx.account, "Email")).trim().toLowerCase().slice(0, 254);
      const input: PlatformFeedbackInput = {
        title: line(args.title),
        description: args.description.replace(CONTROL_KEEP_LINES, " ").trim(),
        page: { path: line(args.page.path), title: line(args.page.title) },
        client: { userAgent: line(args.client.userAgent), viewport: line(args.client.viewport), language: line(args.client.language) },
        files: sent,
        reporter: { userId, name, email, ...(ctx.caller.impersonated ? { impersonated: true as const } : {}) },
        submittedAt: ctx.now.toISOString(),
      };
      if (!input.title || !input.description) return deps.fail("invalid_input", undefined, { field: input.title ? "description" : "title", rule: "min" });
      const inputJson = JSON.stringify(input);
      if (inputJson.length > MAX_JOB_INPUT_CHARS) return deps.fail("too_large");

      // R3: the one job row (dailySync.ts's shape). RequestKey and ActiveKey are both unique: a retry finds the same row.
      const res = await svc.insert(
        "EngineJob",
        {
          ProjectId: SYSTEM,
          WorkspaceId: SYSTEM,
          Kind: PLATFORM_FEEDBACK_KIND,
          Status: "queued",
          ActiveKey: key,
          Attempts: 0,
          Progress: 0,
          Message: "Feedback received.",
          InputJson: inputJson,
          CreatedByUserId: userId,
          RequestedByUserId: userId,
        },
        { requestKey: key },
      );
      if (!res.itemId) return deps.fail("conflict");
      if (!res.created) {
        // The same requestId of another person must never answer that person's job.
        const row = await svc.get("EngineJob", res.itemId, ["ItemId", "CreatedByUserId"]);
        if (!row || str(row, "CreatedByUserId") !== userId) return deps.fail("conflict");
      }
      return { jobId: res.itemId };
    },
  }),
];

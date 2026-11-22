// Scope feedback ops: scope.feedback.add and scope.feedback.setStatus (item 3 of the L7 brief).
// One deterministic thread per item; the author always comes from env.userId; text and attachments are validated server-side.
import { commentTextIssue, isFeedbackTargetType, threadKey } from "../../../../src/domain/scopeFeedback";
import { DECISION_TEXT, FEEDBACK_JOB_TARGET, statusAfterComment } from "../../../../src/domain/feedback";
import { WORKSPACE_PERMISSIONS, type WorkspacePermission } from "../../../../src/domain/rbac";
import { SUCCESS_KEYS } from "../../../../src/domain/successTargets";
import { ok, fail, parseArgs } from "./ports";
import type { ScopeEnv, ScopeOpDef, ScopeReadEnv } from "./ports";
import { findInProject, latestVersion, naturalKey, stepOf } from "./shared";

const S = {
  thread: "FeedbackThread",
  comment: "FeedbackComment",
  attachment: "Attachment",
  feature: "Feature",
  story: "Story",
  screen: "DesignScreen",
  milestone: "Milestone",
} as const;

const str = (row: Record<string, unknown>, k: string): string => (typeof row[k] === "string" ? (row[k] as string) : "");
const ID = { type: "string", max: 128 } as const;
const MAX_ATTACHMENTS = 5;

/** Before lock: the latest version is not locked and the journey step is still `scope`. */
/** The version read of beforeLock, runnable from a prefetch (it needs only the project id and the reads). */
export const readGate = (env: ScopeReadEnv | ScopeEnv) => latestVersion(env as unknown as ScopeEnv);

export async function beforeLock(env: ScopeEnv): Promise<{ ok: true; version: Record<string, unknown> | null } | { ok: false }> {
  const version = (await readGate(env)) as Record<string, unknown> | null;
  if (stepOf(env.project) !== "scope" || (version && str(version, "Status") === "locked")) return { ok: false };
  return { ok: true, version };
}

/** Comments and their status: while the scope is open (the team proposes the change) and after it is locked (the team
 *  turns the comment into a change request, feedback.apply). Not before the project reaches the scope step. */
export async function feedbackOpen(env: ScopeEnv): Promise<{ ok: true; version: Record<string, unknown> | null; locked: boolean } | { ok: false }> {
  const version = (await readGate(env)) as Record<string, unknown> | null;
  const locked = !!version && str(version, "Status") === "locked";
  if (!locked && stepOf(env.project) !== "scope") return { ok: false };
  return { ok: true, version, locked };
}

/** The target row of a thread, read beside the version (features, stories and milestones must belong to the latest version).
 *  A success target has no row of its own: it is one key of the version's SuccessTargets, checked in targetOk. */
async function findTarget(env: ScopeEnv, type: string, id: string): Promise<Record<string, unknown> | null> {
  const schema = type === "screen" ? S.screen : type === "feature" ? S.feature : type === "story" ? S.story : type === "milestone" ? S.milestone : "";
  return schema ? ((await findInProject(env, schema, id)) as Record<string, unknown> | null) : null;
}

function targetOk(type: string, id: string, row: Record<string, unknown> | null, version: Record<string, unknown> | null): boolean {
  if (type === "screen") return !!row;
  if (type === "success") return !!version && (SUCCESS_KEYS as readonly string[]).includes(id);
  if (!row || !version) return false;
  return row.ScopeVersion === version.Number;
}

const feedbackAdd: ScopeOpDef = {
  op: "scope.feedback.add",
  kind: "command",
  permission: "comment",
  parse(args) {
    const flat = parseArgs({
      projectId: ID,
      commentKey: { type: "string", max: 64 },
      text: { type: "string" },
      attachmentIds: { type: "string[]", max: 128, maxItems: MAX_ATTACHMENTS },
    })(args);
    if (!flat.ok) return flat;
    const t = (args as Record<string, unknown>).target as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object" || typeof t.type !== "string" || typeof t.id !== "string" || !t.id || t.id.length > 128) {
      return { ok: false, messageKey: "input.wrongType", params: { key: "target" } };
    }
    if (!isFeedbackTargetType(t.type)) return { ok: false, messageKey: "input.wrongType", params: { key: "target.type" } };
    return { ok: true, value: { ...flat.value, target: { type: t.type, id: t.id } } };
  },
  prefetch(env: ScopeReadEnv, a) {
    const e = env as unknown as ScopeEnv;
    return Promise.all([
      readGate(env),
      findTarget(e, a.target.type, a.target.id),
      ...[...new Set<string>(a.attachmentIds)].map((id) => findInProject(e, S.attachment, id)),
      env.db.query(S.thread, { ProjectId: env.projectId, TargetType: a.target.type, TargetId: a.target.id }, { limit: 1 }),
    ]);
  },
  record: () => false,
  async run(env, a) {
    const ids: string[] = [...new Set<string>(a.attachmentIds)];
    const tid = { ProjectId: env.projectId, TargetType: a.target.type, TargetId: a.target.id };
    // Round 1 (the router's, via prefetch): the gate, the target, the attachments and the thread are independent reads.
    const [gate, targetRow, attachmentRows, threadRows] = await Promise.all([
      feedbackOpen(env),
      findTarget(env, a.target.type, a.target.id),
      Promise.all(
        ids.map(async (id) => {
          const row = (await findInProject(env, S.attachment, id)) as Record<string, unknown> | null;
          // OwnerId is the commentKey until the comment exists; on a retry it already points at this caller's comment.
          let owned = !!row && str(row, "OwnerId") === a.commentKey;
          if (row && !owned) {
            const c = (await findInProject(env, S.comment, str(row, "OwnerId"))) as Record<string, unknown> | null;
            owned = !!c && str(c, "AuthorUserId") === env.userId;
          }
          return { row, owned };
        }),
      ),
      env.db.query(S.thread, tid, { limit: 1 }),
    ]);
    if (!gate.ok) return fail("conflict", "scope.locked");
    if (!a.commentKey) return fail("invalid_input", "input.wrongType", { key: "commentKey" });
    const issue = commentTextIssue(a.text);
    if (issue) return fail("invalid_input", issue);
    if (!targetOk(a.target.type, a.target.id, targetRow, gate.version)) return fail("not_found");

    const attachments: Record<string, unknown>[] = [];
    for (const { row, owned } of attachmentRows) {
      if (!row || str(row, "Status") !== "ready" || str(row, "OwnerType") !== "feedback-comment" || !owned || str(row, "CreatedByUserId") !== env.userId) {
        return fail("invalid_input", "attachment.notReady");
      }
      attachments.push(row);
    }

    // Round 2: the thread (one per item, found by its unique key or created with the first comment) and the comment are
    // written together; a comment of a new thread carries a provisional ThreadId (derived from its natural key) until round 3.
    const found = (threadRows[0] ?? null) as Record<string, unknown> | null;
    // A person's comment is work for the team: a resolved or updated thread is open again (a running job stays "working").
    const status = statusAfterComment(found ? str(found, "Status") : "open");
    const reopen = !!found && status !== str(found, "Status");
    const stamp = { CreatedDate: env.issuedStamp, LastUpdatedDate: env.issuedStamp };
    const commentFields = (threadId: string) => ({
      ProjectId: env.projectId,
      ThreadId: threadId,
      AuthorUserId: env.userId,
      Text: a.text,
      Kind: "comment",
      At: env.nowIso,
      AttachmentIds: ids,
    });
    const [madeThread, ins] = await Promise.all([
      found
        ? Promise.resolve(null)
        : env.db.insert(S.thread, { ...tid, Status: "open" }, naturalKey("thread", threadKey(env.projectId, a.target.type, a.target.id))),
      env.db.insert(
        S.comment,
        commentFields(found ? str(found, "ItemId") : env.uuid5(`${env.projectId}:comment-thread:${a.commentKey}`)),
        naturalKey(env.projectId, "comment", a.commentKey),
      ),
      found && reopen ? env.db.update(S.thread, str(found, "ItemId"), { Status: status }) : Promise.resolve(null),
    ]);
    const threadId = found ? str(found, "ItemId") : (madeThread as { id: string }).id;

    // Round 3: the comment's real ThreadId, the attachments' owner, the team's job on this thread (feedback.apply; one
    // active job per thread: a comment that arrives while it runs is picked up by that job before it ends) and the
    // queued writes, in one parallel round.
    const toMove = attachments.filter((row) => str(row, "OwnerId") !== ins.id);
    const fixThread = !found || !ins.created;
    env.audit("feedback-thread", threadId, { commentId: ins.id, kind: "comment", target: a.target.type });
    const last: Promise<unknown>[] = [
      ...(fixThread ? [env.db.update(S.comment, ins.id, { ThreadId: threadId })] : []),
      ...toMove.map((row) => env.db.update(S.attachment, str(row, "ItemId"), { OwnerId: ins.id })),
      env.jobs.create({
        kind: "feedback.apply",
        input: { projectId: env.projectId, threadId, commentId: ins.id },
        targetType: FEEDBACK_JOB_TARGET,
        targetId: threadId,
        // one job per comment (a retried request finds the same job)
        eventKey: `feedback.apply:${ins.id}`,
      }),
      env.flush(),
    ];
    await Promise.all(last);

    // The answer is built from the rows written, with this request's issued stamp.
    const thread = found
      ? { ...found, ...(reopen ? { Status: status, LastUpdatedDate: env.issuedStamp } : {}) }
      : { ItemId: threadId, ...tid, Status: "open", ...stamp };
    const comment = { ItemId: ins.id, ...commentFields(threadId), ...stamp };
    const moved = attachments.map((row) => (toMove.includes(row) ? { ...row, OwnerId: ins.id, LastUpdatedDate: env.issuedStamp } : row));
    return ok({ thread, comment, attachments: moved });
  },
};

/** The edit permission of the item a thread is about: feature, story, milestone and success target -> scope.lock,
 *  screen -> design.edit. */
const RESOLVE_PERMISSION: Record<string, WorkspacePermission> = {
  feature: "scope.lock",
  story: "scope.lock",
  milestone: "scope.lock",
  success: "scope.lock",
  screen: "design.edit",
};

const DECISIONS = new Set(["applied", "kept"]);

const feedbackSetStatus: ScopeOpDef = {
  op: "scope.feedback.setStatus",
  kind: "command",
  permission: "comment",
  // status: what a person may set (reopen, or accept and close); decision: what they did with the team's suggestion.
  parse(args) {
    const r = parseArgs({ projectId: ID, threadId: ID, status: { type: "string", max: 16 }, decision: { type: "string", max: 16, optional: true } })(args);
    if (!r.ok) return r;
    if (r.value.status !== "open" && r.value.status !== "resolved") {
      return { ok: false, messageKey: "input.wrongType", params: { key: "status" } };
    }
    if (r.value.decision && !DECISIONS.has(r.value.decision)) return { ok: false, messageKey: "input.wrongType", params: { key: "decision" } };
    return r;
  },
  prefetch: (env: ScopeReadEnv, a) => Promise.all([readGate(env), findInProject(env as unknown as ScopeEnv, S.thread, a.threadId)]),
  async run(env, a) {
    const [gate, found] = await Promise.all([feedbackOpen(env), findInProject(env, S.thread, a.threadId)]);
    if (!gate.ok) return fail("conflict", "scope.locked");
    const thread = found as Record<string, unknown> | null;
    if (!thread) return fail("not_found");
    // Membership is checked by the router; the item's editors may close or reopen any thread (viewers cannot), and a
    // person who commented in the thread may accept and close it.
    const needed = RESOLVE_PERMISSION[str(thread, "TargetType")];
    const held = env.isSuperAdmin ? WORKSPACE_PERMISSIONS : env.permissions;
    if (!needed || !held.includes(needed)) {
      const mine = needed && a.status === "resolved"
        ? await env.db.query(S.comment, { ProjectId: env.projectId, ThreadId: str(thread, "ItemId"), AuthorUserId: env.userId, Kind: "comment" }, { limit: 1 })
        : [];
      if (mine.length === 0) return fail("forbidden", "permission.missing", { permission: needed ?? "scope.lock" });
    }
    const current = str(thread, "Status") || "open";
    if (current === a.status && !a.decision) return ok({ thread });
    const decision = (a.decision || (a.status === "resolved" ? "accepted" : "reopened")) as keyof typeof DECISION_TEXT;
    // The decision is written into the thread as a system entry (who, when, what), next to the status.
    env.audit("feedback-thread", str(thread, "ItemId"), { from: current, to: a.status, decision });
    await Promise.all([
      env.db.update(S.thread, str(thread, "ItemId"), { Status: a.status }),
      env.db.insert(
        S.comment,
        { ProjectId: env.projectId, ThreadId: str(thread, "ItemId"), AuthorUserId: env.userId, Text: DECISION_TEXT[decision], Kind: "system", At: env.nowIso, AttachmentIds: [] },
        naturalKey(env.projectId, "decision", `${str(thread, "ItemId")}:${env.requestId}`),
      ),
      env.flush(),
    ]);
    return ok({ thread: { ...thread, Status: a.status, LastUpdatedDate: env.issuedStamp } });
  },
};

export const FEEDBACK_HANDLERS: readonly ScopeOpDef[] = [feedbackAdd, feedbackSetStatus];

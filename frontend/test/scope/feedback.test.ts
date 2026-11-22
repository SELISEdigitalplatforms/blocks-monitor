// Scope & success feedback, the Goals & requirements way: per-item threads on features, stories, screens, milestones and
// the success & performance targets, written by the scope feedback ops and read by the shared feedback card.
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_HANDLERS } from "../../functions/project/ops/scope/feedback";
import { FEEDBACK_TARGET_TYPES, isFeedbackTargetType } from "../../src/domain/scopeFeedback";
import { SCOPE_FEEDBACK_TARGETS, threadFromRow } from "../../src/blocks/scope/records";
import { FEEDBACK_RESOLVE_PERMISSION } from "../../src/blocks/scope/mutations";
import { selectCommentStats, selectThreads } from "../../src/blocks/collab/feedback";
import { checkScopeFeedbackFile, uploadScopeFeedbackFiles, type UploadDeps } from "../../src/blocks/scope/uploads";
import { teamLabelOf, teamRoleOf, threadKey } from "../../src/domain/feedback";
import { SUCCESS_KEYS } from "../../src/domain/successTargets";

type Row = Record<string, unknown>;
const AT = "2026-10-28T09:00:00.000Z";
const add = FEEDBACK_HANDLERS.find((h) => h.op === "scope.feedback.add")!;
const setStatus = FEEDBACK_HANDLERS.find((h) => h.op === "scope.feedback.setStatus")!;

function envWith(rows: Record<string, Row[]>, opts: { stage?: string; permissions?: string[] } = {}) {
  let n = 0;
  const inserted: [string, Row][] = [];
  const jobs: Row[] = [];
  const env: any = {
    projectId: "p1", workspaceId: "w1", userId: "u9", nowIso: AT, issuedStamp: AT, attempt: 1,
    project: { ItemId: "p1", Stage: opts.stage ?? "scope" }, permissions: opts.permissions ?? ["comment"], isSuperAdmin: false,
    uuid5: (name: string) => `uuid:${name}`,
    flush: async () => undefined,
    db: {
      query: async (schema: string, filter: Row) => (rows[schema] ?? []).filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)),
      insert: vi.fn(async (schema: string, fields: Row) => {
        const id = `${schema}-${++n}`;
        (rows[schema] ??= []).push({ ItemId: id, ...fields });
        inserted.push([schema, fields]);
        return { id, created: true };
      }),
      update: vi.fn(async (schema: string, id: string, patch: Row) => {
        const r = (rows[schema] ?? []).find((x) => x.ItemId === id);
        if (r) Object.assign(r, patch);
      }),
    },
    audit: () => undefined,
    after: () => undefined,
    requestId: "req-1",
    jobs: {
      create: vi.fn(async (i: Row) => {
        jobs.push(i);
        return { job: { ItemId: `job-${jobs.length}`, ...i }, existing: false };
      }),
    },
  };
  return { env, rows, inserted, jobs };
}
const version = (extra: Row = {}): Row => ({ ItemId: "v1", ProjectId: "p1", Number: 1, Status: "draft", ...extra });
const comment = (target: { type: string; id: string }, text = "Peak is Monday 07:00, not the whole morning.") =>
  add.parse({ projectId: "p1", commentKey: "k-0123456789abcdef", text, attachmentIds: [], target }) as { ok: true; value: any };

describe("scope feedback targets", () => {
  it("success & performance targets are a feedback target of the scope, resolved by people who lock the scope", () => {
    expect(FEEDBACK_TARGET_TYPES).toContain("success");
    expect(isFeedbackTargetType("success")).toBe(true);
    expect(SCOPE_FEEDBACK_TARGETS).toEqual(["feature", "story", "screen", "milestone", "success"]);
    expect(FEEDBACK_RESOLVE_PERMISSION.success).toBe("scope.lock");
    expect(threadFromRow({ ItemId: "t1", TargetType: "success", TargetId: "responseTime", Status: "open" })).toMatchObject({ targetType: "success", targetId: "responseTime" });
  });
});

describe("scope.feedback.add on a success target", () => {
  it("opens one thread per target key and stores the comment", async () => {
    const { env, rows } = envWith({ ScopeVersion: [version()] });
    const parsed = comment({ type: "success", id: "responseTime" });
    expect(parsed.ok).toBe(true);
    const res: any = await add.run(env, parsed.value);
    expect(res.ok).toBe(true);
    expect(res.data.thread).toMatchObject({ TargetType: "success", TargetId: "responseTime", Status: "open" });
    expect(res.data.comment).toMatchObject({ Text: "Peak is Monday 07:00, not the whole morning.", AuthorUserId: "u9", Kind: "comment" });
    expect(rows.FeedbackThread).toHaveLength(1);
    // the second comment joins the same thread
    const again: any = await add.run(env, { ...parsed.value, commentKey: "k-fedcba9876543210", text: "And month-end." });
    expect(again.data.thread.ItemId).toBe(res.data.thread.ItemId);
    expect(rows.FeedbackThread).toHaveLength(1);
    expect(rows.FeedbackComment).toHaveLength(2);
  });

  it("takes every success key and refuses anything else", async () => {
    for (const k of SUCCESS_KEYS) {
      const { env } = envWith({ ScopeVersion: [version()] });
      expect(((await add.run(env, comment({ type: "success", id: k }).value)) as any).ok, k).toBe(true);
    }
    const { env } = envWith({ ScopeVersion: [version()] });
    expect(await add.run(env, comment({ type: "success", id: "budget" }).value)).toMatchObject({ ok: false, code: "not_found" });
    const none = envWith({ ScopeVersion: [] });
    expect(await add.run(none.env, comment({ type: "success", id: "users" }).value)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("stays open once the scope is locked (the team turns the comment into a change request), not before the scope step", async () => {
    const locked = envWith({ ScopeVersion: [version({ Status: "locked" })] }, { stage: "build" });
    expect(await add.run(locked.env, comment({ type: "success", id: "users" }).value)).toMatchObject({ ok: true });
    expect(locked.jobs).toHaveLength(1);
    const early = envWith({ ScopeVersion: [version()] }, { stage: "requirements" });
    expect(await add.run(early.env, comment({ type: "success", id: "users" }).value)).toMatchObject({ ok: false, messageKey: "scope.locked" });
  });

  it("every comment queues the team's work on its thread (one feedback.apply per thread)", async () => {
    const { env, jobs } = envWith({ ScopeVersion: [version()] });
    const res: any = await add.run(env, comment({ type: "success", id: "outcome" }).value);
    expect(jobs).toEqual([
      expect.objectContaining({
        kind: "feedback.apply",
        targetType: "feedback-thread",
        targetId: res.data.thread.ItemId,
        input: { projectId: "p1", threadId: res.data.thread.ItemId, commentId: res.data.comment.ItemId },
      }),
    ]);
  });

  it("a comment while the team works keeps the thread working; on an updated thread it opens it again", async () => {
    const working = envWith({
      ScopeVersion: [version()],
      FeedbackThread: [{ ItemId: "t1", ProjectId: "p1", TargetType: "success", TargetId: "users", Status: "working" }],
    });
    expect(((await add.run(working.env, comment({ type: "success", id: "users" }).value)) as any).data.thread.Status).toBe("working");
    const updated = envWith({
      ScopeVersion: [version()],
      FeedbackThread: [{ ItemId: "t1", ProjectId: "p1", TargetType: "success", TargetId: "users", Status: "updated" }],
    });
    expect(((await add.run(updated.env, comment({ type: "success", id: "users" }).value)) as any).data.thread.Status).toBe("open");
    expect(updated.rows.FeedbackThread![0]!.Status).toBe("open");
  });

  it("a comment on a resolved thread reopens it", async () => {
    const { env, rows } = envWith({
      ScopeVersion: [version()],
      FeedbackThread: [{ ItemId: "t1", ProjectId: "p1", TargetType: "success", TargetId: "users", Status: "resolved" }],
    });
    const res: any = await add.run(env, comment({ type: "success", id: "users" }).value);
    expect(res.data.thread).toMatchObject({ ItemId: "t1", Status: "open" });
    expect(rows.FeedbackThread![0]!.Status).toBe("open");
  });
});

describe("scope.feedback.setStatus", () => {
  const thread = (type: string, id: string): Row => ({ ItemId: "t1", ProjectId: "p1", TargetType: type, TargetId: id, Status: "open" });

  it("resolving a success thread needs scope.lock; a commenter alone cannot", async () => {
    const viewer = envWith({ ScopeVersion: [version()], FeedbackThread: [thread("success", "outcome")] }, { permissions: ["comment"] });
    expect(await setStatus.run(viewer.env, { projectId: "p1", threadId: "t1", status: "resolved" })).toMatchObject({ ok: false, code: "forbidden" });
    const owner = envWith({ ScopeVersion: [version()], FeedbackThread: [thread("success", "outcome")] }, { permissions: ["comment", "scope.lock"] });
    const res: any = await setStatus.run(owner.env, { projectId: "p1", threadId: "t1", status: "resolved" });
    expect(res).toMatchObject({ ok: true, data: { thread: { Status: "resolved" } } });
    expect(owner.rows.FeedbackThread![0]!.Status).toBe("resolved");
    // the decision is written into the thread
    expect(owner.rows.FeedbackComment).toEqual([expect.objectContaining({ ThreadId: "t1", Kind: "system", Text: "Accepted and closed.", AuthorUserId: "u9" })]);
  });

  it("the person who commented may accept and close the team's update; applying a suggestion is recorded as such", async () => {
    const mine: Row = { ItemId: "c1", ProjectId: "p1", ThreadId: "t1", AuthorUserId: "u9", Kind: "comment", Text: "Make it bigger." };
    const commenter = envWith({ ScopeVersion: [version()], FeedbackThread: [{ ...thread("screen", "s1"), Status: "updated" }], FeedbackComment: [mine] }, { permissions: ["comment"] });
    const res: any = await setStatus.run(commenter.env, { projectId: "p1", threadId: "t1", status: "resolved", decision: "applied" });
    expect(res).toMatchObject({ ok: true, data: { thread: { Status: "resolved" } } });
    expect(commenter.rows.FeedbackComment!.at(-1)).toMatchObject({ Kind: "system", Text: "Applied the suggested change." });
    // reopening still needs the item's edit permission
    expect(await setStatus.run(commenter.env, { projectId: "p1", threadId: "t1", status: "open" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(setStatus.parse({ projectId: "p1", threadId: "t1", status: "working" })).toMatchObject({ ok: false });
    expect(setStatus.parse({ projectId: "p1", threadId: "t1", status: "resolved", decision: "maybe" })).toMatchObject({ ok: false });
  });
});

describe("existing scope comments in the shared feedback card", () => {
  // threads written by the scope ops are read by the card's reads (the same FeedbackThread / FeedbackComment rows)
  const threads: Row[] = [
    { ItemId: "t1", ProjectId: "p1", TargetType: "feature", TargetId: "f1", Status: "open" },
    { ItemId: "t2", ProjectId: "p1", TargetType: "story", TargetId: "s1", Status: "resolved" },
    { ItemId: "t3", ProjectId: "p1", TargetType: "screen", TargetId: "d1", Status: "open" },
    { ItemId: "t4", ProjectId: "p1", TargetType: "milestone", TargetId: "m1", Status: "open" },
    { ItemId: "t5", ProjectId: "p1", TargetType: "success", TargetId: "users", Status: "open" },
    { ItemId: "t6", ProjectId: "p1", TargetType: "requirement", TargetId: "r1", Status: "open" },
  ];

  it("finds every scope item's thread by its item, next to the requirement threads", () => {
    const byKey = selectThreads(threads as any);
    expect(byKey.get(threadKey("feature", "f1"))).toMatchObject({ id: "t1", status: "open" });
    expect(byKey.get(threadKey("story", "s1"))).toMatchObject({ id: "t2", status: "resolved" });
    expect(byKey.get(threadKey("screen", "d1"))?.id).toBe("t3");
    expect(byKey.get(threadKey("milestone", "m1"))?.id).toBe("t4");
    expect(byKey.get(threadKey("success", "users"))?.id).toBe("t5");
    expect(byKey.get(threadKey("requirement", "r1"))?.id).toBe("t6");
  });

  it("counts the people's comments (not system lines) and their files for the item's button", () => {
    const stats = selectCommentStats([
      { ItemId: "c1", ThreadId: "t1", Kind: "comment", AttachmentIds: ["a1"] },
      { ItemId: "c2", ThreadId: "t1", Kind: "comment", AttachmentIds: [] },
      { ItemId: "c3", ThreadId: "t1", Kind: "system", AttachmentIds: [] },
      { ItemId: "c4", ThreadId: "t5", Kind: "comment" },
    ] as any);
    expect(stats.get("t1")).toEqual({ comments: 2, attachments: 1 });
    expect(stats.get("t5")).toEqual({ comments: 1, attachments: 0 });
  });
});

describe("scope comment files in the shared composer", () => {
  const file = (name: string, type: string, size = 2048) => new File([new Uint8Array(size)], name, { type });
  const deps = (over: Partial<UploadDeps> = {}): UploadDeps => ({
    presign: vi.fn(async (a) => ({ attachmentId: `att-${a.fileName}`, uploadUrl: "https://files.local/x", requiredHeaders: {}, storedName: a.fileName })),
    put: vi.fn(async () => undefined),
    commit: vi.fn(async () => ({ attachment: {}, rejected: false })),
    remove: vi.fn(async () => ({ attachment: {} })),
    ...over,
  });

  it("checks the type and size before anything is sent", () => {
    expect(checkScopeFeedbackFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkScopeFeedbackFile({ type: "application/zip", size: 1000 })).toMatch(/PNG, JPEG, WebP and PDF/);
    expect(checkScopeFeedbackFile({ type: "application/pdf", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });

  it("uploads through the scope attachment ops and reports the composer's phases", async () => {
    const d = deps();
    const states: [number, string][] = [];
    const ids = await uploadScopeFeedbackFiles({
      projectId: "p1", commentKey: "k1", deps: d,
      files: [file("sketch.png", "image/png"), file("notes.zip", "application/zip")],
      onState: (i, s) => states.push([i, s.phase]),
    });
    expect(ids).toEqual(["att-sketch.png"]);
    expect(d.presign).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", commentKey: "k1", fileName: "sketch.png" }));
    expect(states).toContainEqual([0, "uploading"]);
    expect(states).toContainEqual([0, "done"]);
    expect(states).toContainEqual([1, "failed"]);
  });

  it("a failed byte upload is reported as failed and can be retried", async () => {
    const states: { phase: string; retryable?: boolean }[] = [];
    const ids = await uploadScopeFeedbackFiles({
      projectId: "p1", commentKey: "k1", deps: deps({ put: vi.fn(async () => { throw new Error("network"); }) }),
      files: [file("plan.pdf", "application/pdf")], onState: (_i, s) => states.push(s),
    });
    expect(ids).toEqual([]);
    expect(states.at(-1)).toMatchObject({ phase: "failed", retryable: true });
  });
});

describe("who answers a thread", () => {
  it("people read the analysis role as the business analyst; the engine's prompts keep their own word", () => {
    for (const t of ["requirement", "extra", "sanitization"]) expect(teamLabelOf(t)).toBe("The business analyst");
    expect(teamLabelOf("screen")).toBe("The designer");
    expect(teamLabelOf("feature")).toBe("The business analyst");
    for (const t of ["requirement", "screen", "feature", "success"]) expect(teamLabelOf(t)).not.toMatch(/product manager|planner/i);
    // server/ only (engine prompts and context), never shown
    expect(teamRoleOf("requirement")).toBe("The product manager");
    expect(teamRoleOf("feature")).toBe("The planner");
  });
});

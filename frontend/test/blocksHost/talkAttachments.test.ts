// Files people attach where they talk to the team (src/domain/attachments.ts), through the real router: the upload ops
// (collab attachment.*), and the send ops that move the drafts onto their record — an answer to a question
// (clarification.answer), feedback on a preview (milestone.feedback), a chat message (agentChat.send) and a change
// request answer (cr.answer). The comment boxes' feedback.attachment.* keep working on the same pipeline.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import type { FilesService } from "../../functions/_lib/storage";
import { TALK_ATTACHMENT_OPS } from "../../functions/collab/ops/attachments/talk";
import { FEEDBACK_ATTACHMENT_OPS } from "../../functions/collab/ops/feedback/attachments";
import { SEND_OPS } from "../../functions/collab/ops/chat/send";
import { SANITIZATION_DEFS } from "../../functions/project/ops/sanitization/register";
import { deliveryBoundOps } from "../../functions/delivery/ops/bind";
import { claimDrafts, questionIdOf } from "../../src/domain/attachments";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const OTHER = { userId: "member-2", email: "jonas.meier@alpine-fresh.ch", displayName: "Jonas Meier" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const DRAFT = "draft-key-0000000000000001";

/** Storage in memory: presign makes a file record, `put` stores the bytes the browser would PUT. */
function memoryFiles() {
  const files = new Map<string, { name: string; mime: string; bytes: Uint8Array | null }>();
  let n = 0;
  const service: FilesService = {
    projectDirectory: async () => "dir",
    async presignUpload(i) {
      const fileId = `file-${++n}`;
      files.set(fileId, { name: i.fileName, mime: i.mime, bytes: null });
      return { fileId, uploadUrl: `https://storage.test/${fileId}`, storedName: i.fileName, displayName: i.fileName, directoryId: "dir", requiredHeaders: {} } as never;
    },
    async info(fileId) {
      const f = files.get(fileId);
      if (!f?.bytes) throw Object.assign(new Error("not_found"), { code: "not_found" });
      return { fileId, name: f.name, mime: f.mime, sizeBytes: f.bytes.length, directoryId: "dir", createdAt: "" } as never;
    },
    downloadUrl: async (fileId) => ({ url: `https://storage.test/${fileId}?read`, expiresAt: null }),
    async remove(fileId) { files.delete(fileId); },
    async head(fileId, bytes) { return (files.get(fileId)?.bytes ?? new Uint8Array()).slice(0, bytes); },
  };
  const put = (url: string, bytes: Uint8Array) => { files.get(url.split("/").pop()!)!.bytes = bytes; };
  return { service, put, files };
}

function setup() {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "owner" }, { ...OTHER, roleKey: "member" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, Stage: "sanitization", CurrentScopeVersion: 1 });
  const project = gateway.rows("Project").find((p) => p.ItemId === projectId)!;
  const stamp = { WorkspaceId: workspaceId, ReaderIds: project.ReaderIds, ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
  const storage = memoryFiles();
  const run = (fn: string, ops: unknown, op: string, args: Record<string, unknown>, who = ME, requestId?: string) =>
    runOp(fn, ops, { ctx: fakeCtx(who), gateway, files: () => storage.service, request: { op, args: { projectId, ...args }, ...(requestId ? { requestId } : {}) } });
  /** presign → PUT → commit, as the browser does (src/blocks/collab/feedbackUpload.ts); answers the ready id. */
  const upload = async (owner: Record<string, unknown>, o: { who?: typeof ME; name?: string; draftKey?: string } = {}) => {
    const who = o.who ?? ME;
    const p = await run("collab", TALK_ATTACHMENT_OPS, "attachment.presign", {
      ...owner, draftKey: o.draftKey ?? DRAFT, fileName: o.name ?? "design.png", mime: "image/png", sizeBytes: PNG.length,
    }, who);
    expect(p.status).toBe(200);
    storage.put(p.body.data.uploadUrl, PNG);
    const c = await run("collab", TALK_ATTACHMENT_OPS, "attachment.commit", { attachmentId: p.body.data.attachmentId }, who);
    expect(c.body.data.rejected).toBeNull();
    return String(p.body.data.attachmentId);
  };
  const attachment = (id: string) => gateway.rows("Attachment").find((a) => a.ItemId === id)!;
  return { gateway, projectId, stamp, run, upload, attachment, storage };
}

describe("claimDrafts (pure)", () => {
  const row = (o: Record<string, unknown>) => ({ ItemId: "a1", ProjectId: "p1", OwnerType: "clarification", OwnerId: "draft:k1", Status: "ready", CreatedByUserId: "u1", FileName: "x.png", ...o });
  it("takes the caller's ready drafts, and on a retry the files already on the owner", () => {
    expect(claimDrafts([row({})], { ids: ["a1"], ownerType: "clarification", draftKey: "k1", userId: "u1", projectId: "p1" })).toMatchObject({ ok: true, move: ["a1"] });
    expect(claimDrafts([row({ OwnerId: "c1" })], { ids: ["a1"], ownerType: "clarification", draftKey: "k1", userId: "u1", projectId: "p1", ownerId: "c1" })).toMatchObject({ ok: true, move: [] });
  });
  it("refuses another person's file, a pending one, another owner type, another draft and a missing draft key", () => {
    const base = { ids: ["a1"], ownerType: "clarification" as const, draftKey: "k1", userId: "u1", projectId: "p1" };
    expect(claimDrafts([row({ CreatedByUserId: "u2" })], base).ok).toBe(false);
    expect(claimDrafts([row({ Status: "pending" })], base).ok).toBe(false);
    expect(claimDrafts([row({ OwnerType: "ticket" })], base).ok).toBe(false);
    expect(claimDrafts([row({ OwnerId: "draft:k2" })], base).ok).toBe(false);
    expect(claimDrafts([row({ OwnerId: "c9" })], { ...base, ownerId: "c1" }).ok).toBe(false);
    expect(claimDrafts([row({})], { ...base, draftKey: "" })).toEqual({ ok: false, reason: "draftKey" });
    expect(claimDrafts([], { ...base, ids: [] })).toMatchObject({ ok: true, move: [] });
  });
  it("reads the question a change request file belongs to", () => {
    expect(questionIdOf('{"questionId":"q2"}')).toBe("q2");
    expect(questionIdOf("")).toBeNull();
    expect(questionIdOf("not json")).toBeNull();
  });
});

describe("answers to the product manager's questions", () => {
  it("uploads a design for the answer and keeps it with the question; the comment boxes still work", async () => {
    const t = setup();
    const clarificationId = seedRow(t.gateway, "Clarification", { ...t.stamp, Number: 1, Question: "Do you want to provide a design?", Status: "open", OwnerUserId: "", SourceType: "engine", SourceRef: "", SortOrder: 1 });
    const id = await t.upload({ ownerType: "clarification", forId: clarificationId });
    expect(t.attachment(id)).toMatchObject({ OwnerType: "clarification", OwnerId: `draft:${DRAFT}`, Status: "ready", Kind: "image", Mime: "image/png", FileName: "design.png" });

    const answered = await t.run("project", SANITIZATION_DEFS, "clarification.answer", { id: clarificationId, answer: "Yes, here is our design.", attachmentIds: [id], draftKey: DRAFT });
    expect(answered.status).toBe(200);
    expect(t.attachment(id).OwnerId).toBe(clarificationId);
    expect(t.gateway.rows("Clarification").find((c) => c.ItemId === clarificationId)).toMatchObject({ Status: "answered", Answer: "Yes, here is our design." });

    // a sent file can be opened by the team, but no longer removed as a draft
    const other = await t.run("collab", TALK_ATTACHMENT_OPS, "attachment.url", { attachmentId: id }, OTHER);
    expect(other.body.data.url).toContain("?read");
    expect((await t.run("collab", TALK_ATTACHMENT_OPS, "attachment.delete", { attachmentId: id })).body.error).toMatchObject({ code: "conflict" });
    // the comment-box ops see only their own owner type
    expect((await t.run("collab", FEEDBACK_ATTACHMENT_OPS, "feedback.attachment.url", { attachmentId: id })).body.error).toMatchObject({ code: "not_found" });
  });

  it("refuses a file that is not ready or belongs to someone else", async () => {
    const t = setup();
    const clarificationId = seedRow(t.gateway, "Clarification", { ...t.stamp, Number: 1, Question: "Which colours?", Status: "open", OwnerUserId: "", SourceType: "engine", SourceRef: "", SortOrder: 1 });
    const theirs = await t.upload({ ownerType: "clarification", forId: clarificationId }, { who: OTHER });
    const res = await t.run("project", SANITIZATION_DEFS, "clarification.answer", { id: clarificationId, answer: "Blue", attachmentIds: [theirs], draftKey: DRAFT });
    expect(res.body.error).toMatchObject({ code: "invalid_input", messageKey: "sanitization.attachmentNotReady" });
    expect(t.gateway.rows("Clarification").find((c) => c.ItemId === clarificationId)!.Status).toBe("open");
    expect(t.attachment(theirs).OwnerId).toBe(`draft:${DRAFT}`);
    // a draft of another person is not visible to me
    expect((await t.run("collab", TALK_ATTACHMENT_OPS, "attachment.url", { attachmentId: theirs })).body.error).toMatchObject({ code: "not_found" });
  });

  it("refuses a file whose bytes are not what the name says", async () => {
    const t = setup();
    const clarificationId = seedRow(t.gateway, "Clarification", { ...t.stamp, Number: 1, Question: "Logo?", Status: "open", OwnerUserId: "", SourceType: "engine", SourceRef: "", SortOrder: 1 });
    const p = await t.run("collab", TALK_ATTACHMENT_OPS, "attachment.presign", { ownerType: "clarification", forId: clarificationId, draftKey: DRAFT, fileName: "logo.png", mime: "image/png", sizeBytes: 12 });
    t.storage.put(p.body.data.uploadUrl, new TextEncoder().encode("hello world!"));
    const c = await t.run("collab", TALK_ATTACHMENT_OPS, "attachment.commit", { attachmentId: p.body.data.attachmentId });
    expect(c.body.data.rejected).toBeTruthy();
    expect(t.attachment(p.body.data.attachmentId).Status).toBe("rejected");
  });
});

describe("feedback on a preview", () => {
  it("puts the screenshot on the fix ticket", async () => {
    const t = setup();
    const milestoneId = seedRow(t.gateway, "Milestone", { ...t.stamp, Number: 1, Name: "Ordering", Goal: "Order online", Status: "preview-ready", ScopeVersion: 1, SortOrder: 1, FeatureRefs: [] });
    const id = await t.upload({ ownerType: "ticket", forId: milestoneId }, { name: "screen.png" });
    const res = await t.run("delivery", deliveryBoundOps, "milestone.feedback", { milestoneId, text: "The button is too small. Make it bigger like this.", attachmentIds: [id], draftKey: DRAFT });
    expect(res.status).toBe(200);
    const ticketId = res.body.data.ticketId as string;
    expect(t.gateway.rows("Ticket").find((x) => x.ItemId === ticketId)).toMatchObject({ Source: "feedback" });
    expect(t.attachment(id)).toMatchObject({ OwnerType: "ticket", OwnerId: ticketId });
  });

  it("refuses a chat file sent as preview feedback (wrong place), and writes no ticket", async () => {
    const t = setup();
    const milestoneId = seedRow(t.gateway, "Milestone", { ...t.stamp, Number: 1, Name: "Ordering", Goal: "Order online", Status: "preview-ready", ScopeVersion: 1, SortOrder: 1, FeatureRefs: [] });
    const chatFile = await t.upload({ ownerType: "agent-chat" });
    const res = await t.run("delivery", deliveryBoundOps, "milestone.feedback", { milestoneId, text: "Bigger button please.", attachmentIds: [chatFile], draftKey: DRAFT });
    expect(res.body.error).toMatchObject({ code: "invalid_input", messageKey: "delivery.files.notReady" });
    expect(t.gateway.rows("Ticket")).toHaveLength(0);
  });
});

describe("change request answers", () => {
  it("keeps the file with the change request and the question it answers", async () => {
    const t = setup();
    const analysis = serializeChangeAnalysis(parseChangeAnalysis({
      v: 1, kind: "change", summary: "Add a wishlist", impact: { features: ["Wishlist"] }, risks: [],
      tickets: [{ title: "Wishlist page", description: "A page with the saved items." }], estimate: { tickets: 1 },
      questions: [
        { id: "q1", text: "Do you have a design for it?", options: ["Yes", "No"], answer: null, answeredBy: null, answeredAt: null },
        { id: "q2", text: "Show it on phones?", options: ["Yes", "No"], answer: null, answeredBy: null, answeredAt: null },
      ],
      contextVersion: 1,
    })!);
    const crId = seedRow(t.gateway, "ChangeRequest", { ...t.stamp, Number: 1, Lane: "change", FeatureRef: "", Title: "Wishlist", Description: "Add a wishlist", Status: "questions", RequestedByUserId: ME.userId, Analysis: analysis });
    const id = await t.upload({ ownerType: "change-request", forId: crId });
    const res = await t.run("delivery", deliveryBoundOps, "cr.answer", { changeRequestId: crId, answers: [{ id: "q1", answer: "Yes" }], attachmentIds: [id], draftKey: DRAFT });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(t.attachment(id)).toMatchObject({ OwnerType: "change-request", OwnerId: crId });
    expect(questionIdOf(t.attachment(id).Meta)).toBe("q1");
  });
});

describe("chat with an agent", () => {
  it("a message with a file goes to the agent (never a canned small-talk reply) and the file is on the message", async () => {
    const t = setup();
    const id = await t.upload({ ownerType: "agent-chat" }, { name: "idea.png" });
    const res = await t.run("collab", SEND_OPS, "agentChat.send", { agentRole: "planner", text: "Thanks", attachmentIds: [id], draftKey: DRAFT });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
    expect(res.body.data.route).toBe("job");
    const messageId = res.body.data.userMessageId as string;
    expect(t.attachment(id)).toMatchObject({ OwnerType: "agent-chat", OwnerId: messageId });
    const job = t.gateway.rows("EngineJob").find((j) => j.Kind === "chat.reply")!;
    expect(JSON.parse(String(job.InputJson)).messageId).toBe(messageId);
  });
});

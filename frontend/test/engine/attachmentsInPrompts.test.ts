// The files people attach while they talk to the team reach the AI steps that read what they said: the answers to the
// product manager's questions (sanitization / requirements), a change request and its answers (change.analyse), and
// the agent chat (chat.reply). Pictures go to Claude with the prompt, labelled as the prompt numbers them; documents
// are quoted under what they belong to. Without files the prompt is what it always was.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/attachmentsInPrompts.test.ts
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import type { AttachedFile } from "../../server/local/engine/ai/attachments.ts";
import { groupedFiles, questionIdOf } from "../../server/local/engine/ai/attachedGroups.ts";
import { changeFileGroups } from "../../server/local/engine/kinds/changes.ts";
import { earlierUserMessages } from "../../server/local/engine/kinds/collab/files.ts";
import { createFileRecord, writeBytes } from "../../server/local/storage.ts";
import { makeWorld, type World } from "./harness";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const text = (t: string) => new TextEncoder().encode(t);

const file = (id: string, ownerId: string, kind: AttachedFile["kind"], extra: Partial<AttachedFile> = {}): AttachedFile => ({
  id, ownerType: "change-request", ownerId, name: `${id}.${kind === "image" ? "png" : "md"}`, mime: kind === "image" ? "image/png" : "text/markdown", sizeBytes: 10,
  kind, text: kind === "document" ? `text of ${id}` : "", image: kind === "image" ? PNG : null, path: null, ...extra,
});

describe("grouped files (pure)", () => {
  it("numbers the pictures as Claude is shown them, at most four, and quotes documents under their group", () => {
    const g = groupedFiles([
      { where: "With the request itself", files: [file("a", "x", "image"), file("b", "x", "document")] },
      { where: "With the answer to the question \"Which screens?\"", files: [file("c", "x", "image"), file("d", "x", "image"), file("e", "x", "image"), file("f", "x", "image")] },
      { where: "Nothing here", files: [] },
    ], "Files");
    expect(g.images.map((i) => i.label)).toEqual([
      "a.png, with the request itself",
      'c.png, with the answer to the question "Which screens?"',
      'd.png, with the answer to the question "Which screens?"',
      'e.png, with the answer to the question "Which screens?"',
    ]);
    expect(g.block).toContain("- a.png: a picture (Picture 1 above).");
    expect(g.block).toContain('- b.md:\n"""\ntext of b\n"""');
    expect(g.block).toContain("- e.png: a picture (Picture 4 above).");
    expect(g.block).toContain("- f.png: a picture that could not be shown here");
    expect(g.block).not.toContain("Nothing here");
    expect(groupedFiles([{ where: "x", files: [] }])).toEqual({ images: [], block: "" });
  });

  it("puts a change request's file under the answer its Meta names, else under the request", () => {
    expect(questionIdOf('{"questionId":"q2"}')).toBe("q2");
    expect(questionIdOf("not json")).toBe("");
    expect(questionIdOf("")).toBe("");
    const analysis = { questions: [{ id: "q1", text: "Who signs?", options: [], answer: "The technician", answeredBy: null, answeredAt: null }] } as never;
    const groups = changeFileGroups([file("a", "cr", "image"), file("b", "cr", "document"), file("c", "cr", "document")], new Map([["b", "q1"], ["c", "q9"]]), analysis);
    expect(groups.map((g) => [g.where, g.files.map((f) => f.id)])).toEqual([
      ["With the change request itself", ["a", "c"]],
      ['With the answer to the question "Who signs?" (they answered "The technician")', ["b"]],
    ]);
  });

  it("reads the person's last six messages before the one answered", () => {
    const m = (id: string, at: string, role = "user"): Row => ({ ItemId: id, Role: role, At: at, Text: id });
    const thread = [m("m0", "01"), m("m1", "02"), m("r1", "03", "agent"), m("m2", "04"), m("m3", "05"), m("m4", "06"), m("m5", "07"), m("m6", "08"), m("now", "09"), m("later", "10")];
    expect(earlierUserMessages(thread, thread[8]!).map((x) => x.ItemId)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
  });
});

describe("AI steps read the attached files", () => {
  let w: World;
  let calls: AiRequest[] = [];
  const install = (fn: (r: AiRequest) => unknown) => setAiRunner(async (r) => { calls.push(r); return fn(r); });
  const props = (r: AiRequest): string[] => Object.keys((r.schema as { properties?: object }).properties ?? {});

  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());
  afterEach(() => {
    setAiRunner(null);
    calls = [];
  });

  /** A ready Attachment row with its bytes in the local storage. */
  function attach(p: Row, ownerType: string, ownerId: string, name: string, mime: string, bytes: Uint8Array, extra: Row = {}): string {
    const rec = createFileRecord(w.db, { directoryId: "", name, mime, sizeBytes: bytes.length });
    writeBytes(w.db, path.join(w.dir, "files"), rec.fileId, bytes);
    const row = w.store.insert("Attachment", {
      ProjectId: p.ItemId, OwnerType: ownerType, OwnerId: ownerId, FileId: rec.fileId, FileName: name, StoredName: name, Kind: mime.startsWith("image/") ? "image" : "document",
      Mime: mime, SizeBytes: bytes.length, Origin: "upload", Meta: "", Status: "ready", CreatedDate: w.now().toISOString(),
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId, ...extra,
    } as Row);
    return s(row.ItemId);
  }

  it("chat.reply shows the pictures of the message and of earlier messages, and quotes their documents", async () => {
    install(() => ({ answer: "I looked at your sketch: the button goes top right, as drawn." }));
    const p = w.project("Driver Delivery App");
    const pid = s(p.ItemId);
    const by = s(p.CreatedByUserId);
    const msg = async (t: string, key: string) =>
      (await w.gw.insert("AgentChatMessage", { ProjectId: pid, AgentRole: "dev", Role: "user", Kind: "text", Text: t, AuthorUserId: by, EngineJobId: "", At: w.now().toISOString(), WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: capKey(`test:${key}`) })).itemId!;

    // without files: no pictures and no files section
    const plain = await msg("What are you working on?", "att-chat-0");
    const j0 = await w.queue({ project: s(p.Name), kind: "chat.reply", input: { projectId: pid, thread: "agent", threadId: "dev", messageId: plain }, key: "att-chat-0" });
    await w.settle();
    expect(w.get("EngineJob", j0).Status).toBe("succeeded");
    expect(calls[0]!.images).toBeUndefined();
    expect(calls[0]!.prompt).not.toContain("Files the person attached");
    calls = [];

    const earlier = await msg("Here are our brand colours.", "att-chat-1");
    attach(p, "agent-chat", earlier, "colours.md", "text/markdown", text("Primary: #0B5FFF\nAccent: #FFB400\n"));
    const now = await msg("Where does the button go? See my sketch.", "att-chat-2");
    attach(p, "agent-chat", now, "sketch.png", "image/png", PNG);
    attach(p, "agent-chat", now, "draft.png", "image/png", PNG, { Status: "pending" });
    const j1 = await w.queue({ project: s(p.Name), kind: "chat.reply", input: { projectId: pid, thread: "agent", threadId: "dev", messageId: now }, key: "att-chat-1" });
    await w.settle();
    expect(w.get("EngineJob", j1).Status).toBe("succeeded");
    const r = calls[0]!;
    expect(r.images?.map((i) => [i.mimeType, i.label])).toEqual([["image/png", "sketch.png, with the message you are answering now"]]);
    expect(r.prompt).toContain("Files the person attached in this chat");
    expect(r.prompt).toContain("- sketch.png: a picture (Picture 1 above).");
    expect(r.prompt).toContain('With their earlier message "Here are our brand colours."');
    expect(r.prompt).toContain("Primary: #0B5FFF");
    expect(r.prompt).not.toContain("draft.png");
  });

  it("the product manager's questions read the files attached to an answer", async () => {
    install((r) => (props(r).includes("questions")
      ? { questions: [{ question: "Which payment methods should checkout accept at launch?", source: "", forApprover: false, options: ["Card only", "Card and TWINT"] }] }
      : {}));
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const c = w.store.insert("Clarification", {
      ProjectId: pid, Number: 90, Question: "What should the order confirmation look like?", Answer: "Like the attached picture, with our terms.", Status: "answered",
      OwnerUserId: p.CreatedByUserId, AnsweredByUserId: p.CreatedByUserId, AnsweredAt: w.now().toISOString(), SourceType: "engine", SourceRef: "",
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId, RequestKey: capKey("test:att-clar"),
    } as Row);
    attach(p, "clarification", s(c.ItemId), "confirmation.png", "image/png", PNG);
    attach(p, "clarification", s(c.ItemId), "terms.md", "text/markdown", text("Returns are accepted within 30 days.\n"));
    attach(p, "clarification", `draft:${s(c.ItemId)}`, "not-sent.png", "image/png", PNG);
    const id = await w.queue({ project: s(p.Name), kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "att-clar" });
    await w.settle();
    const r = calls.find((x) => props(x).includes("questions"))!;
    expect(r, w.log.join("\n")).toBeTruthy();
    expect(r.images?.map((i) => i.label)).toEqual(['confirmation.png, with the answer to the question "What should the order confirmation look like?"']);
    expect(r.prompt).toContain("Files attached to this answer: confirmation.png, terms.md (see below)");
    expect(r.prompt).toContain("Files the client attached to their answers");
    expect(r.prompt).toContain("Returns are accepted within 30 days.");
    expect(r.prompt).not.toContain("not-sent.png");
    expect(s(w.get("EngineJob", id).Status)).toBe("succeeded");
  });

  it("change.analyse reads the files of the request and of its answers", async () => {
    const p = w.project("Service Technician Portal");
    const pid = s(p.ItemId);
    install(() => ({
      kind: "change", scopeChange: false, summary: "The job report gets the signature box from the picture.",
      impact: { features: [], stories: [], screens: [], milestones: [] }, conflicts: [], risks: [],
      acceptanceCriteria: ["The signature box shows on the job report."], tickets: [{ title: "Signature box", description: "Add the signature box as drawn." }], questions: [],
    }));
    const cr = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: 91, Lane: "change", FeatureRef: "", Title: "Signature on the job report", Description: "See the picture.",
      Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: "t:cr:att-91",
      Analysis: JSON.stringify({ v: 1, kind: "change", summary: "First look.", questions: [{ id: "q1", text: "Who signs?", options: ["The customer", "The technician"], answer: "The customer", answeredBy: null, answeredAt: null }] }),
    });
    const crId = cr.itemId!;
    attach(p, "change-request", crId, "signature.png", "image/png", PNG);
    attach(p, "change-request", crId, "who-signs.md", "text/markdown", text("Only the customer signs, never the technician.\n"), { Meta: JSON.stringify({ questionId: "q1" }) });
    const id = await w.queue({ project: s(p.Name), kind: "change.analyse", input: { projectId: pid, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId }, key: "att-cr" });
    await w.settle();
    expect(w.get("EngineJob", id).Status, w.log.join("\n")).toBe("succeeded");
    const r = calls[0]!;
    expect(r.images?.map((i) => i.label)).toEqual(["signature.png, with the change request itself"]);
    expect(r.prompt).toContain("Files the person attached to the change request");
    expect(r.prompt).toContain("With the change request itself:\n- signature.png: a picture (Picture 1 above).");
    expect(r.prompt).toContain('With the answer to the question "Who signs?" (they answered "The customer"):\n- who-signs.md:');
    expect(r.prompt).toContain("Only the customer signs, never the technician.");
  });
});

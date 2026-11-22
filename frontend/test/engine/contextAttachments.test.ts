// The files people attach while they talk to the team (Attachment rows) in the project context: listed in
// sources.attachments with the record they belong to, shown in the digest, and recorded once as "file.attached" user
// events in the ledger. Only ready files of a saved record count (a "draft:" owner is a text still being written).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/contextAttachments.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { ProjectView } from "../../server/local/engine/context.ts";
import type { RowStore } from "../../server/local/rowStore.ts";
import { attachmentOwnerSchema, buildSections, type Sections } from "../../server/engine-context/snapshot.ts";
import { recordUserActions, userActionsOf } from "../../server/engine-context/userEvents.ts";
import { memoryContext, readLedger } from "../../server/engine-context/store.ts";
import { contextDigest } from "../../server/engine-context/digest.ts";
import { USER_SCHEMAS } from "../../server/blocks/engineWorker/contextRefresh.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function storeOf(tables: Record<string, Row[]>): RowStore {
  return {
    rows: (s: string) => tables[s] ?? [],
    get: (s: string, id: string) => (tables[s] ?? []).find((r) => r.ItemId === id),
  } as unknown as RowStore;
}

const P = "p1";
const att = (id: string, o: Record<string, unknown>): Row => ({
  ItemId: id, ProjectId: P, FileId: `file-${id}`, FileName: `${id}.png`, Mime: "image/png", SizeBytes: 1200, Kind: "image", Origin: "upload",
  Status: "ready", CreatedByUserId: "u1", CreatedDate: "2026-10-31T12:00:00Z", ...o,
});
const tables: Record<string, Row[]> = {
  Project: [{ ItemId: P, WorkspaceId: "w1", Name: "Asset Market" }],
  Membership: [{ WorkspaceId: "w1", UserId: "u1", DisplayName: "Lea Meier" }],
  Attachment: [
    att("a-clar", { OwnerType: "clarification", OwnerId: "c1", FileName: "price-list.pdf", Mime: "application/pdf", Kind: "document", CreatedDate: "2026-10-31T12:01:00Z" }),
    att("a-cr", { OwnerType: "change-request", OwnerId: "cr1", Meta: '{"questionId":"q2"}', CreatedDate: "2026-10-31T12:02:00Z" }),
    att("a-chat", { OwnerType: "agent-chat", OwnerId: "m1", CreatedDate: "2026-10-31T12:03:00Z" }),
    att("a-ticket", { OwnerType: "ticket", OwnerId: "t1", CreatedDate: "2026-10-31T12:04:00Z" }),
    att("a-comment", { OwnerType: "feedback-comment", OwnerId: "fc1", CreatedDate: "2026-10-31T12:00:30Z" }),
    // not (yet) part of a record: a draft, a pending upload, a deleted or rejected file
    att("a-draft", { OwnerType: "feedback-comment", OwnerId: "draft:k1" }),
    att("a-pending", { OwnerType: "clarification", OwnerId: "c1", Status: "pending" }),
    att("a-deleted", { OwnerType: "clarification", OwnerId: "c1", Status: "deleted" }),
    att("a-rejected", { OwnerType: "agent-chat", OwnerId: "m1", Status: "rejected" }),
  ],
};
const p = new ProjectView(storeOf(tables), P);
const ctxOf = (sections: Sections) => memoryContext({ workspaceId: "w1", projectId: P, sections, digestOf: () => "", now: new Date("2026-10-31T13:00:00Z") });

describe("files people attached, in the project context", () => {
  it("lists the ready files of saved records with their owner as Schema:ItemId, oldest first", () => {
    const s = buildSections({ p, kbDir: null, projectDir: null });
    const list = s.sources.attachments ?? [];
    expect(list.map((a) => a.ref)).toEqual(["Attachment:a-comment", "Attachment:a-clar", "Attachment:a-cr", "Attachment:a-chat", "Attachment:a-ticket"]);
    expect(list.map((a) => a.owner)).toEqual(["FeedbackComment:fc1", "Clarification:c1", "ChangeRequest:cr1", "AgentChatMessage:m1", "Ticket:t1"]);
    expect(list[1]).toEqual({
      ref: "Attachment:a-clar", name: "price-list.pdf", mime: "application/pdf", sizeBytes: 1200, kind: "document", owner: "Clarification:c1", ownerType: "clarification", by: "u1", at: "2026-10-31T12:01:00Z",
    });
    expect(attachmentOwnerSchema("something-new")).toBe("something-new");
  });

  it("shows them in the digest, and leaves the digest as it was without any", () => {
    const s = buildSections({ p, kbDir: null, projectDir: null });
    const d = contextDigest(ctxOf(s), { blocks: ["sources"], budget: 4000 });
    expect(d.text).toContain('File "price-list.pdf" attached to Clarification:c1');
    expect(d.refs).toContain("Attachment:a-ticket");
    const bare = new ProjectView(storeOf({ ...tables, Attachment: [] }), P);
    const s0 = buildSections({ p: bare, kbDir: null, projectDir: null });
    expect(s0.sources.attachments).toEqual([]);
    const d0 = contextDigest(ctxOf(s0), { blocks: ["sources"], budget: 4000 });
    const d0Old = contextDigest(ctxOf({ ...s0, sources: { ...s0.sources, attachments: undefined } }), { blocks: ["sources"], budget: 4000 });
    expect(d0.text).toBe(d0Old.text);
  });

  it('records each attached file once as a "file.attached" user event', () => {
    const acts = userActionsOf(p, null).filter((a) => a.action === "file.attached");
    expect(acts.map((a) => a.key)).toEqual(["attached:a-comment", "attached:a-clar", "attached:a-cr", "attached:a-chat", "attached:a-ticket"]);
    expect(acts.find((a) => a.ref === "Attachment:a-cr")).toEqual({
      key: "attached:a-cr", action: "file.attached", ref: "Attachment:a-cr", by: "u1", at: "2026-10-31T12:02:00Z",
      detail: { owner: "ChangeRequest:cr1", ownerType: "change-request", name: "a-cr.png", sizeBytes: 1200, mime: "image/png" },
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-attach-"));
    made.push(dir);
    expect(recordUserActions(dir, acts, { contextVersion: 3, nameOf: (id) => (id === "u1" ? "Lea Meier" : "") })).toBe(5);
    expect(recordUserActions(dir, acts, { contextVersion: 4 })).toBe(0);
    const ev = readLedger(dir).find((e) => e.key === "attached:a-chat");
    expect(ev).toMatchObject({ type: "user", action: "file.attached", ref: "Attachment:a-chat", by: "u1", byName: "Lea Meier", owner: "AgentChatMessage:m1", contextVersion: 3 });
  });

  it("is read by the worker's periodic refresh", () => {
    expect(USER_SCHEMAS).toContain("Attachment");
  });
});

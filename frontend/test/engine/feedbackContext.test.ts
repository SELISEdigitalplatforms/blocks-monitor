// Feedback in the project context (engine-context/feedbackContext.ts): the comments people leave on items, with the
// item in plain words, in sections.feedback; the "feedback" / "openFeedback" digest blocks the jobs get; and the
// feedback actions as ledger events, each recorded once. Also the screens (sections.design) feedback.apply reads.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/feedbackContext.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { ProjectView } from "../../server/local/engine/context.ts";
import type { RowStore } from "../../server/local/rowStore.ts";
import { buildSections, type Sections } from "../../server/engine-context/snapshot.ts";
import { feedbackActionsOf } from "../../server/engine-context/feedbackContext.ts";
import { recordUserActions, userActionsOf } from "../../server/engine-context/userEvents.ts";
import { memoryContext, readLedger } from "../../server/engine-context/store.ts";
import { KIND_BLOCKS, contextDigest, wholeDigest } from "../../server/engine-context/digest.ts";
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
const T = (h: string) => `2026-10-31T${h}:00Z`;
const thread = (id: string, targetType: string, targetId: string, status: string, o: Record<string, unknown> = {}): Row => ({
  ItemId: id, ProjectId: P, TargetType: targetType, TargetId: targetId, Status: status, ...o,
});
const comment = (id: string, threadId: string, at: string, o: Record<string, unknown>): Row => ({
  ItemId: id, ProjectId: P, ThreadId: threadId, AuthorUserId: "u1", Kind: "comment", Text: "", AttachmentIds: [], At: at, CreatedDate: at, ...o,
});
const team = (o: Record<string, unknown>) => ({ AuthorUserId: "", RequestKey: "engine:j9:1:fb-reply", ...o });

const tables: Record<string, Row[]> = {
  Project: [{ ItemId: P, WorkspaceId: "w1", Name: "Asset Market" }],
  Membership: [{ WorkspaceId: "w1", UserId: "u1", DisplayName: "Lea Meier" }],
  Requirement: [{ ItemId: "r1", ProjectId: P, Number: 3, Title: "Sign in with email", Text: "People sign in with their email address.", Status: "confirmed" }],
  RequirementExtra: [{ ItemId: "x1", ProjectId: P, Kind: "workflow", Title: "List an asset", Status: "active", Origin: "person" }],
  Feature: [{ ItemId: "f1", ProjectId: P, Key: "checkout", Title: "Checkout", ScopeVersion: 1 }],
  Story: [{ ItemId: "s1", ProjectId: P, Key: "pay", Title: "", Text: "As a buyer I pay by card", ScopeVersion: 1, FeatureRef: "feature:checkout" }],
  Milestone: [{ ItemId: "m1", ProjectId: P, Name: "First sales", ScopeVersion: 1, Number: 1 }],
  DesignBrief: [{ ItemId: "b1", ProjectId: P, Mode: "describe", Instructions: "Calm, lots of white space", Status: "confirmed", ConfirmedAt: T("08:00") }],
  DesignScreen: [
    { ItemId: "sc0", ProjectId: P, DesignBriefId: "b1", Key: "checkout", Name: "Checkout page", Version: 1, SortOrder: 1, Status: "superseded" },
    { ItemId: "sc1", ProjectId: P, DesignBriefId: "b1", Key: "checkout", Name: "Checkout page", Version: 2, SortOrder: 1, Status: "generated" },
  ],
  FeedbackThread: [
    thread("t-req", "requirement", "r1", "updated"),
    thread("t-screen", "screen", "sc1", "open"),
    thread("t-success", "success", "responseTime", "working"),
    thread("t-feat", "feature", "f1", "resolved", { UpdatedByUserId: "u1", LastUpdatedDate: T("09:11") }),
    thread("t-extra", "extra", "x1", "open"),
    thread("t-empty", "milestone", "m1", "open"),
    thread("t-gone", "story", "s-removed", "open"),
  ],
  FeedbackComment: [
    comment("c1", "t-req", T("10:00"), { Text: "Please also allow Google sign-in", AttachmentIds: ["a1"] }),
    comment("c2", "t-req", T("10:02"), team({ Kind: "proposal", Text: "New title: Sign in with email or Google\nNew text: People sign in with their email address or their Google account." })),
    comment("c3", "t-screen", T("11:00"), { Text: "The pay button is hard to find" }),
    comment("c4", "t-success", T("10:30"), { Text: "Under 1 second please" }),
    comment("c5", "t-feat", T("09:00"), { Text: "Add Twint" }),
    comment("c6", "t-feat", T("09:05"), team({ Kind: "agent", Text: "Twint is now one of the payment options." })),
    comment("c7", "t-feat", T("09:10"), { Kind: "system", Text: "Applied the suggested change." }),
    // an example row: shown in the context, never a person's action
    comment("c8", "t-extra", T("08:00"), { Text: "Sellers upload several files at once", SeedKey: "seed:fb-1" }),
    comment("c9", "t-gone", T("07:00"), { Text: "Is this still needed?" }),
  ],
  Attachment: [
    { ItemId: "a1", ProjectId: P, FileName: "google-button.png", Mime: "image/png", Status: "ready", OwnerType: "feedback-comment", OwnerId: "c1", CreatedByUserId: "u1", CreatedDate: T("09:59") },
  ],
};
const p = new ProjectView(storeOf(tables), P);
const ctxOf = (sections: Sections) => memoryContext({ workspaceId: "w1", projectId: P, sections, digestOf: () => "", now: new Date(T("12:00")) });

describe("feedback in the project context", () => {
  const s = buildSections({ p, kbDir: null, projectDir: null });
  const fb = s.feedback!;

  it("lists the threads with entries, waiting for the team first, the resolved ones last", () => {
    expect(fb.threads.map((t) => t.ref)).toEqual([
      "FeedbackThread:t-screen", "FeedbackThread:t-extra", "FeedbackThread:t-gone", "FeedbackThread:t-success", "FeedbackThread:t-req",
    ]);
    expect(fb.resolved.map((t) => t.ref)).toEqual(["FeedbackThread:t-feat"]);
    expect(fb.resolvedTotal).toBe(1);
  });

  it("names the item each thread is about in plain words", () => {
    const by = new Map([...fb.threads, ...fb.resolved].map((t) => [t.ref.split(":")[1], t]));
    expect(by.get("t-req")).toMatchObject({ label: "Requirement R3", item: "Sign in with email", target: "Requirement:r1", team: "The product manager" });
    expect(by.get("t-screen")).toMatchObject({ label: "Screen", item: "Checkout page", target: "DesignScreen:sc1", team: "The designer" });
    expect(by.get("t-success")).toMatchObject({ label: "Success & performance", item: "Response time", target: "" });
    expect(by.get("t-feat")).toMatchObject({ label: "Feature", item: "Checkout", target: "Feature:f1", team: "The planner" });
    expect(by.get("t-extra")).toMatchObject({ label: "Key workflow", item: "List an asset", target: "RequirementExtra:x1" });
    expect(by.get("t-gone")).toMatchObject({ label: "User story", item: "", target: "Story:s-removed" });
  });

  it("keeps each thread's entries in order: who, kind, text, the attached files", () => {
    const req = fb.threads.find((t) => t.ref === "FeedbackThread:t-req")!;
    expect(req.status).toBe("updated");
    expect(req.proposalWaiting).toBe(true);
    expect(req.entries).toEqual([
      { ref: "FeedbackComment:c1", by: "u1", who: "Lea Meier", kind: "comment", text: "Please also allow Google sign-in", at: T("10:00"), files: ["google-button.png"] },
      { ref: "FeedbackComment:c2", by: "", who: "the team", kind: "proposal", text: "New title: Sign in with email or Google\nNew text: People sign in with their email address or their Google account.", at: T("10:02"), files: [] },
    ]);
    expect(req).toMatchObject({ total: 2, earlier: 0, lastAt: T("10:02") });
    const feat = fb.resolved[0]!;
    expect(feat).toMatchObject({ status: "resolved", decision: "Applied the suggested change.", proposalWaiting: false });
    expect(feat.entries.map((e) => [e.who, e.kind])).toEqual([["Lea Meier", "comment"], ["the team", "agent"], ["Lea Meier", "system"]]);
  });

  it("leaves the section out while nobody has commented", () => {
    const bare = new ProjectView(storeOf({ ...tables, FeedbackComment: [] }), P);
    const s0 = buildSections({ p: bare, kbDir: null, projectDir: null });
    expect("feedback" in s0).toBe(false);
    expect(contextDigest(ctxOf(s0), { blocks: ["feedback", "openFeedback"], budget: 4000 }).refs).toEqual([]);
  });

  it("lists the current screens and the look and feel", () => {
    expect(s.design?.brief).toMatchObject({ ref: "DesignBrief:b1", status: "confirmed" });
    expect(s.design?.screens.map((x) => [x.ref, x.name, x.version])).toEqual([["DesignScreen:sc1", "Checkout page", 2]]);
  });
});

describe("feedback in the digest", () => {
  const ctx = ctxOf(buildSections({ p, kbDir: null, projectDir: null }));

  it("shows the comments, the status and the team's answers", () => {
    const d = contextDigest(ctx, { blocks: ["feedback"], budget: 6000 });
    expect(d.text).toContain("Comments on the work");
    expect(d.text).toContain("Threads: 3 open (waiting for the team), 1 working (the team is on it), 1 updated (answered, waiting for the person), 1 resolved (closed)");
    expect(d.text).toContain('Screen "Checkout page" [open]: Lea Meier: The pay button is hard to find');
    expect(d.text).toContain(`Requirement R3 "Sign in with email" [updated; a suggested change waits for the person's decision]: Lea Meier: Please also allow Google sign-in [files: google-button.png] | the team (suggested change): New title: Sign in with email or Google New text:`);
    expect(d.text).toContain('Feature "Checkout" [resolved: Applied the suggested change.]: Lea Meier: Add Twint');
    expect(d.text).toContain("User story (no longer there) [open]");
    expect(d.refs).toEqual(expect.arrayContaining(["FeedbackThread:t-req", "FeedbackThread:t-feat"]));
  });

  it("has a short form with the threads not resolved yet", () => {
    const d = contextDigest(ctx, { blocks: ["openFeedback"], budget: 4000 });
    expect(d.text).toContain('Success & performance "Response time" [working]: Lea Meier: Under 1 second please');
    expect(d.text).not.toContain("Twint");
    expect(d.refs).not.toContain("FeedbackThread:t-feat");
  });

  it("is part of the whole digest and of the jobs that need it", () => {
    expect(wholeDigest(ctx)).toContain("The pay button is hard to find");
    expect(wholeDigest(ctx)).toContain('Screen "Checkout page" v2');
    expect(wholeDigest(ctx)).not.toContain("Comments not resolved yet");
    expect(KIND_BLOCKS["feedback.apply"]).toEqual(expect.arrayContaining(["feedback", "requirements", "scope", "milestones", "design"]));
    for (const kind of ["chat.reply", "scope.draft", "design.generate", "change.analyse", "requirements.draft"]) expect(KIND_BLOCKS[kind]).toContain("feedback");
    for (const kind of ["board.plan", "build.run", "change.build"]) expect(KIND_BLOCKS[kind]).toContain("openFeedback");
  });
});

describe("feedback in the ledger", () => {
  it("derives people's comments and closes and the team's answers, oldest first", () => {
    const acts = userActionsOf(p, null).filter((a) => a.action.startsWith("feedback."));
    expect(acts.map((a) => [a.action, a.ref, a.type ?? "user"])).toEqual([
      ["feedback.commented", "FeedbackComment:c9", "user"],
      ["feedback.commented", "FeedbackComment:c5", "user"],
      ["feedback.replied", "FeedbackComment:c6", "feedback"],
      ["feedback.resolved", "FeedbackThread:t-feat", "user"],
      ["feedback.commented", "FeedbackComment:c1", "user"],
      ["feedback.proposed", "FeedbackComment:c2", "feedback"],
      ["feedback.commented", "FeedbackComment:c4", "user"],
      ["feedback.commented", "FeedbackComment:c3", "user"],
    ]);
    expect(acts.find((a) => a.ref === "FeedbackComment:c1")).toEqual({
      key: "feedback.commented:c1", action: "feedback.commented", ref: "FeedbackComment:c1", by: "u1", at: T("10:00"),
      detail: { thread: "FeedbackThread:t-req", targetType: "requirement", target: "Requirement:r1", label: "Requirement R3", item: "Sign in with email", text: "Please also allow Google sign-in", files: ["google-button.png"] },
    });
    expect(acts.find((a) => a.action === "feedback.resolved")).toMatchObject({
      key: `feedback.resolved:t-feat:${T("09:10")}`, by: "u1", at: T("09:10"), detail: { decision: "applied", decisionText: "Applied the suggested change.", item: "Checkout" },
    });
    expect(acts.find((a) => a.action === "feedback.proposed")?.detail).toMatchObject({ jobId: "j9", targetType: "requirement" });
    expect(feedbackActionsOf(p).some((a) => a.ref === "FeedbackComment:c8")).toBe(false);
  });

  it("records each one once, the team's answers as feedback events", () => {
    const acts = feedbackActionsOf(p);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-feedback-"));
    made.push(dir);
    expect(recordUserActions(dir, acts, { contextVersion: 5, nameOf: (id) => (id === "u1" ? "Lea Meier" : "") })).toBe(8);
    expect(recordUserActions(dir, userActionsOf(p, null).filter((a) => a.action.startsWith("feedback.")), { contextVersion: 6 })).toBe(0);
    const ledger = readLedger(dir);
    expect(ledger.find((e) => e.key === "feedback.commented:c3")).toMatchObject({ type: "user", action: "feedback.commented", by: "u1", byName: "Lea Meier", text: "The pay button is hard to find", contextVersion: 5 });
    expect(ledger.find((e) => e.key === "feedback.replied:c6")).toMatchObject({ type: "feedback", action: "feedback.replied", by: "", thread: "FeedbackThread:t-feat", jobId: "j9" });
  });

  it("a reopened and closed again thread is a new close; the worker's periodic refresh reads the threads", () => {
    const later = new ProjectView(storeOf({
      ...tables,
      FeedbackComment: [
        ...tables.FeedbackComment!,
        comment("c10", "t-feat", T("11:30"), { Kind: "system", Text: "Reopened." }),
        comment("c11", "t-feat", T("11:31"), { Text: "One more thing: show the Twint logo" }),
        comment("c12", "t-feat", T("11:40"), { Kind: "system", Text: "Accepted and closed." }),
      ],
    }), P);
    const closes = feedbackActionsOf(later).filter((a) => a.action === "feedback.resolved");
    expect(closes.map((a) => a.key)).toEqual([`feedback.resolved:t-feat:${T("11:40")}`]);
    expect(closes[0]!.detail).toMatchObject({ decisionText: "Accepted and closed." });
    expect(closes[0]!.detail).not.toHaveProperty("decision");
    expect(USER_SCHEMAS).toEqual(expect.arrayContaining(["FeedbackThread", "FeedbackComment"]));
  });
});

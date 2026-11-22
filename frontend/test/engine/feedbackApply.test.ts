// feedback.apply on the seeded store: a person's comment becomes the team's work. A screen gets a new version (the
// thread follows it), a requirement gets a suggested new wording, a comment after the scope lock becomes a change
// request with the comment's files, a question discussion gets an answer. With Claude (a stub runner) and without
// (the built-in text), every reply is plain and the thread ends "updated".
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { openProposal, orderComments, parseProposal } from "../../src/domain/feedback";
import { toComment, toThread } from "../../src/blocks/collab/records";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { acceptRedesign, builtInChange, redesignPrompt } from "../../server/local/engine/kinds/feedback/screen.ts";
import type { DesignInput } from "../../server/local/engine/kinds/scope/screens.ts";
import { builtInProposal, changeTitle, unanswered } from "../../server/local/engine/kinds/feedback.ts";
import { makeWorld, type World } from "./harness";

const FORBIDDEN = /\b(simulat\w*|mock\w*|demo\w*|sample\w*|fake\w*|prototype\w*|test data|lorem|placeholder|undefined|NaN)\b/i;
const SCOPE = "B2B Order Portal"; // scope step, draft scope, screens
const REQS = "Payroll Self-Service"; // requirements step
const LIVE = "Service Technician Portal"; // locked scope, released to dev
const LOCKED = "Driver Delivery App"; // locked scope, not released yet
const ASKING = "Client Document Portal"; // the questions step

let w: World;
let seq = 0;

const stamp = (p: Row, by: string) => ({ WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by });

/** A person's comment the way the feedback ops write it (thread on first comment), and its job queued. */
async function comment(project: string, targetType: string, targetId: string, text: string, o: { attach?: boolean; queue?: boolean } = {}) {
  const p = w.project(project);
  const by = String(p.AssigneeUserId || p.CreatedByUserId);
  seq += 1;
  let thread = w.rows("FeedbackThread", String(p.ItemId)).find((t) => t.TargetType === targetType && t.TargetId === targetId);
  if (!thread) {
    const t = await w.gw.insert("FeedbackThread", { ProjectId: p.ItemId, TargetType: targetType, TargetId: targetId, Status: "open", ...stamp(p, by), RequestKey: capKey(`test:thread:${seq}`) });
    thread = w.get("FeedbackThread", t.itemId!);
  } else if (thread.Status !== "working") {
    await w.gw.update("FeedbackThread", String(thread.ItemId), { Status: "open" });
  }
  const threadId = String(thread.ItemId);
  const c = await w.gw.insert("FeedbackComment", {
    ProjectId: p.ItemId, ThreadId: threadId, AuthorUserId: by, Kind: "comment", Text: text, AttachmentIds: [], At: w.now().toISOString(),
    ...stamp(p, by), RequestKey: capKey(`test:comment:${seq}`),
  });
  const commentId = c.itemId!;
  if (o.attach) {
    const a = await w.gw.insert("Attachment", {
      ProjectId: p.ItemId, OwnerType: "feedback-comment", OwnerId: commentId, FileId: `file-${seq}`, FileName: "hero-idea.png", StoredName: "hero-idea.png",
      Kind: "image", Mime: "image/png", SizeBytes: 1200, Origin: "upload", Status: "ready", ...stamp(p, by), RequestKey: capKey(`test:att:${seq}`),
    });
    await w.gw.update("FeedbackComment", commentId, { AttachmentIds: [a.itemId!] });
  }
  const jobId = o.queue === false ? "" : await w.queue({ project, kind: "feedback.apply", input: { projectId: p.ItemId, threadId, commentId }, target: { type: "feedback-thread", id: threadId }, by, key: `fb-${seq}` });
  return { p, threadId, commentId, jobId, by };
}

const threadComments = (threadId: string) =>
  orderComments(w.store.rows("FeedbackComment").filter((c) => c.ThreadId === threadId).map((c) => toComment(c)!).filter(Boolean));

beforeAll(async () => {
  w = await makeWorld();
});
afterAll(() => w?.close());
afterEach(() => setAiRunner(null));

describe("feedback.apply without Claude (built-in text)", () => {
  it("redesigns the commented screen as a new version of both devices; the thread follows it and waits for the person", async () => {
    const pid = String(w.project(SCOPE).ItemId);
    const target = w.rows("DesignScreen", pid).find((s) => s.Status !== "superseded")!;
    const sameName = w.rows("DesignScreen", pid).filter((s) => s.Name === target.Name && s.Status !== "superseded");
    const { threadId, jobId } = await comment(SCOPE, "screen", String(target.ItemId), "Wide header banner across the whole page, with a soft scroll effect.");
    await w.settle();
    const job = w.get("EngineJob", jobId);
    expect(job.Status).toBe("succeeded");
    const thread = toThread(w.get("FeedbackThread", threadId))!;
    expect(thread.status).toBe("updated");
    // the new version of the commented row, the old one kept as superseded
    const now = w.get("DesignScreen", thread.targetId);
    expect(now.Key).toBe(target.Key);
    expect(Number(now.Version)).toBe(Number(target.Version) + 1);
    expect(now.EngineJobId).toBe(jobId);
    expect(w.get("DesignScreen", String(target.ItemId)).Status).toBe("superseded");
    // every device of that screen, and no other screen
    for (const s of sameName) expect(w.rows("DesignScreen", pid).some((r) => r.Key === s.Key && Number(r.Version) === Number(s.Version) + 1)).toBe(true);
    const others = w.rows("DesignScreen", pid).filter((r) => r.Name !== target.Name);
    expect(others.every((r) => r.EngineJobId !== jobId)).toBe(true);
    // the replies: at once (what it will do), then what changed
    const list = threadComments(threadId);
    expect(list.map((c) => c.kind)).toEqual(["comment", "agent", "agent"]);
    expect(list[1]!.authorUserId).toBe("");
    expect(list[1]!.text).toMatch(/redesigning/i);
    expect(list[2]!.text).toMatch(new RegExp(`version ${Number(now.Version)}`));
    expect(list[2]!.text).toMatch(/full-width banner/);
    for (const c of list.slice(1)) expect(c.text).not.toMatch(FORBIDDEN);
    expect(job.OutputRefs).toEqual(expect.arrayContaining([`DesignScreen:${thread.targetId}`, `FeedbackThread:${threadId}`]));
  });

  it("suggests new wording for a requirement; the suggestion is the thread's last entry, waiting for Apply or Keep", async () => {
    const pid = String(w.project(REQS).ItemId);
    const req = w.rows("Requirement", pid).find((r) => r.Status !== "dropped")!;
    const { threadId, jobId } = await comment(REQS, "requirement", String(req.ItemId), "Employees must also be able to download last year's payslips.");
    await w.settle();
    expect(w.get("EngineJob", jobId).Status).toBe("succeeded");
    const list = threadComments(threadId);
    expect(list.map((c) => c.kind)).toEqual(["comment", "agent", "proposal"]);
    const thread = toThread(w.get("FeedbackThread", threadId))!;
    expect(thread.status).toBe("updated");
    expect(openProposal(thread.status, list)?.id).toBe(list[2]!.id);
    const proposal = parseProposal(list[2]!.text)!;
    expect(proposal.title).toBe(req.Title);
    expect(proposal.text).toContain(String(req.Text).trim().slice(0, 30));
    expect(proposal.text).toMatch(/last year's payslips/);
    // nothing was changed on the requirement itself: "Apply change" does that through requirement.save
    expect(w.get("Requirement", String(req.ItemId)).Text).toBe(req.Text);
  });

  it("after the scope lock, a comment becomes a change request with the comment and its files, sent to the analysis", async () => {
    const pid = String(w.project(LIVE).ItemId);
    const feature = w.rows("Feature", pid).find((f) => f.Status !== "dropped")!;
    const { threadId, jobId, by } = await comment(LIVE, "feature", String(feature.ItemId), "Technicians need to add a signature from the customer at the end of the job.", { attach: true });
    await w.settle();
    expect(w.get("EngineJob", jobId).Status).toBe("succeeded");
    const cr = w.rows("ChangeRequest", pid).find((c) => c.EngineJobId === jobId)!;
    expect(cr).toBeTruthy();
    expect(cr.Description).toMatch(/signature from the customer/);
    expect(cr.Description).toMatch(new RegExp(String(feature.Title)));
    expect(cr.FeatureRef).toBe(`feature:${feature.Key}`);
    expect(cr.Lane).toBe("change");
    expect(cr.RequestedByUserId).toBe(by);
    expect(cr.Title).toBe(changeTitle({ name: String(feature.Title) } as never, "Technicians need to add a signature from the customer at the end of the job."));
    // the change process: analysed (released to dev), the file copied to the change request
    expect(w.rows("EngineJob", pid).some((j) => j.Kind === "change.analyse" && j.TargetId === cr.ItemId)).toBe(true);
    expect(cr.Status).not.toBe("draft");
    const files = w.rows("Attachment", pid).filter((a) => a.OwnerType === "change-request" && a.OwnerId === cr.ItemId);
    expect(files.map((a) => a.FileName)).toEqual(["hero-idea.png"]);
    const list = threadComments(threadId);
    expect(list.map((c) => c.kind)).toEqual(["comment", "agent", "agent"]);
    expect(list[2]!.text).toMatch(new RegExp(`change request #${cr.Number}\\b`));
    expect(list[2]!.text).toMatch(/files you attached/);
    expect(toThread(w.get("FeedbackThread", threadId))!.status).toBe("updated");
  });

  it("before the first release the change request stays a draft and the reply says when it is analysed", async () => {
    const pid = String(w.project(LOCKED).ItemId);
    const screen = w.rows("DesignScreen", pid).find((s) => s.Status !== "superseded")!;
    const { threadId } = await comment(LOCKED, "screen", String(screen.ItemId), "Make the delivery list easier to read in sunlight.");
    await w.settle();
    const cr = w.rows("ChangeRequest", pid).at(-1)!;
    expect(cr.Status).toBe("draft");
    expect(String(cr.FeatureRef)).toMatch(/^feature:/);
    expect(threadComments(threadId).at(-1)!.text).toMatch(/once the first version is live on dev/);
    // the screen stays as it is: the build follows the locked scope
    expect(w.get("DesignScreen", String(screen.ItemId)).Status).toBe(screen.Status);
  });

  it("answers a comment in the question discussion", async () => {
    const pid = String(w.project(ASKING).ItemId);
    const { threadId, jobId } = await comment(ASKING, "sanitization", pid, "Our tax advisors work with PDF only, never Word files.");
    await w.settle();
    expect(w.get("EngineJob", jobId).Status).toBe("succeeded");
    // the comments nobody answered yet (the seeded ones too) are answered together, after the latest
    const list = threadComments(threadId);
    expect(list.slice(-2).map((c) => c.kind)).toEqual(["comment", "agent"]);
    expect(list.filter((c) => c.kind === "agent")).toHaveLength(1);
    expect(list.at(-1)!.text).toMatch(/PDF only/);
  });
});

describe("feedback.apply with Claude (a stub runner)", () => {
  it("uses Claude's wording for the suggestion and shows Claude the attached picture", async () => {
    const seen: AiRequest[] = [];
    setAiRunner(async (req) => {
      seen.push(req);
      if (/rewrite this/i.test(req.prompt)) return { title: "", text: "Employees see and download their payslips of the last 24 months as PDF." };
      return { reply: "Noted." };
    });
    const pid = String(w.project(REQS).ItemId);
    const req = w.rows("Requirement", pid).filter((r) => r.Status !== "dropped")[1]!;
    const { threadId } = await comment(REQS, "requirement", String(req.ItemId), "Two years of payslips, as PDF.", { attach: true });
    await w.settle();
    const list = threadComments(threadId);
    expect(parseProposal(list.at(-1)!.text)).toEqual({ title: String(req.Title), text: "Employees see and download their payslips of the last 24 months as PDF." });
    const ask = seen.find((r) => /rewrite this/i.test(r.prompt))!;
    expect(ask.prompt).toContain("Two years of payslips, as PDF.");
    expect(ask.prompt).toContain("hero-idea.png");
  });

  it("redesigns the screen from Claude's design, seeing the current screenshot; a comment written meanwhile is the next round", async () => {
    const pid = String(w.project(SCOPE).ItemId);
    const target = w.rows("DesignScreen", pid).filter((s) => s.Status !== "superseded").find((s) => !w.rows("FeedbackThread", pid).some((t) => t.TargetId === s.ItemId))!;
    let first: { threadId: string; by: string } | null = null;
    let calls = 0;
    setAiRunner(async (req) => {
      if (!/Redesign the/.test(req.prompt)) return null;
      calls += 1;
      if (calls === 1 && first) {
        // the person adds a comment while the designer works
        await comment(SCOPE, "screen", String(w.get("FeedbackThread", first.threadId).TargetId), "And a bigger button, please.", { queue: false });
      }
      expect(req.images?.some((i) => /as it is now/.test(i.label ?? ""))).toBe(true);
      return {
        summary: "The screen now opens with a large full-width banner and a clear button.",
        appName: "", brandColour: "",
        screens: [{
          name: target.Name, feature: "", device: "desktop", navLabel: "Home", subtitle: "", signedIn: "", search: "",
          blocks: [
            { kind: "hero", title: "Order in two clicks", text: "Your price list, your stock, always current.", value: "", items: [], columns: [], rows: [] },
            { kind: "stats", title: "", text: "", value: "", items: [{ label: "Open orders", value: "12", detail: "" }, { label: "This month", value: "48", detail: "" }], columns: [], rows: [] },
            { kind: "note", title: "", text: "Prices include your agreed discount.", value: "", items: [], columns: [], rows: [] },
            { kind: "button", title: "Start an order", text: "", value: "", items: [], columns: [], rows: [] },
          ],
        }],
      };
    });
    first = await comment(SCOPE, "screen", String(target.ItemId), "Make the top of the screen a big banner.");
    await w.settle();
    const list = threadComments(first.threadId);
    // round 1: ack + done; round 2 (the comment written meanwhile): ack + done
    expect(list.filter((c) => c.kind === "comment")).toHaveLength(2);
    expect(list.filter((c) => c.kind === "agent")).toHaveLength(4);
    expect(calls).toBe(2);
    expect(list.at(-1)!.kind).toBe("agent");
    expect(list.at(-1)!.text).toMatch(/large full-width banner/);
    const thread = toThread(w.get("FeedbackThread", first.threadId))!;
    expect(thread.status).toBe("updated");
    expect(Number(w.get("DesignScreen", thread.targetId).Version)).toBeGreaterThanOrEqual(Number(target.Version) + 2);
  });
});

describe("feedback.apply's pure parts", () => {
  it("the built-in change puts a full-width banner first and says what the build adds", () => {
    const r = builtInChange([{ k: "heading", text: "Offers" }, { k: "note", text: "x" }], "Wide header banner with a scroll effect", "Landing Hero");
    expect(r.blocks[0]).toMatchObject({ k: "hero", title: "Landing Hero" });
    expect(r.summary).toMatch(/moving effect is part of the build/);
  });

  it("accepts only the commented screen from Claude's redesign", () => {
    const raw = { summary: "Bigger banner.", screens: [{ name: "Landing Hero", device: "desktop", blocks: [{ kind: "hero", title: "Hi there" }, { kind: "stats", items: [{ label: "Orders", value: "12" }, { label: "Open", value: "3" }] }, { kind: "button", title: "Go" }] }] };
    expect(acceptRedesign(raw, { name: "Landing Hero", features: [] })?.design.screens.map((s) => s.name)).toEqual(["Landing Hero"]);
    expect(acceptRedesign(raw, { name: "Checkout", features: [] })).toBeNull();
  });

  it("shows Claude the screen in the fields it answers with; a header colour and the button words come back", () => {
    const current = {
      name: "Home", featureRef: "", device: "desktop" as const, navLabel: "Home", subtitle: "", person: "", search: "",
      blocks: [
        { k: "hero" as const, title: "Welcome to Café Lindenhof", text: "Seasonal lunch and coffee in the old town." },
        { k: "button" as const, text: "See the menu" },
        { k: "button" as const, text: "Send us a message", secondary: true },
      ],
    };
    const x = { projectName: "Café Lindenhof", instructions: "", currency: "CHF" } as unknown as DesignInput;
    const prompt = redesignPrompt({ x, name: "Home", current, thread: "", comment: "Make the header dark blue and add a big 'Book a table' button.", files: "", material: "" });
    expect(prompt).toContain('{"kind":"button","title":"See the menu"}');
    expect(prompt).toContain('{"kind":"button","title":"Send us a message","value":"secondary"}');
    expect(prompt).not.toContain('"k":"button"');
    expect(prompt).toMatch(/- hero: .*value = the banner's own colour as a hex code/);
    expect(prompt).toMatch(/only the hero banner has a colour of its own/);
    // the answer seen live: the words in text, a style word in value
    const raw = {
      summary: "The top banner is now dark blue with a big 'Book a table' button.",
      screens: [{
        name: "Home", device: "desktop",
        blocks: [
          { kind: "hero", title: "Welcome to Café Lindenhof", text: "Seasonal lunch and coffee in the old town.", value: "#0B2A5B" },
          { kind: "button", title: "", text: "Book a table", value: "primary" },
          { kind: "button", title: "", text: "See the menu", value: "secondary" },
          { kind: "button", title: "", text: "Send us a message", value: "secondary" },
          { kind: "stats", items: [{ label: "Tables free tonight", value: "6" }, { label: "Rating", value: "4.7" }] },
        ],
      }],
    };
    const blocks = acceptRedesign(raw, { name: "Home", features: [] })!.design.screens[0]!.blocks;
    expect(blocks[0]).toEqual({ k: "hero", title: "Welcome to Café Lindenhof", text: "Seasonal lunch and coffee in the old town.", colour: "0b2a5b" });
    expect(blocks.filter((b) => b.k === "button")).toEqual([
      { k: "button", text: "Book a table" },
      { k: "button", text: "See the menu", secondary: true },
      { k: "button", text: "Send us a message", secondary: true },
    ]);
    // the next redesign sees the colour it now has
    expect(redesignPrompt({ x, name: "Home", current: { ...current, blocks }, thread: "", comment: "Bigger title.", files: "", material: "" })).toContain('"value":"#0b2a5b"');
  });

  it("a comment written while the job worked is answered in its next round", () => {
    const rows = [
      { ItemId: "c1", Kind: "comment", Text: "Bigger banner" },
      { ItemId: "a1", Kind: "agent", Text: "On it" },
      { ItemId: "c2", Kind: "comment", Text: "And a button" },
      { ItemId: "a2", Kind: "agent", Text: "Done" },
    ];
    expect(unanswered(rows)).toEqual([]);
    expect(unanswered(rows, new Set(["c1"]), new Set(["a1", "a2"])).map((c) => c.ItemId)).toEqual(["c2"]);
    expect(unanswered([...rows, { ItemId: "c3", Kind: "comment", Text: "One more" }]).map((c) => c.ItemId)).toEqual(["c3"]);
  });

  it("the built-in suggestion keeps the wording and adds the comment's ask", () => {
    const p = builtInProposal({ type: "requirement", title: "Payslips", text: "Employees see their payslips" } as never, "also last year's ones");
    expect(p).toEqual({ title: "Payslips", text: "Employees see their payslips. Also last year's ones." });
  });
});

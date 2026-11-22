// The collaboration writers on the seeded store: agent chat and assistant replies, the bug analysis behind "Start the
// fix", and the wiki (first generation and an update that keeps what is there). Every row is read back with the app's
// own readers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { CHAT_ROLES, type ChatRole } from "../../src/domain/agentChat";
import { fixDraftFrom, parseAnalysis } from "../../src/domain/assistant";
import { checkChangeDraft } from "../../src/domain/delivery";
import { SLUG_PATTERN, isWikiGroup, parseSources } from "../../src/domain/wiki";
import { toAgentChat, toAssistantMessage, toWikiPage } from "../../src/blocks/collab/records";
import { ProjectView } from "../../server/local/engine/context.ts";
import { agentReply, assistantReply, questionKind } from "../../server/local/engine/kinds/collab/chat.ts";
import { loadFacts } from "../../server/local/engine/kinds/collab/facts.ts";
import { analyseBug } from "../../server/local/engine/kinds/collab/fix.ts";
import { planWiki } from "../../server/local/engine/kinds/collab/wiki.ts";
import { makeWorld, type World } from "./harness";

const FORBIDDEN = /\b(simulat\w*|mock\w*|demo\w*|sample\w*|example\w*|fake\w*|prototype\w*|test data|lorem|placeholder)\b/i;
const DRIVER = "Driver Delivery App";
const SERVICE = "Service Technician Portal";

let w: World;
let seq = 0;

async function userMessage(schema: "AgentChatMessage" | "AssistantMessage", project: Row, fields: Row): Promise<string> {
  seq += 1;
  const by = String(project.AssigneeUserId);
  const base =
    schema === "AssistantMessage"
      ? { Role: "user", Kind: "text", Points: [], RefsJson: "[]", AttachmentsJson: "[]", AnalysisJson: "", FixState: "none" }
      : { Role: "user", Kind: "text", AuthorUserId: by };
  const res = await w.gw.insert(schema, {
    ProjectId: project.ItemId,
    ...base,
    ...fields,
    At: w.now().toISOString(),
    WorkspaceId: project.WorkspaceId,
    ReaderIds: project.ReaderIds,
    CreatedByUserId: by,
    UpdatedByUserId: by,
    RequestKey: `test:msg:${seq}`,
  });
  return res.itemId!;
}

/** Queues a reply job the way the ops do: a provisional target and an empty message id, then linked both ways. */
async function ask(o: { project: string; schema: "AgentChatMessage" | "AssistantMessage"; fields: Row; kind: "chat.reply" | "fix.analyse"; input: (msgId: string) => Row; link?: boolean }) {
  const p = w.project(o.project);
  const msgId = await userMessage(o.schema, p, o.fields);
  const jobId = await w.queue({ project: o.project, kind: o.kind, input: o.input(o.link === false ? "" : msgId), target: { type: o.schema === "AgentChatMessage" ? "agent-chat" : "assistant-message", id: msgId }, key: `ask-${msgId}` });
  await w.gw.update(o.schema, msgId, { EngineJobId: jobId });
  await w.settle();
  return { p, msgId, jobId, job: w.get("EngineJob", jobId) };
}

beforeAll(async () => {
  w = await makeWorld();
});
afterAll(() => w?.close());

describe("agent chat replies", () => {
  it("answers an open question in the thread, after the question, linked to the job", async () => {
    const { p, msgId, jobId, job } = await ask({
      project: DRIVER,
      schema: "AgentChatMessage",
      fields: { AgentRole: "qa", Text: "What happens when nobody is there to sign for the delivery?" },
      kind: "chat.reply",
      input: (id) => ({ projectId: w.project(DRIVER).ItemId, thread: "agent", threadId: "qa", messageId: id }),
      link: false,
    });
    expect(job.Status).toBe("succeeded");
    expect(job.Message).toBe("Answered.");
    const replies = w.rows("AgentChatMessage", String(p.ItemId)).filter((m) => m.EngineJobId === jobId && m.Role === "agent");
    expect(replies).toHaveLength(1);
    const r = toAgentChat(replies[0]);
    expect(r).not.toBeNull();
    expect(r!.agentRole).toBe("qa");
    expect(r!.kind).toBe("text");
    expect(Date.parse(r!.at)).toBeGreaterThan(Date.parse(String(w.get("AgentChatMessage", msgId).At)));
    expect(r!.text.length).toBeGreaterThan(40);
    expect(r!.text.length).toBeLessThanOrEqual(2000);
    expect(r!.text.toLowerCase()).toMatch(/photo/);
    expect(job.OutputRefs).toEqual([`AgentChat:${replies[0]!.ItemId}`]);
    expect(r!.text).not.toMatch(FORBIDDEN);
  });

  it("answers every role and kind of open question from the project's records, deterministically", () => {
    const facts = loadFacts(new ProjectView(w.store, String(w.project(DRIVER).ItemId)));
    const questions = [
      "Why did we choose a web app instead of a native app?",
      "How long until the proof of delivery milestone?",
      "How does the temperature check work for chilled goods?",
      "Is the delivery data secure?",
      "Do you think we should drop the dispatch overview?",
      "Who owns this project?",
      "Which file handles the photo upload?",
      "Could the drivers use their own phones?",
      "Tell me something about #3",
    ];
    for (const role of CHAT_ROLES as readonly ChatRole[]) {
      for (const q of questions) {
        const ctx = { events: w.rows("TicketEvent", String(w.project(DRIVER).ItemId)), people: { assignee: "Lea Brunner", creator: "Sandra Keller" }, key: "job-1" };
        const a = agentReply(facts, role, q, ctx);
        expect(a).toBe(agentReply(facts, role, q, ctx));
        expect(a.length).toBeGreaterThan(20);
        expect(a.length).toBeLessThanOrEqual(2000);
        expect(a).not.toMatch(FORBIDDEN);
        expect(a).not.toMatch(/undefined|NaN|\[object/);
        const sentences = a.split(/(?<=[.!?”])\s+(?=[A-Z#“])/).length;
        expect(sentences).toBeLessThanOrEqual(7);
      }
    }
    expect(questionKind("Why is it built like that?")).toBe("why");
    expect(questionKind("How long will it take?")).toBe("time");
  });
});

describe("chat actions in the ledger", () => {
  it("records what an agent offered and the action the person took, once each, linked to what it made", async () => {
    const p = w.project(DRIVER);
    const by = String(p.AssigneeUserId);
    const base = { ProjectId: p.ItemId, WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, AgentRole: "planner", Role: "agent", AuthorUserId: "", EngineJobId: "job-offer-1" };
    const offer = await w.gw.insert("AgentChatMessage", {
      ...base, Kind: "text", Text: "Make the hero full width.", TaskTarget: "offer:change-request", TaskId: "cr-9", TaskCode: "CR-009", TaskTitle: "Full-width hero",
      TaskLane: "", TaskFeatureRef: "", At: "2026-10-31T10:00:00.000Z", CreatedByUserId: "", UpdatedByUserId: "", RequestKey: "test:offer:1",
    });
    await w.gw.insert("AgentChatMessage", {
      ...base, Kind: "task-created", Text: "CR-009 is saved and sent for analysis: Full-width hero.", TaskTarget: "change-request", TaskId: "cr-9", TaskCode: "CR-009",
      TaskTitle: "Full-width hero", TaskLane: "", TaskFeatureRef: "", At: "2026-10-31T10:01:00.000Z", CreatedByUserId: by, UpdatedByUserId: by, RequestKey: "test:offer:2",
    });
    const { userActionsOf } = await import("../../server/engine-context/userEvents.ts");
    const events = userActionsOf(new ProjectView(w.store, String(p.ItemId)));
    const offered = events.filter((e) => e.action === "chat.action-offered");
    const taken = events.filter((e) => e.action === "chat.action-taken");
    expect(offered).toEqual([expect.objectContaining({ type: "chat", ref: `AgentChatMessage:${offer.itemId}`, by: "", detail: expect.objectContaining({ offer: "change-request", title: "Full-width hero" }) })]);
    expect(taken).toEqual([expect.objectContaining({ ref: `AgentChatMessage:${offer.itemId}`, by, detail: expect.objectContaining({ offer: "change-request", result: "ChangeRequest:cr-9", code: "CR-009" }) })]);
  });
});

describe("assistant replies", () => {
  it("answers about the release that runs in the environment", async () => {
    const { p, jobId, job } = await ask({
      project: SERVICE,
      schema: "AssistantMessage",
      fields: { Environment: "production", Text: "How do I add photos to a service report?" },
      kind: "chat.reply",
      input: (id) => ({ projectId: w.project(SERVICE).ItemId, thread: "assistant", threadId: "production", messageId: id }),
    });
    expect(job.Status).toBe("succeeded");
    const rows = w.rows("AssistantMessage", String(p.ItemId)).filter((m) => m.EngineJobId === jobId && m.Role === "assistant");
    expect(rows).toHaveLength(1);
    const m = toAssistantMessage(rows[0]);
    expect(m).not.toBeNull();
    expect(m!.environment).toBe("production");
    expect(m!.kind).toBe("text");
    expect(m!.fixState).toBe("none");
    expect(m!.text).toMatch(/v\d+\.\d+\.\d+ on production/);
    expect(m!.text).not.toMatch(FORBIDDEN);
    for (const pt of m!.points) expect(pt).not.toMatch(FORBIDDEN);
  });

  it("says so when nothing is released to the environment", () => {
    const facts = loadFacts(new ProjectView(w.store, String(w.project(DRIVER).ItemId)));
    const a = assistantReply(facts, "production", "Can drivers see the route offline?", [], "k");
    expect(a.text).toMatch(/Nothing of Driver Delivery App is released to production yet/);
  });
});

describe("bug analysis", () => {
  it("writes an analysis the card reads and a fix draft the change request accepts", async () => {
    const { p, jobId, job } = await ask({
      project: SERVICE,
      schema: "AssistantMessage",
      fields: { Environment: "production", Text: "The PDF service report still shows the old parts after the technician corrects them before the customer signs." },
      kind: "fix.analyse",
      input: (id) => ({ projectId: w.project(SERVICE).ItemId, assistantMessageId: id, environment: "production" }),
    });
    expect(job.Status).toBe("succeeded");
    expect(job.Message).toBe("Analysed the report.");
    const rows = w.rows("AssistantMessage", String(p.ItemId)).filter((m) => m.EngineJobId === jobId && m.Role === "assistant");
    expect(rows).toHaveLength(1);
    const m = toAssistantMessage(rows[0]);
    expect(m!.kind).toBe("analysis");
    expect(m!.fixState).toBe("offered");
    const a = parseAnalysis(m!.analysisJson);
    expect(a).not.toBeNull();
    const view = new ProjectView(w.store, String(p.ItemId));
    const refs = [...new Set(view.milestones().flatMap((x) => (x.FeatureRefs as string[]) ?? []))];
    expect(refs).toContain(a!.featureRef);
    expect(checkChangeDraft(fixDraftFrom(a!), refs).ok).toBe(true);
    expect(a!.impact.environments[0]).toBe("production");
    expect(a!.rootCause.refs.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).not.toMatch(FORBIDDEN);
  });

  it("analyses every kind of report into a valid analysis", () => {
    const facts = loadFacts(new ProjectView(w.store, String(w.project(DRIVER).ItemId)));
    const reports = [
      "The photo disappears when the driver takes it in the basement without signal.",
      "Deliveries are marked delivered twice after the phone reconnects.",
      "The temperature shows yesterday's date for deliveries after midnight.",
      "The customer signature is missing although the customer signed.",
      "Typo in the label of the start button.",
      "Nobody can sign in since this morning, the app crashes.",
      "It does not work.",
    ];
    for (const r of reports) {
      const a = analyseBug(facts, { report: r, attachments: [], env: "dev", region: "Zurich, Switzerland" });
      expect(parseAnalysis(JSON.stringify(a))).not.toBeNull();
      expect(a.title.length).toBeLessThanOrEqual(120);
      expect(JSON.stringify(a)).not.toMatch(FORBIDDEN);
    }
  });
});

describe("wiki", () => {
  it("writes the wiki of a project that has none, one page per slug, readable by the wiki screen", async () => {
    const p = w.project(DRIVER);
    expect(w.rows("WikiPage", String(p.ItemId))).toHaveLength(0);
    const jobId = await w.queue({ project: DRIVER, kind: "wiki.generate", input: { projectId: p.ItemId }, key: "wiki-1" });
    await w.settle();
    const job = w.get("EngineJob", jobId);
    expect(job.Status).toBe("succeeded");
    const pages = w.rows("WikiPage", String(p.ItemId));
    expect(pages.length).toBeGreaterThanOrEqual(6);
    expect(job.Message).toBe(`Wrote ${pages.length} wiki pages from the scope, the build and the releases.`);
    expect(new Set(pages.map((x) => x.Slug)).size).toBe(pages.length);
    for (const row of pages) {
      const page = toWikiPage(row);
      expect(page).not.toBeNull();
      expect(SLUG_PATTERN.test(page!.slug)).toBe(true);
      expect(isWikiGroup(page!.group)).toBe(true);
      expect(page!.origin).toBe("factory");
      expect(row.EngineJobId).toBe(jobId);
      expect(parseSources(page!.sourcesJson)).toBeTruthy();
      expect(`${page!.title} ${page!.bodyMd}`).not.toMatch(FORBIDDEN);
      expect(page!.bodyMd).not.toMatch(/undefined|NaN|\[object/);
    }
    const groups = new Set(pages.map((x) => x.PageGroup));
    for (const g of ["overview", "guide", "features", "technical", "decisions"]) expect(groups).toContain(g);
  });

  it("updates instead of inserting on the next run", async () => {
    const p = w.project(DRIVER);
    const before = w.rows("WikiPage", String(p.ItemId)).map((x) => [x.ItemId, x.BodyMd]);
    const jobId = await w.queue({ project: DRIVER, kind: "wiki.generate", input: { projectId: p.ItemId }, key: "wiki-2" });
    await w.settle();
    const after = w.rows("WikiPage", String(p.ItemId));
    expect(after.map((x) => x.ItemId).sort()).toEqual(before.map((x) => x[0]).sort());
    expect(after.every((x) => x.EngineJobId === jobId)).toBe(true);
    expect(String(w.get("EngineJob", jobId).Message)).toMatch(/^Updated \d+ wiki pages/);
  });

  it("keeps the pages that are there, adds what is new and never touches a person's page", async () => {
    const p = w.project(SERVICE);
    const pid = String(p.ItemId);
    const before = new Map(w.rows("WikiPage", pid).map((x) => [String(x.Slug), x]));
    const person = [...before.values()].find((x) => x.Origin === "person")!;
    expect(person).toBeTruthy();
    const jobId = await w.queue({ project: SERVICE, kind: "wiki.generate", input: { projectId: pid }, key: "wiki-3" });
    await w.settle();
    expect(w.get("EngineJob", jobId).Status).toBe("succeeded");
    const after = new Map(w.rows("WikiPage", pid).map((x) => [String(x.Slug), x]));
    // A person's page is left exactly as it was.
    expect(after.get(String(person.Slug))!.BodyMd).toBe(person.BodyMd);
    expect(after.get(String(person.Slug))!.EngineJobId).toBe(person.EngineJobId);
    // Every earlier factory page keeps its text (an update only adds).
    for (const [slug, old] of before) {
      if (old.Origin !== "factory") continue;
      expect(String(after.get(slug)!.BodyMd).startsWith(String(old.BodyMd).split("\n## ")[0]!)).toBe(true);
    }
    // No second page for a feature, a guide or a group that already had one.
    const factory = [...after.values()].filter((x) => x.Origin === "factory");
    const featureRefs = factory.filter((x) => x.PageGroup === "features").map((x) => parseSources(String(x.SourcesJson)).items[0]?.ref);
    expect(new Set(featureRefs).size).toBe(featureRefs.length);
    for (const g of ["overview", "logic", "technical", "decisions", "releases"]) expect(factory.filter((x) => x.PageGroup === g)).toHaveLength(1);
    for (const [slug, old] of before) if (old.Origin === "factory") expect(after.get(slug)!.EngineJobId).toBe(jobId);
    // The release notes carry every released version.
    const notes = String(after.get("release-notes")!.BodyMd);
    const versions = [...new Set(w.rows("Release", pid).map((r) => String(r.Version)))];
    for (const v of versions) expect(notes).toMatch(new RegExp(`^## ${v.replace(/\./g, "\\.")}$`, "m"));
  });

  it("plans the same pages for the same records", () => {
    const facts = loadFacts(new ProjectView(w.store, String(w.project(DRIVER).ItemId)));
    expect(JSON.stringify(planWiki(facts))).toBe(JSON.stringify(planWiki(facts)));
  });
});

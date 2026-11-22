// Claude-written engine text (server/local/engine/ai) with a stub runner instead of the Claude CLI: an answer that
// matches is written in the rows the screens read (and the schemas accept); an invalid answer, an error or a timeout is
// retried once and then the job fails plainly (ai.failed) and writes nothing: no built-in text reaches people.
// MF_ENGINE_AI=off never calls it (the local stand-in keeps its built-in plans; the Blocks worker fails the job).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/ai.test.ts
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertRowValid } from "../../functions/_lib/testing";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { SETUP_AGENT_KIND, planAgentRun, readSoFar } from "../../src/domain/setupAgent";
import { AI_FAILED_CODE, AI_FAILED_MESSAGE, aiEnabled, requireAi, setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { STAGED, text } from "../../server/local/engine/ai/check.ts";
import { acceptMilestones, acceptTargets, untag } from "../../server/local/engine/kinds/scope/ai.ts";
import { acceptQuestions, acceptRequirements } from "../../server/local/engine/kinds/analysis/ai.ts";
import { createFileRecord, writeBytes } from "../../server/local/storage.ts";
import { projectAgentState } from "../../server/local/engine/setupWatch.ts";
import { makeWorld, type World } from "./harness";

// These tests drive the focused AI calls; the planner agent mode (analysis/agent.ts) is off here, as on a host without
// the official engine's planner AGENT.md.
vi.mock("../../server/local/engine/kinds/analysis/agent.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), hasAgentPlanner: () => false }));


const s = (v: unknown) => (typeof v === "string" ? v : "");
const props = (r: AiRequest): string[] => Object.keys((r.schema as { properties?: object }).properties ?? {});
const all = (re: RegExp, t: string): string[] => [...t.matchAll(re)].map((m) => m[1]!);

/** Answers like Claude would, from the prompt's own keys and tags. */
function answer(r: AiRequest): unknown {
  const p = props(r);
  if (p.includes("questions")) return { questions: [
    { question: "Who checks a new seller before their first asset goes on sale?", source: "N1", forApprover: false, options: ["The marketplace team", "Nobody, sellers go live at once", "Other", "Not sure"] },
    { question: "What share of each sale does the marketplace keep as its fee?", source: "", forApprover: true, options: ["10% of each sale", "15% of each sale", "20% of each sale"] },
  ] };
  if (p.includes("requirements")) return { requirements: [
    { title: "Sellers upload an asset with its licence and price", text: "A seller uploads a file, picks a licence and sets a price.", category: "functional", priority: "must", acceptanceCriteria: ["A seller sees the upload in their list at once", "An upload without a licence is refused with a clear message"], sources: ["N1"] },
    { title: "Buyers pay by card and download at once", text: "A buyer pays and gets the download link.", category: "functional", priority: "must", acceptanceCriteria: ["The download starts within a few seconds of paying", "A failed payment leaves nothing half paid"], sources: [] },
    { title: "Sellers see their monthly payout", text: "A seller sees what they earned and when it is paid.", category: "data", priority: "nice", acceptanceCriteria: ["The payout matches the sales of the month", "Each payout lists the sales it pays"], sources: ["F9"] },
  ] };
  if (p.includes("statement")) return {
    statement: "Independent creators sell templates, icons and fonts to small businesses in one trusted place",
    acceptanceCriteria: ["100 sellers list assets in the first three months", "Buyers find and buy an asset in under two minutes"],
    highLevelMd: "## Goal\n- Creators earn from their work\n\n## Users\n- Sellers\n- Buyers",
    architectureMd: "## Components\n- Shop screens for buyers\n- A seller area with uploads and payouts",
    lookAndFeel: "Bright and calm, built for buyers on a phone and sellers on a laptop, with large previews of every asset.",
    workflows: [{ title: "A seller lists a new asset", who: "Seller", steps: ["Uploads the files", "Sets a licence and a price", "Sends it for review"] }],
    notIncluded: ["Subscriptions or credit packs", "Coupons", "Native mobile apps"],
    constraints: [{ kind: "other", text: "Prices in EUR only at launch" }],
  };
  if (p.includes("features")) {
    const keys = all(/^- ([a-z0-9-]+) \[/gm, r.prompt);
    const half = Math.ceil(keys.length / 2);
    return {
      features: [keys.slice(0, half), keys.slice(half)].filter((k) => k.length).map((k, i) => ({
        name: i === 0 ? "Seller uploads" : "Checkout and downloads",
        description: i === 0 ? "Sellers put their assets on sale." : "Buyers pay and download.",
        priority: "must",
        requirementKeys: k,
        stories: [{ title: i === 0 ? "Upload an asset" : "Pay and download", actor: i === 0 ? "seller" : "buyer", text: i === 0 ? "As a seller, I want to upload an asset so that I can sell it." : "As a buyer, I want to pay by card so that I get the file at once.", criteria: ["It shows a clear message when it fails", "It is saved at once"], hours: 4 }],
      })),
      notIncluded: [{ name: "Physical goods", reason: "Only digital assets are sold." }],
    };
  }
  if (p.includes("milestones")) {
    const tags = all(/^\[(F\d+)\]/gm, r.prompt);
    return { milestones: [
      { name: "First sales", goal: "Sellers list assets and buyers buy them.", preview: "In the preview, a buyer buys an icon set.", features: tags.slice(0, 1) },
      { name: "Everything else", goal: "The rest of the scope.", preview: "In the preview, the full shop.", features: tags.slice(1) },
    ].filter((m) => m.features.length) };
  }
  if (p.includes("outcome")) return {
    outcome: { value: "500 assets sold in the first three months", reason: "Sales show that both sides use it." },
    users: { value: "about 2,000 buyers, up to 150 at the same time", reason: "A new marketplace grows over the first months." },
    responseTime: { choice: "fast", reason: "Buyers leave slow shops." },
    dataVolume: { value: "about 5,000 assets of up to 200 MB each, kept while on sale", reason: "Asset files are the bulk of the data." },
    availability: { value: "every day, busiest in the evenings", reason: "Buyers shop after work." },
  };
  if (p.includes("points")) {
    if (p.includes("answer")) return { answer: "Version 1.0 runs on production with the shop and the seller area.", points: ["Open the shop", "Pick an asset"] };
    const tags = all(/\[(F\d+(?:\.S\d+)?)\]/g, r.prompt);
    return { points: tags.slice(0, 3).map((t, i) => ({ rule: "acceptance", severity: i === 0 ? "high" : "medium", question: `What happens when step ${i + 1} of ${t} fails halfway?`, why: "Nothing says what people see then.", fix: "Add a check for the failure and the message people see.", target: t })) };
  }
  if (p.includes("tasks")) {
    const ms = all(/^Milestone (\d+) /gm, r.prompt).map(Number);
    return { tasks: [{ milestone: ms[0], role: "pipeline", title: "Build pipeline and preview", description: "Every change is built and shown in a preview.", acceptance: ["Every milestone has a preview", "Every change runs the checks"], hours: 3, feature: "" }] };
  }
  if (p.includes("answer")) return { answer: "The upload ticket is in review; it should reach test today." };
  if (p.includes("findings")) {
    const d = /\[(D\d+)\] "brief\.md"/.exec(r.prompt)?.[1] ?? "D1";
    return { findings: [
      { kind: "mustHave", text: "Sellers can set their own price for each licence", priority: "must", constraintKind: "other", source: d },
      { kind: "constraint", text: "Payouts must follow Swiss VAT rules", priority: "must", constraintKind: "compliance", source: d },
    ] };
  }
  throw new Error(`no stub answer for ${p.join(",")}`);
}

let calls: AiRequest[] = [];
const install = (fn: (r: AiRequest) => unknown) => setAiRunner(async (r) => { calls.push(r); return fn(r); });

afterEach(() => {
  setAiRunner(null);
  calls = [];
  delete process.env.MF_ENGINE_AI;
});

function done(w: World, id: string): Row {
  const j = w.get("EngineJob", id);
  if (j.Status !== "succeeded") throw new Error(`job ${s(j.Kind)} ${s(j.Status)}: ${s(j.Message)}\n${w.log.join("\n")}`);
  return j;
}

describe("the switch and the checks", () => {
  it("is off in unit tests and with MF_ENGINE_AI=off, on with a runner installed", () => {
    expect(aiEnabled()).toBe(false);
    install(() => ({}));
    expect(aiEnabled()).toBe(true);
    process.env.MF_ENGINE_AI = "off";
    expect(aiEnabled()).toBe(false);
  });

  it("keeps staged words out of the visible text", () => {
    expect(STAGED.test("A demo shop")).toBe(true);
    expect(text("A sample asset", 100)).toBeNull();
    expect(text("Sellers are tested before they sell", 100)).toBe("Sellers are tested before they sell");
    expect(text("x".repeat(50), 20)!.length).toBeLessThanOrEqual(20);
  });

  it("refuses answers that do not fit the plan", () => {
    const qc = { requester: "u1", approver: "", existing: ["Who checks a new seller before their first sale?"], sources: new Map(), min: 1, max: 6 };
    expect(acceptQuestions({ nope: [] }, qc)).toBeNull();
    expect(acceptQuestions({ questions: [{ question: "Who checks a new seller before their first sale?", source: "" }] }, qc)).toBeNull(); // a repeat
    expect(acceptQuestions({ questions: [{ question: "How are refunds handled", source: "N7" }] }, qc)![0]).toMatchObject({ question: "How are refunds handled?", sourceType: "engine", owner: "u1" });
    expect(acceptRequirements({ requirements: [{ title: "Only one check", text: "x", acceptanceCriteria: ["one"] }] }, { sources: new Map(), existing: [], min: 1, max: 5 })).toBeNull();
    expect(acceptTargets({ outcome: { value: "x", reason: "y" } })).toBeNull();
    const f = (key: string) => ({ id: key, key, ref: `feature:${key}`, title: key, description: "", priority: "must" as const, requirementRefs: [], sortOrder: 0, stories: [], hours: 2, words: new Set<string>(), text: key });
    const plan = acceptMilestones({ milestones: [{ name: "One", goal: "Sellers sell their work.", preview: "In the preview, a sale.", features: ["F1", "F1", "F9"] }] }, [f("a"), f("b")]);
    expect(plan!.flatMap((m) => m.featureRefs)).toEqual(["feature:a", "feature:b"]); // every feature exactly once
  });

  it("names features and stories instead of the prompt's tags", () => {
    const st = { id: "s", key: "a-1", title: "Pay by card", text: "", actor: "buyer", criteria: [], hours: 2, sortOrder: 0 };
    const fs = [{ id: "a", key: "a", ref: "feature:a", title: "Checkout", description: "", priority: "must" as const, requirementRefs: [], sortOrder: 0, stories: [st], hours: 2, words: new Set<string>(), text: "" }];
    expect(untag("Move F1 into Milestone 1 (F1.S1) and [F1]; F7 stays.", fs)).toBe("Move “Checkout” into Milestone 1 “Pay by card” and “Checkout”; F7 stays.");
    expect(text("Ask the seller [N2] first", 100)).toBe("Ask the seller first");
  });
});

describe("writers with Claude's answers", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());

  it("sanitization.assist writes Claude's questions, with their owner and source", async () => {
    install(answer);
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    const id = await w.queue({ project: p.Name as string, kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "ai-q" });
    await w.settle();
    done(w, id);
    const rows = w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${id}:`));
    expect(rows.map((r) => r.Question)).toEqual(["Who checks a new seller before their first asset goes on sale?", "What share of each sale does the marketplace keep as its fee?"]);
    for (const r of rows) expect(() => assertRowValid("Clarification", r, { read: true })).not.toThrow();
    expect(rows[0]!.SourceType).toBe("doc-note");
    // the one-click answers come with the questions (the page adds "Other…", "Not sure" and "Later" itself)
    expect(rows.map((r) => r.Options)).toEqual([["The marketplace team", "Nobody, sellers go live at once"], ["10% of each sale", "15% of each sale", "20% of each sale"]]);
    expect(w.log.some((l) => /AI questions: Claude answer used/.test(l))).toBe(true);
    expect(calls[0]!.prompt).toContain("Material:");
  });

  it("requirements.draft writes Claude's requirements, objective and look & feel", async () => {
    install(answer);
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    for (const r of w.rows("Objective", pid)) await w.gw.remove("Objective", s(r.ItemId));
    for (const r of w.rows("DesignBrief", pid)) await w.gw.remove("DesignBrief", s(r.ItemId));
    const id = await w.queue({ project: p.Name as string, kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1 }, key: "ai-r" });
    await w.settle();
    done(w, id);
    const reqs = w.rows("Requirement", pid).filter((r) => s(r.RequestKey).startsWith(`engine:${id}:`));
    expect(reqs.map((r) => r.Title)).toContain("Sellers upload an asset with its licence and price");
    for (const r of reqs) expect(() => assertRowValid("Requirement", r, { read: true })).not.toThrow();
    const obj = w.rows("Objective", pid)[0]!;
    expect(s(obj.Statement)).toMatch(/^Independent creators sell/);
    expect(() => assertRowValid("Objective", obj, { read: true })).not.toThrow();
    expect(w.rows("DesignBrief", pid)[0]!.Mode).toBe("figma");
    expect(s(w.rows("DesignBrief", pid)[0]!.Instructions)).toMatch(/^Derive the product journeys/);
    expect(s(w.rows("DesignBrief", pid)[0]!.Instructions)).toContain("Sellers upload an asset");
    // the workflows, what is left out and the constraints, from the material (when the project has none yet)
    const extras = w.rows("RequirementExtra", pid);
    if (extras.every((x) => x.Origin !== "person")) {
      expect(extras.filter((x) => x.Kind === "exclusion").map((x) => x.Title)).toEqual(expect.arrayContaining(["Subscriptions or credit packs", "Coupons", "Native mobile apps"]));
      expect(extras.find((x) => x.Kind === "workflow")).toMatchObject({ Who: "Seller", Origin: "engine" });
      for (const x of extras) expect(() => assertRowValid("RequirementExtra", x, { read: true })).not.toThrow();
    }
    // the two planners run side by side
    expect(calls.map((c) => props(c)[0])).toEqual(expect.arrayContaining(["requirements", "statement"]));
  });

  /** A job that stopped because the AI gave no usable answer: failed with ai.failed and its plain line, nothing written. */
  function stoppedWithoutAnswer(id: string, schema: string, pid: string): void {
    const j = w.get("EngineJob", id);
    expect(j.Status).toBe("failed");
    expect(j.ErrorCode).toBe(AI_FAILED_CODE);
    expect(j.Message).toBe(AI_FAILED_MESSAGE);
    expect(w.rows(schema, pid).filter((r) => s(r.RequestKey).startsWith(`engine:${id}:`))).toEqual([]);
  }

  it("an invalid answer is retried once, then the job fails plainly and writes nothing built in", async () => {
    install(() => ({ questions: "not a list" }));
    const p = w.project("Client Document Portal");
    const pid = s(p.ItemId);
    const id = await w.queue({ project: p.Name as string, kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "ai-bad" });
    await w.settle();
    expect(calls).toHaveLength(2);
    stoppedWithoutAnswer(id, "Clarification", pid);
    expect(w.log.some((l) => /AI questions: stopped, no usable answer/.test(l))).toBe(true);
    expect(w.log.some((l) => /FALLBACK/.test(l))).toBe(false);
  });

  it("an error or a timeout stops the job the same way", async () => {
    install(() => { throw new Error("timed out after 75 s"); });
    const p = w.project("Client Document Portal");
    const pid = s(p.ItemId);
    const id = await w.queue({ project: p.Name as string, kind: "sanitization.assist", input: { projectId: pid, focus: "requirements" }, key: "ai-err" });
    await w.settle();
    expect(calls).toHaveLength(2);
    stoppedWithoutAnswer(id, "Requirement", pid);
    expect(w.log.some((l) => /AI missing requirements: stopped, no usable answer \(timed out/.test(l))).toBe(true);
  });

  it("MF_ENGINE_AI=off never calls Claude: the local stand-in keeps its built-in plans, the Blocks worker stops the job", async () => {
    const p = w.project("Client Document Portal");
    const pid = s(p.ItemId);
    process.env.MF_ENGINE_AI = "off";
    const local = await w.queue({ project: p.Name as string, kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "ai-off" });
    await w.settle();
    done(w, local);
    expect(calls).toHaveLength(0);
    requireAi(true);
    try {
      const hosted = await w.queue({ project: p.Name as string, kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "ai-off-hosted" });
      await w.settle();
      stoppedWithoutAnswer(hosted, "Clarification", pid);
      expect(calls).toHaveLength(0);
    } finally {
      requireAi(false);
    }
  });

  it("scope.draft writes Claude's features, stories, milestones and targets", async () => {
    install(answer);
    const p = w.project("Payroll Self-Service");
    const pid = s(p.ItemId);
    await w.gw.update("Project", pid, { Stage: "scope" });
    for (const r of w.rows("ScopeVersion", pid)) await w.gw.remove("ScopeVersion", s(r.ItemId));
    for (const schema of ["Feature", "Story", "Milestone"]) for (const r of w.rows(schema, pid)) await w.gw.remove(schema, s(r.ItemId));
    const id = await w.queue({ project: p.Name as string, kind: "scope.draft", input: { projectId: pid, scopeVersion: 1 }, target: { type: "project", id: pid }, key: "ai-scope" });
    await w.settle();
    done(w, id);
    const features = w.rows("Feature", pid);
    expect(features.map((f) => f.Title)).toEqual(["Seller uploads", "Checkout and downloads", "Physical goods"]);
    expect(features[2]!.Status).toBe("dropped");
    for (const f of features) expect(() => assertRowValid("Feature", f, { read: true })).not.toThrow();
    for (const st of w.rows("Story", pid)) expect(() => assertRowValid("Story", st, { read: true })).not.toThrow();
    const ms = w.rows("Milestone", pid);
    expect(ms.map((m) => m.Name)).toEqual(["First sales", "Everything else"]);
    for (const m of ms) expect(() => assertRowValid("Milestone", m, { read: true })).not.toThrow();
    const v = w.rows("ScopeVersion", pid)[0]!;
    expect(s(v.SuccessTargets)).toContain("500 assets sold");
    expect(() => assertRowValid("ScopeVersion", v, { read: true })).not.toThrow();
  });

  it("scope.grill writes Claude's points on the scope's own features and stories", async () => {
    install(answer);
    const p = w.project("B2B Order Portal");
    const pid = s(p.ItemId);
    const v = w.rows("ScopeVersion", pid).find((x) => x.Number === 1)!;
    const id = await w.queue({ project: p.Name as string, kind: "scope.grill", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "ai-grill" });
    await w.settle();
    done(w, id);
    const points = w.rows("Challenge", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${id}:`));
    expect(points).toHaveLength(3);
    for (const c of points) {
      expect(s(c.Question)).toMatch(/^What happens when step/);
      expect(() => assertRowValid("Challenge", c, { read: true })).not.toThrow();
      const [type, ref] = s(c.TargetRef).split(":");
      expect(w.get(type === "story" ? "Story" : "Feature", ref!).ProjectId).toBe(pid);
    }
  });

  it("board.plan adds Claude's cross-cutting tasks next to the story tickets", async () => {
    install(answer);
    const p = w.project("B2B Order Portal");
    const pid = s(p.ItemId);
    const v = w.rows("ScopeVersion", pid).find((x) => x.Number === 1)!;
    const id = await w.queue({ project: p.Name as string, kind: "board.plan", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "ai-board" });
    await w.settle();
    done(w, id);
    const tasks = w.rows("Ticket", pid).filter((t) => t.EngineJobId === id && t.TicketType === "task");
    expect(tasks.map((t) => t.Title)).toEqual(["Build pipeline and preview"]);
    for (const t of w.rows("Ticket", pid).filter((x) => x.EngineJobId === id)) expect(() => assertRowValid("Ticket", t, { read: true })).not.toThrow();
  });

  it("chat.reply writes Claude's answer in the agent's thread", async () => {
    install(answer);
    const p = w.project("Driver Delivery App");
    const pid = s(p.ItemId);
    const by = s(p.CreatedByUserId);
    const msg = await w.gw.insert("AgentChatMessage", { ProjectId: pid, AgentRole: "qa", Role: "user", Kind: "text", Text: "Where is the upload ticket?", AuthorUserId: by, EngineJobId: "", At: w.now().toISOString(), WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: capKey("test:ai-chat") });
    const id = await w.queue({ project: p.Name as string, kind: "chat.reply", input: { projectId: pid, thread: "agent", threadId: "qa", messageId: msg.itemId }, key: "ai-chat" });
    await w.settle();
    done(w, id);
    const reply = w.rows("AgentChatMessage", pid).find((m) => m.EngineJobId === id && m.Role === "agent")!;
    expect(reply.Text).toBe("The upload ticket is in review; it should reach test today.");
    expect(() => assertRowValid("AgentChatMessage", reply, { read: true })).not.toThrow();
  });

  it("setup.assist writes Claude's findings as suggestions people review", async () => {
    install(answer);
    const p = w.project("Spare Parts Webshop");
    const pid = s(p.ItemId);
    const bytes = new TextEncoder().encode("# Marketplace brief\n\n## What we need\n- Sellers set their own price for each licence\n- Payouts follow Swiss VAT rules\n");
    const rec = createFileRecord(w.db, { directoryId: "", name: "brief.md", mime: "text/markdown", sizeBytes: bytes.length });
    writeBytes(w.db, path.join(w.dir, "files"), rec.fileId, bytes);
    w.store.insert("DocFile", {
      ProjectId: pid, FolderId: "", Name: "brief.md", StoredName: "1.md", Mime: "text/markdown", SizeBytes: bytes.length, StorageObjectId: rec.fileId, Status: "ready", SortOrder: 1024,
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId, RequestKey: capKey("test:ai-share"),
    } as Row);
    const st = projectAgentState(w.store, pid);
    const plan = planAgentRun(st.material, readSoFar(st.jobs))!;
    const id = await w.queue({ project: p.Name as string, kind: SETUP_AGENT_KIND, input: { projectId: pid, ...plan }, key: "ai-setup" });
    await w.settle();
    done(w, id);
    const rows = w.rows("SetupSuggestion", pid).filter((r) => r.EngineJobId === id);
    expect(rows.map((r) => r.Text)).toEqual(expect.arrayContaining(["Sellers can set their own price for each licence", "Payouts must follow Swiss VAT rules"]));
    expect(rows.find((r) => r.Kind === "constraint")!.ConstraintKind).toBe("compliance");
    for (const r of rows.filter((x) => /licence|VAT/.test(s(x.Text)))) expect(r.SourceName).toBe("brief.md");
  });
});

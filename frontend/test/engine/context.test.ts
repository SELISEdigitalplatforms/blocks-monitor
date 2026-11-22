// The project context (server/engine-context): context.json versions only on a change and is written atomically,
// credentials never reach the files, ids are checked; a job run with project folders records the version and refs it
// used and links each output to its job, version and sources; a context error never fails a job; the developers'
// project-brief MCP server (with --kb-dir) lists its six tools plus the context tools and answers them, trace included.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/context.test.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { createEngine, type Engine, type WriterLoader } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import type { RunDeps } from "../../server/local/engine/run.ts";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { CONTEXT_FILE, commitContext, readContext, readLedger, redact, writeJsonAtomic } from "../../server/engine-context/store.ts";
import type { Sections } from "../../server/engine-context/snapshot.ts";
import { BRIEF_SERVER, MCP_SERVER_NAME, mcpConfigFor } from "../../server/engine-context/mcp.ts";
import { makeWorld, type World } from "./harness";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const made: string[] = [];
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `madp-context-${name}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function sections(over: Partial<Sections> = {}): Sections {
  return {
    basics: { name: "Atelier", client: "", industry: "", region: "", existing: false, repoName: "", description: "", goal: "Sell prints", targetUsers: "", mustHaves: [], workflows: [], exclusions: [], constraints: [], intendedChanges: "", changeTags: [], approvalOwnerUserId: "", approvalOwnerName: "", stage: "", status: "", setupStatus: "", appUrl: "", websiteUrl: "", handedOverAt: "", requirementsConfirmedAt: "", scopeLockedAt: "", currency: "" },
    sources: { notes: [], files: [], suggestions: [], brief: null },
    clarifications: [],
    requirements: { objective: null, items: [], extras: [] },
    scope: { current: 1, locked: null, versions: [] },
    milestones: [],
    tickets: [],
    builds: { latestBuild: null, previewUrl: "", builds: [], branches: [], environments: {} },
    previews: [],
    releases: [],
    decisions: { decisions: [], tech: [], changeRequests: [], chat: [] },
    ...over,
  };
}

/** One JSON-RPC session with the developers' server over stdio; answers the replies by id. */
async function mcp(kb: string, calls: { name: string; arguments?: Record<string, unknown> }[]): Promise<{ id: number; result?: { tools?: { name: string }[]; content?: { text: string }[]; serverInfo?: { name: string } }; error?: unknown }[]> {
  const child = spawn(process.execPath, [BRIEF_SERVER, "--project", "test", "--kb-dir", kb], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  const want = calls.length + 2;
  const done = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer from the MCP server: ${out.slice(0, 300)}`)), 20_000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      if (out.split("\n").filter(Boolean).length >= want) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const msgs = [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ...calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 2, method: "tools/call", params: { name: c.name, arguments: c.arguments ?? {} } })),
  ];
  for (const m of msgs) child.stdin.write(`${JSON.stringify(m)}\n`);
  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
  }
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.id - b.id);
}

const textOf = (r: { result?: { content?: { text: string }[] } }): string => r.result?.content?.[0]?.text ?? "";

describe("context store", () => {
  it("raises the version only when the sections change, and logs each change", () => {
    const dir = tmp("store");
    const ids = { workspaceId: "ws-1", projectId: "p-1", digestOf: () => "digest" };
    const a = commitContext(dir, { ...ids, sections: sections(), cause: { phase: "test" } });
    expect(a.context.version).toBe(1);
    const again = commitContext(dir, { ...ids, sections: sections(), cause: { phase: "test" } });
    expect(again.context.version).toBe(1);
    expect(again.changed).toEqual([]);
    const b = commitContext(dir, { ...ids, sections: sections({ milestones: [{ ref: "Milestone:m1", name: "First sales" }] }), cause: { phase: "test" } });
    expect(b.context.version).toBe(2);
    expect(b.changed).toEqual(["milestones"]);
    expect(readContext(dir)?.version).toBe(2);
    const events = readLedger(dir).filter((e) => e.type === "context.updated");
    expect(events.map((e) => e.version)).toEqual([1, 2]);
  });

  it("writes atomically (no temporary file left) and keeps credentials out of the files", () => {
    const dir = tmp("secrets");
    writeJsonAtomic(path.join(dir, "x.json"), { a: 1 });
    expect(fs.readdirSync(dir)).toEqual(["x.json"]);
    const leaky = sections({
      sources: {
        notes: [{ ref: "DocNote:n1", title: "Access", body: "Use password: Hunter2024 and key sk-ant-api03-abcdefghijklmnop for the shop; password: at least 12 characters", by: "u1", isProjectBrief: false }],
        files: [], suggestions: [], brief: null,
      },
    });
    commitContext(dir, { workspaceId: "ws-1", projectId: "p-1", sections: leaky, digestOf: (c) => c.sections.sources.notes[0]!.body, cause: { note: "token=ghp_abcdefghijklmnopqrstuvwxyz0123" } });
    const all = fs.readFileSync(path.join(dir, CONTEXT_FILE), "utf8") + fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8");
    expect(all).not.toContain("Hunter2024");
    expect(all).not.toContain("sk-ant-api03");
    expect(all).not.toContain("ghp_abcdef");
    expect(all).toContain("password: at least 12 characters");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(redact("Bearer abcdefghijklmnopqrstuvwxyz123456")).toBe("Bearer [redacted]");
  });

  it("checks the ids before any path is made", () => {
    const dir = tmp("ids");
    expect(() => commitContext(dir, { workspaceId: "../x", projectId: "p", sections: sections(), digestOf: () => "", cause: {} })).toThrow(/invalid workspace id/);
    expect(() => mcpConfigFor("ws", "../../etc")).toThrow();
  });
});

describe("a job with project folders", () => {
  let w: World;
  let root: string;
  let engine: Engine;
  let prevRoot: string | undefined;
  const prompts: AiRequest[] = [];

  const deps = (writers: WriterLoader, projectFolder?: RunDeps["projectFolder"]): Engine =>
    createEngine({
      store: w.store,
      gateway: w.gw,
      config: () => w.config,
      log: (l) => w.log.push(l),
      writers,
      now: () => w.now(),
      sleep: (_ms, signal) => new Promise((resolve, reject) => (signal.aborted ? reject(new Error("aborted")) : setImmediate(resolve))),
      readFile: async (id) => {
        const b = w.fileBytes(id);
        return b ? new Uint8Array(b) : null;
      },
      sweepMs: 0,
      projectFolder: projectFolder ?? ((ws, id, o) => projectWorkspace(root, ws, id, o)),
    });
  const settle = async (e: Engine) => {
    for (let i = 0; i < 80; i++) {
      e.tick();
      await e.idle();
      if (!w.store.rows("EngineJob").some((j) => ["queued", "claimed", "running"].includes(String(j.Status)))) return;
    }
  };

  beforeAll(async () => {
    w = await makeWorld();
    root = tmp("root");
    prevRoot = process.env.MF_ENGINE_ROOT;
    process.env.MF_ENGINE_ROOT = root;
    engine = deps(writerOf);
    setAiRunner(async (r) => {
      prompts.push(r);
      // a later job of the project gets questions it has not asked yet (a repeat is refused, and without a usable
      // answer the job fails: nothing built in is written)
      const n = prompts.length;
      return n <= 1 ? { questions: [
        { question: "Who checks a new supplier before their first delivery is accepted?", source: "N1", forApprover: false },
        { question: "How many open quality issues may a supplier have before they are blocked?", source: "", forApprover: true },
      ] } : { questions: [
        { question: `Which ${["first", "second", "third", "fourth", "fifth", "sixth"][n % 6]} supplier report does the quality team read each week?`, source: "", forApprover: false },
      ] };
    });
  });
  afterAll(() => {
    setAiRunner(null);
    engine?.stop();
    if (prevRoot === undefined) delete process.env.MF_ENGINE_ROOT;
    else process.env.MF_ENGINE_ROOT = prevRoot;
    w?.close();
  });

  it("records the version and refs it used, and links every output to job, version and sources", async () => {
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    const ws = s(p.WorkspaceId);
    const note = w.rows("DocNote", pid).find((n) => s(n.BodyMd).trim() || s(n.Title).trim())!;
    const id = await w.queue({ project: s(p.Name), kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications", refs: { docNoteIds: [s(note.ItemId)] } }, key: "ctx-q" });
    await settle(engine);
    expect(w.get("EngineJob", id).Status).toBe("succeeded");

    const kb = path.join(root, "projects", ws, pid, "artifacts", "brief");
    const ctx = readContext(kb)!;
    expect(ctx.version).toBeGreaterThanOrEqual(2);
    expect(ctx.digest).toContain(`Project context v${ctx.version}`);

    // the prompt got the context version and the material from the snapshot
    expect(prompts[0]!.prompt).toMatch(/Project context v\d+/);
    expect(prompts[0]!.prompt).toContain("Material:");

    const job = JSON.parse(fs.readFileSync(path.join(root, "projects", ws, pid, "jobs", `${id}-1`, "context.json"), "utf8"));
    expect(job.contextVersion).toBe(ctx.version - 1);
    expect(job.inputRefs).toContain(`DocNote:${s(note.ItemId)}`);
    expect(job.seen).toContain(`DocNote:${s(note.ItemId)}`);
    expect(job.status).toBe("succeeded");
    expect(job.resultVersion).toBe(ctx.version);

    const events = readLedger(kb);
    const started = events.find((e) => e.type === "job.started" && e.jobId === id)!;
    expect(started.contextVersion).toBe(job.contextVersion);
    const outs = events.filter((e) => e.type === "output" && e.jobId === id);
    const qs = w.rows("Clarification", pid).filter((c) => s(c.RequestKey).startsWith(`engine:${id}:`));
    expect(outs.map((e) => e.ref).sort()).toEqual(qs.map((q) => `Clarification:${s(q.ItemId)}`).sort());
    const fromNote = outs.find((e) => e.ref === `Clarification:${s(qs.find((q) => q.SourceType === "doc-note")!.ItemId)}`)!;
    expect(fromNote.sources).toContain(`DocNote:${s(note.ItemId)}`);
    expect(fromNote.contextVersion).toBe(job.contextVersion);
    expect(events.find((e) => e.type === "job.finished" && e.jobId === id)?.status).toBe("succeeded");
    // the new questions are in the snapshot after the job
    expect(ctx.sections.clarifications.map((c) => c.ref)).toContain(fromNote.ref);

    // the trace through the developers' MCP server
    const [, list, trace, byJob, digest] = await mcp(kb, [{ name: "trace", arguments: { id: fromNote.ref } }, { name: "trace", arguments: { id } }, { name: "get_project_context" }]);
    expect(list!.result!.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(["get_project_brief", "get_source_extraction", "get_extracted_text", "list_attachments", "get_form_answers", "search_findings", "get_project_context", "get_requirements", "get_scope", "get_tickets", "get_builds", "get_decisions", "trace"]));
    const t = JSON.parse(textOf(trace!)).trace;
    expect(t.madeBy.jobId).toBe(id);
    expect(t.madeBy.kind).toBe("sanitization.assist");
    expect(t.madeBy.contextVersion).toBe(job.contextVersion);
    const src = t.sources.find((x: { ref: string }) => x.ref === `DocNote:${s(note.ItemId)}`);
    expect(src.origin).toMatch(/provided by people/);
    expect(JSON.parse(textOf(byJob!)).attempts[0].outputs.length).toBe(qs.length);
    expect(textOf(digest!)).toContain(`Project context v${ctx.version}`);
  });

  it("writes a per-project mcp.json that runs the developers' server on the knowledge-base folder", () => {
    const p = w.project("Supplier Quality Portal");
    const file = mcpConfigFor(s(p.WorkspaceId), s(p.ItemId));
    expect(file).toBe(path.join(root, "projects", s(p.WorkspaceId), s(p.ItemId), "mcp.json"));
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const srv = cfg.mcpServers[MCP_SERVER_NAME];
    expect(srv.args).toEqual([BRIEF_SERVER, "--project", s(p.ItemId), "--kb-dir", path.join(root, "projects", s(p.WorkspaceId), s(p.ItemId), "artifacts", "brief")]);
  });

  it("links a build to its commit and tickets, and the build finds mcpConfigFor", async () => {
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    const ticket = w.rows("Ticket", pid)[0];
    const tid = ticket ? s(ticket.ItemId) : "t-missing";
    const builder = deps(async () => async () => ({
      outputs: ticket ? [`Ticket:${tid}`] : [],
      message: "built",
      build: { buildId: "m1-v0-1-0", commit: "abc1234def", branch: "build/m1", version: "0.1.0", ticketIds: [tid] },
    }));
    const id = await w.queue({ project: s(p.Name), kind: "wiki.generate", input: { projectId: pid }, key: "ctx-build" });
    await settle(builder);
    builder.stop();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const kb = path.join(root, "projects", s(p.WorkspaceId), pid, "artifacts", "brief");
    const out = readLedger(kb).find((e) => e.type === "output" && e.ref === "Build:m1-v0-1-0")!;
    expect(out.jobId).toBe(id);
    expect(out.sources).toContain(`Ticket:${tid}`);
    expect((out.build as { commit: string }).commit).toBe("abc1234def");
    const [, , trace] = await mcp(kb, [{ name: "trace", arguments: { id: "Build:m1-v0-1-0" } }]);
    const t = JSON.parse(textOf(trace!)).trace;
    expect(t.build.commit).toBe("abc1234def");
    expect(t.sources.map((x: { ref: string }) => x.ref)).toContain(`Ticket:${tid}`);
  });

  it("records a failed writer, and a context error never fails a job", async () => {
    const failing = deps(async () => async () => {
      throw new Error("writer broke");
    });
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    const bad = await w.queue({ project: s(p.Name), kind: "wiki.generate", input: { projectId: pid }, key: "ctx-fail" });
    await settle(failing);
    failing.stop();
    expect(w.get("EngineJob", bad).Status).toBe("failed");
    const kb = path.join(root, "projects", s(p.WorkspaceId), pid, "artifacts", "brief");
    expect(readLedger(kb).find((e) => e.type === "job.finished" && e.jobId === bad)?.status).toBe("failed");

    // no folder can be made at all (the root is a file, the project folders fail): the job still runs and succeeds
    const blocked = path.join(tmp("blocked"), "a-file");
    fs.writeFileSync(blocked, "");
    process.env.MF_ENGINE_ROOT = blocked;
    const broken = deps(writerOf, () => {
      throw new Error("disk full");
    });
    const ok = await w.queue({ project: s(p.Name), kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "ctx-broken" });
    try {
      await settle(broken);
    } finally {
      broken.stop();
      process.env.MF_ENGINE_ROOT = root;
    }
    expect(w.get("EngineJob", ok).Status).toBe("succeeded");
    expect(w.log.some((l) => /context: refresh before the job failed \(disk full\)/.test(l))).toBe(true);
  });
});

describe("project-brief MCP server with --kb-dir", () => {
  it("keeps the brief tools and answers the scope (locked by default) and tickets", async () => {
    const kb = tmp("kb");
    fs.writeFileSync(path.join(kb, "brief.json"), JSON.stringify({ version: 3, project: { name: "Atelier" } }));
    fs.writeFileSync(path.join(kb, "form-answers.json"), JSON.stringify({ name: "Atelier", goal: "Sell prints" }));
    fs.mkdirSync(path.join(kb, "sources", "f1"), { recursive: true });
    fs.writeFileSync(path.join(kb, "sources", "f1", "full-text.md"), "# Price list\nA4 print: 20 CHF");
    fs.writeFileSync(path.join(kb, "sources", "f1", "extraction.json"), JSON.stringify({ observations: [{ kind: "price", text: "A4 print costs 20 CHF" }] }));
    const v = (n: number, status: string, title: string) => ({ ref: `ScopeVersion:v${n}`, number: n, title: `Scope ${n}`, status, lockedAt: status === "locked" ? "2026-10-31T09:00:00Z" : "", unlockedAt: "", lockedByUserId: "", planHours: 0, successTargets: "", features: [{ ref: `Feature:f${n}`, key: `k${n}`, title, stories: [] }] });
    commitContext(kb, {
      workspaceId: "ws-1",
      projectId: "p-1",
      sections: sections({
        scope: { current: 2, locked: 1, versions: [v(1, "locked", "Print shop"), v(2, "draft", "Print shop and framing")] },
        milestones: [{ ref: "Milestone:m1", scopeVersion: 1, number: 1, name: "First sales" }],
        tickets: [{ ref: "Ticket:t1", number: 1, title: "Checkout", column: "done", milestone: "Milestone:m1" }, { ref: "Ticket:t2", number: 2, title: "Framing", column: "backlog", milestone: "" }],
      }),
      digestOf: () => "Project context v1",
      cause: {},
    });
    const [init, , brief, form, text, search, scope, all, tickets] = await mcp(kb, [
      { name: "get_project_brief" },
      { name: "get_form_answers" },
      { name: "get_extracted_text", arguments: { sourceId: "f1" } },
      { name: "search_findings", arguments: { query: "a4" } },
      { name: "get_scope" },
      { name: "get_scope", arguments: { all: true } },
      { name: "get_tickets", arguments: { milestone: "1" } },
    ]);
    expect(init!.result!.serverInfo!.name).toBe("project-brief");
    expect(JSON.parse(textOf(brief!)).version).toBe(3);
    expect(JSON.parse(textOf(form!)).goal).toBe("Sell prints");
    expect(textOf(text!)).toContain("A4 print: 20 CHF");
    expect(JSON.parse(textOf(search!)).matchCount).toBe(1);
    const sc = JSON.parse(textOf(scope!));
    expect(sc.shown).toBe(1);
    expect(sc.isLocked).toBe(true);
    expect(sc.version.features[0].title).toBe("Print shop");
    expect(sc.version.milestones.map((m: Row) => m.name)).toEqual(["First sales"]);
    expect(JSON.parse(textOf(all!)).versions.length).toBe(2);
    expect(JSON.parse(textOf(tickets!)).tickets.map((t: Row) => t.title)).toEqual(["Checkout"]);
  });
});

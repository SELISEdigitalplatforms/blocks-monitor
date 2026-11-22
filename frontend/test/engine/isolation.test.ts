// Per-project isolation of the engine: two projects' jobs run side by side and nothing of one reaches the other —
// not the folders, the context, the ledger, the prompts, the MCP config the builds get, nor the outputs index; the
// project-brief MCP server refuses a source id that walks out of its own knowledge base; a job whose row names another
// workspace than its project is refused a folder.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/isolation.test.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine, type Engine } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import { JobRun, type RunDeps } from "../../server/local/engine/run.ts";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { BRIEF_SERVER, MCP_SERVER_NAME, mcpConfigFor } from "../../server/engine-context/mcp.ts";
import { writeProjectOutputs, toYaml } from "../../server/engine-context/outputs.ts";
import { listedFile, readManifest } from "../../server/api/outputs/routes.ts";
import { makeWorld, type World } from "./harness";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const made: string[] = [];
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `madp-isolation-${name}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

/** Every file under a folder (relative paths), without the git repository. */
function filesUnder(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "repo") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

async function mcpCall(kb: string, projectId: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const child = spawn(process.execPath, [BRIEF_SERVER, "--project", projectId, "--kb-dir", kb], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
  const done = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 15_000);
    child.stdout.on("data", () => {
      if (out.split("\n").filter(Boolean).length >= 2) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  for (const m of [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  ]) child.stdin.write(`${JSON.stringify(m)}\n`);
  await done;
  child.stdin.end();
  child.kill();
  const reply = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.id === 1);
  return { text: reply?.result?.content?.[0]?.text ?? "", isError: reply?.result?.isError === true };
}

describe("two projects on one engine", () => {
  let w: World;
  let root: string;
  let engine: Engine;
  let prevRoot: string | undefined;
  const prompts: AiRequest[] = [];

  beforeAll(async () => {
    w = await makeWorld();
    root = tmp("root");
    prevRoot = process.env.MF_ENGINE_ROOT;
    process.env.MF_ENGINE_ROOT = root;
    engine = createEngine({
      store: w.store,
      gateway: w.gw,
      config: () => w.config,
      log: (l) => w.log.push(l),
      writers: writerOf,
      now: () => w.now(),
      sleep: (_ms, signal) => new Promise((resolve, reject) => (signal.aborted ? reject(new Error("aborted")) : setImmediate(resolve))),
      sweepMs: 0,
      projectFolder: (ws, id, o) => projectWorkspace(root, ws, id, o),
    });
    setAiRunner(async (r) => {
      prompts.push(r);
      return { questions: [{ question: "Who approves the first order of a new customer?", source: "", forApprover: false }] };
    });
  });
  afterAll(() => {
    setAiRunner(null);
    engine?.stop();
    if (prevRoot === undefined) delete process.env.MF_ENGINE_ROOT;
    else process.env.MF_ENGINE_ROOT = prevRoot;
    w?.close();
  });

  it("keeps each job's folder, context, ledger, prompt, MCP config and outputs to its own project", async () => {
    const projects = w.rows("Project").filter((p) => s(p.Name) && w.rows("DocNote", s(p.ItemId)).some((n) => s(n.BodyMd).trim()));
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [projects[0]!, projects.find((p) => s(p.Name) !== s(projects[0]!.Name))!];
    const ids = [a, b].map((p) => ({ pid: s(p.ItemId), ws: s(p.WorkspaceId), name: s(p.Name) }));
    const jobs: string[] = [];
    for (const p of [a, b]) jobs.push(await w.queue({ project: s(p.Name), kind: "sanitization.assist", input: { projectId: s(p.ItemId), focus: "clarifications" }, key: `iso-${s(p.ItemId)}` }));
    for (let i = 0; i < 80; i++) {
      engine.tick();
      await engine.idle();
      if (!w.store.rows("EngineJob").some((j) => ["queued", "claimed", "running"].includes(String(j.Status)))) break;
    }
    expect(jobs.map((id) => w.get("EngineJob", id).Status)).toEqual(["succeeded", "succeeded"]);

    for (const [i, me] of ids.entries()) {
      const other = ids[1 - i]!;
      const dir = path.join(root, "projects", me.ws, me.pid);
      // the job's own folder is under its project, and only its own job is there
      expect(fs.existsSync(path.join(dir, "jobs", `${jobs[i]}-1`, "job.json"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "jobs", `${jobs[1 - i]}-1`))).toBe(false);
      // no file of this project names the other project, its job or its name (context, ledger, job records, outputs)
      await writeProjectOutputs(dir);
      for (const rel of filesUnder(dir)) {
        const text = fs.readFileSync(path.join(dir, rel), "utf8");
        expect(text.includes(other.pid), `${rel} names the other project`).toBe(false);
        expect(text.includes(jobs[1 - i]!), `${rel} names the other project's job`).toBe(false);
        if (other.name.length > 6 && !me.name.includes(other.name)) expect(text.includes(other.name), `${rel} names ${other.name}`).toBe(false);
      }
      // the outputs index is this project's
      const m = readManifest(path.join(dir, "artifacts"))!;
      expect(m.projectId).toBe(me.pid);
      expect(m.workspaceId).toBe(me.ws);
      // the MCP config of a build: this project's knowledge base only, by argument and by environment
      const cfg = JSON.parse(fs.readFileSync(mcpConfigFor(me.ws, me.pid), "utf8"));
      const srv = cfg.mcpServers[MCP_SERVER_NAME];
      const kb = path.join(root, "projects", me.ws, me.pid, "artifacts", "brief");
      expect(Object.keys(cfg.mcpServers)).toEqual([MCP_SERVER_NAME]);
      expect(srv.args).toEqual([BRIEF_SERVER, "--project", me.pid, "--kb-dir", kb]);
      expect(srv.env).toEqual({ MADP_KB_DIR: kb });
      expect(JSON.stringify(cfg)).not.toContain(other.pid);
    }
    // each prompt was about one project only
    const aboutA = prompts.filter((p) => p.prompt.includes(ids[0]!.name));
    const aboutB = prompts.filter((p) => p.prompt.includes(ids[1]!.name));
    expect(aboutA.length).toBeGreaterThan(0);
    expect(aboutB.length).toBeGreaterThan(0);
    for (const p of aboutA) if (!ids[0]!.name.includes(ids[1]!.name)) expect(p.prompt.includes(ids[1]!.name)).toBe(false);
  });

  it("the project-brief MCP server never reads another project's knowledge base", async () => {
    const ws = "ws-iso";
    const kbA = path.join(root, "projects", ws, "proj-a", "artifacts", "brief");
    const kbB = path.join(root, "projects", ws, "proj-b", "artifacts", "brief");
    for (const kb of [kbA, kbB]) fs.mkdirSync(path.join(kb, "sources", "file-1"), { recursive: true });
    fs.writeFileSync(path.join(kbB, "sources", "file-1", "extraction.json"), JSON.stringify({ secret: "B's material" }));
    fs.writeFileSync(path.join(kbB, "sources", "file-1", "full-text.md"), "B's material");
    fs.writeFileSync(path.join(kbA, "sources", "file-1", "extraction.json"), JSON.stringify({ own: "A's material" }));
    const own = await mcpCall(kbA, "proj-a", "get_source_extraction", { sourceId: "file-1" });
    expect(own.text).toContain("A's material");
    for (const sourceId of ["../../../proj-b/artifacts/brief/sources/file-1", "..", `${kbB}/sources/file-1`, "file-1/../../../../proj-b/artifacts/brief/sources/file-1"]) {
      for (const tool of ["get_source_extraction", "get_extracted_text"]) {
        const r = await mcpCall(kbA, "proj-a", tool, { sourceId });
        expect(r.text).not.toContain("B's material");
        expect(r.isError).toBe(true);
      }
    }
  });

  it("refuses a folder to a job whose workspace is not its project's", () => {
    const p = w.rows("Project")[0]!;
    const deps = { store: w.store, gateway: w.gw, config: () => w.config, now: () => w.now(), log: () => undefined, sleep: async () => undefined, projectFolder: (wsId: string, id: string) => projectWorkspace(root, wsId, id) } as unknown as RunDeps;
    const job = { ItemId: "job-x", Kind: "chat.reply", ProjectId: s(p.ItemId), WorkspaceId: "another-workspace", Attempts: 1, Status: "running" };
    const run = new JobRun(deps, job, new AbortController().signal);
    expect(() => run.folder()).toThrow(/workspace/);
    const ok = new JobRun(deps, { ...job, WorkspaceId: s(p.WorkspaceId) }, new AbortController().signal);
    expect(ok.folder().dir).toBe(path.join(root, "projects", s(p.WorkspaceId), s(p.ItemId)));
  });

  it("serves only files the index lists, from inside the project's artifacts", () => {
    const dir = tmp("serve");
    fs.writeFileSync(path.join(dir, "outputs.json"), JSON.stringify({ projectId: "p", generated: ["README.md"], sections: [{ items: [{ path: "specs/M01-x/TEST-X-M01-v1.yaml" }] }] }));
    const m = readManifest(dir)!;
    expect(listedFile(dir, m, "README.md")).toBe(path.join(dir, "README.md"));
    expect(listedFile(dir, m, "specs/M01-x/TEST-X-M01-v1.yaml")).toBe(path.join(dir, "specs", "M01-x", "TEST-X-M01-v1.yaml"));
    for (const bad of ["../project.json", "/etc/passwd", "brief/context.json", "specs/../../x", ""]) expect(listedFile(dir, m, bad)).toBeNull();
  });

  it("writes YAML the official artifacts can be read from", () => {
    const y = toYaml({ id: "REVIEW-X-M01-v1", decision: "PASS", version: "0.1.0", "send-back-items": [], findings: [{ severity: "LOW", file: "src/a.tsx:3", finding: "A note: TODO later" }], ok: true, n: 3 });
    expect(y).toContain("id: REVIEW-X-M01-v1\n");
    expect(y).toContain('version: "0.1.0"\n');
    expect(y).toContain("send-back-items: []\n");
    expect(y).toContain("  - severity: LOW\n    file: \"src/a.tsx:3\"\n");
  });
});

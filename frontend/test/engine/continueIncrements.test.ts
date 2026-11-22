// "Continue with the next increment when the checks pass" (src/domain/continueIncrements.ts) on the engine's job runner,
// with the real change.build writer (kinds/delivery.ts) and a fake official engine (a Python script as its python):
//   - on: increment 1 of a feature passes its checks on development, and increment 2 of the same change is asked for
//     by itself (a queued build, the same stream rules) and built; the first build's line says so;
//   - never when the checks failed, never when the setting is off, never for a change a person paused (they cancelled
//     an increment that started by itself), never past the last increment.
// No Blocks call, no AI; the product's set-up (ensureApp) is the only part stubbed.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/continueIncrements.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { resetMergeQueues } from "../../server/local/engine/streams.ts";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { isContinued, serializeContinueSetting } from "../../src/domain/continueIncrements";
import { makeWorld, type World } from "./harness";

const host = vi.hoisted(() => ({ app: null as OfficialApp | null }));
vi.mock("../../server/local/engine/official/app.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/local/engine/official/app.ts")>()),
  ensureApp: async () => {
    if (!host.app) throw new Error("no product");
    return host.app;
  },
}));

const PROJECT = "Service Technician Portal";
const s = (v: unknown) => (typeof v === "string" ? v : "");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

/** The official engine: a work lane commits one file for the change its work's first line names; `accept` answers
 *  FAKE_ACCEPT[<change>] (0 when not named). Every lane call is logged. */
const FAKE = String.raw`#!/usr/bin/env python3
import glob, json, os, re, subprocess, sys, time
args = sys.argv[4:]
def opt(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]
state = os.environ["FAKE_STATE"]
def g(repo, *a):
    return subprocess.run(["git", "-c", "user.name=Lane", "-c", "user.email=lane@example.invalid", *a], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
if args[0] in ("quick", "feature"):
    desc = open((opt("--task-file") or opt("--description-file"))[0], encoding="utf-8").read()
    code = re.search(r"\b(CR-\d+)", desc.splitlines()[0]).group(1)
    inc = re.search(r"increment (\d+) of", desc.splitlines()[0])
    with open(os.path.join(state, "calls.jsonl"), "a", encoding="utf-8") as out:
        out.write(json.dumps({"code": code, "increment": inc.group(1) if inc else "", "lane": args[0]}) + "\n")
    repo = os.environ["FAKE_REPO_API"]
    rel = "src/%s-%d.ts" % (code.lower(), int(time.time() * 1000000))
    open(os.path.join(repo, rel), "w").write("export const x = 1;\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-q", "-m", "feat: " + code.lower())
    sha = g(repo, "rev-parse", "HEAD")
    open(os.path.join(state, "commit-" + sha), "w").write(code)
    sys.stderr.write("▸ commit[api]: %s (1.0s)\n" % sha[:9])
    sys.exit(0)
commit = opt("--commit")[0]
code = next(open(f).read() for f in glob.glob(os.path.join(state, "commit-*")) if os.path.basename(f)[7:].startswith(commit[:7]))
exit_code = json.loads(os.environ.get("FAKE_ACCEPT", "{}")).get(code, 0)
report_dir = opt("--report-dir")[0]
os.makedirs(report_dir, exist_ok=True)
stamp = "%d" % (time.time() * 1000000)
result = os.path.join(report_dir, stamp + "-dev.json")
repo = opt("--repo")[0]
checks = [{"file": "test/live/a.live.mjs", "verdict": "failed", "reason": "not ok 1 - wrong", "why": "the change's own test", "limit": ""}] if exit_code else []
json.dump({"schema": "madp-accept-result/1", "exit": exit_code, "repos": [{"repo": repo, "status": "failed" if exit_code else "ok", "fixtures": "ready (1.0s)", "unjudged": "",
           "files": [{"file": "test/live/a.live.mjs", "verdict": "failed" if exit_code else "ok", "why": "the change's own test"}], "not_run": [], "checks": checks}]}, open(result, "w", encoding="utf-8"))
open(os.path.join(report_dir, stamp + "-dev.md"), "w", encoding="utf-8").write("# Acceptance\n")
print("result   " + result)
sys.stderr.write("▸ accept[%s]: %s (2.0s)\n" % (repo, "FAILED: 1 of 1 file(s)" if exit_code else "ok: 1 file(s) passed"))
sys.exit(exit_code)
`;

/** A feature on the existing product in two increments, one ticket each. */
const FEATURE = (title: string) => serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "feature", route: "feature", summary: `${title} for the office.`, impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: true, conflicts: [], risks: [], acceptanceCriteria: ["It works on dev."],
  tickets: [{ title: `${title}: records`, description: "Store them.", increment: 1 }, { title: `${title}: page`, description: "Show them.", increment: 2 }],
  feature: { basis: "existing-product", increments: [{ title: "Records", goal: "Stored." }, { title: "Page", goal: "Shown." }], parts: { api: true, web: false, data: false } },
  estimate: { tickets: 2 }, questions: [], contextVersion: null, codeAreas: ["api: src/"],
})!);

describe("the next increment starts by itself when the checks pass", () => {
  let w: World;
  let pid = "";
  let root = "";
  let state = "";
  const env: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => {
    if (!(k in env)) env[k] = process.env[k];
    process.env[k] = v;
  };

  beforeAll(async () => {
    w = await makeWorld();
    pid = s(w.project(PROJECT).ItemId);
    for (const f of w.rows("Feature", pid)) await w.gw.update("Feature", s(f.ItemId), { IsDeleted: true });
    await w.settle();
    // the seeded project's own builds have ended
    for (const j of w.rows("EngineJob", pid).filter((x) => ["queued", "claimed", "running"].includes(s(x.Status)))) {
      await w.gw.update("EngineJob", s(j.ItemId), { Status: "succeeded", FinishedAt: "2026-11-09T09:00:00.000Z" });
    }
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-continue-"));
    const dir = path.join(root, "madp");
    const api = path.join(dir, "portal-api");
    fs.mkdirSync(path.join(api, "src"), { recursive: true });
    git(api, "init", "-q", "-b", "dev");
    fs.writeFileSync(path.join(api, "README.md"), "Portal\n");
    git(api, "add", "-A");
    git(api, "commit", "-q", "-m", "first");
    const registry = path.join(dir, "portal.yml");
    fs.writeFileSync(registry, [
      "project: portal", "default_env: dev", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`,
      "repos:", "  api:", `    path: ${api}`, "    repo: example-org/portal-api", "    role: api",
      "    acceptance:", "      envs: [dev]", "      tests:", '        argv: [node, "--test", "{file}"]', '        files: ["test/live/*.mjs"]', "",
    ].join("\n"));
    host.app = { name: "portal", dir, registry, org: "example-org", repos: { api }, tenant: "", url: "https://portal.example.test" };
    const home = path.join(root, "engine");
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(cli, "project.py"), "");
    fs.writeFileSync(path.join(cli, "accept.py"), 'p.add_argument("--also", action="append")\n');
    for (const f of ["quick.py", "feature.py"]) fs.writeFileSync(path.join(cli, f), ['"--no-accept"', '"--change-record"'].map((x) => `p.add_argument(${x})`).join("\n"));
    const py = path.join(root, "fake-python.py");
    fs.writeFileSync(py, FAKE, { mode: 0o755 });
    state = path.join(root, "state");
    fs.mkdirSync(state);
    setEnv("MF_MADP_ENGINE_HOME", home);
    setEnv("MF_MADP_PYTHON", py);
    setEnv("FAKE_STATE", state);
    setEnv("FAKE_REPO_API", api);
    setEnv("MF_ENGINE_BUILD", "claude");
    // a failing check is a person's decision here: no automatic fix round or revert
    await w.gw.update("Project", pid, { ChecksPolicy: JSON.stringify({ v: 1, autoFixRounds: 0, autoRevert: false }) });
  });

  afterAll(async () => {
    resetMergeQueues();
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await w?.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  let number = 300;
  async function feature(title: string): Promise<{ id: string; code: string }> {
    const p = w.project(PROJECT);
    number += 1;
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: number, Lane: "add", FeatureRef: "", Title: title, Description: `${title}.`, Status: "approved", Version: `3.${number}.0`,
      RequestedByUserId: p.CreatedByUserId, EngineJobId: "", Analysis: FEATURE(title), DecidedAt: "2026-11-09T10:00:00.000Z",
      DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true, RequestKey: `t:cont:${number}`,
    });
    return { id: res.itemId!, code: `CR-${String(number).padStart(3, "0")}` };
  }
  const builds = (crId: string) => w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && JSON.parse(s(j.InputJson)).changeRequestId === crId)
    .sort((a, b) => s(a.CreatedDate).localeCompare(s(b.CreatedDate)) || s(a.ItemId).localeCompare(s(b.ItemId)));
  const why = (crId: string) => builds(crId).map((j) => `${s(j.Status)}: ${s(j.Message)} ${s(j.ErrorCode)}`).join("\n") + `\n${w.log.slice(-12).join("\n")}`;
  const setting = (on: boolean) => w.gw.update("Project", pid, { ContinueIncrements: serializeContinueSetting({ v: 1, on, by: "u-owner", at: "2026-11-09T10:00:00.000Z" }) });
  const start = (cr: { id: string; code: string }) =>
    w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: cr.id, version: `3.${cr.code.slice(3)}.0` }, target: { type: "ChangeRequest", id: cr.id }, key: `start-${cr.code}` });

  it("on: increment 1 passes its checks, increment 2 is asked for by itself and built; never past the last one", async () => {
    await setting(true);
    const cr = await feature("Recurring invoices");
    const first = await start(cr);
    await w.settle(200);
    const jobs = builds(cr.id);
    expect(jobs.map((j) => s(j.Status)), why(cr.id)).toEqual(["succeeded", "succeeded"]);
    const [one, two] = jobs;
    expect(s(one!.ItemId)).toBe(first);
    expect(s(one!.Message)).toContain("increment 2 of 2 starts by itself next (cancel it to pause this change)");
    expect(isContinued({ kind: "change.build", inputJson: s(two!.InputJson) })).toBe(true);
    expect(JSON.parse(s(two!.InputJson))).toMatchObject({ changeRequestId: cr.id, continued: true, afterJobId: first });
    // the last increment: released, nothing more asked for
    expect(s(two!.Message)).toContain(`${cr.code} released to dev`);
    expect(w.get("ChangeRequest", cr.id).Status).toBe("released-dev");
    const calls = fs.readFileSync(path.join(state, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { code: string; increment: string });
    expect(calls.filter((c) => c.code === cr.code).map((c) => c.increment)).toEqual(["1", "2"]);
  });

  it("never when the checks failed, never when it is off, never for a change a person paused", async () => {
    // the checks fail: on dev but not usable, a person decides
    await setting(true);
    const red = await feature("Late fees");
    setEnv("FAKE_ACCEPT", JSON.stringify({ [red.code]: 12 }));
    await start(red);
    await w.settle(200);
    expect(builds(red.id).map((j) => s(j.Status)), why(red.id)).toEqual(["succeeded"]);
    expect(s(builds(red.id)[0]!.Message)).toContain("but not usable yet");
    setEnv("FAKE_ACCEPT", "{}");

    // off: increment 1 is on dev for people to try; its next one waits for them
    await setting(false);
    const off = await feature("Price lists");
    await start(off);
    await w.settle(200);
    expect(builds(off.id).map((j) => s(j.Status)), why(off.id)).toEqual(["succeeded"]);
    expect(s(builds(off.id)[0]!.Message)).toContain("then start increment 2");

    // paused: a person cancelled an increment of this change that had started by itself
    await setting(true);
    const paused = await feature("Credit notes");
    const p = w.project(PROJECT);
    await w.gw.insert("EngineJob", {
      ProjectId: pid, Kind: "change.build", Status: "cancelled", Progress: 0, Attempts: 0, Message: "", ActiveKey: "cancelled-continue",
      InputJson: JSON.stringify({ projectId: pid, changeRequestId: paused.id, version: "3.9.9", continued: true, afterJobId: "earlier" }),
      RequestedByUserId: p.CreatedByUserId, WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      FinishedAt: "2026-11-09T09:30:00.000Z", RequestKey: "t:paused",
    });
    await start(paused);
    await w.settle(200);
    const ran = builds(paused.id).filter((j) => s(j.Status) !== "cancelled");
    expect(ran.map((j) => s(j.Status)), why(paused.id)).toEqual(["succeeded"]);
    expect(s(ran[0]!.Message)).toContain("then start increment 2");
    expect(w.log.some((l) => l.includes("a person paused this change"))).toBe(true);
  });

  it("the tech lead's chat sets it: \"continue with the next increment automatically\" answers with the offer", async () => {
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev")).toBe(true);
    await setting(false);
    const p = w.project(PROJECT);
    const msg = await w.gw.insert("AgentChatMessage", {
      ProjectId: pid, AgentRole: "dev", Role: "user", Kind: "text", AuthorUserId: s(p.CreatedByUserId), Text: "Please continue with the next increment automatically",
      At: w.now().toISOString(), WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId, RequestKey: "t:msg:cont",
    });
    const job = await w.queue({ project: PROJECT, kind: "chat.reply", input: { projectId: pid, thread: "agent", threadId: "dev", messageId: msg.itemId }, target: { type: "agent-chat", id: msg.itemId! }, key: "chat-cont" });
    await w.settle();
    const rows = w.rows("AgentChatMessage", pid).filter((m) => m.EngineJobId === job && m.Role === "agent").sort((a, b) => s(a.At).localeCompare(s(b.At)));
    expect(s(rows[0]!.Text)).toMatch(/^Good idea: once an increment of a feature passes its checks on development, I start the next one/);
    expect(s(rows[0]!.Text)).toContain("Tap “Change the setting”");
    expect(rows[1]).toMatchObject({ TaskTarget: "offer:continue-increments", TaskFeatureRef: "on", TaskTitle: "Continue with the next increment when the checks pass" });
  });
});

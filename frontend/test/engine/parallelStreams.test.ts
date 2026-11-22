// Parallel streams on the engine's job runner (src/domain/parallelStreams.ts, server/local/engine/streams.ts), with the
// real change.build writer (kinds/delivery.ts) and a fake official engine (a Python script as its python):
//   - two independent approved change requests build at once (their lanes develop side by side, each with
//     `--isolate --merge-turn`), a third whose analysis touches the code of one of them waits, with its line saying so,
//     and starts once that one is done;
//   - the merge queue: the lanes' merges, deploys and the checks after them never overlap (one build at a time lands on
//     the shared development environment), whatever order the streams finish in;
//   - a stream that cannot merge cleanly hands the turn on at once and is built again on the latest branch, never
//     forced in; a stream whose checks turn red does not hold up the green ones;
//   - with one stream (no choice), everything runs one at a time in the main working tree, as before.
// No Blocks call, no AI; the product's set-up (ensureApp) is the only part stubbed.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/parallelStreams.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { READING_WORDS, adviceOf, changeLoader, holdBack, inMergeTurn, lastLandedOf, mergeQueueOf, mergeTurn, missingChanges, ordinal, readyWords, resetMergeQueues, storePlan } from "../../server/local/engine/streams.ts";
import { mergeFailureOf } from "../../server/local/engine/official/build.ts";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { parseStreamsAdvice, serializeStreamsChoice } from "../../src/domain/parallelStreams";
import { toAgentChat } from "../../src/blocks/collab/records";
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

/** The official engine as a Python script, keyed by the change in the work's first line. A work lane "develops" until
 *  the test opens its gate (FAKE_GATE/go-<code>; no gate set: at once); with --merge-turn it then asks for its turn (the
 *  lane's own step line) and waits for "go"; it merges (commits) or, when its script entry says so, fails at integrate
 *  with a conflict. `accept` answers the entry of the change whose commit it checks. Every phase is appended to one
 *  events file: the order of its lines is the order things happened (no clock is compared, nothing sleeps). */
const FAKE = String.raw`#!/usr/bin/env python3
import glob, json, os, re, subprocess, sys, time
args = sys.argv[4:]  # -B -m MADP.orchestrator.cli.project <lane> ...
def opt(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]
state = os.environ["FAKE_STATE"]
def log(event, code, **more):
    with open(os.path.join(state, "events.jsonl"), "a", encoding="utf-8") as out:
        out.write(json.dumps({"event": event, "code": code, "t": time.time(), **more}) + "\n")
script = json.load(open(os.environ["FAKE_SCRIPT"], encoding="utf-8"))
def g(repo, *a):
    return subprocess.run(["git", "-c", "user.name=Lane", "-c", "user.email=lane@example.invalid", *a], cwd=repo,
                          check=True, capture_output=True, text=True).stdout.strip()
if args[0] in ("quick", "feature"):
    desc = open((opt("--task-file") or opt("--description-file"))[0], encoding="utf-8").read()
    code = re.search(r"\b(CR-\d+)", desc.splitlines()[0]).group(1)
    with open(os.path.join(state, "attempts-" + code), "a") as f:
        f.write("x")
    attempt = len(open(os.path.join(state, "attempts-" + code)).read())
    entry = script["work"][code][min(attempt, len(script["work"][code])) - 1]
    with open(os.path.join(state, "calls.jsonl"), "a", encoding="utf-8") as out:
        out.write(json.dumps({"code": code, "attempt": attempt, "args": args}) + "\n")
    log("dev-start", code, attempt=attempt)
    gate = os.environ.get("FAKE_GATE", "")
    if gate:
        deadline = time.time() + 120
        while not os.path.exists(os.path.join(gate, "go-" + code)) and time.time() < deadline:
            time.sleep(0.005)
    log("dev-end", code, attempt=attempt)
    turn = opt("--merge-turn")
    if turn:
        sys.stderr.write("▸ merge-turn: waiting for the turn to merge (0.0s)\n")
        sys.stderr.flush()
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                if open(turn[0]).read().strip().lower().startswith("go"):
                    break
            except OSError:
                pass
            time.sleep(0.005)
        else:
            sys.stderr.write("✗ merge_turn_timeout: no turn\n")
            sys.exit(3)
        sys.stderr.write("▸ merge-turn: granted after 1s (1.0s)\n")
    log("merge-start", code, attempt=attempt)
    if gate and os.environ.get("FAKE_LAND_GATE"):
        deadline = time.time() + 120
        while not os.path.exists(os.path.join(gate, "land-" + code)) and time.time() < deadline:
            time.sleep(0.005)
    if entry.get("conflict"):
        log("merge-end", code, attempt=attempt, conflict=True)
        sys.stderr.write("▸ integrate: FAILED (integrate_conflict): rebased onto abc123456, conflicts ['src/x.ts'] NOT resolved (1.0s)\n")
        sys.stderr.write("✗ integrate_conflict: still conflicted after the fix-up\n")
        sys.exit(7)
    for key, change in entry["repos"].items():
        repo = os.environ["FAKE_REPO_" + key.upper()]
        for rel, body in change.items():
            p = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").write(body)
        g(repo, "add", "-A")
        g(repo, "commit", "-q", "-m", "feat: " + code.lower())
        sha = g(repo, "rev-parse", "HEAD")
        open(os.path.join(state, "commit-" + sha), "w").write(code)
        sys.stderr.write("▸ commit[%s]: %s (1.0s)\n" % (key, sha[:9]))
    log("merge-end", code, attempt=attempt)
    sys.exit(0)
# accept: the change whose commit it checks
commit = opt("--commit")[0]
code = next(open(f).read() for f in glob.glob(os.path.join(state, "commit-*")) if os.path.basename(f)[7:].startswith(commit[:7]))
entry = script["accept"][code]
log("accept-start", code)

report_dir = opt("--report-dir")[0]
os.makedirs(report_dir, exist_ok=True)
stamp = "%d" % (time.time() * 1000000)
result = os.path.join(report_dir, stamp + "-dev.json")
repo = opt("--repo")[0]
checks = [{"file": "test/live/a.live.mjs", "verdict": "failed", "reason": "not ok 1 - the total is wrong", "why": "the change's own test", "limit": ""}] if entry["exit"] else []
json.dump({"schema": "madp-accept-result/1", "exit": entry["exit"], "repos": [{"repo": repo, "status": "failed" if entry["exit"] else "ok", "fixtures": "ready (1.0s)", "unjudged": "",
           "files": [{"file": "test/live/a.live.mjs", "verdict": "failed" if entry["exit"] else "ok", "why": "the change's own test"}], "not_run": [], "checks": checks}]}, open(result, "w", encoding="utf-8"))
open(os.path.join(report_dir, stamp + "-dev.md"), "w", encoding="utf-8").write("# Acceptance\n")
print("result   " + result)
sys.stderr.write("▸ accept[%s]: %s (2.0s)\n" % (repo, "FAILED: 1 of 1 file(s)" if entry["exit"] else "ok: 1 file(s) passed"))
log("accept-end", code)
sys.exit(entry["exit"])
`;

const analysisOf = (codeAreas: string[]) => serializeChangeAnalysis(parseChangeAnalysis({
  v: 1, kind: "change", route: "fast", summary: "A change to what is there.", impact: { features: [], stories: [], screens: [], milestones: [] },
  scopeChange: false, conflicts: [], risks: [], acceptanceCriteria: ["It works on dev."], tickets: [{ title: "The change", description: "Make it so." }],
  estimate: { tickets: 1 }, questions: [], contextVersion: null, codeAreas,
})!);

interface Ev { event: string; code: string; t: number; attempt?: number; conflict?: boolean }

describe("parallel streams on the engine's job runner", () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-streams-"));
    const dir = path.join(root, "madp");
    const repos: Record<string, string> = {};
    for (const key of ["api", "web"]) {
      const r = path.join(dir, `portal-${key}`);
      fs.mkdirSync(r, { recursive: true });
      git(r, "init", "-q", "-b", "dev");
      fs.writeFileSync(path.join(r, "README.md"), "Portal\n");
      git(r, "add", "-A");
      git(r, "commit", "-q", "-m", "first");
      repos[key] = r;
    }
    const registry = path.join(dir, "portal.yml");
    fs.writeFileSync(registry, [
      "project: portal", "default_env: dev", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`,
      "repos:",
      ...["api", "web"].flatMap((key) => [
        `  ${key}:`, `    path: ${repos[key]}`, `    repo: example-org/portal-${key}`, `    role: ${key}`,
        "    acceptance:", "      envs: [dev]", "      tests:", '        argv: [node, "--test", "{file}"]', '        files: ["test/live/*.mjs"]',
      ]), "",
    ].join("\n"));
    host.app = { name: "portal", dir, registry, org: "example-org", repos, tenant: "", url: "https://portal.example.test" };

    const home = path.join(root, "engine");
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(cli, "project.py"), "");
    fs.writeFileSync(path.join(cli, "accept.py"), 'p.add_argument("--also", action="append")\n');
    for (const f of ["quick.py", "feature.py"]) {
      fs.writeFileSync(path.join(cli, f), ['"--no-accept"', '"--change-record"', '"--live-check"', '"--failed-checks"', '"--fix-round"', '"--merge-turn"'].map((x) => `p.add_argument(${x})`).join("\n"));
    }
    const py = path.join(root, "fake-python.py");
    fs.writeFileSync(py, FAKE, { mode: 0o755 });
    state = path.join(root, "state");
    fs.mkdirSync(state);
    setEnv("MF_MADP_ENGINE_HOME", home);
    setEnv("MF_MADP_PYTHON", py);
    setEnv("FAKE_STATE", state);
    setEnv("FAKE_REPO_API", repos.api!);
    setEnv("FAKE_REPO_WEB", repos.web!);
    setEnv("MF_ENGINE_BUILD", "claude");
    // what happens when a change's checks fail is a person's decision here: no automatic fix round or revert
    await w.gw.update("Project", pid, { ChecksPolicy: JSON.stringify({ v: 1, autoFixRounds: 0, autoRevert: false }) });
  });

  afterEach(() => resetMergeQueues());

  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await w?.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  let number = 100;
  async function change(title: string, codeAreas: string[]): Promise<{ id: string; code: string }> {
    const p = w.project(PROJECT);
    number += 1;
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: number, Lane: "change", FeatureRef: "", Title: title, Description: `${title}.`, Status: "approved", Version: "",
      RequestedByUserId: p.CreatedByUserId, EngineJobId: "", Analysis: analysisOf(codeAreas), DecidedAt: "2026-11-09T10:00:00.000Z",
      DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true, RequestKey: `t:cr:${number}`,
    });
    return { id: res.itemId!, code: `CR-${String(number).padStart(3, "0")}` };
  }
  // asked for one after the other (the queue keeps the order they were asked in)
  const build = async (cr: { id: string }, key: string) => {
    await new Promise((r) => setTimeout(r, 15));
    return w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: cr.id }, target: { type: "ChangeRequest", id: cr.id }, key });
  };
  /** The events in the order they happened (the line order of the one events file; index = position). */
  const events = (): (Ev & { i: number })[] => {
    const file = path.join(state, "events.jsonl");
    return (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").split("\n").filter(Boolean).map((l, i) => ({ ...(JSON.parse(l) as Ev), i }));
  };
  const why = () => w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build").map((j) => `${s(j.Status)}: ${s(j.Message)} ${s(j.ErrorCode)}`).join("\n") + `\n${w.log.slice(-20).join("\n")}`;
  /** Each change's window on the shared environment, as positions in the events: from its merge to the end of its checks
   *  (or of its failed merge). */
  const windows = (evs: (Ev & { i: number })[]) => evs.filter((x) => x.event === "merge-start").map((e) => {
    const end = evs.find((x) => x.code === e.code && x.i > e.i && (x.event === "accept-end" || (x.event === "merge-end" && x.conflict)));
    return { code: e.code, from: e.i, to: end?.i ?? e.i };
  });
  /** Awaits a condition on what the lanes logged (each lane is a real process; nothing here waits on a clock). */
  const until = async (what: string, ok: () => boolean): Promise<void> => {
    for (let i = 0; i < 6000 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(ok(), `${what}\n${why()}`).toBe(true);
  };
  const gate = () => path.join(state, "gate");
  const open = (code: string) => fs.writeFileSync(path.join(gate(), `go-${code}`), "");

  it("overlapping changes develop at once; they land one at a time in the order they finish; a conflict is built again", async () => {
    await w.gw.update("Project", pid, { ParallelStreams: serializeStreamsChoice({ v: 1, chosen: 3, suggested: 3, reason: "", by: "u", at: "2026-11-09T10:00:00.000Z" }) });
    const invoices = await change("Invoice totals", ["api: src/invoices/"]);
    const profile = await change("Profile photo", ["web: src/profile/"]);
    const exportCsv = await change("Invoice export", ["api: src/invoices/export.ts"]);
    fs.writeFileSync(path.join(root, "script.json"), JSON.stringify({
      work: {
        [invoices.code]: [{ repos: { api: { "src/invoices/total.ts": "export const total = 1;\n" } } }],
        // its first landing cannot be merged in place (the engine's own resolution failed): built again on the latest
        // branch, then it lands
        [profile.code]: [{ conflict: true }, { repos: { web: { "src/profile/photo.tsx": "export const Photo = 1;\n" } } }],
        [exportCsv.code]: [{ repos: { api: { "src/invoices/export.ts": "export const csv = 1;\n" } } }],
      },
      // the invoice totals' own checks fail on dev: red, a person decides; the others pass
      accept: { [invoices.code]: { exit: 12 }, [profile.code]: { exit: 0 }, [exportCsv.code]: { exit: 0 } },
    }));
    setEnv("FAKE_SCRIPT", path.join(root, "script.json"));
    // every lane develops until the test opens its gate, and lands (after its turn) until it opens its landing gate
    fs.mkdirSync(gate(), { recursive: true });
    setEnv("FAKE_GATE", gate());
    setEnv("FAKE_LAND_GATE", "1");
    const a = await build(invoices, "s-a");
    const b = await build(profile, "s-b");
    const c = await build(exportCsv, "s-c");

    // 1. optimistic parallel development: nothing holds the start, the overlapping one included; it is told it will
    //    land after the invoice totals, rebased and checked again
    for (const id of [a, b, c]) expect(holdBack(w.store, w.get("EngineJob", id))).toBeNull();
    w.engine.tick();
    const devStarted = (code: string) => events().some((e) => e.code === code && e.event === "dev-start");
    await until("all three develop at the same time", () => [invoices, profile, exportCsv].every((x) => devStarted(x.code)));
    expect(events().some((e) => e.event === "merge-start")).toBe(false);
    const plan = storePlan(w.store, pid);
    expect(plan.running.find((r) => r.code === exportCsv.code)?.note).toBe(`Developing in parallel; lands after ${invoices.code} (both change api: src/invoices/export.ts — will be rebased and checked again).`);

    // 2. landing order = finish order: the export finishes first and lands first, although it overlaps and was asked
    //    for last; the invoice totals finish next and wait, second in line, with that line on their job
    open(exportCsv.code);
    await until("the export lands first", () => events().some((e) => e.code === exportCsv.code && e.event === "merge-start"));
    open(invoices.code);
    await until("the invoice totals wait for their turn", () => s(w.get("EngineJob", a).Message) === "Ready, waits for its turn to land (2nd in line).");
    expect(mergeQueueOf(pid)).toEqual({ holder: c, waiting: [a] });
    open(profile.code);
    await until("the profile photo waits too", () => s(w.get("EngineJob", b).Message) === "Ready, waits for its turn to land (3rd in line).");
    // the line moves up as the export lands
    fs.writeFileSync(path.join(gate(), `land-${exportCsv.code}`), "");
    await until("the invoice totals land next", () => events().some((e) => e.code === invoices.code && e.event === "merge-start"));
    await until("the profile photo moved up", () => s(w.get("EngineJob", b).Message) === "Ready, waits for its turn to land (2nd in line).");
    for (const code of [invoices.code, profile.code]) fs.writeFileSync(path.join(gate(), `land-${code}`), "");
    await w.settle(200);

    const jobs = [a, b, c].map((id) => w.get("EngineJob", id));
    expect(jobs.map((j) => s(j.Status)), why()).toEqual(["succeeded", "succeeded", "succeeded"]);
    // red: on dev but not usable; green ones released
    expect(s(jobs[0]!.Message)).toContain("but not usable yet");
    expect(s(jobs[1]!.Message)).toContain(`${profile.code} released to dev`);
    expect(s(jobs[2]!.Message)).toContain(`${exportCsv.code} released to dev`);

    const evs = events();
    // 3. the merge queue: no two changes on the shared environment at once (merge, deploy, checks), in finish order
    const win = windows(evs).sort((x, y) => x.from - y.from);
    expect(win.map((x) => x.code), JSON.stringify(evs)).toEqual([exportCsv.code, invoices.code, profile.code, profile.code]);
    for (let i = 1; i < win.length; i += 1) expect(win[i]!.from, JSON.stringify(win)).toBeGreaterThan(win[i - 1]!.to);
    // 4. a landing that could not be merged in place went back: built again (a second lane run, its own landing after
    //    the others), never forced in
    const calls = fs.readFileSync(path.join(state, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { code: string; attempt: number; args: string[] });
    expect(calls.filter((x) => x.code === profile.code).map((x) => x.attempt)).toEqual([1, 2]);
    expect(evs.some((e) => e.code === profile.code && e.conflict)).toBe(true);
    // every stream lane ran in its own working copies with its turn file
    for (const call of calls) {
      expect(call.args).toContain("--isolate");
      expect(call.args[call.args.indexOf("--merge-turn") + 1]).toMatch(/turns[\\/][A-Za-z0-9_-]+\.turn$/);
    }
    // 5. the red one did not hold up the green ones: no fix round ran (a person decides), the profile photo landed after it
    expect(w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && /fixChecks|revertChecks/.test(s(j.InputJson)))).toEqual([]);
    expect(evs.some((e) => e.code === profile.code && e.event === "accept-end")).toBe(true);
    // the queue is empty again, no turn file left behind
    expect(mergeQueueOf(pid)).toEqual({ holder: null, waiting: [] });
    expect(fs.existsSync(path.join(host.app!.dir, "turns")) ? fs.readdirSync(path.join(host.app!.dir, "turns")) : []).toEqual([]);
    // the tech lead's advice from the product's set-up: nothing limits it here; it names the repos
    expect(parseStreamsAdvice(w.project(PROJECT).StreamsAdvice)).toMatchObject({ cap: 5, why: "", repos: 2, keys: ["api", "web"] });
    delete process.env.FAKE_GATE;
    delete process.env.FAKE_LAND_GATE;
  });

  it("with one stream, builds run one at a time in the main working tree, as before", async () => {
    delete process.env.FAKE_GATE;
    delete process.env.FAKE_LAND_GATE;
    await w.gw.update("Project", pid, { ParallelStreams: "" });
    fs.writeFileSync(path.join(state, "events.jsonl"), "");
    fs.writeFileSync(path.join(state, "calls.jsonl"), "");
    const one = await change("Label rename", ["web: src/labels/"]);
    const two = await change("Report title", ["api: src/reports/"]);
    fs.writeFileSync(path.join(root, "script.json"), JSON.stringify({
      work: {
        [one.code]: [{ repos: { web: { "src/labels/l.ts": "export const l = 1;\n" } } }],
        [two.code]: [{ repos: { api: { "src/reports/r.ts": "export const r = 1;\n" } } }],
      },
      accept: { [one.code]: { exit: 0 }, [two.code]: { exit: 0 } },
    }));
    const a = await build(one, "o-a");
    const b = await build(two, "o-b");
    expect(holdBack(w.store, w.get("EngineJob", b))).toBe("Waits for a free stream: one build at a time.");
    await w.settle(200);
    expect([a, b].map((id) => s(w.get("EngineJob", id).Status)), why()).toEqual(["succeeded", "succeeded"]);
    const evs = events();
    // the second asked for develops only after the first is merged, deployed and checked
    expect(evs.find((e) => e.code === two.code && e.event === "dev-start")!.i).toBeGreaterThan(evs.find((e) => e.code === one.code && e.event === "accept-end")!.i);
    const calls = fs.readFileSync(path.join(state, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { args: string[] });
    for (const call of calls) expect(call.args).not.toContain("--isolate");
  });
});

describe("the tech lead in the chat: \"use 4 parallel streams\"", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(async () => w?.close());

  it("answers from the records with the offer that sets it, at most the suggestion", async () => {
    const p = w.project(PROJECT);
    const pid = s(p.ItemId);
    const stamp = { WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId };
    // change requests are built here: a release on dev
    await w.gw.insert("Release", { ProjectId: pid, Environment: "dev", Version: "9.9.0", Url: "https://portal.example.test", Status: "released", ChangeRequestIds: [], ReleasedAt: w.now().toISOString(), ReleasedByUserId: s(p.CreatedByUserId), ...stamp, RequestKey: "t:rel:streams" });
    const ask = async (text: string, key: string) => {
      const msg = await w.gw.insert("AgentChatMessage", { ProjectId: pid, AgentRole: "dev", Role: "user", Kind: "text", AuthorUserId: s(p.CreatedByUserId), Text: text, At: w.now().toISOString(), ...stamp, RequestKey: `t:msg:${key}` });
      const job = await w.queue({ project: PROJECT, kind: "chat.reply", input: { projectId: pid, thread: "agent", threadId: "dev", messageId: msg.itemId }, target: { type: "agent-chat", id: msg.itemId! }, key });
      await w.settle();
      const rows = w.rows("AgentChatMessage", pid).filter((m) => m.EngineJobId === job && m.Role === "agent").sort((a, b) => s(a.At).localeCompare(s(b.At)));
      return { job: w.get("EngineJob", job), reply: rows[0]!, offer: rows[1] };
    };
    // before the build host checked the set-up: the tech lead suggests 2 at most, and offers 2
    const many = await ask("Can we use 4 parallel streams please?", "chat-4");
    expect(many.job.Status).toBe("succeeded");
    expect(s(many.reply.Text)).toMatch(/^I suggest at most 2 for Service Technician Portal right now: .*the build host has not checked the product's set-up yet, so 2 for now/);
    expect(s(many.reply.Text)).toContain("Tap “Set the parallel streams”");
    const offer = toAgentChat({ ...many.offer, ItemId: many.offer!.ItemId })!.offer!;
    expect(offer).toMatchObject({ kind: "parallel-streams", targetId: "2", title: "Use 2 parallel streams" });
    // one at a time again
    const one = await ask("set parallel streams to 1", "chat-1");
    expect(toAgentChat(one.offer)!.offer).toMatchObject({ kind: "parallel-streams", targetId: "1", title: "Build one change request at a time" });
    expect(s(one.reply.Text)).not.toMatch(/\b(AI|simulat\w*|mock\w*|demo)\b/);
  });
});

describe("the PrimaBook case on the job runner's store: CR-020 builds, CR-021 starts beside it", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(async () => w?.close());

  it("starts CR-021 (a fix naming its files in its tickets) beside CR-020 (data tables, session code), and says why", async () => {
    const p = w.project(PROJECT);
    const pid = s(p.ItemId);
    const stamp = { WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId };
    // the seeded project's own builds have ended: only the two below are on their way
    for (const j of w.rows("EngineJob", pid).filter((x) => ["change.build", "build.run"].includes(s(x.Kind)) && ["queued", "claimed", "running"].includes(s(x.Status)))) {
      await w.gw.update("EngineJob", s(j.ItemId), { Status: "succeeded", FinishedAt: "2026-11-09T09:00:00.000Z" });
    }
    const analysis = (o: { kind: string; codeAreas: string[]; summary: string; data?: boolean; tickets: { title: string; description: string }[] }) => serializeChangeAnalysis(parseChangeAnalysis({
      v: 1, kind: o.kind, route: o.kind === "feature" ? "feature" : "fast", summary: o.summary, impact: { features: [], stories: [], screens: [], milestones: [] },
      scopeChange: o.kind === "feature", conflicts: [], risks: [], acceptanceCriteria: ["Works on dev."],
      tickets: o.tickets.map((t) => ({ ...t, ...(o.kind === "feature" ? { increment: 1 } : {}) })),
      ...(o.kind === "feature" ? { feature: { basis: "existing-product", increments: [{ title: "Master data", goal: "Employees have it." }], parts: { api: true, web: true, data: !!o.data } } } : {}),
      estimate: { tickets: o.tickets.length }, questions: [], contextVersion: null, codeAreas: o.codeAreas,
    })!);
    const cr = async (n: number, title: string, a: string) => (await w.gw.insert("ChangeRequest", {
      ...stamp, ProjectId: pid, Number: n, Lane: "change", FeatureRef: "", Title: title, Description: `${title}.`, Status: "approved", Version: "",
      RequestedByUserId: p.CreatedByUserId, EngineJobId: "", Analysis: a, DecidedAt: "2026-11-09T10:00:00.000Z", DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true, RequestKey: `t:pb:${n}`,
    })).itemId!;
    const cr20 = await cr(20, "Employee master data", analysis({
      kind: "feature", data: true, summary: "Employees get master data on their Membership.", tickets: [{ title: "Master data", description: "Fields and pages." }],
      codeAreas: ["api: blocks/data/schemas/Membership.json", "api: src/rbac.ts", "api: src/session.ts", "api: src/approvals/engine.ts", "api: src/purchases/*", "web: src/pages/team/", "web: src/pages/settings/", "web: src/pages/purchases/"],
    }));
    const cr21 = await cr(21, "Project time entries round wrongly", analysis({
      kind: "fix", codeAreas: [], summary: "Time entries are rounded wrongly. Nothing else in the scope is touched.",
      tickets: [{ title: "Round project time entries to the quarter hour", description: "Fix the rounding in api/src/projects/entries.ts and cover it in api/test/projects.mjs." }],
    }));
    // the product allows 2 (PrimaBook's check limits), with its repo keys; 2 chosen
    await w.gw.update("Project", pid, {
      StreamsAdvice: JSON.stringify({ v: 1, cap: 2, why: "The development environment allows only a few check runs an hour; 2 at most.", repos: 2, keys: ["api", "web"], at: "2026-11-09T10:00:00.000Z" }),
      ParallelStreams: serializeStreamsChoice({ v: 1, chosen: 2, suggested: 2, reason: "", by: "u", at: "2026-11-09T10:00:00.000Z" }),
    });
    const job = async (crId: string, status: string, key: string) => (await w.gw.insert("EngineJob", {
      ...stamp, ProjectId: pid, Kind: "change.build", Status: status, Progress: status === "running" ? 30 : 0, Attempts: status === "running" ? 1 : 0, Message: "",
      ActiveKey: `change.build:${key}`, InputJson: JSON.stringify({ projectId: pid, changeRequestId: crId }), RequestedByUserId: p.CreatedByUserId, RequestKey: `t:pbjob:${key}`,
      ...(status === "running" ? { ClaimedAt: "2026-11-09T10:01:00.000Z", ClaimedBy: "engine" } : {}),
    })).itemId!;
    await job(cr20, "running", "20");
    const j21 = await job(cr21, "queued", "21");
    // both build at once: CR-021 shares no file and no table with CR-020
    expect(holdBack(w.store, w.get("EngineJob", j21))).toBeNull();
    // one that does touch CR-020's code waits, saying which file; the change's page and the queue show that same line
    const cr22 = await cr(22, "Session timeout", analysis({ kind: "change", codeAreas: ["api: src/session.ts"], summary: "Longer sessions.", tickets: [{ title: "Timeout", description: "Longer." }] }));
    const j22 = await job(cr22, "queued", "22");
    // sharing api: src/session.ts with CR-020 never holds its start (it would land after CR-020, rebased and checked
    // again); here the two streams are busy
    expect(holdBack(w.store, w.get("EngineJob", j22))).toBe("Waits for a free stream: all 2 are busy.");

    // the Blocks worker holds a project's change requests only once one of its jobs started: it reads the missing ones
    // first, and the job waits with a line meanwhile; once read, the same plan as above
    const missing = new Set([cr21]);
    const partial = { rows: (schema: string) => w.store.rows(schema).filter((r) => !(schema === "ChangeRequest" && missing.has(s(r.ItemId)))), get: (schema: string, id: string) => (schema === "ChangeRequest" && missing.has(id) ? undefined : w.store.get(schema, id)) };
    const reads: string[] = [];
    const ticks: number[] = [];
    let release: () => void = () => undefined;
    const load = changeLoader((id) => { reads.push(id); return new Promise<void>((r) => { release = () => { missing.delete(id); r(); }; }); }, () => ticks.push(1));
    expect(missingChanges(partial, pid)).toEqual([cr21]);
    expect(holdBack(partial, w.get("EngineJob", j21), load)).toBe(READING_WORDS);
    expect(holdBack(partial, w.get("EngineJob", j21), load)).toBe(READING_WORDS);
    expect(reads).toEqual([cr21]); // read once
    release();
    await new Promise((r) => setImmediate(r));
    expect(ticks).toEqual([1]); // the job runner looks again
    expect(holdBack(partial, w.get("EngineJob", j21), load)).toBeNull();

    // tests, the changes' records and translations merge without harm: never a reason to wait (live case: "Waits for
    // CR-018: both change api: test/rbac.mjs.")
    const cr23 = await cr(23, "Approver roles", analysis({
      kind: "change", summary: "Approvers by role.", tickets: [{ title: "Roles", description: "Roles." }],
      codeAreas: ["api: src/approvals/roles.ts", "api: test/rbac.mjs", "api: docs/changes/CR-023.md", "web: src/i18n/de.json", "web: public/locales/fr/team.json"],
    }));
    const cr24 = await cr(24, "Role list", analysis({
      kind: "change", summary: "A list of roles.", tickets: [{ title: "List", description: "List." }],
      codeAreas: ["api: src/roles/list.ts", "api: test/rbac.mjs", "api: test/roles.test.ts", "web: src/i18n/de.json"],
    }));
    // (CR-021 and the session change are out of the way: CR-020 and CR-023 run, two streams)
    for (const id of [j21, j22]) await w.gw.update("EngineJob", id, { Status: "cancelled", FinishedAt: "2026-11-09T10:02:00.000Z" });
    await w.gw.update("Project", pid, { ParallelStreams: serializeStreamsChoice({ v: 1, chosen: 3, suggested: 3, reason: "", by: "u", at: "2026-11-09T10:00:00.000Z" }), StreamsAdvice: JSON.stringify({ v: 1, cap: 5, why: "", repos: 2, keys: ["api", "web"], at: "2026-11-09T10:00:00.000Z" }) });
    await job(cr23, "running", "23");
    const j24 = await job(cr24, "queued", "24");
    expect(holdBack(w.store, w.get("EngineJob", j24))).toBeNull();
  });
});

describe("the merge queue", () => {
  afterEach(() => resetMergeQueues());

  it("first asked, first served; a stopped job leaves the queue; release is idempotent", async () => {
    const ctl = [new AbortController(), new AbortController(), new AbortController()];
    const [t1, t2, t3] = ["j1", "j2", "j3"].map((id, i) => mergeTurn("p-1", id, ctl[i]!.signal));
    const order: string[] = [];
    await t1!.grant();
    const waits: string[] = [];
    const p2 = t2!.grant((h) => waits.push(h)).then(() => order.push("j2"));
    const p3 = t3!.grant().then(() => order.push("j3"), () => order.push("j3 stopped"));
    expect(mergeQueueOf("p-1")).toEqual({ holder: "j1", waiting: ["j2", "j3"] });
    expect(waits).toEqual(["j1"]);
    ctl[2]!.abort();
    await p3;
    expect(mergeQueueOf("p-1").waiting).toEqual(["j2"]);
    t1!.release();
    t1!.release();
    await p2;
    expect(order).toEqual(["j3 stopped", "j2"]);
    expect(mergeQueueOf("p-1")).toEqual({ holder: "j2", waiting: [] });
    // another product's queue is its own
    await mergeTurn("p-2", "k1", new AbortController().signal).grant();
    expect(mergeQueueOf("p-2").holder).toBe("k1");
    t2!.release();
    expect(mergeQueueOf("p-1").holder).toBeNull();
  });

  it("each waiting build knows its place in line, and hears when the line moves up; the last landing is known", async () => {
    const sig = () => new AbortController().signal;
    const [t1, t2, t3] = ["m1", "m2", "m3"].map((id) => mergeTurn("p-9", id, sig()));
    const places: string[] = [];
    await t1!.grant();
    const p2 = t2!.grant((h, p) => places.push(`m2 waits for ${h}, ${p}`), (p) => places.push(`m2 now ${p}`));
    const p3 = t3!.grant((h, p) => places.push(`m3 waits for ${h}, ${p}`), (p) => places.push(`m3 now ${p}`));
    t1!.release();
    await p2;
    expect(lastLandedOf("p-9")).toBe("m1");
    t2!.release();
    await p3;
    expect(places).toEqual(["m2 waits for m1, 2", "m3 waits for m1, 3", "m3 now 2"]);
    expect(lastLandedOf("p-9")).toBe("m2");
    t3!.release();
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
    expect(readyWords(2)).toBe("Ready, waits for its turn to land (2nd in line).");
  });

  it("inMergeTurn hands the turn on however the work ends", async () => {
    const signal = new AbortController().signal;
    await expect(inMergeTurn({ projectId: "p-3", jobId: "a", signal }, async () => { throw new Error("red"); })).rejects.toThrow("red");
    expect(mergeQueueOf("p-3").holder).toBeNull();
    expect(await inMergeTurn({ projectId: "p-3", jobId: "b", signal }, async () => 7)).toBe(7);
  });

  it("reads a lane that could not merge cleanly", () => {
    expect(mergeFailureOf({ steps: [{ name: "integrate", outcome: "FAILED (integrate_conflict): rebased onto abc", seconds: 1 }], tail: [] })).toBe("integrate_conflict");
    expect(mergeFailureOf({ steps: [{ name: "integrate[web]", outcome: "FAILED (regate_failed): gate re-run: FAIL", seconds: 1 }], tail: [] })).toBe("regate_failed");
    expect(mergeFailureOf({ steps: [{ name: "deploy[web]", outcome: "FAILED", seconds: 1 }], tail: ["✗ deploy_failed: x"] })).toBe("");
    // while it waited for its turn: its work could not be brought onto what landed (the engine's resolution failed)
    expect(mergeFailureOf({ steps: [{ name: "pre-rebase[api]", outcome: "FAILED (refresh_conflict): rebased onto abc, conflicts ['src/x.ts'] NOT resolved", seconds: 1 }], tail: [] })).toBe("refresh_conflict");
    expect(mergeFailureOf({ steps: [{ name: "pre-rebase", outcome: "FAILED (regate_failed): rebased onto abc, gate re-run: FAIL", seconds: 1 }], tail: [] })).toBe("regate_failed");
  });

  it("the tech lead's advice from the product's set-up", () => {
    const now = "2026-11-09T10:00:00.000Z";
    const has = () => true;
    const ready = { repos: { api: { path: "/a", isolation: { links: ["node_modules"] } }, web: { path: "/w", isolation: { links: ["node_modules", ".local"] } } } };
    expect(adviceOf(ready, { engineStreams: true, hasPackages: has, now })).toMatchObject({ cap: 5, why: "", repos: 2 });
    expect(adviceOf(ready, { engineStreams: false, hasPackages: has, now })).toMatchObject({ cap: 1 });
    expect(adviceOf({ repos: { api: { path: "/a" } } }, { engineStreams: true, hasPackages: has, now })).toMatchObject({ cap: 1, why: expect.stringContaining("separate working copies") });
    expect(adviceOf({ repos: { api: { path: "/a" } } }, { engineStreams: true, hasPackages: () => false, now })).toMatchObject({ cap: 5 });
    // PrimaBook's API: 3 invitations per e-mail an hour, 10 project imports per 15 minutes, 10 password confirmations
    // per 5 minutes, each reset by a deploy: a budget per landing (every landing redeploys, landings come one at a time)
    const primabook = { repos: { api: { path: "/a", isolation: { links: ["node_modules"] }, acceptance: { limits: [
      { name: "invitations", max: 3, window: 3600, resets: "deploy" },
      { name: "imports", max: 10, window: 900, resets: "deploy" },
      { name: "password-confirmations", max: 10, window: 300, resets: "deploy" },
    ] } } } };
    expect(adviceOf(primabook, { engineStreams: true, hasPackages: has, now })).toMatchObject({ cap: 5, why: "" });
    // a limit that survives a deploy lowers the cap only when one landing's checks need more than it allows an hour
    const roomy = { repos: { api: { path: "/a", isolation: { links: ["node_modules"] }, acceptance: { limits: [{ name: "invitations", max: 3, window: 3600 }] } } } };
    expect(adviceOf(roomy, { engineStreams: true, hasPackages: has, now })).toMatchObject({ cap: 5 });
    const tight = { repos: { api: { path: "/a", isolation: { links: ["node_modules"] }, acceptance: { limits: [{ name: "sms-codes", max: 2, window: 3600, per_file: 1, fixtures: 2 }] } } } };
    expect(adviceOf(tight, { engineStreams: true, hasPackages: has, now })).toMatchObject({
      cap: 2, why: "The development environment allows 2 sms codes an hour and does not reset that with a deploy, while one change's checks need 3; 2 at most.",
    });
    // the live-debug cap paces the developers' probes by itself: no cap
    expect(adviceOf({ ...ready, live_debug: { max_runs_per_hour: 8 } }, { engineStreams: true, hasPackages: has, now })).toMatchObject({ cap: 5 });
    // the product's merge-friendly registration files (registry streams.merge_friendly) travel with the advice
    expect(adviceOf({ ...ready, streams: { merge_friendly: ["api: src/rbac.ts", "web: src\\pages\\team\\permissionCatalog.tsx", "api: ../x.ts", "nonsense"] } }, { engineStreams: true, hasPackages: has, now }))
      .toMatchObject({ friendly: ["api: src/rbac.ts", "web: src/pages/team/permissionCatalog.tsx"] });
    expect(adviceOf(ready, { engineStreams: true, hasPackages: has, now }).friendly).toBeUndefined();
  });
});

// A fix round that finds nothing to change (PrimaBook CR-007, job c059ad88, 09.11.2026): the automatic round started
// for item-master.mjs, whose fixture the checks had not prepared; the development agent found nothing to change and the
// job FAILED ("stopped: the development agent found nothing to change", pointing at the engine team). Now the
// engine ends such a round normally (madp-fix-round/1 `nothing_to_change`: the failing checks are the environment's),
// and on the engine's job runner, with the real change.build writer (kinds/delivery.ts), the round
//   - succeeds with "nothing to change: the failing checks are the environment's (<reasons>); a person decides";
//   - deploys and checks nothing, gets no release, and its job carries NOTHING_DEPLOYED_CODE (no delivery: the build it
//     followed keeps its open checks, so a person can still start a round or put development back);
//   - is kept on the change's record with its reasons and is not one of the automatic rounds.
// A fake official engine (a Python script as its python); the product's set-up (ensureApp) is the only part stubbed.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/fixRoundNothing.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { setAiRunner } from "../../server/local/engine/ai/index.ts";
import { NOTHING_DEPLOYED_CODE, newestDelivered } from "../../src/domain/afterDeploy";
import { afterChecksDecision, fixRoundOf, parseChangeChecks, sparedRounds, type ChecksJob } from "../../src/domain/changeChecks";
import { mergeQueueOf } from "../../server/local/engine/streams.ts";
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
const ITEM = "test/live/item-master.live.mjs";
const REASON = `api:${ITEM}: needs fixture QA Purchases, which this run does not prepare`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

/** The official engine as a Python script: `feature`/`quick` take the next "work" entry (files to commit per repo, or
 *  "nothing": the fix round's reasons, nothing committed); `accept` the next "accept" entry. Every call is logged. */
const FAKE = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys, time
args = sys.argv[4:]  # -B -m MADP.orchestrator.cli.project <lane> ...
def opt(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]
with open(os.environ["FAKE_CALLS"], "a", encoding="utf-8") as out:
    out.write(json.dumps({"args": args}) + "\n")
script_file = os.environ["FAKE_SCRIPT"]
script = json.load(open(script_file, encoding="utf-8"))
kind = "accept" if args[0] == "accept" else "work"
entry = script[kind].pop(0)
json.dump(script, open(script_file, "w", encoding="utf-8"))
def g(repo, *a):
    return subprocess.run(["git", "-c", "user.name=Lane", "-c", "user.email=lane@example.invalid", *a], cwd=repo,
                          check=True, capture_output=True, text=True).stdout.strip()
if kind == "work":
    nothing = entry.pop("nothing", None)
    for key, change in entry.items():
        repo = os.environ["FAKE_REPO_" + key.upper()]
        for rel, body in change["files"].items():
            p = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").write(body)
        g(repo, "add", "-A")
        g(repo, "commit", "-q", "-m", change["message"])
        sys.stderr.write("▸ commit[%s]: %s (1.0s)\n" % (key, g(repo, "rev-parse", "HEAD")[:9]))
    if nothing is not None:
        # fix_round_ops: the failing checks are the environment's; the lane exits 0 without a commit or a deploy
        words = "nothing to change: the failing checks are the environment's (%s); a person decides" % "; ".join(nothing)
        sys.stderr.write("▸ nothing-to-change: %s (found by the reproduce run) (0.5s)\n" % words)
        reports = os.path.join(os.path.dirname(opt("--project")[0]), "reports", "quick")
        os.makedirs(reports, exist_ok=True)
        result = os.path.join(reports, "%d-fix%s.json" % (time.time() * 1000000, opt("--fix-round")[0]))
        line = "round %s: 0 deploy iteration(s) of at most 3; depth -; %s" % (opt("--fix-round")[0], words)
        json.dump({"schema": "madp-fix-round/1", "round": int(opt("--fix-round")[0]), "rc": 0, "line": line, "ended": words,
                   "iterations": [], "deployed": {}, "still": [], "environment": [], "passed_in_round": {},
                   "diagnosis": None, "nothing_to_change": nothing}, open(result, "w", encoding="utf-8"))
        print("fixresult " + result)
        print("fixround " + line)
    sys.exit(0)
report_dir = opt("--report-dir")[0]
os.makedirs(report_dir, exist_ok=True)
stamp = "%d" % (time.time() * 1000000)
result = os.path.join(report_dir, stamp + "-primabook-dev.json")
json.dump({"schema": "madp-accept-result/1", "exit": entry["exit"], "repos": entry["repos"]}, open(result, "w", encoding="utf-8"))
open(os.path.join(report_dir, stamp + "-primabook-dev.md"), "w", encoding="utf-8").write("")
print("result   " + result)
sys.stderr.write("▸ accept[%s]: %s (2.0s)\n" % (opt("--repo")[0], entry["outcome"]))
sys.exit(entry["exit"])
`;

const CHANGE_ANSWER = {
  kind: "change",
  scopeChange: false,
  summary: "Progress invoices per partial service.",
  impact: { features: [], stories: [], screens: [], milestones: [] },
  conflicts: [],
  risks: [],
  acceptanceCriteria: ["A progress invoice lists the partial services it bills."],
  tickets: [{ title: "Progress invoicing per partial service", description: "Bill each partial service on its own." }],
  questions: [],
};

describe("a fix round that finds nothing to change ends normally, and is not one of the automatic rounds", () => {
  let w: World;
  let pid = "";
  let root = "";
  let calls = "";
  const env: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => {
    if (!(k in env)) env[k] = process.env[k];
    process.env[k] = v;
  };

  beforeAll(async () => {
    w = await makeWorld();
    pid = s(w.project(PROJECT).ItemId);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-fix-nothing-"));
    const dir = path.join(root, "madp");
    const api = path.join(dir, "primabook-api");
    const web = path.join(dir, "primabook-web");
    for (const r of [api, web]) {
      fs.mkdirSync(r, { recursive: true });
      git(r, "init", "-q", "-b", "dev");
      fs.writeFileSync(path.join(r, "README.md"), "PrimaBook\n");
      git(r, "add", "-A");
      git(r, "commit", "-q", "-m", "first");
    }
    const registry = path.join(dir, "primabook.yml");
    fs.writeFileSync(registry, [
      "project: primabook", "default_env: dev", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`,
      "repos:",
      "  api:", `    path: ${api}`, "    repo: example-org/primabook-api", "    role: api",
      "    acceptance:", "      envs: [dev]", "      tests:", '        argv: [node, "--test", "{file}"]', '        files: ["test/live/*.mjs"]',
      "  web:", `    path: ${web}`, "    repo: example-org/primabook-web", "    role: web", "",
    ].join("\n"));
    host.app = { name: "primabook", dir, registry, org: "example-org", repos: { api, web }, tenant: "", url: "https://primabook.example.test" };

    const home = path.join(root, "engine");
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(cli, "project.py"), "");
    fs.writeFileSync(path.join(cli, "accept.py"), 'p.add_argument("--also", action="append")\n');
    for (const f of ["quick.py", "feature.py"]) {
      fs.writeFileSync(path.join(cli, f), ['"--no-accept"', '"--change-record"', '"--live-check"', '"--failed-checks"', '"--fix-round"'].map((x) => `p.add_argument(${x})`).join("\n"));
    }
    const py = path.join(root, "fake-python.py");
    fs.writeFileSync(py, FAKE, { mode: 0o755 });
    calls = path.join(root, "calls.jsonl");
    fs.writeFileSync(calls, "");
    const script = {
      work: [
        { api: { message: "feat: progress invoicing per partial service", files: { "src/invoices/progress.ts": "export const bill = () => 1;\n" } } },
        // the automatic fix round: the engine finds the failing check is the environment's and changes nothing
        { nothing: [REASON] },
      ],
      accept: [
        {
          exit: 12, outcome: `FAILED: 1 of 2 file(s): ${ITEM} (0 passed, 2 failed)`,
          repos: [{
            repo: "api", status: "failed", fixtures: "ready (1.0s)", unjudged: "",
            files: [{ file: ITEM, verdict: "failed", why: "imports src/invoices/progress.ts" }, { file: "test/live/sales.live.mjs", verdict: "ok", why: "the change's own test" }],
            not_run: [],
            checks: [{ file: ITEM, verdict: "failed", reason: "FAIL selected workspace is a QA fixture", why: "imports src/invoices/progress.ts", limit: "" }],
          }],
        },
      ],
    };
    const scriptFile = path.join(root, "script.json");
    fs.writeFileSync(scriptFile, JSON.stringify(script));
    setEnv("MF_MADP_ENGINE_HOME", home);
    setEnv("MF_MADP_PYTHON", py);
    setEnv("FAKE_CALLS", calls);
    setEnv("FAKE_SCRIPT", scriptFile);
    setEnv("FAKE_REPO_API", api);
    setEnv("FAKE_REPO_WEB", web);
  });

  afterAll(async () => {
    setAiRunner(null);
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await w?.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("the round succeeds with its reasons, deploys nothing and leaves the decision and the automatic rounds to come", async () => {
    const p = w.project(PROJECT);
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: 7, Lane: "add", FeatureRef: "", Title: "SIA progress invoicing per partial service", Description: "Progress invoices per partial service.",
      Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: "t:cr:7",
    });
    const crId = res.itemId!;
    setAiRunner(async () => CHANGE_ANSWER);
    await w.queue({ project: PROJECT, kind: "change.analyse", input: { projectId: pid, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId }, key: "nothing-analyse" });
    await w.settle();
    await w.gw.update("ChangeRequest", crId, { Status: "approved", DecidedAt: "2026-11-09T10:00:00.000Z", DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true, Version: "2.1.0" });
    const releasesBefore = w.rows("Release", pid).length;

    setEnv("MF_ENGINE_BUILD", "claude");
    // who holds the product's merge turn while the builds run (parallel streams, server/local/engine/streams.ts)
    const holders = new Set<string>();
    const watch = setInterval(() => { const h = mergeQueueOf(pid).holder; if (h) holders.add(h); }, 1);
    const base = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId, version: "2.1.0" }, target: { type: "ChangeRequest", id: crId }, key: "nothing-base" });
    await w.settle();
    clearInterval(watch);

    const rows = w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && JSON.parse(s(j.InputJson)).changeRequestId === crId);
    const why = rows.map((j) => `${j.Status}: ${s(j.Message)} ${s(j.ErrorCode)}`).join("\n") + `\n${w.log.slice(-15).join("\n")}`;
    expect(rows, why).toHaveLength(2);
    expect(s(w.get("EngineJob", base).ErrorCode)).toContain("accept-failed=1/2");
    const fix = rows.find((j) => fixRoundOf({ kind: "change.build", inputJson: s(j.InputJson) }))!;
    expect(JSON.parse(s(fix.InputJson))).toMatchObject({ fixChecks: true, afterJobId: base, baseJobId: base, round: 1, auto: true });
    // a normal end, never a job failure; the line says why and who decides, and never "the engine team has the details"
    expect(fix.Status, why).toBe("succeeded");
    expect(s(fix.ErrorCode)).toBe(NOTHING_DEPLOYED_CODE);
    expect(s(fix.Message)).toMatch(/^CR-\d+ fix round 1: nothing to change: the failing checks are the environment's \(api:test\/live\/item-master\.live\.mjs: needs fixture QA Purchases, which this run does not prepare\); a person decides\.$/);
    expect(s(fix.Message).length).toBeLessThanOrEqual(200);
    expect(s(fix.Message)).not.toMatch(/has the details/);
    // the round held the product's merge turn while it ran, and handed it on although it deployed nothing
    expect([...holders]).toEqual([base, s(fix.ItemId)]);
    expect(mergeQueueOf(pid)).toEqual({ holder: null, waiting: [] });

    // three calls of the official engine: the change's lane, its checks, the fix round's lane; no checks after it
    const lanes = fs.readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { args: string[] }).args[0]);
    expect(lanes).toEqual(["quick", "accept", "quick"]);
    // no release for a round that deployed nothing
    expect(w.rows("Release", pid).filter((r) => (r.ChangeRequestIds as string[] | undefined)?.includes(crId)).map((r) => r.Version)).toEqual(["2.1.0"]);
    expect(w.rows("Release", pid).length).toBe(releasesBefore + 1);

    // the change's record keeps the round with its reasons; it is not one of the automatic rounds
    const record = parseChangeChecks(w.get("ChangeRequest", crId).Checks)!;
    expect(record.runs.map((r) => `${r.kind}:${r.round}:${r.status}`)).toEqual(["build:0:failed", "fix:1:not-run"]);
    expect(record.runs[1]).toMatchObject({ jobId: s(fix.ItemId), auto: true, baseJobId: base, nothing: [REASON], commits: [] });
    expect([...sparedRounds(record)]).toEqual([s(fix.ItemId)]);
    const jobs: ChecksJob[] = w.rows("EngineJob", pid).map((j) => ({ id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), inputJson: s(j.InputJson), finishedAt: s(j.FinishedAt), createdAt: s(j.CreatedDate) }));
    const baseView = jobs.find((j) => j.id === base)!;
    const policy = { autoFixRounds: 1, autoRevert: true };
    // once the environment is fixed and the checks fail again, the one automatic round is still there to start
    expect(afterChecksDecision(jobs, baseView, 1, policy, 0, sparedRounds(record))).toMatchObject({ action: "fix", next: { round: 2, baseJobId: base } });
    expect(afterChecksDecision(jobs, baseView, 1, policy)).toEqual({ action: "revert", baseJobId: base });
    // no delivery: the build it followed is still the change's newest, with its checks open
    const views = w.rows("EngineJob", pid).map((j) => ({ id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode), finishedAt: s(j.FinishedAt), inputJson: s(j.InputJson) }));
    expect(newestDelivered(views, (j) => JSON.parse(j.inputJson).changeRequestId === crId)?.id).toBe(base);
  });
});

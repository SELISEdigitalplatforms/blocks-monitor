// The PrimaBook case on the engine's job runner, with the real change.build writer (kinds/delivery.ts): an increment of
// a feature deploys to dev, its own checks fail there, and the fix round the engine starts by itself
//   - hands its lane what those checks reported (`--failed-checks`: the acceptance step's own result, the check that
//     failed and the one that could not judge the change), never a "not judged" check as one to fix or run again;
//   - hands its lane the change's record (`--change-record`) as a fix round of that increment, with its tickets;
//   - runs the test file that failed again after its deploy (`madp accept --also`), although the round did not touch it;
//   - goes as a fix round with depth (`--fix-round 1`, the commits of the build it fixes as `--previous-commit`) to the
//     quick lane (its failing checks are in one repo), and its message counts the engine's deploy iterations.
// A fake official engine (a Python script as its python: the lanes commit into temp git repos, `madp accept` answers
// with the engine's structured result and report); the product's set-up (ensureApp) is the only part stubbed. No Blocks
// call, no AI.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/fixRoundFromChecks.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { readFound } from "../../server/local/engine/official/failingChecks.ts";
import { setAiRunner } from "../../server/local/engine/ai/index.ts";
import { fixRoundOf, parseChangeChecks } from "../../src/domain/changeChecks";
import { parseChangeAnalysis } from "../../src/domain/changeAnalysis";
import { makeWorld, type World } from "./harness";

// the product's set-up on the engine host (Blocks sign-in, registry, clones) is other tests'; here it is ready
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
const FAILING = "test/live/recurring.live.mjs";
const LIMITED = "test/live/limits.live.mjs";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

/** The official engine as a Python script. `feature`/`quick` take the next "work" entry of the script (files to commit
 *  per repo) and commit them; `accept` takes the next "accept" entry (its exit, its structured result and report).
 *  Every call is logged with the files its options name (description, change record, failed checks). */
const FAKE = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys, time
args = sys.argv[4:]  # -B -m MADP.orchestrator.cli.project <lane> ...
def opt(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]
def read(f):
    try:
        return open(f, encoding="utf-8").read()
    except OSError:
        return None
call = {"args": args}
for name in ("--description-file", "--task-file", "--change-record", "--failed-checks"):
    for f in opt(name):
        call[name] = read(f)
with open(os.environ["FAKE_CALLS"], "a", encoding="utf-8") as out:
    out.write(json.dumps(call) + "\n")
script_file = os.environ["FAKE_SCRIPT"]
script = json.load(open(script_file, encoding="utf-8"))
kind = "accept" if args[0] == "accept" else "work"
entry = script[kind].pop(0)
json.dump(script, open(script_file, "w", encoding="utf-8"))
def g(repo, *a):
    return subprocess.run(["git", "-c", "user.name=Lane", "-c", "user.email=lane@example.invalid", *a], cwd=repo,
                          check=True, capture_output=True, text=True).stdout.strip()
if kind == "work":
    for key, change in entry.items():
        repo = os.environ["FAKE_REPO_" + key.upper()]
        for rel, body in change["files"].items():
            p = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").write(body)
        g(repo, "add", "-A")
        g(repo, "commit", "-q", "-m", change["message"])
        sha = g(repo, "rev-parse", "HEAD")
        sys.stderr.write("▸ commit[%s]: %s (1.0s)\n" % (key, sha[:9]))
    if opt("--fix-round"):
        # the engine's fix round with depth: its loop's line (fix_round_ops.LoopResult.line)
        print("fixround round %s: 2 deploy iteration(s) of at most 3; depth deep; 1 not a fix (guard); the failing live "
              "tests pass on dev after iteration 2" % opt("--fix-round")[0])
    sys.exit(0)
report_dir = opt("--report-dir")[0]
os.makedirs(report_dir, exist_ok=True)
stamp = "%d" % (time.time() * 1000000)
result = os.path.join(report_dir, stamp + "-primabook-dev.json")
json.dump({"schema": "madp-accept-result/1", "exit": entry["exit"], "repos": entry["repos"]}, open(result, "w", encoding="utf-8"))
open(os.path.join(report_dir, stamp + "-primabook-dev.md"), "w", encoding="utf-8").write(entry.get("report", ""))
print("result   " + result)
sys.stderr.write("▸ accept[%s]: %s (2.0s)\n" % (opt("--repo")[0], entry["outcome"]))
sys.exit(entry["exit"])
`;

/** The engine's report of the first run: the failing file's redacted output tail for the developers. */
const REPORT = [
  "# Acceptance — primabook on dev", "", "- **Status:** NEEDS ATTENTION (acceptance failed)", "",
  "## Acceptance on the deployed environment", "",
  "### `api` on dev: FAILED (needs attention; nothing was rolled back)", "",
  "- Commit: `abc123456789`, 12.0s", "",
  "| File | Result | Passed | Failed | Exit | Seconds |", "|---|---|---:|---:|---:|---:|",
  `| \`${FAILING}\` | FAIL | 5 | 1 | 1 | 4.0 |`,
  "| `test/live/customers.live.mjs` | ok | 7 | 0 | 0 | 2.0 |", "",
  `\`${FAILING}\` output (tail, redacted):`, "```",
  "not ok 2 - repeats the invoice every month",
  "  error: 'expected 2026-12-01, got 2026-11-31'",
  "# tests 6", "# fail 1", "```", "",
].join("\n");

const FEATURE_ANSWER = {
  kind: "feature",
  scopeChange: true,
  summary: "Invoices can repeat every month: the office sets up a plan once and each month's invoice is created from it.",
  impact: { features: [], stories: [], screens: [], milestones: [] },
  conflicts: [],
  risks: ["Existing invoices keep their numbers."],
  acceptanceCriteria: ["A monthly plan creates the next invoice on its date.", "The customer page lists the plans."],
  tickets: [
    { title: "Recurring invoice plans", description: "Store the plans and create the invoices from them.", increment: 1 },
    { title: "Plans on the customer page", description: "List and pause a customer's plans.", increment: 2 },
  ],
  increments: [{ title: "Plans and invoices", goal: "A plan creates its invoices." }, { title: "Customer page", goal: "Customers' plans are visible." }],
  parts: { api: true, web: true, data: false },
  questions: [],
};

interface Call {
  args: string[];
  "--description-file"?: string;
  "--task-file"?: string;
  "--change-record"?: string;
  "--failed-checks"?: string;
}

describe("the PrimaBook case on the engine's job runner: a fix round starts from what the checks reported", () => {
  let w: World;
  let pid = "";
  let root = "";
  let api = "";
  let calls = "";
  const env: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => {
    if (!(k in env)) env[k] = process.env[k];
    process.env[k] = v;
  };

  beforeAll(async () => {
    w = await makeWorld();
    pid = s(w.project(PROJECT).ItemId);
    // an existing product attached as it is live: no Factory scope, so a new feature is built increment by increment
    for (const f of w.rows("Feature", pid)) await w.gw.update("Feature", s(f.ItemId), { IsDeleted: true });
    await w.settle();

    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-primabook-fix-"));
    const dir = path.join(root, "madp");
    api = path.join(dir, "primabook-api");
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

    // the official engine: every option the Factory hands a fix round
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
        // increment 1: the API code and its own live test
        { api: { message: "feat: recurring invoice plans", files: { "src/invoices/recurring.ts": "export const next = (d) => d;\n", [FAILING]: "// the change's own live test\n" } } },
        // the fix round: the API code only; the test that failed stays as it is
        { api: { message: "fix: recurring invoice plans", files: { "src/invoices/recurring.ts": "export const next = (d) => nextMonth(d);\n" } } },
      ],
      accept: [
        {
          exit: 12, outcome: `FAILED: 1 of 3 file(s): ${FAILING} (5 passed, 1 failed); 1 not judged (limit)`, report: REPORT,
          repos: [{
            repo: "api", status: "failed", fixtures: "ready (1.0s)", unjudged: "limit",
            files: [
              { file: FAILING, verdict: "failed", why: "the change's own test" },
              { file: "test/live/customers.live.mjs", verdict: "ok", why: "calls GET /api/customers (src/invoices/recurring.ts)" },
              { file: LIMITED, verdict: "not-judged", why: "calls POST /api/invitations" },
            ],
            not_run: [],
            checks: [
              { file: FAILING, verdict: "failed", reason: "not ok 2 - repeats the invoice every month: expected 2026-12-01, got 2026-11-31", why: "the change's own test", limit: "" },
              { file: LIMITED, verdict: "not-judged", reason: "invitations per hour: no room left", why: "calls POST /api/invitations", limit: "invitations" },
            ],
          }],
        },
        {
          exit: 0, outcome: "ok: 2 file(s) passed",
          repos: [{
            repo: "api", status: "ok", fixtures: "ready (1.0s)", unjudged: "",
            files: [{ file: "src/invoices/recurring.test.mjs", verdict: "ok", why: "covers src/invoices/recurring.ts" }, { file: FAILING, verdict: "ok", why: "a live check of this fix round" }],
            not_run: [], checks: [],
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

  const lanes = (): Call[] => fs.readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Call);
  const valueOf = (args: string[], name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  it("increment 1 deploys, its checks fail, the fix round gets them and runs the failing file again after its deploy", async () => {
    // the feature, analysed and approved as on the change's page
    const p = w.project(PROJECT);
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: 97, Lane: "add", FeatureRef: "", Title: "Recurring invoices", Description: "Invoices that repeat every month.",
      Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: "t:cr:97",
    });
    const crId = res.itemId!;
    setAiRunner(async () => FEATURE_ANSWER);
    await w.queue({ project: PROJECT, kind: "change.analyse", input: { projectId: pid, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId }, key: "fix-analyse" });
    await w.settle();
    expect(parseChangeAnalysis(w.get("ChangeRequest", crId).Analysis)).toMatchObject({ route: "feature" });
    await w.gw.update("ChangeRequest", crId, { Status: "approved", DecidedAt: "2026-11-09T10:00:00.000Z", DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true, Version: "2.1.0" });

    // the real builds from here on: the official engine (the fake one) builds, deploys and checks
    setEnv("MF_ENGINE_BUILD", "claude");
    const base = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId, version: "2.1.0" }, target: { type: "ChangeRequest", id: crId }, key: "fix-base" });
    await w.settle();

    const jobs = w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && JSON.parse(s(j.InputJson)).changeRequestId === crId);
    const why = jobs.map((j) => `${j.Status}: ${s(j.Message)} ${s(j.ErrorCode)}`).join("\n") + `\n${w.log.slice(-15).join("\n")}`;
    expect(jobs, why).toHaveLength(2);
    const baseJob = w.get("EngineJob", base);
    expect(baseJob.Status, why).toBe("succeeded");
    expect(s(baseJob.Message)).toContain("but not usable yet");
    expect(s(baseJob.ErrorCode)).toContain("accept-failed=1/3");
    const fix = jobs.find((j) => fixRoundOf({ kind: "change.build", inputJson: s(j.InputJson) }))!;
    expect(fix.Status, why).toBe("succeeded");
    expect(JSON.parse(s(fix.InputJson))).toMatchObject({ fixChecks: true, afterJobId: base, baseJobId: base, round: 1, auto: true });
    expect(s(fix.Message)).toContain("its checks pass now");
    // the engine's loop: how many deploys the round took, at what depth, and that one change was not a fix
    expect(s(fix.Message)).toContain("after 2 deploy iterations of at most 3, deep; 1 change was not a fix");

    // four calls of the official engine: the increment's lane, its checks, the fix round's lane, its checks
    const [build, check1, fixLane, check2] = lanes();
    expect([build, check1, fixLane, check2].map((c) => c?.args[0])).toEqual(["feature", "accept", "quick", "accept"]);
    const incCommit = git(api, "rev-parse", "HEAD~1");
    const fixCommit = git(api, "rev-parse", "HEAD");
    // the increment: its record as increment 1 of 2, no failed checks to start from
    expect(build!.args).not.toContain("--failed-checks");
    expect(JSON.parse(build!["--change-record"]!)).toMatchObject({ id: "CR-097", round: { kind: "increment", n: 1, of: 2 } });
    // its checks: the change's own tests at the deployed commit, nothing more
    expect(check1!.args.slice(0, 9)).toEqual(["accept", "--project", host.app!.registry, "--env", "dev", "--repo", "api", "--commit", incCommit]);
    expect(check1!.args).not.toContain("--also");

    // the fix round's lane starts from what the checks reported: the failed check and the one that could not judge
    expect(fixLane!.args).toContain("--failed-checks");
    const reported = JSON.parse(fixLane!["--failed-checks"]!) as { checks: Array<{ repo: string; file: string; verdict: string; why: string; limit: string }> };
    expect(reported.checks.map((c) => `${c.verdict} ${c.repo}:${c.file}`)).toEqual([`failed api:${FAILING}`, `not-judged api:${LIMITED}`]);
    // the engine takes the failed test from that file; a not-judged check is never one to fix or to run again
    expect(fixLane!.args).not.toContain("--live-check");
    // a fix round with depth: its number and the commit of the build it fixes (the engine diagnoses from what it changed)
    expect(valueOf(fixLane!.args, "--fix-round")).toBe("1");
    const previous = fixLane!.args.filter((_a, i) => fixLane!.args[i - 1] === "--previous-commit");
    expect(previous).toHaveLength(1);
    expect(incCommit.startsWith(previous[0]!)).toBe(true);
    expect(JSON.stringify(fixLane!.args)).not.toContain(LIMITED);
    // its description: what failed, with the output, instead of tickets to build
    const task = fixLane!["--task-file"]!;
    expect(task).toContain("## Fix what the checks found (fix round 1)");
    expect(task).toContain(`### api: ${FAILING}`);
    expect(task).toContain("expected 2026-12-01, got 2026-11-31");
    expect(task).not.toContain("## Build these");
    expect(valueOf(fixLane!.args, "--title")).toBe("fix: recurring invoices");
    // its record: a fix round of increment 1, with that increment's tickets; the analysis stays the head
    const record = JSON.parse(fixLane!["--change-record"]!);
    expect(record).toMatchObject({
      kind: "feature", round: { kind: "fix-round", n: 1, title: "increment 1 of 2: Plans and invoices" },
      increments: [{ n: 1, state: "this build" }, { n: 2, state: "later" }],
      tickets: [{ title: "Recurring invoice plans" }],
      acceptanceCriteria: ["A monthly plan creates the next invoice on its date.", "The customer page lists the plans."],
    });

    // after its deploy, the file that failed runs again although the round did not touch it
    expect(git(api, "show", "--name-only", "--format=", fixCommit)).toBe("src/invoices/recurring.ts");
    expect(check2!.args.slice(0, 9)).toEqual(["accept", "--project", host.app!.registry, "--env", "dev", "--repo", "api", "--commit", fixCommit]);
    expect(valueOf(check2!.args, "--also")).toBe(FAILING);

    // recorded on the change: the increment failed, the fix round passed; the engine host keeps what was reported
    const checks = parseChangeChecks(w.get("ChangeRequest", crId).Checks)!;
    expect(checks.runs.map((r) => `${r.kind}:${r.round}:${r.status}`)).toEqual(["build:0:failed", "fix:1:ok"]);
    expect(checks.runs[0]!.failing).toEqual([{ repo: "api", name: FAILING, reason: "not ok 2 - repeats the invoice every month: expected 2026-12-01, got 2026-11-31" }]);
    expect(readFound(host.app!, base)?.reported?.map((c) => c.verdict)).toEqual(["failed", "not-judged"]);
    // the increment is on dev for people to try; the next one starts from the change request again
    expect(w.get("ChangeRequest", crId).Status).toBe("approved");
  });
});

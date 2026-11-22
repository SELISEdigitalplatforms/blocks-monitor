// The checks after a deploy are fair on a long-lived product (09.11.2026, PrimaBook CR-006 and CR-007 were held back
// for hours by failures older than them): on the Factory's side
//   - the engine's "known before this change" files are read, kept on the change apart from its failures, and never a
//     fix round's target; a person's marks go to `madp accept --known` and out of the fix round's targets;
//   - a fix round names the change's earlier commits (`--change-commit`) to its lane and to its checks;
//   - the round's structured result: what its recheck passed on the deployed commit is counted by the checks after the
//     deploy (`--passed-in-round`), the files its diagnosis put in the environment stay failed on the change with the
//     diagnosis beside them, and no further automatic round starts for them;
//   - a quick lane that hands a fix round over (exit 2) hands its diagnosis to the feature lane (`--diagnosis`);
//   - "service": a refused mail service is the environment's.
// The real change.build writer with a fake official engine (as fixRoundFromChecks.test.ts).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/checksBaseline.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { acceptIssues, acceptOutcome, readAcceptResult, runAcceptance, type AcceptLane } from "../../server/local/engine/official/acceptance.ts";
import { fixLoopOf, fixResultOf, handedDiagnosisOf, laneArgs, type WorkAsk } from "../../server/local/engine/official/build.ts";
import type { JobRun } from "../../server/local/engine/run.ts";
import { setAiRunner } from "../../server/local/engine/ai/index.ts";
import { acceptKnownLine, acceptNotRunLine } from "../../src/domain/afterDeploy";
import {
  autoFixDecision, changeCommitsOf, checksCleared, fixRoundInput, fixTargets, openFailing, parseChangeChecks, serializeChangeChecks, serializeChecksPolicy, withMark,
  withRun, type ChecksRun,
} from "../../src/domain/changeChecks";
import { changeChecksState, nextWords } from "../../src/components/build/changeChecksUi";
import { makeWorld, type World } from "./harness";

const host = vi.hoisted(() => ({ app: null as OfficialApp | null }));
vi.mock("../../server/local/engine/official/app.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/local/engine/official/app.ts")>()),
  ensureApp: async () => {
    if (!host.app) throw new Error("no product");
    return host.app;
  },
}));

const s = (v: unknown) => (typeof v === "string" ? v : "");
const PROJECTS = "test/projects.mjs";
const VIEWS = "test/projects-views.mjs";
const SIGNOFF = "test/portal-signoff.mjs";

// ------------------------------------------------------------------ pure

describe("the checks' result on the Factory's side", () => {
  const raw = {
    repo: "api", status: "ok", unjudged: "", fixtures: "ready",
    files: [
      { file: "test/watchlist.mjs", verdict: "ok", why: "the change's own test" },
      { file: "test/import.mjs", verdict: "ok", why: "a live test this fix round must make pass", reused: "passed in the round on abc123def456" },
      { file: PROJECTS, verdict: "known", why: "calls GET /api/projects", known: "failed the same way before this change (on 0a1b2c3d4e5f)" },
    ],
    not_run: [], checks: [],
    known: [{ file: PROJECTS, verdict: "known", reason: "FAIL create project without a reason: expected 201, got 422", evidence: "failed the same way before this change (on 0a1b2c3d4e5f, 2026-10-30 10:00 UTC: 6 failing)", by: "history", why: "calls GET /api/projects" }],
  };

  it("a known file is reported apart: never failed, never open for a retry, always said", () => {
    const part = readAcceptResult("api", raw)!;
    expect(part).toMatchObject({ status: "ok", failed: 0, files: 3, open: [] });
    expect(part.known).toEqual([{ repo: "api", file: PROJECTS, reason: "FAIL create project without a reason: expected 201, got 422", evidence: raw.known[0]!.evidence, by: "history", why: "calls GET /api/projects" }]);
    expect(part.tests!.find((t) => t.file === "test/import.mjs")!.reused).toBe("passed in the round on abc123def456");
    const out = acceptOutcome([part], [{ key: "api", commit: "abc123def456" }]);
    expect(out.status).toBe("ok");
    expect(acceptIssues(out)).toEqual([]);
    expect(out.line).toBe("The change's own checks on the development environment passed (2 test files, 1 passed in the fix round on the deployed commit and were not run again). "
      + `1 check still fails as before this change (not this change's): ${PROJECTS}.`);
    expect(acceptKnownLine(out.known[0]!)).toBe(`${PROJECTS} (api) still fails as before this change: FAIL create project without a reason: expected 201, got 422 (${raw.known[0]!.evidence})`);
  });

  it("a refused mail service is the environment's: not judged, and the job says what to do", () => {
    const part = readAcceptResult("api", {
      repo: "api", status: "not-judged", unjudged: "service", service: "the environment's mail service refused",
      files: [{ file: SIGNOFF, verdict: "not-judged", why: "the change's own test" }],
      checks: [{ file: SIGNOFF, verdict: "not-judged", reason: "the environment's mail service refused: FAIL sign-off sends the e-mail", why: "", limit: "" }],
    })!;
    const out = acceptOutcome([part], [{ key: "api", commit: "abc1234" }]);
    expect(out).toMatchObject({ status: "not-judged", unjudged: "service", failed: 0 });
    expect(acceptIssues(out)).toEqual(["accept-not-run"]);
    expect(acceptNotRunLine("service")).toContain("a service of the environment (such as its mail service) refused. Nothing failed");
  });

  it("a test whose fixture was not prepared is not judged; it needs a person before the environment's reasons", () => {
    const part = readAcceptResult("api", {
      repo: "api", status: "not-judged", unjudged: "fixture",
      files: [{ file: "test/custom-fields.mjs", verdict: "not-judged", why: "imports src/fields.ts" }, { file: SIGNOFF, verdict: "not-judged", why: "" }],
      checks: [{ file: "test/custom-fields.mjs", verdict: "not-judged", reason: "the test's fixture was not prepared (QA Custom Fields): FAIL create a custom field: Workspace not found", why: "", limit: "" }],
    })!;
    const service = readAcceptResult("web", { repo: "web", status: "not-judged", unjudged: "service", files: [{ file: "t.mjs", verdict: "not-judged" }] })!;
    const out = acceptOutcome([service, part], []);
    expect(out).toMatchObject({ status: "not-judged", unjudged: "fixture", failed: 0 });
    expect(out.line).toContain("some of its tests use test data the checks did not prepare");
  });

  it("a fix round names the change's earlier commits, only with an engine that takes them", () => {
    const a: WorkAsk = { product: "PrimaBook", label: "CR-006: Partial invoices", goal: "", tickets: [], built: [], later: [], fix: "## Fix", changeCommits: ["1bc5982b8", "not-a-sha", "1bc5982b8", "501370bb8"] };
    expect(laneArgs(a, { fixRound: true, changeCommit: true }).slice(4)).toEqual(["--fix-round", "1", "--change-commit", "1bc5982b8,501370bb8"]);
    expect(laneArgs(a, { fixRound: true }).slice(4)).toEqual(["--fix-round", "1"]);
    expect(laneArgs({ ...a, fix: undefined }, { fixRound: true, changeCommit: true }).slice(4)).toEqual([]);
  });

  it("reads the round's result and the handed diagnosis only from the lane's own report folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-fixresult-"));
    try {
      const file = path.join(dir, "x-fix1.json");
      fs.writeFileSync(file, JSON.stringify({
        schema: "madp-fix-round/1", passed_in_round: { api: { commit: "abc1234def", files: { [VIEWS]: { passed: 9, failed: 0 } } } },
        environment: [{ repo: "api", file: SIGNOFF, cause: "dev's mail service refuses the e-mail", evidence: ["messageKey mail.serviceDown"] }, { repo: "api", file: "x.mjs", evidence: [] }],
      }));
      const r = fixResultOf(`fixround round 1: ...\nfixresult ${file}\n`, [dir])!;
      expect(r).toEqual({ path: file, passedInRound: { api: { commit: "abc1234def", files: [VIEWS] } }, environment: [{ repo: "api", file: SIGNOFF, cause: "dev's mail service refuses the e-mail", evidence: ["messageKey mail.serviceDown"] }], nothing: [] });
      expect(fixResultOf(`fixresult ${file}\n`, [os.tmpdir()])).toBeNull();
      const d = path.join(dir, "x.diagnosis.json");
      fs.writeFileSync(d, "{}");
      expect(handedDiagnosisOf(`report   /x.md\ndiagnosis ${d}\nstatus   FAILED (fix_spans_repos)\n`, [dir])).toBe(d);
      expect(handedDiagnosisOf(`diagnosis ${d}\n`, [os.tmpdir()])).toBe("");
      expect(handedDiagnosisOf("diagnosis /nowhere/x.json\n", ["/nowhere"])).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a round that found nothing to change from its result, else from its line, never from a later iteration's", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-fixnothing-"));
    try {
      const why = "api:test/item-master.mjs: needs fixture QA Purchases, which this run does not prepare";
      const words = `nothing to change: the failing checks are the environment's (${why}); a person decides`;
      const file = path.join(dir, "x-fix1.json");
      fs.writeFileSync(file, JSON.stringify({ schema: "madp-fix-round/1", nothing_to_change: [why, 7, ""] }));
      expect(fixResultOf(`fixresult ${file}\n`, [dir])).toMatchObject({ nothing: [why], environment: [], passedInRound: {} });
      expect(fixLoopOf(`fixround round 1: 0 deploy iteration(s) of at most 3; depth -; ${words}\n`)).toMatchObject({ iterations: 0, passed: false, nothing: [why] });
      // a later iteration found nothing more: the earlier deploy stands, the round is not "nothing to change"
      expect(fixLoopOf(`fixround round 1: 1 deploy iteration(s) of at most 3; depth deep; iteration 2: ${words}; dev runs iteration 1's deploy\n`)?.nothing).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAcceptance hands the engine the change's commits, a person's marks and what the round passed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-accept-args-"));
    try {
      const fixres = path.join(dir, "fix1.json");
      fs.writeFileSync(fixres, "{}");
      const seen: string[][] = [];
      const lane: AcceptLane = async (_run, args) => {
        seen.push(args);
        return { code: 0, stdout: "", tail: [], steps: [{ name: "accept[api]", outcome: "ok: 1 file(s) passed", seconds: 1 }] };
      };
      const run = { id: "job-1", iso: () => "2026-11-09T12:00:00.000Z", log: () => undefined, signal: new AbortController().signal } as unknown as JobRun;
      const app = { name: "primabook", dir, registry: path.join(dir, "missing.yml"), org: "o", repos: {}, tenant: "", url: "" } as OfficialApp;
      await runAcceptance(run, app, [{ key: "api", commit: "abc1234", change: ["1bc5982b8", "501370bb8"] }, { key: "web", commit: "def5678" }], {
        lane, options: { also: true, changeCommit: true, known: true, passedInRound: true },
        known: [{ repo: "api", file: VIEWS, reason: "out of date since 24 Oct", commit: "1bc5982b8" }], passedInRound: fixres,
      });
      const [api, web] = seen;
      const v = (a: string[], k: string) => a[a.indexOf(k) + 1];
      expect(v(api!, "--change-commit")).toBe("1bc5982b8,501370bb8");
      expect(JSON.parse(fs.readFileSync(v(api!, "--known")!, "utf8"))).toEqual({ known: [{ repo: "api", file: VIEWS, reason: "out of date since 24 Oct", commit: "1bc5982b8" }] });
      expect(v(api!, "--passed-in-round")).toBe(fixres);
      // no marks for web, no change commits named for it
      expect(web).not.toContain("--known");
      expect(web).not.toContain("--change-commit");
      // an engine without the options: none of them
      seen.length = 0;
      await runAcceptance(run, app, [{ key: "api", commit: "abc1234", change: ["1bc5982b8"] }], { lane, options: { also: true, changeCommit: false, known: false, passedInRound: false }, known: [{ repo: "api", file: VIEWS, reason: "x" }], passedInRound: fixres });
      expect(seen[0]!.filter((a) => a.startsWith("--")).sort()).toEqual(["--commit", "--env", "--project", "--repo", "--report-dir"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the change's record: known, marks, the diagnosis beside the verdict", () => {
  const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId">): ChecksRun => ({
    kind: "build", env: "dev", at: "", status: "failed", version: "1.2.0", commits: ["abc1234"], failed: 2, files: 9, fixtures: false, round: 0, auto: false, baseJobId: "",
    failing: [{ repo: "api", name: VIEWS, reason: "FAIL watchlist matches list hours, unbilled and budget exactly" }, { repo: "api", name: SIGNOFF, reason: "FAIL sign-off: 502" }],
    known: [{ repo: "api", name: PROJECTS, reason: "FAIL create project without a reason", evidence: "failed the same way before this change (on 0a1b2c3)", by: "history" }],
    diagnosed: [], ...o,
  });

  it("keeps the known checks, the marks and the diagnosis through a write and a read", () => {
    let rec = withRun(null, run({ jobId: "j-base" }));
    rec = withMark(rec, { repo: "api", name: VIEWS, reason: "  out of date since 24 Oct  ", byUserId: "u-1", at: "2026-11-09T10:00:00Z", jobId: "j-base", commit: "abc1234" });
    rec = withRun(rec, run({ jobId: "j-r1", kind: "fix", round: 1, baseJobId: "j-base", commits: ["def5678"], diagnosed: [{ repo: "api", name: SIGNOFF, side: "environment", cause: "dev's mail service", evidence: ["mail.serviceDown"] }] }));
    const back = parseChangeChecks(serializeChangeChecks(rec))!;
    expect(back.marks).toEqual([{ repo: "api", name: VIEWS, reason: "out of date since 24 Oct", byUserId: "u-1", at: "2026-11-09T10:00:00Z", jobId: "j-base", commit: "abc1234" }]);
    expect(back.runs[0]!.known![0]).toMatchObject({ name: PROJECTS, by: "history" });
    expect(back.runs[1]!.diagnosed![0]).toMatchObject({ name: SIGNOFF, cause: "dev's mail service" });
    // the change's commits: the base build and its rounds, never "before this change"
    expect(changeCommitsOf(back, "j-base")).toEqual(["abc1234", "def5678"]);
    expect(changeCommitsOf(back, "j-base", "j-r1")).toEqual(["abc1234"]);
    // a marked check is not the change's; the diagnosis' environment file is no target of an automatic round
    expect(openFailing(back.runs[1]!, back.marks).failing.map((f) => f.name)).toEqual([SIGNOFF]);
    expect(fixTargets(back.runs[1]!, back.marks)).toEqual({ failed: 0, environment: back.runs[1]!.diagnosed });
    expect(autoFixDecision([], { id: "j-r1", kind: "change.build", inputJson: "{}" }, 0, 2, 1)).toEqual({ start: false, why: "environment" });
    expect(checksCleared(serializeChangeChecks(back), "j-r1")).toBe(false);
    expect(checksCleared(serializeChangeChecks(withMark(back, { repo: "api", name: SIGNOFF, reason: "dev's mail is down", byUserId: "u", at: "", jobId: "j-r1", commit: "" })), "j-r1")).toBe(true);
  });
});

// ------------------------------------------------------------------ the CR-006 flow on the job runner

const FAKE = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys, time
args = sys.argv[4:]
def opt(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name and i + 1 < len(args)]
def read(f):
    try:
        return open(f, encoding="utf-8").read()
    except OSError:
        return None
call = {"args": args}
for name in ("--task-file", "--description-file", "--failed-checks", "--known", "--diagnosis"):
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
    reports = os.environ["MADP_QUICK_REPORT_DIR" if args[0] == "quick" else "MADP_FEATURE_REPORT_DIR"]
    os.makedirs(reports, exist_ok=True)
    if entry.get("handover"):
        d = os.path.join(reports, "%d-fix1.diagnosis.json" % (time.time() * 1000000))
        json.dump({"schema": "madp-fix-diagnosis/1"}, open(d, "w", encoding="utf-8"))
        print("diagnosis " + d)
        print("status   FAILED (fix_spans_repos)  (1s, exit 2)")
        sys.exit(2)
    sha = ""
    for key, change in entry["repos"].items():
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
        print("fixround round %s: 2 deploy iteration(s) of at most 3; depth deep; the failing live tests pass on dev after iteration 2" % opt("--fix-round")[0])
        res = os.path.join(reports, "%d-fix%s.json" % (time.time() * 1000000, opt("--fix-round")[0]))
        json.dump({"schema": "madp-fix-round/1", "environment": entry.get("environment", []),
                   "passed_in_round": {k: {"commit": sha, "files": {f: {"passed": 9, "failed": 0} for f in fs}} for k, fs in entry.get("passed", {}).items()}},
                  open(res, "w", encoding="utf-8"))
        print("fixresult " + res)
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

interface Call { args: string[]; "--failed-checks"?: string; "--known"?: string; "--diagnosis"?: string }

const failedCheck = (file: string, reason: string) => ({ file, verdict: "failed", reason, why: "calls GET /api/projects/watchlist", limit: "" });

describe("CR-006 on the engine's job runner: what failed before it never holds it back", () => {
  let w: World;
  let pid = "";
  let root = "";
  let api = "";
  let calls = "";
  const PROJECT = "Service Technician Portal";
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-cr006-"));
    const dir = path.join(root, "madp");
    api = path.join(dir, "primabook-api");
    const web = path.join(dir, "primabook-web");
    for (const r of [api, web]) {
      fs.mkdirSync(r, { recursive: true });
      execFileSync("git", ["-c", "init.defaultBranch=dev", "init", "-q"], { cwd: r });
      fs.writeFileSync(path.join(r, "README.md"), "PrimaBook\n");
      execFileSync("git", ["-c", "user.name=F", "-c", "user.email=f@example.invalid", "add", "-A"], { cwd: r });
      execFileSync("git", ["-c", "user.name=F", "-c", "user.email=f@example.invalid", "commit", "-q", "-m", "first"], { cwd: r });
    }
    const registry = path.join(dir, "primabook.yml");
    fs.writeFileSync(registry, [
      "project: primabook", "default_env: dev", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`,
      "repos:",
      "  api:", `    path: ${api}`, "    repo: example-org/primabook-api", "    role: api",
      "    acceptance:", "      envs: [dev]", "      tests:", '        argv: [node, "{file}"]', '        files: ["test/*.mjs"]',
      "  web:", `    path: ${web}`, "    repo: example-org/primabook-web", "    role: web", "",
    ].join("\n"));
    host.app = { name: "primabook", dir, registry, org: "example-org", repos: { api, web }, tenant: "", url: "https://primabook.example.test" };
    const home = path.join(root, "engine");
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(cli, "project.py"), "");
    fs.writeFileSync(path.join(cli, "accept.py"), ['"--also"', '"--change-commit"', '"--known"', '"--passed-in-round"'].map((x) => `p.add_argument(${x})`).join("\n"));
    for (const f of ["quick.py", "feature.py"]) {
      fs.writeFileSync(path.join(cli, f), ['"--no-accept"', '"--change-record"', '"--live-check"', '"--failed-checks"', '"--fix-round"', '"--change-commit"', '"--diagnosis"'].map((x) => `p.add_argument(${x})`).join("\n"));
    }
    const py = path.join(root, "fake-python.py");
    fs.writeFileSync(py, FAKE, { mode: 0o755 });
    calls = path.join(root, "calls.jsonl");
    fs.writeFileSync(calls, "");
    const script = {
      work: [
        // the change: the watchlist
        { repos: { api: { message: "feat: watchlist", files: { "src/projects/watchlist.ts": "export const w = 1;\n" } } } },
        // fix round 1: the quick lane finds causes in web too and hands the round over with its diagnosis
        { handover: true },
        // ... the feature lane fixes it; its diagnosis puts the sign-off in the environment, its recheck passed the views
        {
          repos: { api: { message: "fix: watchlist", files: { "src/projects/watchlist.ts": "export const w = 2;\n" } } },
          environment: [{ repo: "api", file: SIGNOFF, cause: "dev's mail service refuses the sign-off e-mail", evidence: ["the API answered messageKey mail.serviceDown"] }],
          passed: { api: [VIEWS] },
        },
      ],
      accept: [
        {
          exit: 12, outcome: `FAILED: 2 of 4 file(s): ${VIEWS}, ${SIGNOFF}; 1 known before this change`,
          repos: [{
            repo: "api", status: "failed", fixtures: "ready", unjudged: "",
            files: [
              { file: "test/watchlist.mjs", verdict: "ok", why: "the change's own test" },
              { file: VIEWS, verdict: "failed", why: "calls GET /api/projects/watchlist" },
              { file: SIGNOFF, verdict: "failed", why: "calls POST /api/portal/signoff" },
              { file: PROJECTS, verdict: "known", why: "calls GET /api/projects", known: "failed the same way before this change (on 0a1b2c3d4e5f)" },
            ],
            not_run: [],
            checks: [failedCheck(VIEWS, "FAIL watchlist matches list hours, unbilled and budget exactly"), failedCheck(SIGNOFF, "FAIL sign-off: 502")],
            known: [{ file: PROJECTS, verdict: "known", reason: "FAIL create project without a reason: expected 201, got 422", evidence: "failed the same way before this change (on 0a1b2c3d4e5f, 2026-10-30 10:00 UTC: 6 failing)", by: "history", why: "calls GET /api/projects" }],
          }],
        },
        {
          exit: 12, outcome: `FAILED: 1 of 4 file(s): ${SIGNOFF}; 2 known before this change`,
          repos: [{
            repo: "api", status: "failed", fixtures: "ready", unjudged: "",
            files: [
              { file: "test/watchlist.mjs", verdict: "ok", why: "the change's own test" },
              { file: VIEWS, verdict: "known", why: "a live test this fix round must make pass", known: "marked known before this change by a person: out of date since 24 Oct" },
              { file: SIGNOFF, verdict: "failed", why: "a live test this fix round must make pass" },
              { file: PROJECTS, verdict: "known", why: "calls GET /api/projects", known: "failed the same way before this change" },
            ],
            not_run: [],
            checks: [failedCheck(SIGNOFF, "FAIL sign-off: 502")],
            known: [
              { file: VIEWS, verdict: "known", reason: "FAIL watchlist matches list hours", evidence: "marked known before this change by a person: out of date since 24 Oct", by: "person", why: "" },
              { file: PROJECTS, verdict: "known", reason: "FAIL create project without a reason", evidence: "failed the same way before this change", by: "history", why: "" },
            ],
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

  it("known before the change is kept apart; marks and the diagnosis decide what a round targets and when no round starts", async () => {
    const p = w.project(PROJECT);
    // automatic rounds are on: what the diagnosis puts in the environment must still not start one
    await w.gw.update("Project", pid, { ChecksPolicy: serializeChecksPolicy({ autoFixRounds: 0, autoRevert: false }) });
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: 106, Lane: "change", FeatureRef: "", Title: "Watchlist", Description: "Projects on a watchlist with hours, unbilled and budget.",
      Status: "approved", Version: "2.6.0", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: "t:cr:106",
      DecidedAt: "2026-11-09T09:00:00.000Z", DecidedByUserId: s(p.CreatedByUserId), SelfApproved: true,
    });
    const crId = res.itemId!;
    setEnv("MF_ENGINE_BUILD", "claude");
    const base = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId, version: "2.6.0" }, target: { type: "ChangeRequest", id: crId }, key: "cr006-base" });
    await w.settle();
    const why = () => `${w.log.slice(-15).join("\n")}`;
    const baseJob = w.get("EngineJob", base);
    expect(baseJob.Status, why()).toBe("succeeded");
    // two of its four test files fail; the one that failed the same way before is not counted against it
    expect(s(baseJob.ErrorCode)).toContain("accept-failed=2/4");
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: api, encoding: "utf8" }).trim();
    let record = parseChangeChecks(w.get("ChangeRequest", crId).Checks)!;
    expect(record.runs[0]!.known!.map((k) => `${k.by} ${k.name}`)).toEqual([`history ${PROJECTS}`]);
    expect(record.runs[0]!.failing.map((f) => f.name)).toEqual([VIEWS, SIGNOFF]);
    expect(lanes()[1]!.args).not.toContain("--change-commit");

    // a person marks the views check: out of date since 24 Oct (cr.markKnown stores it on the change's record)
    record = withMark(record, { repo: "api", name: VIEWS, reason: "out of date since 24 Oct: the watchlist answer changed", byUserId: s(p.CreatedByUserId), at: "2026-11-09T10:00:00.000Z", jobId: base, commit: baseCommit });
    await w.gw.update("ChangeRequest", crId, { Checks: serializeChangeChecks(record) });
    await w.gw.update("Project", pid, { ChecksPolicy: serializeChecksPolicy({ autoFixRounds: 2, autoRevert: false }) });
    const round = await w.queue({ project: PROJECT, kind: "change.build", input: fixRoundInput(pid, { changeRequestId: crId, afterJobId: base, baseJobId: base, round: 1, auto: false, version: "2.6.1" }), target: { type: "EngineJob", id: base }, key: "cr006-round1" });
    await w.settle();
    const fix = w.get("EngineJob", round);
    expect(fix.Status, why()).toBe("succeeded");

    const [, , quickLane, featureLane, check2] = lanes();
    expect([quickLane, featureLane, check2].map((c) => c?.args[0])).toEqual(["quick", "feature", "accept"]);
    // the round's targets: the sign-off only (the marked views check is not one); the change's base build is named
    const reported = JSON.parse(quickLane!["--failed-checks"]!) as { checks: Array<{ file: string; verdict: string }> };
    expect(reported.checks.map((c) => `${c.verdict} ${c.file}`)).toEqual([`failed ${SIGNOFF}`]);
    expect(baseCommit.startsWith(valueOf(quickLane!.args, "--change-commit")!)).toBe(true);
    // the quick lane handed the round over: the feature lane starts from its diagnosis
    expect(valueOf(featureLane!.args, "--diagnosis")).toMatch(/fix1\.diagnosis\.json$/);
    expect(JSON.parse(featureLane!["--diagnosis"]!)).toEqual({ schema: "madp-fix-diagnosis/1" });
    // the checks after the round: the change's base build is never "before" it, the person's mark goes with them, and
    // what the round's recheck passed on the deployed commit is counted
    const fixCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: api, encoding: "utf8" }).trim();
    expect(valueOf(check2!.args, "--commit")).toBe(fixCommit);
    expect(valueOf(check2!.args, "--change-commit")).toBe(baseCommit);
    expect(JSON.parse(check2!["--known"]!)).toEqual({ known: [{ repo: "api", file: VIEWS, reason: "out of date since 24 Oct: the watchlist answer changed", commit: baseCommit }] });
    expect(valueOf(check2!.args, "--passed-in-round")).toMatch(/fix1\.json$/);

    // on the change: the sign-off still failed (the test decides) with the diagnosis beside it; the views and the
    // projects test are known before this change; no automatic round starts for the environment's file
    record = parseChangeChecks(w.get("ChangeRequest", crId).Checks)!;
    const r1 = record.runs.find((r) => r.jobId === round)!;
    expect(r1).toMatchObject({ kind: "fix", status: "failed", failed: 1 });
    expect(r1.failing.map((f) => f.name)).toEqual([SIGNOFF]);
    expect(r1.diagnosed).toEqual([{ repo: "api", name: SIGNOFF, side: "environment", cause: "dev's mail service refuses the sign-off e-mail", evidence: ["the API answered messageKey mail.serviceDown"] }]);
    expect(r1.known!.map((k) => `${k.by} ${k.name}`)).toEqual([`person ${VIEWS}`, `history ${PROJECTS}`]);
    const rounds = w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && JSON.parse(s(j.InputJson)).changeRequestId === crId);
    expect(rounds, why()).toHaveLength(2);
    expect(w.log.some((l) => l.includes("checks after deploy: not usable; a person decides (environment)")), why()).toBe(true);

    // the change's page: what fails with the diagnosis beside it, the known list, and why nothing starts by itself
    const jobs = w.rows("EngineJob", pid).map((j) => ({ id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode) || null, finishedAt: s(j.FinishedAt) || null, createdAt: s(j.CreatedDate) || null, inputJson: s(j.InputJson) }));
    const policy = { autoFixRounds: 2, autoRevert: false };
    const state = changeChecksState({ id: crId, checks: s(w.get("ChangeRequest", crId).Checks) }, jobs as never, policy);
    expect(state.broken).toBe(true);
    expect(state.failing.map((f) => [f.name, f.diagnosed?.cause])).toEqual([[SIGNOFF, "dev's mail service refuses the sign-off e-mail"]]);
    expect(state.known.map((k) => k.name)).toEqual([VIEWS, PROJECTS]);
    expect(state.next).toEqual({ who: "you", why: "environment" });
    expect(nextWords(state.next, policy)).toContain("puts the checks that still fail in the environment, not the code");
  });
});

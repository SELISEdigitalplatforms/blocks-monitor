// A change's own checks on dev, read truthfully (official/acceptance.ts): the engine's structured result (`madp accept`
// writes it next to its report and prints `result   <path>`) carries the checks that failed or could not judge the
// change, with a short redacted reason and why each test ran; exit 13 is "not judged" (the environment was not ready,
// a limit such as invitations per hour, the step's time): open, never a pass, never a failure; every line says what
// happens next instead of pointing at a team; a retry runs only the files still open. Temp folders and a fake official
// engine (a shell script as its python); no Blocks call.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/acceptanceTruth.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NOT_JUDGED_EXIT, acceptChecksOf, acceptDetails, acceptFromLane, acceptIssues, acceptOutcome, engineResult, openAcceptTargets, readAcceptRecord,
  readAcceptResult, readAcceptStep, runAcceptance,
} from "../../server/local/engine/official/acceptance.ts";
import { runAfterDeploy } from "../../server/local/engine/official/afterDeploy.ts";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import {
  AFTER_DEPLOY_LINE, acceptCheckLine, acceptFailedLine, acceptNotRunLine, afterDeployCode, afterDeployDetails, attentionOf, jobAttention,
} from "../../src/domain/afterDeploy";

const made: string[] = [];
const envBefore = { home: process.env.MF_MADP_ENGINE_HOME, py: process.env.MF_MADP_PYTHON };
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  for (const k of ["ACCEPT_CODE", "ACCEPT_STEP", "ACCEPT_JSON"]) delete process.env[k];
  if (envBefore.home === undefined) delete process.env.MF_MADP_ENGINE_HOME;
  else process.env.MF_MADP_ENGINE_HOME = envBefore.home;
  if (envBefore.py === undefined) delete process.env.MF_MADP_PYTHON;
  else process.env.MF_MADP_PYTHON = envBefore.py;
});

/** A product folder with a registry whose api repo checks changes on dev. */
function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-accept-truth-"));
  made.push(root);
  const dir = path.join(root, "madp");
  fs.mkdirSync(dir, { recursive: true });
  const registry = path.join(dir, "books-ab12cd.yml");
  fs.writeFileSync(registry, ["project: books-ab12cd", "default_env: dev", "environments:", "  dev:", "    branch: dev", "repos:", "  api:", `    path: ${path.join(dir, "books-api")}`,
    "    repo: example-org/books-api", "    role: api", "    acceptance:", "      tests:", '        argv: [node, "{file}", "{api_url}"]', '        files: ["test/*.mjs"]', ""].join("\n"));
  const app: OfficialApp = { name: "books-ab12cd", dir, registry, org: "example-org", repos: { api: path.join(dir, "books-api") }, tenant: "", url: "https://books.example.test" };
  return { root, app };
}

/** The official engine as a shell script: `madp accept` prints ACCEPT_STEP as its step line, writes ACCEPT_JSON (when
 *  set) as its result next to the report and exits ACCEPT_CODE; every call's arguments go to calls.log. */
function fakeEngine(root: string): void {
  const home = path.join(root, "engine");
  const cli = path.join(home, "MADP", "orchestrator", "cli");
  fs.mkdirSync(cli, { recursive: true });
  for (const f of ["project.py", "accept.py"]) fs.writeFileSync(path.join(cli, f), "");
  const py = path.join(root, "fake-python.sh");
  fs.writeFileSync(py, [
    "#!/bin/sh",
    "shift 3",
    `echo "args: $*" >> ${JSON.stringify(path.join(root, "calls.log"))}`,
    'dir=""; repo=""; while [ $# -gt 0 ]; do [ "$1" = "--report-dir" ] && dir="$2"; [ "$1" = "--repo" ] && repo="$2"; shift; done',
    'echo "▸ accept[$repo]: $ACCEPT_STEP (2.0s)" >&2',
    'if [ -n "$ACCEPT_JSON" ]; then mkdir -p "$dir"; printf "%s" "$ACCEPT_JSON" > "$dir/20261109-120000-books-dev.json"; echo "result   $dir/20261109-120000-books-dev.json"; fi',
    'exit "${ACCEPT_CODE:-0}"',
    "",
  ].join("\n"), { mode: 0o755 });
  process.env.MF_MADP_ENGINE_HOME = home;
  process.env.MF_MADP_PYTHON = py;
}

const fakeRun = (id = "job-truth-1") => {
  const lines: string[] = [];
  return { id, signal: new AbortController().signal, log: (l: string) => void lines.push(l), iso: () => "2026-11-09T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined, lines };
};

const OWN = "the change's own test";
const COVERS = "calls GET /api/entries/:id (src/routes/entries.ts, which uses src/fx/rates.ts)";

/** madp-accept-result/1 as acceptance_ops.result_data writes it. */
function result(repo: Record<string, unknown>, exit = 12): string {
  return JSON.stringify({ schema: "madp-accept-result/1", exit, repos: [{ repo: "api", env: "dev", commit: "abc1234", reason: "", outcome: "", selection: "changed+covering", unjudged: "", limit: "", ready: "ready: 3 OK answer(s) in a row after 4.0s", fixtures: "ready (3.0s)", seconds: 40, not_run: [], skipped: [], ...repo }] });
}

const FAILED_REPO = {
  status: "failed",
  files: [
    { file: "test/fallback.mjs", verdict: "ok", why: OWN, passed: 4, failed: 0, rc: 0, seconds: 3, reason: "", limit: "", attempts: 1 },
    { file: "test/entries.mjs", verdict: "failed", why: COVERS, passed: 11, failed: 1, rc: 1, seconds: 9, reason: "FAIL entry without a rule has no rate origin (got 'fallback rate')", limit: "", attempts: 1 },
    { file: "test/rbac.mjs", verdict: "not-judged", why: "imports src/fx/rates.ts", passed: 2, failed: 2, rc: 1, seconds: 5, reason: "the environment refused a call (HTTP 429, limit invitations per e-mail per hour): FAIL invite: 429 {…}", limit: "invitations per e-mail per hour", attempts: 1 },
  ],
  checks: [
    { file: "test/entries.mjs", verdict: "failed", reason: "FAIL entry without a rule has no rate origin (got 'fallback rate')", why: COVERS, limit: "" },
    { file: "test/rbac.mjs", verdict: "not-judged", reason: "the environment refused a call (HTTP 429, limit invitations per e-mail per hour): FAIL invite: 429 {…}", why: "imports src/fx/rates.ts", limit: "invitations per e-mail per hour" },
  ],
  unjudged: "limit",
  limit: "invitations per e-mail per hour",
};

describe("the engine's structured result", () => {
  it("carries the checks that failed or could not judge the change, and why each test ran", () => {
    const p = readAcceptResult("api", JSON.parse(result(FAILED_REPO)).repos[0])!;
    expect(p).toMatchObject({ key: "api", status: "failed", failed: 1, files: 3, notJudged: 1, unjudged: "limit", open: ["test/entries.mjs", "test/rbac.mjs"] });
    expect(p.tests!.map((t) => [t.file, t.verdict, t.why])).toEqual([["test/fallback.mjs", "ok", OWN], ["test/entries.mjs", "failed", COVERS], ["test/rbac.mjs", "not-judged", "imports src/fx/rates.ts"]]);
    const out = acceptOutcome([p], [{ key: "api", commit: "abc1234" }]);
    expect(out.checks).toEqual([
      { repo: "api", file: "test/entries.mjs", verdict: "failed", reason: "FAIL entry without a rule has no rate origin (got 'fallback rate')", why: COVERS, limit: "" },
      { repo: "api", file: "test/rbac.mjs", verdict: "not-judged", reason: expect.stringContaining("HTTP 429") as unknown as string, why: "imports src/fx/rates.ts", limit: "invitations per e-mail per hour" },
    ]);
    // both open: the failure first; the not judged one is kept too
    expect(acceptIssues(out)).toEqual(["accept-failed", "accept-not-run"]);
    expect(acceptDetails(out)).toEqual({ "accept-failed": "1/3", "accept-not-run": "limit" });
    expect(out.targets).toEqual([{ key: "api", commit: "abc1234", only: ["test/entries.mjs", "test/rbac.mjs"], why: { "test/entries.mjs": COVERS, "test/rbac.mjs": "imports src/fx/rates.ts" } }]);
    expect(acceptCheckLine(out.checks[0]!)).toBe(`test/entries.mjs (api) did not pass: FAIL entry without a rule has no rate origin (got 'fallback rate') (selected: ${COVERS})`);
    // not a result: null
    expect(readAcceptResult("api", { status: "maybe" })).toBeNull();
  });

  it("is read only from the report folder and only in its own format", () => {
    const { root, app } = product();
    const dir = path.join(app.dir, "reports", "accept");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "r.json"), result(FAILED_REPO));
    fs.writeFileSync(path.join(root, "elsewhere.json"), result(FAILED_REPO));
    fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify({ schema: "something/1" }));
    expect(engineResult(`accept   api: FAILED\nresult   ${path.join(dir, "r.json")}\n`, dir)).toMatchObject({ schema: "madp-accept-result/1" });
    expect(engineResult(`result   ${path.join(root, "elsewhere.json")}\n`, dir)).toBeNull();
    expect(engineResult(`result   ${path.join(dir, "other.json")}\n`, dir)).toBeNull();
    expect(engineResult("accept   api: ok\n", dir)).toBeNull();
  });
});

describe("not judged: open, never a pass, never a failure", () => {
  it("the step lines of the engine and of a lane", () => {
    expect(readAcceptStep("api", "NOT JUDGED: the dev environment was not ready (HTTP 502 from the health check; 3 OK answers in a row were needed within 300s); no test ran"))
      .toMatchObject({ status: "not-judged", unjudged: "ready", files: 0 });
    expect(readAcceptStep("api", 'NOT JUDGED: 2 of 5 file(s) (an environment limit: "invitations per e-mail per hour": test/a.mjs, test/b.mjs); 3 passed, 3 checks'))
      .toMatchObject({ status: "not-judged", unjudged: "limit", files: 5, notJudged: 2 });
    expect(readAcceptStep("api", "NOT JUDGED: 1 of 4 file(s) (the step's time ran out); 3 passed")).toMatchObject({ status: "not-judged", unjudged: "time" });
    // tests that could not start on the engine host (a missing .env, file or module): not judged, never a failure
    expect(readAcceptStep("api", "NOT JUDGED: 2 of 3 file(s) (a test could not start: a file, module or setting it needs is missing on this host: test/sales.mjs, test/purchases.mjs); 1 passed"))
      .toMatchObject({ status: "not-judged", unjudged: "setup", files: 3, notJudged: 2 });
    const setup = readAcceptResult("api", {
      repo: "api", status: "not-judged", unjudged: "setup", fixtures: "ready (1.0s)",
      files: [{ file: "test/sales.mjs", verdict: "not-judged", why: "given with --only" }, { file: "test/fine.mjs", verdict: "ok", why: "given with --only" }],
      checks: [{ file: "test/sales.mjs", verdict: "not-judged", reason: "the test could not start (Error: ENOENT: no such file or directory, open '.env')", why: "given with --only", limit: "" }],
    })!;
    expect(setup).toMatchObject({ status: "not-judged", unjudged: "setup", failed: 0, notJudged: 1 });
    const both = acceptOutcome([setup, readAcceptStep("web", "NOT JUDGED: 1 of 2 file(s) (the step's time ran out); 1 passed")], [{ key: "api", commit: "abc1234" }]);
    // the one that needs a person comes first
    expect(acceptDetails(both)).toEqual({ "accept-not-run": "setup" });
    expect(both.checks.every((c) => c.verdict === "not-judged")).toBe(true);
    // "Run the checks again" when every file still open is excluded by the registry now: nothing to run, nothing open
    const excluded = readAcceptResult("api", { repo: "api", status: "none", files: [], checks: [], excluded: [{ file: "test/sales.mjs", why: "excluded by the registry (tests.exclude)" }] })!;
    expect(acceptOutcome([excluded], [{ key: "api", commit: "abc1234", only: ["test/sales.mjs"] }])).toMatchObject({ status: "none", checks: [], tests: [] });
    expect(acceptIssues(acceptOutcome([excluded], [{ key: "api", commit: "abc1234" }]))).toEqual([]);
    expect(readAcceptStep("api", 'FAILED: 1 of 5 file(s): test/x.mjs (30 passed, 2 failed); 2 not judged (an environment limit: "HTTP 429")'))
      .toMatchObject({ status: "failed", failed: 1, files: 5, notJudged: 2, unjudged: "limit" });
    // a lane (exit 12) whose checks could not judge the change: not judged, not turned into a failure
    const lane = acceptFromLane([{ name: "accept[api]", outcome: "NOT JUDGED: the test data's first calls met an environment that was not ready (HTTP 502, 3 tries); no test ran", seconds: 9 }], [{ key: "api", commit: "abc1234" }]);
    expect(lane).toMatchObject({ status: "not-judged", unjudged: "ready" });
    expect(acceptIssues(lane)).toEqual(["accept-not-run"]);
    expect(acceptDetails(lane)).toEqual({ "accept-not-run": "ready" });
  });

  it("the page's line says what happens next; the ErrorCode carries why", () => {
    for (const [d, words] of [["setup", "could not start on the engine host"], ["ready", "the environment was not ready yet"], ["limit", "a limit of the environment"], ["time", "ran out of time"]] as const) {
      const code = afterDeployCode(["accept-not-run"], { "accept-not-run": d });
      expect(code).toBe(`after-deploy:accept-not-run=${d}`);
      expect(afterDeployDetails(code)).toEqual({ "accept-not-run": d });
      const a = jobAttention({ kind: "change.build", status: "succeeded", errorCode: code })!;
      expect(a.line).toBe(acceptNotRunLine(d));
      expect(a.line).toContain(words);
      expect(a.line).toContain("Nothing failed");
      expect(a.line).toContain('"Finish the steps after the deploy"');
      expect(a.retry).toBe(true);
    }
    // the failure stays first when both are open
    expect(attentionOf(["accept-not-run", "accept-failed"], { "accept-failed": "1/3", "accept-not-run": "limit" })!.line).toBe(acceptFailedLine("1/3"));
  });

  it("no line of a change's own checks points at a team or a host's files", () => {
    const lines = [acceptFailedLine(), acceptFailedLine("1/2"), acceptFailedLine("fixtures"), acceptNotRunLine(), acceptNotRunLine("setup"), acceptNotRunLine("ready"), acceptNotRunLine("limit"), acceptNotRunLine("time"),
      AFTER_DEPLOY_LINE["accept-failed"], AFTER_DEPLOY_LINE["accept-not-run"]];
    for (const l of lines) {
      expect(l).not.toMatch(/engine team|has the details/i);
      // what happens next: the checks run again, or (a change's failed checks) a fix round of the change
      expect(l).toMatch(/"Finish the steps after the deploy"|in a fix round of the change\.$/);
    }
    expect(acceptFailedLine("1/2")).toMatch(/fix round of the change/);
    expect(acceptFailedLine("1/2", "build.run")).toContain('"Finish the steps after the deploy"');
    expect(acceptFailedLine("fixtures")).toContain('"Finish the steps after the deploy"');
  });

  it("madp accept exit 13 with its result: not judged, the checks kept for a retry of only those files", async () => {
    const { root, app } = product();
    fakeEngine(root);
    const run = fakeRun("job-limit");
    process.env.ACCEPT_CODE = String(NOT_JUDGED_EXIT);
    process.env.ACCEPT_STEP = 'NOT JUDGED: 2 of 5 file(s) (an environment limit: "invitations per e-mail per hour": test/c.mjs, test/d.mjs); 3 passed, 3 checks';
    const files = ["a", "b", "e"].map((n) => ({ file: `test/${n}.mjs`, verdict: "ok", why: n === "a" ? OWN : COVERS, passed: 1, failed: 0, rc: 0, seconds: 1, reason: "", limit: "", attempts: 1 }));
    const open = ["c", "d"].map((n) => ({ file: `test/${n}.mjs`, verdict: "not-judged", why: COVERS, passed: null, failed: null, rc: -1, seconds: 0, reason: 'not run: the environment limit "invitations per e-mail per hour" (3 per hour) has no room before 13:00 UTC', limit: "invitations per e-mail per hour", attempts: 0 }));
    process.env.ACCEPT_JSON = result({ status: "not-judged", unjudged: "limit", limit: "invitations per e-mail per hour", files: [...files, ...open],
      checks: open.map((f) => ({ file: f.file, verdict: "not-judged", reason: f.reason, why: f.why, limit: f.limit })) }, 13);
    const targets = [{ key: "api", commit: "abc1234" }];
    const out = await runAcceptance(run as never, app, targets);
    expect(out).toMatchObject({ status: "not-judged", unjudged: "limit", notJudged: 2, files: 5, failed: 0 });
    expect(out.line).toBe(`The change is on dev, but ${acceptNotRunLine("limit").charAt(0).toLowerCase()}${acceptNotRunLine("limit").slice(1)}`);
    expect(out.checks.map((c) => [c.file, c.verdict, c.limit])).toEqual([["test/c.mjs", "not-judged", "invitations per e-mail per hour"], ["test/d.mjs", "not-judged", "invitations per e-mail per hour"]]);
    // the job: succeeded, needs attention, accept-not-run=limit
    const after = await runAfterDeploy({
      data: async () => ({ status: "none", line: "", repos: [], tables: 0, fields: 0 }),
      texts: async () => ({ status: "none", modules: [], line: "" }),
      accept: async () => out,
      log: () => undefined,
    });
    expect(afterDeployCode(after.issues, after.details)).toBe("after-deploy:accept-not-run=limit");
    // kept: the open files only, with why they ran; the checks for the page and the fix
    expect(openAcceptTargets(app, "job-limit")).toEqual([{ key: "api", commit: "abc1234", only: ["test/c.mjs", "test/d.mjs"], why: { "test/c.mjs": COVERS, "test/d.mjs": COVERS } }]);
    expect(acceptChecksOf(app, "job-limit")).toHaveLength(2);
    expect(readAcceptRecord(app).last).toMatchObject({ job: "job-limit", status: "not-judged", notJudged: 2 });

    // "Finish the steps after the deploy": only the open files, which pass now; their reasons are the first run's
    process.env.ACCEPT_CODE = "0";
    process.env.ACCEPT_STEP = "ok: 2 file(s) passed, 2 checks (given files)";
    process.env.ACCEPT_JSON = result({ status: "ok", selection: "given", files: ["c", "d"].map((n) => ({ file: `test/${n}.mjs`, verdict: "ok", why: "given with --only", passed: 1, failed: 0, rc: 0, seconds: 1, reason: "", limit: "", attempts: 1 })), checks: [] }, 0);
    const retry = fakeRun("job-retry");
    const again = await runAcceptance(retry as never, app, openAcceptTargets(app, "job-limit")!);
    expect(fs.readFileSync(path.join(root, "calls.log"), "utf8")).toContain("--repo api --commit abc1234 --only test/c.mjs,test/d.mjs --report-dir");
    expect(again).toMatchObject({ status: "ok", files: 2 });
    expect(again.tests.map((t) => t.why)).toEqual([COVERS, COVERS]);
    expect(openAcceptTargets(app, "job-retry")).toBeNull();
  });

  it("madp accept exit 12 with its result: the failing check by name and reason; an older engine without a result still reads its step line", async () => {
    const { root, app } = product();
    fakeEngine(root);
    process.env.ACCEPT_CODE = "12";
    process.env.ACCEPT_STEP = "FAILED: 1 of 3 file(s): test/entries.mjs (17 passed, 3 failed); 1 not judged (an environment limit: \"invitations per e-mail per hour\")";
    process.env.ACCEPT_JSON = result(FAILED_REPO);
    const out = await runAcceptance(fakeRun("job-12") as never, app, [{ key: "api", commit: "abc1234" }]);
    expect(out).toMatchObject({ status: "failed", failed: 1, files: 3, notJudged: 1 });
    expect(out.checks[0]).toMatchObject({ file: "test/entries.mjs", verdict: "failed", why: COVERS });
    expect(out.line).not.toMatch(/engine team/);
    expect(out.line).not.toMatch(/test\/entries\.mjs/); // names are in the checks, not in the line
    expect(acceptChecksOf(app, "job-12").map((c) => c.file)).toEqual(["test/entries.mjs", "test/rbac.mjs"]);
    // an older engine: no result file
    delete process.env.ACCEPT_JSON;
    const old = await runAcceptance(fakeRun("job-old") as never, app, [{ key: "api", commit: "abc1234" }]);
    expect(old).toMatchObject({ status: "failed", failed: 1, files: 3, checks: [] });
    // exit 13 from an engine without a result: not judged all the same
    process.env.ACCEPT_CODE = "13";
    process.env.ACCEPT_STEP = "NOT JUDGED: the dev environment was not ready (HTTP 502 from the health check; 3 OK answers in a row were needed within 300s); no test ran";
    const nr = await runAcceptance(fakeRun("job-13") as never, app, [{ key: "api", commit: "abc1234" }]);
    expect(nr).toMatchObject({ status: "not-judged", unjudged: "ready" });
    expect(openAcceptTargets(app, "job-13")).toEqual([{ key: "api", commit: "abc1234" }]); // all again: none ran
  });

  it("a pass that ran existing tests covering the change says so", () => {
    const p = readAcceptResult("api", JSON.parse(result({ status: "ok", files: [
      { file: "test/fallback.mjs", verdict: "ok", why: OWN, passed: 4, failed: 0, rc: 0, seconds: 3, reason: "", limit: "", attempts: 1 },
      { file: "test/entries.mjs", verdict: "ok", why: COVERS, passed: 12, failed: 0, rc: 0, seconds: 9, reason: "", limit: "", attempts: 1 },
    ], checks: [] }, 0)).repos[0])!;
    expect(acceptOutcome([p], []).line).toBe("The change's own checks on the development environment passed (2 test files, 1 of them existing tests that cover the changed code).");
  });
});

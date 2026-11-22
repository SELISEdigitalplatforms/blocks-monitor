// A change's own checks on dev run LAST after a deploy (official/acceptance.ts): the lane skips them (--no-accept),
// then the data tables, then the texts, then `madp accept` for the repos the work changed. A failure is the job's
// attention, never a failed build (the code is live); a lane that failed its own checks anyway (exit 12: LaneAttention)
// still gets its data tables and texts. Temp git repos and a fake official engine (a shell script as its python); no
// Blocks call.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/acceptanceAfterDeploy.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  NO_CHECKS, acceptFromLane, acceptOutcome, acceptTargets, acceptanceRepos, engineAccepts, laneWithChecks, openAcceptTargets, readAcceptRecord,
  readAcceptStep, runAcceptance, type AcceptOutcome,
} from "../../server/local/engine/official/acceptance.ts";
import { runAfterDeploy } from "../../server/local/engine/official/afterDeploy.ts";
import { LaneAttention, laneArgs, type WorkResult } from "../../server/local/engine/official/build.ts";
import { laneFailure, runLane, type LaneStep } from "../../server/local/engine/official/madp.ts";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { parseRegistry } from "../../server/local/engine/official/hostRegistry.ts";
import type { DataOutcome } from "../../server/local/engine/official/dataTables.ts";
import type { TextsOutcome } from "../../server/local/engine/official/uilm.ts";
import { JobFailure, type KindWriter } from "../../server/local/engine/run.ts";
import type { EngineJobKind } from "../../src/domain/engineJob";
import { acceptFailedLine, afterDeployCode, afterDeployDetails, attentionOf, jobAttention, openAttention } from "../../src/domain/afterDeploy";
import { makeWorld, type World } from "./harness";

const made: string[] = [];
const envBefore = { home: process.env.MF_MADP_ENGINE_HOME, py: process.env.MF_MADP_PYTHON };
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (envBefore.home === undefined) delete process.env.MF_MADP_ENGINE_HOME;
  else process.env.MF_MADP_ENGINE_HOME = envBefore.home;
  if (envBefore.py === undefined) delete process.env.MF_MADP_PYTHON;
  else process.env.MF_MADP_PYTHON = envBefore.py;
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}
function commit(repo: string, file: string, body: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `feat: ${file}`);
  return git(repo, "rev-parse", "HEAD").slice(0, 9);
}

/** A product with an API repo (checked on dev) and a web repo (not checked), each with a first commit. */
function product(o: { acceptance?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-accept-test-"));
  made.push(root);
  const dir = path.join(root, "madp");
  const api = path.join(dir, "shop-api");
  const web = path.join(dir, "shop-web");
  for (const r of [api, web]) {
    fs.mkdirSync(r, { recursive: true });
    git(r, "init", "-q", "-b", "dev");
    commit(r, "README.md", "first\n");
  }
  const yml = [
    "project: shop-ab12cd",
    "default_env: dev",
    "environments:",
    "  dev:",
    "    branch: dev",
    `    cli_config_dir: ${path.join(root, "stores", "shop-dev")}`,
    "repos:",
    "  web:",
    `    path: ${web}`,
    "    repo: example-org/shop-web",
    "    role: web",
    "  api:",
    `    path: ${api}`,
    "    repo: example-org/shop-api",
    "    role: api",
    ...(o.acceptance === false ? [] : [
      "    acceptance:",
      "      envs: [dev]",
      "      tests:",
      '        argv: [node, "{file}", "{api_url}"]',
      '        files: ["test/*.mjs"]',
    ]),
    "",
  ].join("\n");
  const registry = path.join(dir, "shop-ab12cd.yml");
  fs.writeFileSync(registry, yml);
  const app: OfficialApp = { name: "shop-ab12cd", dir, registry, org: "example-org", repos: { web, api }, tenant: "", url: "https://shop.example.test" };
  return { root, app, api, web };
}

/** The official engine as a shell script: `madp accept` answers per repo from ACCEPT_<REPO>="<exit>|<step outcome>". */
function fakeEngine(root: string, o: { noAccept?: boolean; accept?: boolean } = {}): string {
  const home = path.join(root, "engine");
  const cli = path.join(home, "MADP", "orchestrator", "cli");
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(cli, "project.py"), "");
  if (o.accept !== false) fs.writeFileSync(path.join(cli, "accept.py"), "");
  else fs.rmSync(path.join(cli, "accept.py"), { force: true });
  for (const f of ["quick.py", "feature.py"]) fs.writeFileSync(path.join(cli, f), o.noAccept === false ? "p.add_argument('--full-verify')\n" : 'p.add_argument("--no-accept", action="store_true")\n');
  const py = path.join(root, "fake-python.sh");
  fs.writeFileSync(py, [
    "#!/bin/sh",
    'shift 3 # -B -m MADP.orchestrator.cli.project',
    // what it was run with, written before it answers (the lane log is flushed only after the lane ends)
    `echo "args: $*" >> ${JSON.stringify(path.join(root, "calls.log"))}`,
    `echo "report dir: $MADP_ACCEPT_REPORT_DIR store: $BLOCKS_CONFIG_DIR project: $MADP_PROJECT_DIR" >> ${JSON.stringify(path.join(root, "calls.log"))}`,
    'repo=""; while [ $# -gt 0 ]; do [ "$1" = "--repo" ] && repo="$2"; shift; done',
    'case "$repo" in api) spec="$ACCEPT_API" ;; web) spec="$ACCEPT_WEB" ;; *) spec="" ;; esac',
    '[ -n "$spec" ] || spec="0|ok: 1 file(s) passed, 3 checks"',
    'code="${spec%%|*}"; outcome="${spec#*|}"',
    'echo "▸ accept[$repo]: $outcome (2.0s)" >&2',
    'exit "$code"',
    "",
  ].join("\n"), { mode: 0o755 });
  process.env.MF_MADP_ENGINE_HOME = home;
  process.env.MF_MADP_PYTHON = py;
  return home;
}

const fakeRun = (id = "job-accept-1") => {
  const lines: string[] = [];
  return { id, signal: new AbortController().signal, log: (l: string) => void lines.push(l), iso: () => "2026-11-05T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined, lines };
};

const data = (o: Partial<DataOutcome> = {}): DataOutcome => ({ status: "none", line: "", repos: [], tables: 0, fields: 0, ...o });
const texts = (o: Partial<TextsOutcome> = {}): TextsOutcome => ({ status: "none", modules: [], line: "", ...o });
const work = (commits: string[], steps: LaneStep[] = []): WorkResult => ({ lane: "feature", commits, seconds: 60, steps });

describe("which repos check a change on dev, and whether the installed engine can run the checks alone", () => {
  it("the repos with an acceptance section for dev, API first; the engine needs madp accept and --no-accept", () => {
    const { root, app } = product();
    const yml = fs.readFileSync(app.registry, "utf8");
    expect(acceptanceRepos(parseRegistry(yml)).map((r) => r.key)).toEqual(["api"]);
    expect(acceptanceRepos({ default_env: "dev", repos: { a: { acceptance: { envs: ["stage"] } }, b: { acceptance: {} }, c: {} } }).map((r) => r.key)).toEqual(["b"]);
    expect(engineAccepts(fakeEngine(root))).toBe(true);
    expect(engineAccepts(fakeEngine(root, { noAccept: false }))).toBe(false);
    expect(engineAccepts(fakeEngine(root, { accept: false }))).toBe(false);
    expect(engineAccepts(path.join(root, "nothing-here"))).toBe(false);
  });

  it("the lane skips its own checks only when told to", () => {
    const ask = { product: "Shop", label: "CR-007: Employment categories", goal: "Group employees.", tickets: [], built: [], later: [] };
    expect(laneArgs(ask)).not.toContain("--no-accept");
    expect(laneArgs(ask, { noAccept: true }).at(-1)).toBe("--no-accept");
    expect(laneArgs(ask, { noAccept: true }).slice(0, 4)).toEqual(laneArgs(ask).slice(0, 4));
  });
});

describe("what the checks say, in plain words", () => {
  it("counts from the step lines; a failure names how many test files failed, or that no test could run", () => {
    expect(readAcceptStep("api", "ok: 2 file(s) passed, 37 checks (the change's own tests)")).toMatchObject({ status: "ok", files: 2, failed: 0 });
    expect(readAcceptStep("api", "nothing to run: the change has no live test file and no smoke set is declared")).toMatchObject({ status: "none" });
    expect(readAcceptStep("api", "FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed)")).toMatchObject({ status: "failed", failed: 1, files: 2, fixtures: false });
    expect(readAcceptStep("web", "FAILED: the fixtures could not be prepared (exit 1, 3.0s); no test ran")).toMatchObject({ status: "failed", fixtures: true, files: 0 });

    const failed = acceptOutcome([readAcceptStep("api", "FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed)"), readAcceptStep("web", "ok: 1 file(s) passed")], []);
    expect(failed).toMatchObject({ status: "failed", failed: 1, files: 3, repos: ["api", "web"] });
    // the fact only (what happens next is the build's to say), and never "delivered": not usable yet
    expect(failed.line).toBe("The change is on dev, but not usable yet. Its own checks on the development environment did not pass: 1 of 3 test files failed.");
    expect(failed.line).not.toMatch(/test\/x\.mjs|exit \d/);
    const fixtures = acceptOutcome([readAcceptStep("api", "FAILED: the fixtures could not be prepared (exit 1, 3.0s); no test ran")], []);
    expect(fixtures.line).toBe("The change is on dev, but not usable yet. Its own checks on the development environment did not pass: the test data could not be prepared, so no test ran.");
    expect(acceptOutcome([readAcceptStep("api", "ok: 2 file(s) passed")], [])).toMatchObject({ status: "ok", line: "The change's own checks on the development environment passed (2 test files)." });
    expect(acceptOutcome([readAcceptStep("api", "nothing to run: none")], [])).toMatchObject({ status: "none", line: "" });
  });

  it("the page's line and the job's ErrorCode carry the counts", () => {
    const a = attentionOf(["accept-failed"], { "accept-failed": "1/2" })!;
    // what happens next and who acts: a change goes back to the development team as a fix round; a milestone as feedback
    expect(a.line).toBe("Its own checks on the development environment did not pass: 1 of 2 test files failed. It is not usable there yet: the development team fixes what the checks found in a fix round of the change.");
    expect(attentionOf(["accept-failed"], { "accept-failed": "1/2" }, "build.run")!.line).toMatch(/not usable there yet: send what does not work to the development team as feedback on the milestone; after the fix, "Finish the steps after the deploy" runs the checks again\.$/);
    expect(a.line).not.toMatch(/engine team/);
    expect(a).toMatchObject({ retry: true, security: false, broken: true, top: "accept-failed" });
    const code = afterDeployCode(["texts-failed", "accept-failed"], { "accept-failed": "1/2" });
    expect(code).toBe("after-deploy:accept-failed=1/2,texts-failed");
    expect(afterDeployDetails(code)).toEqual({ "accept-failed": "1/2" });
    const job = jobAttention({ kind: "change.build", status: "succeeded", errorCode: code })!;
    expect(job.line).toBe(`${acceptFailedLine("1/2")} The new texts are not synced yet either.`);
    // the data tables first; the checks after them, in a few words
    expect(attentionOf(["accept-failed", "data-failed"], { "accept-failed": "fixtures" })!.line)
      .toBe("The new data tables did not reach Blocks yet, so new screens may not save until they do. Its own checks on the development environment did not pass either.");
    expect(attentionOf(["accept-not-run"])!.line).toBe('Its own checks on the development environment could not run, so the change is not checked yet. "Finish the steps after the deploy" tries them again; if they still cannot run, the product\'s test setup on the engine host needs a fix.');
    expect(attentionOf(["accept-not-run"])!.line).not.toMatch(/engine team/);
    expect(attentionOf(["accept-not-run"])!.broken).toBe(false);
  });

  it("another build's checks never close a change's own; only a later job of that same change does", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 12, m)).toISOString();
    const cr7 = { id: "j7", kind: "change.build", status: "succeeded", errorCode: "after-deploy:accept-failed=1/2,texts-failed", finishedAt: at(1) };
    const cr8 = { id: "j8", kind: "change.build", status: "succeeded", errorCode: "", finishedAt: at(5) };
    // CR-8 finished clean: CR-7's texts are synced now, its own checks still did not pass
    expect(openAttention(cr7, cr8)).toMatchObject({ issues: ["accept-failed"], details: { "accept-failed": "1/2" } });
    // a later job of CR-7 itself (its retry) that passed is CR-7's newest delivered build: nothing open
    const retry = { id: "j9", kind: "change.build", status: "succeeded", errorCode: "", finishedAt: at(9) };
    expect(openAttention(retry, retry)).toBeNull();
  });

  it("a lane that failed its own checks: the outcome from its steps, failed even when its lines say little", () => {
    const steps: LaneStep[] = [{ name: "deploy[api]", outcome: "succeeded", seconds: 90 }, { name: "accept[api]", outcome: "FAILED: 2 of 4 file(s): a.mjs, b.mjs (10 passed, 3 failed)", seconds: 20 }];
    expect(acceptFromLane(steps, [{ key: "api", commit: "abc1234" }])).toMatchObject({ status: "failed", failed: 2, files: 4, targets: [{ key: "api", commit: "abc1234" }] });
    expect(acceptFromLane([{ name: "deploy[api]", outcome: "succeeded", seconds: 90 }], [{ key: "api", commit: "abc1234" }])).toMatchObject({ status: "failed", repos: ["api"] });
  });
});

describe("madp accept after the steps after the deploy", () => {
  it("runs for each repo the work changed, at its deployed commit, in the product's folder, store and report folder", async () => {
    const { root, app, api, web } = product();
    fakeEngine(root);
    const a = commit(api, "test/categories.mjs", "// live test\n");
    const w = commit(web, "src/page.tsx", "export {};\n");
    const targets = await acceptTargets(app, work([w, a]));
    expect(targets).toEqual([{ key: "api", commit: git(api, "rev-parse", "HEAD") }]);
    const run = fakeRun();
    process.env.ACCEPT_API = "0|ok: 1 file(s) passed, 12 checks (the change's own tests)";
    const out = await runAcceptance(run as never, app, targets);
    delete process.env.ACCEPT_API;
    expect(out).toMatchObject({ status: "ok", files: 1, failed: 0, repos: ["api"] });
    const log = fs.readFileSync(path.join(root, "calls.log"), "utf8");
    expect(log).toContain(`args: accept --project ${app.registry} --env dev --repo api --commit ${targets[0]!.commit} --report-dir ${path.join(app.dir, "reports", "accept")}`);
    expect(log).toContain(`report dir: ${path.join(app.dir, "reports", "accept")} store: ${path.join(root, "stores", "shop-dev")} project: ${app.dir}`);
    // a pass leaves nothing open
    expect(openAcceptTargets(app, run.id)).toBeNull();
    expect(readAcceptRecord(app).last).toMatchObject({ status: "ok", job: run.id });
  });

  it("exit 12 is checks that did not pass (with their counts), exit 3 checks that could not run; both kept for a retry", async () => {
    const { root, app, api } = product();
    fakeEngine(root);
    const targets = [{ key: "api", commit: git(api, "rev-parse", "HEAD") }];
    process.env.ACCEPT_API = "12|FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed)";
    const failed = await runAcceptance(fakeRun("job-a") as never, app, targets);
    expect(failed).toMatchObject({ status: "failed", failed: 1, files: 2 });
    expect(openAcceptTargets(app, "job-a")).toEqual(targets);
    process.env.ACCEPT_API = "3|preflight: accept_secrets_missing";
    const run = fakeRun("job-b");
    const blocked = await runAcceptance(run as never, app, targets);
    delete process.env.ACCEPT_API;
    expect(blocked).toMatchObject({ status: "not-run", notRun: ["api"] });
    expect(blocked.line).toBe('The change is on dev, but its own checks on the development environment could not run, so the change is not checked yet. "Finish the steps after the deploy" tries them again; if they still cannot run, the product\'s test setup on the engine host needs a fix.');
    expect(run.lines.join("\n")).toContain("madp accept exit 3");
    expect(openAcceptTargets(app, "job-b")).toEqual(targets);
    // nothing changed in a repo with checks: nothing to run, no lane started
    expect(await runAcceptance(fakeRun("job-c") as never, app, [])).toEqual(NO_CHECKS);
  });
});

describe("the order and the outcome", () => {
  /** The steps after the deploy with scripted outcomes; records the order they ran in. */
  function scripted(accept?: () => Promise<AcceptOutcome>) {
    const order: string[] = [];
    const notes: string[] = [];
    return {
      order, notes,
      steps: {
        data: async () => (order.push("data"), data({ status: "updated", line: "Data tables updated on Blocks (1 new, 0 changed fields added).", repos: ["api"], tables: 1 })),
        texts: async () => (order.push("texts"), texts({ status: "synced", modules: ["hr"], line: "Texts synced to Blocks Localization." })),
        ...(accept ? { accept: async () => (order.push("accept"), accept()) } : {}),
        log: () => undefined,
        note: async (_t: { status: string; line: string }, key: "data" | "texts" | "accept") => void notes.push(key),
      },
    };
  }

  it("the checks run last, after the data tables and the texts; a failure is the job's attention with its counts", async () => {
    const x = scripted(async () => acceptOutcome([readAcceptStep("api", "FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed)")], [{ key: "api", commit: "abc1234" }]));
    const r = await runAfterDeploy(x.steps);
    expect(x.order).toEqual(["data", "texts", "accept"]);
    expect(x.notes).toEqual(["data", "texts", "accept"]);
    expect(r.issues).toEqual(["accept-failed"]);
    expect(afterDeployCode(r.issues, r.details)).toBe("after-deploy:accept-failed=1/2");
    // no checks: as before
    const none = scripted();
    expect((await runAfterDeploy(none.steps)).issues).toEqual([]);
    expect(none.order).toEqual(["data", "texts"]);
  });

  it("with checks the lane runs with --no-accept, and madp accept runs on what the work deployed", async () => {
    const { root, app, api } = product();
    fakeEngine(root);
    const sha = commit(api, "test/categories.mjs", "// live test\n");
    const seen: boolean[] = [];
    const lanes: string[][] = [];
    const run = fakeRun();
    const lc = await laneWithChecks(run as never, app, async (noAccept) => (seen.push(noAccept), work([sha])), {
      lane: async (_r, args) => (lanes.push(args), { code: 0, stdout: "", tail: [], steps: [{ name: "accept[api]", outcome: "ok: 1 file(s) passed", seconds: 2 }] }),
    });
    expect(seen).toEqual([true]);
    expect(lanes).toEqual([]); // nothing runs before the steps after the deploy
    const x = scripted(lc.accept);
    const r = await runAfterDeploy(x.steps);
    expect(x.order).toEqual(["data", "texts", "accept"]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.slice(0, 8)).toEqual(["accept", "--project", app.registry, "--env", "dev", "--repo", "api", "--commit"]);
    expect(r).toMatchObject({ issues: [], accept: { status: "ok" } });
  });

  it("a lane that failed its own checks anyway (LaneAttention): its data tables and texts still run, and it needs attention, never fails", async () => {
    const { root, app, api } = product();
    fakeEngine(root, { noAccept: false }); // an engine without --no-accept: the lane checks the change itself
    const sha = commit(api, "test/categories.mjs", "// live test\n");
    const steps: LaneStep[] = [{ name: "deploy[api]", outcome: "succeeded", seconds: 90 }, { name: "smoke[api]", outcome: "ok", seconds: 2 }, { name: "accept[api]", outcome: "FAILED: 1 of 1 file(s): test/categories.mjs (4 passed, 1 failed)", seconds: 9 }];
    const seen: boolean[] = [];
    const run = fakeRun("job-lane-12");
    const lc = await laneWithChecks(run as never, app, async (noAccept) => {
      seen.push(noAccept);
      const f = laneFailure("CR-007: Employment categories", { code: 12, tail: [], steps });
      throw new LaneAttention(f.message, f.code, work([sha], steps));
    });
    expect(seen).toEqual([false]);
    expect(lc.work.commits).toEqual([sha]);
    const x = scripted(lc.accept);
    const r = await runAfterDeploy(x.steps);
    expect(x.order).toEqual(["data", "texts", "accept"]);
    expect(r.tables.status).toBe("updated");
    expect(r.texts.status).toBe("synced");
    expect(r.issues).toEqual(["accept-failed"]);
    expect(r.details).toEqual({ "accept-failed": "1/1" });
    // kept for "Finish the steps after the deploy"
    expect(openAcceptTargets(app, "job-lane-12")).toEqual([{ key: "api", commit: git(api, "rev-parse", "HEAD") }]);
    expect(run.lines.join("\n")).toContain("exit 12");
  });

  it("any other lane failure still fails the job; a product without checks runs the lane as before", async () => {
    const { root, app } = product({ acceptance: false });
    fakeEngine(root);
    await expect(laneWithChecks(fakeRun() as never, app, async () => { throw new JobFailure("CR-007 stopped at \"the deployment\".", "madp.deploy"); }))
      .rejects.toMatchObject({ code: "madp.deploy" });
    const seen: boolean[] = [];
    const lc = await laneWithChecks(fakeRun() as never, app, async (noAccept) => (seen.push(noAccept), work(["abc1234"])));
    expect(seen).toEqual([false]);
    expect(lc.accept).toBeUndefined();
  });

  it("the real lane runner reads madp accept's exit and step line (the fake engine)", async () => {
    const { root, app } = product();
    fakeEngine(root);
    process.env.ACCEPT_API = "12|FAILED: 2 of 3 file(s): a.mjs, b.mjs (8 passed, 2 failed)";
    const r = await runLane(fakeRun() as never, ["accept", "--project", app.registry, "--repo", "api"], { projectDir: app.dir, label: "accept", timeoutMs: 20_000 });
    delete process.env.ACCEPT_API;
    expect(r.code).toBe(12);
    expect(r.steps).toEqual([{ name: "accept[api]", outcome: "FAILED: 2 of 3 file(s): a.mjs, b.mjs (8 passed, 2 failed)", seconds: 2 }]);
  });
});

describe("the driver writes the checks' counts into the job's ErrorCode", () => {
  let w: World;
  const WRITER: KindWriter = async () => ({ outputs: [], message: "CR-007 released to dev as 0.3.0.", attention: ["accept-failed"], attentionDetails: { "accept-failed": "1/2" } });
  beforeAll(async () => {
    w = await makeWorld({ writers: async (_k: EngineJobKind) => WRITER });
    await w.settle();
  });
  afterAll(() => w?.close());

  it("succeeded, needs attention: after-deploy:accept-failed=1/2", async () => {
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: {}, key: "accept-code" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job).toMatchObject({ Status: "succeeded", ErrorCode: "after-deploy:accept-failed=1/2" });
    expect(jobAttention({ kind: "change.build", status: "succeeded", errorCode: String(job.ErrorCode) })?.line).toBe(acceptFailedLine("1/2"));
  });
});

// "Fix what the checks found" (src/domain/changeChecks.ts): a change whose own checks fail after its deploy goes back to
// the development team as fix rounds of the same change, bounded by the project's policy, and development is put back to
// the last build whose checks passed when they do not help. What the checks found is read from the acceptance step's
// result and its report (official/failingChecks.ts), recorded on the change and on the engine host; a fix round's lane
// gets the change, the failing checks with their output, the deployed commits and the rule; a revert goes through the
// official quick lane with the reverted files (official/revert.ts). Every deploy gets a version of its own.
// Temp git repos, a fake lane, and the engine's real job runner on the seeded local store; no Blocks call.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/fixChecks.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  failingChecksOfReport, failingChecksSince, fixBlock, plainReason, readFound, reasonOf, recordFound, type FoundEntry,
} from "../../server/local/engine/official/failingChecks.ts";
import { prepareRevert, revertPlan, revertTask, runRevert, undoRevert } from "../../server/local/engine/official/revert.ts";
import { commitOf, describeWork, type WorkAsk } from "../../server/local/engine/official/build.ts";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import type { AcceptOutcome } from "../../server/local/engine/official/acceptance.ts";
import { NO_CHECKS } from "../../server/local/engine/official/acceptance.ts";
import type { LaneResult } from "../../server/local/engine/official/madp.ts";
import { JobFailure, type KindWriter } from "../../server/local/engine/run.ts";
import { deployVersion, devRelease, foundChecks, nextAfterRed, recordChecks } from "../../server/local/engine/kinds/delivery.ts";
import {
  FIX_RULE, afterChecksDecision, baseJobOf, checksPolicyOf, fixRoundOf, latestRun, nextRound, parseChangeChecks, revertOf, serializeChangeChecks,
  serializeChecksPolicy, withRun, type ChecksJob, type ChecksRun,
} from "../../src/domain/changeChecks";
import type { AcceptCheck } from "../../src/domain/afterDeploy";
import { changeVersionAtStart, takenVersions } from "../../src/domain/delivery";
import { makeWorld, type World } from "./harness";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}
function commit(repo: string, file: string, body: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `feat: ${file}`);
  return git(repo, "rev-parse", "HEAD");
}

// ------------------------------------------------------------------ what the checks found

/** An acceptance report as the engine writes it (acceptance_ops.report_lines). */
const REPORT = [
  "# Acceptance — primabook on dev", "", "- **Status:** NEEDS ATTENTION (acceptance failed)", "",
  "## Acceptance on the deployed environment", "",
  "### `api` on dev: FAILED (needs attention; nothing was rolled back)", "",
  "- Commit: `abc123456789`, 42.0s",
  "- Tests: `node --test {file}`, files test/live/*.mjs",
  "- Selection: the live test files the change added or modified", "",
  "| File | Result | Passed | Failed | Exit | Seconds |", "|---|---|---:|---:|---:|---:|",
  "| `test/live/invoices.live.mjs` | FAIL | 10 | 2 | 1 | 4.0 |",
  "| `test/live/customers.live.mjs` | ok | 7 | 0 | 0 | 2.0 |",
  "| `test/live/recurring.live.mjs` | FAIL | - | - | 1 | 1.0 |", "",
  "`test/live/invoices.live.mjs` output (tail, redacted):", "```",
  "# Subtest: creates a recurring invoice",
  "not ok 3 - creates a recurring invoice",
  "  error: 'expected 201, got 500 from /srv/madp/products/primabook/api/src/invoices.ts:88:12'",
  "# tests 12", "# pass 10", "# fail 2", "```", "",
  "`test/live/recurring.live.mjs` output (tail, redacted):", "```",
  "Error: Cannot find module './helpers/schedule.mjs' imported from /home/runner/work/test/live/recurring.live.mjs",
  "```", "",
  "### `web` on dev: FAILED (needs attention; nothing was rolled back)", "",
  "- Commit: `def456789012`, 3.0s — the test fixtures could not be prepared (exit 1), so no test ran",
  "- Fixtures `node fixtures.mjs`: FAILED (exit 1)", "",
  "Fixtures output (tail, redacted):", "```", "login as [redacted] refused: 401", "```", "",
  "## Steps", "| Step | Seconds | Outcome |", "|---|---:|---|", "| accept[api] | 42.0 | FAILED |",
].join("\n");

describe("what the checks found, from the engine's report", () => {
  it("each failing test file by name with a short reason and its redacted output; failed test data as one check", () => {
    const found = failingChecksOfReport(REPORT);
    expect(found.map((f) => `${f.repo}:${f.name}`)).toEqual(["api:test/live/invoices.live.mjs", "api:test/live/recurring.live.mjs", "web:test data (fixtures)"]);
    // the failing test's name with its first error, the counts first; host paths shortened, never shown whole
    expect(found[0]!.reason).toBe("2 of 12 checks failed: creates a recurring invoice: expected 201, got 500 from invoices.ts:88:12");
    expect(found[1]!.reason).toBe("Error: Cannot find module './helpers/schedule.mjs' imported from recurring.live.mjs");
    expect(found[2]!.reason).toBe("the test fixtures could not be prepared (exit 1), so no test ran");
    for (const f of found) expect(f.reason).not.toMatch(/\/srv\/|\/home\//);
    // the output stays as the engine redacted it (for the developers)
    expect(found[0]!.output).toContain("not ok 3 - creates a recurring invoice");
    expect(found[2]!.output).toBe("login as [redacted] refused: 401");
    // a passing file is never a failing check
    expect(found.some((f) => f.name.includes("customers"))).toBe(false);
  });

  it("a short reason never carries a token, colours or a whole host path", () => {
    expect(plainReason("\x1b[31mAuthorization: Bearer abcdefghijklmnopqrstuv failed at C:\\work\\x\\a.mjs\x1b[0m")).toBe("Authorization: [redacted] failed at a.mjs");
    expect(reasonOf("", { passed: 3, failed: 1, exit: 1 })).toBe("1 of 4 checks failed");
    expect(reasonOf("", { exit: 1 })).toBe("the test file ended with an error");
    expect(plainReason("x".repeat(400)).length).toBeLessThanOrEqual(160);
  });

  it("the reports written since the build started; for each repo the newest one", () => {
    const dir = tmp("madp-checks-");
    const app = { dir };
    const accept = path.join(dir, "reports", "accept");
    fs.mkdirSync(accept, { recursive: true });
    const old = path.join(accept, "20261108-old.md");
    fs.writeFileSync(old, REPORT.replace("invoices.live", "stale.live"));
    fs.utimesSync(old, new Date("2026-11-08T10:00:00Z"), new Date("2026-11-08T10:00:00Z"));
    const since = Date.parse("2026-11-09T10:00:00Z");
    const fresh = path.join(accept, "20261109-new.md");
    fs.writeFileSync(fresh, REPORT);
    expect(failingChecksSince(app, since).map((f) => f.name)).toEqual(["test/live/invoices.live.mjs", "test/live/recurring.live.mjs", "test data (fixtures)"]);
    // a later run of the api checks that passed replaces its failures
    const passed = path.join(accept, "20261109-later.md");
    fs.writeFileSync(passed, "## Acceptance on the deployed environment\n\n### `api` on dev: ok\n\n- Commit: `abc`, 1.0s\n");
    fs.utimesSync(passed, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(failingChecksSince(app, since).map((f) => `${f.repo}:${f.name}`)).toEqual(["web:test data (fixtures)"]);
  });

  it("the acceptance step's own result names the failing checks; the report adds their output", () => {
    const own: AcceptCheck[] = [
      { repo: "api", file: "test/live/invoices.live.mjs", verdict: "failed", reason: "FAIL creates a recurring invoice", why: "the change's own test", limit: "" },
      { repo: "api", file: "test/live/limits.live.mjs", verdict: "not-judged", reason: "invitations per hour", why: "", limit: "invitations" },
    ];
    const found = foundChecks({ checks: own }, failingChecksOfReport(REPORT));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ repo: "api", name: "test/live/invoices.live.mjs", reason: "FAIL creates a recurring invoice", why: "the change's own test" });
    expect(found[0]!.output).toContain("expected 201, got 500");
    // an engine without the result: the report's
    expect(foundChecks({ checks: [] }, failingChecksOfReport(REPORT))).toHaveLength(3);
  });

  it("is kept on the engine host by build, so a later round or revert reads exactly that build's", () => {
    const app = { dir: tmp("madp-found-") };
    const entry: FoundEntry = { at: "2026-11-09T10:00:00.000Z", env: "dev", commits: ["abc1234"], targets: [{ key: "api", commit: "abc1234" }], checks: failingChecksOfReport(REPORT) };
    recordFound({ id: "job-1", log: () => undefined }, app, entry);
    expect(readFound(app, "job-1")).toEqual(entry);
    expect(readFound(app, "job-2")).toBeNull();
  });
});

// ------------------------------------------------------------------ the fix round's lane

describe("the fix round's lane", () => {
  const found: FoundEntry = { at: "", env: "dev", commits: ["abc1234def"], targets: [{ key: "api", commit: "abc123456789aa" }], checks: failingChecksOfReport(REPORT).slice(0, 1) };
  const ask: WorkAsk = {
    product: "PrimaBook", label: "CR-005: Recurring invoices", goal: "Invoices that repeat every month.", tickets: [],
    built: [{ id: "t1", number: 41, title: "Recurring invoice records", description: "", acceptance: [], feature: "", done: true }], later: [],
    fix: fixBlock({ round: 1, env: "dev", found, failing: [] }),
  };

  it("gets the failing checks with their output, the deployed commit and the rule, instead of tickets to build", () => {
    const text = describeWork(ask, { codenames: [], private: [] });
    expect(text).toContain("## Fix what the checks found (fix round 1)");
    expect(text).toContain("api at abc123456789");
    expect(text).toContain("### api: test/live/invoices.live.mjs");
    expect(text).toContain("What failed: 2 of 12 checks failed");
    expect(text).toContain("not ok 3 - creates a recurring invoice");
    expect(text).toContain(FIX_RULE);
    expect(text).not.toContain("## Build these");
    // what the change already has stays as it is
    expect(text).toContain("#41 Recurring invoice records");
  });

  it("commits as a fix of the change; a revert as a revert", () => {
    expect(commitOf(ask, { codenames: [], private: [] }).title).toBe("fix: recurring invoices");
    expect(commitOf({ ...ask, fix: undefined, revert: true }, { codenames: [], private: [] }).title).toBe("revert: recurring invoices");
  });
});

// ------------------------------------------------------------------ the revert

/** A product with an API repo whose last two commits are a change whose checks failed. */
function product() {
  const root = tmp("madp-revert-");
  const dir = path.join(root, "madp");
  const api = path.join(dir, "shop-api");
  fs.mkdirSync(api, { recursive: true });
  git(api, "init", "-q", "-b", "dev");
  commit(api, "src/app.ts", "export const app = 1;\n");
  const green = git(api, "rev-parse", "HEAD");
  const c1 = commit(api, "src/invoices.ts", "export const recurring = true;\n");
  fs.writeFileSync(path.join(api, "src/app.ts"), "export const app = 2;\n");
  git(api, "commit", "-q", "-am", "fix: round 1");
  const c2 = git(api, "rev-parse", "HEAD");
  const registry = path.join(dir, "shop.yml");
  fs.writeFileSync(registry, ["project: shop", "default_env: dev", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`, "repos:", "  api:", `    path: ${api}`, "    repo: example-org/shop-api", "    role: api", ""].join("\n"));
  const app: OfficialApp = { name: "shop", dir, registry, org: "example-org", repos: { api }, tenant: "", url: "https://shop.example.test" };
  return { app, api, green, c1, c2 };
}
const fakeRun = (id = "job-revert") => ({ id, signal: new AbortController().signal, log: () => undefined, iso: () => "2026-11-09T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined });
const ASK: WorkAsk = { product: "Shop", label: "CR-005: Recurring invoices", goal: "", tickets: [], built: [], later: [] };

describe("putting development back to the last build whose checks passed", () => {
  it("finds the repos of the red builds' commits and puts their exact revert in the working tree", async () => {
    const { app, api, green, c1, c2 } = product();
    const plan = await revertPlan(app, [c1.slice(0, 9), c2.slice(0, 9), "0000000"]);
    expect(plan).toEqual([{ key: "api", path: api, commits: [c2, c1] }]);
    const files = await prepareRevert(plan[0]!, "CR-005");
    expect(files).toEqual(["src/app.ts", "src/invoices.ts"]);
    // the tree is the green build's again
    expect(fs.readFileSync(path.join(api, "src/app.ts"), "utf8")).toBe(git(api, "show", `${green}:src/app.ts`) + "\n");
    expect(fs.existsSync(path.join(api, "src/invoices.ts"))).toBe(false);
    await undoRevert(plan[0]!);
    expect(git(api, "status", "--porcelain")).toBe("");
  });

  it("goes through the quick lane with exactly those files, then the commit is a revert on dev", async () => {
    const { app, api, c1, c2 } = product();
    const plan = await revertPlan(app, [c1, c2]);
    const calls: string[][] = [];
    const lane = async (_r: unknown, args: string[]): Promise<LaneResult> => {
      calls.push(args);
      git(api, "add", "-A");
      git(api, "commit", "-q", "-m", "revert(api): recurring invoices");
      const sha = git(api, "rev-parse", "HEAD");
      return { code: 0, stdout: "", tail: [], steps: [{ name: "commit[api]", outcome: sha.slice(0, 9), seconds: 1 }] };
    };
    const work = await runRevert(fakeRun() as never, app, ASK, plan, { onStep: async () => undefined, noAccept: true, lane });
    expect(calls).toHaveLength(1);
    const args = calls[0]!;
    expect(args.slice(0, 2)).toEqual(["quick", "--task-file"]);
    expect(args).toEqual(expect.arrayContaining(["--target", "api", "--allow-dirty", "--no-accept", "--include", "src/app.ts", "--include", "src/invoices.ts"]));
    expect(args[args.indexOf("--title") + 1]).toBe("revert: recurring invoices");
    const task = fs.readFileSync(args[2]!, "utf8");
    expect(task).toContain("Do not change any file: the revert is complete as it is.");
    expect(work.commits).toEqual([git(api, "rev-parse", "HEAD").slice(0, 9)]);
    expect(git(api, "status", "--porcelain")).toBe("");
  });

  it("a lane that stops before its commit leaves the code as it was", async () => {
    const { app, api, c1, c2 } = product();
    const head = git(api, "rev-parse", "HEAD");
    const plan = await revertPlan(app, [c1, c2]);
    const lane = async (): Promise<LaneResult> => ({ code: 5, stdout: "", tail: ["gate failed"], steps: [{ name: "gate[api]", outcome: "FAIL", seconds: 3 }] });
    await expect(runRevert(fakeRun() as never, app, ASK, plan, { onStep: async () => undefined, lane })).rejects.toBeInstanceOf(JobFailure);
    expect(git(api, "rev-parse", "HEAD")).toBe(head);
    expect(git(api, "status", "--porcelain")).toBe("");
  });

  it("never mixes in uncommitted work, and stops when later work changed the same lines", async () => {
    const { app, api, c1, c2 } = product();
    const plan = await revertPlan(app, [c1, c2]);
    fs.writeFileSync(path.join(api, "notes.txt"), "someone's work\n");
    await expect(prepareRevert(plan[0]!, "CR-005")).rejects.toMatchObject({ code: "checks.revert_dirty" });
    fs.rmSync(path.join(api, "notes.txt"));
    fs.writeFileSync(path.join(api, "src/app.ts"), "export const app = 3;\n");
    git(api, "commit", "-q", "-am", "feat: later work on the same line");
    await expect(prepareRevert({ ...plan[0]!, commits: [c2] }, "CR-005")).rejects.toMatchObject({ code: "checks.revert_conflict" });
    expect(git(api, "status", "--porcelain")).toBe("");
  });

  it("its task names the commits and the files", () => {
    const t = revertTask({ product: "Shop", label: "CR-005: Recurring invoices", repo: "api", commits: ["abc123456789ff"], files: ["src/a.ts"] });
    expect(t).toContain("abc123456789");
    expect(t).toContain("- src/a.ts");
  });
});

// ------------------------------------------------------------------ the rounds (pure)

const job = (id: string, input: Record<string, unknown> = {}, status = "succeeded"): ChecksJob => ({ id, kind: "change.build", status, inputJson: JSON.stringify({ changeRequestId: "cr-5", ...input }) });
const round = (id: string, n: number, after: string, auto = true, status = "succeeded") => job(id, { fixChecks: true, afterJobId: after, baseJobId: "base", round: n, auto }, status);
const POLICY = checksPolicyOf(null);

describe("what the engine starts by itself after checks that failed", () => {
  it("the default policy: two automatic fix rounds, then development is put back", () => {
    expect(POLICY).toEqual({ autoFixRounds: 2, autoRevert: true });
    const base = job("base");
    expect(afterChecksDecision([base], base, 6, POLICY)).toEqual({ action: "fix", next: { round: 1, baseJobId: "base", afterJobId: "base" } });
    const r1 = round("r1", 1, "base");
    expect(afterChecksDecision([base, r1], r1, 4, POLICY)).toEqual({ action: "fix", next: { round: 2, baseJobId: "base", afterJobId: "r1" } });
    const r2 = round("r2", 2, "r1");
    expect(afterChecksDecision([base, r1, r2], r2, 2, POLICY)).toEqual({ action: "revert", baseJobId: "base" });
    // a revert ran already for that build: never again by itself
    const rev = job("rev", { revertChecks: true, afterJobId: "r2", baseJobId: "base", auto: true });
    expect(afterChecksDecision([base, r1, r2, rev], r2, 2, POLICY)).toEqual({ action: "wait", why: "rounds-used" });
  });

  it("a person decides: policy off, a round a person started, or no test that failed", () => {
    const base = job("base");
    expect(afterChecksDecision([base], base, 6, checksPolicyOf(serializeChecksPolicy({ autoFixRounds: 0, autoRevert: true })))).toEqual({ action: "wait", why: "policy-off" });
    const mine = round("r1", 1, "base", false);
    expect(afterChecksDecision([base, mine], mine, 3, POLICY)).toEqual({ action: "wait", why: "person-started" });
    expect(afterChecksDecision([base], base, 0, POLICY)).toEqual({ action: "wait", why: "no-failing-tests" });
    // rounds used and no automatic revert
    const r1 = round("r1", 1, "base");
    const r2 = round("r2", 2, "r1");
    expect(afterChecksDecision([base, r1, r2], r2, 2, { autoFixRounds: 2, autoRevert: false })).toEqual({ action: "wait", why: "rounds-used" });
    // one automatic round allowed
    expect(afterChecksDecision([base, r1], r1, 2, { autoFixRounds: 1, autoRevert: false })).toEqual({ action: "wait", why: "rounds-used" });
  });

  it("round numbers count every round of the base build, a stopped one too; a re-run of the checks belongs to its build", () => {
    const base = job("base");
    const stopped = round("r1", 1, "base", true, "failed");
    expect(nextRound([base, stopped], base)).toMatchObject({ round: 2, baseJobId: "base" });
    const recheck = job("again", { afterDeploy: true, afterJobId: "r1" });
    expect(baseJobOf(recheck, [base, round("r1", 1, "base"), recheck])).toBe("base");
    expect(fixRoundOf(round("r1", 1, "base"))).toMatchObject({ round: 1, auto: true, baseJobId: "base", afterJobId: "base" });
    expect(revertOf(job("rev", { revertChecks: true, afterJobId: "r2", baseJobId: "base" }))).toMatchObject({ baseJobId: "base", afterJobId: "r2" });
    expect(fixRoundOf(base)).toBeNull();
  });

  it("the record on the change keeps the newest runs within its size", () => {
    const run = (i: number): ChecksRun => ({
      jobId: `j${i}`, kind: "fix", env: "dev", at: "", status: "failed", version: `0.10.${i}`, commits: ["abc1234"], failed: 1, files: 2, fixtures: false,
      failing: Array.from({ length: 30 }, (_, k) => ({ repo: "api", name: `test/live/${"x".repeat(150)}${k}.mjs`, reason: "y".repeat(300) })), round: i, auto: true, baseJobId: "base",
    });
    let c = null as ReturnType<typeof parseChangeChecks>;
    for (let i = 0; i < 30; i++) c = withRun(c, run(i));
    const text = serializeChangeChecks(c!);
    expect(text.length).toBeLessThanOrEqual(20_000);
    const back = parseChangeChecks(text)!;
    expect(latestRun(back)!.jobId).toBe("j29");
    expect(latestRun(back)!.failing[0]!.reason.length).toBeLessThanOrEqual(200);
    // a restarted job replaces its own run
    expect(withRun(back, { ...run(29), status: "ok" }).runs.filter((r) => r.jobId === "j29")).toHaveLength(1);
    expect(parseChangeChecks("not json")).toBeNull();
    expect(checksPolicyOf("{bad")).toEqual(POLICY);
    expect(checksPolicyOf(JSON.stringify({ autoFixRounds: 9, autoRevert: false }))).toEqual({ autoFixRounds: 2, autoRevert: false });
  });
});

// ------------------------------------------------------------------ the version a deploy gets

describe("every deploy gets a version of its own", () => {
  const fakeVersionRun = (o: { id: string; input: Record<string, unknown>; releases: Record<string, unknown>[]; changes?: Record<string, unknown>[]; jobs?: Record<string, unknown>[] }) => ({
    id: o.id, input: o.input,
    p: {
      releases: (env: string) => o.releases.filter((r) => r.Environment === env),
      rows: (schema: string) => (schema === "Release" ? o.releases : schema === "ChangeRequest" ? o.changes ?? [] : schema === "EngineJob" ? o.jobs ?? [] : []),
    },
  });

  it("the job's own version, never the change request's older one (built as 0.14.0, never reported as 0.13.0)", () => {
    const run = fakeVersionRun({ id: "j14", input: { version: "0.14.0" }, releases: [{ Environment: "dev", Version: "0.13.0", EngineJobId: "j13" }] });
    expect(deployVersion(run as never, { Version: "0.13.0" }, "cr-5")).toBe("0.14.0");
  });

  it("a version another deploy holds moves to the next free patch; a restarted job keeps its own", () => {
    const releases = [{ Environment: "dev", Version: "0.10.0", EngineJobId: "other" }];
    expect(deployVersion(fakeVersionRun({ id: "mine", input: { version: "0.10.0" }, releases }) as never, {}, "cr-6")).toBe("0.10.1");
    const restarted = [...releases, { Environment: "dev", Version: "0.10.1", EngineJobId: "mine" }];
    expect(deployVersion(fakeVersionRun({ id: "mine", input: { version: "0.10.0" }, releases: restarted }) as never, {}, "cr-6")).toBe("0.10.1");
    // a build that started and never finished still holds its version
    const jobs = [{ ItemId: "stopped", Kind: "change.build", InputJson: JSON.stringify({ version: "0.11.0" }) }];
    expect(deployVersion(fakeVersionRun({ id: "mine", input: { version: "0.11.0" }, releases: [], jobs }) as never, {}, "cr-6")).toBe("0.11.1");
  });
});

// ------------------------------------------------------------------ the loop on the engine's job runner

const PROJECT = "Service Technician Portal";
const s = (v: unknown) => (typeof v === "string" ? v : "");
/** The scripted outcome of each deploy: test files that fail (of 38). */
const FAILING: Record<string, number> = { build: 6, "1": 4, "2": 2, revert: 0 };

function outcome(failed: number): AcceptOutcome {
  const checks: AcceptCheck[] = Array.from({ length: failed }, (_, i) => ({ repo: "api", file: `test/live/f${i + 1}.live.mjs`, verdict: "failed", reason: `expected 201, got 500 (${i + 1})`, why: "the change's own test", limit: "" }));
  return failed
    ? { ...NO_CHECKS, status: "failed", line: "", repos: ["api"], failed, files: 38, targets: [{ key: "api", commit: "abc1234" }], checks }
    : { ...NO_CHECKS, status: "ok", line: "", repos: ["api"], files: 38, targets: [{ key: "api", commit: "abc1234" }] };
}

describe("the PrimaBook case on the engine's job runner: checks fail after the deploy", () => {
  let w: World;
  let pid = "";
  let appDir = "";
  const seen: Array<{ id: string; cr: string; what: string; version: string; next: string | null }> = [];
  // the change.build writer, reduced to what this test is about: the version, the release, what the checks found and
  // what happens next (the lane, the data tables and the texts are other tests')
  const WRITER: KindWriter = async (run) => {
    const crId = s(run.input.changeRequestId);
    const cr = run.p.row("ChangeRequest", crId)!;
    const app = { name: "primabook", dir: appDir, registry: "", org: "", repos: {}, tenant: "", url: "" } as OfficialApp;
    const f = fixRoundOf({ kind: "change.build", inputJson: JSON.stringify(run.input) });
    const r = revertOf({ kind: "change.build", inputJson: JSON.stringify(run.input) });
    const version = r ? r.version : f ? f.version : deployVersion(run, cr, crId);
    await devRelease(run, { version, changeRequestIds: r ? [] : [crId], url: "https://dev.example.test" });
    const checks = outcome(FAILING[r ? "revert" : f ? String(f.round) : "build"]!);
    await recordChecks(run, app, crId, { kind: r ? "revert" : f ? "fix" : "build", round: f?.round ?? 0, auto: f?.auto ?? r?.auto ?? false, baseJobId: f?.baseJobId ?? r?.baseJobId ?? "", version, commits: ["abc1234"], checks, sinceMs: Date.now() + 60_000 });
    const next = checks.status === "failed" ? await nextAfterRed(run, crId, checks, version) : null;
    seen.push({ id: run.id, cr: crId, what: r ? "revert" : f ? `round ${f.round}${f.auto ? " (auto)" : ""}` : "build", version, next });
    return { outputs: [`ChangeRequest:${crId}`], message: "done", ...(checks.status === "failed" ? { attention: ["accept-failed"], attentionDetails: { "accept-failed": `${checks.failed}/38` } } : {}) };
  };

  beforeAll(async () => {
    w = await makeWorld({ writers: async () => WRITER });
    pid = s(w.project(PROJECT).ItemId);
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-primabook-"));
  });
  afterAll(async () => {
    await w?.close();
    if (appDir) fs.rmSync(appDir, { recursive: true, force: true });
  });

  async function change(n: number): Promise<string> {
    const p = w.project(PROJECT);
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: n, Lane: "add", FeatureRef: "", Title: "Recurring invoices", Description: "Invoices that repeat every month.",
      Status: "released-dev", Version: "0.10.0", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: `t:cr:${n}`,
    });
    return res.itemId!;
  }

  /** The version cr.startBuild gives the next change build: a minor above every version held now. */
  const nextVersion = () => changeVersionAtStart("add", takenVersions({
    releases: w.rows("Release", pid).map((r) => s(r.Version)), changes: w.rows("ChangeRequest", pid).map((c) => s(c.Version)),
    jobs: w.rows("EngineJob", pid).map((j) => ({ inputJson: s(j.InputJson) })),
  }))!;
  const patch = (v: string, n: number) => v.replace(/\.0$/, `.${n}`);

  it("two automatic fix rounds with patch versions, then development is put back; each recorded on the change", async () => {
    await w.settle(); // the seeded project's own queued work first
    const crId = await change(95);
    const v = nextVersion();
    expect(v).toMatch(/^\d+\.\d+\.0$/);
    const base = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId, version: v }, target: { type: "ChangeRequest", id: crId }, key: "primabook-base" });
    await w.settle();
    expect(seen.filter((x) => x.cr === crId).map((x) => `${x.what} ${x.version} -> ${x.next ?? "green"}`)).toEqual([
      `build ${v} -> fixing`,
      `round 1 (auto) ${patch(v, 1)} -> fixing`,
      `round 2 (auto) ${patch(v, 2)} -> reverting`,
      `revert ${patch(v, 3)} -> green`,
    ]);
    const jobs = w.rows("EngineJob", pid).filter((j) => j.Kind === "change.build" && JSON.parse(s(j.InputJson)).changeRequestId === crId);
    expect(jobs.map((j) => j.Status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
    const r1 = jobs.find((j) => fixRoundOf({ kind: "change.build", inputJson: s(j.InputJson) })?.round === 1)!;
    // the round follows the build whose checks failed (one active round per build it follows), and carries its version
    expect(JSON.parse(s(r1.InputJson))).toMatchObject({ fixChecks: true, afterJobId: base, baseJobId: base, round: 1, auto: true, version: patch(v, 1) });
    expect(r1).toMatchObject({ TargetType: "EngineJob", TargetId: base });
    expect(w.get("EngineJob", base).ErrorCode).toBe("after-deploy:accept-failed=6/38");
    // every deploy its own version; the change names what is on dev now
    const versions = w.rows("Release", pid).filter((r) => r.Environment === "dev").map((r) => s(r.Version));
    expect(versions).toEqual(expect.arrayContaining([v, patch(v, 1), patch(v, 2), patch(v, 3)]));
    expect(new Set(versions).size).toBe(versions.length);
    const record = parseChangeChecks(w.get("ChangeRequest", crId).Checks)!;
    expect(record.runs.map((r) => `${r.kind}:${r.round}:${r.status}:${r.version}`)).toEqual([`build:0:failed:${v}`, `fix:1:failed:${patch(v, 1)}`, `fix:2:failed:${patch(v, 2)}`, `revert:0:ok:${patch(v, 3)}`]);
    expect(record.runs[0]!.failing.map((f) => f.name)).toHaveLength(6);
    expect(record.runs[0]!.failing[0]).toEqual({ repo: "api", name: "test/live/f1.live.mjs", reason: "expected 201, got 500 (1)" });
    // what the checks found is kept on the engine host for the fix round, by build
    expect(readFound({ dir: appDir }, base)?.checks).toHaveLength(6);
  });

  it("with automatic fixes off, nothing starts by itself: a person decides", async () => {
    await w.gw.update("Project", pid, { ChecksPolicy: serializeChecksPolicy({ autoFixRounds: 0, autoRevert: true }) });
    const crId = await change(96);
    const v = nextVersion();
    await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId, version: v }, target: { type: "ChangeRequest", id: crId }, key: "primabook-off" });
    await w.settle();
    expect(seen.filter((x) => x.cr === crId).map((x) => `${x.what} ${x.version} -> ${x.next}`)).toEqual([`build ${v} -> you`]);
  });
});

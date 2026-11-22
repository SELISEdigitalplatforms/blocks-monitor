// A change's build hands the official lanes two things for long-lived products (official/build.ts, acceptance.ts):
// the change's record (`--change-record`: the analysis as approved, its increments and tickets, in neutral words; the
// engine writes it to docs/changes/<id>.md in the product repo and commits it with the build) and a fix round's live
// checks (`--live-check`: the live tests that failed on dev, reproduced there before the developers start, then run
// again by `madp accept --also` after the steps after the deploy). Both only when the installed engine takes them.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/changeRecordAndLiveChecks.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptTargets, engineAcceptOptions, engineAcceptsAlso, openAcceptTargets, runAcceptance, type AcceptLane } from "../../server/local/engine/official/acceptance.ts";
import { changeRecordOf, engineLaneOptions, laneArgs, liveChecksOf, type WorkAsk } from "../../server/local/engine/official/build.ts";
import { reportedChecks, type FoundEntry } from "../../server/local/engine/official/failingChecks.ts";
import { changeRecordPath, prepareRevert, revertPlan, runRevert } from "../../server/local/engine/official/revert.ts";
import type { LaneResult } from "../../server/local/engine/official/madp.ts";
import type { AcceptCheck } from "../../src/domain/afterDeploy";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { plainStep } from "../../server/local/engine/official/madp.ts";
import { recordText, type Terms } from "../../server/local/engine/official/neutral.ts";
import type { BuildTicket, ChangeBrief } from "../../server/local/engine/build/prompt.ts";

const TERMS: Terms = { codenames: ["AGIS"], private: ["Anna Muster", "anna.muster@example.com"] };
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ticket = (n: number, extra: Partial<BuildTicket> = {}): BuildTicket => ({
  id: `t${n}`, number: n, title: `Ticket ${n}`, description: `Do thing ${n}.`, acceptance: [`criterion ${n}a`], feature: "", done: false, ...extra,
});
const change = (extra: Partial<ChangeBrief> = {}): ChangeBrief => ({
  kind: "feature",
  summary: "Rates come from a tariff hierarchy, as in AGIS. Asked by Anna Muster (anna.muster@example.com).",
  touches: ["Features: Projects, Time"],
  acceptanceCriteria: ["A project rule beats the member's own rate", "@anna checks the totals"],
  answers: [{ question: "Travel at 50 %?", answer: "Yes, from the tariff" }],
  risks: ["Existing entries keep their stored rate"],
  conflicts: [],
  feature: {
    increment: 2, of: 3, title: "Entries", goal: "Time entries keep their tariff", parts: ["API", "web app"],
    codeAreas: ["api: src/projects/repo.ts"], earlier: ["Increment 1: Tariff rules: Rules and their precedence"],
    later: ["Increment 3: Invoices: Invoices use the entry's tariff"],
  },
  ...extra,
});
const ask = (label: string, extra: Partial<WorkAsk> = {}): WorkAsk => ({
  product: "PrimaBook", label, goal: "Time entries keep the tariff they were booked with.",
  tickets: [ticket(41, { title: "Keep the tariff on entries", comments: ["Anna: please hurry"] }), ticket(40, { done: true })],
  built: [], later: [], ...extra,
});

describe("the change's record for the product repo", () => {
  it("an increment of a feature: the analysis, its increments with their state and this build's tickets, in neutral words", () => {
    const r = changeRecordOf(ask("CR-005: Tariff hierarchy (increment 2 of 3: Entries)", { change: change() }), TERMS)!;
    expect(r).toMatchObject({
      schema: "madp-change-record/1", id: "CR-005", title: "Tariff hierarchy", kind: "feature",
      round: { kind: "increment", n: 2, of: 3, title: "Entries", goal: "Time entries keep their tariff" },
      increments: [
        { n: 1, title: "Tariff rules", goal: "Rules and their precedence", state: "built" },
        { n: 2, title: "Entries", goal: "Time entries keep their tariff", state: "this build" },
        { n: 3, title: "Invoices", goal: "Invoices use the entry's tariff", state: "later" },
      ],
      parts: ["API", "web app"], codeAreas: ["api: src/projects/repo.ts"],
      decisions: [{ question: "Travel at 50 %?", answer: "Yes, from the tariff" }],
      tickets: [{ number: 41, title: "Keep the tariff on entries", acceptance: ["criterion 41a"] }],
    });
    // no codename, person, e-mail or mention; the tickets' comments are not part of it
    expect(r.summary).toBe("Rates come from a tariff hierarchy, as in the previous software.");
    expect(r.acceptanceCriteria).toEqual(["A project rule beats the member's own rate", "checks the totals"]);
    expect(JSON.stringify(r)).not.toMatch(/AGIS|Anna|Muster|example\.com|@anna|hurry/);
  });

  it("a change and a fix; a milestone has none", () => {
    expect(changeRecordOf(ask("CR-7: Rename the Save button", { change: change({ kind: "change", feature: undefined }) }), TERMS)).toMatchObject({
      id: "CR-7", kind: "change", round: { kind: "build" }, increments: [],
    });
    expect(changeRecordOf(ask("FX-12: The entry loses its tariff"), TERMS)).toMatchObject({
      id: "FX-12", kind: "fix", round: { kind: "fix" }, summary: "Time entries keep the tariff they were booked with.",
    });
    expect(changeRecordOf(ask("Milestone 2: Rooms"), TERMS)).toBeNull();
    expect(recordText("Keep the rate. The owner wants it by Monday. Mail x@y.org now.", TERMS)).toBe("Keep the rate. Mail now.");
  });
});

describe("the change's record of a fix round and of a revert", () => {
  const fixes = { feature: change().feature!, tickets: [ticket(41, { title: "Keep the tariff on entries", done: true })] };

  it("a fix round: its number and the increment it fixes; the head keeps that build's increment and tickets", () => {
    const r = changeRecordOf(ask("CR-005: Tariff hierarchy", { change: change({ feature: undefined }), tickets: [], fix: "## Fix what the checks found (fix round 2)", fixes: { round: 2, ...fixes } }), TERMS)!;
    expect(r).toMatchObject({
      id: "CR-005", kind: "feature", round: { kind: "fix-round", n: 2, title: "increment 2 of 3: Entries" },
      increments: [{ n: 1, state: "built" }, { n: 2, state: "this build" }, { n: 3, state: "later" }],
      parts: ["API", "web app"], codeAreas: ["api: src/projects/repo.ts"],
      tickets: [{ number: 41, title: "Keep the tariff on entries", acceptance: ["criterion 41a"] }],
    });
    // a change without increments: the round is a fix round all the same
    expect(changeRecordOf(ask("CR-7: Rename the Save button", { tickets: [], fix: "x", fixes: { round: 1, tickets: [] } }), TERMS)!.round).toEqual({ kind: "fix-round", n: 1 });
  });

  it("a revert: development put back; the increment it took off is to be built again", () => {
    const r = changeRecordOf(ask("CR-005: Tariff hierarchy", { change: change({ feature: undefined }), tickets: [], revert: true, fixes }), TERMS)!;
    expect(r.round).toEqual({ kind: "revert", n: 2, of: 3, title: "Entries" });
    expect(r.increments.map((i) => `${i.n}:${i.state}`)).toEqual(["1:built", "2:later", "3:later"]);
    expect(r.tickets.map((t) => t.number)).toEqual([41]);
    expect(r.summary).toBe("Rates come from a tariff hierarchy, as in the previous software.");
  });
});

describe("what a fix round's lane starts from", () => {
  const failed: AcceptCheck = { repo: "api", file: "test/tariffs.mjs", verdict: "failed", reason: "FAIL net 240 != 300", why: "the change's own test", limit: "" };
  const limited: AcceptCheck = { repo: "api", file: "test/rates.mjs", verdict: "not-judged", reason: "429", why: "calls GET /api/rates", limit: "invitations" };
  const found = (o: Partial<FoundEntry> = {}): FoundEntry => ({ at: "", env: "dev", commits: [], targets: [], checks: [], ...o });

  it("the acceptance step's result kept with the build, else accept.json's, with the checks that could not judge", () => {
    expect(reportedChecks(found({ reported: [failed, limited] }), [], [])).toEqual([failed, limited]);
    expect(reportedChecks(found(), [limited, failed], [])).toEqual([limited, failed]);
    // never a not-judged one, the fixtures or the step as a whole to run again
    expect(liveChecksOf({ failedChecks: reportedChecks(found({ reported: [failed, limited] }), [], []) })).toEqual(["api:test/tariffs.mjs"]);
  });

  it("an engine without that result: the failing checks of its report, else of the change's record, by test file", () => {
    const fromReport = reportedChecks(found({ checks: [
      { repo: "api", name: "test/live/invoices.live.mjs", reason: "2 of 12 checks failed", output: "not ok 3", why: "the change's own test" },
      { repo: "web", name: "test data (fixtures)", reason: "the test fixtures could not be prepared", output: "" },
      { repo: "api", name: "the checks", reason: "the checks did not pass", output: "" },
    ] }), [], []);
    expect(fromReport).toEqual([
      { repo: "api", file: "test/live/invoices.live.mjs", verdict: "failed", reason: "2 of 12 checks failed", why: "the change's own test", limit: "" },
      { repo: "web", file: "", verdict: "failed", reason: "the test fixtures could not be prepared", why: "the test data (fixtures)", limit: "" },
      { repo: "api", file: "", verdict: "failed", reason: "the checks did not pass", why: "", limit: "" },
    ]);
    expect(liveChecksOf({ failedChecks: fromReport })).toEqual(["api:test/live/invoices.live.mjs"]);
    expect(reportedChecks(null, [], [{ repo: "api", name: "test/a.mjs", reason: "boom" }])).toEqual([{ repo: "api", file: "test/a.mjs", verdict: "failed", reason: "boom", why: "", limit: "" }]);
    expect(reportedChecks(null, [], [])).toEqual([]);
  });
});

describe("the lane's options", () => {
  it("--change-record and --live-check only when given; live checks are repo:path inside the repo", () => {
    const a = ask("CR-005: Tariff hierarchy", { liveChecks: ["api:test/tariffs.mjs", " api:test/tariffs.mjs", "api:../x.mjs", "api:/etc/x", "nope", "web:test\\ui.mjs"] });
    expect(liveChecksOf(a)).toEqual(["api:test/tariffs.mjs", "web:test\\ui.mjs"]);
    expect(laneArgs(a).slice(4)).toEqual([]);
    expect(laneArgs(a, { noAccept: true, recordFile: "/w/job.change.json", liveChecks: true }).slice(4)).toEqual([
      "--no-accept", "--change-record", "/w/job.change.json", "--live-check", "api:test/tariffs.mjs", "--live-check", "web:test\\ui.mjs",
    ]);
  });

  it("a fix round from the last deploy's checks: failed test files become live checks, never a not-judged one", () => {
    const a = ask("CR-005: Tariff hierarchy", {
      liveChecks: ["web:test/ui.mjs"],
      failedChecks: [
        { repo: "api", file: "test/tariffs.mjs", verdict: "failed", reason: "FAIL net 240 != 300", why: "the change's own test", limit: "" },
        { repo: "api", file: "test/rates.mjs", verdict: "not-judged", reason: "429", why: "calls GET /api/rates", limit: "invitations" },
        { repo: "api", file: "test/fixtures.mjs", verdict: "failed", reason: "boom", why: "the test data (fixtures)", limit: "" },
        { repo: "api", file: "", verdict: "failed", reason: "no test ran", why: "", limit: "" },
      ],
    });
    expect(liveChecksOf(a)).toEqual(["web:test/ui.mjs", "api:test/tariffs.mjs"]);
    // with the checks file the engine reads the failed ones itself; only the given ones go as --live-check
    expect(laneArgs(a, { liveChecks: true, checksFile: "/w/job.checks.json" }).slice(4)).toEqual([
      "--failed-checks", "/w/job.checks.json", "--live-check", "web:test/ui.mjs",
    ]);
    expect(laneArgs(a, { liveChecks: true }).slice(4)).toEqual(["--live-check", "web:test/ui.mjs", "--live-check", "api:test/tariffs.mjs"]);
  });

  it("the installed engine decides: both lanes must take the option", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "madp-opts-"));
    made.push(home);
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    const none = { changeRecord: false, liveCheck: false, failedChecks: false, fixRound: false, changeCommit: false, diagnosis: false, mergeTurn: false };
    expect(engineLaneOptions(home)).toEqual(none);
    fs.writeFileSync(path.join(cli, "quick.py"), 'p.add_argument("--live-check")\np.add_argument("--change-record")\n');
    fs.writeFileSync(path.join(cli, "feature.py"), 'p.add_argument("--live-check")\n');
    expect(engineLaneOptions(home)).toEqual({ ...none, liveCheck: true });
    // the fix rounds' --change-commit and --diagnosis come with --fix-round (quick.py add_fix_args, both lanes)
    fs.writeFileSync(path.join(cli, "quick.py"), 'p.add_argument("--fix-round")\np.add_argument("--change-commit")\np.add_argument("--diagnosis")\n');
    expect(engineLaneOptions(home)).toEqual(none);
    fs.writeFileSync(path.join(cli, "feature.py"), 'p.add_argument("--fix-round")\n');
    expect(engineLaneOptions(home)).toEqual({ ...none, fixRound: true, changeCommit: true, diagnosis: true });
    // parallel streams: an isolated run that waits for its turn to merge (both lanes)
    fs.writeFileSync(path.join(cli, "quick.py"), 'p.add_argument("--merge-turn")\n');
    expect(engineLaneOptions(home).mergeTurn).toBe(false);
    fs.writeFileSync(path.join(cli, "feature.py"), 'p.add_argument("--merge-turn")\n');
    expect(engineLaneOptions(home)).toEqual({ ...none, mergeTurn: true });
    expect(engineAcceptsAlso(home)).toBe(false);
    fs.writeFileSync(path.join(cli, "accept.py"), 'p.add_argument("--also", action="append")\n');
    expect(engineAcceptsAlso(home)).toBe(true);
  });

  it("the new steps in plain words", () => {
    expect(plainStep("live-debug")).toBe("preparing the checks on the development environment");
    expect(plainStep("reproduce")).toBe("running the failing tests on the development environment");
    expect(plainStep("record[api]")).toBe("the change's record of the API");
  });

  it("the real engine of this checkout takes all of them", () => {
    const home = path.resolve(__dirname, "..", "..", "..", "engine", "selise-madp");
    expect(engineLaneOptions(home)).toEqual({ changeRecord: true, liveCheck: true, failedChecks: true, fixRound: true, changeCommit: true, diagnosis: true, mergeTurn: true });
    expect(engineAcceptsAlso(home)).toBe(true);
    expect(engineAcceptOptions(home)).toEqual({ also: true, changeCommit: true, known: true, passedInRound: true });
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

describe("madp accept runs a fix round's live checks again", () => {
  it("the work's live checks go with their repo's target, to the lane and into the record for a retry", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-also-"));
    made.push(root);
    const dir = path.join(root, "madp");
    const api = path.join(dir, "shop-api");
    fs.mkdirSync(api, { recursive: true });
    git(api, "init", "-q", "-b", "dev");
    fs.writeFileSync(path.join(api, "x.ts"), "x\n");
    git(api, "add", "-A");
    git(api, "commit", "-q", "-m", "fix: keep the tariff");
    const sha = git(api, "rev-parse", "HEAD");
    const registry = path.join(dir, "shop.yml");
    fs.writeFileSync(registry, ["project: shop", "default_env: dev", "environments:", "  dev:", "    branch: dev", "repos:", "  api:", `    path: ${api}`,
      "    repo: example-org/shop-api", "    role: api", "    acceptance:", "      tests:", '        argv: [node, "{file}", "{api_url}"]', '        files: ["test/*.mjs"]', ""].join("\n"));
    const app: OfficialApp = { name: "shop", dir, registry, org: "example-org", repos: { api }, tenant: "", url: "https://shop.example.test" };
    const targets = await acceptTargets(app, { commits: [sha.slice(0, 9)], liveChecks: ["api:test/tariffs.mjs", "web:test/ui.mjs"] });
    expect(targets).toEqual([{ key: "api", commit: sha, also: ["test/tariffs.mjs"] }]);
    const seen: string[][] = [];
    const lane: AcceptLane = async (_run, args) => {
      seen.push(args);
      return { code: 12, stdout: "", tail: [], steps: [{ name: "accept[api]", outcome: "FAILED: 1 of 1 file(s): test/tariffs.mjs (37 passed, 1 failed)", seconds: 3 }] };
    };
    const run = { id: "job-fix-1", signal: new AbortController().signal, log: () => undefined, iso: () => "2026-11-09T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined };
    const out = await runAcceptance(run as never, app, targets, { lane, also: true });
    expect(seen[0]!.slice(-2)).toEqual(["--also", "test/tariffs.mjs"]);
    expect(out).toMatchObject({ status: "failed", failed: 1, files: 1 });
    // "Finish the steps after the deploy" runs the same checks again, live checks included
    expect(openAcceptTargets(app, "job-fix-1")).toEqual(targets);
    // an engine without --also: the option is left out (it would fail the whole call)
    await runAcceptance({ ...run, id: "job-fix-2" } as never, app, targets, { lane, also: false });
    expect(seen[1]).not.toContain("--also");
  });

  it("a repo whose tests failed and that the fix round did not change: exactly those tests again, on the code dev runs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-also-"));
    made.push(root);
    const dir = path.join(root, "madp");
    const repos: Record<string, string> = {};
    for (const k of ["api", "web"]) {
      const r = path.join(dir, `shop-${k}`);
      fs.mkdirSync(r, { recursive: true });
      git(r, "init", "-q", "-b", "dev");
      fs.writeFileSync(path.join(r, "a.ts"), "1\n");
      git(r, "add", "-A");
      git(r, "commit", "-q", "-m", "first");
      repos[k] = r;
    }
    fs.writeFileSync(path.join(repos.web!, "a.ts"), "fixed\n");
    git(repos.web!, "commit", "-q", "-am", "fix: the page");
    const webFix = git(repos.web!, "rev-parse", "HEAD");
    const accept = ["    acceptance:", "      tests:", '        argv: [node, "{file}"]', '        files: ["test/*.mjs"]'];
    const registry = path.join(dir, "shop.yml");
    fs.writeFileSync(registry, ["project: shop", "default_env: dev", "environments:", "  dev:", "    branch: dev", "repos:",
      "  api:", `    path: ${repos.api}`, "    repo: example-org/shop-api", "    role: api", "    branch: dev", ...accept,
      "  web:", `    path: ${repos.web}`, "    repo: example-org/shop-web", "    role: web", ...accept, ""].join("\n"));
    const app = { registry };
    const work = { commits: [webFix.slice(0, 9)], liveChecks: ["api:test/tariffs.mjs"] };
    const why = { "test/tariffs.mjs": "a live test this fix round must make pass" };
    // no remote branch fetched: the clone's HEAD
    expect(await acceptTargets(app, work)).toEqual([
      { key: "api", commit: git(repos.api!, "rev-parse", "HEAD"), only: ["test/tariffs.mjs"], why },
      { key: "web", commit: webFix },
    ]);
    // the environment's branch as last fetched is what dev runs (the engine's deployed head)
    const deployed = git(repos.api!, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repos.api!, "b.ts"), "local\n");
    git(repos.api!, "add", "-A");
    git(repos.api!, "commit", "-q", "-m", "not pushed");
    git(repos.api!, "update-ref", "refs/remotes/origin/dev", deployed);
    expect((await acceptTargets(app, work))[0]).toEqual({ key: "api", commit: deployed, only: ["test/tariffs.mjs"], why });
    // a repo without live checks that the work did not change is not checked
    expect(await acceptTargets(app, { commits: [webFix] })).toEqual([{ key: "web", commit: webFix }]);
    // the retry keeps them: madp accept --only runs exactly those files (never --also on top)
    const seen: string[][] = [];
    const lane: AcceptLane = async (_run, args) => (seen.push(args), { code: 0, stdout: "", tail: [], steps: [{ name: `accept[${args[args.indexOf("--repo") + 1]}]`, outcome: "ok: 1 file(s) passed", seconds: 1 }] });
    const run = { id: "job-fix-3", signal: new AbortController().signal, log: () => undefined, iso: () => "2026-11-09T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined };
    await runAcceptance(run as never, { name: "shop", dir, registry, org: "", repos, tenant: "", url: "" }, await acceptTargets(app, work), { lane, also: true });
    expect(seen[0]!.slice(5, 11)).toEqual(["--repo", "api", "--commit", deployed, "--only", "test/tariffs.mjs"]);
    expect(seen[0]).not.toContain("--also");
  });
});

describe("a revert keeps the change's record and writes its round", () => {
  it("the record is not reverted; the lane gets it with a round that says development was put back", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-revert-record-"));
    made.push(root);
    const dir = path.join(root, "madp");
    const api = path.join(dir, "shop-api");
    fs.mkdirSync(api, { recursive: true });
    git(api, "init", "-q", "-b", "dev");
    fs.writeFileSync(path.join(api, "a.ts"), "1\n");
    git(api, "add", "-A");
    git(api, "commit", "-q", "-m", "first");
    // the build whose checks failed: its code and the change's record, committed together
    fs.mkdirSync(path.join(api, "records"), { recursive: true });
    fs.writeFileSync(path.join(api, "a.ts"), "2\n");
    fs.writeFileSync(path.join(api, "records", "CR-005.md"), "# CR-005: Tariff hierarchy\n\n## Rounds\n\n<!-- round: 20261109T100000Z -->\n### build\n");
    git(api, "add", "-A");
    git(api, "commit", "-q", "-m", "feat: tariff hierarchy");
    const red = git(api, "rev-parse", "HEAD");
    const registry = path.join(dir, "shop.yml");
    fs.writeFileSync(registry, ["project: shop", "default_env: dev", "change_records:", "  dir: records/", "environments:", "  dev:", "    branch: dev", `    cli_config_dir: ${path.join(root, "store")}`,
      "repos:", "  api:", `    path: ${api}`, "    repo: example-org/shop-api", "    role: api", ""].join("\n"));
    expect(changeRecordPath({ change_records: { dir: "records/" } }, "CR-005")).toBe("records/CR-005.md");
    expect(changeRecordPath({}, "CR-005")).toBe("docs/changes/CR-005.md");
    const app: OfficialApp = { name: "shop", dir, registry, org: "example-org", repos: { api }, tenant: "", url: "https://shop.example.test" };
    const plan = await revertPlan(app, [red]);
    // without the record to keep, the revert would take its rounds away
    expect(await prepareRevert(plan[0]!, "CR-005")).toEqual(["a.ts", "records/CR-005.md"]);
    git(api, "revert", "--abort");
    const calls: string[][] = [];
    const lane = async (_r: unknown, args: string[]): Promise<LaneResult> => {
      calls.push(args);
      // the record is as committed (the engine appends the revert's round to it)
      expect(git(api, "status", "--porcelain")).toBe("M  a.ts");
      git(api, "commit", "-q", "-am", "revert: tariff hierarchy");
      return { code: 0, stdout: "", tail: [], steps: [{ name: "commit[api]", outcome: git(api, "rev-parse", "--short=9", "HEAD"), seconds: 1 }] };
    };
    const run = { id: "job-revert-1", signal: new AbortController().signal, log: () => undefined, iso: () => "2026-11-09T12:00:00.000Z", heartbeat: async () => undefined, check: () => undefined };
    await runRevert(run as never, app, ask("CR-005: Tariff hierarchy", { change: change({ feature: undefined }), tickets: [], fixes: { feature: change().feature!, tickets: [ticket(41, { done: true })] } }), plan, { onStep: async () => undefined, lane, changeRecord: true });
    const args = calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--include", "a.ts"]));
    expect(args).not.toContain("records/CR-005.md");
    const record = JSON.parse(fs.readFileSync(args[args.indexOf("--change-record") + 1]!, "utf8"));
    expect(record).toMatchObject({ id: "CR-005", round: { kind: "revert", n: 2, of: 3, goal: `api ${red.slice(0, 12)}` }, tickets: [{ number: 41 }] });
    expect(fs.readFileSync(path.join(api, "records", "CR-005.md"), "utf8")).toContain("<!-- round: 20261109T100000Z -->");
    // an engine without --change-record: none passed, the record still kept out of the revert
    git(api, "reset", "-q", "--hard", red);
    calls.length = 0;
    await runRevert({ ...run, id: "job-revert-2" } as never, app, ask("CR-005: Tariff hierarchy", { tickets: [] }), plan, { onStep: async () => undefined, lane, changeRecord: false });
    expect(calls[0]).not.toContain("--change-record");
    // a repo where only the record would change: nothing to revert, and no revert left in progress
    git(api, "reset", "-q", "--hard", red);
    fs.appendFileSync(path.join(api, "records", "CR-005.md"), "\n<!-- round: 20261109T110000Z -->\n### fix round 1\n");
    git(api, "commit", "-q", "-am", "fix: tariff hierarchy (record only)");
    const recordOnly = git(api, "rev-parse", "HEAD");
    expect(await prepareRevert({ key: "api", path: api, commits: [recordOnly] }, "CR-005", ["records/CR-005.md"])).toEqual([]);
    expect(git(api, "status", "--porcelain")).toBe("");
    expect(fs.existsSync(path.join(api, ".git", "REVERT_HEAD"))).toBe(false);
  });
});

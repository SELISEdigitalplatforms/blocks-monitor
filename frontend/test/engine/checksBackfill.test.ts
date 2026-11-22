// The checks of change builds that ran before their per-file results were recorded on the change, read back from the
// engine host's acceptance reports (server/blocks/engineWorker/checksBackfill.ts): PrimaBook's CR-005 and its
// follow-ups had only "accept-failed=1/2" on their jobs. Each report's table names every test file and its result; the
// reports written while a build ran give its run (failing and passed files, version, kind), and with them CR-005's
// failing tariff tests pass since 0.15.0 (CR-015's run). Runs already on a record are never added again.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/checksBackfill.test.ts
import { describe, expect, it } from "vitest";
import { backfillPlan, fileResultsOfReport, runOfJob } from "../../server/blocks/engineWorker/checksBackfill";
import { checksPassSince, checksSettled, fileVerdicts, parseChangeChecks, serializeChangeChecks, withRun } from "../../src/domain/changeChecks";
import { changesNotUsable } from "../../src/domain/afterDeploy";

const report = (rows: Array<[string, "FAIL" | "ok"]>, repo = "api") => [
  "# Live acceptance", "", "## Acceptance on the deployed environment", "",
  `### \`${repo}\` on dev: ${rows.some(([, r]) => r === "FAIL") ? "FAILED (needs attention; nothing was rolled back)" : "ok"}`, "",
  "- Commit: `abc123456789`, 12.0s", "",
  "| File | Result | Passed | Failed | Exit | Seconds |", "|---|---|---:|---:|---:|---:|",
  ...rows.map(([file, r]) => `| \`${file}\` | ${r} | 5 | ${r === "FAIL" ? 1 : 0} | ${r === "FAIL" ? 1 : 0} | 2.0 |`), "",
].join("\n");
const at = (h: number, m = 0) => Date.UTC(2026, 10, 9, h, m);
const iso = (h: number, m = 0) => new Date(at(h, m)).toISOString();
const job = (id: string, crId: string, from: [number, number], to: [number, number], errorCode = "", input: Record<string, unknown> = {}) => ({
  ItemId: id, Kind: "change.build", Status: "succeeded", ErrorCode: errorCode, ClaimedAt: iso(...from), FinishedAt: iso(...to),
  InputJson: JSON.stringify({ projectId: "p", changeRequestId: crId, ...input }),
});

describe("the reports' tables", () => {
  it("every file with its result, by repo; any other report gives nothing", () => {
    expect(fileResultsOfReport(report([["test/tariffs.mjs", "FAIL"], ["test/keep.mjs", "ok"]]))).toEqual([
      { repo: "api", name: "test/tariffs.mjs", verdict: "failed" }, { repo: "api", name: "test/keep.mjs", verdict: "passed" },
    ]);
    expect(fileResultsOfReport("# Quick lane\n\n| `x` | ok |")).toEqual([]);
  });

  it("a build's run from the reports written while it ran (per repo the newest)", () => {
    const j = job("j-1", "cr-5", [12, 20], [12, 37], "after-deploy:accept-failed=2/2");
    const run = runOfJob(j, [
      { at: at(12, 10), md: report([["test/old.mjs", "FAIL"]]) }, // before it: not its
      { at: at(12, 30), md: report([["test/tariffs.mjs", "FAIL"], ["test/rates.mjs", "ok"]]) },
      { at: at(12, 36), md: report([["test/tariffs.mjs", "FAIL"], ["test/rates.mjs", "FAIL"]]) }, // the newest of api wins
    ], "0.13.0");
    expect(run).toMatchObject({ jobId: "j-1", kind: "build", status: "failed", version: "0.13.0", failed: 2, files: 2, at: iso(12, 37) });
    expect(run!.failing.map((x) => x.name)).toEqual(["test/tariffs.mjs", "test/rates.mjs"]);
    expect(runOfJob(j, [{ at: at(14), md: report([["x", "ok"]]) }], "0.13.0")).toBeNull();
  });
});

describe("the plan for PrimaBook's CR-005 and its follow-ups", () => {
  const jobs = [
    job("j-005", "cr-005", [12, 20], [12, 37], "after-deploy:accept-failed=2/2"),
    job("j-014", "cr-014", [13, 5], [13, 8], "after-deploy:accept-failed=1/1"),
    job("j-015", "cr-015", [13, 11], [13, 13]),
    job("j-fix", "cr-020", [21, 0], [21, 12], "after-deploy:accept-failed=1/3", { fixChecks: true, afterJobId: "j-20", baseJobId: "j-20", round: 1, auto: true, version: "0.22.1" }),
  ];
  const reports = [
    { at: at(12, 36), md: report([["test/tariffs.mjs", "FAIL"], ["test/rates.mjs", "FAIL"]]) },
    { at: at(13, 8), md: report([["test/nine-levels.mjs", "FAIL"]]) },
    { at: at(13, 13), md: report([["test/tariffs.mjs", "ok"], ["test/rates.mjs", "ok"], ["test/keep.mjs", "ok"]]) },
    { at: at(21, 11), md: report([["test/platform.mjs", "FAIL"]]) },
  ];
  const releases = [{ ItemId: "r1", EngineJobId: "j-005", Version: "0.13.0" }, { ItemId: "r2", EngineJobId: "j-014", Version: "0.14.1" }, { ItemId: "r3", EngineJobId: "j-015", Version: "0.15.0" }];
  // CR-020 already has its fix round's run on the record: it is not added again
  const cr020 = serializeChangeChecks(withRun(null, { jobId: "j-fix", kind: "fix", env: "dev", at: iso(21, 12), status: "failed", version: "0.22.1", commits: [], failed: 1, files: 3, fixtures: false, failing: [{ repo: "api", name: "test/platform.mjs", reason: "x" }], round: 1, auto: true, baseJobId: "j-20" }));
  const changes = [
    { ItemId: "cr-005", Number: 5, Checks: "" }, { ItemId: "cr-014", Number: 14, Checks: "" }, { ItemId: "cr-015", Number: 15, Checks: "" }, { ItemId: "cr-020", Number: 20, Checks: cr020 },
  ];

  it("adds the runs the records lack, with their versions; never one already there", () => {
    const plan = backfillPlan({ jobs, changes, releases, reports });
    expect(plan.map((p) => [p.number, p.runs.map((r) => `${r.version} ${r.status} ${r.failed}/${r.files}`)])).toEqual([
      [5, ["0.13.0 failed 2/2"]], [14, ["0.14.1 failed 1/1"]], [15, ["0.15.0 ok 0/3"]],
    ]);
  });

  it("with them, CR-005 passes since 0.15.0 (after CR-015); CR-014's nine-levels test keeps it not usable", () => {
    const plan = backfillPlan({ jobs, changes, releases, reports });
    const records = changes.map((c) => {
      const p = plan.find((x) => x.changeId === c.ItemId);
      let r = parseChangeChecks(c.Checks);
      for (const run of p?.runs ?? []) r = withRun(r, run);
      return { id: c.ItemId, checks: r ? serializeChangeChecks(r) : null };
    });
    const verdicts = fileVerdicts(records);
    expect(checksPassSince(parseChangeChecks(records[0]!.checks), "j-005", verdicts)).toMatchObject({ version: "0.15.0", changeId: "cr-015" });
    const views = jobs.map((j) => ({ id: j.ItemId, kind: j.Kind, status: j.Status, errorCode: j.ErrorCode, finishedAt: j.FinishedAt, inputJson: j.InputJson }));
    expect([...changesNotUsable(views, checksSettled(records)).keys()].sort()).toEqual(["cr-014", "cr-020"]);
  });
});

// A change's failing checks follow the NEWEST judged result of each failing file on the same environment, whichever
// change's run judged it (src/domain/changeChecks.ts checksPassSince, checksSettled). The PrimaBook shape of 09.11.2026:
// CR-005 (tariff hierarchy) failed its tariff tests; the follow-up changes CR-008 to CR-015 fixed them until every one
// passed on 0.15.0 (CR-015's run). CR-005 then reads "its checks pass on development since 0.15.0 (after CR-015)",
// is no longer "not usable" and no longer holds back a promotion; its own failed run stays on its record. A file that
// was not judged again (or failed again) keeps a change not usable.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/checksPassSince.test.ts
import { describe, expect, it } from "vitest";
import {
  checksPassSince, checksSettled, fileVerdicts, parseChangeChecks, serializeChangeChecks, CHECKS_MAX_CHARS, MAX_PASSED,
  type ChecksRun, type KnownMark,
} from "../../src/domain/changeChecks";
import { changesNotUsable, promotionBlockedBy } from "../../src/domain/afterDeploy";
import { compareReleaseVersions } from "../../src/domain/delivery";
import { passedFilesOf } from "../../server/local/engine/kinds/delivery";

const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 9, h, m)).toISOString();
const f = (name: string) => ({ repo: "api", name });
const failing = (name: string) => ({ ...f(name), reason: "FAIL not ok 3 - a tariff rate" });
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId" | "at" | "version">): ChecksRun => ({
  kind: "build", env: "dev", status: "failed", commits: ["abc1234"], failed: 0, files: 0, fixtures: false, failing: [], round: 0, auto: false, baseJobId: "",
  known: [], diagnosed: [], ...o,
});
const record = (runs: ChecksRun[], marks: KnownMark[] = []) => serializeChangeChecks({ v: 1, runs, ...(marks.length ? { marks } : {}) });

const TARIFFS = "test/tariffs.mjs";
const RATES = "test/tariff-entry-rates.mjs";
const KEEP = "test/tariff-entry-keep.mjs";
const CATEGORY = "test/project-category-rates.mjs";
const NINE = "test/tariff-nine-levels.mjs";

/** The PrimaBook project on 09.11.2026, as change records with their runs. */
function primaBook(o: { cr015Passes?: string[]; cr016Fails?: string[] } = {}) {
  const cr005 = { id: "cr-005", checks: record([
    run({ jobId: "j-005-1", at: at(11, 8), version: "0.9.0", failed: 1, files: 2, failing: [failing(TARIFFS)] }),
    run({ jobId: "j-005-2", at: at(12, 37), version: "0.13.0", failed: 2, files: 2, failing: [failing(TARIFFS), failing(RATES)] }),
  ]) };
  const cr009 = { id: "cr-009", checks: record([run({ jobId: "j-009", at: at(11, 33), version: "0.10.0", failed: 1, files: 1, failing: [failing(RATES)] })]) };
  // CR-010 fixed the rates; tariffs.mjs still had one failing check (the test read the loop error the wrong way)
  const cr010 = { id: "cr-010", checks: record([run({ jobId: "j-010", at: at(11, 45), version: "0.11.0", status: "failed", failed: 1, files: 3, failing: [failing(TARIFFS)], passed: [f(RATES), f(KEEP)] })]) };
  const cr014 = { id: "cr-014", checks: record([run({ jobId: "j-014", at: at(13, 8), version: "0.14.1", failed: 1, files: 1, failing: [failing(NINE)] })]) };
  // CR-015: every tariff test passes on 0.15.0
  const cr015 = { id: "cr-015", checks: record([run({ jobId: "j-015", at: at(13, 13), version: "0.15.0", status: "ok", files: 4, passed: (o.cr015Passes ?? [TARIFFS, RATES, KEEP, CATEGORY]).map(f) })]) };
  const changes = [cr005, cr009, cr010, cr014, cr015];
  if (o.cr016Fails) changes.push({ id: "cr-016", checks: record([run({ jobId: "j-016", at: at(19, 13), version: "0.20.0", failed: 1, files: 2, failing: o.cr016Fails.map(failing), passed: [f(KEEP)] })]) });
  return changes;
}
const rec = (changes: { id: string; checks: string }[], id: string) => parseChangeChecks(changes.find((c) => c.id === id)!.checks);

describe("the CR-005 to CR-015 shape: checks that pass again on a later version", () => {
  it("CR-005's failing tariff tests pass since 0.15.0, after CR-015", () => {
    const changes = primaBook();
    const since = checksPassSince(rec(changes, "cr-005"), "j-005-2", fileVerdicts(changes));
    expect(since).toMatchObject({ version: "0.15.0", changeId: "cr-015", jobId: "j-015" });
    // each file with the run it passed again in after CR-005's own run on 0.13.0
    expect(since!.files).toEqual([
      expect.objectContaining({ name: TARIFFS, version: "0.15.0", changeId: "cr-015" }),
      expect.objectContaining({ name: RATES, version: "0.15.0", changeId: "cr-015" }),
    ]);
    // CR-009's rates file passed on 0.11.0 (CR-010), failed again on 0.13.0 (CR-005), passes since 0.15.0: the newest
    // passes count from the last failure on
    expect(checksPassSince(rec(changes, "cr-009"), "j-009", fileVerdicts(changes))).toMatchObject({ version: "0.15.0", changeId: "cr-015" });
    // without CR-005's second run it passes since 0.11.0
    const earlier = changes.map((c) => (c.id === "cr-005" ? { id: c.id, checks: record([run({ jobId: "j-005-1", at: at(11, 8), version: "0.9.0", failed: 1, files: 2, failing: [failing(TARIFFS)] })]) } : c));
    expect(checksPassSince(rec(earlier, "cr-009"), "j-009", fileVerdicts(earlier))).toMatchObject({ version: "0.11.0", changeId: "cr-010" });
  });

  it("a file never judged again since keeps the change not usable (CR-014's nine-levels test)", () => {
    const changes = primaBook();
    expect(checksPassSince(rec(changes, "cr-014"), "j-014", fileVerdicts(changes))).toBeNull();
  });

  it("a file that failed again after it passed: not usable again", () => {
    const changes = primaBook({ cr016Fails: [TARIFFS] });
    expect(checksPassSince(rec(changes, "cr-005"), "j-005-2", fileVerdicts(changes))).toBeNull();
    // the rates file still passes: CR-009 stays settled
    expect(checksPassSince(rec(changes, "cr-009"), "j-009", fileVerdicts(changes))).not.toBeNull();
  });

  it("a later run that did not judge one of the files: not settled", () => {
    const changes = primaBook({ cr015Passes: [RATES, KEEP] });
    expect(checksPassSince(rec(changes, "cr-005"), "j-005-2", fileVerdicts(changes))).toBeNull();
  });

  it("only passes AFTER the failing run count, on the same environment", () => {
    const early = { id: "cr-001", checks: record([run({ jobId: "j-1", at: at(9, 0), version: "0.8.0", status: "ok", passed: [f(TARIFFS), f(RATES)] })]) };
    const stage = { id: "cr-x", checks: record([run({ jobId: "j-x", at: at(14, 0), version: "0.15.1", env: "stage", status: "ok", passed: [f(TARIFFS), f(RATES)] })]) };
    const changes = [early, stage, ...primaBook({ cr015Passes: [KEEP] })];
    expect(checksPassSince(rec(changes, "cr-005"), "j-005-2", fileVerdicts(changes))).toBeNull();
  });

  it("a run that does not name its failing files (an older run) is never taken as passing", () => {
    const old = { id: "cr-012", checks: record([run({ jobId: "j-012", at: at(12, 46), version: "0.13.1", failed: 1, files: 4, failing: [] })]) };
    const changes = [old, ...primaBook()];
    expect(checksPassSince(rec(changes, "cr-012"), "j-012", fileVerdicts(changes))).toBeNull();
    // two failed, only one named: the other one is not known to pass
    const half = { id: "cr-013", checks: record([run({ jobId: "j-013", at: at(13, 2), version: "0.14.0", failed: 2, files: 2, failing: [failing(TARIFFS)] })]) };
    expect(checksPassSince(parseChangeChecks(half.checks), "j-013", fileVerdicts([half, ...primaBook()]))).toBeNull();
  });

  it("a check a person marked known before this change does not need to pass again", () => {
    const mark: KnownMark = { repo: "api", name: NINE, reason: "fails the same way before", byUserId: "u", at: at(13, 9), jobId: "j-005-2", commit: "" };
    const changes = primaBook();
    const withNine = { id: "cr-005", checks: record([run({ jobId: "j-005-2", at: at(12, 37), version: "0.13.0", failed: 3, files: 3, failing: [failing(TARIFFS), failing(RATES), failing(NINE)] })], [mark]) };
    const all = [withNine, ...changes.filter((c) => c.id !== "cr-005")];
    expect(checksPassSince(parseChangeChecks(withNine.checks), "j-005-2", fileVerdicts(all))).toMatchObject({ version: "0.15.0" });
  });
});

describe("the one rule everywhere: not usable, and the promotion", () => {
  const job = (id: string, crId: string, errorCode: string, finished: string) => ({
    id, kind: "change.build", status: "succeeded", errorCode, finishedAt: finished, inputJson: JSON.stringify({ changeRequestId: crId }),
  });
  const jobs = [
    job("j-005-2", "cr-005", "after-deploy:accept-failed=2/2", at(12, 37)),
    job("j-009", "cr-009", "after-deploy:accept-failed=1/1", at(11, 33)),
    job("j-010", "cr-010", "", at(11, 45)),
    job("j-014", "cr-014", "after-deploy:accept-failed=1/1", at(13, 8)),
    job("j-015", "cr-015", "", at(13, 13)),
  ];

  it("CR-005 and CR-009 are no longer not usable; CR-014 still is", () => {
    const notUsable = changesNotUsable(jobs, checksSettled(primaBook()));
    expect([...notUsable.keys()]).toEqual(["cr-014"]);
  });

  it("the promotion of 0.15.0 is held back only by what is still not usable", () => {
    const releases = [{ version: "0.13.0", engineJobId: "j-005-2" }, { version: "0.14.1", engineJobId: "j-014" }, { version: "0.15.0", engineJobId: "j-015" }];
    expect(promotionBlockedBy("0.15.0", changesNotUsable(jobs, checksSettled(primaBook())), releases, compareReleaseVersions)).toBe("cr-014");
    // without CR-014's open check nothing holds it back
    const settled = checksSettled(primaBook());
    expect(promotionBlockedBy("0.15.0", changesNotUsable(jobs.filter((j) => j.id !== "j-014"), settled), releases, compareReleaseVersions)).toBeNull();
  });
});

describe("the passed files on the record", () => {
  it("are what the run's tests passed, each once, at most MAX_PASSED", () => {
    const tests = [
      { repo: "api", file: TARIFFS, verdict: "ok" as const, why: "" },
      { repo: "api", file: TARIFFS, verdict: "ok" as const, why: "", reused: "passed in the round on abc" },
      { repo: "api", file: RATES, verdict: "failed" as const, why: "" },
      { repo: "api", file: NINE, verdict: "known" as const, why: "" },
      { repo: "web", file: "test/x.mjs", verdict: "not-judged" as const, why: "" },
    ];
    expect(passedFilesOf({ tests })).toEqual([f(TARIFFS)]);
    const many = Array.from({ length: MAX_PASSED + 10 }, (_, i) => ({ repo: "api", file: `test/t${i}.mjs`, verdict: "ok" as const, why: "" }));
    expect(passedFilesOf({ tests: many })).toHaveLength(MAX_PASSED);
  });

  it("round-trip, and a long record drops the oldest runs' passed files before any run", () => {
    const names = Array.from({ length: MAX_PASSED }, (_, i) => f(`test/a-rather-long-file-name-number-${i}.mjs`));
    const runs = Array.from({ length: 12 }, (_, i) => run({ jobId: `j-${i}`, at: at(10, i), version: `0.${i}.0`, status: "ok", passed: names }));
    const out = serializeChangeChecks({ v: 1, runs });
    expect(out.length).toBeLessThanOrEqual(CHECKS_MAX_CHARS);
    const back = parseChangeChecks(out)!;
    expect(back.runs).toHaveLength(12);
    expect(back.runs.at(-1)!.passed).toHaveLength(MAX_PASSED);
    expect(back.runs[0]!.passed).toBeUndefined();
  });
});

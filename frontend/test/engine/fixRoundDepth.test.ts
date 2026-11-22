// A fix round with depth (official/build.ts): which lane a fix round goes through, what it hands the engine (its
// number and the commits it fixes), how long the Factory waits for it, and how the job reads what the engine's loop did
// (deploy iterations, depth, changes its no-op guard did not count as a fix, what still fails).
//
// 09.11.2026, PrimaBook CR-006: the fix round went through the quick lane, its single developer changed one test
// parameter in 9 turns, the lane deployed, and the checks after the deploy were identical. Now the engine diagnoses
// first, goes deep when product behaviour fails, guards against a change that fixes nothing, and deploys, checks and
// iterates by itself; an engine without that gets the feature lane (its planner is the strong model).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/fixRoundDepth.test.ts
import { describe, expect, it } from "vitest";
import { fixLaneOf, fixLoopOf, fixLoopWords, laneArgs, laneTimeoutMs, type WorkAsk } from "../../server/local/engine/official/build.ts";
import { plainStep } from "../../server/local/engine/official/madp.ts";
import type { AcceptCheck } from "../../src/domain/afterDeploy";

const failed = (repo: string, file: string): AcceptCheck => ({ repo, file, verdict: "failed", reason: "3 of 56 checks failed", why: "the change's own test", limit: "" });
const notJudged = (repo: string, file: string): AcceptCheck => ({ repo, file, verdict: "not-judged", reason: "429", why: "", limit: "invitations" });

const ask = (o: Partial<WorkAsk> = {}): WorkAsk => ({
  product: "PrimaBook", label: "CR-006: Partial invoices", goal: "Partial invoices are numbered and deducted on the final invoice.",
  tickets: [], built: [], later: [], fix: "## Fix what the checks found (fix round 1)", ...o,
});

describe("the lane of a fix round", () => {
  it("one repo with an engine that does fix rounds with depth: the quick lane (it diagnoses, goes deep and iterates)", () => {
    const a = ask({ failedChecks: [failed("api", "test/project-partial-invoices.mjs"), notJudged("web", "test/ui.mjs")] });
    // a check that could not judge the change is the environment's: it does not make the round span repos
    expect(fixLaneOf(a, { fixRound: true })).toBe("quick");
  });

  it("failing checks in more than one repo: the feature lane (a planner and a developer per repo)", () => {
    expect(fixLaneOf(ask({ failedChecks: [failed("api", "test/a.mjs"), failed("web", "test/b.mjs")] }), { fixRound: true })).toBe("feature");
    expect(fixLaneOf(ask({ liveChecks: ["web:test/b.mjs"], failedChecks: [failed("api", "test/a.mjs")] }), { fixRound: true })).toBe("feature");
  });

  it("an engine without fix rounds with depth: the feature lane, whose planner is the strong model", () => {
    expect(fixLaneOf(ask({ failedChecks: [failed("api", "test/a.mjs")] }), { fixRound: false })).toBe("feature");
  });

  it("waits long enough for the engine's iterations", () => {
    expect(laneTimeoutMs("quick")).toBe(40 * 60_000);
    expect(laneTimeoutMs("feature")).toBe(120 * 60_000);
    // fix.max_minutes is 120 (no new iteration after it) plus the one in flight
    expect(laneTimeoutMs("quick", true)).toBe(180 * 60_000);
    expect(laneTimeoutMs("feature", true)).toBe(180 * 60_000);
  });
});

describe("what a fix round hands the engine", () => {
  it("its number and the commits of the build it fixes, only when the engine takes them", () => {
    const a = ask({ fixes: { round: 2, tickets: [] }, fixesCommits: ["1bc5982b8", "1bc5982b8", "not-a-sha", "501370bb838523776e4305e3ba5ce621ee1a94f3"] });
    expect(laneArgs(a, { fixRound: true }).slice(4)).toEqual(["--fix-round", "2", "--previous-commit", "1bc5982b8", "--previous-commit", "501370bb838523776e4305e3ba5ce621ee1a94f3"]);
    // an engine without the option: the lane's arguments stay as they were
    expect(laneArgs(a).slice(4)).toEqual([]);
    // a build that is not a fix round never gets them
    expect(laneArgs({ ...a, fix: undefined }, { fixRound: true }).slice(4)).toEqual([]);
    // round 1 by default
    expect(laneArgs(ask(), { fixRound: true }).slice(4)).toEqual(["--fix-round", "1"]);
  });
});

describe("what the engine's loop did", () => {
  const LINE = "fixround round 1: 2 deploy iteration(s) of at most 3; depth deep; 1 not a fix (guard); the failing live tests pass on dev after iteration 2";

  it("reads the loop's line from the lane's output", () => {
    const f = fixLoopOf(`task     x\nstatus   DEPLOYED\n${LINE}\n`)!;
    expect(f).toMatchObject({ round: 1, iterations: 2, of: 3, depth: "deep", notAFix: 1, passed: true, still: [] });
    expect(fixLoopWords(f)).toBe("2 deploy iterations of at most 3, deep; 1 change was not a fix");
  });

  it("says what still fails when the loop stopped without it passing", () => {
    const f = fixLoopOf("fixround round 2: 3 deploy iteration(s) of at most 3; depth deep; no progress in iteration 3 (1 of 1 file(s) failing, 54 passed, 2 failed); stopped; still failing: api:test/project-partial-invoices.mjs: second final invoice 400 instead of 409 (54 passed, 2 failed)\n")!;
    expect(f).toMatchObject({ round: 2, iterations: 3, passed: false, notAFix: 0 });
    expect(f.still).toEqual(["api:test/project-partial-invoices.mjs: second final invoice 400 instead of 409 (54 passed, 2 failed)"]);
    expect(fixLoopWords(f)).toBe("3 deploy iterations of at most 3, deep");
    expect(fixLoopWords({ ...f, iterations: 1, notAFix: 2, depth: "" })).toBe("1 deploy iteration of at most 3; 2 changes were not a fix");
  });

  it("reads the line when the loop judged progress file by file (what changed, newly checked files, a regression)", () => {
    const f = fixLoopOf("fixround round 1: 2 deploy iteration(s) of at most 3; depth deep; no progress in iteration 2: test/project-types.mjs 2 → 2 failing; test/projects.mjs 1 → 1 failing; newly checked: test/units.mjs passes; stopped; still failing: api:test/project-types.mjs: FAIL type (27 passed, 2 failed); api:test/projects.mjs: FAIL list (544 passed, 1 failed)\n")!;
    expect(f).toMatchObject({ round: 1, iterations: 2, of: 3, depth: "deep", notAFix: 0, passed: false });
    expect(f.still).toEqual(["api:test/project-types.mjs: FAIL type (27 passed, 2 failed)", "api:test/projects.mjs: FAIL list (544 passed, 1 failed)"]);
    const r = fixLoopOf("fixround round 1: 2 deploy iteration(s) of at most 3; depth deep; regression in iteration 2: test/a.mjs passed before, 1 failing now; test/b.mjs 1 → 0 failing (passes now); stopped; still failing: api:test/a.mjs: FAIL x (5 passed, 1 failed)\n")!;
    expect(r).toMatchObject({ iterations: 2, passed: false, still: ["api:test/a.mjs: FAIL x (5 passed, 1 failed)"] });
  });

  it("none from an engine without the loop", () => {
    expect(fixLoopOf("task     x\nstatus   DEPLOYED\n")).toBeNull();
    expect(fixLoopWords(null)).toBe("");
  });

  it("the loop's steps in plain words", () => {
    expect(plainStep("diagnose")).toBe("finding the cause of the failing checks");
    expect(plainStep("depth")).toBe("deciding how deep the fix goes");
    expect(plainStep("guard")).toBe("checking that the change fixes what failed");
    expect(plainStep("guard-retry")).toBe("a second pass on a change that did not fix what failed");
    expect(plainStep("recheck[api]")).toBe("running the failing tests again on the development environment of the API");
    expect(plainStep("iteration")).toBe("the fix round's next deploy");
  });
});

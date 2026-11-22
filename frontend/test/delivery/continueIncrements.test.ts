// "Continue with the next increment when the checks pass" (src/domain/continueIncrements.ts) on the delivery side: the
// stored setting, when the next increment starts by itself and when not, a change a person paused, the chat's words
// for it, and the op cr.continueIncrements (business.edit or build.run holders only).
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/continueIncrements.test.ts
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { crContinueIncrementsOp } from "../../functions/delivery/ops/changes/crStreams";
import { deliveryOps } from "../../functions/delivery/ops/index";
import { createFakeWorld, FX, guardCases, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import {
  CONTINUE_LABEL, continueAsked, continueDecision, continueOn, continuedWords, isContinued, parseContinueSetting, pausedByPerson, serializeContinueSetting,
} from "../../src/domain/continueIncrements";

type Ans = Awaited<ReturnType<typeof runOp>>;
const err = (a: Ans) => (a.ok ? null : a.error);
const call = (w: FakeWorld, args: Record<string, unknown>, requestId = "r-continue-1") =>
  runOp(w.ports, { op: "cr.continueIncrements" as never, requestId }, crContinueIncrementsOp, { projectId: FX.project, ...args });

describe("when the next increment starts by itself", () => {
  const base = { on: true, checks: "ok", cleared: false, next: 2 as number | null, of: 3, paused: false };

  it("on, its checks passed (or every failure is marked known before), a next increment left, not paused", () => {
    expect(continueDecision(base)).toEqual({ go: true, next: 2, of: 3 });
    expect(continueDecision({ ...base, checks: "failed", cleared: true })).toEqual({ go: true, next: 2, of: 3 });
    expect(continuedWords(2, 3)).toBe("increment 2 of 3 starts by itself next (cancel it to pause this change)");
  });

  it("never off, failed, not judged, without checks, past the last increment or paused", () => {
    expect(continueDecision({ ...base, on: false })).toMatchObject({ go: false, why: "the next increment waits for a person to start it" });
    expect(continueDecision({ ...base, checks: "failed" })).toMatchObject({ go: false, why: "its checks failed on development" });
    expect(continueDecision({ ...base, checks: "not-judged" })).toMatchObject({ go: false, why: "its checks could not judge it on development" });
    expect(continueDecision({ ...base, checks: "not-run" })).toMatchObject({ go: false });
    expect(continueDecision({ ...base, checks: "none" })).toMatchObject({ go: false, why: "it has no checks on development to pass" });
    expect(continueDecision({ ...base, next: null })).toMatchObject({ go: false, why: "it was the last increment" });
    expect(continueDecision({ ...base, next: 4 })).toMatchObject({ go: false, why: "it was the last increment" });
    expect(continueDecision({ ...base, paused: true })).toMatchObject({ go: false, why: expect.stringContaining("paused") });
  });

  it("a person pauses a change by cancelling an increment that started by itself", () => {
    const input = (o: Record<string, unknown>) => JSON.stringify({ projectId: "p", changeRequestId: "cr-1", version: "1.2.0", ...o });
    const auto = { kind: "change.build", status: "cancelled", inputJson: input({ continued: true, afterJobId: "j1" }) };
    expect(isContinued(auto)).toBe(true);
    expect(pausedByPerson([auto], "cr-1")).toBe(true);
    expect(pausedByPerson([auto], "cr-2")).toBe(false);
    // a person's own build they cancelled, or an automatic one that ran: no pause
    expect(pausedByPerson([{ ...auto, inputJson: input({}) }, { ...auto, status: "succeeded" }], "cr-1")).toBe(false);
  });

  it("the stored setting: off unless someone turned it on", () => {
    const s = { v: 1 as const, on: true, by: "u-1", at: "2026-11-09T10:00:00.000Z" };
    expect(parseContinueSetting(serializeContinueSetting(s))).toEqual(s);
    expect(continueOn(serializeContinueSetting(s))).toBe(true);
    expect(continueOn(null)).toBe(false);
    expect(continueOn("{}")).toBe(false);
    expect(CONTINUE_LABEL).toBe("Continue with the next increment when the checks pass");
  });

  it("the tech lead's chat hears it on or off, and nothing in other messages", () => {
    expect(continueAsked("Please continue with the next increment automatically")).toBe(true);
    expect(continueAsked("turn on auto-continue for increments")).toBe(true);
    expect(continueAsked("Continue with the next increment when the checks pass")).toBe(true);
    expect(continueAsked("stop continuing increments by themselves")).toBe(false);
    expect(continueAsked("don't start the next increment automatically")).toBe(false);
    expect(continueAsked("How many increments does CR-018 have?")).toBeNull();
    expect(continueAsked("use 3 parallel streams")).toBeNull();
  });
});

describe("cr.continueIncrements", () => {
  it("is a delivery op for business.edit or build.run holders", async () => {
    expect(deliveryOps["cr.continueIncrements"]).toBe(crContinueIncrementsOp);
    for (const g of guardCases(["business.edit", "build.run"])) {
      const w = createFakeWorld();
      w.as(g.userId, { superAdmin: g.superAdmin });
      const res = await call(w, { on: true });
      if (g.code === null) expect(res.ok, `${g.name}: ${JSON.stringify(res)}`).toBe(true);
      else expect(err(res)?.code, g.name).toBe(g.code);
    }
  });

  it("stores who turned it on or off, and when; a boolean only", async () => {
    const w = createFakeWorld();
    const res = await call(w, { on: true });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const stored = parseContinueSetting(w.rows("Project").find((p) => p.ItemId === FX.project)!.ContinueIncrements);
    expect(stored).toMatchObject({ on: true, by: FX.owner });
    expect(w.audits.find((a) => a.action === "cr.continueIncrements")?.details).toMatchObject({ on: true });
    expect((await call(w, { on: false }, "r-off")).ok).toBe(true);
    expect(continueOn(w.rows("Project").find((p) => p.ItemId === FX.project)!.ContinueIncrements)).toBe(false);
    for (const bad of ["yes", 1, undefined]) expect(err(await call(w, { on: bad }, `r-${String(bad)}`))).toMatchObject({ code: "invalid_input" });
  });
});

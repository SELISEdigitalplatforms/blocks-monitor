// Global screens (audit 08.11.2026): the Dashboard's job list keeps polling while work runs (Live now, the working lines
// and the step counts never freeze until the next notification), a project card warms the page it really opens on, and
// "Mark all as read" marks every unread notification (the op marks one page of 500 per call).
//   npx vitest run --config test/project/vitest.config.ts
import { describe, expect, it } from "vitest";
import { DASHBOARD_JOBS_POLL_MS, dashboardJobsPollInterval } from "../../src/blocks/dashboard/hooks";
import { MARK_ALL_MAX_CALLS, markAllBellRead } from "../../src/blocks/workspaces/bell";
import { openSlugOf, stepSlugOf } from "../../src/components/project/stepPrefetch";
import { stepPath } from "../../src/domain/phases";
import type { JourneyStep } from "../../src/domain/journey";

describe("dashboardJobsPollInterval", () => {
  it("polls while a job is queued, claimed or running", () => {
    for (const Status of ["queued", "claimed", "running"]) {
      expect(dashboardJobsPollInterval({ items: [{ Status: "succeeded" }, { Status }] })).toBe(DASHBOARD_JOBS_POLL_MS);
    }
  });

  it("stops once every job is finished, and before anything is read", () => {
    expect(dashboardJobsPollInterval({ items: [{ Status: "succeeded" }, { Status: "failed" }, { Status: "cancelled" }] })).toBe(false);
    expect(dashboardJobsPollInterval({ items: [] })).toBe(false);
    expect(dashboardJobsPollInterval(undefined)).toBe(false);
  });

  it("ignores a status it does not know", () => {
    expect(dashboardJobsPollInterval({ items: [{ Status: "paused-by-someone" }, { Status: 3 }] })).toBe(false);
  });
});

describe("openSlugOf", () => {
  const steps: JourneyStep[] = ["business", "understanding", "sanitization", "requirements", "scope", "board", "build", "release"];

  it("is the slug of the page /p/:id opens for the step (ProjectEntry goes to stepPath)", () => {
    for (const step of steps) expect(openSlugOf(step)).toBe(stepSlugOf(stepPath("p1", step)));
  });

  it("warms the Business Analysis page for every analysis step, not the old step pages", () => {
    expect(["understanding", "sanitization", "requirements", "scope"].map((s) => openSlugOf(s as JourneyStep))).toEqual(["analysis", "analysis", "analysis", "analysis"]);
    expect(openSlugOf("business")).toBe("business");
    expect(openSlugOf("board")).toBe("build");
    expect(openSlugOf("release")).toBe("delivered");
  });
});

describe("markAllBellRead", () => {
  const answers = (...remaining: number[]) => {
    const calls: number[] = [];
    const mark = async () => { calls.push(1); return { ok: true as const, value: { marked: 500, remaining: remaining[calls.length - 1] ?? 0 } }; };
    return { calls, mark };
  };

  it("calls again while rows remain, then reads the bell once", async () => {
    const { calls, mark } = answers(700, 200, 0);
    let refreshed = 0;
    const r = await markAllBellRead(mark, async () => { refreshed += 1; });
    expect(r).toEqual({ ok: true, value: { remaining: 0 } });
    expect(calls).toHaveLength(3);
    expect(refreshed).toBe(1);
  });

  it("stops after the cap and says what is left", async () => {
    const { calls, mark } = answers(...Array.from({ length: 20 }, () => 9000));
    const r = await markAllBellRead(mark, async () => {});
    expect(calls).toHaveLength(MARK_ALL_MAX_CALLS);
    expect(r).toEqual({ ok: true, value: { remaining: 9000 } });
  });

  it("returns a refusal at once and still refreshes the bell", async () => {
    let refreshed = 0;
    const r = await markAllBellRead(async () => ({ ok: false as const, error: "No" }), async () => { refreshed += 1; });
    expect(r).toEqual({ ok: false, error: "No" });
    expect(refreshed).toBe(1);
  });
});

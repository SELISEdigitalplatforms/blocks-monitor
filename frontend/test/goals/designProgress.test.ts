import { describe, expect, it } from "vitest";
import {
  DESIGN_IDLE_AFTER_MS, DESIGN_MIN_SHOWN, DESIGN_TIME_CEILING, DESIGN_TYPICAL, designProgress, designStepText, formatElapsed, timeCurve,
  type DesignProgressJob, type DesignProgressMemo,
} from "../../src/components/design/designProgress";

const T0 = Date.parse("2026-11-05T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const job = (over: Partial<DesignProgressJob> = {}): DesignProgressJob => ({
  id: "j1", status: "running", progress: 10, message: "The planner is designing screens from the complete requirements.",
  createdAt: iso(T0), claimedAt: iso(T0), updatedAt: iso(T0), ...over,
});
const FALLBACK = "Preparing the journeys and screens.";

/** Runs the bar over a series of reads, one per second, and returns what it showed. */
function run(reads: { at: number; job: DesignProgressJob }[]) {
  let memo: DesignProgressMemo | null = null;
  return reads.map(({ at, job: j }) => { const v = designProgress(memo, j, at, FALLBACK); memo = v.memo; return v; });
}

describe("design job progress bar", () => {
  it("keeps moving through minutes of silence from the job, without reaching 100", () => {
    const shown = run(Array.from({ length: 9 }, (_, i) => ({ at: T0 + i * 5 * 60_000, job: job() }))).map((v) => v.shown);
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThan(shown[i - 1]);
    expect(shown[5]).toBeGreaterThanOrEqual(55); // about 25 minutes in: well past the job's own 10 %
    expect(Math.max(...shown)).toBeLessThan(DESIGN_TIME_CEILING + 1);
  });

  it("never goes backwards for the same job, even when a read reports less", () => {
    const views = run([
      { at: T0 + 30_000, job: job({ progress: 40 }) },
      { at: T0 + 31_000, job: job({ progress: 5 }) },
      { at: T0 + 32_000, job: job({ progress: 0, status: "claimed" }) },
      { at: T0 + 33_000, job: job({ progress: 12 }) },
    ]);
    const shown = views.map((v) => v.shown);
    expect(shown[0]).toBe(40);
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1]);
  });

  it("follows real progress ahead of the time curve and shows 100 only when the job succeeded", () => {
    const views = run([
      { at: T0 + 20_000, job: job({ progress: 90, message: "Saving the screens for your review." }) },
      { at: T0 + 21_000, job: job({ progress: 100 }) },
      { at: T0 + 22_000, job: job({ progress: 100, status: "succeeded" }) },
    ]);
    expect(views[0].shown).toBe(90);
    expect(views[1].shown).toBe(99);
    expect(views[2].shown).toBe(100);
  });

  it("starts a different job from its own value", () => {
    const [first, second] = run([
      { at: T0 + 35 * 60_000, job: job() },
      { at: T0 + 35 * 60_000 + 1000, job: job({ id: "j2", progress: 5, createdAt: iso(T0 + 35 * 60_000), claimedAt: iso(T0 + 35 * 60_000), updatedAt: iso(T0 + 35 * 60_000) }) },
    ]);
    expect(first.shown).toBeGreaterThan(50);
    expect(second.shown).toBe(5);
  });

  it("shows a visible minimum and does not creep while the job waits in the queue", () => {
    const views = run([
      { at: T0 + 1000, job: job({ status: "queued", progress: 0, message: null, claimedAt: null }) },
      { at: T0 + 120_000, job: job({ status: "queued", progress: 0, message: null, claimedAt: null }) },
    ]);
    expect(views.map((v) => v.shown)).toEqual([DESIGN_MIN_SHOWN, DESIGN_MIN_SHOWN]);
    expect(views[1].queued).toBe(true);
    expect(views[1].stepText).toBe(FALLBACK);
    expect(views[1].timeText).toBe(`Waiting for the design worker to start · requested 2 min 00 s ago. A design usually takes ${DESIGN_TYPICAL}.`);
  });

  it("keeps the last real step text and says it is still working when the job reports nothing for a while", () => {
    const views = run([
      { at: T0 + 10_000, job: job({ updatedAt: iso(T0 + 10_000) }) },
      { at: T0 + 30_000, job: job({ message: null, updatedAt: iso(T0 + 10_000) }) },
      { at: T0 + 10_000 + DESIGN_IDLE_AFTER_MS, job: job({ message: null }) },
    ]);
    expect(views[0].idle).toBe(false);
    expect(views[0].timeText).toBe(`10 s so far · usually ${DESIGN_TYPICAL}`);
    expect(views[1].idle).toBe(false);
    expect(views[1].stepText).toBe("The business analyst is designing screens from the complete requirements.");
    expect(views[2].idle).toBe(true);
    expect(views[2].stepText).toBe("The business analyst is designing screens from the complete requirements.");
    expect(views[2].timeText).toBe(`Still working · 55 s so far · usually ${DESIGN_TYPICAL}`);
  });

  it("a new step ends the idle state; a job first seen after minutes of silence is idle at once", () => {
    const views = run([
      { at: T0 + 3 * 60_000, job: job() },
      { at: T0 + 3 * 60_000 + 1000, job: job({ progress: 30, message: "Exporting the screens." }) },
    ]);
    expect(views[0].idle).toBe(true);
    expect(views[0].timeText).toBe(`Still working · 3 min 00 s so far · usually ${DESIGN_TYPICAL}`);
    expect(views[1].idle).toBe(false);
    expect(views[1].stepText).toBe("Exporting the screens.");
  });

  it("says when a design takes longer than usual", () => {
    const [v] = run([{ at: T0 + 76 * 60_000, job: job() }]);
    expect(v.overdue).toBe(true);
    expect(v.timeText).toBe("Taking longer than usual · 76 min so far. It keeps going if you leave this page.");
  });
  it("tells the usual range: a design is drawn, reviewed and polished, so 60 minutes is still usual (09.11)", () => {
    expect(DESIGN_TYPICAL).toBe("about 45 to 75 minutes");
    const [v] = run([{ at: T0 + 60 * 60_000 + 18_000, job: job() }]);
    expect(v.overdue).toBe(false);
    expect(v.timeText).toBe(`Still working · 60 min so far · usually ${DESIGN_TYPICAL}`);
  });

  it("formats elapsed time and keeps the curve under its ceiling", () => {
    expect(formatElapsed(0)).toBe("0 s");
    expect(formatElapsed(59_999)).toBe("59 s");
    expect(formatElapsed(65_000)).toBe("1 min 05 s");
    expect(formatElapsed(12 * 60_000 + 5_000)).toBe("12 min");
    expect(timeCurve(0)).toBe(0);
    expect(timeCurve(60 * 60_000)).toBeLessThan(DESIGN_TIME_CEILING);
  });

  it("works without usable timestamps (no elapsed time, no idle guess from the job)", () => {
    const [v] = run([{ at: T0, job: job({ createdAt: null, claimedAt: null, updatedAt: "not a date" }) }]);
    expect(v.elapsedMs).toBeNull();
    expect(v.shown).toBe(10);
    expect(v.timeText).toBe(`usually ${DESIGN_TYPICAL}`);
  });
});

describe("design step wording (owner, 08.11.2026: the planner is the business analyst)", () => {
  it("names the business analyst for the engine's old and new wording alike", () => {
    const NEW = "The business analyst is designing screens from the complete requirements.";
    expect(designStepText("The planner is designing screens from the complete requirements.")).toBe(NEW);
    expect(designStepText(NEW)).toBe(NEW);
    expect(designStepText("The planner is using the engine's Claude runner to design the journeys and screens."))
      .toBe("The business analyst is using the engine's Claude runner to design the journeys and screens.");
    expect(designStepText("A Figma workspace for the planner is needed.")).toBe("A Figma workspace for the business analyst is needed.");
    // other words that contain "planner" are left alone
    expect(designStepText("Designing the Table turn planner screens.")).toBe("Designing the Table turn planner screens.");
  });

  it("the bar shows the renamed step and keeps it while the job is silent", () => {
    const views = run([
      { at: T0 + 1000, job: job() },
      { at: T0 + 2000, job: job({ message: null }) },
      { at: T0 + 3000, job: job({ message: "The business analyst is designing screens from the complete requirements." }) },
    ]);
    expect(views.map((v) => v.stepText)).toEqual(Array(3).fill("The business analyst is designing screens from the complete requirements."));
    expect(views[2].idle).toBe(false);
  });
});

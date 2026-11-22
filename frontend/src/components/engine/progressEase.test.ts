// A job's progress as people see it is the value it recorded, never ahead of it (no invented numbers). Until 12.11.2026
// the bar eased up to 25 points ahead of the record and printed that number.
import { describe, expect, it } from "vitest";
import { recordedProgress, shownProgress, useEasedProgress } from "./progressEase";

describe("shownProgress", () => {
  it("is the recorded value in whole percent, never more", () => {
    expect(shownProgress(4, { done: false })).toBe(4);
    expect(shownProgress(37.6, { done: false })).toBe(37);
    expect(shownProgress(55, { done: false })).toBe(55);
  });
  it("shows 100 only when the job is done (a record of 100 on a running job waits at 99)", () => {
    expect(shownProgress(100, { done: false })).toBe(99);
    expect(shownProgress(40, { done: true })).toBe(100);
  });
  it("reads a missing or broken value as 0", () => {
    expect(shownProgress(null, { done: false })).toBe(0);
    expect(shownProgress(undefined, { done: false })).toBe(0);
    expect(shownProgress(Number.NaN, { done: false })).toBe(0);
    expect(shownProgress(-5, { done: false })).toBe(0);
  });
});

describe("useEasedProgress", () => {
  it("never moves ahead of the record while the job runs, however long it waits", () => {
    // a plain function of its inputs: no clock, no state (called outside React on purpose)
    expect(useEasedProgress(4, { active: true, resetKey: "j" })).toBe(4);
    expect(useEasedProgress(55, { active: true, resetKey: "j" })).toBe(55);
    expect(useEasedProgress(55, { active: false })).toBe(55);
    expect(useEasedProgress(60, { active: true, done: true })).toBe(100);
  });
});

describe("recordedProgress", () => {
  it("is 100 once the job succeeded, else its own Progress", () => {
    expect(recordedProgress({ status: "succeeded", progress: 70 })).toBe(100);
    expect(recordedProgress({ status: "running", progress: 37.6 })).toBe(37);
  });
});

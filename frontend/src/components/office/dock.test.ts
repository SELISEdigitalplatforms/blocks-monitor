import { describe, expect, it } from "vitest";
import { balancedWidth } from "./dock";

/** the camera views' button widths (px), 2 px apart, 8 px of padding in all */
const VIEWS = [72, 53, 96, 102, 103];
const GAP = 2, PAD = 8;
const one = VIEWS.reduce((a, w) => a + w, 0) + GAP * (VIEWS.length - 1) + PAD;

/** the lines a greedy wrap makes inside a group `width` px wide */
function lines(width: number): number[][] {
  const out: number[][] = [];
  let line: number[] = [], used = 0;
  for (const w of VIEWS) {
    if (line.length && used + GAP + w > width - PAD) { out.push(line); line = []; used = 0; }
    used += (line.length ? GAP : 0) + w;
    line.push(w);
  }
  out.push(line);
  return out;
}

describe("balancedWidth", () => {
  it("leaves a group that fits on one line alone", () => {
    expect(balancedWidth(VIEWS, GAP, PAD, one)).toBeNull();
    expect(balancedWidth(VIEWS, GAP, PAD, 900)).toBeNull();
  });

  it("keeps the lines the space needs, balanced, and no wider than the widest line", () => {
    // beside a docked chat at 1366 px the views had room for 4 + 1; balanced they are 3 + 2
    const w = balancedWidth(VIEWS, GAP, PAD, 415)!;
    expect(w).toBeLessThan(415);
    expect(lines(w).map((l) => l.length)).toEqual([3, 2]);
    const widest = Math.max(...lines(w).map((l) => l.reduce((a, x) => a + x, 0) + GAP * (l.length - 1)));
    expect(w - PAD - widest).toBeLessThanOrEqual(2);
  });

  it("never asks for more lines than the space allows", () => {
    for (const avail of [140, 200, 260, 329, 400, 460]) {
      const w = balancedWidth(VIEWS, GAP, PAD, avail);
      if (w === null) continue;
      expect(lines(w).length).toBe(lines(avail).length);
      expect(w).toBeLessThanOrEqual(Math.max(avail, Math.max(...VIEWS) + PAD) + 1);
    }
  });
});

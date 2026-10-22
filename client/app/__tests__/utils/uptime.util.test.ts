import { describe, it, expect } from "vitest";
import { formatUptime, observedWindowMs } from "@/utils/uptime.util";

const NOW = Date.UTC(2026, 9, 22, 11, 25, 23);
const M = 60 * 1000;
const H = 60 * M;
const at = (ms: number) => new Date(ms).toISOString();

describe("observedWindowMs", () => {
  it("counts only from creation for a monitor younger than the window", () => {
    expect(observedWindowMs(H, NOW, at(NOW - 10 * M))).toBe(10 * M);
  });

  it("uses the whole window for a monitor older than it", () => {
    expect(observedWindowMs(H, NOW, at(NOW - 5 * H))).toBe(H);
  });

  it.each([undefined, null, "", "not a date"])("uses the whole window when createdAt is %j", (createdAt) => {
    expect(observedWindowMs(H, NOW, createdAt)).toBe(H);
  });

  it("never returns less than 1ms, so a creation date ahead of the clock cannot divide by zero", () => {
    expect(observedWindowMs(H, NOW, at(NOW + M))).toBe(1);
  });
});

describe("formatUptime", () => {
  it("formats to two decimals", () => {
    expect(formatUptime(10 * M, 3 * M)).toBe("70.00");
    expect(formatUptime(H, 0)).toBe("100.00");
  });

  it("rounds down, so any downtime reads below 100%", () => {
    // 177.5s in 30 days is 99.9932%.
    expect(formatUptime(30 * 24 * H, 177_500)).toBe("99.99");
  });

  it("is not thrown off by float error", () => {
    // 29% computes as 28.999999999999996 in floating point.
    expect(formatUptime(100, 71)).toBe("29.00");
  });

  it("clamps to 0..100", () => {
    expect(formatUptime(M, 2 * M)).toBe("0.00");
    expect(formatUptime(M, -M)).toBe("100.00");
  });
});

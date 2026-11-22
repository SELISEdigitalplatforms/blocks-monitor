// The pure billing rules: cents, charges, totals, coupons and the lane usage line (the formats quick_ops.usage_line writes).
import { describe, expect, it } from "vitest";
import {
  EMPTY_USAGE,
  addMonth,
  addUsage,
  billingTotals,
  centsToUsd,
  couponRefusal,
  isUsdAmount,
  monthStart,
  newCouponCode,
  normalizeCouponCode,
  parseJobUsage,
  parseLaneUsage,
  parseUsageLines,
  settingNumber,
  toCents,
  usageChargeCents,
  COUPON_CODE,
} from "../../src/domain/billing";

describe("money", () => {
  it("turns USD into integer cents without float noise", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(3.6831)).toBe(368);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(199)).toBe(19900);
    expect(toCents(Number.NaN)).toBe(0);
    expect(centsToUsd(368)).toBe(3.68);
    expect(centsToUsd(-5)).toBe(-0.05);
  });

  it("accepts API amounts with at most two decimals", () => {
    expect(isUsdAmount(12.4)).toBe(true);
    expect(isUsdAmount(12.345)).toBe(false);
    expect(isUsdAmount(0)).toBe(false);
    expect(isUsdAmount(0, { allowZero: true })).toBe(true);
    expect(isUsdAmount(-5)).toBe(false);
    expect(isUsdAmount(-5, { allowNegative: true })).toBe(true);
    expect(isUsdAmount(2_000_000)).toBe(false);
    expect(isUsdAmount("5")).toBe(false);
  });

  it("charges measured cost x price factor, rounded once per job", () => {
    expect(usageChargeCents(3.6831, 1)).toBe(368);
    expect(usageChargeCents(3.6831, 1.5)).toBe(552);
    expect(usageChargeCents(0.004, 1)).toBe(0);
    expect(usageChargeCents(0.005, 1)).toBe(1);
    expect(usageChargeCents(2, 0)).toBe(200); // an invalid factor falls back to 1
    expect(usageChargeCents(-1, 1)).toBe(0);
  });

  it("sums a balance as granted minus consumed, in cents", () => {
    const t = billingTotals([
      { Kind: "signup", AmountCents: 5000 },
      { Kind: "coupon", AmountUsd: 10.1 },
      { Kind: "usage", AmountCents: -368, Tokens: 5_325_798 },
      { Kind: "usage", AmountUsd: -0.07, Tokens: 1000 },
      { Kind: "adjustment", AmountCents: -1000 },
    ]);
    expect(t).toEqual({ balanceCents: 5000 + 1010 - 368 - 7 - 1000, grantedCents: 5010, consumedCents: 375, tokens: 5_326_798 });
    // 0.1 + 0.2 a thousand times stays exact
    const many = billingTotals(Array.from({ length: 1000 }, () => ({ Kind: "coupon", AmountUsd: 0.1 })));
    expect(many.balanceCents).toBe(10_000);
  });

  it("reads settings with fallbacks", () => {
    expect(settingNumber("1.5", 1)).toBe(1.5);
    expect(settingNumber('{"value":2}', 1)).toBe(2);
    expect(settingNumber("", 1)).toBe(1);
    expect(settingNumber("x", 1)).toBe(1);
    expect(settingNumber("-3", 1, { min: 0 })).toBe(1);
  });

  it("counts months in UTC", () => {
    expect(monthStart("2026-11-09T10:00:00.000Z")).toBe("2026-11-01T00:00:00.000Z");
    expect(addMonth("2026-01-31T08:00:00.000Z")).toBe("2026-02-28T08:00:00.000Z");
    expect(addMonth("2026-12-15T00:00:00.000Z")).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("coupons", () => {
  const now = "2026-11-09T12:00:00.000Z";
  it("refuses inactive, expired and used-up coupons", () => {
    expect(couponRefusal({ Active: true, MaxRedemptions: 2, Redemptions: 1 }, now)).toBeNull();
    expect(couponRefusal({ Active: false, MaxRedemptions: 0 }, now)).toBe("inactive");
    expect(couponRefusal({ Active: true, ExpiresAt: "2026-11-09T11:59:59.000Z" }, now)).toBe("expired");
    expect(couponRefusal({ Active: true, ExpiresAt: "2026-12-01T00:00:00.000Z" }, now)).toBeNull();
    expect(couponRefusal({ Active: true, MaxRedemptions: 2, Redemptions: 2 }, now)).toBe("used-up");
    expect(couponRefusal({ Active: true, MaxRedemptions: 2, Redemptions: 0 }, now, 2)).toBe("used-up");
    expect(couponRefusal({ Active: true, MaxRedemptions: 0, Redemptions: 999 }, now)).toBeNull();
  });

  it("normalizes and generates codes", () => {
    expect(normalizeCouponCode(" welcome 50 ")).toBe("WELCOME50");
    const code = newCouponCode();
    expect(COUPON_CODE.test(code)).toBe(true);
    expect(code).toMatch(/^MF-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe("usage line parser", () => {
  const FEATURE = "tokens: 5325798 (in 152 / out 70351 / cache-read 4814281 / cache-write 441014), cost $3.6831, models claude-opus-4-1+claude-sonnet-4-5";
  const QUICK = "tokens: 120934 (in 12 / out 3051 / cache-read 101871 / cache-write 16000), cost $0.2040, model claude-sonnet-4-5";

  it("reads the feature lane's line (models, plural)", () => {
    const [u] = parseUsageLines(FEATURE);
    expect(u).toEqual({
      v: 1,
      tokens: { total: 5325798, in: 152, out: 70351, cacheRead: 4814281, cacheWrite: 441014 },
      costUsd: 3.6831,
      models: ["claude-opus-4-1", "claude-sonnet-4-5"],
      agents: 0,
      lanes: 1,
    });
  });

  it("reads the quick lane's line (model, singular) inside a report and a log", () => {
    const report = `## Benchmark\n\n| Agent call | Model |\n|---|---|\n| dev | claude-sonnet-4-5 |\n\n${QUICK}\n`;
    const u = parseLaneUsage(report)!;
    expect(u.tokens.total).toBe(120934);
    expect(u.costUsd).toBe(0.204);
    expect(u.models).toEqual(["claude-sonnet-4-5"]);
    expect(parseLaneUsage(`▸ gate[web]: pass (18.2s)\n  ${QUICK}  \n[exit 0]`)!.tokens.cacheWrite).toBe(16000);
  });

  it("takes the agent calls from the feature report's total row", () => {
    const report = `| **all** | 7 call(s) | - | 40 | 152 | 70351 | 4814281 | 441014 | 5325798 | 3.6831 | 812.0 |\n\nBy model: x\n\n${FEATURE}`;
    expect(parseLaneUsage(report)!.agents).toBe(7);
  });

  it("handles no model, thousands separators and markdown around the line", () => {
    const u = parseUsageLines("**tokens: 1,000 (in 1 / out 2 / cache-read 3 / cache-write 4), cost $0.0100, model -**")[0]!;
    expect(u.tokens.total).toBe(1000);
    expect(u.models).toEqual([]);
    expect(parseUsageLines("no usage here")).toEqual([]);
    expect(parseLaneUsage("tokens: 5 tokens left")).toBeNull();
  });

  it("sums several lane runs and keeps the models in order", () => {
    const sum = [FEATURE, QUICK].map((l) => parseLaneUsage(l)!).reduce(addUsage, EMPTY_USAGE);
    expect(sum.tokens.total).toBe(5325798 + 120934);
    expect(sum.costUsd).toBe(3.8871);
    expect(sum.models).toEqual(["claude-opus-4-1", "claude-sonnet-4-5"]);
    expect(sum.lanes).toBe(2);
    expect(parseJobUsage(JSON.stringify(sum))).toEqual(sum);
    expect(parseJobUsage("not json")).toBeNull();
  });
});

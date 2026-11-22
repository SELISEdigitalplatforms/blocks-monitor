// The one-time move of the catalogue into Blocks Utilities (server/blocks/utilitiesSync.ts, scripts/blocks-utilities-
// sync.mjs) over an in-memory Utilities: the dry run writes nothing, --apply creates the plans with their prices and
// the plan / discount codes, credit codes stay, and a rerun does only what is left.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryGateway, seedRow } from "../../functions/_lib/testing";
import { syncMain } from "../../server/blocks/utilitiesSync";
import { UtilitiesError } from "../../functions/_lib/blocksUtilities";
import { fakeUtilities } from "./fakeUtilities";

function setup() {
  const raw = memoryGateway();
  const fake = fakeUtilities();
  const utilities = fake.access(null).service;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-utilities-sync-"));
  const lines: string[] = [];
  const run = (...argv: string[]) => {
    lines.length = 0;
    return syncMain([...argv, "--report", path.join(dir, `report-${argv.join("-") || "plan"}.json`)], dir, { wiring: { raw, utilities }, log: (l) => lines.push(l), now: () => new Date("2026-11-09T00:00:00.000Z") });
  };
  return { raw, fake, run, lines, dir };
}

const couponRow = (o: Record<string, unknown>) => ({ Redemptions: 0, MaxRedemptions: 0, Active: true, Note: "", ExpiresAt: "", ...o });

describe("blocks-utilities-sync", () => {
  it("plans the move without writing; --apply creates plans, prices and codes; a rerun has nothing left", async () => {
    const t = setup();
    // Classic is stored at a changed price; the other three are the defaults
    seedRow(t.raw, "Plan", { Key: "classic", Name: "Classic", PriceUsd: 199, CreditUsd: 200, Assisted: "tech-lead", MaxParallelStreams: 2, Priority: 2, FeaturesJson: JSON.stringify(["200 USD credit every month"]), ContactSales: false, Active: true, SortOrder: 2 });
    seedRow(t.raw, "Coupon", couponRow({ Code: "CLASSIC-3M", Kind: "plan", PlanKeys: ["classic"], DurationMonths: 3, Redemptions: 2, MaxRedemptions: 10 }));
    seedRow(t.raw, "Coupon", couponRow({ Code: "HALF-OFF", Kind: "discount", PercentOff: 50, DurationMonths: 2, Note: "Launch" }));
    seedRow(t.raw, "Coupon", couponRow({ Code: "OLD-PROMO", Kind: "discount", AmountOffUsd: 20, Active: false }));
    seedRow(t.raw, "Coupon", couponRow({ Code: "GIFT-25", Kind: "credit", AmountUsd: 25 }));

    expect(await t.run()).toBe(0);
    expect(t.fake.plans).toEqual([]);
    expect(t.fake.discounts).toEqual([]);
    expect(t.lines).toEqual(expect.arrayContaining([
      "plan free: create (USD 0.00 a month)",
      "plan classic: create (USD 199.00 a month)",
      "plan speed: create (USD 399.00 a month)",
      "plan enterprise: create (contact sales, no price)",
      "code CLASSIC-3M: create (plan); 2 earlier use(s) are not carried over; the total limit is not carried over (Utilities: one use per organization)",
      "code OLD-PROMO: create (discount, then archive)",
      "code GIFT-25: stays here (a credit code; Utilities has no code that adds credit)",
      "dry run: 7 change(s) to make; nothing written to Utilities (add --apply).",
    ]));
    const report = JSON.parse(fs.readFileSync(path.join(t.dir, "report-plan.json"), "utf8"));
    expect(report).toMatchObject({ kind: "blocks-utilities-sync", mode: "dry-run", factory: { plans: 4, coupons: 4 } });
    expect(JSON.stringify(report)).not.toMatch(/secret|token/i);

    expect(await t.run("--apply")).toBe(0);
    expect(t.fake.plans.map((p) => [p.code, p.status, p.prices.map((x) => x.unitAmountMinor)])).toEqual([
      ["free", "Active", [0]], ["classic", "Active", [19_900]], ["speed", "Active", [39_900]], ["enterprise", "Active", []],
    ]);
    expect(t.fake.discounts.map((d) => [d.code, d.kind, d.percentBasisPoints ?? d.amountMinor, d.status])).toEqual([
      ["classic-3m", "Percent", 10_000, "Active"], ["half-off", "Percent", 5_000, "Active"], ["old-promo", "FixedAmount", 2_000, "Archived"],
    ]);
    // the catalogue goes out on the service identity only
    expect(t.fake.calls.every((c) => c.org === null)).toBe(true);

    expect(await t.run("--apply")).toBe(0);
    expect(t.lines).toContain("0 done, 0 failed. billing.source is unchanged: switch it on Platform > Plans when the catalogue is checked.");
  });

  it("carries a changed price as a new price (the old one archived) and a switched-off plan as an archive", async () => {
    const t = setup();
    expect(await t.run("--apply")).toBe(0);
    seedRow(t.raw, "Plan", { Key: "speed", Name: "Speed", PriceUsd: 449, CreditUsd: 400, Assisted: "business", MaxParallelStreams: 5, Priority: 3, FeaturesJson: "[]", ContactSales: false, Active: true, SortOrder: 3 });
    seedRow(t.raw, "Plan", { Key: "free", Name: "Free", PriceUsd: 0, CreditUsd: 50, Assisted: "none", MaxParallelStreams: 1, Priority: 1, FeaturesJson: "[]", ContactSales: false, Active: false, SortOrder: 1 });
    expect(await t.run()).toBe(0);
    expect(t.lines).toEqual(expect.arrayContaining(["plan speed: new version, new price USD 449.00 a month", "plan free: archive (switched off here)"]));
    expect(await t.run("--apply")).toBe(0);
    const speed = t.fake.plans.find((p) => p.code === "speed")!;
    expect(speed.prices.map((p) => p.unitAmountMinor)).toEqual([44_900]);
    expect(t.fake.plans.find((p) => p.code === "free")!.status).toBe("Archived");
  });

  it("stops before writing anything when Utilities does not answer, and reports a failed write", async () => {
    const t = setup();
    t.fake.failNext(503);
    expect(await t.run("--apply")).toBe(1);
    expect(t.lines.at(-1)).toBe("Blocks Utilities did not answer the catalogue read (utilities_unavailable, 503). Nothing was written.");
    expect(t.fake.plans).toEqual([]);
    // a code Utilities refuses is recorded (its code and status only) and the rest goes on; the exit says so
    seedRow(t.raw, "Coupon", couponRow({ Code: "BAD-ONE", Kind: "plan", PlanKeys: ["classic"], DurationMonths: 1 }));
    seedRow(t.raw, "Coupon", couponRow({ Code: "GOOD-ONE", Kind: "plan", PlanKeys: ["classic"], DurationMonths: 1 }));
    const service = t.fake.access(null).service;
    const refusing = {
      ...service,
      discounts: {
        ...service.discounts,
        create: (d: Parameters<typeof service.discounts.create>[0]) =>
          d.code === "bad-one" ? Promise.reject(new UtilitiesError({ code: "subscription_discount_invalid", status: 400, message: "The service's own sentence.", fields: {} })) : service.discounts.create(d),
      },
    };
    const lines: string[] = [];
    expect(await syncMain(["--apply", "--report", path.join(t.dir, "refused.json")], t.dir, { wiring: { raw: t.raw, utilities: refusing }, log: (l) => lines.push(l) })).toBe(1);
    expect(lines).toContain("failed: code BAD-ONE: create (plan) (subscription_discount_invalid, 400)");
    expect(lines.join("\n")).not.toContain("own sentence");
    expect(t.fake.discounts.map((d) => d.code)).toEqual(["good-one"]);
    expect(t.fake.plans).toHaveLength(4);
  });
});

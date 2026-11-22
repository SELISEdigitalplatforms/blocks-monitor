// The billing replies read defensively, the shared words and figures, and the reads and writes over a fake billing
// function (the op names and arguments are the shared contract).
import { describe, expect, it, vi } from "vitest";
import { FunctionError } from "../../src/blocks/fn";
import { FunctionNotConfiguredError } from "../../src/blocks/functions";
import {
  BILLING_FN, SUMMARY_BUSY_MS, SUMMARY_IDLE_MS, billingErrorText, couponProblem, fetchBillingPlans, fetchBillingSummary, fetchJobUsage,
  isBillingMissing, redeemCoupon, requestPurchase, summaryPace, type BillingCall,
} from "../../src/components/billing/billingData";
import { toBillingPlans, toBillingSummary, toBuildUsage, toJobUsages, type BillingSummary } from "../../src/components/billing/types";
import {
  agentsText, contactSalesDraft, creditLine, creditNotice, creditState, money, pendingText, pillText, planCreditText, planPriceText, planTagline,
  renewsText, tokensText, usedOf, usedShare,
} from "../../src/components/billing/usageText";

export const SUMMARY: BillingSummary = {
  plan: { key: "free", name: "Free", assisted: "none", maxParallelStreams: 1 },
  balanceUsd: 37.6, grantedUsd: 50, consumedUsd: 12.4, tokens: 5_325_798,
  perProject: [{ projectId: "p-1", name: "Customer portal", costUsd: 9.1, tokens: 4_000_000 }, { projectId: "p-2", name: "Invoices", costUsd: 3.3, tokens: 1_325_798 }],
  activeAgents: 4, runningJobs: 1,
  monthUsedUsd: 12.4, monthTokens: 5_325_798, renewsAt: null, pendingRequests: [],
};

/** A fake callFunction: answers each op from the map (a function: called with the args), records every call. */
function fakeCall(answers: Record<string, unknown>) {
  const calls: { name: string; op: string; args?: Record<string, unknown> }[] = [];
  const call = vi.fn(async (name: string, op: string, args?: Record<string, unknown>) => {
    calls.push({ name, op, args });
    if (!(op in answers)) throw new FunctionError("unknown_op", "Something went wrong. Please try again.", "req-1");
    const a = answers[op];
    if (a instanceof Error) throw a;
    return { data: typeof a === "function" ? (a as (x: unknown) => unknown)(args) : a, serverNow: null, requestId: "req-1" };
  });
  return { call: call as unknown as BillingCall, calls };
}

describe("the replies", () => {
  it("reads a summary as the contract writes it, sorting projects by cost", () => {
    const s = toBillingSummary({ ...SUMMARY, perProject: [...SUMMARY.perProject].reverse() });
    expect(s).toEqual(SUMMARY);
  });

  it("refuses a reply without a balance and never invents figures", () => {
    expect(toBillingSummary(null)).toBeNull();
    expect(toBillingSummary({ plan: null })).toBeNull();
    expect(toBillingSummary({ balanceUsd: 3 })).toEqual({
      plan: null, balanceUsd: 3, grantedUsd: 0, consumedUsd: 0, tokens: 0, perProject: [], activeAgents: 0, runningJobs: 0,
      monthUsedUsd: null, monthTokens: null, renewsAt: null, pendingRequests: [],
    });
  });

  it("reads the additive fields: this month, the renewal and the requests that wait", () => {
    const s = toBillingSummary({
      ...SUMMARY, consumedUsd: 450, monthUsedUsd: 150, monthTokens: 900_000,
      subscription: { status: "active", startedAt: "2026-09-01T00:00:00Z", renewsAt: "2026-12-01T00:00:00Z" },
      pendingRequests: [{ id: "pr-1", planKey: "speed", amountUsd: null, status: "pending", createdAt: "2026-11-09T10:00:00Z", note: "" },
        { id: "pr-0", planKey: null, amountUsd: 100, status: "approved" }],
    })!;
    expect(s.renewsAt).toBe("2026-12-01T00:00:00Z");
    expect(s.pendingRequests).toEqual([{ id: "pr-1", planKey: "speed", amountUsd: null, createdAt: "2026-11-09T10:00:00Z" }]);
    expect(usedOf(s)).toEqual({ usd: 150, tokens: 900_000, label: "Used this month" });
    expect(pillText(s)).toBe("USD 150.00 used · 37.60 left · 4 agents working");
    expect(pendingText(s)).toBe("Your request for the Speed plan waits for a platform administrator.");
    expect(renewsText(s.renewsAt)).toBe("Next credit on 1 Dec 2026");
    // without the month figures: everything so far, named so
    expect(usedOf({ ...s, monthUsedUsd: null })).toEqual({ usd: 450, tokens: SUMMARY.tokens, label: "Used so far" });
    expect(pendingText({ ...s, pendingRequests: [{ id: "a", planKey: null, amountUsd: 100, createdAt: null }, { id: "b", planKey: "classic", amountUsd: null, createdAt: null }] }))
      .toBe("Your request for USD 100.00 of credit and 1 more wait for a platform administrator.");
  });

  it("reads plan rows in either case, the features from FeaturesJson, contact sales without a price", () => {
    const plans = toBillingPlans({ plans: [
      { Key: "enterprise", Name: "Enterprise", PriceUsd: null, ContactSales: true, Assisted: "dedicated", SortOrder: 4, Active: true },
      { Key: "classic", Name: "Classic", PriceUsd: 199, CreditUsd: 200, Assisted: "tech-lead", MaxParallelStreams: 2, SortOrder: 2, FeaturesJson: "[\"Weekly review\"]" },
      { key: "free", name: "Free", priceUsd: 0, creditUsd: 50, assisted: "none", maxParallelStreams: 1, sortOrder: 1 },
      { key: "old", name: "Old", priceUsd: 10, active: false, sortOrder: 0 },
      { key: "speed", name: "Speed", priceUsd: 399, creditUsd: 400, assisted: "business", maxParallelStreams: 5, sortOrder: 3 },
    ] });
    expect(plans.map((p) => p.key)).toEqual(["free", "classic", "speed", "enterprise"]);
    expect(plans[1]).toMatchObject({ priceUsd: 199, creditUsd: 200, assisted: "tech-lead", features: ["Weekly review"] });
    expect(plans[3]).toMatchObject({ priceUsd: null, contactSales: true });
    expect(plans.map((p) => planPriceText(p))).toEqual(["USD 0 / month", "USD 199 / month", "USD 399 / month", null]);
    expect(plans.map((p) => planTagline(p))).toEqual([
      "Self-serve", "With a tech-lead consultant", "With a business consultant · more parallel streams · priority", "Dedicated team · built to your needs",
    ]);
    expect(plans.map((p) => planCreditText(p))).toEqual(["USD 50 credit when you sign up", "USD 200 credit per month", "USD 400 credit per month", "Custom credit"]);
  });

  it("reads a build's charge: so far while it runs, its total once ended, not counted without one", () => {
    const charge = { jobId: "job-1", costUsd: 3.68, tokens: 5_325_798, at: "2026-11-11T10:00:00.000Z" };
    // running: nothing finished yet, then what its finished parts cost so far
    expect(toBuildUsage(null, true)).toEqual({ costUsd: null, tokens: null, running: true });
    expect(toBuildUsage(undefined, true)).toEqual({ costUsd: null, tokens: null, running: true });
    expect(toBuildUsage(charge, true)).toEqual({ costUsd: 3.68, tokens: 5_325_798, running: true });
    // ended: the charge, or "not counted" when there is none; nothing while it is still being read
    expect(toBuildUsage(charge, false)).toEqual({ costUsd: 3.68, tokens: 5_325_798, running: false });
    expect(toBuildUsage(null, false)).toEqual({ costUsd: null, tokens: null, running: false });
    expect(toBuildUsage(undefined, false)).toBeNull();
  });

  it("reads billing.jobs.usage defensively: rows without a job id are left out, never a negative figure", () => {
    expect(toJobUsages({ jobs: [
      { jobId: "job-1", costUsd: 1.5, tokens: 1200.4, at: "2026-11-11T10:00:00.000Z" },
      { jobId: "", costUsd: 9 },
      { costUsd: 9 },
      { jobId: "job-2", costUsd: -2, tokens: -5 },
      "x",
    ] })).toEqual([
      { jobId: "job-1", costUsd: 1.5, tokens: 1200, at: "2026-11-11T10:00:00.000Z" },
      { jobId: "job-2", costUsd: 0, tokens: 0, at: null },
    ]);
    expect(toJobUsages(null)).toEqual([]);
    expect(toJobUsages({ jobs: "no" })).toEqual([]);
  });
});

describe("the words", () => {
  it("writes the pill, the menu line and the figures", () => {
    expect(pillText(SUMMARY)).toBe("USD 12.40 used · 37.60 left · 4 agents working");
    expect(creditLine(SUMMARY)).toBe("Credit: USD 37.60 left");
    expect(money(1234.5)).toBe("1,234.50");
    expect(tokensText(830)).toBe("830 tokens");
    expect(tokensText(48_200)).toBe("48,200 tokens");
    expect(tokensText(5_325_798)).toBe("5.33 million tokens");
    expect(agentsText(0)).toBe("No agents working");
    expect(agentsText(1)).toBe("1 agent working");
    expect(usedShare(SUMMARY)).toBeCloseTo(24.8);
  });

  it("low and out of credit say so in plain words with the next step", () => {
    expect(creditState(SUMMARY)).toBe("ok");
    const low = { ...SUMMARY, balanceUsd: 6, consumedUsd: 44 };
    expect(creditState(low)).toBe("low");
    expect(creditNotice(low)?.text).toBe("USD 6.00 left. Add credit before the next build: redeem a coupon or change your plan.");
    expect(creditState({ ...SUMMARY, grantedUsd: 0, balanceUsd: 4 })).toBe("low");
    const out = { ...SUMMARY, balanceUsd: -0.4, consumedUsd: 50.4, monthUsedUsd: 50.4 };
    expect(creditState(out)).toBe("out");
    expect(creditLine(out)).toBe("Credit: none left");
    expect(pillText(out)).toBe("USD 50.40 used · 0.00 left · 4 agents working");
    expect(creditNotice(out)?.title).toBe("Your credit is used up");
    expect(creditNotice(SUMMARY)).toBeNull();
  });

  it("prefills the contact-sales message", () => {
    expect(contactSalesDraft("Northwind")).toMatch(/^We would like to talk about the Enterprise plan for Northwind\.\nTeam size: /);
  });

  it("checks a coupon code before it is sent", () => {
    expect(couponProblem("  ")).toBe("Enter the code from your coupon.");
    expect(couponProblem("spring 50")).toBeNull();
    expect(couponProblem("50%off")).toBe("A code has 4 to 32 letters, digits or dashes.");
    expect(couponProblem("MF-7KQ3-XW9P")).toBeNull();
    expect(couponProblem("AB")).toBe("A code has 4 to 32 letters, digits or dashes.");
  });
});

describe("the reads and writes over the billing function", () => {
  it("billing.summary {workspaceId}", async () => {
    const { call, calls } = fakeCall({ "billing.summary": SUMMARY });
    await expect(fetchBillingSummary("ws-1", call)).resolves.toEqual(SUMMARY);
    expect(calls).toEqual([{ name: BILLING_FN, op: "billing.summary", args: { workspaceId: "ws-1" } }]);
    expect(BILLING_FN).toBe("billing");
  });

  it("billing.jobs.usage {workspaceId, jobIds}", async () => {
    const { call, calls } = fakeCall({ "billing.jobs.usage": { jobs: [{ jobId: "job-1", costUsd: 2.5, tokens: 900, at: "2026-11-11T10:00:00.000Z" }] } });
    await expect(fetchJobUsage("ws-1", ["job-1"], call)).resolves.toEqual([{ jobId: "job-1", costUsd: 2.5, tokens: 900, at: "2026-11-11T10:00:00.000Z" }]);
    expect(calls).toEqual([{ name: BILLING_FN, op: "billing.jobs.usage", args: { workspaceId: "ws-1", jobIds: ["job-1"] } }]);
  });

  it("a reply that is no summary fails instead of showing zeros", async () => {
    const { call } = fakeCall({ "billing.summary": { hello: 1 } });
    await expect(fetchBillingSummary("ws-1", call)).rejects.toBeInstanceOf(FunctionError);
  });

  it("an op that is not there yet reads as missing, calmly", async () => {
    const { call } = fakeCall({});
    const e = await fetchBillingSummary("ws-1", call).catch((x: unknown) => x);
    expect(isBillingMissing(e)).toBe(true);
    expect(isBillingMissing(new FunctionNotConfiguredError("admin"))).toBe(true);
    expect(isBillingMissing(new TypeError('Unknown function "billing".'))).toBe(true);
    expect(isBillingMissing(new FunctionError("timeout", "slow", "r"))).toBe(false);
    expect(billingErrorText(e)).toBe("This isn't available yet. Try again later.");
    expect(billingErrorText(new FunctionError("forbidden", "You don't have access.", "r"))).toBe("Only the workspace owner can do this.");
  });

  it("billing.plans.list", async () => {
    const { call } = fakeCall({ "billing.plans.list": [{ key: "free", name: "Free", priceUsd: 0, creditUsd: 50 }] });
    await expect(fetchBillingPlans(call)).resolves.toMatchObject([{ key: "free", priceUsd: 0 }]);
  });

  it("billing.redeemCoupon sends the code upper case without spaces", async () => {
    const { call, calls } = fakeCall({ "billing.redeemCoupon": { balanceUsd: 87.6 } });
    await redeemCoupon("ws-1", " spring 50 ", call);
    expect(calls[0]).toEqual({ name: "billing", op: "billing.redeemCoupon", args: { workspaceId: "ws-1", code: "SPRING50" } });
  });

  it("billing.requestPurchase sends a plan or an amount, and a contact-sales note only when there is one", async () => {
    const { call, calls } = fakeCall({ "billing.requestPurchase": { status: "pending" } });
    await requestPurchase({ workspaceId: "ws-1", planKey: "classic" }, call);
    await requestPurchase({ workspaceId: "ws-1", amountUsd: 100 }, call);
    await requestPurchase({ workspaceId: "ws-1", planKey: "enterprise", note: " Team size: 40 " }, call);
    expect(calls.map((c) => c.args)).toEqual([
      { workspaceId: "ws-1", planKey: "classic" },
      { workspaceId: "ws-1", amountUsd: 100 },
      { workspaceId: "ws-1", planKey: "enterprise", note: "Team size: 40" },
    ]);
  });

  it("reads the summary every 10 s while an engine job runs, every 60 s when none runs", () => {
    expect(SUMMARY_BUSY_MS).toBe(10_000);
    expect(SUMMARY_IDLE_MS).toBe(60_000);
    expect(summaryPace(SUMMARY)).toBe(SUMMARY_BUSY_MS);
    expect(summaryPace({ ...SUMMARY, activeAgents: 0, runningJobs: 1 })).toBe(SUMMARY_BUSY_MS);
    expect(summaryPace({ ...SUMMARY, activeAgents: 0, runningJobs: 0 })).toBe(SUMMARY_IDLE_MS);
    expect(summaryPace(undefined)).toBe(SUMMARY_IDLE_MS);
    // never more than 6 reads a minute, however many surfaces show the figures
    expect(60_000 / SUMMARY_BUSY_MS).toBeLessThanOrEqual(6);
  });
});

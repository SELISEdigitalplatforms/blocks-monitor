// Checkout and the Billing page as they render: the order summary, the payment step (a code today; card payments say
// plainly they are being connected, never a card form), the receipt, the plan's status and the owner-only actions.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "../../src/domain/billing";
import type { BillingAccountView, CheckoutView, PaymentView } from "../../src/domain/payments";
import { FUNCTION_ERROR_MESSAGES } from "../../src/blocks/fn";
import { CodeField, OrderSummary, Paid, PaymentStep } from "../../src/components/billing/CheckoutPage";
import { BillingView } from "../../src/components/billing/BillingPage";
import { dayText, renewalSentence, subscriptionStatus } from "../../src/components/billing/checkoutText";

const wrap = (el: ReactElement) => (
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>
);
const html = (el: ReactElement) => renderToStaticMarkup(wrap(el));
const text = (el: ReactElement) => html(el).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const CLASSIC = DEFAULT_PLANS.find((p) => p.key === "classic")!;
const OPEN: CheckoutView = {
  id: "pay-1", workspaceId: "ws-1", status: "open", kind: "new", plan: { ...CLASSIC, features: [...CLASSIC.features] }, fromPlan: null,
  amountUsd: 199, creditUsd: 200, periodStart: "2026-11-01T00:00:00.000Z", renewsOn: "2026-12-01T00:00:00.000Z", code: null,
  discountUsd: 0, dueUsd: 199, paidThrough: null,
  provider: { id: "coupon", connected: true, acceptsCards: false, message: "Card payments are being connected. Until then a code pays for a plan." },
  canConfirm: false, blocker: "Card payments are being connected. Until then a code pays for a plan.", expiresAt: "2026-11-02T00:00:00.000Z", receipt: null,
};
const PAID_BY_CODE: CheckoutView = {
  ...OPEN, code: { code: "CLASSIC-3M", kind: "plan", description: "Pays the Classic plan for 3 months" }, discountUsd: 199, dueUsd: 0,
  paidThrough: "2027-02-01T00:00:00.000Z", canConfirm: true, blocker: null,
};
const RECEIPT: PaymentView = {
  id: "pay-1", kind: "new", planKey: "classic", planName: "Classic", fromPlanKey: null, provider: "coupon", amountUsd: 199, discountUsd: 199, paidUsd: 0,
  creditUsd: 200, couponCode: "CLASSIC-3M", status: "paid", receiptNo: "MF-20261101-AB12CD", periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-12-01T00:00:00.000Z", paidThrough: "2027-02-01T00:00:00.000Z", paidAt: "2026-11-01T00:00:00.000Z", note: "",
};
const ACCOUNT: BillingAccountView = {
  subscription: {
    planKey: "classic", planName: "Classic", priceUsd: 199, status: "active", startedAt: "2026-11-01T00:00:00.000Z", currentPeriodStart: "2026-11-01T00:00:00.000Z",
    renewsAt: "2026-12-01T00:00:00.000Z", paidThrough: "2027-02-01T00:00:00.000Z", cancelAtPeriodEnd: false, nextPlan: null, provider: "coupon",
    couponCode: "CLASSIC-3M", statusNote: "", pastDueSince: null,
  },
  payments: [RECEIPT],
  canManage: true,
  provider: OPEN.provider,
};

describe("checkout", () => {
  it("summarizes the plan and what is due today", () => {
    const t = text(<OrderSummary checkout={OPEN} />);
    expect(t).toMatch(/Order summary Classic Price USD 199.00 a month Credit included USD 200.00 a month Help With a tech-lead consultant/);
    expect(t).toContain("Renews on 1 December 2026");
    expect(t).toMatch(/Classic, first month USD 199.00 Due today USD 199.00 Credit added now USD 200.00/);
  });

  it("says plainly that card payments are being connected and shows no card form", () => {
    const markup = html(<PaymentStep checkout={OPEN} />);
    expect(markup).toContain("Card payments are being connected");
    expect(markup).not.toMatch(/card number|cvc|expiry|<input/i);
  });

  it("with a plan code: nothing due, the code and the day it pays until", () => {
    expect(text(<PaymentStep checkout={PAID_BY_CODE} />)).toContain("Nothing to pay today. Your code pays the Classic plan until 1 February 2027.");
    const summary = text(<OrderSummary checkout={PAID_BY_CODE} />);
    expect(summary).toMatch(/Code CLASSIC-3M − USD 199.00 Due today USD 0.00/);
    expect(text(<CodeField checkout={PAID_BY_CODE} initialCode="" disabled={false} onChange={() => {}} />)).toMatch(/CLASSIC-3M Pays the Classic plan for 3 months Remove/);
  });

  it("shows the receipt after confirm", () => {
    const t = text(<Paid checkout={{ ...PAID_BY_CODE, status: "paid", receipt: RECEIPT }} workspaceName="Acme" onDone={() => {}} />);
    expect(t).toContain("Classic is active");
    expect(t).toMatch(/Receipt MF-20261101-AB12CD Date 1 November 2026 Organization Acme Plan Classic/);
    expect(t).toMatch(/Paid USD 0.00 · Code CLASSIC-3M Credit added USD 200.00 Paid until 1 February 2027/);
  });
});

describe("the Billing page", () => {
  it("shows the plan, its renewal and the owner's actions, and the receipts", () => {
    const t = text(<BillingView account={ACCOUNT} workspaceId="ws-1" workspaceName="Acme" />);
    expect(t).toMatch(/Classic Active USD 199.00 a month Renews on 1 December 2026. Your code pays it until 1 February 2027./);
    expect(t).toContain("Change plan");
    expect(t).toContain("Cancel plan");
    expect(t).toMatch(/Payment history .* 1 November 2026 Classic, 1 November 2026 to 1 December 2026 .* USD 0.00 Receipt/);
    expect(t).toContain("Card payments are being connected");
  });

  it("members read; only owners change", () => {
    const t = text(<BillingView account={{ ...ACCOUNT, canManage: false }} workspaceId="ws-1" workspaceName="Acme" />);
    expect(t).not.toContain("Change plan");
    expect(t).toContain("Only the organization's owners can change or cancel the plan.");
  });

  it("a cancel at period end offers to keep the plan; past due offers to pay with a code", () => {
    const cancelled = { ...ACCOUNT, subscription: { ...ACCOUNT.subscription, cancelAtPeriodEnd: true } };
    const t = text(<BillingView account={cancelled} workspaceId="ws-1" workspaceName="Acme" />);
    expect(t).toMatch(/Ends on renewal day .* Ends on 1 December 2026. After that your organization is on Free; credit left stays./);
    expect(t).toContain("Keep Classic");
    const due = { ...ACCOUNT, subscription: { ...ACCOUNT.subscription, status: "past_due" as const, statusNote: "The Classic plan's payment for the month from 2026-12-01 is due." } };
    const d = text(<BillingView account={due} workspaceId="ws-1" workspaceName="Acme" />);
    expect(d).toContain("Payment due");
    expect(d).toContain("Pay with a code");
  });

  it("words the status and renewal of every state", () => {
    expect(subscriptionStatus({ ...ACCOUNT.subscription, nextPlan: { key: "free", name: "Free" } })).toEqual({ label: "Moves to Free", tone: "warning" });
    expect(renewalSentence({ ...ACCOUNT.subscription, nextPlan: { key: "free", name: "Free" } })).toBe("Moves to Free on 1 December 2026.");
    expect(renewalSentence({ ...ACCOUNT.subscription, planKey: "free", planName: "Free", priceUsd: 0, renewsAt: null })).toMatch(/Free has no renewal/);
    expect(dayText("2026-12-01T00:00:00.000Z")).toBe("1 December 2026");
  });

  it("the paywall's refusal has its own plain message", () => {
    expect(FUNCTION_ERROR_MESSAGES["billing.paywall"]).toMatch(/no credit left. Choose a plan or redeem a code/);
  });
});

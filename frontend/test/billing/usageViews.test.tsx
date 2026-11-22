// The usage surfaces as they render: the pill and its breakdown, the account menu line, the Plan and usage card in its
// loading, not-available, ready, low-credit and out-of-credit states, and the plan cards with contact sales.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// the open workspace (the zustand store answers its initial state when rendered to a string)
const ws = vi.hoisted(() => ({ current: null as { id: string; name: string } | null }));
vi.mock("../../src/state/workspaces", async (orig) => ({ ...(await orig<typeof import("../../src/state/workspaces")>()), useCurrentWorkspace: () => ws.current }));
import { FunctionError } from "../../src/blocks/fn";
import { billingKeys } from "../../src/components/billing/billingData";
import { UsageBreakdown, UsagePill, UsagePillButton } from "../../src/components/billing/UsagePill";
import { CreditMenuItem, CreditMenuLine } from "../../src/components/billing/CreditMenuLine";
import { PlanUsageView, RedeemCouponForm, planUsageState } from "../../src/components/billing/PlanUsageCard";
import { ContactSalesForm, PlanGrid } from "../../src/components/billing/PlanCards";
import { toBillingPlans, type BillingSummary } from "../../src/components/billing/types";
import { contactSalesDraft } from "../../src/components/billing/usageText";
import { SUMMARY } from "./usageData.test";

const LOW: BillingSummary = { ...SUMMARY, balanceUsd: 3.2, consumedUsd: 46.8, monthUsedUsd: 46.8, activeAgents: 0, runningJobs: 0 };
const OUT: BillingSummary = { ...SUMMARY, balanceUsd: 0, consumedUsd: 50, monthUsedUsd: 50, activeAgents: 0, runningJobs: 0 };

const text = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

afterEach(() => { ws.current = null; });

describe("the usage pill", () => {
  it("says what was used, what is left and how many agents work", () => {
    const t = text(<UsagePillButton summary={SUMMARY} />);
    expect(t).toContain("USD 12.40 used");
    expect(t).toContain("37.60 left");
    expect(t).toContain("4 agents working");
    expect(html(<UsagePillButton summary={SUMMARY} />)).toContain('aria-label="Usage: USD 12.40 used · 37.60 left · 4 agents working. Show the breakdown"');
  });

  it("marks low credit and out of credit (word and tone, never colour alone)", () => {
    expect(html(<UsagePillButton summary={LOW} />)).toContain('data-credit="low"');
    expect(text(<UsagePillButton summary={LOW} />)).toContain("3.20 left");
    expect(html(<UsagePillButton summary={OUT} />)).toContain('data-credit="out"');
    expect(text(<UsagePillButton summary={OUT} />)).toContain("No credit left");
  });

  it("the breakdown: credit left, this project, this build, agents and plan", () => {
    const t = text(<UsageBreakdown summary={SUMMARY} projectId="p-2" build={{ costUsd: null, tokens: null, running: true }} />);
    expect(t).toContain("Credit left USD 37.60");
    expect(t).toContain("USD 12.40 used this month · 5.33 million tokens");
    expect(t).toContain("This project USD 3.30 1.33 million tokens");
    expect(t).toContain("This build Counted when it finishes");
    expect(t).toContain("Agents working now 4 agents working 1 job running");
    expect(t).toContain("Plan Free Self-serve · 1 parallel stream");
    expect(html(<UsageBreakdown summary={SUMMARY} />)).toContain('href="/settings#plan"');
  });

  it("the breakdown of a project that used nothing, and of a finished build", () => {
    const t = text(<UsageBreakdown summary={SUMMARY} projectId="p-9" build={{ costUsd: 3.6831, tokens: 5325798, running: false }} />);
    expect(t).toContain("This project USD 0.00 Nothing used yet");
    expect(t).toContain("This build USD 3.68 5.33 million tokens");
    expect(text(<UsageBreakdown summary={SUMMARY} build={{ costUsd: null, tokens: null, running: false }} />)).toContain("This build Not counted");
  });

  it("the breakdown of a running build shows what its finished parts cost so far", () => {
    const t = text(<UsageBreakdown summary={SUMMARY} projectId="p-1" build={{ costUsd: 1.2, tokens: 1_536_317, running: true }} />);
    expect(t).toContain("This build USD 1.20 so far 1.54 million tokens");
  });

  it("the breakdown says when credit is used up and what to do", () => {
    expect(text(<UsageBreakdown summary={OUT} />)).toContain("Your credit is used up. New work waits until credit is added. Redeem a coupon or change your plan");
  });

  it("shows nothing until there is a summary; shows the cached one for the open workspace", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (el: ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
    expect(html(wrap(<UsagePill />))).toBe("");
    ws.current = { id: "ws-1", name: "Northwind" };
    expect(html(wrap(<UsagePill />))).toBe("");
    client.setQueryData(billingKeys.summary("ws-1"), SUMMARY);
    expect(text(wrap(<UsagePill projectId="p-1" />))).toContain("USD 12.40 used");
    expect(text(wrap(<CreditMenuLine />))).toBe("Credit: USD 37.60 left");
  });
});

describe("the account menu line", () => {
  it("names the credit left and links to Plan and usage", () => {
    expect(text(<CreditMenuItem summary={SUMMARY} />)).toBe("Credit: USD 37.60 left");
    expect(html(<CreditMenuItem summary={SUMMARY} />)).toContain('role="menuitem"');
    expect(text(<CreditMenuItem summary={OUT} />)).toBe("Credit: none left");
  });
});

describe("the Plan and usage card", () => {
  const view = (state: Parameters<typeof PlanUsageView>[0]["state"]) => <PlanUsageView state={state} onChangePlan={() => undefined} coupon={<span>COUPON</span>} />;

  it("loading, then not available (calm, no figures)", () => {
    expect(html(view({ kind: "loading" }))).toContain('aria-label="Loading your plan and usage"');
    const missing = text(view({ kind: "unavailable", missing: true }));
    expect(missing).toContain("Plan and usage can't be shown right now");
    expect(missing).toContain("once billing is switched on");
    expect(missing).not.toMatch(/USD/);
    expect(text(view({ kind: "unavailable", missing: false }))).toContain("Try again in a moment");
  });

  it("derives its state from the read: the last summary stays when a later read fails", () => {
    expect(planUsageState({ isError: false, error: null }, true)).toEqual({ kind: "loading" });
    expect(planUsageState({ isError: true, error: new FunctionError("unknown_op", "x", "r") }, true)).toEqual({ kind: "unavailable", missing: true });
    expect(planUsageState({ isError: true, error: new FunctionError("timeout", "x", "r") }, true)).toEqual({ kind: "unavailable", missing: false });
    expect(planUsageState({ data: SUMMARY, isError: true, error: new Error("x") }, true)).toEqual({ kind: "ready", summary: SUMMARY });
    expect(planUsageState({ isError: false, error: null }, false)).toEqual({ kind: "unavailable", missing: true });
  });

  it("ready: credit left, used this month in USD and tokens, plan, agents, cost by project, coupon", () => {
    const t = text(view({ kind: "ready", summary: SUMMARY }));
    expect(t).toContain("Credit left USD 37.60 of USD 50.00 credit");
    expect(t).toContain("25% used 75% left");
    expect(t).toContain("Plan Free Self-serve · 1 parallel stream");
    expect(t).toContain("Used this month USD 12.40 5.33 million tokens");
    expect(t).toContain("Agents working now 4 agents working 1 job running");
    expect(t).toMatch(/Customer portal 4,000,000 USD 9.10 Invoices 1,325,798 USD 3.30/);
    expect(t).toContain("Change plan");
    expect(t).toContain("Redeem a coupon COUPON");
    expect(t).not.toContain("running low");
  });

  it("low credit: a plain notice with Change plan as the next step", () => {
    const t = text(view({ kind: "ready", summary: LOW }));
    expect(t).toContain("Your credit is running low. USD 3.20 left. Add credit before the next build");
    expect(t).toContain("No agents working");
    expect(t.match(/Change plan/g)).toHaveLength(1);
  });

  it("out of credit: says new work waits, and how to add credit", () => {
    const t = text(view({ kind: "ready", summary: OUT }));
    expect(t).toContain("Your credit is used up. New work waits until credit is added.");
    expect(t).toContain("Credit left USD 0.00");
  });

  it("a paid plan: the renewal date and a request that waits for approval", () => {
    const t = text(view({ kind: "ready", summary: { ...SUMMARY, grantedUsd: 600, balanceUsd: 150, renewsAt: "2026-12-01T00:00:00Z",
      pendingRequests: [{ id: "pr-1", planKey: "speed", amountUsd: null, createdAt: null }] } }));
    expect(t).toContain("Your request for the Speed plan waits for a platform administrator.");
    expect(t).toContain("Credit left USD 150.00 of USD 600.00 credit · Next credit on 1 Dec 2026");
  });

  it("without this month's figures it says Used so far", () => {
    expect(text(view({ kind: "ready", summary: { ...SUMMARY, monthUsedUsd: null, monthTokens: null } }))).toContain("Used so far USD 12.40 5.33 million tokens");
  });

  it("no project cost yet reads plainly", () => {
    expect(text(view({ kind: "ready", summary: { ...SUMMARY, perProject: [] } }))).toContain("No project has used credit yet.");
  });

  it("the coupon form", () => {
    const t = text(<RedeemCouponForm onRedeem={() => undefined} pending={false} error={null} done />);
    expect(t).toContain("Coupon code");
    expect(t).toContain("Redeem");
    expect(t).toContain("Coupon redeemed. Your credit is updated.");
    expect(text(<RedeemCouponForm onRedeem={() => undefined} pending={false} error="This code has expired." done={false} />)).toContain("This code has expired.");
  });
});

describe("the plan cards", () => {
  const plans = toBillingPlans([
    { key: "free", name: "Free", priceUsd: 0, creditUsd: 50, assisted: "none", maxParallelStreams: 1, sortOrder: 1 },
    { key: "classic", name: "Classic", priceUsd: 199, creditUsd: 200, assisted: "tech-lead", maxParallelStreams: 2, sortOrder: 2 },
    { key: "speed", name: "Speed", priceUsd: 399, creditUsd: 400, assisted: "business", maxParallelStreams: 5, sortOrder: 3 },
    { key: "enterprise", name: "Enterprise", priceUsd: null, contactSales: true, assisted: "dedicated", sortOrder: 4 },
  ]);

  it("Free, Classic, Speed and Enterprise with price, help, credit and streams; the current plan is marked", () => {
    const t = text(<PlanGrid plans={plans} currentKey="free" selectedKey="speed" onSelect={() => undefined} />);
    expect(t).toMatch(/Free Your plan USD 0 \/ month Self-serve USD 50 credit when you sign up 1 parallel stream/);
    expect(t).toMatch(/Classic USD 199 \/ month With a tech-lead consultant USD 200 credit per month 2 parallel streams/);
    expect(t).toMatch(/Speed USD 399 \/ month With a business consultant · more parallel streams · priority USD 400 credit per month 5 parallel streams/);
    expect(t).toMatch(/Enterprise Contact sales Dedicated team · built to your needs Custom credit Custom parallel streams/);
    const h = html(<PlanGrid plans={plans} currentKey="free" selectedKey="speed" onSelect={() => undefined} />);
    expect(h.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("contact sales opens with a prefilled message", () => {
    const t = text(<ContactSalesForm value={contactSalesDraft("Northwind")} onChange={() => undefined} />);
    expect(t).toContain("Your message to our sales team");
    expect(t).toContain("We would like to talk about the Enterprise plan for Northwind.");
  });

  it("no AI wording on any surface", () => {
    const all = [
      text(<UsagePillButton summary={SUMMARY} />), text(<UsageBreakdown summary={SUMMARY} projectId="p-1" />),
      text(<PlanGrid plans={plans} currentKey={null} selectedKey={null} onSelect={() => undefined} />),
      text(<PlanUsageView state={{ kind: "ready", summary: OUT }} onChangePlan={() => undefined} coupon={null} />),
    ].join(" ");
    expect(all).not.toMatch(/\bAI\b|magic|sparkle/i);
  });
});

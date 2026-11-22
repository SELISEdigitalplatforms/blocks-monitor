// The top bar's credit pill: its two lines in the normal, low and out states, the placeholder while the summary loads,
// nothing when billing is missing, the details panel (real figures, links, the hidden limits slot), how it opens,
// pins and closes, and the liquid or reduced-motion classes.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: null as { id: string; name: string } | null }));
vi.mock("../../src/state/workspaces", async (orig) => ({ ...(await orig<typeof import("../../src/state/workspaces")>()), useCurrentWorkspace: () => ws.current }));
import { billingKeys } from "../../src/components/billing/billingData";
import {
  CLOSED, CreditDetails, CreditPill, CreditPillButton, CreditPillSkeleton, UsageLimitsSlot, creditPanelReducer, creditPillMode, creditPillView, panelMotion,
  renewalLine, type PanelEvent, type PanelState,
} from "../../src/components/billing/CreditPill";
import type { BillingSummary } from "../../src/components/billing/types";
import { SUMMARY } from "./usageData.test";

const CLASSIC: BillingSummary = {
  ...SUMMARY, plan: { key: "classic", name: "Classic", assisted: "tech-lead", maxParallelStreams: 2 }, balanceUsd: 137.6, grantedUsd: 200, consumedUsd: 62.4,
  monthUsedUsd: 62.4, renewsAt: "2026-12-01T00:00:00.000Z",
};
const LOW: BillingSummary = { ...SUMMARY, balanceUsd: 3.2, consumedUsd: 46.8, monthUsedUsd: 46.8, activeAgents: 0, runningJobs: 0 };
const OUT: BillingSummary = { ...SUMMARY, balanceUsd: 0, consumedUsd: 50, monthUsedUsd: 50, activeAgents: 0, runningJobs: 0 };

const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (el: ReactElement) => html(el).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

afterEach(() => { ws.current = null; });

describe("the credit pill", () => {
  it("says what is left over the plan and its reset date", () => {
    expect(creditPillView(CLASSIC)).toMatchObject({ state: "ok", figure: "USD 137.60 left", meta: "Classic · resets 1 Dec" });
    expect(creditPillView(SUMMARY).meta).toBe("Free plan");
    expect(creditPillView({ ...SUMMARY, plan: null }).meta).toBe("No plan yet");
    const t = text(<CreditPillButton summary={CLASSIC} />);
    expect(t).toContain("USD 137.60 left");
    expect(t).toContain("Classic · resets 1 Dec");
    const h = html(<CreditPillButton summary={CLASSIC} />);
    expect(h).toContain('aria-label="Credit: USD 137.60 left, Classic · resets 1 Dec. Show credit details"');
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain("focus-visible:ring-2");
  });

  it("marks low credit and out of credit in words and tone", () => {
    expect(creditPillView(LOW)).toMatchObject({ state: "low", figure: "USD 3.20 left", meta: "Low credit" });
    expect(html(<CreditPillButton summary={LOW} />)).toContain('data-credit="low"');
    expect(html(<CreditPillButton summary={LOW} />)).toContain("c-warning-text");
    expect(creditPillView(OUT)).toMatchObject({ state: "out", figure: "Out of credit" });
    expect(html(<CreditPillButton summary={OUT} />)).toContain('data-credit="out"');
    expect(html(<CreditPillButton summary={OUT} />)).toContain("c-danger-text");
    // under 20 % of the grant is low even above USD 5
    expect(creditPillView({ ...CLASSIC, balanceUsd: 30, consumedUsd: 170 }).state).toBe("low");
  });

  it("says when it is open", () => {
    const h = html(<CreditPillButton summary={SUMMARY} open panelId="p1" />);
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('aria-controls="p1"');
  });

  it("shows a placeholder while loading and nothing when billing is missing or failed", () => {
    expect(creditPillMode(false, { data: undefined, isError: false, isPending: true })).toBe("hidden");
    expect(creditPillMode(true, { data: undefined, isError: false, isPending: true })).toBe("loading");
    expect(creditPillMode(true, { data: undefined, isError: true, isPending: false })).toBe("hidden");
    expect(creditPillMode(true, { data: SUMMARY, isError: true, isPending: false })).toBe("ready");
    const sk = html(<CreditPillSkeleton />);
    expect(sk).toContain('aria-busy="true"');
    expect(sk).toContain("Loading your credit");
    expect(sk).not.toMatch(/USD/);
  });

  it("renders nothing without a workspace, the placeholder while loading, the pill once the summary is there", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (el: ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
    expect(html(wrap(<CreditPill />))).toBe("");
    ws.current = { id: "ws-1", name: "Northwind" };
    expect(html(wrap(<CreditPill />))).toContain("Loading your credit");
    client.setQueryData(billingKeys.summary("ws-1"), SUMMARY);
    const t = text(wrap(<CreditPill />));
    expect(t).toContain("USD 37.60 left");
    expect(t).not.toContain("Credit and usage"); // the details are closed
  });
});

describe("the credit details", () => {
  it("credit left, the period bar, used this month, plan, renewal, agents and the top projects", () => {
    const t = text(<CreditDetails summary={CLASSIC} />);
    expect(t).toContain("Credit left USD 137.60");
    expect(t).toContain("31% used 69% left of USD 200.00");
    expect(t).toContain("Used this month USD 62.40 5.33 million tokens");
    expect(t).toContain("Plan Classic With a tech-lead consultant · 2 parallel streams");
    expect(t).toContain("Renews Next credit on 1 Dec 2026");
    expect(t).toContain("Agents working now 4 agents working 1 job running");
    expect(t).toContain("Top projects by cost Customer portal USD 9.10 Invoices USD 3.30");
  });

  it("a plan without renewal says so; low and out explain the next step", () => {
    expect(renewalLine(SUMMARY)).toBe("Free plan · no renewal");
    expect(text(<CreditDetails summary={SUMMARY} />)).toContain("Renews Free plan · no renewal");
    expect(text(<CreditDetails summary={LOW} />)).toContain("Your credit is running low.");
    expect(text(<CreditDetails summary={OUT} />)).toContain("Your credit is used up.");
  });

  it("links to Plan and usage and Change plan; Usage & costs only for platform admins", () => {
    const h = html(<CreditDetails summary={SUMMARY} />);
    expect(h).toContain('href="/settings#plan"');
    expect(text(<CreditDetails summary={SUMMARY} />)).toContain("Change plan");
    expect(h).not.toContain("/admin/usage");
    expect(html(<CreditDetails summary={SUMMARY} admin />)).toContain('href="/admin/usage"');
    expect(text(<CreditDetails summary={SUMMARY} admin />)).toContain("Usage & costs");
  });

  it("keeps the usage limits slot empty until there is data", () => {
    expect(html(<UsageLimitsSlot />)).toBe("");
    expect(html(<UsageLimitsSlot limits={[]} />)).toBe("");
    expect(text(<CreditDetails summary={SUMMARY} />)).not.toContain("Usage limits");
    const t = text(<UsageLimitsSlot limits={[{ label: "5-hour limit", usedShare: 42, resetsAt: "2026-11-09T15:00:00Z" }]} />);
    expect(t).toContain("Usage limits");
    expect(t).toContain("5-hour limit 42% used · resets 9 Nov");
  });
});

describe("opening and closing", () => {
  const run = (events: PanelEvent[], from: PanelState = CLOSED) => events.reduce(creditPanelReducer, from);

  it("hover and focus open it; leaving closes it unless it is pinned", () => {
    expect(run(["hover"])).toEqual({ open: true, pinned: false });
    expect(run(["focus"])).toEqual({ open: true, pinned: false });
    expect(run(["hover", "leave"])).toEqual(CLOSED);
    expect(run(["hover", "click", "leave"])).toEqual({ open: true, pinned: true });
  });

  it("a click pins it, a second click closes it", () => {
    expect(run(["click"])).toEqual({ open: true, pinned: true });
    expect(run(["focus", "click"])).toEqual({ open: true, pinned: true });
    expect(run(["click", "click"])).toEqual(CLOSED);
  });

  it("Escape, a click outside, Tab away and another page close it, pinned or not", () => {
    for (const e of ["escape", "outside", "blur", "away"] as PanelEvent[]) {
      expect(run(["click", e])).toEqual(CLOSED);
      expect(run(["hover", e])).toEqual(CLOSED);
    }
    // a closed panel stays the same object (no re-render)
    expect(creditPanelReducer(CLOSED, "escape")).toBe(CLOSED);
  });

  it("morphs out of the pill, or fades with reduced motion", () => {
    expect(panelMotion("in", false)).toEqual({ surface: "credit-liquid-in", content: "credit-content-in" });
    expect(panelMotion("out", false)).toEqual({ surface: "credit-liquid-out", content: "credit-content-out" });
    expect(panelMotion("in", true)).toEqual({ surface: "credit-fade-in", content: "" });
    expect(panelMotion("out", true)).toEqual({ surface: "credit-fade-out", content: "" });
  });
});

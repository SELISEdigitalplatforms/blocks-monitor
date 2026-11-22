// The pricing page as it renders: the four plan cards with price, credit, the person who helps, parallel builds and the
// queue; one focal plan; the actions per signed-in state (sign-up when signed out, checkout when signed in, contact
// sales); the current plan; the loading state; the credit explainer and the questions; "Plans couldn't be loaded" with
// Try again whenever the public catalogue cannot be read (never plans or prices of the page's own); and the words the
// page must never use.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// the open workspace and the session (a zustand store answers its initial state when rendered to a string)
const ws = vi.hoisted(() => ({ current: null as { id: string; name: string } | null }));
const viewer = vi.hoisted(() => ({ status: "restoring" as "restoring" | "signed-out" | "signed-in" }));
vi.mock("../../src/state/workspaces", async (orig) => ({ ...(await orig<typeof import("../../src/state/workspaces")>()), useCurrentWorkspace: () => ws.current }));
vi.mock("../../src/blocks/session", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/session")>()),
  useSession: <T,>(select: (s: { status: string; profile: null; notice: null }) => T) => select({ status: viewer.status, profile: null, notice: null }),
}));
import { billingKeys } from "../../src/components/billing/billingData";
import { PricingSection, PricingView } from "../../src/components/pricing/PricingSection";
import { PlanCards } from "../../src/components/pricing/PricingCards";
import { fetchPublicPlans, plansStaleTime, publicPlansKey, type PricingPlans } from "../../src/components/pricing/pricingData";
import { plansState } from "../../src/components/pricing/PricingSection";
import { buildsLine, consultantsFaq, creditLine, extraFeatures, focalKey, planAction, queueLines } from "../../src/components/pricing/pricingText";
import { NAV_LINKS } from "../../src/components/landing/Nav";
import { publicPlansOf, type PublicPlan } from "../../src/domain/publicPlans";
import { SUMMARY } from "./usageData.test";
import { CATALOGUE } from "./catalogue";

// the stored catalogue as the public route answers it
const PLANS: PublicPlan[] = publicPlansOf(CATALOGUE);
const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (el: ReactElement) => html(el).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const card = (markup: string, key: string) => {
  const start = markup.indexOf(`data-plan="${key}"`);
  const end = markup.indexOf("</article>", start);
  return markup.slice(start, end);
};

afterEach(() => {
  ws.current = null;
  viewer.status = "restoring";
});

describe("the plan cards", () => {
  it("show price per month, credit, the person who helps, parallel builds and the queue", () => {
    const t = text(<PlanCards plans={PLANS} signedIn={false} currentKey={null} />);
    for (const s of [
      "Free", "USD 0 / month", "USD 50 credit when you sign up", "Self-serve, at your own pace", "One build at a time", "Standard queue",
      "Classic", "USD 199 / month", "USD 200 credit every month", "With a tech-lead consultant", "2 builds in parallel",
      "Speed", "USD 399 / month", "USD 400 credit every month", "With a business consultant", "5 builds in parallel", "High priority in the queue",
      "Enterprise", "Custom", "Credit agreed with you", "With a dedicated team", "Parallel builds to your needs", "Highest priority in the queue",
    ]) expect(t).toContain(s);
  });

  it("hold one focal plan, Speed, marked Most popular, with the one accent button", () => {
    const markup = html(<PlanCards plans={PLANS} signedIn={false} currentKey={null} />);
    expect(markup.match(/Most popular/g)).toHaveLength(1);
    expect(markup.match(/data-focal="true"/g)).toHaveLength(1);
    expect(card(markup, "speed")).toContain("Most popular");
    expect(card(markup, "speed")).toContain("bg-accent text-white");
    expect(card(markup, "classic")).not.toContain("bg-accent text-white");
    expect(focalKey(PLANS.filter((p) => p.key !== "speed"))).toBe("classic");
  });

  it("set figures in tabular numbers", () => {
    const markup = html(<PlanCards plans={PLANS} signedIn={false} currentKey={null} />);
    expect(card(markup, "classic")).toMatch(/class="num[^"]*"[^>]*>199</);
    expect(card(markup, "classic")).toMatch(/class="num[^"]*"[^>]*>USD 200 credit every month</);
  });

  it("signed out: Free and the paid plans lead to sign-up with the plan, Enterprise to sign-up as Contact sales", () => {
    const markup = html(<PlanCards plans={PLANS} signedIn={false} currentKey={null} />);
    expect(hrefs(markup)).toEqual(["/sign-up?plan=free", "/sign-up?plan=classic", "/sign-up?plan=speed", "/sign-up?plan=enterprise"]);
    const t = text(<PlanCards plans={PLANS} signedIn={false} currentKey={null} />);
    for (const s of ["Start for free", "Choose Classic", "Choose Speed", "Contact sales"]) expect(t).toContain(s);
  });

  it("signed in: the plans lead to checkout, Enterprise opens the contact form, the current plan to its management", () => {
    const markup = html(<PlanCards plans={PLANS} signedIn currentKey={null} />);
    expect(hrefs(markup)).toEqual(["/billing/checkout?plan=free", "/billing/checkout?plan=classic", "/billing/checkout?plan=speed"]);
    expect(card(markup, "enterprise")).toContain('aria-haspopup="dialog"');
    expect(card(markup, "enterprise")).toContain("Contact sales");

    const onClassic = html(<PlanCards plans={PLANS} signedIn currentKey="classic" />);
    expect(hrefs(onClassic)).toEqual(["/billing/checkout?plan=free", "/billing", "/billing/checkout?plan=speed"]);
    expect(card(onClassic, "classic")).toContain("Your plan");
    expect(card(onClassic, "classic")).toContain("Manage your plan");
    // a current plan is never shown to a visitor who is signed out
    expect(planAction(PLANS[1], { signedIn: false, currentKey: "classic" })).toEqual({ kind: "link", to: "/sign-up?plan=classic", label: "Choose Classic" });
  });

  it("follow the catalogue: a changed price, a hidden plan, a plan key that needs escaping", () => {
    const plans = [{ ...PLANS[0] }, { ...PLANS[1], priceUsd: 249, creditUsd: 250 }, { ...PLANS[3] }];
    const t = text(<PlanCards plans={plans} signedIn={false} currentKey={null} />);
    expect(t).toContain("USD 249 / month");
    expect(t).toContain("USD 250 credit every month");
    expect(t).not.toContain("Speed");
    expect(planAction({ key: "a b&c", name: "X", priceUsd: 10, contactSales: false }, { signedIn: true }).kind === "link"
      && (planAction({ key: "a b&c", name: "X", priceUsd: 10, contactSales: false }, { signedIn: true }) as { to: string }).to).toBe("/billing/checkout?plan=a%20b%26c");
  });

  it("never repeat a fact: a feature line on credit, help, builds or the queue is not listed again", () => {
    for (const p of PLANS) expect(extraFeatures(p)).toEqual([]);
    expect(extraFeatures({ features: ["Weekly check-in", "200 USD credit every month", "Your work goes first in the queue"] })).toEqual(["Weekly check-in"]);
    expect(text(<PlanCards plans={[{ ...PLANS[1], features: ["Weekly check-in"] }]} signedIn={false} currentKey={null} />)).toContain("Weekly check-in");
  });

  it("say the queue by rank and the builds and credit in plain words", () => {
    const q = queueLines(PLANS);
    expect([...q.values()]).toEqual(["Standard queue", "Raised priority in the queue", "High priority in the queue", "Highest priority in the queue"]);
    expect([...queueLines([{ key: "a", priority: 1 }, { key: "b", priority: 1 }]).values()]).toEqual(["Standard queue", "Standard queue"]);
    expect(buildsLine(1)).toBe("One build at a time");
    expect(creditLine({ creditUsd: 1250.5, priceUsd: 999, contactSales: false })).toBe("USD 1,250.50 credit every month");
  });
});

describe("the pricing section", () => {
  it("is the landing page's Pricing chapter, in the top bar too", () => {
    const markup = html(<PricingView plans={PLANS} ready source="live" signedIn={false} currentKey={null} />);
    expect(markup).toContain('id="pricing"');
    expect(markup).toMatch(/<h2 id="pricing-title"/);
    expect(NAV_LINKS.map((l) => l.id)).toContain("pricing");
    expect(NAV_LINKS.find((l) => l.id === "pricing")?.label).toBe("Pricing");
  });

  it("is an h1 on /pricing, with the plan names one level below", () => {
    const markup = html(<PricingView plans={PLANS} ready source="live" signedIn={false} currentKey={null} level={1} />);
    expect(markup).toMatch(/<h1 id="pricing-title"/);
    expect(markup).toMatch(/<h2 id="plan-speed-name"/);
  });

  it("explains credit and answers the questions people ask", () => {
    const t = text(<PricingView plans={PLANS} ready source="live" signedIn={false} currentKey={null} />);
    for (const s of [
      "How credit works", "The engine measures each piece of work the agents do, in tokens",
      "What counts as usage?", "What happens when my credit runs out?", "Can I change my plan?", "How do I pay?",
      "Today with a code", "Card payments are being connected",
      "Are the consultants real people?", "On Classic a tech-lead consultant and on Speed a business consultant work with you alongside the agents. Enterprise brings a dedicated team.",
    ]) expect(t).toContain(s);
  });

  it("holds the cards' places while the plans load (no figures yet)", () => {
    const markup = html(<PricingView plans={[]} ready={false} source="unavailable" signedIn={false} currentKey={null} />);
    expect(markup).toContain('data-plans-source="loading"');
    expect(markup).toContain("Loading the plans");
    expect(markup).not.toContain("USD 199");
    expect(markup).not.toContain("data-primary-cta");
  });

  it("uses plain words: no AI, magic or sparkle wording, no long dashes", () => {
    const t = text(<PricingView plans={PLANS} ready source="live" signedIn currentKey="free" />);
    expect(t).not.toMatch(/\bAI\b|artificial intelligence|magic|sparkle|—/i);
    expect(html(<PricingView plans={PLANS} ready source="live" signedIn={false} currentKey={null} />)).not.toMatch(/sparkle|wand/i);
  });

  it("wires the viewer: signed out it links to sign-up; signed in to checkout, with the open organization's plan", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(publicPlansKey, { plans: PLANS, source: "live" });
    const render = () => html(<QueryClientProvider client={client}><PricingSection /></QueryClientProvider>);
    viewer.status = "signed-out";
    expect(hrefs(render())).toContain("/sign-up?plan=speed");
    viewer.status = "signed-in";
    ws.current = { id: "ws-1", name: "Northwind" };
    client.setQueryData(billingKeys.summary("ws-1"), SUMMARY);
    const signedIn = render();
    expect(hrefs(signedIn)).toContain("/billing/checkout?plan=speed");
    expect(card(signedIn, "free")).toContain("Your plan");
  });
});

describe("the plans' source", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;

  it("reads GET /api/public/plans without credentials", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, data: { plans: [{ ...PLANS[1], priceUsd: 249 }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchPublicPlans(fetcher);
    expect(seen!.url).toBe("/api/public/plans");
    expect(seen!.init?.credentials).toBe("omit");
    expect(r.source).toBe("live");
    expect(r.plans.map((p) => [p.key, p.priceUsd])).toEqual([["classic", 249]]);
  });

  it("answers no plans of its own when the catalogue cannot be read", async () => {
    for (const fetcher of [
      reply(503, { ok: false, error: { code: "unavailable" } }),
      reply(429, { ok: false }),
      reply(200, "<!doctype html><html></html>"),
      reply(200, { ok: true, data: { plans: [{ key: "x" }] } }),
      reply(200, { ok: false, error: { code: "unavailable" } }),
      (async () => { throw new TypeError("offline"); }) as typeof fetch,
    ]) {
      expect(await fetchPublicPlans(fetcher)).toEqual({ plans: [], source: "unavailable" });
    }
    // a catalogue that lists no plan is the catalogue's answer, not a failure
    expect(await fetchPublicPlans(reply(200, { ok: true, data: { plans: [] } }))).toEqual({ plans: [], source: "live" });
  });

  it("says the plans couldn't be loaded and offers Try again: no cards, no prices, no price note", () => {
    const markup = html(<PricingView plans={[]} ready source="unavailable" signedIn={false} currentKey={null} onRetry={() => undefined} />);
    expect(markup).toContain('data-plans-source="unavailable"');
    const t = text(<PricingView plans={[]} ready source="unavailable" signedIn={false} currentKey={null} onRetry={() => undefined} />);
    expect(t).toContain("Plans couldn't be loaded");
    expect(t).toContain("We couldn't read the plans and their prices just now. Try again in a moment.");
    expect(t).toContain("Try again");
    expect(markup).not.toMatch(/<article|USD|data-primary-cta|data-plan=|id="plan-/);
    expect(t).not.toMatch(/Classic|Speed|Most popular|\/ month|Prices in US dollars/);
    // the questions stay; the one about consultants only when a listed plan brings one
    expect(t).toContain("What counts as usage?");
    expect(t).not.toContain("Are the consultants real people?");
    expect(consultantsFaq([])).toBeNull();
    // while it reads again the button says so and waits
    const busy = html(<PricingView plans={[]} ready source="unavailable" signedIn={false} currentKey={null} onRetry={() => undefined} retrying />);
    expect(busy).toContain("Trying again…");
    expect(busy).toMatch(/<button[^>]*disabled/);
  });

  it("says when the catalogue lists no plan", () => {
    const markup = html(<PricingView plans={[]} ready source="live" signedIn={false} currentKey={null} onRetry={() => undefined} />);
    expect(markup).toContain('data-plans-source="empty"');
    expect(markup).toContain("No plans are offered right now");
    expect(markup).not.toMatch(/<article|USD/);
  });

  it("tells the four states apart", () => {
    expect(plansState({ ready: false, source: "unavailable", count: 0 })).toBe("loading");
    expect(plansState({ ready: true, source: "unavailable", count: 0 })).toBe("unavailable");
    expect(plansState({ ready: true, source: "live", count: 0 })).toBe("empty");
    expect(plansState({ ready: true, source: "live", count: 4 })).toBe("live");
  });

  it("keeps the catalogue for the calm pace and reads again at once after a failed read", async () => {
    expect(plansStaleTime({ plans: PLANS, source: "live" })).toBe(5 * 60_000);
    expect(plansStaleTime({ plans: [], source: "unavailable" })).toBe(0);
    expect(plansStaleTime(undefined)).toBe(0);
    // through the query cache: a failed answer is read again the next time the plans are asked for, a live one is not
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let reads = 0;
    let next: PricingPlans = { plans: [], source: "unavailable" };
    const ask = () => client.fetchQuery({ queryKey: publicPlansKey, queryFn: async () => { reads += 1; return next; }, staleTime: (q) => plansStaleTime(q.state.data as PricingPlans | undefined) });
    await ask();
    next = { plans: PLANS, source: "live" };
    expect((await ask()).source).toBe("live");
    expect(reads).toBe(2);
    await ask();
    expect(reads).toBe(2);
  });

  it("wires Try again on the section: the plans are read again", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(publicPlansKey, { plans: [], source: "unavailable" });
    viewer.status = "signed-out";
    const markup = html(<QueryClientProvider client={client}><PricingSection /></QueryClientProvider>);
    expect(markup).toContain('data-plans-source="unavailable"');
    expect(markup).toContain("Try again");
  });
});

// The welcome after a new account's first sign-in (?welcome=1): the plan and the credit it names come from the
// organization's billing summary (the credit pill's query), never a fixed "Free plan, with sign-up credit"; nothing
// plan-specific is said before the summary is known; English and German (Switzerland).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: null as { id: string; name: string } | null }));
vi.mock("../../src/state/workspaces", async (orig) => ({ ...(await orig<typeof import("../../src/state/workspaces")>()), useCurrentWorkspace: () => ws.current }));
vi.mock("../../src/blocks/session", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/session")>()),
  useSession: <T,>(select: (s: { status: string; profile: { firstName: string } | null; notice: null }) => T) =>
    select({ status: "signed-in", profile: { firstName: "Ada" }, notice: null }),
}));
import { WelcomeBanner } from "../../src/components/signin/WelcomeBanner";
import { welcomePlanLine, welcomeText } from "../../src/components/signin/welcomeText";
import { billingKeys } from "../../src/components/billing/billingData";
import type { BillingSummary } from "../../src/components/billing/types";
import { resetI18nForTests, setCulture } from "../../src/i18n";

const summary = (o: Partial<BillingSummary> = {}): BillingSummary => ({
  plan: { key: "classic", name: "Classic", assisted: "tech-lead", maxParallelStreams: 2 },
  balanceUsd: 200, grantedUsd: 200, consumedUsd: 0, tokens: 0, perProject: [], activeAgents: 0, runningJobs: 0,
  monthUsedUsd: 0, monthTokens: 0, renewsAt: null, pendingRequests: [],
  ...o,
});

const START = "Describe what you want built and the team takes it from there.";

afterEach(() => {
  ws.current = null;
  resetI18nForTests();
});

describe("the welcome's plan and credit line", () => {
  it("says nothing plan-specific before the summary is known", () => {
    expect(welcomePlanLine(undefined)).toBeNull();
    expect(welcomePlanLine(null)).toBeNull();
    expect(welcomeText(undefined)).toBe(START);
  });

  it("names the organization's own plan and the credit it has left", () => {
    expect(welcomeText(summary())).toBe(`Your organization is ready on the Classic plan, with USD 200.00 of credit to start. ${START}`);
    expect(welcomePlanLine(summary({ plan: { key: "free", name: "Free", assisted: "none", maxParallelStreams: 1 }, balanceUsd: 37.6, grantedUsd: 50 })))
      .toBe("Your organization is ready on the Free plan, with USD 37.60 of credit to start.");
    // a plan named "... plan" is not doubled
    expect(welcomePlanLine(summary({ plan: { key: "team", name: "Team plan", assisted: "none", maxParallelStreams: 1 } })))
      .toBe("Your organization is ready on the Team plan, with USD 200.00 of credit to start.");
  });

  it("never claims credit that is not there, or a plan the summary does not name", () => {
    expect(welcomePlanLine(summary({ balanceUsd: 0, grantedUsd: 0 }))).toBe("Your organization is on the Classic plan and has no credit yet.");
    expect(welcomePlanLine(summary({ balanceUsd: -3 }))).toBe("Your organization is on the Classic plan and has no credit yet.");
    expect(welcomePlanLine(summary({ plan: null, balanceUsd: 50 }))).toBe("Your organization has USD 50.00 of credit to start.");
    expect(welcomePlanLine(summary({ plan: null, balanceUsd: 0 }))).toBeNull();
    for (const s of [summary(), summary({ plan: null }), summary({ balanceUsd: 0 })]) expect(welcomeText(s)).not.toMatch(/Free plan|sign-up credit/);
  });

  it("speaks German (Switzerland)", () => {
    setCulture("de-CH");
    expect(welcomePlanLine(summary())).toBe("Ihre Organisation ist mit dem Plan Classic bereit, mit USD 200.00 Guthaben zum Start.");
    expect(welcomePlanLine(summary({ balanceUsd: 0, grantedUsd: 0 }))).toBe("Ihre Organisation hat den Plan Classic, aber noch kein Guthaben.");
    expect(welcomePlanLine(summary({ plan: null, balanceUsd: 50 }))).toBe("Ihre Organisation hat USD 50.00 Guthaben zum Start.");
    expect(welcomeText(undefined)).toBe("Beschreiben Sie, was Sie bauen möchten – das Team übernimmt von dort.");
  });
});

describe("the welcome banner", () => {
  const render = (client: QueryClient, path = "/dashboard?welcome=1") =>
    renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><WelcomeBanner /></MemoryRouter></QueryClientProvider>)
      .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

  it("reads the open organization's summary (the credit pill's query) and words itself from it", () => {
    ws.current = { id: "ws-1", name: "Northwind" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(billingKeys.summary("ws-1"), summary({ plan: { key: "speed", name: "Speed", assisted: "business", maxParallelStreams: 5 }, balanceUsd: 400 }));
    const text = render(client);
    expect(text).toContain("Welcome to MADP Factory, Ada.");
    expect(text).toContain(`Your organization is ready on the Speed plan, with USD 400.00 of credit to start. ${START}`);
    expect(text).not.toContain("Free");
  });

  it("before the summary arrives: the welcome without any plan or credit", () => {
    ws.current = { id: "ws-1", name: "Northwind" };
    // nothing in the cache yet (a static render runs no read)
    const text = render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(text).toContain("Welcome to MADP Factory, Ada.");
    expect(text).toContain(START);
    expect(text).not.toMatch(/plan|credit|USD/i);
  });

  it("shows only after a first sign-in", () => {
    ws.current = { id: "ws-1", name: "Northwind" };
    expect(render(new QueryClient(), "/dashboard")).toBe("");
  });
});

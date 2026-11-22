// Platform management → Overview as the super admin sees it: three figures, what needs attention and the latest changes;
// with nothing readable from the billing and engine functions it shows plain empty states, never an error.
//   npx vitest run --config test/platform/vitest.config.ts test/platform/overviewSection.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSession } from "../../src/blocks/session";
import { meKeys } from "../../src/blocks/workspaces/queries";
import { monthStart } from "../../src/components/platform/overviewData";
import OverviewSection from "../../src/components/platform/sections/OverviewSection";

const UID = "super-1";
const NOW = new Date().toISOString();

function seed(client: QueryClient, data: { usage: unknown; engine: unknown; ai: unknown; purchases: unknown; orgs: unknown; requests: unknown; audit: unknown }) {
  client.setQueryData(["platform", "overview", "usage", monthStart(new Date())], data.usage);
  client.setQueryData(["platform", "overview", "engine"], data.engine);
  client.setQueryData(["platform", "overview", "ai-accounts"], data.ai);
  client.setQueryData(["platform", "overview", "purchases"], data.purchases);
  client.setQueryData(["platform", "overview", "organizations", UID], data.orgs);
  client.setQueryData(meKeys.admin(UID, "accessRequest.list", { page: 1 }), data.requests);
  client.setQueryData(meKeys.admin(UID, "audit.list", { page: 1, pageSize: 6 }), data.audit);
}

function render(client: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}><MemoryRouter><OverviewSection /></MemoryRouter></QueryClientProvider>,
  );
}

describe("the Platform overview", () => {
  let client: QueryClient;
  // a server render reads a store's initial state, so the signed-in super admin is written into it for these renders
  const initial = useSession.getInitialState() as unknown as Record<string, unknown>;
  const before = { ...initial };
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    Object.assign(initial, { status: "signed-in", profile: { userId: UID, email: "owner@example.org", isSuperAdmin: true, permissions: [], roles: [] } });
  });
  afterEach(() => {
    client.clear();
    Object.assign(initial, before);
  });

  it("shows credit used this month, active organizations and engine load, what needs attention and the latest activity", () => {
    seed(client, {
      usage: { costUsd: 1234.5, tokens: 5_325_798, rows: 3 },
      engine: [{ id: "h1", name: "Engine host 1", lastSeenAt: NOW, cpuPercent: 42.4, runningJobs: 3, activeAgents: 7, queueLength: 0 }],
      ai: [{ label: "Claude account 2", status: "cooling", usage5h: 100, resetsAt: null }, { label: "Claude account 1", status: "active", usage5h: 20, resetsAt: null }],
      purchases: 2,
      orgs: { active: 12, total: 14, counted: 14 },
      requests: { items: [], totalCount: 0, page: 1, pageSize: 50 },
      audit: { entries: [{ id: "a1", at: NOW, actorEmail: "owner@example.org", actorName: "Platform owner", action: "platformRole.assign", targetType: null, targetLabel: "Finance reviewer", workspaceId: null, workspaceName: null, crossWorkspace: false }], totalCount: 1, page: 1, pageSize: 6, hasMore: false, nextPage: null },
    });
    const html = render(client);
    expect(html).toContain(">Credit used this month<");
    expect(html).toContain("USD 1,234.50");
    expect(html).toContain("5.3M tokens");
    expect(html).toContain(">Active organizations<");
    expect(html).toContain(">12<");
    expect(html).toContain("of 14 organizations");
    expect(html).toContain(">Engine load<");
    expect(html).toContain(">42%<");
    expect(html).toContain("3 jobs running · 7 agents working");
    expect(html).toContain("Claude account 2 is resting until its limit resets");
    expect(html).toContain("2 purchase requests wait for your decision");
    expect(html).toContain('href="/admin/credits"');
    expect(html).toContain(">Latest activity<");
    expect(html).toContain("Finance reviewer");
    expect(html).toContain('href="/admin/audit"');
    expect(html).not.toMatch(/error|failed|went wrong/i);
  });

  it("says plainly that nothing is there yet when the billing and engine functions answer nothing", () => {
    seed(client, {
      usage: null, engine: null, ai: null, purchases: null,
      orgs: { active: 0, total: 0, counted: 0 },
      requests: { items: [], totalCount: 0, page: 1, pageSize: 50 },
      audit: { entries: [], totalCount: 0, page: 1, pageSize: 6, hasMore: false, nextPage: null },
    });
    const html = render(client);
    expect(html).toContain("No usage measured this month yet.");
    expect(html).toContain("No engine host is reporting yet.");
    expect(html).toContain(">0<");
    expect(html).toContain("of 0 organizations");
    expect(html).toContain("Nothing waits for you right now.");
    expect(html).toContain("No activity yet");
    expect(html).not.toMatch(/error|failed|went wrong/i);
  });
});

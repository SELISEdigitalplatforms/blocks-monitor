import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  details: {
    data: {
      statusDuration: "2h",
      dateRangeSummary: [
        { type: "range", range: "7d", totalDurationMs: 3600000, incidentCount: 1 },
        { type: "range", range: "30d", totalDurationMs: 0, incidentCount: 0 },
        { type: "range", range: "90d", totalDurationMs: 7200000, incidentCount: 2 },
      ],
      monitorIncidents: [] as unknown[],
    },
    isLoading: false,
    // When the query last fetched: the page works the uptime figures out as of then.
    dataUpdatedAt: Date.now(),
  },
  monitor: {
    data: {
      data: {
        name: "API monitor",
        currentStatus: true,
        monitorConfigurationType: 0,
        // What the API returns (#256 Q10). The legacy `monitorSourceTypes` is never sent.
        effectiveMonitorSourceType: 1 as number | undefined,
        monitorSourceType: 1 as number | undefined,
        intervalInSeconds: 30,
        gracePeriodInSeconds: 60,
        timeoutInSeconds: 45,
        isActive: true,
        url: "https://example.com",
        emails: [],
        repoName: "repo",
        repoId: "r1",
        lastIncidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        createdDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    },
    isLoading: false,
  },
  downtime: { data: { data: [] as unknown[] }, isLoading: false, dataUpdatedAt: Date.now() },
  // The options each query hook was last called with.
  hookOptions: {} as Record<string, unknown>,
}));

vi.mock("react-router", async (o) => {
  const actual = await o<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => h.navigate,
    useParams: () => ({ id: "m1" }),
  };
});
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/genesis-os/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@/hooks/use-alerts", () => ({
  useGetMonitorDetails: (_id: string, options?: unknown) => {
    h.hookOptions.details = options;
    return h.details;
  },
  useGetMonitorById: (_id: string, options?: unknown) => {
    h.hookOptions.monitor = options;
    return h.monitor;
  },
  useGetMonitorDownTime: (options: unknown) => {
    h.hookOptions.downtime = options;
    return h.downtime;
  },
}));

// Heavy children are covered by their own suites; stub them so this page test
// stays focused on the page's own branches.
vi.mock("@/components/module/monitor/details/response-time", () => ({
  default: (props: { isActive?: boolean; createdAt?: string | null; now?: number }) => {
    // Capture the prop: an empty stub could not tell whether the page forwards paused state,
    // so the C1 assertion below would have proved nothing.
    lastResponseTimeIsActive = props.isActive;
    lastResponseTimeCreatedAt = props.createdAt;
    lastResponseTimeNow = props.now;
    return <div data-testid="response-time" />;
  },
}));

let lastResponseTimeIsActive: boolean | undefined;
let lastResponseTimeCreatedAt: string | null | undefined;
let lastResponseTimeNow: number | undefined;
type CardProps = { monitorSourceType?: number; alertRecipientsPath: string; emails: string[] };
let lastMonitorCardProps: CardProps | undefined;
vi.mock("@/components/module/monitor/details/monitor-card", () => ({
  default: (props: CardProps) => {
    lastMonitorCardProps = props;
    return <div data-testid="monitor-card" />;
  },
}));
vi.mock("@/components/module/incident/incident-list", () => ({
  default: (props: { data: unknown[] }) => {
    // Capture the actual data, not just its length: a count-only assertion would pass even
    // if every incident had been replaced with a different object.
    lastIncidentListData = props.data;
    return <div data-testid="incident-list" data-count={props.data.length} />;
  },
}));

let lastIncidentListData: unknown[] = [];
vi.mock("@/components/module/alert/alert-action", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-action">{children}</div>
  ),
}));
vi.mock("@/components/module/monitor/modal/monitor-modal", () => ({
  MonitorModal: (props: { open: boolean; children: React.ReactNode }) => (
    <div data-testid="monitor-modal" data-open={String(props.open)}>
      {props.children}
    </div>
  ),
}));
vi.mock("@/components/module/monitor/form/edit-monitor-form", () => ({
  EditSingleMonitorForm: () => <div data-testid="edit-form" />,
}));
vi.mock("@/components/module/monitor/details/monitor-details-skeletons", () => ({
  MonitorCardSkeleton: () => <div data-testid="skeleton-card" />,
  LoadingListSkelton: () => <div data-testid="skeleton-list" />,
  ResponseSkeletonLoader: () => <div data-testid="skeleton-response" />,
}));

import MonitorDetailsPage, { formatDuration } from "@/pages/monitor/details";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/app/m1/monitor/m1"]}>
      <Routes>
        <Route path="/app/:itemId/monitor/:id" element={<MonitorDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("formatDuration", () => {
  it("formats days, hours, minutes and seconds", () => {
    const S = 1000;
    const M = 60 * S;
    const H = 60 * M;
    const D = 24 * H;
    expect(formatDuration(2 * D + 3 * H)).toBe("2d 3h");
    expect(formatDuration(2 * D)).toBe("2d");
    expect(formatDuration(3 * H + 4 * M)).toBe("3h 4m");
    expect(formatDuration(3 * H)).toBe("3h");
    expect(formatDuration(4 * M + 5 * S)).toBe("4m 5s");
    expect(formatDuration(4 * M)).toBe("4m");
    expect(formatDuration(45 * S)).toBe("45s");
  });
});

describe("MonitorDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.details.isLoading = false;
    h.monitor.isLoading = false;
    h.downtime.isLoading = false;
    h.details.data.monitorIncidents = [];
    h.monitor.data.data.effectiveMonitorSourceType = 1;
    h.monitor.data.data.monitorSourceType = 1;
    h.monitor.data.data.currentStatus = true;
    lastMonitorCardProps = undefined;
    // Reset isActive too, or a paused / field-deleted fixture leaks into later tests and
    // makes the active-state assertions order-dependent.
    h.monitor.data.data.isActive = true;
    lastIncidentListData = [];
  });

  it("renders the skeleton while any query is loading", () => {
    h.monitor.isLoading = true;
    renderPage();
    expect(screen.getByTestId("skeleton-card")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-response")).toBeInTheDocument();
  });

  it("renders the monitor name, action buttons and summary cards", () => {
    renderPage();
    expect(screen.getByText("API monitor")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    // Status card
    expect(screen.getByText("Current Status")).toBeInTheDocument();
    expect(screen.getByText(/Currently up for/)).toBeInTheDocument();
    // Range card renders an uptime percentage and incident count.
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByTestId("response-time")).toBeInTheDocument();
    expect(screen.getByTestId("incident-list")).toBeInTheDocument();
  });

  it("marks the status card as down when currentStatus is false", () => {
    h.monitor.data.data.currentStatus = false;
    renderPage();
    expect(screen.getByText(/Currently down for/)).toBeInTheDocument();
  });

  it("hides the header actions for a Blocks services monitor (effective source type 2)", () => {
    h.monitor.data.data.effectiveMonitorSourceType = 2;
    renderPage();
    expect(screen.queryByText("Configure")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("falls back to monitorSourceType when the effective type is missing (Q10)", () => {
    h.monitor.data.data.effectiveMonitorSourceType = undefined;
    h.monitor.data.data.monitorSourceType = 2;
    renderPage();
    expect(screen.queryByText("Configure")).not.toBeInTheDocument();
    expect(lastMonitorCardProps?.monitorSourceType).toBe(2);
  });

  it("prefers effectiveMonitorSourceType over monitorSourceType (Q10)", () => {
    h.monitor.data.data.effectiveMonitorSourceType = 0;
    h.monitor.data.data.monitorSourceType = 1;
    renderPage();
    expect(lastMonitorCardProps?.monitorSourceType).toBe(0);
  });

  it("passes the read-only recipients and the scoped Alert recipients link to the card (H12)", () => {
    h.monitor.data.data.emails = ["ops@x.com"] as never;
    renderPage();
    expect(lastMonitorCardProps).toMatchObject({
      emails: ["ops@x.com"],
      monitorSourceType: 1,
      alertRecipientsPath: "/scoped/alert-recipients",
    });
    h.monitor.data.data.emails = [];
  });

  it("navigates back when the back button is clicked", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });

  it("has no Notification Settings control but keeps Configure and the actions menu (H12, Q9)", async () => {
    renderPage();
    expect(screen.queryByText("Notification Settings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("Configure"));
    expect(screen.getByTestId("monitor-modal")).toHaveAttribute("data-open", "true");
  });

  it("shows 'View all incidents' and navigates when there are more than four", async () => {
    h.details.data.monitorIncidents = Array.from({ length: 5 }, (_, i) => ({
      itemId: `i${i}`,
    }));
    renderPage();
    const viewAll = screen.getByText("View all incidents");
    await userEvent.click(viewAll);
    expect(h.navigate).toHaveBeenCalledWith("/scoped/monitor/incidents/m1");
  });
});

// Paused/active state on the Current Status card (issue #197)
describe("MonitorDetailsPage paused state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.details.isLoading = false;
    h.monitor.isLoading = false;
    h.downtime.isLoading = false;
    h.details.data.monitorIncidents = [];
    h.monitor.data.data.effectiveMonitorSourceType = 1;
    h.monitor.data.data.monitorSourceType = 1;
    h.monitor.data.data.currentStatus = true;
    h.monitor.data.data.isActive = true;
    lastIncidentListData = [];
    lastResponseTimeIsActive = undefined;
  });

  const statusCard = () => screen.getByText("Current Status").closest("div")!;

  it("shows a Paused badge on the Current Status card when isActive is false", () => {
    // H3
    h.monitor.data.data.isActive = false;
    renderPage();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("drops every health signal from the card while paused", () => {
    // C1. Asserting only that the "Currently up for ..." line disappears would still pass an
    // implementation that showed "Paused" next to the up/down word in green.
    h.monitor.data.data.isActive = false;
    h.monitor.data.data.currentStatus = true;
    const { container } = renderPage();

    expect(screen.queryByText(/Currently (up|down) for/)).toBeNull();
    const card = statusCard();
    expect(card.textContent).not.toMatch(/\b(up|down)\b/i);
    expect(container.querySelector(".text-green-500")).toBeNull();
    expect(container.querySelector(".border-l-green-500")).toBeNull();
    expect(container.querySelector(".border-l-red-500")).toBeNull();
    expect(container.querySelector(".border-l-muted")).toBeTruthy();
  });

  it("shows Paused for a monitor whose last known status was down", () => {
    // Same reasoning as the table: without this, a branch keyed on the stale status would pass.
    h.monitor.data.data.isActive = false;
    h.monitor.data.data.currentStatus = false;
    renderPage();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText(/Currently (up|down) for/)).toBeNull();
  });

  it("keeps the existing up/down status when isActive is true", () => {
    // H4
    renderPage();
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByText(/Currently up for/)).toBeInTheDocument();
  });

  it("treats a missing isActive as active", () => {
    // C4. `?? true` at the call site, not the `?? false` used for the action menu.
    delete (h.monitor.data.data as { isActive?: boolean }).isActive;
    renderPage();
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByText(/Currently up for/)).toBeInTheDocument();
  });

  it("leaves incident history untouched while paused", () => {
    // C2. Compares the forwarded data itself, since a count-only check would pass even if
    // every incident had been swapped for a different object.
    const incidents = [{ itemId: "i1" }, { itemId: "i2" }];
    h.details.data.monitorIncidents = incidents;
    h.monitor.data.data.isActive = false;
    renderPage();

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(lastIncidentListData).toEqual(incidents);
  });

  it("tells the Status Overview chart the monitor is paused", () => {
    // C1. ResponseTime plots a current up/down point at "now"; without this the page would
    // show "Paused" and a live Down reading at the same time.
    h.monitor.data.data.isActive = false;
    renderPage();
    expect(screen.getByTestId("response-time")).toBeInTheDocument();
    expect(lastResponseTimeIsActive).toBe(false);
  });

  it("tells the chart the monitor is active when it is", () => {
    renderPage();
    expect(lastResponseTimeIsActive).toBe(true);
  });

  it("tells the chart to treat a missing isActive as active", () => {
    // C4 reaches the chart too, not just the badge.
    delete (h.monitor.data.data as { isActive?: boolean }).isActive;
    renderPage();
    expect(lastResponseTimeIsActive).toBe(true);
  });

  it("follows refetched data when the monitor flips between paused and active", () => {
    // H5 at the render level.
    const { rerender } = renderPage();
    expect(screen.getByText(/Currently up for/)).toBeInTheDocument();

    const again = () =>
      rerender(
        <MemoryRouter initialEntries={["/app/m1/monitor/m1"]}>
          <Routes>
            <Route path="/app/:itemId/monitor/:id" element={<MonitorDetailsPage />} />
          </Routes>
        </MemoryRouter>
      );

    h.monitor.data.data.isActive = false;
    again();
    expect(screen.getByText("Paused")).toBeInTheDocument();

    // And back again -- without the return leg a sticky paused state would pass every other
    // assertion here while leaving the page Paused after a Resume.
    h.monitor.data.data.isActive = true;
    again();
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByText(/Currently up for/)).toBeInTheDocument();
  });
});

// How long the monitor has been up or down, and uptime over the time it has existed.
describe("MonitorDetailsPage status timing", () => {
  const NOW = Date.UTC(2026, 9, 22, 11, 25, 23);
  const S = 1000;
  const M = 60 * S;
  const D = 24 * 60 * M;
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  // The fixture is shared with the suites above, so put back what these tests change.
  const original = {
    lastIncidentAt: h.monitor.data.data.lastIncidentAt,
    createdDate: h.monitor.data.data.createdDate,
    dateRangeSummary: h.details.data.dateRangeSummary,
    detailsUpdatedAt: h.details.dataUpdatedAt,
    downtimeUpdatedAt: h.downtime.dataUpdatedAt,
  };
  const monitor = h.monitor.data.data as { lastIncidentAt: string | null; createdDate: string };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    h.details.isLoading = false;
    h.monitor.isLoading = false;
    h.downtime.isLoading = false;
    h.monitor.data.data.isActive = true;
    h.monitor.data.data.currentStatus = true;
    // Both polls landed just now.
    h.details.dataUpdatedAt = NOW;
    h.downtime.dataUpdatedAt = NOW;
  });

  afterEach(() => {
    vi.useRealTimers();
    h.monitor.data.data.lastIncidentAt = original.lastIncidentAt;
    h.monitor.data.data.createdDate = original.createdDate;
    h.details.data.dateRangeSummary = original.dateRangeSummary;
    h.details.dataUpdatedAt = original.detailsUpdatedAt;
    h.downtime.dataUpdatedAt = original.downtimeUpdatedAt;
  });

  const rerenderPage = (rerender: (ui: React.ReactElement) => void) =>
    rerender(
      <MemoryRouter initialEntries={["/app/m1/monitor/m1"]}>
        <Routes>
          <Route path="/app/:itemId/monitor/:id" element={<MonitorDetailsPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("polls the status, the uptime figures and the chart every 10 seconds", () => {
    renderPage();

    expect(h.hookOptions.monitor).toEqual({ refetchInterval: 10_000 });
    expect(h.hookOptions.details).toEqual({ refetchInterval: 10_000 });
    expect(h.hookOptions.downtime).toMatchObject({ refetchInterval: 10_000 });
  });

  it("keeps the uptime cards still between polls and updates them on the next one", () => {
    // Created 10 minutes ago and down for the last 3, still down.
    monitor.createdDate = ago(10 * M);
    monitor.lastIncidentAt = ago(3 * M);
    h.monitor.data.data.currentStatus = false;
    h.details.data.dateRangeSummary = [
      { type: "range", range: "7d", totalDurationMs: 3 * M, incidentCount: 1 },
    ];
    const { rerender } = renderPage();
    expect(screen.getByText("70.00%")).toBeInTheDocument();

    // Between polls only the live counter moves. The cards used to recompute against the ticking
    // clock while the downtime stayed as fetched, so an outage read as uptime going up.
    act(() => {
      vi.advanceTimersByTime(5 * S);
    });
    expect(screen.getByText("Currently down for 3m 5s")).toBeInTheDocument();
    expect(screen.getByText("70.00%")).toBeInTheDocument();

    // The next poll, 10s after the last, brings 10s more downtime: 190s down in 610s.
    act(() => {
      vi.advanceTimersByTime(5 * S);
    });
    h.details.dataUpdatedAt = NOW + 10 * S;
    h.details.data.dateRangeSummary = [
      { type: "range", range: "7d", totalDurationMs: 3 * M + 10 * S, incidentCount: 1 },
    ];
    rerenderPage(rerender);

    expect(screen.getByText("68.85%")).toBeInTheDocument();
  });

  it("anchors the chart at the downtime poll", () => {
    h.downtime.dataUpdatedAt = NOW - 4 * S;
    renderPage();
    expect(lastResponseTimeNow).toBe(NOW - 4 * S);
  });

  it.each([
    // Created, never had an incident: up since creation. lastIncidentAt is null, which used to
    // read as "now" and show 0s (and a negative value after the first refresh).
    { name: "new monitor", status: true, lastIncidentAt: null, expected: "Currently up for 10m" },
    // Down: since the incident started.
    { name: "incident open", status: false, lastIncidentAt: ago(2 * M), expected: "Currently down for 2m" },
    // Recovered: the server moves lastIncidentAt to the recovery, so only the time since then.
    { name: "recovered", status: true, lastIncidentAt: ago(10 * S), expected: "Currently up for 10s" },
  ])("$name: $expected", ({ status, lastIncidentAt, expected }) => {
    monitor.createdDate = ago(10 * M);
    monitor.lastIncidentAt = lastIncidentAt;
    h.monitor.data.data.currentStatus = status;

    renderPage();

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("treats the DateTime.MinValue sentinel as no incident", () => {
    monitor.createdDate = ago(3 * M);
    monitor.lastIncidentAt = "0001-01-01T00:00:00Z";

    renderPage();

    expect(screen.getByText("Currently up for 3m")).toBeInTheDocument();
  });

  it("shows 0s, not NaN, when neither date is usable", () => {
    monitor.createdDate = "not a date";
    monitor.lastIncidentAt = null;

    renderPage();

    expect(screen.getByText("Currently up for 0s")).toBeInTheDocument();
  });

  it("keeps counting while the page is open", () => {
    monitor.createdDate = ago(10 * S);
    monitor.lastIncidentAt = null;
    renderPage();
    expect(screen.getByText("Currently up for 10s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5 * S);
    });

    expect(screen.getByText("Currently up for 15s")).toBeInTheDocument();
  });

  it("measures range uptime only over the time the monitor has existed", () => {
    // Created 10 minutes ago and down for 3 of them: 70%, not 99.97% of a week.
    monitor.createdDate = ago(10 * M);
    h.details.data.dateRangeSummary = [
      { type: "range", range: "7d", totalDurationMs: 3 * M, incidentCount: 1 },
      { type: "range", range: "30d", totalDurationMs: 3 * M, incidentCount: 1 },
      { type: "range", range: "90d", totalDurationMs: 0, incidentCount: 0 },
    ];

    renderPage();

    expect(screen.getAllByText("70.00%")).toHaveLength(2);
    expect(screen.getByText("100.00%")).toBeInTheDocument();
  });

  it("rounds uptime down so any downtime reads below 100%", () => {
    // 2m 57.5s in 90 days is 99.9977%; rounding to nearest showed 100.00% beside "1 incidents".
    monitor.createdDate = ago(400 * D);
    h.details.data.dateRangeSummary = [
      { type: "range", range: "90d", totalDurationMs: 177_500, incidentCount: 1 },
    ];

    renderPage();

    expect(screen.getByText("99.99%")).toBeInTheDocument();
    expect(screen.queryByText("100.00%")).toBeNull();
  });

  it("tells the chart when the monitor was created", () => {
    monitor.createdDate = ago(10 * M);
    renderPage();
    expect(lastResponseTimeCreatedAt).toBe(ago(10 * M));
  });
});

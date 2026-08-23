import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  },
  monitor: {
    data: {
      data: {
        name: "API monitor",
        currentStatus: true,
        monitorConfigurationType: 0,
        monitorSourceTypes: 0,
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
  downtime: { data: { data: [] as unknown[] }, isLoading: false },
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
  useGetMonitorDetails: () => h.details,
  useGetMonitorById: () => h.monitor,
  useGetMonitorDownTime: () => h.downtime,
}));

// Heavy children are covered by their own suites; stub them so this page test
// stays focused on the page's own branches.
vi.mock("@/components/module/monitor/details/response-time", () => ({
  default: (props: { isActive?: boolean }) => {
    // Capture the prop: an empty stub could not tell whether the page forwards paused state,
    // so the C1 assertion below would have proved nothing.
    lastResponseTimeIsActive = props.isActive;
    return <div data-testid="response-time" />;
  },
}));

let lastResponseTimeIsActive: boolean | undefined;
vi.mock("@/components/module/monitor/details/monitor-card", () => ({
  default: () => <div data-testid="monitor-card" />,
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
vi.mock("@/components/module/alert/notification-modal", () => ({
  default: (props: { open: boolean }) => (
    <div data-testid="notification-modal" data-open={String(props.open)} />
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
    h.monitor.data.data.monitorSourceTypes = 0;
    h.monitor.data.data.currentStatus = true;
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
    expect(screen.getByText("Notification Settings")).toBeInTheDocument();
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

  it("hides the action buttons for an external (source type 2) monitor", () => {
    h.monitor.data.data.monitorSourceTypes = 2;
    renderPage();
    expect(screen.queryByText("Notification Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Configure")).not.toBeInTheDocument();
  });

  it("navigates back when the back button is clicked", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });

  it("toggles the notification and configure modals", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Notification Settings"));
    expect(screen.getByTestId("notification-modal")).toHaveAttribute("data-open", "true");
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
    h.monitor.data.data.monitorSourceTypes = 0;
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

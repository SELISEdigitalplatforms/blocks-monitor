import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@seliseblocks/genesis-os", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("react-router", async (o) => {
  const actual = await o<typeof import("react-router")>();
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock("@/components/module/alert/alert-action", () => ({
  default: (props: { monitorSourceType?: number }) => (
    <button data-testid="alert-action" data-src={props.monitorSourceType} />
  ),
}));
vi.mock("@/components/module/alert/progress-bar", () => ({
  default: ({ status }: { status: boolean }) => (
    <div data-testid="progress" data-status={String(status)} />
  ),
}));

import { AlertsList } from "@/components/module/alert/alerts-list";
import type { AlertTree } from "@/models/alerts.model";

const wrapper = (search = "") => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
};

const alert = (over: Partial<AlertTree> = {}): AlertTree =>
  ({
    itemId: "a1",
    name: "My Monitor",
    operationName: "op",
    monitorConfigurationType: 0,
    url: "https://svc.example.com",
    repoName: "repo-1",
    externalServiceName: "",
    lastIncidentAt: new Date("2023-01-01T00:00:00Z"),
    createdDate: "2023-01-01T00:00:00Z",
    currentStatus: true,
    isActive: true,
    incidentSummaries: [],
    monitorSourceType: 1,
    request: { url: "https://req.example.com" },
    ...over,
  }) as unknown as AlertTree;

const sort = { property: "name", isDescending: false };

describe("AlertsList", () => {
  it("renders a loading skeleton", () => {
    render(<AlertsList data={[]} isLoading sortQueryParams={sort} onSortChange={vi.fn()} />, {
      wrapper: wrapper(),
    });
    // While loading, the component swaps the table body for the skeleton and
    // never falls through to the empty state.
    expect(screen.getByTestId("table-loading-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No results.")).toBeNull();
  });

  it("renders an empty state", () => {
    render(
      <AlertsList data={[]} isLoading={false} sortQueryParams={sort} onSortChange={vi.fn()} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("renders monitor rows with type, url, and tagged service", () => {
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("My Monitor")).toBeInTheDocument();
    expect(screen.getByText("HTTP Check")).toBeInTheDocument();
    expect(screen.getByText("https://svc.example.com")).toBeInTheDocument();
    expect(screen.getByText("repo-1")).toBeInTheDocument();
    expect(screen.getByTestId("progress")).toHaveAttribute("data-status", "true");
  });

  it("shows 'Callback' for configuration type 1 and hides actions for BlocksServices", () => {
    render(
      <AlertsList
        data={[alert({ monitorConfigurationType: 1, monitorSourceType: 2 })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-action")).toBeNull();
  });

  it("navigates to the monitor detail when a row is clicked", async () => {
    render(
      <AlertsList
        data={[alert({ itemId: "row-1" })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByText("My Monitor"));
    expect(h.navigate).toHaveBeenCalledWith("/scoped/monitor/row-1");
  });

  it("hides the tagged-service column when the tab is not 'all'", () => {
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper("?tab=services") },
    );
    expect(screen.queryByText("Tagged Service")).toBeNull();
  });

  it("fires onSortChange when a header is clicked", async () => {
    const onSortChange = vi.fn();
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={onSortChange}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByText("URL"));
    expect(onSortChange).toHaveBeenCalled();
  });

  it("falls back to operationName and request.url when primary fields are empty", () => {
    render(
      <AlertsList
        data={[alert({ name: "", url: "", repoName: "", externalServiceName: "ext-svc" })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("op")).toBeInTheDocument();
    expect(screen.getByText("https://req.example.com")).toBeInTheDocument();
    expect(screen.getByText("ext-svc")).toBeInTheDocument();
  });

  it("renders a down arrow when the current status is false", () => {
    const { container } = render(
      <AlertsList
        data={[alert({ currentStatus: false })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(container.querySelector("svg.lucide-arrow-down")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Uptime column (issue #194)
  //
  // The cell used to render `Date.now() - incidentTime` -- an elapsed duration
  // that Intl read as a millisecond epoch, so every row showed a 1970 date.
  //
  // `formatDate` renders in local time, so no fixed instant formats the same in
  // every zone. Expected strings are derived from the expected Date with the
  // same formatter, which keeps each assertion about *which* date the cell
  // picks rather than about the runner's timezone.
  // -------------------------------------------------------------------------

  const expectedUptime = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);

  const renderRows = (rows: AlertTree[]) =>
    render(
      <AlertsList data={rows} isLoading={false} sortQueryParams={sort} onSortChange={vi.fn()} />,
      { wrapper: wrapper() },
    );

  // The model declares lastIncidentAt as a required Date, but the API also sends
  // ISO strings, null, and the DateTime.MinValue sentinel -- which is exactly why
  // the cell normalises them. Cast so the fixtures can express the real shapes.
  const uptimeRow = (over: Record<string, unknown>): AlertTree => alert(over as Partial<AlertTree>);

  it("shows the created date when a monitor has never had an incident", () => {
    // H1
    const created = new Date("2026-01-05T09:00:00Z");
    renderRows([uptimeRow({ lastIncidentAt: null, createdDate: created.toISOString() })]);
    expect(screen.getByText(expectedUptime(created))).toBeInTheDocument();
  });

  it("shows the incident date when a monitor has had one", () => {
    // H2
    const incident = new Date("2026-08-10T09:00:00Z");
    renderRows([uptimeRow({ lastIncidentAt: incident, createdDate: "2025-06-01T09:00:00Z" })]);
    expect(screen.getByText(expectedUptime(incident))).toBeInTheDocument();
  });

  it("shows the incident date when it arrives as an ISO string", () => {
    // H2 -- the API sends a string even though the model declares Date
    const incident = new Date("2026-08-10T09:00:00Z");
    renderRows([
      uptimeRow({
        lastIncidentAt: incident.toISOString(),
        createdDate: "2025-06-01T09:00:00Z",
      }),
    ]);
    expect(screen.getByText(expectedUptime(incident))).toBeInTheDocument();
  });

  it("treats a blank incident string as no incident rather than 1970", () => {
    // new Date("  ") is Invalid Date, so this must fall through to createdDate
    const created = new Date("2026-04-02T09:00:00Z");
    renderRows([uptimeRow({ lastIncidentAt: "  ", createdDate: created.toISOString() })]);
    expect(screen.getByText(expectedUptime(created))).toBeInTheDocument();
    expect(screen.queryByText(/19(69|70|71)/)).toBeNull();
  });

  it("treats the DateTime.MinValue sentinel as no incident", () => {
    // C1 -- and never a year-1 or 1970 date
    const created = new Date("2026-02-01T09:00:00Z");
    renderRows([
      uptimeRow({
        lastIncidentAt: "0001-01-01T00:00:00Z",
        createdDate: created.toISOString(),
      }),
    ]);
    expect(screen.getByText(expectedUptime(created))).toBeInTheDocument();
    expect(screen.queryByText(/19(69|70|71)/)).toBeNull();
    expect(screen.queryByText(/, 0{0,3}1$/)).toBeNull();
  });

  it("treats a MinValue sentinel with a positive UTC offset as no incident", () => {
    // C1 -- 0001-01-01T00:00:00+14:00 lands in UTC year 0, not year 1
    const created = new Date("2026-03-09T09:00:00Z");
    renderRows([
      uptimeRow({
        lastIncidentAt: "0001-01-01T00:00:00+14:00",
        createdDate: created.toISOString(),
      }),
    ]);
    expect(screen.getByText(expectedUptime(created))).toBeInTheDocument();
  });

  it("keeps the incident date even when the monitor was created more recently", () => {
    // C4
    const incident = new Date("2024-04-04T09:00:00Z");
    renderRows([uptimeRow({ lastIncidentAt: incident, createdDate: "2026-05-05T09:00:00Z" })]);
    expect(screen.getByText(expectedUptime(incident))).toBeInTheDocument();
    expect(screen.queryByText(expectedUptime(new Date("2026-05-05T09:00:00Z")))).toBeNull();
  });

  it("computes the uptime date independently for each row", () => {
    // H4
    const a = new Date("2026-01-05T09:00:00Z");
    const b = new Date("2026-08-10T09:00:00Z");
    const c = new Date("2026-02-01T09:00:00Z");
    renderRows([
      uptimeRow({ itemId: "r1", name: "A", lastIncidentAt: null, createdDate: a.toISOString() }),
      uptimeRow({
        itemId: "r2",
        name: "B",
        lastIncidentAt: b,
        createdDate: "2020-01-01T09:00:00Z",
      }),
      uptimeRow({
        itemId: "r3",
        name: "C",
        lastIncidentAt: "0001-01-01T00:00:00Z",
        createdDate: c.toISOString(),
      }),
    ]);
    expect(screen.getByText(expectedUptime(a))).toBeInTheDocument();
    expect(screen.getByText(expectedUptime(b))).toBeInTheDocument();
    expect(screen.getByText(expectedUptime(c))).toBeInTheDocument();
  });

  it("renders a placeholder instead of throwing when no usable date exists", () => {
    // C2 -- lastIncidentAt must also be unusable, or the guard is never reached
    expect(() =>
      renderRows([uptimeRow({ lastIncidentAt: null, createdDate: "not-a-date" })]),
    ).not.toThrow();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/19(69|70|71)/)).toBeNull();
  });

  it("renders a placeholder when createdDate is null rather than falling back to 1970", () => {
    // C2 -- new Date(null) is a valid epoch date, which is exactly the 1970 leak
    renderRows([uptimeRow({ lastIncidentAt: null, createdDate: null })]);
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/19(69|70|71)/)).toBeNull();
  });

  it("renders the same date regardless of the current time", () => {
    // C3, C5 -- the cell must not derive anything from Date.now()
    const incident = new Date("2026-08-10T09:00:00Z");
    const row = uptimeRow({ lastIncidentAt: incident, createdDate: "2025-06-01T09:00:00Z" });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
      const first = renderRows([row]);
      const early = first.container.textContent;
      first.unmount();

      vi.setSystemTime(new Date("2031-12-31T00:00:00Z"));
      const second = renderRows([row]);
      expect(second.container.textContent).toBe(early);
      expect(screen.getByText(expectedUptime(incident))).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the status arrow untouched by the uptime fix", () => {
    // H5
    const created = new Date("2026-01-05T09:00:00Z");
    const { container, unmount } = renderRows([
      uptimeRow({ lastIncidentAt: null, createdDate: created.toISOString(), currentStatus: true }),
    ]);
    expect(container.querySelector("svg.lucide-arrow-up")).toBeTruthy();
    expect(screen.getByText(expectedUptime(created))).toBeInTheDocument();
    unmount();

    const down = renderRows([
      uptimeRow({ lastIncidentAt: null, createdDate: created.toISOString(), currentStatus: false }),
    ]);
    expect(down.container.querySelector("svg.lucide-arrow-down")).toBeTruthy();
  });
});

// Paused/active state in the Status column (issue #197)
describe("AlertsList paused state", () => {
  const renderRow = (over: Partial<AlertTree> = {}) =>
    render(
      <AlertsList
        data={[alert(over)]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() }
    );

  it("shows a Paused badge instead of the progress bar when isActive is false", () => {
    // H1, C1
    renderRow({ isActive: false });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    // The 24-hour bar is a health display; leaving it beside "Paused" would imply a
    // current up/down state, which is what C1 forbids.
    expect(screen.queryByTestId("progress")).toBeNull();
  });

  it("badges a paused monitor whose last known status was down", () => {
    // Every other paused case here uses a stale "up" status, so an implementation that only
    // took the paused branch when the monitor was last seen Up would slip through.
    renderRow({ isActive: false, currentStatus: false });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByTestId("progress")).toBeNull();
  });

  it("keeps the progress bar and shows no badge when isActive is true", () => {
    // H2
    renderRow({ isActive: true, currentStatus: true });
    expect(screen.getByTestId("progress")).toHaveAttribute("data-status", "true");
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("keeps a down monitor's real status on the progress bar", () => {
    // H2 again, from the other side. Without this an implementation that hardcoded
    // status={true} would pass, because the existing down-state test asserts the Uptime
    // arrow rather than the bar's own prop.
    renderRow({ isActive: true, currentStatus: false });
    expect(screen.getByTestId("progress")).toHaveAttribute("data-status", "false");
  });

  it("treats a row with no isActive field as active", () => {
    // C4. The neighbouring AlertAction call resolves the same missing value with `?? false`,
    // so copying that idiom here would badge every incomplete payload as Paused.
    const row = alert();
    delete (row as Partial<AlertTree>).isActive;
    render(
      <AlertsList data={[row]} isLoading={false} sortQueryParams={sort} onSortChange={vi.fn()} />,
      { wrapper: wrapper() }
    );
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByTestId("progress")).toBeInTheDocument();
  });

  it("leaves the Uptime column untouched on a paused row", () => {
    // C2. The ticket puts the Uptime column out of scope, so a paused row keeps both its
    // formatted date and its arrow -- asserted so a later "tidy-up" that hides them fails.
    const created = new Date("2026-01-05T09:00:00Z");
    const { container } = renderRow({
      isActive: false,
      currentStatus: true,
      lastIncidentAt: null as unknown as Date,
      createdDate: created.toISOString(),
    });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-arrow-up")).toBeTruthy();
  });

  it("follows refetched data when a row flips between paused and active", () => {
    // H5 at the render level: no new refetch logic, the cell just reads the new value.
    const { rerender } = renderRow({ isActive: true });
    expect(screen.getByTestId("progress")).toBeInTheDocument();

    rerender(
      <AlertsList
        data={[alert({ isActive: false })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();

    rerender(
      <AlertsList
        data={[alert({ isActive: true })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />
    );
    expect(screen.queryByText("Paused")).toBeNull();
  });
});

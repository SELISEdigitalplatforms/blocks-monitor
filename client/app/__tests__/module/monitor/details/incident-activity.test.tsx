import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IncidentActivity from "@/components/module/monitor/details/incident-activity";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn(), chart: vi.fn() }));
vi.mock("@/hooks/use-monitor-incident-activity", () => ({
  useMonitorIncidentActivity: mocks.query,
}));
vi.mock("@/components/ui/contribution-skyline", () => ({
  default: (props: { onCellClick: (day: { date: string; count: number }) => void }) => {
    mocks.chart(props);
    const { onCellClick } = props;
    return (
      <>
        <button onClick={() => onCellClick({ date: "2026-10-10", count: 45 })}>
          Select downtime day
        </button>
        <button onClick={() => onCellClick({ date: "2026-10-01", count: 0 })}>
          Select quiet day
        </button>
      </>
    );
  },
}));

const loaded = {
  data: {
    unit: "minute",
    days: [
      { date: "2026-10-09", count: 30 },
      { date: "2026-10-10", count: 50 },
    ],
    incidents: [
      {
        itemId: "i1",
        startTime: "2026-10-10T12:00:00.000Z",
        isResolved: false,
        durationMs: 5 * 60_000,
        days: ["2026-10-10"],
      },
      {
        itemId: "i2",
        startTime: "2026-10-09T23:30:00.000Z",
        isResolved: true,
        durationMs: 75 * 60_000,
        days: ["2026-10-09", "2026-10-10"],
      },
    ],
  },
  isPending: false,
  isError: false,
  isFetching: false,
};

describe("IncidentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReturnValue({ ...loaded, refetch: mocks.refetch });
  });

  it("shows a skeleton while the history loads", () => {
    mocks.query.mockReturnValue({ isPending: true, refetch: mocks.refetch });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.getByLabelText("Loading incident activity")).toBeInTheDocument();
    expect(mocks.chart).not.toHaveBeenCalled();
  });

  it("offers a retry when the history can't be loaded", () => {
    mocks.query.mockReturnValue({
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: mocks.refetch,
    });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Incident activity is unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("charts downtime minutes in a downtime palette, flat by default, with the footnote", () => {
    render(<IncidentActivity monitorId="m1" />);
    expect(mocks.query).toHaveBeenCalledWith("m1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mocks.chart.mock.calls[0][0]).toMatchObject({
      data: loaded.data.days,
      unit: "minute of downtime",
      unitPlural: "minutes of downtime",
      defaultView: "2d",
      palette: "ember",
      showStats: true,
    });
    expect(
      screen.getByText("Downtime per day · UTC · Select a day to view its incidents."),
    ).toBeVisible();
  });

  it("lists the selected day's incidents with start time, duration and status", () => {
    render(<IncidentActivity monitorId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "Select downtime day" }));
    const panel = screen.getByRole("region", { name: "Incidents on Oct 10, 2026" });
    expect(within(panel).getByText("2 incidents on Oct 10, 2026")).toBeVisible();
    const [open, carried] = within(panel).getAllByTestId("incident-activity-item");
    expect(open).toHaveTextContent("12:00 PM UTC");
    expect(open).toHaveTextContent("5m");
    expect(within(open).getByText("Unresolved")).toHaveAttribute("data-tone", "down");
    // Carried over midnight from the day before, so its start shows the day it began.
    expect(carried).toHaveTextContent("Oct 9, 11:30 PM UTC");
    expect(carried).toHaveTextContent("1h 15m");
    expect(within(carried).getByText("Resolved")).toHaveAttribute("data-tone", "up");

    fireEvent.click(screen.getByRole("button", { name: "Clear selected day" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("says so when the selected day had no incidents", () => {
    render(<IncidentActivity monitorId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "Select quiet day" }));
    expect(screen.getByText("No incidents on this day.")).toBeVisible();
  });

  it("charts incident counts when downtime can't be derived", () => {
    mocks.query.mockReturnValue({
      ...loaded,
      data: { ...loaded.data, unit: "incident" },
      refetch: mocks.refetch,
    });
    render(<IncidentActivity monitorId="m1" />);
    expect(mocks.chart.mock.calls[0][0]).toMatchObject({ unit: "incident" });
    expect(screen.getByText(/^Incidents per day · UTC/)).toBeVisible();
  });

  it("doesn't claim a full year's total when paging stopped early", () => {
    mocks.query.mockReturnValue({
      ...loaded,
      data: { ...loaded.data, isPartial: true },
      refetch: mocks.refetch,
    });
    render(<IncidentActivity monitorId="m1" />);
    expect(mocks.chart.mock.calls[0][0]).toMatchObject({
      title: "2 recorded incidents",
      showStats: false,
    });
    expect(screen.getByText(/^Available downtime per day · UTC/)).toBeVisible();
  });

  it("keeps cached history visible when a background refresh fails", () => {
    mocks.query.mockReturnValue({ ...loaded, isError: true, refetch: mocks.refetch });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select downtime day" })).toBeVisible();
  });
});

import "@testing-library/jest-dom/vitest";
import type { ReactElement, ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IncidentActivity from "@/components/module/monitor/details/incident-activity";

type Point = { date: string; value: number; count: number; incidents: number };
type DotRenderer = (props: {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: Point;
}) => ReactElement;

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  chart: vi.fn(),
  line: vi.fn(),
  yAxis: vi.fn(),
  xAxis: vi.fn(),
  reference: vi.fn(),
}));
vi.mock("@/hooks/use-monitor-incident-activity", () => ({
  useMonitorIncidentActivity: mocks.query,
}));

// Recharts renders nothing measurable under jsdom (ResponsiveContainer has no layout), so the
// chart is stubbed: the stubs record the props the panel hands to recharts (the plotted series,
// the axes, the line) and render the tooltip content for a hovered day, so the panel's own
// decisions are what's under test.
vi.mock("recharts", async () => {
  const React = await import("react");
  let hovered: Point | undefined;
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: (props: { children: ReactNode; data: Point[] }) => {
      mocks.chart(props);
      hovered = props.data.find((point) => point.date === "2026-10-10");
      return <div data-testid="line-chart">{props.children}</div>;
    },
    Line: (props: unknown) => {
      mocks.line(props);
      return null;
    },
    // Not used by the panel; the kit's chart module, reached through the core barrel, reads it.
    Legend: () => null,
    CartesianGrid: () => null,
    XAxis: (props: { tickFormatter: (day: string) => string }) => {
      mocks.xAxis(props);
      return <div data-testid="x-tick">{props.tickFormatter("2026-10-10")}</div>;
    },
    YAxis: (props: { tickFormatter: (value: number) => string }) => {
      mocks.yAxis(props);
      return null;
    },
    ReferenceLine: (props: unknown) => {
      mocks.reference(props);
      return null;
    },
    Tooltip: ({ content }: { content: ReactElement }) => (
      <div data-testid="tooltip">
        {React.cloneElement(content, {})}
        {hovered && React.cloneElement(content, { active: true, payload: [{ payload: hovered }] })}
      </div>
    ),
  };
});

// Fixed "today" so the plotted window is known: the 30-day default runs Sep 13 – Oct 12, 2026.
const TODAY = "2026-10-12";

const loaded = {
  data: {
    unit: "minute",
    days: [
      { date: "2026-06-01", count: 400 },
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
      {
        itemId: "i0",
        startTime: "2026-06-01T00:00:00.000Z",
        isResolved: true,
        durationMs: 400 * 60_000,
        days: ["2026-06-01"],
      },
    ],
  },
  isPending: false,
  isError: false,
  isFetching: false,
};

const withData = (data: Partial<typeof loaded.data> & Record<string, unknown>) =>
  mocks.query.mockReturnValue({
    ...loaded,
    data: { ...loaded.data, ...data },
    refetch: mocks.refetch,
  });

const lastCall = <T,>(mock: ReturnType<typeof vi.fn>) => mock.mock.lastCall?.[0] as T;
const series = () => lastCall<{ data: Point[] }>(mocks.chart).data;
const yLabel = () => lastCall<{ label: { value: string } }>(mocks.yAxis).label.value;
const select = (day: string) =>
  act(() =>
    lastCall<{ onClick: (state: { activeLabel?: string }) => void }>(mocks.chart).onClick({
      activeLabel: day,
    }),
  );

const chooseRange = async (label: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Incident range" }));
  await userEvent.click(await screen.findByRole("option", { name: label }));
};

describe("IncidentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
    mocks.query.mockReturnValue({ ...loaded, refetch: mocks.refetch });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("plots 30 zero-filled days of downtime minutes by default, with the footnote", () => {
    render(<IncidentActivity monitorId="m1" />);
    expect(mocks.query).toHaveBeenCalledWith("m1", TODAY);
    expect(screen.getByRole("combobox", { name: "Incident range" })).toHaveTextContent(
      "Last 30 days",
    );
    const points = series();
    expect(points).toHaveLength(30);
    expect(points[0].date).toBe("2026-09-13");
    expect(points.at(-1)?.date).toBe(TODAY);
    expect(points.find((point) => point.date === "2026-10-09")).toEqual({
      date: "2026-10-09",
      value: 30,
      count: 30,
      incidents: 1,
    });
    expect(points.find((point) => point.date === "2026-10-10")).toMatchObject({
      value: 50,
      incidents: 2,
    });
    // Quiet days are plotted as 0 so the line is continuous.
    expect(points.filter((point) => point.value === 0)).toHaveLength(28);
    expect(yLabel()).toBe("Downtime (minutes)");
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Downtime (minutes)");
    expect(screen.getByTestId("x-tick")).toHaveTextContent("Oct 10");
    expect(screen.getByText(/in the last 30 days$/)).toHaveTextContent(
      "2 incidents · 1h 20m downtime in the last 30 days",
    );
    expect(
      screen.getByText("Downtime per day · UTC · Select a point to view its incidents."),
    ).toBeVisible();
  });

  it("styles the line from theme tokens and skips animation for reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
    }));
    render(<IncidentActivity monitorId="m1" />);
    expect(lastCall(mocks.line)).toMatchObject({
      stroke: "hsl(var(--rose-ink))",
      strokeWidth: 2,
      isAnimationActive: false,
    });
  });

  it("animates the line when motion is allowed", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    render(<IncidentActivity monitorId="m1" />);
    expect(lastCall(mocks.line)).toMatchObject({ isAnimationActive: true });
  });

  it("re-plots the window when the range changes", async () => {
    render(<IncidentActivity monitorId="m1" />);
    await chooseRange("Last 7 days");
    expect(series()).toHaveLength(7);
    expect(series()[0].date).toBe("2026-10-06");

    await chooseRange("Last 90 days");
    expect(series()).toHaveLength(90);
    expect(series()[0].date).toBe("2026-07-15");
  });

  it("marks every point, thinning to incident days at 90 days", async () => {
    render(<IncidentActivity monitorId="m1" />);
    const dot = () => lastCall<{ dot: DotRenderer }>(mocks.line).dot;
    const quiet = { cx: 1, cy: 2, index: 0, payload: series()[0] };
    const busy = { cx: 1, cy: 2, index: 1, payload: series().at(-3) };
    const { container, rerender } = render(<svg>{dot()(quiet)}</svg>);
    expect(container.querySelector("circle")).toHaveAttribute("r", "4");

    await chooseRange("Last 90 days");
    rerender(<svg>{dot()(quiet)}</svg>);
    expect(container.querySelector("circle")).toBeNull();
    rerender(<svg>{dot()(busy)}</svg>);
    expect(container.querySelector("circle")).toBeInTheDocument();
  });

  it("switches the axis to hours once the busiest day reaches two hours", async () => {
    withData({ days: [{ date: "2026-10-10", count: 150 }] });
    render(<IncidentActivity monitorId="m1" />);
    expect(yLabel()).toBe("Downtime (hours)");
    expect(series().find((point) => point.date === "2026-10-10")?.value).toBe(2.5);

    // The tooltip still reads the day's downtime as a duration.
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip).toHaveTextContent("Oct 10, 2026");
    expect(within(tooltip).getByText("2h 30m")).toHaveClass("font-semibold");
    expect(within(tooltip).getByText("downtime")).toHaveClass("text-muted-foreground");
    expect(tooltip).toHaveTextContent("2 incidents");
  });

  it("shows the hovered day's date, downtime and incident count", () => {
    render(<IncidentActivity monitorId="m1" />);
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip).toHaveTextContent("Oct 10, 2026");
    expect(within(tooltip).getByText("50m")).toHaveClass("font-semibold");
    expect(within(tooltip).getByText("downtime")).toHaveClass("text-muted-foreground");
    expect(tooltip).toHaveTextContent("2 incidents");
  });

  it("plots incidents per day when downtime can't be derived", () => {
    withData({ unit: "incident", days: [{ date: "2026-10-10", count: 2 }] });
    render(<IncidentActivity monitorId="m1" />);
    expect(yLabel()).toBe("Incidents");
    expect(series().find((point) => point.date === "2026-10-10")?.value).toBe(2);
    expect(screen.getByTestId("tooltip")).not.toHaveTextContent("downtime");
    expect(screen.getByText(/^Incidents per day · UTC/)).toBeVisible();
  });

  it("says so when the window has no incidents", async () => {
    withData({ days: [{ date: "2026-06-01", count: 400 }], incidents: [loaded.data.incidents[2]] });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.getByText("No incidents in this period.")).toBeVisible();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Incident range" })).toBeVisible();
  });

  it("lists the selected point's incidents with start time, duration and status", () => {
    render(<IncidentActivity monitorId="m1" />);
    select("2026-10-10");
    expect(lastCall(mocks.reference)).toMatchObject({ x: "2026-10-10" });
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

  it("says so when the selected point had no incidents", () => {
    render(<IncidentActivity monitorId="m1" />);
    select("2026-10-01");
    expect(screen.getByText("No incidents on this day.")).toBeVisible();
  });

  it("clears the selected day when the range changes", async () => {
    render(<IncidentActivity monitorId="m1" />);
    select("2026-10-10");
    await chooseRange("Last 7 days");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("doesn't claim a full total when paging stopped early", () => {
    withData({ isPartial: true });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.getByText(/in the last 30 days$/)).toHaveTextContent(
      "2 recorded incidents · 1h 20m downtime in the last 30 days",
    );
    expect(screen.getByText(/^Available downtime per day · UTC/)).toBeVisible();
  });

  it("keeps cached history visible when a background refresh fails", () => {
    mocks.query.mockReturnValue({ ...loaded, isError: true, refetch: mocks.refetch });
    render(<IncidentActivity monitorId="m1" />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeVisible();
  });
});

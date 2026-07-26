import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Recharts renders nothing measurable under jsdom (ResponsiveContainer has no
// layout), and the chart internals are not the unit under test. Replace them
// with light stubs that additionally exercise the function props the component
// hands to recharts: the axis `tickFormatter`s and the custom `Tooltip`
// content, none of which recharts would ever invoke in this environment.
vi.mock("recharts", async () => {
  const React = await import("react");
  const ts = Date.UTC(2023, 0, 1, 12, 0, 0);
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive">{children}</div>
    ),
    AreaChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="area-chart">{children}</div>
    ),
    Area: () => <div data-testid="area" />,
    CartesianGrid: () => <div />,
    ReferenceLine: () => <div />,
    XAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
      <div data-testid="xaxis">{tickFormatter ? tickFormatter(ts) : null}</div>
    ),
    YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
      <div data-testid="yaxis">
        {tickFormatter ? `${tickFormatter(1)}/${tickFormatter(0)}` : null}
      </div>
    ),
    Tooltip: ({ content }: { content: React.ReactElement }) => (
      <div data-testid="tooltip">
        {/* inactive -> renders nothing */}
        {React.cloneElement(content, {})}
        {/* active but empty payload -> renders nothing */}
        {React.cloneElement(content, { active: true, payload: [] })}
        {/* active, status up, no duration */}
        {React.cloneElement(content, {
          active: true,
          payload: [{ payload: { ts, status: 1 } }],
        })}
        {/* active, status down, with duration */}
        {React.cloneElement(content, {
          active: true,
          payload: [{ payload: { ts, status: 0, duration: 125 } }],
        })}
      </div>
    ),
  };
});

import ResponseTime from "@/components/module/monitor/details/response-time";

const baseProps = {
  interval: 30,
  timeout: 60,
  timeRange: "1h",
  setTimeRange: vi.fn(),
  currentStatus: true,
  request: true,
  data: [],
};

describe("ResponseTime", () => {
  it("shows 100% uptime and zero downtime for empty data", () => {
    render(<ResponseTime {...baseProps} />);
    expect(screen.getByText("Status Overview")).toBeInTheDocument();
    expect(screen.getByText("100.00%")).toBeInTheDocument();
    // Two metric cards read "0s" / "0" for downtime and incident count.
    expect(screen.getByText("0s")).toBeInTheDocument();
  });

  it("renders the interval and request-timeout labels", () => {
    render(<ResponseTime {...baseProps} />);
    expect(screen.getByText("Monitor interval")).toBeInTheDocument();
    expect(screen.getByText("Request timeout")).toBeInTheDocument();
  });

  it("shows the grace-period label when not a request monitor", () => {
    render(<ResponseTime {...baseProps} request={false} />);
    expect(screen.getByText("Grace Period")).toBeInTheDocument();
  });

  it("computes downtime metrics from in-range logs", () => {
    const now = Date.now();
    const data = [
      // ongoing downtime (no endTime), clipped to range
      {
        startTime: new Date(now - 10 * 60 * 1000).toISOString(),
        endTime: null,
        downtimeDurationSeconds: null,
      },
      // resolved downtime fully inside the range
      {
        startTime: new Date(now - 40 * 60 * 1000).toISOString(),
        endTime: new Date(now - 30 * 60 * 1000).toISOString(),
        downtimeDurationSeconds: 600,
      },
      // entirely before the range -> ignored
      {
        startTime: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
        downtimeDurationSeconds: 3600,
      },
    ];
    render(<ResponseTime {...baseProps} currentStatus={false} data={data} />);
    // Two of the three logs fall in the 1h window.
    expect(screen.getByText("2")).toBeInTheDocument();
    // Uptime is below 100 given the accumulated downtime.
    expect(screen.queryByText("100.00%")).not.toBeInTheDocument();
    // Custom tooltip down branch renders a formatted duration.
    expect(screen.getByText(/Duration:/)).toBeInTheDocument();
    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.getByText("Up")).toBeInTheDocument();
  });

  it("falls back to the 1h window for an unknown time range", () => {
    render(<ResponseTime {...baseProps} timeRange="99h" />);
    expect(screen.getByText("100.00%")).toBeInTheDocument();
  });

  it("invokes setTimeRange when a new range is selected", async () => {
    const setTimeRange = vi.fn();
    render(<ResponseTime {...baseProps} setTimeRange={setTimeRange} />);
    await userEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByText("Last 24 Hours");
    await userEvent.click(option);
    expect(setTimeRange).toHaveBeenCalledWith("24h");
  });
});

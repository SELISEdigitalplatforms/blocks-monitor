import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
    AreaChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) => {
      // Capture the plotted series so tests can assert which points the component decided to
      // draw, not merely that a chart rendered.
      (globalThis as { __chartPoints?: unknown[] }).__chartPoints = data ?? [];
      return <div data-testid="area-chart">{children}</div>;
    },
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
  now: Date.now(),
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
    render(<ResponseTime {...baseProps} now={now} currentStatus={false} data={data} />);
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

// A paused monitor is not being checked, so the chart must not assert an up/down state at "now"
// while the page shows a Paused badge (issue #197, C1).
describe("ResponseTime while paused", () => {
  const points = () => (globalThis as { __chartPoints?: { ts: number; status: number }[] }).__chartPoints ?? [];

  it("plots a current status point while the monitor is active", () => {
    render(<ResponseTime {...baseProps} currentStatus={false} isActive />);
    const last = points().at(-1)!;
    expect(last.status).toBe(0);
  });

  it("omits the current status point while the monitor is paused", () => {
    render(<ResponseTime {...baseProps} currentStatus={false} isActive={false} />);
    // Only the synthetic "now" reading disappears; the historical series is untouched, which is
    // what keeps this consistent with C2 leaving incident history alone.
    expect(points().some((p) => p.status === 0)).toBe(false);
  });

  it("omits it for a monitor with downtime history too", () => {
    const now = Date.now();
    const withHistory = [
      {
        startTime: new Date(now - 30 * 60 * 1000).toISOString(),
        endTime: new Date(now - 25 * 60 * 1000).toISOString(),
      },
    ] as unknown as typeof baseProps.data;

    render(
      <ResponseTime {...baseProps} now={now} data={withHistory} currentStatus={false} isActive={false} />
    );
    // The last plotted point is a real recovery edge, not a "currently down" assertion at now.
    expect(points().at(-1)!.ts).toBeLessThan(now);
  });

  it("defaults to plotting the current point when isActive is not supplied", () => {
    render(<ResponseTime {...baseProps} currentStatus={false} />);
    expect(points().at(-1)!.status).toBe(0);
  });
});

describe("ResponseTime with an unresolved incident", () => {
  const points = () => (globalThis as { __chartPoints?: { ts: number; status: number }[] }).__chartPoints ?? [];
  const now = Date.now();
  const openIncident = () =>
    [
      { startTime: new Date(now - 20 * 60 * 1000).toISOString(), endTime: null },
    ] as unknown as typeof baseProps.data;

  it("plots the ongoing outage up to now while active", () => {
    render(<ResponseTime {...baseProps} now={now} data={openIncident()} currentStatus={false} isActive />);
    expect(points().filter((p) => p.status === 0).length).toBeGreaterThan(1);
  });

  it("does not claim the monitor is currently down while paused", () => {
    // An open incident normalises its end to `now`, so guarding only the synthetic final point
    // left this one asserting a live Down beside the Paused badge.
    render(
      <ResponseTime
        {...baseProps}
        now={now}
        data={openIncident()}
        currentStatus={false}
        isActive={false}
      />
    );
    const down = points().filter((p) => p.status === 0);
    expect(down.length).toBeGreaterThan(0); // the outage itself is still shown
    expect(down.every((p) => p.ts < now)).toBe(true);
  });
});

describe("ResponseTime over the monitor's lifetime", () => {
  const NOW = Date.UTC(2026, 9, 22, 11, 25, 23);
  const S = 1000;
  const M = 60 * S;
  const points = () => (globalThis as { __chartPoints?: { ts: number; status: number }[] }).__chartPoints ?? [];
  const at = (ms: number) => new Date(ms).toISOString();
  const logs = (...items: { startTime: string; endTime: string | null }[]) =>
    items as unknown as typeof baseProps.data;

  const props = { ...baseProps, now: NOW, createdAt: at(NOW - 10 * M) };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures uptime only since the monitor was created", () => {
    // Created 10 minutes into a 1h window, down 3 minutes. That is 70% of the time it existed,
    // not 95% of the hour.
    render(<ResponseTime {...props} data={logs({ startTime: at(NOW - 8 * M), endTime: at(NOW - 5 * M) })} />);
    expect(screen.getByText("70.00%")).toBeInTheDocument();
  });

  it("does not plot the time before the monitor existed", () => {
    render(<ResponseTime {...props} />);
    expect(points()[0].ts).toBe(NOW - 10 * M);
    expect(points().every((p) => p.ts >= NOW - 10 * M)).toBe(true);
  });

  it("uses the whole window for a monitor older than it", () => {
    render(<ResponseTime {...props} createdAt={at(NOW - 2 * 60 * M)} />);
    expect(points()[0].ts).toBe(NOW - 60 * M);
  });

  it("does not move between polls", () => {
    // Worked out as of the data's fetch time. A ticking clock against downtime fetched earlier
    // made an open outage read as rising uptime until the next poll snapped it back.
    render(<ResponseTime {...props} currentStatus={false} data={logs({ startTime: at(NOW - 3 * M), endTime: null })} />);
    expect(screen.getByText("70.00%")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30 * S);
    });

    expect(screen.getByText("70.00%")).toBeInTheDocument();
    expect(points().at(-1)!.ts).toBe(NOW);
  });

  it("follows the poll: a new `now` moves the window and plots incidents that started since", () => {
    const { rerender } = render(<ResponseTime {...props} />);
    expect(points().at(-1)!.ts).toBe(NOW);

    // The next poll, 10s later, brings an outage that started after the previous one.
    rerender(
      <ResponseTime
        {...props}
        now={NOW + 10 * S}
        currentStatus={false}
        data={logs({ startTime: at(NOW + 5 * S), endTime: null })}
      />
    );

    expect(points().at(-1)).toMatchObject({ ts: NOW + 10 * S, status: 0 });
    expect(points().some((p) => p.ts === NOW + 5 * S && p.status === 0)).toBe(true);
  });
});

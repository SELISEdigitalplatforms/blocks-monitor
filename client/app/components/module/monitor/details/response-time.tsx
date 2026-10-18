import React, { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/core";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import {
  SECTION_CLASS,
  STAT_LABEL_CLASS,
  STAT_SUB_CLASS,
  STAT_VALUE_CLASS,
  SURFACE_TILE_CLASS,
} from "@/components/module/monitor/details/surface-styles";
import {
  AreaChart,
  Area,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { formatDuration } from "@seliseblocks/app-kit/utils";

type DowntimeLog = {
  startTime: string;
  endTime: string | null;
  downtimeDurationSeconds: number | null;
};

type ResponseTimeProps = {
  interval: number;
  timeout: number;
  data: DowntimeLog[] | null | undefined;
  timeRange: string;
  setTimeRange: (value: string) => void;
  currentStatus: boolean;
  /**
   * Whether the monitor is still being checked. A paused monitor has no current health, so the
   * chart stops at its last real observation instead of asserting an up/down state at "now".
   * Defaults to true so existing callers are unaffected.
   */
  isActive?: boolean;
  request: boolean;
};

type ChartPoint = {
  ts: number;
  status: number;
  // optional meta for tooltip
  startTime?: number;
  endTime?: number;
  duration?: number;
};

const TIME_RANGES: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) => {
  if (!active || !payload?.length) return null;
  const d: ChartPoint = payload[0]?.payload;
  return (
    <div className="rounded-sm border border-border bg-popover p-3 text-[13px] text-popover-foreground shadow-md">
      <div className="mb-1 font-medium text-high-emphasis">{new Date(d.ts).toLocaleString()}</div>
      <div
        className={d.status === 1 ? "font-semibold text-forest-ink" : "font-semibold text-rose-ink"}
      >
        {d.status === 1 ? "Up" : "Down"}
      </div>
      {d.duration !== undefined && (
        <div className="mt-1 text-muted-foreground">
          Duration: {formatDuration(d.duration * 1000)}
        </div>
      )}
    </div>
  );
};

// Chart colours come from the console tokens (bare `H S% L%` triplets), so the chart follows the
// light and dark themes like the rest of the page.
const CHART_UP = "hsl(var(--forest))";
const CHART_GRID = "hsl(var(--border))";
const CHART_AXIS = "hsl(var(--border-default))";
const CHART_TICK = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };

type RelevantDowntime = {
  start: number;
  end: number;
};

const processDowntimePoints = (
  relevant: RelevantDowntime[],
  rangeStart: number,
  now: number,
  isActive: boolean,
  pts: ChartPoint[],
) => {
  for (const d of relevant) {
    const s = Math.max(d.start, rangeStart);
    const e = Math.min(d.end, now);

    // push one tick immediately before downtime to keep step visual (if within range)
    if (s - 1 >= rangeStart) pts.push({ ts: s - 1, status: 1 });

    // downtime start
    pts.push({
      ts: s,
      status: 0,
      startTime: s,
      endTime: e,
      duration: Math.round((e - s) / 1000),
    });

    // downtime end. An unresolved incident normalises its end to `now` above, so while paused
    // this point would assert "currently down" just as the synthetic final point would -- the
    // guard has to cover both. The incident's start is still plotted, so the chart shows it
    // went down and then observation stopped.
    if (isActive || e < now) {
      pts.push({
        ts: e,
        status: 0,
        startTime: s,
        endTime: e,
        duration: Math.round((e - s) / 1000),
      });
    }

    // push one tick immediately after downtime to transition back to UP
    if (e + 1 <= now) pts.push({ ts: e + 1, status: 1 });
  }
};

const ResponseTime = ({
  data: downtimes,
  timeRange,
  setTimeRange,
  interval,
  timeout,
  currentStatus,
  isActive = true,
  request,
}: ResponseTimeProps) => {
  // Anchor the window at mount so the render stays pure (no Date.now() call in
  // render body). Data updates still refresh the memos via their downtimes dep.
  const [now] = useState(() => Date.now());
  const rangeStart = now - (TIME_RANGES[timeRange] ?? TIME_RANGES["1h"]);

  // metrics
  const metrics = useMemo(() => {
    let totalDowntime = 0;
    let downtimeCount = 0;

    if (!downtimes || !Array.isArray(downtimes) || downtimes.length === 0) {
      return {
        uptimePercentage: "100.00",
        totalDowntime: "0s",
        downtimeCount: 0,
      };
    }

    for (const log of downtimes) {
      const s = new Date(log.startTime).getTime();
      const e = log.endTime ? new Date(log.endTime).getTime() : now;

      if (e < rangeStart || s > now) continue;

      const cs = Math.max(s, rangeStart);
      const ce = Math.min(e, now);

      totalDowntime += Math.max(0, ce - cs);
      downtimeCount++;
    }

    const totalTime = Math.max(1, now - rangeStart);
    const uptimePct = ((totalTime - totalDowntime) / totalTime) * 100;

    return {
      uptimePercentage: uptimePct.toFixed(2),
      totalDowntime: formatDuration(totalDowntime),
      downtimeCount,
    };
  }, [downtimes, rangeStart, now]);

  // build chart data (strict linear timeline, stepAfter semantics via step-like points)
  const chartData: ChartPoint[] = useMemo(() => {
    const pts: ChartPoint[] = [];

    // start edge: assume UP at rangeStart (will be corrected by downtimes if overlap)
    pts.push({ ts: rangeStart, status: 1 });

    if (downtimes && Array.isArray(downtimes) && downtimes.length > 0) {
      // normalize and clip downtimes to range
      const relevant = downtimes
        .map((d) => ({
          start: new Date(d.startTime).getTime(),
          end: d.endTime ? new Date(d.endTime).getTime() : now,
        }))
        .filter((d) => d.end >= rangeStart && d.start <= now)
        .sort((a, b) => a.start - b.start);

      processDowntimePoints(relevant, rangeStart, now, isActive, pts);
    }

    // final point at now -- skipped while paused: nothing is being checked, so plotting a
    // current up/down here would contradict the Paused badge on the same page.
    if (isActive) pts.push({ ts: now, status: currentStatus ? 1 : 0 });

    // dedupe by timestamp keeping last pushed (so transitions behave correctly)
    const map = new Map<number, ChartPoint>();
    for (const p of pts) map.set(p.ts, p);
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [downtimes, rangeStart, now, currentStatus, isActive]);

  const metricTiles = [
    { label: "Uptime", value: `${metrics.uptimePercentage}%`, sub: "Of the selected window" },
    { label: "Total downtime", value: metrics.totalDowntime, sub: "Time spent down" },
    { label: "Incidents", value: metrics.downtimeCount, sub: "Outages in the window" },
  ];

  return (
    <section aria-label="Response time" className={SECTION_CLASS}>
      <SectionHeading
        className="items-center"
        title="Response time"
        description="Up and down checks over the selected window"
        actions={
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              aria-label="Time range"
              className="h-9 w-40 rounded-sm border-border bg-card text-[13px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-sm">
              <SelectItem value="1h">Last 1 Hour</SelectItem>
              <SelectItem value="3h">Last 3 Hours</SelectItem>
              <SelectItem value="6h">Last 6 Hours</SelectItem>
              <SelectItem value="12h">Last 12 Hours</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metricTiles.map((tile) => (
          <div key={tile.label} className={SURFACE_TILE_CLASS}>
            <p className={STAT_LABEL_CLASS}>{tile.label}</p>
            <p className={STAT_VALUE_CLASS}>{tile.value}</p>
            <p className={STAT_SUB_CLASS}>{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className={SURFACE_TILE_CLASS}>
        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Monitor interval</dt>
            <dd className="font-medium text-high-emphasis">{formatDuration(interval * 1000)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">
              {request ? "Request timeout" : "Grace Period"}
            </dt>
            <dd className="font-medium text-high-emphasis">{formatDuration(timeout * 1000)}</dd>
          </div>
        </dl>

        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="statusGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor={CHART_UP} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_UP} stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />

            <XAxis
              dataKey="ts"
              type="number"
              domain={[rangeStart, now]}
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              tick={CHART_TICK}
              axisLine={{ stroke: CHART_AXIS }}
            />

            <YAxis
              domain={[0, 1]}
              ticks={[0, 1]}
              tickFormatter={(v) => (v === 1 ? "Up" : "Down")}
              width={60}
              tick={CHART_TICK}
              axisLine={{ stroke: CHART_AXIS }}
            />

            <Tooltip content={<CustomTooltip />} />

            <ReferenceLine y={0.5} stroke={CHART_GRID} strokeDasharray="3 3" />

            <Area
              type="stepAfter"
              dataKey="status"
              stroke={CHART_UP}
              strokeWidth={2.5}
              fill="url(#statusGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

export default ResponseTime;

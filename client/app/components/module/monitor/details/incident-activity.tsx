import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDuration } from "@seliseblocks/app-kit/utils";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/core";
import { StatusPill } from "@/components/module/monitor/details/status-pill";
import { useMonitorIncidentActivity } from "@/hooks/use-monitor-incident-activity";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The windows the chart can plot, in days, ending today (UTC). */
const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;
type Range = (typeof RANGES)[number]["value"];
const DEFAULT_RANGE: Range = "30";

/** At or above this many minutes on the busiest day, the axis reads in hours. */
const HOURS_FROM_MINUTES = 120;

// Chart colours come from the console tokens (bare `H S% L%` triplets), so the chart follows the
// light and dark themes like the rest of the page, as the Response time chart does.
const CHART_LINE = "hsl(var(--rose-ink))";
const CHART_SELECTED = "hsl(var(--primary))";
const CHART_SURFACE = "hsl(var(--card))";
const CHART_GRID = "hsl(var(--border))";
const CHART_TEXT = "hsl(var(--muted-foreground))";
const CHART_TICK = { fontSize: 12, fill: CHART_TEXT };

const dayFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const tickFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const valueFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** One plotted day: `value` is in the axis unit, `count` is the raw day total from the service. */
type IncidentChartPoint = {
  date: string;
  value: number;
  count: number;
  incidents: number;
};

type Axis = { scale: "minute" | "hour" | "incident"; label: string; series: string };

type DotProps = { cx?: number; cy?: number; index?: number; payload?: IncidentChartPoint };

/**
 * A round marker on each day, ringed in the surface colour so it stays legible on the line. At
 * 90 days the markers would touch, so only days with incidents keep one and the line carries the
 * quiet days.
 */
function renderDot({ cx, cy, index, payload }: DotProps, dense: boolean) {
  const key = `dot-${index ?? payload?.date}`;
  if (cx == null || cy == null || (dense && !payload?.incidents && !payload?.count))
    return <g key={key} />;
  return (
    <circle
      key={key}
      data-testid="incident-activity-dot"
      cx={cx}
      cy={cy}
      r={4}
      fill={CHART_LINE}
      stroke={CHART_SURFACE}
      strokeWidth={2}
    />
  );
}

/** Line animation is decoration, so it is off whenever the reader asks for reduced motion. */
const prefersReducedMotion = () =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Readout for the hovered day: the values lead, their labels follow. */
function IncidentChartTooltip({
  active,
  payload,
  byMinute,
}: {
  active?: boolean;
  payload?: { payload: IncidentChartPoint }[];
  byMinute: boolean;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const incidents = `${point.incidents} ${plural(point.incidents, "incident", "incidents")}`;
  return (
    <div className="rounded-sm border border-border bg-popover p-3 text-[13px] text-popover-foreground shadow-md">
      <p className="mb-1 font-medium text-high-emphasis">{dayFormat.format(asDate(point.date))}</p>
      {byMinute && (
        <p className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: CHART_LINE }} />
          <span className="font-semibold text-high-emphasis">
            {point.count ? formatDuration(point.count * MINUTE_MS) : "No downtime"}
          </span>
          {point.count > 0 && <span className="text-muted-foreground">downtime</span>}
        </p>
      )}
      <p className="flex items-center gap-2">
        {!byMinute && (
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: CHART_LINE }} />
        )}
        <span
          className={byMinute ? "pl-5 text-muted-foreground" : "font-semibold text-high-emphasis"}
        >
          {incidents}
        </span>
      </p>
    </div>
  );
}

/**
 * A monitor's downtime per day over the last 7, 30 or 90 days (UTC) as a line chart, read from
 * the year of incident activity the service derives. Days without incidents plot as 0 so the line
 * stays continuous; the axis reads in minutes, or hours once the busiest day reaches two hours,
 * and in incidents per day when downtime can't be derived. Selecting a point lists the incidents
 * counted on that day.
 */
export default function IncidentActivity({ monitorId }: { monitorId: string }) {
  const [endDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [animate] = useState(() => !prefersReducedMotion());
  const { data, isPending, isError, isFetching, refetch } = useMonitorIncidentActivity(
    monitorId,
    endDate,
  );

  const byMinute = data?.unit !== "incident";
  const incidents = useMemo(() => data?.incidents ?? [], [data]);

  const { series, axis, total, incidentCount } = useMemo(() => {
    const totals = new Map((data?.days ?? []).map((day) => [day.date, day.count]));
    const perDay = new Map<string, number>();
    for (const incident of incidents)
      for (const day of incident.days) perDay.set(day, (perDay.get(day) ?? 0) + 1);

    const end = asDate(endDate).getTime();
    const dates = Array.from({ length: Number(range) }, (_, i) =>
      toDay(end - (Number(range) - 1 - i) * DAY_MS),
    );
    const first = dates[0];
    const max = Math.max(0, ...dates.map((date) => totals.get(date) ?? 0));
    const axis: Axis = !byMinute
      ? { scale: "incident", label: "Incidents", series: "Incidents per day" }
      : max >= HOURS_FROM_MINUTES
        ? { scale: "hour", label: "Downtime (hours)", series: "Downtime (hours)" }
        : { scale: "minute", label: "Downtime (minutes)", series: "Downtime (minutes)" };

    const series: IncidentChartPoint[] = dates.map((date) => {
      const count = totals.get(date) ?? 0;
      return {
        date,
        count,
        value: axis.scale === "hour" ? Math.round((count / 60) * 100) / 100 : count,
        incidents: perDay.get(date) ?? 0,
      };
    });
    return {
      series,
      axis,
      total: series.reduce((sum, point) => sum + point.count, 0),
      incidentCount: incidents.filter((incident) =>
        incident.days.some((day) => day >= first && day <= endDate),
      ).length,
    };
  }, [data, incidents, byMinute, endDate, range]);

  if (isPending)
    return <Skeleton aria-label="Loading incident activity" className="h-72 w-full rounded-sm" />;
  if (isError && !data)
    return (
      <div className="rounded-sm bg-surface-warm p-4">
        <p role="status" className="text-sm text-muted-foreground">
          Incident activity is unavailable.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );

  const basis = byMinute ? "downtime per day" : "incidents per day";
  const rangeLabel = RANGES.find((option) => option.value === range)?.label.toLowerCase();
  const isEmpty = !incidentCount && !total;
  const dailyIncidents = selectedDay
    ? incidents.filter((incident) => incident.days.includes(selectedDay))
    : [];
  const dateLabel = selectedDay ? dayFormat.format(asDate(selectedDay)) : "";

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-high-emphasis">
            {incidentCount.toLocaleString()} {data?.isPartial ? "recorded " : ""}
            {plural(incidentCount, "incident", "incidents")}
          </span>
          {byMinute && total > 0 && ` · ${formatDuration(total * MINUTE_MS)} downtime`} in the{" "}
          {rangeLabel}
        </p>
        <Select
          value={range}
          onValueChange={(value) => {
            setRange(value as Range);
            setSelectedDay(null);
          }}
        >
          <SelectTrigger
            aria-label="Incident range"
            className="h-9 w-40 rounded-sm border-border bg-card text-[13px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-sm">
            {RANGES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isEmpty ? (
        <div className="flex h-[260px] items-center justify-center rounded-sm bg-surface-warm">
          <p className="text-sm text-muted-foreground">No incidents in this period.</p>
        </div>
      ) : (
        <>
          <div className="h-[260px] w-full cursor-pointer" data-testid="incident-activity-chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={series}
                margin={{ top: 8, right: 16, bottom: 8, left: 4 }}
                accessibilityLayer
                onClick={(state) => {
                  const day = state?.activeLabel;
                  if (typeof day === "string") setSelectedDay(day);
                }}
              >
                <CartesianGrid vertical={false} stroke={CHART_GRID} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(day: string) => tickFormat.format(asDate(day))}
                  tick={CHART_TICK}
                  tickLine={false}
                  axisLine={{ stroke: CHART_GRID }}
                  minTickGap={24}
                  interval="preserveStartEnd"
                  height={44}
                  label={{
                    value: "Date (UTC)",
                    position: "insideBottom",
                    fill: CHART_TEXT,
                    fontSize: 12,
                  }}
                />
                <YAxis
                  domain={[0, "auto"]}
                  allowDecimals={axis.scale === "hour"}
                  tickFormatter={(value: number) => valueFormat.format(value)}
                  tick={CHART_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  label={{
                    value: axis.label,
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                    fill: CHART_TEXT,
                    fontSize: 12,
                  }}
                />
                <Tooltip
                  content={<IncidentChartTooltip byMinute={byMinute} />}
                  cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
                />
                {selectedDay && (
                  <ReferenceLine x={selectedDay} stroke={CHART_SELECTED} strokeWidth={1} />
                )}
                <Line
                  type="linear"
                  dataKey="value"
                  name={axis.series}
                  stroke={CHART_LINE}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={(props: DotProps) => renderDot(props, Number(range) > 30)}
                  activeDot={{ r: 6, fill: CHART_LINE, stroke: CHART_SURFACE, strokeWidth: 2 }}
                  isAnimationActive={animate}
                  animationDuration={400}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul aria-label="Legend" className="flex justify-center text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <svg aria-hidden width="20" height="10" viewBox="0 0 20 10">
                <line x1="1" y1="5" x2="19" y2="5" stroke={CHART_LINE} strokeWidth="2" />
                <circle cx="10" cy="5" r="3" fill={CHART_LINE} />
              </svg>
              {axis.series}
            </li>
          </ul>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {data?.isPartial ? `Available ${basis}` : basis[0].toUpperCase() + basis.slice(1)} · UTC ·
        Select a point to view its incidents.
      </p>
      {selectedDay && (
        <section
          aria-label={`Incidents on ${dateLabel}`}
          className="rounded-sm bg-surface-warm p-4"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">
              {dailyIncidents.length} {plural(dailyIncidents.length, "incident", "incidents")} on{" "}
              {dateLabel}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="Clear selected day"
              onClick={() => setSelectedDay(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {!dailyIncidents.length ? (
            <p className="text-sm text-muted-foreground">No incidents on this day.</p>
          ) : (
            <ul className="space-y-1">
              {dailyIncidents.map((incident) => (
                <li
                  key={incident.itemId}
                  data-testid="incident-activity-item"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                >
                  <time dateTime={incident.startTime} className="font-medium tabular-nums">
                    {/* An incident carried over from an earlier day shows the day it began. */}
                    {(incident.startTime.slice(0, 10) === selectedDay
                      ? timeFormat
                      : dateTimeFormat
                    ).format(new Date(incident.startTime))}{" "}
                    UTC
                  </time>
                  <span className="text-muted-foreground">
                    {incident.durationMs == null
                      ? "Duration unknown"
                      : formatDuration(incident.durationMs)}
                  </span>
                  <StatusPill tone={incident.isResolved ? "up" : "down"} className="ml-auto">
                    {incident.isResolved ? "Resolved" : "Unresolved"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

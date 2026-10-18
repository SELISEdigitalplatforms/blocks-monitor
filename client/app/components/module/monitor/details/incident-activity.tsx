import { useState } from "react";
import { X } from "lucide-react";
import { formatDuration } from "@seliseblocks/app-kit/utils";
import ContributionSkyline from "@/components/ui/contribution-skyline";
import { Button, Skeleton } from "@/components/core";
import { StatusPill } from "@/components/module/monitor/details/status-pill";
import { useMonitorIncidentActivity } from "@/hooks/use-monitor-incident-activity";

const dayFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * A year of a monitor's downtime as the console's calendar heat map, folding up into a 3D
 * skyline (the deployment-activity panel, read for incidents). Each day is that day's downtime
 * in minutes; selecting a day lists the incidents counted on it.
 */
export default function IncidentActivity({
  monitorId,
  defaultView = "2d",
}: {
  monitorId: string;
  defaultView?: "2d" | "3d";
}) {
  const [endDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const { data, isPending, isError, isFetching, refetch } = useMonitorIncidentActivity(
    monitorId,
    endDate,
  );

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

  const byMinute = data?.unit !== "incident";
  const basis = byMinute ? "downtime per day" : "incidents per day";
  const incidents = data?.incidents ?? [];
  const dailyIncidents = selectedDay
    ? incidents.filter((incident) => incident.days.includes(selectedDay))
    : [];
  const dateLabel = selectedDay ? dayFormat.format(new Date(`${selectedDay}T00:00:00Z`)) : "";

  return (
    <div className="min-w-0 space-y-3">
      <ContributionSkyline
        data={data?.days ?? []}
        endDate={endDate}
        unit={byMinute ? "minute of downtime" : "incident"}
        unitPlural={byMinute ? "minutes of downtime" : "incidents"}
        defaultView={defaultView}
        // The component's warm preset, so heavy days read as downtime rather than activity.
        palette="ember"
        appearance="minimal"
        title={
          data?.isPartial
            ? `${incidents.length.toLocaleString()} recorded ${plural(incidents.length, "incident", "incidents")}`
            : undefined
        }
        showStats={!data?.isPartial}
        onCellClick={(day) => setSelectedDay(day.date)}
      />
      <p className="text-xs text-muted-foreground">
        {data?.isPartial ? `Available ${basis}` : basis[0].toUpperCase() + basis.slice(1)} · UTC ·
        Select a day to view its incidents.
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

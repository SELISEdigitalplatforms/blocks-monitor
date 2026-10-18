import type { ContributionDay } from "@/components/ui/contribution-skyline";
import type { IncidentTree } from "@/models/alerts.model";
import { alertsService } from "./alerts.service";

/** One incident as the calendar and its selected-day panel read it. */
export interface ActivityIncident {
  itemId: string;
  /** ISO, UTC. */
  startTime: string;
  isResolved: boolean;
  /** Whole incident length (to `now` while unresolved); null when it can't be derived. */
  durationMs: number | null;
  /** Every UTC day (`YYYY-MM-DD`) inside the calendar this incident is counted on. */
  days: string[];
}

export interface MonitorIncidentActivity {
  /** Per-day downtime in minutes, or incidents per day when `unit` is "incident". */
  days: ContributionDay[];
  incidents: ActivityIncident[];
  unit: "minute" | "incident";
  /** The endpoint stopped advancing before the full history could be read. */
  isPartial?: boolean;
}

const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Monitor timestamps without an offset are UTC, as the service stores them. */
export function incidentTimestamp(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : value.includes("T")
      ? `${value}Z`
      : `${value}T00:00:00Z`;
  return Date.parse(normalized);
}

/** First day of the calendar: the Sunday on or before the day one year before `endDate`. */
export function activityStart(endDate: string): number {
  const first = new Date(Date.parse(`${endDate}T00:00:00Z`) - 364 * DAY_MS);
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return first.getTime();
}

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * When the incident ended, mirroring the incident table: an unresolved incident is still
 * running, so it counts up to `now`. A resolved one ends `downtimeDurationSeconds` after it
 * started (the table's Duration column), or at a valid `endTime` when no duration was recorded.
 * Returns NaN when neither gives a usable end — that downtime can't be derived.
 */
function incidentEnd(incident: IncidentTree, start: number, now: number): number {
  if (!incident.isResolved) return Math.max(start, now);
  const seconds = Number(incident.downtimeDurationSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return start + seconds * 1000;
  const end = incidentTimestamp(incident.endTime);
  // The API writes DateTime.MinValue ("0001-01-01") for a missing end; anything before the
  // start is the same "no end" signal the table reads as Ongoing.
  return Number.isFinite(end) && end >= start ? end : NaN;
}

/**
 * A year of a monitor's incidents for the downtime calendar, read independently of the
 * incident table's page size.
 *
 * The incidents endpoint can't filter by date, so it is paged newest-first by start time and
 * reading stops once a whole page started before the calendar.
 *
 * Each day's value is that day's downtime in minutes, rounded up so a day touched by any
 * incident shows at least 1. An incident that spans midnight UTC is SPLIT across the days it
 * covers (a 23:30–00:45 outage is 30 minutes on the first day and 45 on the next), so a day's
 * value is the downtime that actually fell on it and a long or still-open outage shows on every
 * day it lasted, rather than one tall bar on its start day. If any incident in the calendar has
 * no derivable duration, the calendar falls back to incidents per day (by start day) instead of
 * understating downtime in minutes.
 */
export async function getMonitorIncidentActivity(
  monitorId: string,
  endDate: string,
  { signal, now = Date.now() }: { signal?: AbortSignal; now?: number } = {},
): Promise<MonitorIncidentActivity> {
  const windowStart = activityStart(endDate);
  const windowEnd = Date.parse(`${endDate}T00:00:00Z`) + DAY_MS;
  const seen = new Set<string>();
  const read: { incident: IncidentTree; start: number; end: number }[] = [];
  let readCount = 0;
  let isPartial = false;

  for (let pageNumber = 1; ; pageNumber++) {
    signal?.throwIfAborted();
    const response = await alertsService.getAllMonitorIncidentList({
      monitorId,
      pageNumber,
      pageSize: PAGE_SIZE,
      sortProperty: "started_time",
      sortIsDescending: true,
    });
    signal?.throwIfAborted();
    if (
      !response ||
      response.isSuccess === false ||
      (response.data != null && !Array.isArray(response.data))
    ) {
      throw new Error("Incident activity could not be loaded.");
    }
    const page = response.data ?? [];
    const total = response.totalCount;
    if (!page.length) {
      isPartial = typeof total === "number" && readCount < total;
      break;
    }
    let added = 0;
    for (const incident of page) {
      if (!incident?.itemId || seen.has(incident.itemId)) continue;
      seen.add(incident.itemId);
      added++;
      const start = incidentTimestamp(incident.startTime);
      if (!Number.isFinite(start)) continue;
      const end = incidentEnd(incident, start, now);
      // In the calendar if it overlaps it at all (or, with no derivable end, starts inside it).
      const overlaps = Number.isFinite(end)
        ? start < windowEnd && (end > windowStart || start >= windowStart)
        : start >= windowStart && start < windowEnd;
      if (overlaps) read.push({ incident, start, end });
    }
    // A server that ignores paging returns the same page again; keep what was read.
    if (!added) {
      isPartial = true;
      break;
    }
    readCount += page.length;
    // Newest first: once a whole page started before the calendar, later pages can't add to it.
    if (page.every((incident) => incidentTimestamp(incident?.startTime) < windowStart)) break;
    if (typeof total === "number" && Number.isFinite(total)) {
      if (readCount >= total) break;
    } else if (page.length < PAGE_SIZE) break;
  }

  const unit: MonitorIncidentActivity["unit"] = read.every(({ end }) => Number.isFinite(end))
    ? "minute"
    : "incident";
  const totals = new Map<string, number>();
  const incidents: ActivityIncident[] = read.map(({ incident, start, end }) => {
    const days: string[] = [];
    if (unit === "incident") {
      if (start >= windowStart) {
        const day = toDay(start);
        days.push(day);
        totals.set(day, (totals.get(day) ?? 0) + 1);
      }
    } else {
      // Split [start, end) over the UTC days it covers, clipped to the calendar. A zero-length
      // incident still marks its start day.
      const from = Math.max(start, windowStart);
      const to = Math.min(end, windowEnd);
      if (to > from) {
        for (let day0 = Math.floor(from / DAY_MS) * DAY_MS; day0 < to; day0 += DAY_MS) {
          const day = toDay(day0);
          days.push(day);
          totals.set(
            day,
            (totals.get(day) ?? 0) + Math.min(to, day0 + DAY_MS) - Math.max(from, day0),
          );
        }
      } else if (start >= windowStart && start < windowEnd) {
        const day = toDay(start);
        days.push(day);
        totals.set(day, totals.get(day) ?? 0);
      }
    }
    return {
      itemId: incident.itemId,
      startTime: new Date(start).toISOString(),
      isResolved: Boolean(incident.isResolved),
      durationMs: Number.isFinite(end) ? end - start : null,
      days,
    };
  });

  return {
    days: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        count: unit === "minute" ? Math.max(1, Math.ceil(value / MINUTE_MS)) : value,
      })),
    incidents: incidents
      .filter((incident) => incident.days.length)
      .sort((a, b) => b.startTime.localeCompare(a.startTime)),
    unit,
    ...(isPartial ? { isPartial: true } : {}),
  };
}

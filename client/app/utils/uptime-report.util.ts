/** The periods the export dialog offers; `custom` uses the two date inputs. */
export const REPORT_PERIODS = ["24h", "7d", "30d", "90d", "365d", "custom"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export type ReportFormat = "pdf" | "xlsx";

/** The server refuses anything longer (a year plus a leap day). */
export const MAX_REPORT_DAYS = 366;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PRESET_MS: Record<Exclude<ReportPeriod, "custom">, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
  "365d": 365 * DAY_MS,
};

export type ReportPeriodError = "REQUIRED" | "ORDER" | "FUTURE" | "TOO_LONG";

export type ResolvedReportPeriod = { from: Date; to: Date } | { error: ReportPeriodError };

/** `yyyy-mm-dd` of a date in the browser's own time zone (what `<input type="date">` uses). */
export const toDateInputValue = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Local midnight of a `yyyy-mm-dd` value, or null when it is not a real date. */
const parseLocalDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects 2026-02-30, which Date would otherwise roll over into March.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
};

/**
 * The instants a report covers. A preset ends now. A custom range runs from the start of its first day
 * to the end of its last day in the user's time zone, and is cut off at now when it includes today.
 */
export const resolveReportPeriod = (
  period: ReportPeriod,
  custom: { from: string; to: string },
  now: Date = new Date(),
): ResolvedReportPeriod => {
  if (period !== "custom") {
    return { from: new Date(now.getTime() - PRESET_MS[period]), to: now };
  }

  const fromDay = parseLocalDate(custom.from);
  const toDay = parseLocalDate(custom.to);
  if (!fromDay || !toDay) return { error: "REQUIRED" };
  if (fromDay > toDay) return { error: "ORDER" };
  if (fromDay > now) return { error: "FUTURE" };

  const endOfToDay = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);
  const to = endOfToDay > now ? now : endOfToDay;
  if (to.getTime() - fromDay.getTime() > MAX_REPORT_DAYS * DAY_MS) return { error: "TOO_LONG" };

  return { from: fromDay, to };
};

/** File-name-safe slug, same rule as the server's. */
export const slugify = (value: string): string => {
  // Split and join rather than trimming dashes with anchored regexes like /-+$/, which Sonar flags as
  // super-linear backtracking (DoS hotspot). Joining with single dashes never leaves leading,
  // trailing or doubled dashes, so only the cut at 40 characters can leave one at the end.
  let slug = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-")
    .slice(0, 40);
  if (slug.endsWith("-")) slug = slug.slice(0, -1);
  return slug || "monitor";
};

const compactDate = (date: Date) => toDateInputValue(date).replaceAll("-", "");

export const reportFileName = (scope: string, from: Date, to: Date, format: ReportFormat) =>
  `uptime-report_${slugify(scope)}_${compactDate(from)}-${compactDate(to)}.${format}`;

export const REPORT_MIME: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Hands a downloaded file to the browser as a save. */
export const saveFile = (blob: Blob, fileName: string, mime: string) => {
  // Re-typed: the API sends Excel as application/octet-stream (see MonitorController.ExportUptimeReport).
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  const url = URL.createObjectURL(typed);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Deferred: revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

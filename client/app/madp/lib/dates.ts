/** One date-time format for the whole app: "20 Oct 2026, 09:37" in the reader's time zone; "" for anything that is not a date. */
const FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatDateTime(at: string | number | Date | null | undefined): string {
  if (at === null || at === undefined || at === "") return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return FORMAT.format(d);
}

/* Content-free formatting helpers (moved verbatim from the removed static modules). */

export const firstName = (name: string) => name.split(" ")[0];

/** "Good morning", "Good afternoon" or "Good evening", from this computer's clock. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** When the brief was sent, as the scope and the build write their times: "Thu 22 Oct, 10:02". Always the date,
 *  never "today", so it reads the same on every day the project is opened. */
export function sentLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "10:20" from "Thu 22 Oct, 10:20" */
export const timeOf = (at: string) => at.split(", ")[1] ?? at;
/** 15.5 -> "15½ h" */
export const fmtHours = (h: number) => `${Math.floor(h)}${h % 1 ? "½" : ""} h`;
/** Build time as the scope writes it: "11½ h". */
export const hoursLabel = fmtHours;
/** A count with the right word form: plural(1, "file") -> "1 file", plural(3, "file") -> "3 files". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** Only the word for a count: pluralWord(1, "ticket") -> "ticket". */
export const pluralWord = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);
export const joinAnd = (xs: string[]) => (xs.length < 2 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export const clampPct = (p: number) => Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));

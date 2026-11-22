/**
 * Numbers, money, dates and times in the chosen language. English follows the app's existing British style
 * (1,234.50 · 10 Nov 2026 · 14:05); German (Switzerland) the Swiss one (1'234.50 · 10.11.2026 · 14:05) with the
 * apostrophe as the thousands sign (README: "CHF 1'234.50"), not the typographic one some browsers use.
 * Every helper takes the culture as an option and otherwise uses the one in use (call them at render time).
 */
import { getCulture, type Culture } from "./index";

export type Money = "CHF" | "USD";
type DateInput = Date | string | number;

const LOCALE: Record<Culture, string> = { en: "en-GB", "de-CH": "de-CH" };

/** The Swiss thousands sign is the plain apostrophe; some engines answer U+2019. */
const swiss = (s: string) => s.replace(/[’ʼ]/g, "'");

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function numberFormat(culture: Culture, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `n|${culture}|${JSON.stringify(o)}`;
  let f = cache.get(id) as Intl.NumberFormat | undefined;
  if (!f) cache.set(id, (f = new Intl.NumberFormat(LOCALE[culture], o)));
  return f;
}
function dateFormat(culture: Culture, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `d|${culture}|${JSON.stringify(o)}`;
  let f = cache.get(id) as Intl.DateTimeFormat | undefined;
  if (!f) cache.set(id, (f = new Intl.DateTimeFormat(LOCALE[culture], o)));
  return f;
}

/** 1234.5 → "1,234.5" (en) / "1'234.5" (de-CH); `decimals` fixes the digits after the point. */
export function formatNumber(value: number, o: { culture?: Culture; decimals?: number } = {}): string {
  if (!Number.isFinite(value)) return "–";
  const culture = o.culture ?? getCulture();
  const digits = o.decimals === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals };
  return swiss(numberFormat(culture, { ...digits, useGrouping: true }).format(value));
}

/** 1234.5, "CHF" → "CHF 1,234.50" (en) / "CHF 1'234.50" (de-CH): the currency code first, two decimals, a minus
 *  before the code ("-CHF 5.00"). `decimals: 0` for whole amounts. */
export function formatMoney(amount: number, currency: Money = "CHF", o: { culture?: Culture; decimals?: number } = {}): string {
  if (!Number.isFinite(amount)) return "–";
  const decimals = o.decimals ?? 2;
  const figure = formatNumber(Math.abs(amount), { culture: o.culture, decimals });
  return `${amount < 0 && Number(figure.replace(/[^0-9.]/g, "")) !== 0 ? "-" : ""}${currency} ${figure}`;
}

/** 0.125 → "12.5%" (en) / "12.5 %" (de-CH). */
export function formatPercent(share: number, o: { culture?: Culture; decimals?: number } = {}): string {
  if (!Number.isFinite(share)) return "–";
  const culture = o.culture ?? getCulture();
  const value = formatNumber(share * 100, { culture, decimals: o.decimals ?? 0 });
  return culture === "de-CH" ? `${value} %` : `${value}%`;
}

function toDate(d: DateInput): Date | null {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type DateStyle = "short" | "medium" | "long";
const DATE_STYLE: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  // 10.11.2026 / 10/11/2026
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  // 10. Nov. 2026 / 10 Nov 2026
  medium: { day: "numeric", month: "short", year: "numeric" },
  // 10. November 2026 / 10 November 2026
  long: { day: "numeric", month: "long", year: "numeric" },
};

/** A date: "short" 10.11.2026 (de-CH) / 10/11/2026 (en), "medium" (the default) 10. Nov. 2026 / 10 Nov 2026, "long" with
 *  the month written out. An unreadable date is "–". `timeZone` e.g. "UTC" for dates stored as UTC days. */
export function formatDate(d: DateInput, o: { culture?: Culture; style?: DateStyle; timeZone?: string } = {}): string {
  const date = toDate(d);
  if (!date) return "–";
  const culture = o.culture ?? getCulture();
  return dateFormat(culture, { ...DATE_STYLE[o.style ?? "medium"], ...(o.timeZone ? { timeZone: o.timeZone } : {}) }).format(date);
}

/** A time of day on the 24-hour clock: 14:05 (both languages). */
export function formatTime(d: DateInput, o: { culture?: Culture; timeZone?: string; seconds?: boolean } = {}): string {
  const date = toDate(d);
  if (!date) return "–";
  const culture = o.culture ?? getCulture();
  return dateFormat(culture, {
    hour: "2-digit", minute: "2-digit", ...(o.seconds ? { second: "2-digit" } : {}), hourCycle: "h23",
    ...(o.timeZone ? { timeZone: o.timeZone } : {}),
  }).format(date);
}

/** A date with its time: "10.11.2026, 14:05" (de-CH) / "10 Nov 2026, 14:05" (en). */
export function formatDateTime(d: DateInput, o: { culture?: Culture; style?: DateStyle; timeZone?: string } = {}): string {
  const date = toDate(d);
  if (!date) return "–";
  const culture = o.culture ?? getCulture();
  return `${formatDate(date, { culture, style: o.style ?? (culture === "de-CH" ? "short" : "medium"), timeZone: o.timeZone })}, ${formatTime(date, { culture, timeZone: o.timeZone })}`;
}

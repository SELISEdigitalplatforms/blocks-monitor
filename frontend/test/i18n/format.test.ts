// Numbers, money, dates and times per language: Swiss grouping with the plain apostrophe, CHF/USD code first,
// 10.11.2026 in German (Switzerland), the British style in English, the 24-hour clock in both.
import { afterEach, describe, expect, it } from "vitest";
import { resetI18nForTests, setCulture } from "../../src/i18n";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatTime } from "../../src/i18n/format";

afterEach(() => { resetI18nForTests(); });

const D = new Date(Date.UTC(2026, 10, 10, 14, 5, 9));

describe("formatNumber / formatMoney", () => {
  it("groups the Swiss way in de-CH and the English way in en", () => {
    expect(formatNumber(1234567.891, { culture: "de-CH" })).toBe("1'234'567.89");
    expect(formatNumber(1234567.891, { culture: "en" })).toBe("1,234,567.89");
    expect(formatNumber(1234.5, { culture: "de-CH", decimals: 2 })).toBe("1'234.50");
    expect(formatNumber(Number.NaN)).toBe("–");
  });

  it("writes CHF and USD with the code first and two decimals", () => {
    expect(formatMoney(1234.5, "CHF", { culture: "de-CH" })).toBe("CHF 1'234.50");
    expect(formatMoney(1234.5, "USD", { culture: "en" })).toBe("USD 1,234.50");
    expect(formatMoney(-5, "CHF", { culture: "de-CH" })).toBe("-CHF 5.00");
    expect(formatMoney(-0.001, "CHF", { culture: "de-CH" })).toBe("CHF 0.00");
    expect(formatMoney(1200, "CHF", { culture: "de-CH", decimals: 0 })).toBe("CHF 1'200");
  });

  it("uses the language in use when none is given", () => {
    expect(formatMoney(1234.5)).toBe("CHF 1,234.50");
    setCulture("de-CH");
    expect(formatMoney(1234.5)).toBe("CHF 1'234.50");
    expect(formatPercent(0.125, { decimals: 1 })).toBe("12.5 %");
    setCulture("en");
    expect(formatPercent(0.125, { decimals: 1 })).toBe("12.5%");
  });
});

describe("formatDate / formatTime", () => {
  it("writes dates per language", () => {
    expect(formatDate(D, { culture: "de-CH", style: "short", timeZone: "UTC" })).toBe("10.11.2026");
    expect(formatDate(D, { culture: "en", style: "short", timeZone: "UTC" })).toBe("10/11/2026");
    expect(formatDate(D, { culture: "en", timeZone: "UTC" })).toBe("10 Nov 2026");
    expect(formatDate(D, { culture: "de-CH", style: "long", timeZone: "UTC" })).toBe("10. November 2026");
    expect(formatDate("not a date")).toBe("–");
    expect(formatDate(D.toISOString(), { culture: "de-CH", style: "short", timeZone: "UTC" })).toBe("10.11.2026");
  });

  it("writes times on the 24-hour clock in both languages", () => {
    expect(formatTime(D, { culture: "de-CH", timeZone: "UTC" })).toBe("14:05");
    expect(formatTime(D, { culture: "en", timeZone: "UTC" })).toBe("14:05");
    expect(formatTime(D, { culture: "en", timeZone: "UTC", seconds: true })).toBe("14:05:09");
    expect(formatDateTime(D, { culture: "de-CH", timeZone: "UTC" })).toBe("10.11.2026, 14:05");
    expect(formatDateTime(D, { culture: "en", timeZone: "UTC" })).toBe("10 Nov 2026, 14:05");
  });
});

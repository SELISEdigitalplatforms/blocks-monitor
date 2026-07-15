import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatFullDate,
  parseDateString,
  compareDates,
  checkValidDate,
} from "@/utils/date.util";

describe("date.util", () => {
  // Fixed local date: 5 Mar 2023, 09:07
  const d = new Date(2023, 2, 5, 9, 7, 0);

  describe("formatDate", () => {
    it("pads day/month and includes time by default", () => {
      expect(formatDate(d)).toBe("05/03/2023, 09:07");
    });

    it("omits the time when withoutTime is true", () => {
      expect(formatDate(d, true)).toBe("05/03/2023");
    });
  });

  describe("formatFullDate", () => {
    it("uses the month name and includes the time by default", () => {
      expect(formatFullDate(d)).toBe("Mar 05, 2023 at 09:07");
    });

    it("omits the time when withoutTime is true", () => {
      expect(formatFullDate(d, true)).toBe("Mar 05, 2023");
    });

    it("maps every month index to the right abbreviation", () => {
      const dec = new Date(2023, 11, 25, 0, 0, 0);
      expect(formatFullDate(dec, true)).toBe("Dec 25, 2023");
    });
  });

  describe("parseDateString", () => {
    it("parses an ISO string into a Date", () => {
      const parsed = parseDateString("2023-03-05T00:00:00.000Z");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getUTCFullYear()).toBe(2023);
    });
  });

  describe("compareDates", () => {
    it("returns a negative number when A is before B", () => {
      expect(compareDates("2023-01-01", "2023-02-01")).toBeLessThan(0);
    });

    it("returns a positive number when A is after B", () => {
      expect(compareDates("2023-02-01", "2023-01-01")).toBeGreaterThan(0);
    });

    it("returns 0 for equal dates", () => {
      expect(compareDates("2023-01-01", "2023-01-01")).toBe(0);
    });
  });

  describe("checkValidDate", () => {
    it("returns true for a valid recent date", () => {
      expect(checkValidDate("2023-03-05")).toBe(true);
    });

    it("returns false for an invalid date string", () => {
      expect(checkValidDate("not-a-date")).toBe(false);
    });

    it("returns false for dates before 1900-01-01", () => {
      expect(checkValidDate("1899-12-31")).toBe(false);
    });

    it("accepts a Date object input", () => {
      expect(checkValidDate(new Date(2000, 0, 1))).toBe(true);
    });
  });
});

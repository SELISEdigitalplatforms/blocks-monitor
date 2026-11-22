import { describe, expect, it } from "vitest";
import { byNewest, compareNewest, latestTime, timeOf } from "@/lib/newest";

describe("timeOf", () => {
  it("reads ISO texts, epoch milliseconds and Dates; NaN for anything else", () => {
    expect(timeOf("2026-11-11T10:00:00.000Z")).toBe(Date.parse("2026-11-11T10:00:00.000Z"));
    expect(timeOf(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(timeOf(new Date("2026-01-01T00:00:00Z"))).toBe(Date.parse("2026-01-01T00:00:00Z"));
    for (const v of ["", null, undefined, "not a date", Number.NaN, Number.POSITIVE_INFINITY]) expect(timeOf(v)).toBeNaN();
  });
});

describe("latestTime", () => {
  it("is the latest of the dates that are dates", () => {
    expect(latestTime("2026-11-01T00:00:00Z", "", "2026-11-03T00:00:00Z", null, "2026-11-02T00:00:00Z")).toBe(Date.parse("2026-11-03T00:00:00Z"));
    expect(latestTime("", null, undefined)).toBeNaN();
    expect(latestTime()).toBeNaN();
  });
});

describe("byNewest", () => {
  const rows = [
    { id: "a", at: "2026-11-01T10:00:00Z", n: 1 },
    { id: "b", at: "2026-11-03T10:00:00Z", n: 2 },
    { id: "c", at: "", n: 3 },
    { id: "d", at: "2026-11-02T10:00:00Z", n: 4 },
    { id: "e", at: "2026-11-03T10:00:00Z", n: 5 },
  ];

  it("puts the newest on top, the undated last, and breaks a tie by the number, highest first", () => {
    expect(byNewest(rows, (r) => r.at, (r) => r.n).map((r) => r.id)).toEqual(["e", "b", "d", "a", "c"]);
  });

  it("keeps the given order for a tie without a tie-break (stable), and never changes its input", () => {
    const before = rows.map((r) => r.id);
    expect(byNewest(rows, (r) => r.at).map((r) => r.id)).toEqual(["b", "e", "d", "a", "c"]);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("orders mixed date forms on one time line", () => {
    const mixed = [{ id: "iso", at: "2026-11-02T00:00:00Z" as string | number | Date }, { id: "ms", at: Date.parse("2026-11-03T00:00:00Z") }, { id: "date", at: new Date("2026-11-01T00:00:00Z") }];
    expect(byNewest(mixed, (r) => r.at).map((r) => r.id)).toEqual(["ms", "iso", "date"]);
  });

  it("puts a text tie-break in descending order and a missing one last", () => {
    const tied = [{ id: "x1", at: "2026-11-01T00:00:00Z", k: "a" as string | undefined }, { id: "x2", at: "2026-11-01T00:00:00Z", k: undefined }, { id: "x3", at: "2026-11-01T00:00:00Z", k: "c" }];
    expect(byNewest(tied, (r) => r.at, (r) => r.k).map((r) => r.id)).toEqual(["x3", "x1", "x2"]);
  });
});

describe("compareNewest", () => {
  it("sorts the same way as byNewest", () => {
    const rows = [
      { at: "2026-11-01T00:00:00Z", n: 1 }, { at: "", n: 2 }, { at: "2026-11-05T00:00:00Z", n: 3 }, { at: "2026-11-05T00:00:00Z", n: 4 },
    ];
    expect([...rows].sort(compareNewest((r) => r.at, (r) => r.n)).map((r) => r.n)).toEqual(byNewest(rows, (r) => r.at, (r) => r.n).map((r) => r.n));
    expect([...rows].sort(compareNewest((r) => r.at, (r) => r.n)).map((r) => r.n)).toEqual([4, 3, 1, 2]);
  });
});

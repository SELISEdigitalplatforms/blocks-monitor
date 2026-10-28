import { describe, expect, it } from "vitest";
import {
  countMonitors,
  coverageText,
  filterRecipients,
  hasManagedRecipients,
  removedNotice,
  resolveMonitorSourceType,
  sortByEmail,
  storedAllMonitors,
} from "@/components/module/alert-recipients/alert-recipients.utils";
import { MONITORS, recipient } from "./fixtures";

const byId = new Map(MONITORS.map((m) => [m.itemId, m]));

describe("alert-recipients utils", () => {
  it("pluralizes monitor counts", () => {
    expect(countMonitors(1)).toBe("1 monitor");
    expect(countMonitors(0)).toBe("0 monitors");
    expect(countMonitors(3)).toBe("3 monitors");
  });

  it("words the coverage badge so the text carries the meaning (H13)", () => {
    expect(coverageText(5, 0)).toBe("All 5 monitors email someone");
    expect(coverageText(5, 2)).toBe("2 of 5 monitors email no one");
    expect(coverageText(5, 1)).toBe("1 of 5 monitors emails no one");
    expect(coverageText(1, 0)).toBe("The 1 monitor emails someone");
  });

  it("words the removal notice (H7)", () => {
    expect(removedNotice("ops@x.com", 2)).toBe(
      "ops@x.com removed from 2 monitors. They no longer get alert emails.",
    );
    expect(removedNotice("ops@x.com", 1)).toBe(
      "ops@x.com removed from 1 monitor. They no longer get alert emails.",
    );
  });

  it("filters on email and on every monitor name, case-insensitively (H15)", () => {
    const rows = [
      recipient("ali@x.com", ["m1"]),
      recipient("ops@x.com", ["m1", "m2"]),
      recipient("all@x.com", [], { allMonitors: true }),
    ];
    expect(filterRecipients(rows, byId, "").map((r) => r.email)).toHaveLength(3);
    expect(filterRecipients(rows, byId, "  ALI ").map((r) => r.email)).toEqual(["ali@x.com"]);
    expect(filterRecipients(rows, byId, "WEB").map((r) => r.email)).toEqual([
      "ops@x.com",
      "all@x.com",
    ]);
    expect(filterRecipients(rows, byId, "nothing")).toEqual([]);
  });

  it("sorts rows by email", () => {
    const rows = [recipient("b@x.com", []), recipient("a@x.com", [])];
    expect(sortByEmail(rows).map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("sorts ordinal like the server, not by locale (n9)", () => {
    const rows = ["a_b@x.com", "a-b@x.com", "a+b@x.com", "a1@x.com", "a@x.com", "a@x.com"].map(
      (email) => recipient(email, []),
    );
    // Code-unit order: "+" (43) < "-" (45) < "1" (49) < "@" (64) < "_" (95).
    expect(sortByEmail(rows).map((r) => r.email)).toEqual([
      "a+b@x.com",
      "a-b@x.com",
      "a1@x.com",
      "a@x.com",
      "a@x.com",
      "a_b@x.com",
    ]);
  });

  it("prefers the stored All choice over the computed one (Q4)", () => {
    expect(
      storedAllMonitors(recipient("a@x.com", [], { allMonitors: false, allMonitorsChoice: true })),
    ).toBe(true);
    expect(storedAllMonitors({ email: "a@x.com", allMonitors: true, monitorIds: [] })).toBe(true);
  });

  it("resolves the source type from effectiveMonitorSourceType, then monitorSourceType (Q10)", () => {
    expect(resolveMonitorSourceType({ effectiveMonitorSourceType: 2, monitorSourceType: 1 })).toBe(
      2,
    );
    expect(
      resolveMonitorSourceType({ effectiveMonitorSourceType: null, monitorSourceType: 0 }),
    ).toBe(0);
    expect(resolveMonitorSourceType({})).toBeUndefined();
    expect(resolveMonitorSourceType(undefined)).toBeUndefined();
  });

  it("manages recipients for every source except Infrastructure and Blocks services", () => {
    expect([0, 1, 2, 3, 4, undefined].map(hasManagedRecipients)).toEqual([
      false,
      true,
      false,
      true,
      true,
      true,
    ]);
  });
});

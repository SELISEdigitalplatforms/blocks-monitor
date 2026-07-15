import { describe, it, expect } from "vitest";
import { getUniqueID } from "@/utils/id.util.";
import { clearBreadCrumbTitleEntry } from "@/utils/breadcrumb.util";
import { BREADCRUMB_CUSTOM_TITLES } from "@/constants/breadcrumb-custom-title.constant";

describe("getUniqueID", () => {
  it("matches the BLK-<timestamp>-<6 letters> shape", () => {
    expect(getUniqueID()).toMatch(/^BLK-\d+-[A-Z]{6}$/);
  });

  it("produces distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => getUniqueID()));
    expect(ids.size).toBe(50);
  });
});

describe("clearBreadCrumbTitleEntry", () => {
  it("nulls out the custom title for a given route", () => {
    BREADCRUMB_CUSTOM_TITLES["/app/:itemId/monitor/:id"] = "Alert";
    clearBreadCrumbTitleEntry("/app/:itemId/monitor/:id");
    expect(BREADCRUMB_CUSTOM_TITLES["/app/:itemId/monitor/:id"]).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { clearBreadCrumbTitleEntry } from "@/utils/breadcrumb.util";
import { BREADCRUMB_CUSTOM_TITLES } from "@/constants/breadcrumb-custom-title.constant";

describe("clearBreadCrumbTitleEntry", () => {
  it("nulls out the custom title for a given route", () => {
    BREADCRUMB_CUSTOM_TITLES["/app/:itemId/monitor/:id"] = "Alert";
    clearBreadCrumbTitleEntry("/app/:itemId/monitor/:id");
    expect(BREADCRUMB_CUSTOM_TITLES["/app/:itemId/monitor/:id"]).toBeNull();
  });
});

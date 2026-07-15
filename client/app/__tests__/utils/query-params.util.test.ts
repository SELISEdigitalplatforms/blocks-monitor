import { describe, it, expect, beforeEach } from "vitest";
import { clearQueryString } from "@/utils/query-params.util";

describe("clearQueryString", () => {
  beforeEach(() => {
    // Stay same-origin so jsdom permits replaceState.
    window.history.replaceState(
      null,
      "",
      `${window.location.origin}/page?a=1&b=2&c=3`,
    );
  });

  it("removes all query params by default", () => {
    clearQueryString();
    expect(window.location.search).toBe("");
  });

  it("keeps only the params listed in except", () => {
    clearQueryString({ except: ["b"] });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("b")).toBe("2");
    expect(params.get("a")).toBeNull();
    expect(params.get("c")).toBeNull();
  });

  it("ignores except keys that are absent", () => {
    clearQueryString({ except: ["missing"] });
    expect(window.location.search).toBe("");
  });

  it("preserves the pathname", () => {
    clearQueryString();
    expect(window.location.pathname).toBe("/page");
  });
});

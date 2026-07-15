import { describe, it, expect, afterEach, vi } from "vitest";
import { getApiPath, getApiUrl } from "@/lib/get-api-path";

describe("getApiPath", () => {
  it("always returns /api regardless of the service path", () => {
    expect(getApiPath("anything")).toBe("/api");
    expect(getApiPath("")).toBe("/api");
  });
});

describe("getApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    (window as unknown as { __BLOCKS_ENV__?: unknown }).__BLOCKS_ENV__ =
      undefined;
  });

  it("builds a full URL from the runtime base URL and endpoint", () => {
    (window as unknown as { __BLOCKS_ENV__?: unknown }).__BLOCKS_ENV__ = {
      BLOCKS_MONITOR_BASE_URL: "https://api.example.com",
    };
    expect(getApiUrl("svc", "Monitor/List")).toBe(
      "https://api.example.com/api/Monitor/List",
    );
  });

  it("produces /api/<endpoint> when the base URL is empty", () => {
    vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "");
    expect(getApiUrl("svc", "ping")).toBe("/api/ping");
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveEnv } from "@/lib/resolve-env";

const win = window as unknown as { __BLOCKS_ENV__?: Record<string, string> };

describe("resolveEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    win.__BLOCKS_ENV__ = undefined;
  });

  it("replaces placeholder values with import.meta.env values", () => {
    win.__BLOCKS_ENV__ = {
      BLOCKS_MONITOR_BASE_URL: "__BLOCKS_MONITOR_BASE_URL__",
    };
    vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "https://resolved.example.com");

    resolveEnv();

    expect(win.__BLOCKS_ENV__?.BLOCKS_MONITOR_BASE_URL).toBe(
      "https://resolved.example.com",
    );
  });

  it("resolves an unmatched placeholder to an empty string", () => {
    win.__BLOCKS_ENV__ = { SOME_MISSING_KEY: "__BLOCKS_MISSING__" };
    resolveEnv();
    expect(win.__BLOCKS_ENV__?.SOME_MISSING_KEY).toBe("");
  });

  it("leaves non-placeholder values untouched", () => {
    win.__BLOCKS_ENV__ = { BLOCKS_MONITOR_BASE_URL: "https://real.example.com" };
    resolveEnv();
    expect(win.__BLOCKS_ENV__?.BLOCKS_MONITOR_BASE_URL).toBe(
      "https://real.example.com",
    );
  });

  it("no-ops when window.__BLOCKS_ENV__ is undefined", () => {
    win.__BLOCKS_ENV__ = undefined;
    expect(() => resolveEnv()).not.toThrow();
  });
});

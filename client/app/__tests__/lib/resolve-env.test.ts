import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveEnv } from "@seliseblocks/genesis-os/lib";

const win = window as unknown as { __BLOCKS_ENV__?: Record<string, string> };

describe("resolveEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    win.__BLOCKS_ENV__ = undefined;
  });

  it("leaves already-resolved (non-placeholder) values untouched", () => {
    win.__BLOCKS_ENV__ = { BLOCKS_MONITOR_BASE_URL: "https://real.example.com" };
    resolveEnv();
    expect(win.__BLOCKS_ENV__?.BLOCKS_MONITOR_BASE_URL).toBe("https://real.example.com");
  });

  it("ignores values that only partially match the placeholder shape", () => {
    // Requires BOTH a leading `__BLOCKS_` and a trailing `__`; near-misses are
    // left as-is and never routed to build-time resolution.
    win.__BLOCKS_ENV__ = {
      MISSING_SUFFIX: "__BLOCKS_MONITOR_BASE_URL", // no trailing "__"
      MISSING_PREFIX: "MONITOR__", // no leading "__BLOCKS_"
    };
    expect(() => resolveEnv()).not.toThrow();
    expect(win.__BLOCKS_ENV__?.MISSING_SUFFIX).toBe("__BLOCKS_MONITOR_BASE_URL");
    expect(win.__BLOCKS_ENV__?.MISSING_PREFIX).toBe("MONITOR__");
  });

  it("routes only exact __BLOCKS_..__ placeholders to build-time env resolution", () => {
    // An exact placeholder enters the `import.meta.env[key]` branch. That env is
    // not injected into the externalized blocks-kit module under vitest, so the
    // branch is exercised but throws here - proving the guard positively
    // identifies placeholders (a concrete value would have been skipped).
    win.__BLOCKS_ENV__ = {
      BLOCKS_MONITOR_BASE_URL: "__BLOCKS_MONITOR_BASE_URL__",
    };
    expect(() => resolveEnv()).toThrow();
  });

  it("no-ops when window.__BLOCKS_ENV__ is undefined", () => {
    win.__BLOCKS_ENV__ = undefined;
    expect(() => resolveEnv()).not.toThrow();
  });
});

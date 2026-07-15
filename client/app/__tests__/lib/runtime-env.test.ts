import { describe, it, expect, afterEach, vi } from "vitest";
import { getRuntimeEnv } from "@/lib/runtime-env";

const setBlocksEnv = (env: Record<string, string> | undefined) => {
  (window as unknown as { __BLOCKS_ENV__?: unknown }).__BLOCKS_ENV__ = env;
};

describe("getRuntimeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setBlocksEnv(undefined);
  });

  it("prefers a real value from window.__BLOCKS_ENV__", () => {
    setBlocksEnv({ BLOCKS_MONITOR_BASE_URL: "https://from-window.com" });
    expect(getRuntimeEnv("BLOCKS_MONITOR_BASE_URL")).toBe(
      "https://from-window.com",
    );
  });

  it("ignores placeholder window values and falls back to import.meta.env", () => {
    setBlocksEnv({ BLOCKS_MONITOR_BASE_URL: "__BLOCKS_MONITOR_BASE_URL__" });
    vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "https://from-import.com");
    expect(getRuntimeEnv("BLOCKS_MONITOR_BASE_URL")).toBe(
      "https://from-import.com",
    );
  });

  it("returns an empty string when neither source has a value", () => {
    setBlocksEnv(undefined);
    vi.stubEnv("BLOCKS_IAM_BASE_URL", "");
    expect(getRuntimeEnv("BLOCKS_IAM_BASE_URL")).toBe("");
  });

  it("appends a trailing slash when requested and missing", () => {
    setBlocksEnv({ BLOCKS_IAM_BASE_URL: "https://iam.example.com" });
    expect(
      getRuntimeEnv("BLOCKS_IAM_BASE_URL", { ensureTrailingSlash: true }),
    ).toBe("https://iam.example.com/");
  });

  it("does not double up an existing trailing slash", () => {
    setBlocksEnv({ BLOCKS_IAM_BASE_URL: "https://iam.example.com/" });
    expect(
      getRuntimeEnv("BLOCKS_IAM_BASE_URL", { ensureTrailingSlash: true }),
    ).toBe("https://iam.example.com/");
  });

  it("does not add a trailing slash to an empty value", () => {
    setBlocksEnv(undefined);
    vi.stubEnv("BLOCKS_IAM_BASE_URL", "");
    expect(
      getRuntimeEnv("BLOCKS_IAM_BASE_URL", { ensureTrailingSlash: true }),
    ).toBe("");
  });

  it("leaves the port intact when running locally", () => {
    setBlocksEnv({ BLOCKS_MONITOR_BASE_URL: "https://host.example.com:8443" });
    // jsdom default hostname is localhost, so isLocalEnv() is true.
    expect(
      getRuntimeEnv("BLOCKS_MONITOR_BASE_URL", { stripPort: true }),
    ).toBe("https://host.example.com:8443");
  });
});

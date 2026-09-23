import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeEnv } from "@seliseblocks/genesis-os/lib";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Blocks Monitor browser API origin", () => {
  it("uses the preview page origin even when the configured URL points elsewhere", () => {
    const configuredUrl = "https://shared-monitor.example.com";
    const previewOrigin = "https://preview-monitor.example.com:8443";
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const servedHtml = html.replaceAll("__BLOCKS_MONITOR_BASE_URL__", configuredUrl);
    const dom = new JSDOM(servedHtml, {
      url: `${previewOrigin}/monitors`,
      runScripts: "dangerously",
    });

    vi.stubEnv("BLOCKS_MONITOR_BASE_URL", configuredUrl);
    vi.stubGlobal("window", dom.window);

    const previewWindow = dom.window as typeof dom.window & {
      __BLOCKS_ENV__: Record<string, string>;
      process?: { env: Record<string, string> };
    };
    expect(previewWindow.__BLOCKS_ENV__.BLOCKS_MONITOR_BASE_URL).toBe(previewOrigin);
    expect(getRuntimeEnv("BLOCKS_MONITOR_BASE_URL")).toBe(previewOrigin);

    // Genesis exposes the same bootstrap object to consumers that read window.process.env.
    previewWindow.process = { env: previewWindow.__BLOCKS_ENV__ };
    expect(previewWindow.process.env.BLOCKS_MONITOR_BASE_URL).toBe(previewOrigin);

    dom.window.close();
  });
});

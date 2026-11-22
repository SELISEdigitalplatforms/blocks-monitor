import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { args: string[]; options: any }[]);
vi.mock("../../server/local/engine/ai/runnerProcess.ts", () => ({
  execRunner: (_binary: string, args: string[], options: any, callback: (error: unknown, out: string) => void) => {
    calls.push({ args, options });
    queueMicrotask(() => callback(null, args.includes("--version") ? "2.1.259 (Claude Code)" : JSON.stringify({ type: "result", subtype: "success", structured_output: { status: "ready" } })));
    return { stdin: { on: vi.fn(), end: vi.fn() } };
  },
}));
import { claudeRunner } from "../../server/local/engine/ai/claude";

let root: string;
let mcpConfig: string;
let authDirectory: string;
beforeEach(() => {
  calls.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "figma-runner-"));
  mcpConfig = path.join(root, "mcp.json");
  authDirectory = path.join(root, "auth");
  fs.mkdirSync(authDirectory);
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("unattended Make subprocess", () => {
  it("can reuse a configured profile without imposing a sandbox or new deployment flags", async () => {
    vi.stubEnv("FIGMA_API_TOKEN", "fake-token");
    vi.stubEnv("MF_SVC_CLIENT_SECRET", "fake-secret");
    for (const job of ["job-1", "job-2"]) {
      await claudeRunner({ system: "Check", prompt: "Check", schema: {}, timeoutMs: 1000,
        makeSession: { directory: path.join(root, job), mcpConfig, authDirectory, maxBudgetUsd: 2, maxTurns: 10 } });
    }
    const runs = calls.filter((c) => c.args.includes("--print"));
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.options.env.CLAUDE_CONFIG_DIR).toBe(authDirectory);
      expect(run.options.env.FIGMA_API_TOKEN).toBeUndefined();
      expect(run.options.env.MF_SVC_CLIENT_SECRET).toBeUndefined();
      expect(run.args).not.toContain("--restricted");
      expect(run.args).toContain("dontAsk");
      expect(run.args).not.toContain("--permission-prompts");
      expect(run.args).not.toContain("bypassPermissions");
      expect(run.args[run.args.indexOf("--max-budget-usd") + 1]).toBe("2");
      expect(run.args[run.args.indexOf("--max-turns") + 1]).toBe("10");
      const settings = JSON.parse(run.args[run.args.indexOf("--settings") + 1]);
      expect(settings.sandbox).toBeUndefined();
      expect(settings.disableAllHooks).toBe(true);
    }
  });
  it("inherits the existing engine identity and passes only the configured Figma OAuth environment credential", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", authDirectory);
    vi.stubEnv("FIGMA_OAUTH_TOKEN", "example-fake-oauth");
    vi.stubEnv("MF_SVC_CLIENT_SECRET", "fake-secret");
    await claudeRunner({ system: "Check", prompt: "Check", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "existing-engine"), mcpConfig } });
    const run = calls.find((c) => c.args.includes("--print"))!;
    expect(run.options.env.CLAUDE_CONFIG_DIR).toBe(authDirectory);
    expect(run.options.env.FIGMA_OAUTH_TOKEN).toBe("example-fake-oauth");
    expect(run.options.env.MF_SVC_CLIENT_SECRET).toBeUndefined();
    calls.length = 0;
    await claudeRunner({ system: "Other writer", prompt: "Check", schema: {}, timeoutMs: 1000 });
    expect(calls[0].options.env.FIGMA_OAUTH_TOKEN).toBeUndefined();
  });
  it("runs a designer session and the screen review on their own model and effort; other calls keep the engine's", async () => {
    vi.stubEnv("MF_ENGINE_AI_MODEL", "");
    vi.stubEnv("MF_ENGINE_AI_EFFORT", "");
    const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
    await claudeRunner({ system: "Draw", prompt: "Draw", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "draw"), mcpConfig, model: "opus", effort: "high", maxBudgetUsd: 25, maxTurns: 200 } });
    let run = calls.find((c) => c.args.includes("--print"))!;
    expect([arg(run.args, "--model"), arg(run.args, "--effort"), arg(run.args, "--max-turns"), arg(run.args, "--max-budget-usd")]).toEqual(["opus", "high", "200", "25"]);
    calls.length = 0;
    await claudeRunner({ system: "Review", prompt: "Review", schema: {}, timeoutMs: 1000, model: "opus", effort: "high",
      images: [{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]), label: "screen.png" }] });
    run = calls.find((c) => c.args.includes("--print"))!;
    expect([arg(run.args, "--model"), arg(run.args, "--effort"), arg(run.args, "--tools")]).toEqual(["opus", "high", ""]);
    expect(run.args).not.toContain("--max-turns");
    calls.length = 0;
    await claudeRunner({ system: "Other writer", prompt: "Check", schema: {}, timeoutMs: 1000 });
    expect([arg(calls[0].args, "--model"), arg(calls[0].args, "--effort")]).toEqual(["sonnet", "low"]);
  });
  it("allows only whoami during the preflight, with no local file or shell tools", async () => {
    await claudeRunner({ system: "Read-only", prompt: "Check", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "probe"), mcpConfig, authDirectory, readOnly: true } });
    const run = calls.find((c) => c.args.includes("--print"))!;
    expect(run.args[run.args.indexOf("--tools") + 1]).toBe("");
    expect(run.args[run.args.indexOf("--allowedTools") + 1]).toBe("mcp__figma__whoami");
  });
});


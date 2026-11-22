import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { args: string[]; options: any; input?: string }[]);
vi.mock("../../server/local/engine/ai/runnerProcess.ts", () => ({
  execRunner: (_binary: string, args: string[], options: any, callback: (error: unknown) => void) => {
    const call = { args, options, input: "" };
    calls.push(call);
    return { stdin: { on: vi.fn(), end: (input: string) => {
      call.input = input;
      fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ status: "ready" }));
      queueMicrotask(() => callback(null));
    } } };
  },
}));
import { codexMakeRunner } from "../../server/local/engine/ai/codex";
import { makeRunner, makeRunnerBinary, makeRunnerProvider } from "../../server/local/engine/ai/makeRunner";

let root: string;
let config: string;
beforeEach(() => {
  calls.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "figma-codex-"));
  config = path.join(root, "figma.json");
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Figma on the existing Codex engine", () => {
  it("allows an explicit Figma runner without changing the engine or extraction runner", () => {
    expect(makeRunnerProvider({})).toBe("claude");
    expect(makeRunnerProvider({ AI_RUNNER: "codex" })).toBe("codex");
    expect(makeRunnerProvider({ AI_RUNNER: "claude", MF_ENGINE_FIGMA_RUNNER: "codex", MF_EXTRACTION_RUNNER: "claude" })).toBe("codex");
    expect(makeRunnerProvider({ AI_RUNNER: "codex", MF_ENGINE_FIGMA_RUNNER: "claude" })).toBe("claude");
    expect(makeRunnerProvider({ AI_RUNNER: "C:\\Tools\\codex.exe" })).toBe("codex");
    expect(makeRunnerBinary({ AI_RUNNER: "claude", AI_RUNNER_BINARY: "custom-claude" })).toBe("custom-claude");
    expect(makeRunnerBinary({ AI_RUNNER: "/tools/codex" })).toBe("/tools/codex");
    expect(() => makeRunnerProvider({ AI_RUNNER: "opencode" })).toThrow(/no Figma Make adapter/);
    expect(makeRunnerProvider({ AI_RUNNER: "antigravity" })).toBe("antigravity");
    expect(makeRunnerProvider({ AI_RUNNER: "agy" })).toBe("antigravity");
    expect(typeof makeRunner({ AI_RUNNER: "antigravity" })).toBe("function");
    expect(typeof makeRunner({ AI_RUNNER: "agy" })).toBe("function");
  });
  it("uses existing Codex auth, only the official MCP, and schema-constrained exec output", async () => {
    vi.stubEnv("CODEX_HOME", path.join(root, "existing-profile"));
    vi.stubEnv("MF_SVC_CLIENT_SECRET", "not-a-real-secret");
    const result = await codexMakeRunner({ system: "Planner", prompt: "Requirements", schema: { type: "object" }, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "job"), mcpConfig: config } });
    expect(result).toEqual({ status: "ready" });
    const call = calls[0];
    expect(call.args[0]).toBe("exec");
    expect(call.args).toContain("--ignore-user-config");
    expect(call.args).toContain('mcp_servers.figma.url="https://mcp.figma.com/mcp"');
    expect(call.args).toContain("mcp_servers.figma.required=true");
    expect(call.args).toContain("mcp_servers.figma.startup_timeout_sec=30");
    expect(call.options.env.CODEX_HOME).toBe(path.join(root, "existing-profile"));
    expect(call.options.env.MF_SVC_CLIENT_SECRET).toBeUndefined();
    expect(call.input).toContain("Planner");
  });
  it("passes config credentials only through the child environment, never command arguments or prompts", async () => {
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp", headers: { Authorization: "Bearer example-private-token" } } } }));
    await codexMakeRunner({ system: "Check", prompt: "Check", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "job"), mcpConfig: config } });
    expect(calls[0].options.env.FIGMA_OAUTH_TOKEN).toBe("example-private-token");
    expect(calls[0].args.join(" ")).not.toContain("example-private-token");
    expect(calls[0].input).not.toContain("example-private-token");
    const shellPolicy = calls[0].args.find((arg) => arg.startsWith("shell_environment_policy.set="));
    expect(shellPolicy).toBeDefined();
    expect(shellPolicy).not.toMatch(/FIGMA|OPENAI|CODEX_HOME|MF_SVC_CLIENT_SECRET/);
  });
  it("preflight exposes only whoami and disables shell tools", async () => {
    await codexMakeRunner({ system: "Check", prompt: "Check", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "probe"), mcpConfig: config, readOnly: true } });
    expect(calls[0].args).toContain('mcp_servers.figma.enabled_tools=["whoami"]');
    expect(calls[0].args).toContain("shell_tool");
    expect(calls[0].args).toContain("unified_exec");
  });
  it("catalog inspection keeps shell tools disabled but exposes Figma schemas", async () => {
    await codexMakeRunner({ system: "Inspect schemas only; never invoke remote tools", prompt: "Inspect", schema: {}, timeoutMs: 1000,
      makeSession: { directory: path.join(root, "probe"), mcpConfig: config, readOnly: true, inspectCapabilities: true } });
    expect(calls[0].args).not.toContain('mcp_servers.figma.enabled_tools=["whoami"]');
    expect(calls[0].args).toContain("shell_tool");
    expect(calls[0].args).toContain("unified_exec");
  });
});


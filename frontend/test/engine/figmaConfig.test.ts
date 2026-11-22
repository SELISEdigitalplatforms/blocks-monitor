import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertFigmaWriteAvailable, claimFigmaWrite, finishFigmaWrite, figmaDesignerModel, figmaEngineConfig, reserveFigmaIteration, validateFigmaMcp } from "../../server/local/engine/ai/figmaConfig";
import { runnerEnvironment } from "../../server/api/extraction/runnerContract";

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "figma-config-"));
  for (const name of ["auth", "state"]) fs.mkdirSync(path.join(root, name));
  const mcp = path.join(root, "figma.json");
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }));
  env = { MF_ENGINE_FIGMA_ENABLED: "1", MF_ENGINE_FIGMA_MCP_CONFIG: mcp,
    MF_ENGINE_FIGMA_AUTH_DIR: path.join(root, "auth"), MF_ENGINE_FIGMA_STATE_DIR: path.join(root, "state") };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("production Figma admission", () => {
  it("requires an explicit import workflow and separate operator approval", () => {
    expect(figmaEngineConfig(env)).toMatchObject({ workflow: "import", importApproved: false });
    expect(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_WORKFLOW: "import", MF_ENGINE_FIGMA_IMPORT_APPROVED: "1" }))
      .toMatchObject({ workflow: "import", importApproved: true, creditsApproved: false });
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_WORKFLOW: "fallback" })).toThrow("agent or import");
  });
  it("keeps paid-iteration approval operator-owned and off by default", () => {
    expect(figmaEngineConfig(env).creditsApproved).toBe(false);
    expect(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_CREDITS_APPROVED: "true" }).creditsApproved).toBe(false);
    expect(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_CREDITS_APPROVED: "1" }).creditsApproved).toBe(true);
  });
  it("uses the current engine identity and storage without requiring a separate profile or deployment", () => {
    expect(figmaEngineConfig(env).dailyIterations).toBe(5);
    const inherited = figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_AUTH_DIR: "", MF_ENGINE_FIGMA_STATE_DIR: "", MF_ENGINE_ROOT: root });
    expect(inherited.authDirectory).toBeUndefined();
    expect(inherited.stateDirectory).toBe(path.join(root, "figma-state"));
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_AUTH_DIR: "relative-profile" })).toThrow(/optional/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_STATE_DIR: env.MF_ENGINE_FIGMA_AUTH_DIR })).toThrow(/separate/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_ENABLED: "true" })).toThrow(/not connected/);
  });
  it("rejects executable servers, invalid credential headers, unrelated servers and lookalike endpoints", () => {
    for (const servers of [
      { figma: { command: "npx", args: ["figma"] } },
      { figma: { type: "http", url: "https://mcp.figma.com/mcp", headers: { Authorization: "not-a-real-token" } } },
      { figma: { type: "http", url: "https://mcp.figma.com.evil.test/mcp" } },
      { figma: { type: "http", url: "https://mcp.figma.com/mcp" }, other: { command: "anything" } },
    ]) {
      fs.writeFileSync(env.MF_ENGINE_FIGMA_MCP_CONFIG!, JSON.stringify({ mcpServers: servers }));
      expect(() => validateFigmaMcp(env.MF_ENGINE_FIGMA_MCP_CONFIG!)).toThrow(/official/);
    }
  });
  it("enforces atomic daily admission, survives restarts, and does not charge the same recovered job twice", () => {
    env.MF_ENGINE_FIGMA_MAX_ITERATIONS_PER_DAY = "2";
    const now = new Date("2026-11-01T10:00:00Z");
    reserveFigmaIteration(figmaEngineConfig(env), "job-1", now);
    reserveFigmaIteration(figmaEngineConfig(env), "job-1", now);
    reserveFigmaIteration(figmaEngineConfig(env), "job-2", now);
    expect(() => reserveFigmaIteration(figmaEngineConfig(env), "job-3", now)).toThrow(/daily iteration limit/);
    expect(() => reserveFigmaIteration(figmaEngineConfig(env), "job-3", new Date("2026-11-02T00:00:00Z"))).not.toThrow();
  });
  it("rejects malformed budgets rather than silently disabling limits", () => {
    for (const value of ["0", "NaN", "1.5", "-1"]) expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_ITERATIONS_PER_DAY: value })).toThrow(/limits/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_BUDGET_USD: "Infinity" })).toThrow(/limits/);
  });
  it("blocks new jobs across restarts until uncertain remote work is recovered", () => {
    const config = figmaEngineConfig(env);
    claimFigmaWrite(config, "workspace:project:brief", "old-job", "source");
    expect(() => assertFigmaWriteAvailable(figmaEngineConfig(env), "workspace:project:brief", "new-job")).toThrow(/recovery/);
    expect(() => finishFigmaWrite(config, "workspace:project:brief", "new-job")).toThrow(/recovery/);
    expect(() => assertFigmaWriteAvailable(config, "workspace:project:brief", "old-job")).not.toThrow();
    finishFigmaWrite(config, "workspace:project:brief", "old-job");
    expect(() => claimFigmaWrite(config, "workspace:project:brief", "new-job", "source-2")).not.toThrow();
    expect(() => claimFigmaWrite(config, "different-project:brief", "another-job", "source")).not.toThrow();
  });
  it("accepts server-side Bearer credentials directly or referenced from the engine environment", () => {
    for (const token of ["Bearer example-not-a-real-token", "Bearer ${FIGMA_OAUTH_TOKEN}"]) {
      fs.writeFileSync(env.MF_ENGINE_FIGMA_MCP_CONFIG!, JSON.stringify({ mcpServers: { figma: {
        type: "http", url: "https://mcp.figma.com/mcp", headers: { Authorization: token },
      } } }));
      expect(() => validateFigmaMcp(env.MF_ENGINE_FIGMA_MCP_CONFIG!)).not.toThrow();
    }
  });
  it("never passes Figma personal tokens or Blocks secrets into the model subprocess", () => {
    const sanitized = runnerEnvironment("claude", { PATH: "bin", FIGMA_API_TOKEN: "fake", MF_SVC_CLIENT_SECRET: "fake", CLAUDE_CONFIG_DIR: "profile" });
    expect(sanitized).toEqual({ PATH: "bin", CLAUDE_CONFIG_DIR: "profile" });
  });
});

describe("the screen designer's model, effort and limits", () => {
  it("draws with the strongest model at high effort, 120 turns and a $15 cap per session by default", () => {
    expect(figmaEngineConfig(env)).toMatchObject({ model: "opus", modelSet: false, effort: "high", maxTurns: 120, maxBudgetUsd: 15 });
    expect(figmaEngineConfig(env).timeoutMinutes).toBeUndefined();
  });
  it("takes the operator's model, effort, turn, budget and time settings", () => {
    const c = figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MODEL: "claude-opus-5-5", MF_ENGINE_FIGMA_EFFORT: "XHIGH", MF_ENGINE_FIGMA_MAX_TURNS: "300",
      MF_ENGINE_FIGMA_MAX_BUDGET_USD: "25", MF_ENGINE_FIGMA_TIMEOUT_MINUTES: "90" });
    expect(c).toMatchObject({ model: "claude-opus-5-5", modelSet: true, effort: "xhigh", maxTurns: 300, maxBudgetUsd: 25, timeoutMinutes: 90 });
    expect(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MODEL: "opus[1m]" }).model).toBe("opus[1m]");
    expect(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_TURNS: "200" }).maxTurns).toBe(200);
  });
  it("rejects an unknown effort, an odd model name and limits out of range plainly", () => {
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_EFFORT: "extreme" })).toThrow(/effort must be one of low, medium, high, xhigh, max/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MODEL: "opus; rm -rf /" })).toThrow(/model name is invalid/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_TURNS: "401" })).toThrow(/turn limits are invalid/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_TURNS: "0" })).toThrow(/turn limits are invalid/);
    expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MAX_BUDGET_USD: "500" })).toThrow(/model-budget/);
    for (const t of ["4", "241", "12.5", "soon"]) expect(() => figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_TIMEOUT_MINUTES: t })).toThrow(/time limit/);
  });
  it("gives Claude the model and effort, and another runner a model only when the operator named one", () => {
    const c = figmaEngineConfig(env);
    expect(figmaDesignerModel(c, "claude")).toEqual({ model: "opus", effort: "high" });
    expect(figmaDesignerModel(c, "codex")).toEqual({});
    expect(figmaDesignerModel(figmaEngineConfig({ ...env, MF_ENGINE_FIGMA_MODEL: "gpt-5.5" }), "codex")).toEqual({ model: "gpt-5.5" });
    expect(figmaDesignerModel({}, "claude")).toEqual({});
  });
});

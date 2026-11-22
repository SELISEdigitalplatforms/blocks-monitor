import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { existsSync } from "node:fs";
import { callAI, currentRunner, diagnoseExtractionRunner, runnerCapabilities } from "../../server/api/extraction/aiRunner.ts";
import { callClaudeRunner, claudeInputMessage, parseClaudeResult } from "../../server/api/extraction/claudeRunner.ts";
import { runnerEnvironment } from "../../server/api/extraction/runnerContract.ts";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: exec }));
vi.mock("../../server/local/engine/ai/runnerProcess.ts", () => ({ execRunner: exec }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("provider-independent extraction dispatch", () => {
  it("advertises implemented capabilities, not capabilities of an unknown CLI", () => {
    expect(runnerCapabilities("claude").images).toContain("image/png");
    expect(runnerCapabilities("codex").images).toContain("image/png");
    expect(runnerCapabilities("other-cli")).toEqual({ images: [], schemaConstrainedOutput: false });
  });

  it("preserves inherited runner selection when local selection is blank", () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", ""); vi.stubEnv("AI_RUNNER", "aider");
    expect(currentRunner()).toBe("aider");
  });

  it("preserves the legacy default, without detecting and switching to another provider", () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", ""); vi.stubEnv("AI_RUNNER", "");
    expect(currentRunner()).toBe("claude");
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects unsupported image runners without trying Codex or Claude", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "other-cli");
    await expect(callAI("analyze", { image: { buffer: Buffer.from("image"), mimeType: "image/png" } })).rejects.toThrow("no provider fallback");
    expect(exec).not.toHaveBeenCalled();
  });

  it("keeps a legacy stdin text runner usable", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "custom-cli"); vi.stubEnv("MF_EXTRACTION_BINARY", "custom-native.exe");
    let prompt = "";
    exec.mockImplementation((binary, args, _options, cb) => {
      expect(binary).toBe("custom-native.exe"); expect(args).toEqual([]);
      const stdin = new PassThrough(); stdin.on("data", chunk => { prompt += chunk.toString(); });
      queueMicrotask(() => cb(null, '{"summary":"text"}', "")); return { stdin };
    });
    expect(await callAI("text prompt")).toBe('{"summary":"text"}');
    expect(prompt).toBe("text prompt");
  });
});

describe("Claude extraction adapter", () => {
  it("encodes actual image bytes, not a file-metadata placeholder", () => {
    const result = JSON.parse(claudeInputMessage("analyze", { image: { buffer: Buffer.from("image bytes"), mimeType: "image/png" } }));
    expect(result.type).toBe("user");
    expect(result.message.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("image bytes").toString("base64") } });
    expect(result.message.content[1].text).toContain("untrusted evidence");
  });

  it("uses native executable, structured output, disabled tools/MCP/hooks, and cleans the workspace", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "claude"); vi.stubEnv("MF_EXTRACTION_CLAUDE_BINARY", "native-claude.exe");
    vi.stubEnv("AI_RUNNER", "codex");
    let dir = "", stdinText = "";
    exec.mockImplementation((binary, args, options, cb) => {
      expect(binary).toBe("native-claude.exe");
      expect(args[args.indexOf("--tools") + 1]).toBe("");
      expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
      expect(args[args.indexOf("--settings") + 1]).toBe('{"disableAllHooks":true}');
      expect(args).toContain("--no-session-persistence"); expect(args).toContain("--json-schema");
      expect(args).not.toContain("--dangerously-skip-permissions");
      dir = options.cwd;
      const stdin = new PassThrough(); stdin.on("data", chunk => { stdinText += chunk.toString(); });
      queueMicrotask(() => cb(null, JSON.stringify({ type: "result", subtype: "success", structured_output: { summary: "image facts" }, result: "ignore wrapper prose" }), ""));
      return { stdin };
    });
    expect(await callAI("analyze", { image: { buffer: Buffer.from("image"), mimeType: "image/png" }, outputSchema: { type: "object" } })).toBe('{"summary":"image facts"}');
    expect(JSON.parse(stdinText).message.content[0].type).toBe("image");
    expect(existsSync(dir)).toBe(false);
    expect(process.env.AI_RUNNER).toBe("codex");
  });

  it("excludes other-provider and application credentials", () => {
    expect(runnerEnvironment("claude", { PATH: "bin", MF_SVC_CLIENT_SECRET: "private", OPENAI_API_KEY: "other", CLAUDE_CODE_OAUTH_TOKEN: "chosen", CLAUDECODE: "nested" }))
      .toEqual({ PATH: "bin", CLAUDE_CODE_OAUTH_TOKEN: "chosen" });
    expect(runnerEnvironment("codex", { ANTHROPIC_API_KEY: "other", OPENAI_API_KEY: "chosen" })).toEqual({ OPENAI_API_KEY: "chosen" });
  });

  it("propagates missing Claude and never falls back to another provider", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "claude");
    exec.mockImplementation((_binary, _args, _options, cb) => {
      queueMicrotask(() => cb(Object.assign(new Error("private diagnostic"), { code: "ENOENT" })));
      return { stdin: new PassThrough() };
    });
    await expect(callAI("analyze")).rejects.toThrow("Claude executable not found");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("rejects error envelopes and missing structured output", () => {
    expect(() => parseClaudeResult('{"type":"result","is_error":true}', true)).toThrow("did not complete");
    expect(() => parseClaudeResult('{"type":"result","subtype":"success","result":"not structured"}', true)).toThrow("no structured");
  });

  it("supports text responses and rejects empty responses", () => {
    expect(parseClaudeResult('{"type":"result","subtype":"success","result":"text"}', false)).toBe("text");
    expect(() => parseClaudeResult('{"type":"result","result":""}', false)).toThrow("empty");
  });

  it("rejects unsupported image formats before launch", async () => {
    await expect(callClaudeRunner("analyze", { image: { buffer: Buffer.from("svg"), mimeType: "image/svg+xml" } })).rejects.toThrow("Unsupported image");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("read-only extraction preflight", () => {
  it("checks required flags without a model request or auth-success claim", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "codex");
    exec.mockImplementation((_binary, args, _options, cb) => {
      expect(args).toEqual(["exec", "--help"]);
      cb(null, "--image --output-schema --output-last-message --ignore-user-config --disable");
    });
    const status = await diagnoseExtractionRunner();
    expect(status.interfaceCompatible).toBe(true);
    expect(status.authentication).toBe("not checked");
  });

  it("warns about incompatible CLI flags", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "claude");
    exec.mockImplementation((_binary, _args, _options, cb) => cb(null, "old CLI help"));
    const status = await diagnoseExtractionRunner();
    expect(status.available).toBe(true); expect(status.interfaceCompatible).toBe(false);
    expect(status.missingFlags).toContain("--json-schema");
  });

  it("reports a missing runner without choosing another one", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "claude");
    exec.mockImplementation((_binary, _args, _options, cb) => cb(new Error("missing"), ""));
    const status = await diagnoseExtractionRunner();
    expect(status.available).toBe(false); expect(status.runner).toBe("claude");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});


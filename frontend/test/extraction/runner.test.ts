import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { existsSync, writeFileSync } from "node:fs";
import { callCodex, extractionEnvironment } from "../../server/api/extraction/codexRunner.ts";
import { callAI, currentRunner } from "../../server/api/extraction/aiRunner.ts";
import { normalizeExtraction } from "../../server/api/extraction/normalize.ts";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: exec }));
vi.mock("../../server/local/engine/ai/runnerProcess.ts", () => ({ execRunner: exec }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("local extraction runner", () => {
  it("selects extraction configuration without changing the engine runner", () => {
    vi.stubEnv("AI_RUNNER", "claude");
    vi.stubEnv("MF_EXTRACTION_RUNNER", "codex");
    expect(currentRunner()).toBe("codex");
    expect(process.env.AI_RUNNER).toBe("claude");
  });

  it("does not pass application secrets or nested sessions to Codex", () => {
    expect(extractionEnvironment({ Path: "binary-dir", MF_SVC_CLIENT_SECRET: "hidden", GITHUB_CLIENT_SECRET: "hidden", CLAUDECODE: "nested", OPENAI_API_KEY: "provider-key" }))
      .toEqual({ Path: "binary-dir", OPENAI_API_KEY: "provider-key" });
  });

  it("passes image bytes, constrains execution and reads only the final message", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "codex");
    vi.stubEnv("MF_EXTRACTION_CODEX_BINARY", "native-codex.exe");
    let workingDir = "";
    exec.mockImplementation((binary, args, options, cb) => {
      expect(binary).toBe("native-codex.exe");
      expect(args).toContain("--image");
      expect(args).toContain("--output-schema");
      expect(args).toContain("--ignore-user-config");
      expect(args).toContain("read-only");
      expect(args).toContain("shell_tool");
      expect(args).toContain("unified_exec");
      expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      workingDir = options.cwd;
      expect(existsSync(args[args.indexOf("--image") + 1])).toBe(true);
      writeFileSync(args[args.indexOf("--output-last-message") + 1], '{"summary":"visible text"}');
      queueMicrotask(() => cb(null, "unrelated JSONL events", ""));
      return { stdin: new PassThrough() };
    });
    expect(await callAI("analyze", { image: { buffer: Buffer.from("test"), mimeType: "image/png" }, outputSchema: { type: "object" } })).toBe('{"summary":"visible text"}');
    expect(existsSync(workingDir)).toBe(false);
  });

  it("rejects missing Codex instead of returning a fake JSON response and cleans up", async () => {
    let workingDir = "";
    exec.mockImplementation((_binary, _args, options, cb) => {
      workingDir = options.cwd;
      queueMicrotask(() => cb(Object.assign(new Error("sensitive raw details"), { code: "ENOENT" })));
      return { stdin: new PassThrough() };
    });
    await expect(callCodex("private input")).rejects.toThrow("executable not found");
    expect(existsSync(workingDir)).toBe(false);
  });

  it("rejects unsupported image formats before running a process", async () => {
    await expect(callCodex("analyze", { image: { buffer: Buffer.from("svg"), mimeType: "image/svg+xml" } })).rejects.toThrow("Unsupported image format");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("findings validation", () => {
  const valid = { summary: "A login screen", observations: [{ id: "OBS-001", kind: "ui_element", text: "Sign in button", location: "image:center" }], candidateRequirements: [{ text: "Support sign-in", basis: "inferred", evidenceRefs: ["OBS-001"] }], openQuestions: [], warnings: [] };
  const normalize = (response: string) => normalizeExtraction("content", "file-1", "image", "test.png", undefined, async () => response);
  it("accepts structured findings", async () => {
    expect((await normalize(JSON.stringify(valid))).candidateRequirements).toHaveLength(1);
  });
  it("propagates runner failure", async () => {
    await expect(normalizeExtraction("text", "file", "text", "test.txt", undefined, async () => { throw new Error("runner unavailable"); })).rejects.toThrow("runner unavailable");
  });
  it("rejects malformed JSON", async () => { await expect(normalize("runner not found")).rejects.toThrow(); });
  it("rejects incomplete contract", async () => { await expect(normalize('{"summary":"incomplete"}')).rejects.toThrow("findings contract"); });
  it("rejects fabricated evidence references", async () => {
    await expect(normalize(JSON.stringify({ ...valid, candidateRequirements: [{ ...valid.candidateRequirements[0], evidenceRefs: ["missing"] }] }))).rejects.toThrow("evidence references");
  });
});


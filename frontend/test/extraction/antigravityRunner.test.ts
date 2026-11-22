import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { callAI, currentRunner, diagnoseExtractionRunner, runnerCapabilities } from "../../server/api/extraction/aiRunner.ts";
import { parseAntigravityResult } from "../../server/api/extraction/antigravityRunner.ts";
import { runnerEnvironment } from "../../server/api/extraction/runnerContract.ts";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: exec }));
vi.mock("../../server/local/engine/ai/runnerProcess.ts", () => ({ execRunner: exec }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("provider-independent extraction dispatch", () => {
  it("advertises implemented capabilities, not capabilities of an unknown CLI", () => {
    expect(runnerCapabilities("claude").images).toContain("image/png");
    expect(runnerCapabilities("codex").images).toContain("image/png");
    expect(runnerCapabilities("antigravity").images).toEqual([]);
    expect(runnerCapabilities("antigravity").schemaConstrainedOutput).toBe(true);
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

  it("rejects unsupported image format by antigravity before launch", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "antigravity");
    await expect(callAI("analyze", { image: { buffer: Buffer.from("image"), mimeType: "image/png" } })).rejects.toThrow("does not support this image format");
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

  it("diagnoses antigravity runner interface compatibility", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "antigravity");
    vi.stubEnv("MADP_AGY_BINARY", "agy.exe");
    exec.mockImplementation((_binary, _args, _options, cb) => {
      queueMicrotask(() => cb(null, "", "--input-format\n--output-format\n--json-schema\n--disable-slash-commands\n--print-timeout\n"));
    });
    const result = await diagnoseExtractionRunner();
    expect(result.runner).toBe("antigravity");
    expect(result.selection).toBe("local extraction setting");
    expect(result.available).toBe(true);
    expect(result.capabilities.images).toEqual([]);
    expect(result.capabilities.schemaConstrainedOutput).toBe(true);
    expect(result.missingFlags.length).toBe(0);
    expect(result.message).toContain("compatible");
  });

  it("diagnoses antigravity runner as unavailable when binary missing", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "antigravity");
    exec.mockImplementation((_b, _a, _o, cb) => {
      queueMicrotask(() => cb(new Error("ENOENT")));
    });
    const result = await diagnoseExtractionRunner();
    expect(result.available).toBe(false);
    expect(result.message).toContain("could not be launched");
  });

  it("rejects structured output when not supplied", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "antigravity");
    exec.mockImplementation((_b, _a, _o, cb) => {
      queueMicrotask(() => cb(null, JSON.stringify({ event: "result", result: { status: "ERROR", error: "did not complete successfully" } })));
      return { stdin: { on: vi.fn(), end: vi.fn() } };
    });
    await expect(callAI("analyze", { outputSchema: { type: "object", properties: {} } })).rejects.toThrow("did not complete successfully");
  });
});

describe("extraction adapter capabilities", () => {
  it("antigravityAdapter has no images but schemaConstrainedOutput enabled", () => {
    expect(runnerCapabilities("antigravity").images).toEqual([]);
    expect(runnerCapabilities("antigravity").schemaConstrainedOutput).toBe(true);
  });
});

describe("extraction adapter environment allowlist", () => {
  it("antigravity runner strips secrets unrelated to Gemini model access", () => {
    const env = runnerEnvironment("antigravity", { PATH: "bin", MF_SVC_CLIENT_SECRET: "private", GEMINI_API_KEY: "public", GOOGLE_CLOUD_PROJECT: "proj", GOOGLE_APPLICATION_CREDENTIALS: "creds" });
    expect(env).toEqual({ PATH: "bin", GEMINI_API_KEY: "public", GOOGLE_CLOUD_PROJECT: "proj" });
    // GEMINI_API_KEY and Google Cloud keys are permitted; secrets that should never cross process boundaries are excluded.
  });
});

describe("extraction adapter structured output parsing", () => {
  it("parses structured_output from the envelope when schema is supplied", () => {
    const envelope = { status: "SUCCESS", response: "ignored", structured_output: { summary: "extracted text", ok: true } as any };
    const result = parseAntigravityResult(envelope, true);
    expect(result).toBe(JSON.stringify({ summary: "extracted text", ok: true }));
  });

  it("falls back to response text when structured_output is absent", () => {
    const envelope = { status: "SUCCESS", response: JSON.stringify({ summary: "from response" }) };
    const result = parseAntigravityResult(envelope, true);
    expect(result).toBe(JSON.stringify({ summary: "from response" }));
  });

  it("throws when neither structured_output nor response is valid JSON", () => {
    const envelope = { status: "SUCCESS", response: "plain prose" };
    expect(() => parseAntigravityResult(envelope, true)).toThrow("no structured extraction output");
  });

  it("throws when envelope status is not SUCCESS", () => {
    expect(() => parseAntigravityResult({ status: "ERROR", error: "model overloaded" } as any, true)).toThrow("did not complete successfully");
  });

  it("throws when response is missing entirely", () => {
    expect(() => parseAntigravityResult({ status: "SUCCESS" } as any, false)).toThrow("empty extraction response");
  });
});

describe("extraction adapter call (smoke with mock binary)", () => {
  it("constructs stream-json args and parses result envelope from mock binary", async () => {
    vi.stubEnv("MF_EXTRACTION_RUNNER", "antigravity");
    vi.stubEnv("MADP_AGY_BINARY", "agy.exe");
    exec.mockImplementation((binary: string, _args: string[], _options: any, cb: any) => {
      expect(binary).toContain("agy");
      queueMicrotask(() => cb(null, `{"event":"result","result":{"status":"SUCCESS","structured_output":{"status":"ready"},"conversation_id":"test-123"}}\n`, ""));
      return { stdin: { on: vi.fn(), end: () => {} } };
    });
    const result = await callAI("Summarize the PDF", { outputSchema: { type: "object", properties: { status: { type: "string" } } } });
    expect(result).toBe(JSON.stringify({ status: "ready" }));
  });
});


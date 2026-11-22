import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithCapacityFallback, type CliRun } from "./claudeCapacity.ts";
import { EXTRACTION_INSTRUCTION, runnerEnvironment, type ExtractionAdapter, type ExtractionInput } from "./runnerContract.ts";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const claudeAdapter: ExtractionAdapter = {
  capabilities: { images: IMAGE_TYPES, schemaConstrainedOutput: true },
  call: callClaudeRunner,
};

/** Claude print-mode multimodal input, not a metadata-only image description. */
export function claudeInputMessage(prompt: string, input: ExtractionInput): string {
  const content: object[] = [];
  if (input.image) content.push({
    type: "image", source: { type: "base64", media_type: input.image.mimeType, data: input.image.buffer.toString("base64") },
  });
  content.push({ type: "text", text: `${EXTRACTION_INSTRUCTION}\n\n${prompt}` });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

export function parseClaudeResult(stdout: string, structured: boolean): string {
  // Accepts one JSON result object, or a stream-json transcript whose last "result" event is the answer
  // (current CLIs require --output-format stream-json with --input-format stream-json).
  let result;
  try { result = JSON.parse(stdout); }
  catch {
    const events = stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    });
    result = events.filter((e) => e && typeof e === "object" && e.type === "result").pop();
    if (!result) throw new Error("Claude returned invalid result JSON. Check CLI compatibility.");
  }
  if (!result || typeof result !== "object") throw new Error("Claude returned invalid result JSON. Check CLI compatibility.");
  if (result.type !== "result" || result.is_error || (result.subtype && result.subtype !== "success")) {
    throw new Error("Claude extraction did not complete successfully. Check sign-in, model access, and CLI compatibility.");
  }
  if (structured) {
    if (!result.structured_output || typeof result.structured_output !== "object" || Array.isArray(result.structured_output)) {
      throw new Error("Claude returned no structured extraction output. Check CLI version and model support.");
    }
    return JSON.stringify(result.structured_output);
  }
  if (typeof result.result !== "string" || !result.result.trim()) throw new Error("Claude returned an empty extraction response.");
  return result.result.trim();
}

export async function callClaudeRunner(prompt: string, input: ExtractionInput = {}): Promise<string> {
  if (input.image && !IMAGE_TYPES.includes(input.image.mimeType)) throw new Error("Unsupported image format for Claude. Use PNG, JPEG, WebP, or GIF.");
  const base = process.env.MF_EXTRACTION_TEMP_DIR || join(tmpdir(), "opencode", "madp-extraction");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "claude-"));
  try {
    const args = [
      "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
      "--no-session-persistence", "--disable-slash-commands",
    ];
    if (input.outputSchema) args.push("--json-schema", JSON.stringify(input.outputSchema));
    const model = input.model || process.env.MF_EXTRACTION_MODEL;
    if (model) args.push("--model", model);
    const binary = process.env.MF_EXTRACTION_CLAUDE_BINARY || process.env.MADP_CLAUDE_BIN || "claude";
    const message = claudeInputMessage(prompt, input);
    const once = (env: NodeJS.ProcessEnv) => new Promise<CliRun>((resolve) => {
      const child = execFile(binary, args, {
        cwd: dir, env, windowsHide: true,
        timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
      }, (error, out, errOut) => resolve({ error, stdout: typeof out === "string" ? out : String(out ?? ""), stderr: typeof errOut === "string" ? errOut : String(errOut ?? "") }));
      child.stdin?.on("error", () => { /* callback handles process failures without leaking prompts */ });
      child.stdin?.end(message);
    });
    // out of AI capacity: once more on the operator's fallback key, else a CapacityError (code ai.capacity, plain message)
    const r = await runWithCapacityFallback({ env: runnerEnvironment("claude"), run: once });
    if (r.error) {
      if ((r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Claude executable not found. Set MF_EXTRACTION_CLAUDE_BINARY to an installed native executable.");
      throw new Error(`Claude extraction ${r.error.killed ? "timed out" : "failed"}. Check Claude sign-in, model access, and CLI compatibility.`);
    }
    const stdout = r.stdout;
    return parseClaudeResult(stdout, Boolean(input.outputSchema));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

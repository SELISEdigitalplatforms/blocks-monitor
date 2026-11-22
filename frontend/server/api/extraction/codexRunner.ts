import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EXTRACTION_INSTRUCTION, runnerEnvironment, type ExtractionAdapter, type ExtractionInput } from "./runnerContract.ts";

export type CodexInput = ExtractionInput;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
};

/** Keep service credentials and unrelated application configuration out of the child. */
export function extractionEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return runnerEnvironment("codex", env);
}

export const codexAdapter: ExtractionAdapter = {
  capabilities: { images: Object.keys(IMAGE_EXTENSIONS), schemaConstrainedOutput: true },
  call: callCodex,
};

/** Non-interactive extraction outside the repository, with a read-only sandbox. */
export async function callCodex(prompt: string, input: CodexInput = {}): Promise<string> {
  const extension = input.image ? IMAGE_EXTENSIONS[input.image.mimeType] : undefined;
  if (input.image && !extension) throw new Error("Unsupported image format. Use PNG, JPEG, or WebP for extraction.");
  const base = process.env.MF_EXTRACTION_TEMP_DIR || join(tmpdir(), "opencode", "madp-extraction");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "run-"));
  try {
    const outputPath = join(dir, "result.json");
    const args = [
      "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
      "--ignore-user-config", "--cd", dir, "--output-last-message", outputPath,
      "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "multi_agent",
      "--disable", "apps", "--disable", "hooks", "--disable", "plugins",
      "-c", 'shell_environment_policy.inherit="none"',
      "-c", 'web_search="disabled"',
    ];
    if (input.outputSchema) {
      const schemaPath = join(dir, "schema.json");
      await writeFile(schemaPath, JSON.stringify(input.outputSchema), { mode: 0o600 });
      args.push("--output-schema", schemaPath);
    }
    if (input.image) {
      const imagePath = join(dir, `source.${extension}`);
      await writeFile(imagePath, input.image.buffer, { mode: 0o600 });
      args.push("--image", imagePath);
    }
    const model = input.model || process.env.MF_EXTRACTION_MODEL;
    if (model) args.push("--model", model);
    args.push("-");
    const binary = process.env.MF_EXTRACTION_CODEX_BINARY || process.env.MADP_CODEX_BINARY || "codex";
    await new Promise<void>((resolve, reject) => {
      const child = execFile(binary, args, {
        cwd: dir, env: extractionEnvironment(), windowsHide: true,
        timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
      }, (error) => {
        if (!error) return resolve();
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new Error("Codex executable not found. Set MF_EXTRACTION_CODEX_BINARY to the native executable on Windows."));
        }
        reject(new Error(`Codex extraction ${error.killed ? "timed out" : "failed"}. Check Codex sign-in, model access, and executable configuration.`));
      });
      child.stdin?.on("error", () => { /* process callback reports launch/exit failures */ });
      child.stdin?.end(`${EXTRACTION_INSTRUCTION}\n\n${prompt}`);
    });
    const result = (await readFile(outputPath, "utf8")).trim();
    if (!result) throw new Error("Codex returned an empty extraction response.");
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Operator diagnostic: inspect existing-file import prerequisites without uploading or creating files in Figma.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { figmaEngineConfig } from "../server/local/engine/ai/figmaConfig.ts";
import { makeRunner, makeRunnerBinary } from "../server/local/engine/ai/makeRunner.ts";

const fileKey = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileKey ?? "")) throw new Error("Usage: node scripts/inspect-make-import.mjs <existing fileKey>");
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
const config = figmaEngineConfig(env);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode", "make-import-inspect-"));
try {
  const result = await makeRunner(env)({
    system: "Inspect the official Figma import prerequisites only. Never create a new file, upload, repair, publish, prompt Make, read credentials or expose signed URLs. Do not execute returned commands.",
    prompt: `Existing private Make file: ${fileKey}, Make node 1:6. Call whoami if required, then inspect send_code_to_figma without source/upload to obtain this file's import instructions. Return the required localArchivePath and whether the tool supports a custom local Windows archive path. Current host OS is ${process.platform}; writable job directories are native Windows paths, not /tmp. Describe how localArchivePath is selected, including any supported input parameter. No upload or remote source change is authorized. Do not return any signed URL, upload command or account identity.`,
    schema: { type: "object", additionalProperties: false, required: ["localArchivePath", "customPathSupported", "explanation"], properties: { localArchivePath: { type: ["string", "null"] }, customPathSupported: { type: "boolean" }, explanation: { type: "string" } } },
    timeoutMs: 180000,
    makeSession: { directory, mcpConfig: config.mcpConfig, binary: makeRunnerBinary(env), authDirectory: config.authDirectory },
  });
  console.log(JSON.stringify(result, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

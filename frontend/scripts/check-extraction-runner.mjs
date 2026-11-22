// Read-only local preflight. No model requests, uploads, or engine configuration writes.
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = loadEnv("development", root, "");
for (const [key, value] of Object.entries(env)) {
  if (/^(MF_EXTRACTION_|AI_RUNNER$|MADP_CLAUDE_BIN$|MADP_CODEX_BINARY$)/.test(key) && process.env[key] === undefined) process.env[key] = value;
}
const { diagnoseExtractionRunner } = await import("../server/api/extraction/aiRunner.ts");
const result = await diagnoseExtractionRunner();
console.log(JSON.stringify(result, null, 2));
if (!result.interfaceCompatible) process.exitCode = 1;

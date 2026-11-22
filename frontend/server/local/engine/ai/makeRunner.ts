import { claudeRunner, type AiRunner } from "./claude.ts";
import { codexMakeRunner, codexBinary } from "./codex.ts";
import { claudeBinary } from "./claude.ts";
import { antigravityBinary, antigravityMakeRunner } from "./antigravity.ts";
import path from "node:path";
import { FigmaConfigurationError } from "./figmaConfig.ts";

/** Figma can use a dedicated runner because provider MCP support differs from ordinary engine text calls.
 *  MF_ENGINE_FIGMA_RUNNER is explicit and isolated; without it, inherit AI_RUNNER. Extraction/editor settings
 *  never select either execution identity. */
export function makeRunnerProvider(env: NodeJS.ProcessEnv = process.env): "codex" | "claude" | "antigravity" {
  const selected = env.MF_ENGINE_FIGMA_RUNNER?.trim() || env.AI_RUNNER?.trim() || "claude";
  const name = path.win32.basename(path.posix.basename(selected)).toLowerCase().replace(/\.(exe|cmd|ps1)$/, "");
  const provider = name === "agy" || name === "antigravity" || name === "antigravity-cli" ? "antigravity" : name;
  if (provider !== "codex" && provider !== "claude" && provider !== "antigravity") {
    throw new FigmaConfigurationError("design.figmaUnsupportedRunner", "The engine's selected AI_RUNNER has no Figma Make adapter. Use a supported engine runner or add its MCP-capable adapter; no alternative runner was selected.");
  }
  return provider;
}

/** The Figma Make runner delegates to the selected provider's Make runner (codex, claude, or antigravity). */
export function makeRunner(env: NodeJS.ProcessEnv = process.env): AiRunner {
  const provider = makeRunnerProvider(env);
  if (provider === "antigravity") {
    return antigravityMakeRunner;
  }
  return provider === "codex" ? codexMakeRunner : claudeRunner;
}
export function makeRunnerBinary(env: NodeJS.ProcessEnv = process.env): string {
  const provider = makeRunnerProvider(env);
  const figmaBinary = env.MF_ENGINE_FIGMA_BINARY?.trim();
  if (figmaBinary) return figmaBinary;
  const binary = !env.MF_ENGINE_FIGMA_RUNNER?.trim() ? env.AI_RUNNER_BINARY?.trim() : "";
  if (binary) return binary;
  const selected = !env.MF_ENGINE_FIGMA_RUNNER?.trim() ? env.AI_RUNNER?.trim() : undefined;
  if (selected && (path.isAbsolute(selected) || path.win32.isAbsolute(selected))) return selected;
  return provider === "codex" ? codexBinary(env) : provider === "antigravity" ? antigravityBinary(env) : claudeBinary(env);
}

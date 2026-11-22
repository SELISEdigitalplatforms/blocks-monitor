// The Antigravity CLI (the machine's own `agy`, Google's terminal client) behind the engine's visible text,
// the Figma Make runner, and the Factory-managed design work: one headless call per ask, the answer constrained
// to the same JSON schema the other paths use (server/api/extraction/antigravityRunner.ts carries the CLI contract).
// The engine's own selection is MF_ENGINE_AI_MODEL / MF_ENGINE_AI_EFFORT; unset keeps the machine's own model choice.
import fs from "node:fs";
import path from "node:path";
import type { AiRunner } from "./claude.ts";
import { AI_IMAGE_TYPES } from "./claude.ts";
import { callAntigravity, parseAntigravityResult, resolveAgyBinary } from "../../../api/extraction/antigravityRunner.ts";
import { validateFigmaMcp } from "./figmaConfig.ts";

/** The Antigravity CLI this engine runs (explicit engine setting, else the extraction setting, else agy on PATH). */
export function antigravityBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.MF_ENGINE_AI_ANTIGRAVITY_BINARY || env.MADP_AGY_BINARY || env.MF_EXTRACTION_ANTIGRAVITY_BINARY
    || resolveAgyBinary(env);
}

/** Antigravity Make runner for Figma Make workflows (connection check, catalog inspection, Make generation). */
export const antigravityMakeRunner: AiRunner = async (req) => {
  if (req.signal?.aborted) throw new Error("cancelled");
  const session = req.makeSession;
  if (!session || !path.isAbsolute(session.directory)) {
    throw new Error("Antigravity Make requires an engine-owned job directory and MCP config.");
  }
  validateFigmaMcp(session.mcpConfig);
  if (session.authDirectory && (!path.isAbsolute(session.authDirectory) || !fs.existsSync(session.authDirectory))) {
    throw new Error("Invalid Figma authorization profile");
  }
  fs.mkdirSync(session.directory, { recursive: true });

  const model = session.model || process.env.MADP_AGENT_MODEL?.trim() || process.env.MF_ENGINE_AI_MODEL?.trim() || undefined;
  const answer = await callAntigravity(`${req.system}\n\n${req.prompt}`, {
    schema: req.schema,
    timeoutMs: req.timeoutMs,
    signal: req.signal,
    model,
    effort: process.env.MF_ENGINE_AI_EFFORT?.trim() || undefined,
  });
  return JSON.parse(parseAntigravityResult(answer, true)) as unknown;
};

/** The engine's Antigravity answer: delegates Make sessions to antigravityMakeRunner, rejects pictures; otherwise one structured headless call. */
export const antigravityRunner: AiRunner = async (req) => {
  if (req.makeSession) return antigravityMakeRunner(req);
  const images = (req.images ?? []).filter((i) => (AI_IMAGE_TYPES as readonly string[]).includes(i.mimeType) && i.data.length > 0);
  if (images.length) throw new Error("The Antigravity CLI reads text in headless runs only; this ask carried pictures, so nothing was sent.");
  const model = process.env.MADP_AGENT_MODEL?.trim() || process.env.MF_ENGINE_AI_MODEL?.trim() || undefined;
  const answer = await callAntigravity(`${req.system}\n\n${req.prompt}`, {
    schema: req.schema, timeoutMs: req.timeoutMs, signal: req.signal, model,
    effort: process.env.MF_ENGINE_AI_EFFORT?.trim() || undefined,
  });
  return JSON.parse(parseAntigravityResult(answer, true)) as unknown;
};

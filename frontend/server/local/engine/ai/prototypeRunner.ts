import type { AiRunner } from "./claude.ts";
import { claudeRunner } from "./claude.ts";
import { codexTextRunner } from "./codex.ts";
import { antigravityRunner } from "./antigravity.ts";
import { makeRunnerProvider } from "./makeRunner.ts";

/** Structured, tool-free generation. No Figma connection, browser session, filesystem tools or paid Make prompts.
 *  The engine's AI_RUNNER (the local config's engine identity) decides which CLI answers; each provider gets its
 *  own tool-free path. Make sessions are never attached here. */
export const prototypeRunner: AiRunner = (request) => {
  // design writing follows AI_RUNNER only (MF_ENGINE_FIGMA_RUNNER is for the Figma session)
  const provider = makeRunnerProvider({ ...process.env, MF_ENGINE_FIGMA_RUNNER: "" });
  const runner: AiRunner = provider === "claude" ? claudeRunner
    : provider === "antigravity" ? antigravityRunner
    : codexTextRunner;
  return runner({ ...request, makeSession: undefined });
};

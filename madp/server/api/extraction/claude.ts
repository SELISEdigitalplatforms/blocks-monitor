/**
 * Claude CLI caller — uses `claude --print` for text normalization and image description.
 *
 * Uses the locally installed and authenticated Claude CLI through the extraction adapter.
 */
import { callClaudeRunner } from "./claudeRunner.ts";

/** Call Claude with a text prompt via CLI. Returns the response text. */
export function callClaude(prompt: string): Promise<string> {
  return callClaudeRunner(prompt);
}

/** Compatibility entry point; image bytes are sent as multimodal stream-json input. */
export function callClaudeVision(prompt: string, imageBase64: string, imageMimeType: string): Promise<string> {
  return callClaudeRunner(prompt, { image: { buffer: Buffer.from(imageBase64, "base64"), mimeType: imageMimeType } });
}

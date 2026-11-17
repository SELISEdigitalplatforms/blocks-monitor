// The Claude call behind the engine's visible text: one print-mode run of the local Claude CLI (the same sign-in and
// isolation as the attachment extraction, server/api/extraction/claudeRunner.ts), with no tools, no MCP servers, no
// settings or hooks, its own short system prompt, and the answer constrained to a JSON schema. One call at a time per
// slot (at most AI_SLOTS at once), a hard timeout, and a stop when the job is cancelled.
//
// Settings (all optional):
//   MF_ENGINE_AI_MODEL       the model (default "sonnet")
//   MF_ENGINE_AI_EFFORT      the effort level (default "low": the answers are short, structured writing)
//                            (a call or a Figma session that names its own model or effort, such as the screen designer
//                            and its review, uses that instead: MF_ENGINE_FIGMA_MODEL / MF_ENGINE_FIGMA_EFFORT)
//   MF_ENGINE_AI_CLAUDE_BINARY / MF_EXTRACTION_CLAUDE_BINARY / MADP_CLAUDE_BIN   the CLI; else `claude` on the PATH,
//                            else ~/.local/bin/claude, else the newest Claude Code native binary of the VS Code extension
//
// Out of AI capacity (the subscription's usage limit, a rate limit, an overloaded API): the call runs once more on the
// operator's fallback API key when one is stored, else the job fails with code ai.capacity and a plain message
// (server/api/extraction/claudeCapacity.ts).
import { execRunner as execFile } from "./runnerProcess.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { CAPACITY_CODE, isCapacityError, runWithCapacityFallback, type CliRun } from "../../../api/extraction/claudeCapacity.ts";
import { parseClaudeResult } from "../../../api/extraction/claudeRunner.ts";
import { runnerEnvironment } from "../../../api/extraction/runnerContract.ts";
import { JobFailure } from "../run.ts";
import { validateFigmaMcp } from "./figmaConfig.ts";
import { providerExitError } from "./providerLogs.ts";

export interface AiRequest {
  /** Explicit owner-engine capability; never populated from browser input. Other writers remain tool-free. */
  makeSession?: { directory: string; mcpConfig: string; binary?: string; model?: string; effort?: string; authDirectory?: string; readOnly?: boolean; inspectCapabilities?: boolean; maxBudgetUsd?: number; maxTurns?: number };
  /** The model and effort of this one call (the screen review), ahead of the session's and the engine's own. */
  model?: string;
  effort?: string;
  /** What the model is (its short system prompt). */
  system: string;
  /** The task with the project's material. */
  prompt: string;
  /** JSON schema of the answer (object at the top). */
  schema: object;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Pictures the model looks at with the prompt (PNG, JPEG, WebP or GIF; people's attachments, ai/attachments.ts). */
  images?: readonly AiImage[];
  /** The job's log, for what the runner did about the AI capacity (never a key or a prompt). */
  log?: (line: string) => void;
}

export interface AiImage {
  mimeType: string;
  data: Uint8Array;
  /** What the picture is, in the prompt's words ("hero.png, attached to the comment on Landing Hero"). */
  label?: string;
}

/** The image types Claude reads. */
export const AI_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** The stream-json user message: the pictures (each with its label), then the prompt. */
export function imageMessage(prompt: string, images: readonly AiImage[]): string {
  const content: object[] = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}${img.label ? `: ${img.label}` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: Buffer.from(img.data).toString("base64") } });
  });
  content.push({ type: "text", text: prompt });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

/** Answers the parsed JSON object; rejects on a launch error, a timeout, a cancel or an answer that is not JSON. */
export type AiRunner = (req: AiRequest) => Promise<unknown>;

const AI_SLOTS = 3;
let busy = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (busy >= AI_SLOTS) await new Promise<void>((r) => waiting.push(r));
  busy += 1;
  try {
    return await fn();
  } finally {
    busy -= 1;
    waiting.shift()?.();
  }
}

let binaryCache: string | null = null;

/** The Claude CLI to run (see the settings above). */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.MF_ENGINE_AI_CLAUDE_BINARY || env.MF_EXTRACTION_CLAUDE_BINARY || env.MADP_CLAUDE_BIN;
  if (set) return set;
  if (binaryCache) return binaryCache;
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "claude"))) return (binaryCache = join(dir, "claude"));
  }
  const local = join(homedir(), ".local", "bin", "claude");
  if (existsSync(local)) return (binaryCache = local);
  const ext = join(homedir(), ".vscode", "extensions");
  try {
    const found = readdirSync(ext)
      .filter((d) => /^anthropic\.claude-code-\d/.test(d))
      .map((d) => join(ext, d, "resources", "native-binary", "claude"))
      .filter((p) => existsSync(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (found.length) return (binaryCache = found[found.length - 1]!);
  } catch {
    /* no VS Code extensions */
  }
  return "claude";
}

export const claudeRunner: AiRunner = (req) =>
  slot(async () => {
    if (req.signal?.aborted) throw new Error("cancelled");
    const base = join(tmpdir(), "madp-engine-ai");
    mkdirSync(base, { recursive: true });
    const session = req.makeSession;
    if (session && (!isAbsolute(session.mcpConfig) || !existsSync(session.mcpConfig) || !isAbsolute(session.directory))) throw new Error("Invalid Figma engine configuration");
    if (session) {
      validateFigmaMcp(session.mcpConfig);
      if (session.authDirectory && (!isAbsolute(session.authDirectory) || !existsSync(session.authDirectory))) throw new Error("Invalid Figma authorization profile");
    }
    const dir = session?.directory ?? mkdtempSync(join(base, "run-"));
    mkdirSync(dir, { recursive: true });
    try {
      const images = (req.images ?? []).filter((i) => (AI_IMAGE_TYPES as readonly string[]).includes(i.mimeType) && i.data.length > 0);
      // with pictures the prompt goes in as one stream-json user message (the CLI then answers in stream-json too)
      const io = images.length ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["--output-format", "json"];
      // the Make session's MCP servers with the names its config file actually gives them (its tool names are
      // mcp__<name>__…), so the allowlist matches whatever the owner engine configured
      const args = [
        "--print", ...io,
        "--model", req.model || session?.model || process.env.MF_ENGINE_AI_MODEL?.trim() || "sonnet",
        "--effort", req.effort || session?.effort || process.env.MF_ENGINE_AI_EFFORT?.trim() || "low",
        "--system-prompt", req.system,
        "--json-schema", JSON.stringify(req.schema),
        // a Figma session also reads Figma's skills, which the Figma MCP serves as resources (skill://figma/...)
        "--tools", session && !session.readOnly ? "Read,Write,Edit,Bash,ListMcpResourcesTool,ReadMcpResourceTool" : "",
        "--strict-mcp-config", "--mcp-config", session?.mcpConfig ?? '{"mcpServers":{}}',
        ...(session
          ? ["--permission-mode", "dontAsk",
             "--max-budget-usd", String(session.maxBudgetUsd ?? 5), "--max-turns", String(session.maxTurns ?? 80),
             "--allowedTools", session.readOnly ? "mcp__figma__whoami" : "Read,Write,Edit,Bash,ListMcpResourcesTool,ReadMcpResourceTool,mcp__figma__*" ]
          : []),
        "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
        "--no-session-persistence", "--disable-slash-commands",
      ];
      const input = images.length ? imageMessage(req.prompt, images) : req.prompt;
      const once = (env: NodeJS.ProcessEnv) => new Promise<CliRun>((resolve) => {
        const child = execFile(
          session?.binary || claudeBinary(),
          args,
          { cwd: dir, env, windowsHide: true, timeout: req.timeoutMs, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024, signal: req.signal },
          (error, out, errOut) => resolve({ error, stdout: typeof out === "string" ? out : String(out ?? ""), stderr: typeof errOut === "string" ? errOut : String(errOut ?? "") }),
        );
        child.stdin?.on("error", () => { /* the callback reports the failure */ });
        child.stdin?.end(input);
      });
      let r: CliRun;
      try {
        r = await runWithCapacityFallback({
          env: { ...runnerEnvironment("claude", process.env, session ? ["figma_oauth_token"] : []), ...(session?.authDirectory ? { CLAUDE_CONFIG_DIR: session.authDirectory } : {}) },
          run: once,
          log: req.log,
        });
      } catch (e) {
        if (isCapacityError(e)) throw new JobFailure(e.message, CAPACITY_CODE);
        throw e;
      }
      if (r.error) {
        const e = r.error as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === "ENOENT") throw new Error("Claude CLI not found (set MF_ENGINE_AI_CLAUDE_BINARY)");
        if (e.name === "AbortError" || req.signal?.aborted) throw new Error("cancelled");
        if (session) {
          throw providerExitError({
            directory: dir, runner: "claude",
            base: e.killed ? `timed out after ${Math.round(req.timeoutMs / 1000)} s` : "Claude CLI failed",
            stderr: r.stderr,
          });
        }
        throw new Error(e.killed ? `timed out after ${Math.round(req.timeoutMs / 1000)} s` : "Claude CLI failed");
      }
      const stdout = r.stdout;
      return JSON.parse(parseClaudeResult(stdout, true)) as unknown;
    } finally {
      if (!session) rmSync(dir, { recursive: true, force: true });
    }
  });

/**
 * Extraction-only runner dispatch: common image/findings contract, provider adapters,
 * and legacy text CLI support. MF_EXTRACTION_RUNNER overrides the inherited AI_RUNNER;
 * selecting a provider never changes core engine settings or silently falls back.
 */
import { execFile } from "node:child_process";
import { codexAdapter } from "./codexRunner.ts";
import { claudeAdapter } from "./claudeRunner.ts";
import { antigravityAdapter, resolveAgyBinary } from "./antigravityRunner.ts";
import type { ExtractionAdapter, ExtractionCapabilities, ExtractionInput } from "./runnerContract.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ENGINE_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "engine", "selise-madp");
const RUNNERS_YML = join(ENGINE_ROOT, "MADP", "config", "runners.yml");
const TIMEOUT_MS = 180_000; // 3 minutes max per call

// ── Runner config ────────────────────────────────────────────────────────────

interface RunnerConfig {
  binary: string;
  input: "stdin" | "positional" | "message_flag";
  argv: string[];
  modelFlag: string;
  messageFlag: string;
  outputFormat: string;
}

let _runners: Record<string, RunnerConfig> | null = null;

function loadRunners(): Record<string, RunnerConfig> {
  if (_runners) return _runners;
  _runners = {};

  // Default runners (hardcoded fallback if runners.yml not found)
  _runners.claude = {
    binary: "claude",
    input: "stdin",
    argv: ["--print", "--output-format", "text"],
    modelFlag: "--model",
    messageFlag: "",
    outputFormat: "text",
  };
  _runners.codex = {
    binary: "codex",
    input: "stdin",
    argv: ["exec", "--json"],
    modelFlag: "--model",
    messageFlag: "",
    outputFormat: "codex-jsonl",
  };
  _runners.aider = {
    binary: "aider",
    input: "message_flag",
    argv: ["--yes", "--no-auto-commits"],
    modelFlag: "--model",
    messageFlag: "--message",
    outputFormat: "text",
  };
  _runners.generic = {
    binary: "",
    input: "stdin",
    argv: [],
    modelFlag: "",
    messageFlag: "",
    outputFormat: "text",
  };

  // Try to load from runners.yml for accurate binary names
  if (existsSync(RUNNERS_YML)) {
    try {
      const raw = readFileSync(RUNNERS_YML, "utf-8");
      // Simple YAML parser for binary names (no full YAML dep needed)
      const binaryMatches = raw.matchAll(/^\s{2}(\w[\w-]*):\s*\n(?:.*\n)*?\s+binary:\s*(\S+)/gm);
      for (const m of binaryMatches) {
        const name = m[1];
        if (_runners[name]) {
          _runners[name].binary = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch { /* use defaults */ }
  }

  return _runners;
}

function getRunner(): RunnerConfig {
  const runners = loadRunners();
  const name = currentRunner();

  if (runners[name]) return runners[name];

  // Unknown runner — treat as generic stdin-based CLI
  return {
    binary: name,
    input: "stdin",
    argv: [],
    modelFlag: "",
    messageFlag: "",
    outputFormat: "text",
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Call the configured AI runner with a text prompt. Returns the response text. */
const ADAPTERS: Record<string, ExtractionAdapter> = { codex: codexAdapter, claude: claudeAdapter, antigravity: antigravityAdapter };

export function runnerCapabilities(name = currentRunner()): ExtractionCapabilities {
  return ADAPTERS[name]?.capabilities || { images: [], schemaConstrainedOutput: false };
}

export function callAI(prompt: string, opts?: ExtractionInput): Promise<string> {
  // The local configuration must name its runner; nothing is launched on the legacy claude default.
  if (!process.env.MF_EXTRACTION_RUNNER?.trim() && !process.env.AI_RUNNER?.trim()) {
    return Promise.reject(new Error("No extraction runner is configured. Set MF_EXTRACTION_RUNNER (or AI_RUNNER) in the local configuration to a supported provider; nothing was sent."));
  }
  const name = currentRunner();
  const adapter = ADAPTERS[name];
  if (opts?.image && !runnerCapabilities(name).images.includes(opts.image.mimeType)) {
    return Promise.reject(new Error(`The selected extraction runner '${name}' does not support this image format. Configure a compatible runner explicitly; no provider fallback was attempted.`));
  }
  if (adapter) return adapter.call(prompt, opts);
  const runner = getRunner();
  const binary = resolveBinary(runner);
  const args = [...runner.argv];

  // Add model flag if specified
  const model = opts?.model || process.env.MF_EXTRACTION_MODEL;
  if (model && runner.modelFlag) {
    args.push(runner.modelFlag, model);
  }

  // Add message flag for runners that use it
  if (runner.input === "message_flag" && runner.messageFlag) {
    args.push(runner.messageFlag, prompt);
  }

  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: cleanEnv(),
    }, (err, stdout) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("Extraction runner not found. Check the local extraction runner configuration."));
          return;
        }
        reject(new Error(`Extraction runner failed (${err.killed ? "timeout" : "process error"}). Check runner availability and sign-in.`));
        return;
      }
      resolve(parseOutput(stdout, runner.outputFormat));
    });

    // Send prompt via stdin for stdin-based runners
    if (runner.input === "stdin" && child.stdin) {
      child.stdin.on("error", () => { /* process callback handles launch failures */ });
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

/** Get the name of the currently configured runner. */
export function currentRunner(): string {
  return (process.env.MF_EXTRACTION_RUNNER?.trim() || process.env.AI_RUNNER?.trim() || "claude").toLowerCase();
}

/** Check if the configured runner is available. */
export async function isRunnerAvailable(): Promise<{ available: boolean; runner: string; binary: string }> {
  const runner = getRunner();
  const binary = resolveBinary(runner);
  return new Promise((resolve) => {
    execFile(binary, ["--version"], { timeout: 5000 }, (err) => {
      resolve({ available: !err, runner: currentRunner(), binary });
    });
  });
}

/** Read-only preflight: checks CLI interface, not credentials or provider/model access. */
export async function diagnoseExtractionRunner() {
  const name = currentRunner();
  const binary = resolveBinary(getRunner());
  const required = name === "codex"
    ? ["--image", "--output-schema", "--output-last-message", "--ignore-user-config", "--disable"]
    : name === "claude"
      ? ["--input-format", "--output-format", "--json-schema", "--tools", "--strict-mcp-config", "--setting-sources", "--settings", "--no-session-persistence", "--disable-slash-commands"]
      : name === "antigravity"
        ? ["--input-format", "--output-format", "--json-schema", "--disable-slash-commands", "--print-timeout"]
        : [];
  const check = await new Promise<{ available: boolean; missingFlags: string[] }>(resolve => {
    execFile(binary, name === "codex" ? ["exec", "--help"] : ["--help"], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout || ""}\n${stderr || ""}`;
      resolve({ available: !error, missingFlags: error ? required : required.filter(flag => !output.includes(flag)) });
    });
  });
  return {
    runner: name,
    selection: process.env.MF_EXTRACTION_RUNNER?.trim() ? "local extraction setting" : process.env.AI_RUNNER?.trim() ? "inherited AI_RUNNER" : "legacy default (claude)",
    available: check.available,
    interfaceCompatible: check.available && check.missingFlags.length === 0,
    capabilities: runnerCapabilities(name),
    missingFlags: check.missingFlags,
    authentication: "not checked",
    message: !check.available ? "Selected CLI could not be launched. Configure its native executable path; no alternative provider was selected."
      : check.missingFlags.length ? "Selected CLI does not advertise the flags required by its extraction adapter. Check CLI version before processing files."
      : ADAPTERS[name] ? "CLI interface is compatible. Provider sign-in and model/image support still require an explicit test."
      : "Legacy text-only CLI. It must accept the configured input and return findings JSON; image extraction is not supported by this adapter.",
  };
}

// ── Internals ────────────────────────────────────────────────────────────────

function resolveBinary(runner: RunnerConfig): string {
  const name = currentRunner();
  if (name === "codex") return process.env.MF_EXTRACTION_CODEX_BINARY || process.env.MADP_CODEX_BINARY || "codex";
  if (name === "claude") return process.env.MF_EXTRACTION_CLAUDE_BINARY || process.env.MADP_CLAUDE_BIN || "claude";
  if (name === "antigravity") return resolveAgyBinary(process.env);
  if (!ADAPTERS[name] && process.env.MF_EXTRACTION_BINARY) return process.env.MF_EXTRACTION_BINARY;

  // Check runner-specific env overrides
  const envOverrides: Record<string, string> = {
    claude: "MADP_CLAUDE_BIN",
    codex: "MADP_CODEX_BINARY",
  };
  const envKey = envOverrides[name];
  if (envKey && process.env[envKey]) return process.env[envKey]!;

  return runner.binary || name;
}

/** Strip session vars that would confuse a nested runner invocation. */
function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const strip = [
    "CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_ENABLE_TASKS", "CLAUDE_CODE_EXECPATH",
    "AI_AGENT", "CLAUDE_EFFORT", "CLAUDE_AGENT_SDK_VERSION",
    "CLAUDE_CODE_CONVERSATION_ID", "CLAUDE_CODE_TASK_ID",
    "CLAUDE_CODE_SESSION_DIR", "CLAUDE_CODE_AGENT_PARENT",
    "CLAUDE_CODE_AGENT_DEPTH", "CLAUDE_CODE_AGENT_NAME",
    "CLAUDE_CODE_ENTRY_POINT",
  ];
  for (const k of strip) delete env[k];
  return env;
}

/** Parse runner output based on format. */
function parseOutput(stdout: string, format: string): string {
  if (format === "text") return stdout.trim();

  if (format === "stream-json") {
    // Claude stream-json: each line is a JSON object with type + content
    const lines = stdout.trim().split("\n");
    const texts: string[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block.type === "text") texts.push(block.text);
          }
        }
        if (obj.type === "result" && obj.result) texts.push(obj.result);
      } catch { /* skip non-JSON lines */ }
    }
    return texts.join("\n").trim() || stdout.trim();
  }

  if (format === "codex-jsonl") {
    // Codex JSONL: each line has role + content
    const lines = stdout.trim().split("\n");
    const texts: string[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.role === "assistant" && typeof obj.content === "string") {
          texts.push(obj.content);
        }
      } catch { /* skip */ }
    }
    return texts.join("\n").trim() || stdout.trim();
  }

  return stdout.trim();
}

/** Figma jobs on the existing Codex CLI identity. No second worker or credential store. */
import { execRunner as execFile } from "./runnerProcess.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiRunner } from "./claude.ts";
import { FIGMA_MCP_URL, validateFigmaMcp } from "./figmaConfig.ts";
import { runnerEnvironment } from "../../../api/extraction/runnerContract.ts";
import { providerExitError } from "./providerLogs.ts";
export function codexBinary(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MF_ENGINE_AI_CODEX_BINARY || env.MADP_CODEX_BINARY;
  if (configured) return configured;
  const paths = String(env.PATH ?? env.Path ?? "").split(path.delimiter);
  for (const dir of paths) {
    if (!dir) continue;
    const direct = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    if (fs.existsSync(direct)) return direct;
    // npm's Windows shim is not executable through execFile; use its installed native binary.
    if (process.platform === "win32") {
      const arch = process.arch === "arm64" ? "arm64" : "x64";
      const triple = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
      const native = path.join(dir, "node_modules", "@openai", "codex", "node_modules", "@openai", `codex-win32-${arch}`, "vendor", triple, "bin", "codex.exe");
      if (fs.existsSync(native)) return native;
    }
  }
  return "codex";
}

export const codexMakeRunner: AiRunner = async (req) => {
  if (req.signal?.aborted) throw new Error("cancelled");
  const session = req.makeSession;
  if (!session || !path.isAbsolute(session.directory)) throw new Error("Codex Make requires an engine-owned job directory and MCP config.");
  validateFigmaMcp(session.mcpConfig);
  fs.mkdirSync(session.directory, { recursive: true });
  const io = fs.mkdtempSync(path.join(os.tmpdir(), "madp-make-codex-"));
  try {
    const schema = path.join(io, "schema.json");
    const output = path.join(io, "result.json");
    fs.writeFileSync(schema, JSON.stringify(req.schema), { mode: 0o600 });
    const env = runnerEnvironment("codex");
    if (session.authDirectory) env.CODEX_HOME = session.authDirectory;
    // A config credential is passed by environment, never argv, model prompt or job artifacts.
    const descriptor = JSON.parse(fs.readFileSync(session.mcpConfig, "utf8"));
    const header = descriptor.mcpServers.figma.headers?.Authorization as string | undefined;
    if (header) {
      const token = header.slice("Bearer ".length);
      env.FIGMA_OAUTH_TOKEN = token === "${FIGMA_OAUTH_TOKEN}" ? process.env.FIGMA_OAUTH_TOKEN : token;
      if (!env.FIGMA_OAUTH_TOKEN?.trim()) throw new Error("Figma OAuth credential is missing from the engine configuration.");
    }
    // File/archive tools need executables and native temporary paths, but never provider credentials.
    const shellKeys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp",
      'http_proxy', 'https_proxy', 'no_proxy', 'ssl_cert_file', 'ssl_cert_dir', 'node_extra_ca_certs']);
    const shellEnvironment = Object.entries(env).filter(([key, value]) => shellKeys.has(key.toLowerCase()) && value !== undefined)
      .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",");
    const args = [
      "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--cd", session.directory, "--output-schema", schema, "--output-last-message", output,
      "--sandbox", "danger-full-access", "-c", 'approval_policy="never"',
      "--disable", "multi_agent", "--disable", "apps", "--disable", "hooks", "--disable", "plugins",
      "-c", 'shell_environment_policy.inherit="none"', "-c", 'web_search="disabled"',
      "-c", `shell_environment_policy.set={${shellEnvironment}}`,
      "-c", `mcp_servers.figma.url=${JSON.stringify(FIGMA_MCP_URL)}`,
      "-c", "mcp_servers.figma.required=true", "-c", "mcp_servers.figma.startup_timeout_sec=30",
      ...(header ? ["-c", 'mcp_servers.figma.bearer_token_env_var="FIGMA_OAUTH_TOKEN"'] : []),
      ...(session.readOnly ? ["--disable", "shell_tool", "--disable", "unified_exec"] : []),
      // Catalog inspection needs the schemas, not just whoami. Its prompt prohibits all remote calls.
      ...(session.readOnly && !session.inspectCapabilities ? ["-c", 'mcp_servers.figma.enabled_tools=["whoami"]'] : []),
    ];
    const model = session.model;
    if (model) args.push("--model", model);
    args.push("-");
    await new Promise<void>((resolve, reject) => {
      const child = execFile(session.binary || codexBinary(), args, {
        cwd: session.directory, env, windowsHide: true, timeout: req.timeoutMs, signal: req.signal,
        killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024,
      }, (error) => {
        if (!error) {
          try { fs.rmSync(path.join(session.directory, "provider-error.log"), { force: true }); } catch { /* diagnostics only */ }
          return resolve();
        }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string };
        if (req.signal?.aborted) return reject(new Error("cancelled"));
        if (failure.code === "ENOENT") return reject(new Error("Codex CLI not found. Check the engine's AI_RUNNER_BINARY or MADP_CODEX_BINARY configuration."));
        reject(providerExitError({
          directory: session.directory, runner: "codex",
          base: failure.killed ? "Codex Make timed out." : "Codex Make failed. Check the engine's Codex and Figma authorization.",
          stdout: failure.stdout, stderr: failure.stderr,
        }));
      });
      child.stdin?.on("error", () => { /* callback handles launch failures */ });
      child.stdin?.end(`${req.system}\n\n${req.prompt}`);
    });
    return JSON.parse(fs.readFileSync(output, "utf8").replace(/^\uFEFF/, ''));
  } finally {
    fs.rmSync(io, { recursive: true, force: true });
  }
};

/** The planner's tool-free codex call: structured exec in a disposable directory, read-only sandbox, no MCP and no
 *  Make session. Engine writers and the Factory design writer use it when AI_RUNNER selects codex. */
export const codexTextRunner: AiRunner = async (req) => {
  if (req.signal?.aborted) throw new Error("cancelled");
  if (req.makeSession) throw new Error("This codex call runs tool-free in a disposable directory; use the Make runner for a Figma Make session.");
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, "codex-text-"));
  try {
    const schema = path.join(directory, "schema.json"), output = path.join(directory, "result.json");
    fs.writeFileSync(schema, JSON.stringify(req.schema), { mode: 0o600 });
    const args = [
      "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--cd", directory,
      "--output-schema", schema, "--output-last-message", output, "--sandbox", "read-only",
      "-c", 'approval_policy="never"',
      "-c", 'web_search="disabled"', "-c", "mcp_servers={}", "-c", 'shell_environment_policy.inherit="none"',
    ];
    const model = process.env.MADP_AGENT_MODEL?.trim();
    if (model) args.push("--model", model);
    args.push("-");
    const binary = process.env.AI_RUNNER_BINARY?.trim() || codexBinary();
    await new Promise<void>((resolve, reject) => {
      const child = execFile(binary, args, { cwd: directory, env: runnerEnvironment("codex"), timeout: req.timeoutMs,
        signal: req.signal, windowsHide: true, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (error) => {
        if (req.signal?.aborted) return reject(new Error("cancelled"));
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return reject(new Error("Codex CLI not found. Check the engine's AI_RUNNER_BINARY or MADP_CODEX_BINARY configuration."));
        if (error) reject(new Error(error.killed ? `timed out after ${Math.round(req.timeoutMs / 1000)} s` : "Codex CLI failed. Check codex sign-in and model access."));
        else resolve();
      });
      child.stdin?.on("error", () => { /* the callback reports launch failures */ });
      child.stdin?.end(`${req.system}\n\n${req.prompt}`);
    });
    const answer = fs.readFileSync(output, "utf8").replace(/^\uFEFF/, "");
    if (!answer.trim()) throw new Error("Codex returned an empty answer.");
    return JSON.parse(answer) as unknown;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

import { execFile, type ExecFileOptions } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { serializedBlocks } from "./cliQueue.ts";
import { neutralCwd, provisioningStore } from "./provisioningCliContext.ts";

const exec = promisify(execFile);
const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TENANT_RE = /^[A-Z][0-9a-f]{32}$/i;
const CONTEXT_FLAG = /^--(?:account|project|api-url)(?:=|$)/i;
const SESSION_TIMEOUT_MS = 90_000;
const DEFAULT_API_URL = "https://api.seliseblocks.com";

export interface SharedBlocksSession {
  account: string;
  store: string;
  apiUrl?: string;
}

type CliResult = { stdout: string; stderr: string };
type RunCli = (file: string, args: string[], options: ExecFileOptions) => Promise<CliResult>;

export interface SharedBlocksCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Trusted workspace path for a CLI operation that needs to read local input files. */
  cwd?: string;
  run?: RunCli;
}

type ErrorCode = "invalid_context" | "login_required" | "project_unavailable" | "command_failed" | "restore_failed" | "cancelled";

export class SharedBlocksError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`Shared Blocks CLI: ${code}`);
  }
}

/** Factory-owned projects use the configured provisioning login unless the operator opts out. */
export function sharedBlocksSession(env: Record<string, string | undefined> = process.env): SharedBlocksSession | undefined {
  const account = String(env.MF_BLOCKS_PROVISIONING_ACCOUNT ?? "").trim();
  if (!account || /^(?:0|false|off|no)$/i.test(String(env.MF_BLOCKS_SHARED_SESSION ?? "").trim())) return undefined;
  if (!ACCOUNT_RE.test(account)) throw new SharedBlocksError("invalid_context");
  return { account, store: provisioningStore(env), apiUrl: env.MF_BLOCKS_SHARED_API_URL?.trim() || DEFAULT_API_URL };
}

async function runCli(session: SharedBlocksSession, args: string[], options: SharedBlocksCommandOptions): Promise<CliResult> {
  const api = new URL(session.apiUrl ?? DEFAULT_API_URL);
  if (api.protocol !== "https:" || api.username || api.password || api.pathname !== "/" || api.search || api.hash) {
    throw new SharedBlocksError("invalid_context");
  }
  const argv = [...args, "--account", session.account, "--api-url", api.origin];
  const windows = process.platform === "win32";
  const encoded = Buffer.from(JSON.stringify(argv), "utf8").toString("base64");
  const script = `$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); & blocks.cmd @a; exit $LASTEXITCODE`;
  return (options.run ?? exec)(windows ? "powershell.exe" : "blocks", windows ? ["-NoProfile", "-NonInteractive", "-Command", script] : argv, {
    cwd: options.cwd ?? neutralCwd(session.store),
    env: { ...process.env, BLOCKS_CONFIG_DIR: session.store, BLOCKS_STRICT_FLAGS: "1", BLOCKS_NO_UPDATE_CHECK: "1", NO_COLOR: "1", BROWSER: "true" },
    windowsHide: true,
    timeout: options.timeoutMs ?? SESSION_TIMEOUT_MS,
    signal: options.signal,
    maxBuffer: 8 * 1024 * 1024,
  });
}

type TokenState = "valid" | "available" | "expired" | "missing";
interface SessionStatus {
  accountAccessToken: TokenState;
  accountRefreshToken: TokenState;
  projectAccessToken: TokenState;
  projectRefreshToken: TokenState;
}

const usable = (state: TokenState): boolean => state === "valid" || state === "available";

async function status(session: SharedBlocksSession, options: SharedBlocksCommandOptions, tenant?: string): Promise<SessionStatus> {
  const args = ["auth", "status", "--json"];
  if (tenant) args.push("--project", tenant);
  const { stdout } = await runCli(session, args, options);
  const row = JSON.parse(stdout) as SessionStatus;
  for (const token of ["accountAccessToken", "accountRefreshToken", "projectAccessToken", "projectRefreshToken"] as const) {
    if (!["valid", "available", "expired", "missing"].includes(row[token])) throw new SharedBlocksError("invalid_context");
  }
  return row;
}

/** Store only MADP's intended tenant beside the CLI store, so recovery also covers a crash during `blocks use`. */
function intentFile(session: SharedBlocksSession): string {
  const store = path.resolve(session.store);
  const identifier = createHash("sha256").update(`${store}\0${session.account}`).digest("hex").slice(0, 16);
  return path.join(path.dirname(store), `.madp-blocks-session-${identifier}.tenant`);
}

/** Restore the provisioning account, including a project selection left by a stopped worker. Caller holds the queue. */
export async function restoreSharedBlocksAccount(session: SharedBlocksSession, run?: RunCli): Promise<void> {
  try {
    const options = { run };
    const marker = intentFile(session);
    let tenant: string | undefined;
    try {
      const intended = fs.readFileSync(marker, "utf8").trim();
      if (TENANT_RE.test(intended)) tenant = intended;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let current = await status(session, options, tenant);
    const inProject = current.projectAccessToken !== "missing" || current.projectRefreshToken !== "missing";
    if (inProject || tenant) {
      await runCli(session, ["deselect", "--json", ...(tenant ? ["--project", tenant] : [])], options);
      current = await status(session, options, tenant);
      if (current.projectAccessToken !== "missing" || current.projectRefreshToken !== "missing") throw new SharedBlocksError("restore_failed");
    }
    if (!usable(current.accountRefreshToken)) throw new SharedBlocksError("login_required");
    fs.rmSync(marker, { force: true });
  } catch (error) {
    if (error instanceof SharedBlocksError && error.code === "login_required") throw error;
    // CLI errors include child output, which may contain account data.
    throw new SharedBlocksError("restore_failed");
  }
}

/** Run an already-authorized operation for a single tenant. The lock covers selection, dispatch, and cleanup. */
export async function runSharedBlocksCommand(
  session: SharedBlocksSession,
  tenant: string,
  args: string[],
  options: SharedBlocksCommandOptions = {},
): Promise<CliResult> {
  if (!ACCOUNT_RE.test(session.account) || !TENANT_RE.test(tenant) || args.some((arg) => arg === "--" || CONTEXT_FLAG.test(arg))) {
    throw new SharedBlocksError("invalid_context");
  }
  return serializedBlocks(async () => {
    if (options.signal?.aborted) throw new SharedBlocksError("cancelled");
    await restoreSharedBlocksAccount(session, options.run);
    if (options.signal?.aborted) throw new SharedBlocksError("cancelled");

    try {
      fs.writeFileSync(intentFile(session), tenant, { mode: 0o600, flag: "wx", flush: true });
    } catch {
      throw new SharedBlocksError("restore_failed");
    }
    try {
      const selectionOptions = { run: options.run, signal: options.signal };
      try {
        await runCli(session, ["use", tenant, "--json"], selectionOptions);
        const project = await status(session, selectionOptions, tenant);
        if (!usable(project.projectAccessToken) && !usable(project.projectRefreshToken)) throw new SharedBlocksError("project_unavailable");
      } catch {
        throw new SharedBlocksError(options.signal?.aborted ? "cancelled" : "project_unavailable");
      }
      try {
        return await runCli(session, [...args, "--project", tenant], options);
      } catch {
        throw new SharedBlocksError(options.signal?.aborted ? "cancelled" : "command_failed");
      }
    } finally {
      await restoreSharedBlocksAccount(session, options.run);
    }
  });
}

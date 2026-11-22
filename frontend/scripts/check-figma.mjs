// Read-only operator diagnostics. Never open a credential store or print subprocess diagnostics.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { figmaEngineConfig } from "../server/local/engine/ai/figmaConfig.ts";
import { makeRunnerBinary, makeRunnerProvider } from "../server/local/engine/ai/makeRunner.ts";
import { runnerEnvironment } from "../server/api/extraction/runnerContract.ts";
import { makeRunner } from "../server/local/engine/ai/makeRunner.ts";
import { checkMakeCapabilities, checkHeadlessMakeCapabilities, supportsHeadlessMake, supportsMakeWorkflow } from "../server/local/engine/ai/makeCapabilities.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...loadEnv("development", root, ""), ...process.env };
// Match the current worker's environment loading before its provider adapter is called.
for (const [key, value] of Object.entries(env)) if (process.env[key] === undefined && typeof value === "string") process.env[key] = value;
try {
  const config = figmaEngineConfig(env);
  const provider = makeRunnerProvider(env);
  const binary = makeRunnerBinary(env);
  await new Promise((resolve, reject) => execFile(binary, ["--version"], {
    env: { ...runnerEnvironment(provider, env), ...(config.authDirectory ? { [provider === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"]: config.authDirectory } : {}) }, windowsHide: true, timeout: 10_000, maxBuffer: 4096,
  }, (error, out) => error ? reject(new Error("The configured Figma runner CLI is missing or could not start under the engine service user.")) : resolve(out)));
  let authorization = "not_verified";
  let makeCapabilities = "not_verified";
  let headlessCapabilities;
  if (process.argv.includes("--live") || process.argv.includes("--capabilities") || process.argv.includes("--headless")) {
    const base = path.join(os.tmpdir(), "opencode");
    fs.mkdirSync(base, { recursive: true });
    const directory = fs.mkdtempSync(path.join(base, "madp-figma-check-"));
    try {
      const result = await makeRunner(env)({
        system: "You check the planner's existing Figma authorization. Never write remotely, prompt Make, open a browser or return account identity/credentials.",
        prompt: "Call the configured official Figma whoami tool. Return ready only if that tool actually succeeds. Return reconnect_required for missing/expired authorization, unsupported if the tool is missing, otherwise unavailable. Do not infer success.",
        schema: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["ready", "reconnect_required", "unsupported", "unavailable"] } } },
        timeoutMs: 60_000,
        makeSession: { directory, mcpConfig: config.mcpConfig, binary, authDirectory: config.authDirectory, readOnly: true, maxBudgetUsd: 0.5, maxTurns: 4,
          model: env.MADP_AGENT_MODEL?.trim() || env.MF_ENGINE_FIGMA_MODEL?.trim() || undefined },
      });
      authorization = ["ready", "reconnect_required", "unsupported", "unavailable"].includes(result?.status) ? result.status : "unavailable";
      if (authorization !== "ready") process.exitCode = 1;
      if (authorization === "ready" && process.argv.includes("--capabilities")) {
        const capabilities = await checkMakeCapabilities(makeRunner(env), {
          directory, mcpConfig: config.mcpConfig, binary, authDirectory: config.authDirectory,
          model: env.MADP_AGENT_MODEL?.trim() || env.MF_ENGINE_FIGMA_MODEL?.trim() || undefined,
        });
        makeCapabilities = ["ready", "import_only", "unsupported", "unavailable"].includes(capabilities?.status) ? capabilities.status : "unavailable";
        if (!supportsMakeWorkflow(capabilities, config.workflow)) process.exitCode = 1;
      }
      if (authorization === "ready" && process.argv.includes("--headless")) {
        headlessCapabilities = await checkHeadlessMakeCapabilities(makeRunner(env), { directory, mcpConfig: config.mcpConfig, binary, authDirectory: config.authDirectory });
        if (!supportsHeadlessMake(headlessCapabilities)) process.exitCode = 1;
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({
    ok: (authorization === "ready" || authorization === "not_verified") && (!process.argv.includes("--headless") || supportsHeadlessMake(headlessCapabilities)) && (makeCapabilities === "not_verified" || supportsMakeWorkflow({ status: makeCapabilities }, config.workflow)), configuration: "valid", runner: provider, cli: "available", authorization, makeCapabilities, workflow: config.workflow,
    ...(headlessCapabilities ? { headlessCapabilities } : {}),
    billingApproval: config.creditsApproved ? "operator_approved" : "not_approved",
    privateImportApproval: config.importApproved ? "operator_approved" : "not_approved",
    dailyIterationLimit: config.dailyIterations, modelBudgetUsdPerRun: provider === "claude" ? config.maxBudgetUsd : null,
    next: process.argv.includes("--headless") && !supportsHeadlessMake(headlessCapabilities)
      ? "Full headless Make requires same-file updates, revision retrieval and publication tools. Do not substitute browser credentials or treat import support as publication support."
      : makeCapabilities === "import_only"
      ? "Private Make import is available, but Make-agent prompting and in-place refinement are not. Select the explicit import workflow and obtain operator approval before creating a file. Import does not verify preview or publishing."
      : makeCapabilities === "unsupported"
      ? "Figma authorization works, but this MCP connection lacks the required Make-agent workflow tools. Generation is blocked before creating a project or consuming an iteration. Make file creation/import alone is insufficient. Verify provider availability, then rerun this check."
      : "The planner inherits AI_RUNNER from the current engine. Authorize Figma in that runner's own identity or private MCP config. OpenCode/editor authorization is separate. This check does not start design generation or verify Figma credits.",
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error?.code || "figma.checkFailed", message: error instanceof Error ? error.message : "Figma configuration check failed." }, null, 2));
  process.exitCode = 1;
}

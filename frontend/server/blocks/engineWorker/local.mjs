// The existing Blocks worker, on this machine, with a private project-scoped profile. Never starts provisioning.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { figmaEngineConfig } from "../../local/engine/ai/figmaConfig.ts";
import { makeRunner, makeRunnerBinary, makeRunnerProvider } from "../../local/engine/ai/makeRunner.ts";
import { checkMakeCapabilities, supportsMakeWorkflow } from "../../local/engine/ai/makeCapabilities.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const projectId = process.argv[2];
const activate = process.argv.slice(3).includes("--activate");
const factory = process.argv.slice(3).includes("--factory");
const screens = process.argv.slice(3).includes('--screens');
if (factory && screens) throw new Error('Choose one design workflow.');
if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? "") || process.argv.slice(3).some((arg) => !["--activate", "--factory", '--screens'].includes(arg))) {
  console.error("Usage: npm run engine:local -- <projectId> [--activate] [--factory]");
  process.exit(2);
}
const env = { ...loadEnv("development", root, ""), ...process.env };
for (const [key, value] of Object.entries(env)) if (process.env[key] === undefined && typeof value === "string") process.env[key] = value;
const directory = path.join(root, "data", "local-planner");
fs.mkdirSync(directory, { recursive: true });
const profileFile = path.join(directory, "profile.json");
let profile;
if (fs.existsSync(profileFile)) {
  profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
  if (profile.projectId !== projectId || !Number.isFinite(Date.parse(profile.since))) throw new Error("The existing local planner profile belongs to another project or is invalid. Keep its state; choose the intended project.");
} else {
  profile = { projectId, since: new Date().toISOString() };
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 2)}\n`, { flag: "wx" });
}
// Explicitly override inherited settings: the web server's provisioning flag must never activate cloud provisioning here.
process.env.MF_BLOCKS_PROVISIONING_ENABLED = "false";
process.env.MF_ENGINE_PROJECT_IDS = projectId;
process.env.MF_ENGINE_JOB_KINDS = "design.generate";
// The daily Blocks skills sync and the testers' feedback tickets (platform.feedback) belong to the primary engine host,
// never to a private project-scoped planner.
process.env.MF_ENGINE_EXCLUDED_JOB_KINDS = [env.MF_ENGINE_EXCLUDED_JOB_KINDS, "engine.skills-sync", "platform.feedback"].filter(Boolean).join(",");
if (factory) process.env.MF_ENGINE_DESIGN_WORKFLOW = "factory";
else if (screens) process.env.MF_ENGINE_DESIGN_WORKFLOW = 'screens';
else delete process.env.MF_ENGINE_DESIGN_WORKFLOW;
process.env.ENGINE_SINCE = profile.since;
process.env.MF_ENGINE_ROOT = path.join(directory, "engine-root");
process.env.ENGINE_HOST_DIR = path.join(directory, "host");
process.env.MF_ENGINE_READ_ONLY = activate ? "0" : "1";
if (activate && screens) {
  figmaEngineConfig();
  console.log('[engine-local] Activating native Figma screen designs for this project only. No Make publication.');
} else if (activate && factory) {
  console.log(`[engine-local] Activating the ${makeRunnerProvider()} Factory-managed designer for this project only. No Figma calls or public publishing. Stop the outdated worker before using this queue.`);
} else if (activate) {
  // No paid writes or model calls until an operator has enabled billing in the engine environment.
  const config = figmaEngineConfig();
  if (config.workflow === "agent" ? !config.creditsApproved : !config.importApproved) throw new Error("Local planner remains stopped: operator approval for the selected Figma workflow is required before --activate.");
  const probe = path.join(directory, "capability-probe");
  fs.mkdirSync(probe, { recursive: true });
  const result = await checkMakeCapabilities(makeRunner(), { directory: probe, mcpConfig: config.mcpConfig,
    binary: makeRunnerBinary(), authDirectory: config.authDirectory,
    model: process.env.MADP_AGENT_MODEL?.trim() || process.env.MF_ENGINE_FIGMA_MODEL?.trim() || undefined });
  if (!supportsMakeWorkflow(result, config.workflow)) throw new Error("Local planner remains stopped: this Figma connection does not expose the selected Make workflow.");
  console.log(`[engine-local] Activating ${makeRunnerProvider()} for this project's future design requests. The previous worker must no longer claim these requests.`);
} else {
  console.log("[engine-local] Starting the existing planner worker paused/read-only. It will not claim jobs, enforce job limits, or provision tenants.");
}
await import("./start.mjs");

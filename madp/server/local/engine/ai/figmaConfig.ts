import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const FIGMA_MCP_URL = "https://mcp.figma.com/mcp";

export class FigmaConfigurationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "FigmaConfigurationError"; }
}

export interface FigmaEngineConfig {
  mcpConfig: string;
  creditsApproved: boolean;
  workflow: "agent" | "import";
  importApproved: boolean;
  authDirectory?: string;
  stateDirectory: string;
  dailyIterations: number;
  /** Cost cap of one designer session (the drawing, and each polish round on its own). */
  maxBudgetUsd: number;
  /** Turn cap of one designer session (the drawing, and each polish round on its own). */
  maxTurns: number;
  /** The screen designer's model (MF_ENGINE_FIGMA_MODEL, default "opus"); with the Claude runner it also reviews. */
  model: string;
  /** Whether MF_ENGINE_FIGMA_MODEL names it (another runner gets a model only when it is named). */
  modelSet: boolean;
  /** The designer's effort level (MF_ENGINE_FIGMA_EFFORT, default "high"); Claude runner only. */
  effort: FigmaEffort;
  /** Time cap of the drawing session (MF_ENGINE_FIGMA_TIMEOUT_MINUTES); unset keeps the runner's own default. */
  timeoutMinutes?: number;
}

export const FIGMA_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type FigmaEffort = (typeof FIGMA_EFFORTS)[number];
export const FIGMA_DEFAULT_MODEL = "opus";
export const FIGMA_DEFAULT_EFFORT: FigmaEffort = "high";
export const FIGMA_DEFAULT_MAX_TURNS = 120;
export const FIGMA_DEFAULT_MAX_BUDGET_USD = 15;
export const FIGMA_MAX_TURNS_LIMIT = 400;

/** The model and effort a designer session (or the screen review) asks its runner for. Claude gets the configured
 *  model ("opus" unless set) at the configured effort; Codex and Antigravity get a model only when the operator named
 *  one (their own default otherwise) and no effort. A config without them (older callers) leaves the runner's own. */
export function figmaDesignerModel(config: Partial<Pick<FigmaEngineConfig, "model" | "modelSet" | "effort">>, provider: string): { model?: string; effort?: FigmaEffort } {
  if (provider === "claude") return { ...(config.model ? { model: config.model } : {}), ...(config.effort ? { effort: config.effort } : {}) };
  return config.modelSet && config.model ? { model: config.model } : {};
}

function directory(value: string | undefined): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  try { return fs.statSync(value).isDirectory() ? fs.realpathSync(value) : null; } catch { return null; }
}

/** Server-side MCP config, not the CLI's credential store. Never return its contents or errors containing them. */
export function validateFigmaMcp(file: string): void {
  try {
    if (!path.isAbsolute(file) || fs.statSync(file).size > 16_384) throw new Error();
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const servers = config.mcpServers;
    const figma = servers?.figma;
    if (Object.keys(config).some((k) => k !== "mcpServers") || !servers || Object.keys(servers).length !== 1 ||
        !figma || figma.type !== "http" || figma.url !== FIGMA_MCP_URL ||
        Object.keys(figma).some((k) => !["type", "url", "headers"].includes(k))) throw new Error();
    if (figma.headers !== undefined) {
      if (!figma.headers || typeof figma.headers !== "object" || Array.isArray(figma.headers) ||
          Object.keys(figma.headers).some((k) => k !== "Authorization") ||
          typeof figma.headers.Authorization !== "string" || !/^Bearer \S+$/.test(figma.headers.Authorization) ||
          /[\r\n]/.test(figma.headers.Authorization)) throw new Error();
      const variables = figma.headers.Authorization.match(/\$\{[^}]+\}/g) ?? [];
      if (variables.some((v: string) => v !== "${FIGMA_OAUTH_TOKEN}")) throw new Error();
    }
  } catch {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "Use the official Figma HTTP MCP config with only the figma server. An optional Bearer Authorization header is supported; executable servers are not.");
  }
}

/** Reuse the current engine host, CLI identity and project storage. No separate deployment is required. */
export function figmaEngineConfig(env: NodeJS.ProcessEnv = process.env): FigmaEngineConfig {
  if (env.MF_ENGINE_FIGMA_ENABLED !== "1" || !env.MF_ENGINE_FIGMA_MCP_CONFIG) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "Figma Make is not connected on the owner engine. Configure its official MCP connection.");
  }
  const mcpConfig = env.MF_ENGINE_FIGMA_MCP_CONFIG;
  validateFigmaMcp(mcpConfig);
  const authOverride = env.MF_ENGINE_FIGMA_AUTH_DIR?.trim();
  const authDirectory = authOverride ? directory(authOverride) : undefined;
  if (authOverride && !authDirectory) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "The optional Figma CLI profile must be an existing absolute directory. Leave it unset to use the current engine's CLI identity.");
  }
  const stateOverride = env.MF_ENGINE_FIGMA_STATE_DIR?.trim();
  if (stateOverride && !path.isAbsolute(stateOverride)) throw new FigmaConfigurationError("design.figmaNotConfigured", "The optional Figma state directory must be absolute.");
  const stateDirectory = stateOverride || path.join(env.MF_ENGINE_ROOT?.trim() || env.ENGINE_HOST_DIR?.trim() || fileURLToPath(new URL("../../../../data/", import.meta.url)), "figma-state");
  if (authDirectory === stateDirectory) throw new FigmaConfigurationError("design.figmaNotConfigured", "Keep Figma recovery state separate from the optional authorization profile.");
  const dailyIterations = Number(env.MF_ENGINE_FIGMA_MAX_ITERATIONS_PER_DAY?.trim() || "5");
  // Per designer session: the drawing and each polish round of the design review get these caps on their own.
  const maxBudgetUsd = Number(env.MF_ENGINE_FIGMA_MAX_BUDGET_USD?.trim() || String(FIGMA_DEFAULT_MAX_BUDGET_USD));
  const maxTurns = Number(env.MF_ENGINE_FIGMA_MAX_TURNS?.trim() || String(FIGMA_DEFAULT_MAX_TURNS));
  const namedModel = env.MF_ENGINE_FIGMA_MODEL?.trim() || "";
  if (namedModel && !/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/.test(namedModel)) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "The screen designer's model name is invalid. Use a model alias such as opus or a full model name.");
  }
  const effort = (env.MF_ENGINE_FIGMA_EFFORT?.trim().toLowerCase() || FIGMA_DEFAULT_EFFORT) as FigmaEffort;
  if (!(FIGMA_EFFORTS as readonly string[]).includes(effort)) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", `The screen designer's effort must be one of ${FIGMA_EFFORTS.join(", ")}.`);
  }
  const timeoutRaw = env.MF_ENGINE_FIGMA_TIMEOUT_MINUTES?.trim();
  const timeoutMinutes = timeoutRaw ? Number(timeoutRaw) : undefined;
  if (timeoutMinutes !== undefined && (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 5 || timeoutMinutes > 240)) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "The screen designer's time limit must be a whole number of minutes from 5 to 240.");
  }
  // The currently available official MCP connection exposes file creation/import, not Make-agent prompting.
  // Prefer the usable headless import path; paid agent prompting is an explicit opt-in workflow.
  const workflow = env.MF_ENGINE_FIGMA_WORKFLOW?.trim() || "import";
  if (workflow !== "agent" && workflow !== "import") throw new FigmaConfigurationError("design.figmaNotConfigured", "Figma workflow must be agent or import.");
  if (!Number.isInteger(dailyIterations) || dailyIterations < 1 || dailyIterations > 1000 ||
      !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0 || maxBudgetUsd > 100 ||
      !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > FIGMA_MAX_TURNS_LIMIT) {
    throw new FigmaConfigurationError("design.figmaNotConfigured", "Figma engine iteration, model-budget or turn limits are invalid. Ask the owner engine administrator to correct them.");
  }
  return { mcpConfig, workflow, importApproved: env.MF_ENGINE_FIGMA_IMPORT_APPROVED === "1", creditsApproved: env.MF_ENGINE_FIGMA_CREDITS_APPROVED === "1", authDirectory: authDirectory ?? undefined, stateDirectory, dailyIterations, maxBudgetUsd, maxTurns,
    model: namedModel || FIGMA_DEFAULT_MODEL, modelSet: !!namedModel, effort, ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}) };
}

/** Atomic per-slot reservations shared by workers. A failed/uncertain remote write still consumes its reservation.
 * This caps started iterations, not Figma credits (their actual per-iteration cost is provider-controlled). */
export function reserveFigmaIteration(config: Pick<FigmaEngineConfig, "stateDirectory" | "dailyIterations">, jobId: string, now: Date): void {
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(config.stateDirectory, "iterations", day);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const job = createHash("sha256").update(jobId).digest("hex");
  // Check every recorded slot, even after an administrator lowers the daily cap.
  const recorded = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n));
  for (const name of recorded) {
    try { if (JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")).job === job) return; }
    catch { /* A concurrent writer may still hold an empty slot: it counts against the cap. */ }
  }
  for (let slot = 0; slot < config.dailyIterations; slot++) {
    try {
      fs.writeFileSync(path.join(dir, `${slot}.json`), JSON.stringify({ job, startedAt: now.toISOString() }), { flag: "wx", mode: 0o600 });
      return;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw new FigmaConfigurationError("design.figmaBudget", "Figma generation is paused: the owner engine's daily iteration limit is reached. Review usage before starting more work.");
}

function operationFile(config: FigmaEngineConfig, target: string): string {
  return path.join(config.stateDirectory, "operations", `${createHash("sha256").update(target).digest("hex")}.json`);
}

/** A failed job may already have changed Figma. A new job must not bypass the old attempt's checkpoint. */
export function assertFigmaWriteAvailable(config: FigmaEngineConfig, target: string, jobId: string): void {
  const file = operationFile(config, target);
  if (!fs.existsSync(file)) return;
  try { if (JSON.parse(fs.readFileSync(file, "utf8")).jobId === jobId) return; } catch { /* fail closed */ }
  throw new FigmaConfigurationError("design.figmaRecoveryRequired", "An earlier Figma write for this design needs recovery on the owner engine. A new job will not repeat uncertain remote work.");
}

export function claimFigmaWrite(config: FigmaEngineConfig, target: string, jobId: string, source: string): void {
  const file = operationFile(config, target);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, JSON.stringify({ jobId, source }), { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; assertFigmaWriteAvailable(config, target, jobId); }
}

export function finishFigmaWrite(config: FigmaEngineConfig, target: string, jobId: string): void {
  const file = operationFile(config, target);
  if (!fs.existsSync(file)) return;
  assertFigmaWriteAvailable(config, target, jobId);
  fs.unlinkSync(file);
}

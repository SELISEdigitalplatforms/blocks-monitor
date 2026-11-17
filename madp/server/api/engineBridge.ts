/**
 * Engine Bridge — spawns MADP engine CLI commands and captures output.
 *
 * Supports multiple concurrent runs via named slots:
 *   - "build" slot: exclusive (only one build pipeline at a time)
 *   - "plan-<jobId>" slots: parallel planning runs (planner is read-only)
 *
 * The planner (Agent 01) only reads code and writes specs — it never modifies
 * the source repo. This means planning runs can safely overlap with builds.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const ENGINE_ROOT = resolve(import.meta.dirname, "..", "..", "..", "engine", "selise-madp");
const MADP_ROOT = join(ENGINE_ROOT, "MADP");
const PROJECTS_DIR = join(MADP_ROOT, "projects");
const ARTIFACTS_DIR = join(MADP_ROOT, "artifacts");
const PYTHON = process.env.MADP_PYTHON ?? "python3";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  args: string[];
  env?: Record<string, string>;
  onLine?: (line: string) => void;
  /** Named slot. "build" is exclusive; "plan-*" slots run in parallel. Default: "build". */
  slot?: string;
}

export interface RunStatus {
  running: boolean;
  runId: string;
  slot: string;
  pid?: number;
  cmd: string;
  startedAt?: string;
  exitCode?: number | null;
  output: string[];
}

export interface RunSummary {
  runId: string;
  ts: string;
  agents: { agentId: string; moduleId: string; event: string; rc: number; dur: string; model: string; costUsd: number }[];
  totalCost: number;
  status: string;
}

// ── Multi-slot process management ────────────────────────────────────────────

interface SlotState {
  process: ChildProcess;
  runId: string;
  cmd: string;
  startedAt: string;
  exitCode: number | null;
  output: string[];
}

const slots = new Map<string, SlotState>();
const MAX_BUFFER = 500;
const sseClients: Set<(data: string) => void> = new Set();

function pushLine(slot: string, runId: string, line: string): void {
  const state = slots.get(slot);
  if (state) {
    state.output.push(line);
    if (state.output.length > MAX_BUFFER) state.output.shift();
  }
  for (const send of sseClients) {
    try { send(JSON.stringify({ type: "output", line, runId, slot })); } catch { /* client gone */ }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Spawn a MADP CLI command in a named slot. */
export function run(opts: RunOptions): { runId: string; pid: number; cmd: string; slot: string } {
  const slot = opts.slot || "build";

  // Build slot is exclusive — only one build at a time
  if (slot === "build") {
    const existing = slots.get("build");
    if (existing && existing.process.exitCode === null) {
      throw new Error(`A build is already running (pid ${existing.process.pid}, runId ${existing.runId})`);
    }
  }

  // Check if this exact slot is already active
  const current = slots.get(slot);
  if (current && current.process.exitCode === null) {
    throw new Error(`Slot '${slot}' is already active (pid ${current.process.pid}, runId ${current.runId})`);
  }

  const runId = randomUUID().slice(0, 8);
  const cmd = [PYTHON, "-m", "MADP.orchestrator.cli.project", ...opts.args].join(" ");

  // For planning slots, use isolated artifacts directory
  const extraEnv: Record<string, string> = {};
  if (slot.startsWith("plan-")) {
    const planDir = join(ARTIFACTS_DIR, "planning", slot);
    mkdirSync(planDir, { recursive: true });
    extraEnv.MADP_ARTIFACTS_ROOT = planDir;
  }

  const env = {
    ...process.env,
    MADP_RUN_ID: runId,
    MADP_DASHBOARD: "1",
    MADP_TRACE_FILE: join(ARTIFACTS_DIR, ".orchestrator-trace.jsonl"),
    ...extraEnv,
    ...opts.env,
  };

  const child = spawn(PYTHON, ["-m", "MADP.orchestrator.cli.project", ...opts.args], {
    cwd: ENGINE_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state: SlotState = {
    process: child,
    runId,
    cmd,
    startedAt: new Date().toISOString(),
    exitCode: null,
    output: [],
  };
  slots.set(slot, state);

  const onData = (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split("\n");
    for (const line of lines) {
      if (line.trim()) {
        pushLine(slot, runId, line);
        opts.onLine?.(line);
      }
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("close", (code) => {
    state.exitCode = code;
    pushLine(slot, runId, `[engine] Process exited with code ${code}`);
    for (const send of sseClients) {
      try { send(JSON.stringify({ type: "completed", runId, slot, exitCode: code })); } catch { /* */ }
    }
    // Clean up finished planning slots after 5 minutes
    if (slot.startsWith("plan-")) {
      setTimeout(() => { if (slots.get(slot) === state) slots.delete(slot); }, 5 * 60_000);
    }
  });

  return { runId, pid: child.pid!, cmd, slot };
}

/** Get status of a specific slot (default: "build"). */
export function getStatus(slot = "build"): RunStatus {
  const state = slots.get(slot);
  if (!state) {
    return { running: false, runId: "", slot, cmd: "", exitCode: null, output: [] };
  }
  return {
    running: state.process.exitCode === null,
    runId: state.runId,
    slot,
    pid: state.process.pid,
    cmd: state.cmd,
    startedAt: state.startedAt,
    exitCode: state.exitCode,
    output: state.output.slice(-100),
  };
}

/** Get status of all active slots. */
export function getAllStatus(): RunStatus[] {
  return [...slots.entries()].map(([slot, state]) => ({
    running: state.process.exitCode === null,
    runId: state.runId,
    slot,
    pid: state.process.pid,
    cmd: state.cmd,
    startedAt: state.startedAt,
    exitCode: state.exitCode,
    output: state.output.slice(-20),
  }));
}

/** Kill a specific slot. */
export function kill(slot = "build"): boolean {
  const state = slots.get(slot);
  if (state && state.process.exitCode === null) {
    state.process.kill("SIGTERM");
    return true;
  }
  return false;
}

/** Check if the build slot is busy. */
export function isBuildRunning(): boolean {
  const state = slots.get("build");
  return state !== null && state !== undefined && state.process.exitCode === null;
}

/** Subscribe to SSE events from all slots. Returns an unsubscribe function. */
export function subscribeSse(send: (data: string) => void): () => void {
  sseClients.add(send);
  return () => sseClients.delete(send);
}

// ── Run history (from trace JSONL) ───────────────────────────────────────────

export function getRunHistory(projectId: string, limit = 20): RunSummary[] {
  const tracePath = join(ARTIFACTS_DIR, projectId, ".orchestrator-trace.jsonl");
  if (!existsSync(tracePath)) {
    const globalTrace = join(ARTIFACTS_DIR, ".orchestrator-trace.jsonl");
    if (!existsSync(globalTrace)) return [];
    return _parseTrace(globalTrace, limit);
  }
  return _parseTrace(tracePath, limit);
}

function _parseTrace(path: string, limit: number): RunSummary[] {
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  const byRun = new Map<string, RunSummary>();
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.cmd !== "spawn.run") continue;
      const runId = rec.run_id || "unknown";
      if (!byRun.has(runId)) {
        byRun.set(runId, { runId, ts: rec.ts, agents: [], totalCost: 0, status: "running" });
      }
      const summary = byRun.get(runId)!;
      if (rec.event === "completed") {
        summary.agents.push({
          agentId: rec.agent_id || "", moduleId: rec.module_id || "", event: rec.event,
          rc: rec.rc || 0, dur: rec.dur || "", model: rec.model || "", costUsd: rec.cost_usd || 0,
        });
        summary.totalCost += rec.cost_usd || 0;
        if (rec.rc !== 0) summary.status = "failed";
      }
    } catch { /* skip malformed lines */ }
  }
  for (const s of byRun.values()) {
    if (s.status === "running" && s.agents.length > 0) s.status = "completed";
  }
  return Array.from(byRun.values()).reverse().slice(0, limit);
}

// ── Artifact reading ─────────────────────────────────────────────────────────

export function listArtifacts(projectId: string): string[] {
  const dir = join(ARTIFACTS_DIR, projectId);
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  _walkYaml(dir, dir, files);
  return files;
}

function _walkYaml(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && !entry.startsWith(".")) {
      _walkYaml(root, full, out);
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml") || entry.endsWith(".md")) {
      out.push(full.slice(root.length + 1));
    }
  }
}

export function readArtifact(projectId: string, relativePath: string): string | null {
  const full = join(ARTIFACTS_DIR, projectId, relativePath);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

export function listSpecs(projectId: string): string[] {
  const dir = join(ARTIFACTS_DIR, projectId, "specs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md"));
}

export function readSpec(projectId: string, specFile: string): string | null {
  const full = join(ARTIFACTS_DIR, projectId, "specs", specFile);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

// ── Engine paths ─────────────────────────────────────────────────────────────

export const paths = {
  engineRoot: ENGINE_ROOT,
  madpRoot: MADP_ROOT,
  projectsDir: PROJECTS_DIR,
  artifactsDir: ARTIFACTS_DIR,
} as const;

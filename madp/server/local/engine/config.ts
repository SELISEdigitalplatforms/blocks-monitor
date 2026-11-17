// How the local MADP engine runs: on or off, and its pace.
//
//   pace 1    the normal speed: a question is answered in a few seconds, a milestone builds in about two minutes
//   pace 0.5  twice as fast; pace 2 half as fast (any number from 0.05 to 20)
//   enabled   false leaves every job queued ("Waiting for the MADP engine"), as when no engine is connected
//
// Set at start with FACTORY_ENGINE=off and FACTORY_ENGINE_PACE=<n>, or at any time in frontend/data/engine.json
// ({"enabled": true, "pace": 0.5}); the file is re-read every few seconds and wins over the environment.
import fs from "node:fs";
import path from "node:path";

export interface EngineConfig {
  enabled: boolean;
  pace: number;
  /** Ordinary hold-ups of real work: a ticket sent back by the reviewer or the tests now and then. */
  sendBacks: boolean;
}

export const DEFAULT_CONFIG: EngineConfig = { enabled: true, pace: 1, sendBacks: true };

const MIN_PACE = 0.05;
const MAX_PACE = 20;

export function clampPace(n: unknown, fallback = 1): number {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(MAX_PACE, Math.max(MIN_PACE, v));
}

function fromEnv(env: NodeJS.ProcessEnv): EngineConfig {
  const off = /^(off|false|0|no)$/i.test(String(env.FACTORY_ENGINE ?? "").trim());
  return { enabled: !off, pace: clampPace(env.FACTORY_ENGINE_PACE, DEFAULT_CONFIG.pace), sendBacks: !/^(off|false|0|no)$/i.test(String(env.FACTORY_ENGINE_SEND_BACKS ?? "").trim()) };
}

function merge(base: EngineConfig, raw: unknown): EngineConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
    pace: o.pace === undefined ? base.pace : clampPace(o.pace, base.pace),
    sendBacks: typeof o.sendBacks === "boolean" ? o.sendBacks : base.sendBacks,
  };
}

/** The config source: the environment, overridden by data/engine.json (re-read when it changes, at most every 2 s). */
export function engineConfigSource(o: { dataDir: string | null; env?: NodeJS.ProcessEnv }): () => EngineConfig {
  const base = fromEnv(o.env ?? process.env);
  const file = o.dataDir ? path.join(o.dataDir, "engine.json") : null;
  let checkedAt = 0;
  let mtime = -1;
  let current = base;
  return () => {
    if (!file) return current;
    const now = Date.now();
    if (now - checkedAt < 2_000) return current;
    checkedAt = now;
    let m = -1;
    try {
      m = fs.statSync(file).mtimeMs;
    } catch {
      m = -1;
    }
    if (m === mtime) return current;
    mtime = m;
    if (m < 0) {
      current = base;
      return current;
    }
    try {
      current = merge(base, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      current = base;
    }
    return current;
  };
}

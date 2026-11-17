/**
 * Engine capacity and the model account pool: the shapes the engine worker writes (EngineHost, EngineHostSample,
 * AiAccount), the ops answer (platform.engine.status, platform.ai.accounts.list/save) and the Platform sections show.
 *
 * Pure module: no imports, so the server functions can bundle it unchanged.
 */

/** Platform permissions of this area (also listed in rbac.ts PLATFORM_PERMISSIONS, where the super admin gets them). */
export const ENGINE_VIEW_PERMISSION = "platform.engine.view" as const;
export const AI_MANAGE_PERMISSION = "platform.ai.manage" as const;

/** PlatformSetting key of the rotation threshold: an account at or above this share of its limit is rested. */
export const ROTATE_SETTING_KEY = "engine.rotateAtPercent" as const;
export const DEFAULT_ROTATE_AT_PERCENT = 99;
/** The lowest threshold people may set (lower would rest accounts with most of their capacity left). */
export const MIN_ROTATE_AT_PERCENT = 50;

/** The engine writes its host row this often; a row older than STALE_AFTER_MS means the worker stopped reporting. */
export const HEARTBEAT_MS = 30_000;
export const SAMPLE_MS = 60_000;
export const STALE_AFTER_MS = 2 * 60_000;
/** Samples are kept this long (the worker deletes older ones in small batches). */
export const SAMPLE_RETENTION_MS = 7 * 24 * 3_600_000;
/** The status op answers this window of samples per host. */
export const STATUS_WINDOW_MS = 24 * 3_600_000;
export const MAX_SAMPLES_PER_HOST = 24 * 60 + 10;

export const AI_PROVIDERS = ["claude-subscription", "anthropic-api"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_ACCOUNT_STATUSES = ["active", "standby", "cooling", "disabled"] as const;
export type AiAccountStatus = (typeof AI_ACCOUNT_STATUSES)[number];
/** What people may set: "cooling" is the engine's own (it rests an account until its reset). */
export const AI_ACCOUNT_SETTABLE: readonly AiAccountStatus[] = ["active", "standby", "disabled"];

export const AI_LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const AI_NOTE_MAX = 300;

export interface EngineHostView {
  hostId: string;
  name: string;
  lastSeenAt: string;
  cpuPercent: number;
  load1: number;
  load5: number;
  load15: number;
  cpuCount: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  runningJobs: number;
  runningLanes: number;
  activeAgents: number;
  queueLength: number;
  release: string;
  /** Seconds the host has been up. */
  uptime: number;
}

export interface EngineSampleView {
  hostId: string;
  at: string;
  cpuPercent: number;
  memUsedMb: number;
  runningJobs: number;
  activeAgents: number;
}

export interface EngineStatus {
  hosts: EngineHostView[];
  samples: EngineSampleView[];
  /** The server clock when the answer was made (stale checks use it, not the browser's clock). */
  now: string;
  /** True when the samples of at least one host could not be read (the hosts are still answered). */
  samplesFailed?: boolean;
}

export interface AiAccountView {
  itemId: string;
  label: string;
  provider: AiProvider;
  status: AiAccountStatus;
  usage5hPercent: number | null;
  usage7dPercent: number | null;
  resetsAt: string;
  lastUsedAt: string;
  priority: number;
  note: string;
  hostId: string;
}

export interface AiAccountsAnswer {
  accounts: AiAccountView[];
  rotateAtPercent: number;
  rotateIsDefault: boolean;
}

export interface AiAccountChange {
  itemId: string;
  priority?: number;
  status?: AiAccountStatus;
  note?: string;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The rotation threshold from a PlatformSetting value ("99", ["99"], 99); the default when unset or out of range. */
export function parseRotateAt(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (!finite(n)) return DEFAULT_ROTATE_AT_PERCENT;
  const r = Math.round(n);
  return r >= MIN_ROTATE_AT_PERCENT && r <= 100 ? r : DEFAULT_ROTATE_AT_PERCENT;
}

export function checkRotateAt(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (!finite(value) || Math.round(value) !== value) return { ok: false, message: "Enter a whole number." };
  if (value < MIN_ROTATE_AT_PERCENT || value > 100) {
    return { ok: false, message: `Enter a number from ${MIN_ROTATE_AT_PERCENT} to 100.` };
  }
  return { ok: true, value };
}

/** True when the host has not reported for longer than STALE_AFTER_MS (or never). */
export function hostIsStale(lastSeenAt: string, now: number): boolean {
  const at = Date.parse(lastSeenAt);
  return !Number.isFinite(at) || now - at > STALE_AFTER_MS;
}

export const isAiStatus = (v: unknown): v is AiAccountStatus =>
  typeof v === "string" && (AI_ACCOUNT_STATUSES as readonly string[]).includes(v);
export const isAiProvider = (v: unknown): v is AiProvider =>
  typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);

/** A usage share in percent (0..100, one decimal), or null when unknown. */
export function percentOrNull(v: unknown): number | null {
  if (!finite(v) || v < 0) return null;
  return Math.min(100, Math.round(v * 10) / 10);
}

/** A whole-number share for display: 0..100 or null. */
export const pct = (used: number, total: number): number | null =>
  total > 0 && used >= 0 ? Math.min(100, Math.round((used / total) * 100)) : null;

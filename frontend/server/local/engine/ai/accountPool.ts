// The engine's AI account pool: several Claude subscription logins (and the Anthropic API fallback key) on the engine
// host, and which one each lane runs on.
//
// Host layout (no credential ever leaves the host, none is in Blocks or the app; see frontend/README.md):
//   MF_AI_ACCOUNTS_DIR=/srv/madp-factory/secrets/ai-accounts
//     <label>/          one Claude Code config folder per subscription (CLAUDE_CONFIG_DIR), signed in once on the host
//                       with `CLAUDE_CONFIG_DIR=<that folder> claude` → /login. Label: a-z, 0-9 and "-", up to 40.
//                       Private to the engine's user (mode 700), else it is left out.
//   the fallback key    the existing MADP_FALLBACK_KEY_FILE (else ~/.madp/anthropic-fallback.key, mode 600): the
//                       "anthropic-api" account, used only while every subscription rests.
// Without MF_AI_ACCOUNTS_DIR (or with no usable folder in it) there is no pool: every lane runs exactly as before, on
// the host's single login, with its own fallback to the key.
//
// Selection (selectAccount): the subscription with the most headroom below the rotation threshold (PlatformSetting
// engine.rotateAtPercent, default 99) among the "active" ones; equal headroom → lower Priority number first → fewer
// lanes running → least recently used. None → the "standby" ones by the same rule → the API key → none (the lane runs
// as before and the job meets the existing "AI capacity used up" handling). An account at or above the threshold, or
// stopped by its limit, rests ("cooling") until its reset; one with no known reset rests an hour (a 429: 5 minutes).
//
// Measured usage, from what the engine can see (all pluggable; each source only ever raises what it knows):
//   - the lanes' agents print Claude Code's rate_limit_event lines (stream-json: status, resetsAt, rateLimitType,
//     utilization) into their agent logs: laneUsage() reads those of a finished lane;
//   - a lane stopped by the AI capacity (madp.ts laneCapacity: limit, 429, credit): the account rests;
//   - the official lanes' own limit record: each account has its own MADP_FALLBACK_HOME (<state>/<label>), so a limit
//     an agent hit and survived on the key is in <state>/<label>/limit-state.json, and the account rests until then;
//   - a usage probe: MF_AI_USAGE_PROBE names an executable the engine runs every MF_AI_USAGE_PROBE_MS (default 5 min)
//     per subscription with CLAUDE_CONFIG_DIR set to the account's folder; it prints JSON
//     {"five_hour":{"utilization":42,"resets_at":"<ISO>"},"seven_day":{"utilization":10,"resets_at":"<ISO>"}}
//     (utilization in percent). Claude Code has no headless usage command today, so the probe is the operator's.
// Never logs or stores a token, a key or a folder's contents; only labels and numbers.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fallbackKeyFile, readFallbackKey, type CapacityHit } from "../../../api/extraction/claudeCapacity.ts";
import { withConfigDir, withKey } from "../../../api/extraction/runnerContract.ts";
import {
  AI_LABEL, DEFAULT_ROTATE_AT_PERCENT, type AiAccountStatus, type AiProvider,
} from "../../../../src/domain/platformEngine";

export const API_ACCOUNT_LABEL = "api-key";
const HOUR = 3_600_000;
const RATE_REST_MS = 5 * 60_000;
export const DEFAULT_PROBE_EVERY_MS = 5 * 60_000;

export interface PoolAccount {
  label: string;
  provider: AiProvider;
  /** The Claude config folder (subscriptions); null for the API key. */
  dir: string | null;
  /** People's setting from the AiAccount row: active (in rotation), standby (only when no active one can), disabled. */
  setting: Exclude<AiAccountStatus, "cooling">;
  priority: number;
  usage5h: number | null;
  usage7d: number | null;
  /** The account rests until then (epoch ms); null: not resting. */
  coolingUntil: number | null;
  /** The next known reset of its usage windows (epoch ms), for the row's ResetsAt. */
  resetsAt: number | null;
  lastUsedAt: number | null;
  running: number;
}

export interface Selection {
  account: PoolAccount | null;
  /** "subscription" | "standby" | "api" | "none": which rule chose it. */
  via: "subscription" | "standby" | "api" | "none";
}

/** The status the row shows: people's setting, or "cooling" while the engine rests an active/standby account. */
export function effectiveStatus(a: PoolAccount, now: number, rotateAtPercent = DEFAULT_ROTATE_AT_PERCENT): AiAccountStatus {
  if (a.setting === "disabled") return "disabled";
  if (isCooling(a, now, rotateAtPercent)) return "cooling";
  return a.setting;
}

export function isCooling(a: PoolAccount, now: number, rotateAtPercent: number): boolean {
  if (a.coolingUntil !== null && a.coolingUntil > now) return true;
  // usage at or above the threshold rests the account until its reset (when the reset is known and still ahead)
  const used = Math.max(a.usage5h ?? 0, a.usage7d ?? 0);
  return used >= rotateAtPercent && (a.resetsAt === null || a.resetsAt > now);
}

const headroom = (a: PoolAccount): number => 100 - Math.max(a.usage5h ?? 0, a.usage7d ?? 0);

function best(list: PoolAccount[]): PoolAccount | null {
  const sorted = [...list].sort(
    (x, y) => headroom(y) - headroom(x) || x.priority - y.priority || x.running - y.running || (x.lastUsedAt ?? 0) - (y.lastUsedAt ?? 0) || (x.label < y.label ? -1 : 1),
  );
  return sorted[0] ?? null;
}

/** Which account the next lane runs on (see the head of this file). Pure. */
export function selectAccount(accounts: readonly PoolAccount[], o: { rotateAtPercent: number; now: number }): Selection {
  const subs = accounts.filter((a) => a.provider === "claude-subscription" && a.dir && a.setting !== "disabled" && !isCooling(a, o.now, o.rotateAtPercent));
  const active = best(subs.filter((a) => a.setting === "active"));
  if (active) return { account: active, via: "subscription" };
  const standby = best(subs.filter((a) => a.setting === "standby"));
  if (standby) return { account: standby, via: "standby" };
  const api = best(accounts.filter((a) => a.provider === "anthropic-api" && a.setting !== "disabled" && !(a.coolingUntil !== null && a.coolingUntil > o.now)));
  if (api) return { account: api, via: "api" };
  return { account: null, via: "none" };
}

// ── usage from what the lanes print ─────────────────────────────────────────────────────────────────────────────────

export interface UsageReading {
  usage5h?: number;
  usage7d?: number;
  /** epoch ms */
  resetsAt?: number;
  /** A window was refused (status "rejected"): the account is at its limit. */
  rejected?: boolean;
}

const epochMs = (n: number): number => (n < 1e12 ? n * 1000 : n);
const share = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.min(100, Math.round((v <= 1 ? v * 100 : v) * 10) / 10);
};

/** Claude Code's rate_limit_event lines in a text (stream-json output, an agent log): the latest reading per window. */
export function usageFromText(text: string): UsageReading | null {
  const out: UsageReading = {};
  let any = false;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const i = raw.indexOf('"rate_limit_event"');
    if (i < 0) continue;
    const start = raw.indexOf("{");
    if (start < 0) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw.slice(start));
    } catch {
      continue;
    }
    if (ev?.type !== "rate_limit_event") continue;
    const info = (ev.rate_limit_info ?? {}) as Record<string, unknown>;
    const kind = String(info.rateLimitType ?? "");
    const status = String(info.status ?? "").toLowerCase();
    const util = share(info.utilization);
    const value = status === "rejected" ? 100 : util;
    if (/^five_hour/.test(kind) && value !== null) out.usage5h = value;
    else if (/^seven_day/.test(kind) && value !== null) out.usage7d = Math.max(out.usage7d ?? 0, value);
    if (status === "rejected") out.rejected = true;
    if (typeof info.resetsAt === "number" && info.resetsAt > 0) {
      const at = epochMs(info.resetsAt);
      out.resetsAt = status === "rejected" ? at : Math.min(out.resetsAt ?? at, at);
    }
    any = true;
  }
  return any ? out : null;
}

/** The usage the agents of a finished lane saw: their agent logs (written since `since`) under the report folders. */
export function laneUsage(o: { reportDirs: readonly string[]; since: number }): UsageReading | null {
  let found = null as UsageReading | null;
  for (const dir of o.reportDirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".agent.log"));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const file = path.join(dir, name);
        const st = fs.statSync(file);
        if (!st.isFile() || st.mtimeMs < o.since - 2000) continue;
        const size = Math.min(st.size, 2 * 1024 * 1024);
        const buf = Buffer.alloc(size);
        const fd = fs.openSync(file, "r");
        try {
          fs.readSync(fd, buf, 0, size, st.size - size);
        } finally {
          fs.closeSync(fd);
        }
        const r = usageFromText(buf.toString("utf8"));
        if (r) {
          const before: UsageReading = found ?? {};
          found = { ...before, ...r, rejected: Boolean(before.rejected || r.rejected) };
        }
      } catch {
        /* an unreadable log is no evidence */
      }
    }
  }
  return found;
}

/** A usage probe's JSON answer (see the head of this file) as a reading. */
export function parseProbeAnswer(text: string): UsageReading | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const win = (k: string) => (body[k] && typeof body[k] === "object" ? (body[k] as Record<string, unknown>) : null);
  const five = win("five_hour");
  const seven = win("seven_day");
  const out: UsageReading = {};
  // the probe answers percent (0..100), like Claude's own usage page
  const percent = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(100, Math.round(v * 10) / 10) : null);
  const u5 = percent(five?.utilization);
  const u7 = percent(seven?.utilization);
  if (u5 !== null) out.usage5h = u5;
  if (u7 !== null) out.usage7d = u7;
  const resets = [five?.resets_at, seven?.resets_at]
    .map((v) => (typeof v === "string" ? Date.parse(v) : typeof v === "number" ? epochMs(v) : NaN))
    .filter((n) => Number.isFinite(n));
  // the next reset of a window that is the binding one (the fuller window), else the soonest
  if (resets.length) out.resetsAt = (u7 ?? 0) > (u5 ?? 0) && Number.isFinite(resets[1] ?? NaN) ? resets[1]! : Math.min(...resets);
  return u5 === null && u7 === null ? null : out;
}

export type UsageProbe = (account: PoolAccount) => Promise<UsageReading | null>;

/** The operator's probe executable (MF_AI_USAGE_PROBE): run with only PATH, HOME and the account's config folder. */
export function commandProbe(file: string, timeoutMs = 20_000): UsageProbe {
  return (account) =>
    new Promise((resolve) => {
      if (!account.dir) return resolve(null);
      const base: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "" };
      execFile(file, [], { env: withConfigDir(base, account.dir), timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true }, (err, out) => {
        resolve(err ? null : parseProbeAnswer(String(out ?? "")));
      });
    });
}

// ── discovery on the host ───────────────────────────────────────────────────────────────────────────────────────────

export interface Discovered {
  label: string;
  provider: AiProvider;
  dir: string | null;
}

/** The subscriptions under MF_AI_ACCOUNTS_DIR (private folders with a valid label) and the API key account when a
 *  key is stored. Empty when MF_AI_ACCOUNTS_DIR is not set or holds no usable folder: no pool. */
export function discoverAccounts(env: NodeJS.ProcessEnv = process.env, log?: (line: string) => void): Discovered[] {
  const root = String(env.MF_AI_ACCOUNTS_DIR ?? "").trim();
  if (!root) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(root).sort();
  } catch {
    log?.("[engine] AI accounts: MF_AI_ACCOUNTS_DIR cannot be read; the single login is used");
    return [];
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const subs: Discovered[] = [];
  for (const name of names) {
    if (!AI_LABEL.test(name) || name === API_ACCOUNT_LABEL) continue;
    const dir = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (process.platform !== "win32" && uid !== null && (st.uid !== uid || (st.mode & 0o077) !== 0)) {
      log?.(`[engine] AI accounts: ${name} is left out, because other users can open its folder (it must be private to the engine's user, mode 700)`);
      continue;
    }
    subs.push({ label: name, provider: "claude-subscription", dir });
  }
  if (subs.length === 0) return [];
  const api = readFallbackKey(env, log) ? [{ label: API_ACCOUNT_LABEL, provider: "anthropic-api" as const, dir: null }] : [];
  return [...subs, ...api];
}

// ── the pool ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Lease {
  label: string;
  provider: AiProvider;
  /** The lane's environment on this account (never logged). */
  env(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** What the lane showed: its capacity stop (if any) and the usage its agents saw. Ends the lease. */
  done(o?: { capacity?: Pick<CapacityHit, "kind" | "resetsAt"> | null; usage?: UsageReading | null }): void;
}

export interface AccountPool {
  /** The pool's accounts now (copies). */
  accounts(): PoolAccount[];
  rotateAtPercent(): number;
  /** People's settings from the AiAccount rows (label → setting, priority) and the rotation threshold. */
  configure(o: { settings?: ReadonlyMap<string, { setting: PoolAccount["setting"]; priority: number }>; rotateAtPercent?: number }): void;
  /** Looks at the host again: new folders join, removed ones leave (their measurements go with them). */
  rediscover(): void;
  /** The account for the next lane, or null (no pool, or nothing usable: the lane runs as before). */
  lease(): Lease | null;
  /** A reading for an account (a probe, a lane). */
  record(label: string, r: UsageReading): void;
  /** Runs the probe for every subscription whose last probe is older than its interval. */
  probe(): Promise<void>;
}

export interface PoolOptions {
  env?: NodeJS.ProcessEnv;
  /** Where each account's own limit record lives (<stateDir>/<label>/limit-state.json): the lanes' MADP_FALLBACK_HOME. */
  stateDir: string;
  now?: () => number;
  log?: (line: string) => void;
  probe?: UsageProbe | null;
  probeEveryMs?: number;
}

/** The limit the official lanes recorded for an account (its own fallback home), or null. */
function recordedLimit(stateDir: string, label: string, now: number): number | null {
  try {
    const until = Number(JSON.parse(fs.readFileSync(path.join(stateDir, label, "limit-state.json"), "utf8"))?.until);
    return Number.isFinite(until) && epochMs(until) > now ? epochMs(until) : null;
  } catch {
    return null;
  }
}

export function createAccountPool(o: PoolOptions): AccountPool {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => undefined);
  const probeEvery = o.probeEveryMs ?? (Number(env.MF_AI_USAGE_PROBE_MS) > 0 ? Number(env.MF_AI_USAGE_PROBE_MS) : DEFAULT_PROBE_EVERY_MS);
  let rotateAt = DEFAULT_ROTATE_AT_PERCENT;
  let settings: ReadonlyMap<string, { setting: PoolAccount["setting"]; priority: number }> = new Map();
  const list = new Map<string, PoolAccount>();
  const probedAt = new Map<string, number>();
  let lastChoice = "";

  const apply = (a: PoolAccount) => {
    const s = settings.get(a.label);
    a.setting = s?.setting ?? "active";
    a.priority = s?.priority ?? 100;
  };

  function rediscover(): void {
    const found = discoverAccounts(env, log);
    const labels = new Set(found.map((d) => d.label));
    for (const label of [...list.keys()]) if (!labels.has(label)) list.delete(label);
    for (const d of found) {
      const cur = list.get(d.label);
      if (cur) {
        cur.dir = d.dir;
        continue;
      }
      const a: PoolAccount = { ...d, setting: "active", priority: 100, usage5h: null, usage7d: null, coolingUntil: null, resetsAt: null, lastUsedAt: null, running: 0 };
      apply(a);
      list.set(d.label, a);
    }
  }

  /** The lanes' own limit records rest an account too. */
  function readRecords(): void {
    const t = now();
    for (const a of list.values()) {
      if (a.provider !== "claude-subscription") continue;
      const until = recordedLimit(o.stateDir, a.label, t);
      if (until && (a.coolingUntil ?? 0) < until) {
        a.coolingUntil = until;
        a.resetsAt = until;
      }
    }
  }

  function record(label: string, r: UsageReading): void {
    const a = list.get(label);
    if (!a) return;
    const t = now();
    if (r.usage5h !== undefined) a.usage5h = r.usage5h;
    if (r.usage7d !== undefined) a.usage7d = r.usage7d;
    if (r.resetsAt !== undefined && r.resetsAt > t) a.resetsAt = r.resetsAt;
    if (r.rejected) a.coolingUntil = Math.max(a.coolingUntil ?? 0, r.resetsAt && r.resetsAt > t ? r.resetsAt : t + HOUR);
    else if (Math.max(a.usage5h ?? 0, a.usage7d ?? 0) >= rotateAt) a.coolingUntil = Math.max(a.coolingUntil ?? 0, a.resetsAt && a.resetsAt > t ? a.resetsAt : t + HOUR);
    // a reset that has passed: the window starts empty again
    if (a.coolingUntil !== null && a.coolingUntil <= t) {
      a.coolingUntil = null;
      if (a.resetsAt !== null && a.resetsAt <= t) {
        a.usage5h = a.usage5h !== null ? 0 : null;
        a.resetsAt = null;
      }
    }
  }

  rediscover();

  return {
    accounts: () => [...list.values()].map((a) => ({ ...a })),
    rotateAtPercent: () => rotateAt,
    configure(c) {
      if (c.settings) settings = c.settings;
      if (typeof c.rotateAtPercent === "number" && Number.isFinite(c.rotateAtPercent)) rotateAt = c.rotateAtPercent;
      for (const a of list.values()) apply(a);
    },
    rediscover,
    record,
    lease() {
      if (list.size === 0) return null;
      readRecords();
      const t = now();
      // a rest whose time has passed ends (the next reading says how much is used)
      for (const a of list.values()) {
        if (a.coolingUntil !== null && a.coolingUntil <= t) {
          a.coolingUntil = null;
          if (a.resetsAt !== null && a.resetsAt <= t) {
            a.usage5h = a.usage5h !== null ? 0 : null;
            a.resetsAt = null;
          }
        }
      }
      const { account, via } = selectAccount([...list.values()], { rotateAtPercent: rotateAt, now: t });
      const choice = account ? `${account.label} (${via})` : "none";
      if (choice !== lastChoice) {
        log(account ? `[engine] AI accounts: lanes now run on ${choice}` : "[engine] AI accounts: every account rests and no API key is stored; lanes run on the host's own login");
        lastChoice = choice;
      }
      if (!account) return null;
      account.running += 1;
      account.lastUsedAt = t;
      const label = account.label;
      const keyFile = fallbackKeyFile(env);
      let ended = false;
      return {
        label,
        provider: account.provider,
        env(base) {
          if (account.provider === "anthropic-api") {
            const key = readFallbackKey(env, log);
            return key ? withKey(base, key) : base;
          }
          // the account's own limit record (the lanes' auth_fallback): one account's limit never sends another's lanes
          // to the key
          const home = path.join(o.stateDir, label);
          try {
            fs.mkdirSync(home, { recursive: true, mode: 0o700 });
          } catch {
            /* the lane then records nothing; it still runs */
          }
          return { ...withConfigDir(base, account.dir!), MADP_FALLBACK_HOME: home, ...(keyFile ? { MADP_FALLBACK_KEY_FILE: keyFile } : {}) };
        },
        done(r) {
          if (ended) return;
          ended = true;
          const a = list.get(label);
          if (!a) return;
          a.running = Math.max(0, a.running - 1);
          a.lastUsedAt = now();
          if (r?.usage) record(label, r.usage);
          const hit = r?.capacity;
          if (hit) {
            const t2 = now();
            const until = hit.kind === "rate" || hit.kind === "overloaded"
              ? (hit.kind === "rate" ? t2 + RATE_REST_MS : null)
              : hit.resetsAt && hit.resetsAt > t2 ? hit.resetsAt : t2 + HOUR;
            if (until) {
              a.coolingUntil = Math.max(a.coolingUntil ?? 0, until);
              if (hit.kind === "limit") a.resetsAt = a.coolingUntil;
              log(`[engine] AI accounts: ${label} rests until ${new Date(a.coolingUntil).toISOString().slice(0, 16)}Z (${hit.kind})`);
            }
          }
        },
      };
    },
    async probe() {
      if (!o.probe) return;
      const t = now();
      for (const a of list.values()) {
        if (a.provider !== "claude-subscription" || a.setting === "disabled") continue;
        if (t - (probedAt.get(a.label) ?? 0) < probeEvery) continue;
        probedAt.set(a.label, t);
        try {
          const r = await o.probe(a);
          if (r) record(a.label, r);
        } catch {
          /* a probe that fails is no reading */
        }
      }
    },
  };
}

// ── the process's pool (the Blocks worker installs it; the lanes lease from it) ─────────────────────────────────────

const slot = globalThis as { __mfAiAccountPool?: AccountPool | null };

/** The pool the lanes lease from; null when none is installed (local mode, tests, no MF_AI_ACCOUNTS_DIR). */
export function accountPool(): AccountPool | null {
  return slot.__mfAiAccountPool ?? null;
}

/** Installs (or with null removes) the process's pool. Kept on globalThis, so a code reload keeps the measurements. */
export function installAccountPool(pool: AccountPool | null): void {
  slot.__mfAiAccountPool = pool;
}

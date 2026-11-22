// "Out of capacity" for the engine's headless Claude Code calls: the subscription's usage limit (session, weekly,
// 5-hour), a 429 rate limit, an overloaded API (529) or an API key without credit. It is its own outcome, apart from
// every other failure, and the call fails at once (0 tokens) while it lasts.
//
// When it happens and the operator has stored an Anthropic API key for this, the same call runs once more on that key
// (ANTHROPIC_API_KEY in the child's environment only: never in argv, logs, rows or messages). The key file follows the
// official engine's rule (engine/selise-madp/MADP/orchestrator/primitives/auth_fallback.py): MADP_FALLBACK_KEY_FILE,
// else <MADP_FALLBACK_HOME, else ~/.madp>/anthropic-fallback.key, and it is used only while no other user can read it.
// A subscription limit is recorded with its reset in <home>/limit-state.json (the same file the official lanes use), so
// later calls go straight to the key until then. No key: the call fails with CapacityError (code ai.capacity) and a
// plain message, and the job keeps its tries (driver.ts), so people can start it again once the capacity is back (it
// does not start again by itself). The message names only a reset Claude Code gave on that call: the record's own
// guess (one hour when Claude Code gave none) only decides when to try the subscription again, it is never shown.
//
// Unit tests (VITEST) never look at the real home: the fallback is off there unless a test sets MADP_FALLBACK_HOME or
// MADP_FALLBACK_KEY_FILE.
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { withKey } from "./runnerContract.ts";

export const CAPACITY_CODE = "ai.capacity";

export type CapacityKind = "limit" | "rate" | "overloaded" | "credit";

export interface CapacityHit {
  kind: CapacityKind;
  /** When the capacity is back (epoch ms), when Claude Code said so. */
  resetsAt: number | null;
  /** The reset in Claude Code's own words ("7:10pm", "Nov 6, 7pm (Europe/Zurich)") when it gave no exact time. */
  resetsText: string | null;
}

/** The plain message people read when the AI capacity is used up. The job does not start again by itself (driver.ts
 *  failJob hands its try back): people start it again. The web shows its own words for the code (src/blocks/engine/
 *  types.ts failedJobText) and takes the reset from this sentence ("used up until <reset>."), so keep that part. */
export function capacityMessage(hit?: Pick<CapacityHit, "resetsAt" | "resetsText"> | null, o: { now?: number; timeZone?: string } = {}): string {
  const now = o.now ?? Date.now();
  const when = hit?.resetsAt && hit.resetsAt > now ? formatReset(hit.resetsAt, o.timeZone) : hit?.resetsText || "";
  return when
    ? `The engine's AI capacity is used up until ${when}. Nothing was lost; start it again then.`
    : "The engine's AI capacity is used up for now. Nothing was lost; start it again once it is back.";
}

function formatReset(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(ms));
  } catch {
    return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** A call stopped because the AI capacity is used up (and no fallback key helped). */
export class CapacityError extends Error {
  readonly code = CAPACITY_CODE;
  constructor(readonly hit: Pick<CapacityHit, "resetsAt" | "resetsText"> | null) {
    super(capacityMessage(hit));
    this.name = "CapacityError";
  }
}

/** True for a CapacityError and for the job failure made from one (code ai.capacity). */
export function isCapacityError(e: unknown): e is Error & { code: typeof CAPACITY_CODE } {
  return e instanceof Error && (e as { code?: unknown }).code === CAPACITY_CODE;
}

// ── detection ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Claude Code's own words for a subscription limit ("You've hit your weekly limit · resets Nov 6, 7pm"). */
const LIMIT_TEXT = /hit your (?:session |weekly |usage |5-hour |daily |opus |sonnet )?limit|usage limit reached|(?:session|weekly|5-hour|daily|opus|sonnet) limit reached|out of extra usage|\blimit reached\b[^\n]{0,80}\bresets?\b/i;
/** The Anthropic API's own error shapes (never a bare number, which tool output is full of). */
const RATE_TEXT = /API Error:?\s*429\b|\brate_limit_error\b|\b429 Too Many Requests\b|"status"\s*:\s*429\b|"api_error_status"\s*:\s*429\b/i;
const OVERLOADED_TEXT = /\boverloaded_error\b|API Error:?\s*529\b|API Error:?[^\n]{0,20}\bOverloaded\b|Repeated 529|"status"\s*:\s*529\b|"api_error_status"\s*:\s*529\b/i;
const CREDIT_TEXT = /credit balance is too low/i;
const LEGACY_RESET = /usage limit reached\|(\d{9,13})/i;
const RESET_PHRASE = /\bresets?\s+(?:at\s+|on\s+)?([0-9A-Za-z][0-9A-Za-z :,/+_-]{0,40}?(?:\s*\([A-Za-z_/+-]{1,40}\))?)\s*(?=$|[.·|"'\n)\]}]|\s[-–—]\s)/im;

const epochMs = (n: number): number => (n < 1e12 ? n * 1000 : n);

function events(stdout: string): { events: Record<string, unknown>[]; other: string[] } {
  const out: Record<string, unknown>[] = [];
  const other: string[] = [];
  const text = stdout.trim();
  if (!text) return { events: out, other };
  try {
    const one = JSON.parse(text);
    if (one && typeof one === "object" && !Array.isArray(one)) return { events: [one], other };
  } catch {
    /* stream-json: one event per line */
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("{")) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev === "object") {
          out.push(ev);
          continue;
        }
      } catch {
        /* not an event */
      }
    }
    other.push(line);
  }
  return { events: out, other };
}

function resetPhrase(text: string): string | null {
  const m = RESET_PHRASE.exec(text);
  const phrase = m?.[1]?.replace(/[\s,]+$/, "").trim() ?? "";
  if (!phrase || /^in\b/i.test(phrase) || phrase.length > 48) return null;
  return phrase;
}

/** Reads a failed Claude Code run's output (stream-json, json or text) for an out-of-capacity answer. The assistant's
 *  own writing is never read (a Make session may well write about "overloaded" functions); only Claude Code's limit
 *  events, its error result and the text it printed outside the events. */
export function detectCapacity(stdout: string, stderr = ""): CapacityHit | null {
  let resetsAt: number | null = null;
  let rejected = false;
  const { events: evs, other } = events(stdout ?? "");
  const texts: string[] = [stderr ?? "", ...other];
  for (const ev of evs) {
    if (ev.type === "rate_limit_event") {
      const info = (ev.rate_limit_info ?? {}) as Record<string, unknown>;
      if (String(info.status ?? "").toLowerCase() === "rejected") {
        rejected = true;
        if (typeof info.resetsAt === "number" && info.resetsAt > 0) resetsAt = epochMs(info.resetsAt);
      }
    } else if (ev.type === "result" && ev.is_error) {
      texts.push(typeof ev.result === "string" ? ev.result : "");
      if (Array.isArray(ev.errors)) texts.push(ev.errors.map(String).join("\n"));
      if (typeof ev.api_error_status === "number") texts.push(`API Error: ${ev.api_error_status}`);
    }
  }
  const text = texts.filter(Boolean).join("\n");
  const kind: CapacityKind | null = rejected || LIMIT_TEXT.test(text) ? "limit"
    : RATE_TEXT.test(text) ? "rate"
    : OVERLOADED_TEXT.test(text) ? "overloaded"
    : CREDIT_TEXT.test(text) ? "credit"
    : null;
  if (!kind) return null;
  const legacy = LEGACY_RESET.exec(text);
  if (resetsAt === null && legacy) resetsAt = epochMs(Number(legacy[1]));
  const phrase = resetsAt === null ? resetPhrase(text) : null;
  if (resetsAt === null && phrase && /^\d{9,13}$/.test(phrase)) resetsAt = epochMs(Number(phrase));
  return { kind, resetsAt, resetsText: resetsAt === null ? phrase : null };
}

/** Only Claude Code's subscription-limit words, for text that also holds tool output (a lane's stderr, where "rate
 *  limit" may well be GitHub's). */
export function detectLimitText(text: string): CapacityHit | null {
  if (!LIMIT_TEXT.test(text ?? "")) return null;
  const legacy = LEGACY_RESET.exec(text);
  const resetsAt = legacy ? epochMs(Number(legacy[1])) : null;
  return { kind: "limit", resetsAt, resetsText: resetsAt === null ? resetPhrase(text) : null };
}

// ── the official lanes' agent log (cli/quick.py _call_agent) ────────────────────────────────────────────────────────

const CALL_HEADER = /^===== agent call(?: \[([^\]\n]*)\])? \([\d.]+s, rc=(-?\d+)(, auth: fallback API key)?\) =====$/;

/** The capacity that stopped a lane's agent, from its agent log: an agent whose last call failed out of capacity (or
 *  whose fallback-key retry of such a call failed too). A call that hit the limit and then succeeded on the key, or a
 *  later successful call, does not count. */
export function agentLogCapacity(text: string): CapacityHit | null {
  const blocks: { label: string; rc: number; key: boolean; body: string[] }[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = CALL_HEADER.exec(line.trim());
    if (m) blocks.push({ label: m[1] ?? "", rc: Number(m[2]), key: Boolean(m[3]), body: [] });
    else blocks[blocks.length - 1]?.body.push(line);
  }
  const last = new Map<string, { failed: boolean; hit: CapacityHit | null }>();
  for (const b of blocks) {
    const body = b.body.slice(1).join("\n"); // the first line is the runner's argv
    const cut = body.indexOf("\n----- stderr -----\n");
    const out = cut >= 0 ? body.slice(0, cut) : body;
    const err = cut >= 0 ? body.slice(cut + 20) : "";
    const failed = b.rc !== 0;
    const prev = last.get(b.label);
    const own = failed ? detectCapacity(out, err) : null;
    last.set(b.label, { failed, hit: own ?? (failed && b.key && prev?.failed ? prev.hit : null) });
  }
  for (const s of last.values()) if (s.failed && s.hit) return s.hit;
  return null;
}

/** The capacity that stopped a failed lane: its own words, else the agent logs it wrote while it ran. */
export function laneCapacity(o: { texts: string[]; reportDirs: string[]; since: number }): CapacityHit | null {
  const own = detectLimitText(o.texts.join("\n"));
  let found: CapacityHit | null = null;
  for (const dir of o.reportDirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".agent.log"));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || st.mtimeMs < o.since - 2000) continue;
        const size = Math.min(st.size, 4 * 1024 * 1024);
        const buf = Buffer.alloc(size);
        const fd = fs.openSync(file, "r");
        try {
          fs.readSync(fd, buf, 0, size, st.size - size);
        } finally {
          fs.closeSync(fd);
        }
        found = agentLogCapacity(buf.toString("utf8")) ?? found;
      } catch {
        /* an unreadable log is no evidence */
      }
    }
  }
  if (!found) return own;
  return own && found.resetsAt === null && found.resetsText === null ? { ...found, resetsAt: own.resetsAt, resetsText: own.resetsText } : found;
}

// ── the fallback key and the recorded limit ─────────────────────────────────────────────────────────────────────────

function fallbackHome(env: NodeJS.ProcessEnv): string {
  const set = String(env.MADP_FALLBACK_HOME ?? "").trim();
  if (set) return set;
  if (env.VITEST) return "";
  try {
    return path.join(homedir(), ".madp");
  } catch {
    return "";
  }
}

/** The fallback key file the engine and the lanes use (MADP_FALLBACK_KEY_FILE, else <fallback home>/anthropic-fallback.key), "" when none. */
export function fallbackKeyFile(env: NodeJS.ProcessEnv = process.env): string {
  return keyFile(env);
}

function keyFile(env: NodeJS.ProcessEnv): string {
  const set = String(env.MADP_FALLBACK_KEY_FILE ?? "").trim();
  if (set) return set;
  const home = fallbackHome(env);
  return home ? path.join(home, "anthropic-fallback.key") : "";
}

function stateFile(env: NodeJS.ProcessEnv): string {
  const home = fallbackHome(env);
  return home ? path.join(home, "limit-state.json") : "";
}

/** The stored fallback key, or "" (no file, unreadable, readable by other users, or not a key). Never logged. */
export function readFallbackKey(env: NodeJS.ProcessEnv = process.env, log?: (line: string) => void): string {
  const file = keyFile(env);
  if (!file) return "";
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return "";
  }
  if (!st.isFile()) return "";
  if (process.platform !== "win32" && typeof process.getuid === "function" && (st.uid !== process.getuid() || (st.mode & 0o077) !== 0)) {
    log?.("AI capacity: the fallback API key file is ignored, because other users can read it (it must be private to the engine's user, mode 600)");
    return "";
  }
  try {
    const key = fs.readFileSync(file, "utf8").trim();
    return /^[\x21-\x7e]{8,512}$/.test(key) ? key : "";
  } catch {
    return "";
  }
}

/** Until when a recorded subscription limit lasts (epoch ms), or null when none is recorded or it has reset. */
export function limitUntil(env: NodeJS.ProcessEnv = process.env, now = Date.now()): number | null {
  const file = stateFile(env);
  if (!file) return null;
  try {
    const until = Number(JSON.parse(fs.readFileSync(file, "utf8"))?.until);
    return Number.isFinite(until) && epochMs(until) > now ? epochMs(until) : null;
  } catch {
    return null;
  }
}

/** Records a subscription limit until its reset (one hour when Claude Code gave none), like auth_fallback.mark. */
export function markLimit(resetsAt: number | null, env: NodeJS.ProcessEnv = process.env, now = Date.now()): void {
  const file = stateFile(env);
  if (!file) return;
  const until = resetsAt && resetsAt > now ? resetsAt : now + 3_600_000;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ until: until / 1000 }), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* the record only saves later calls a first try */
  }
}

/** The child's environment on the fallback key instead of the subscription login (auth_fallback.with_key). It lives in
 *  runnerContract.ts, the runner file the engine's privacy guard approves for naming the login setting. */
export { withKey };

/** The fallback settings a child engine process (the official lanes) needs to find the same key and record. */
export function fallbackSettings(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of ["MADP_FALLBACK_HOME", "MADP_FALLBACK_KEY_FILE"] as const) if (String(env[k] ?? "").trim()) out[k] = env[k];
  return out;
}

// ── one call with the fallback ──────────────────────────────────────────────────────────────────────────────────────

/** One finished CLI process: execFile's error (null when it exited 0) and what it printed. */
export interface CliRun {
  error: (Error & { code?: unknown; killed?: boolean }) | null;
  stdout: string;
  stderr: string;
}

/** True when the CLI ran and answered with a failure (not a launch error, a timeout or a cancel). */
function ranAndFailed(r: CliRun): boolean {
  if (r.error) return r.error.code !== "ENOENT" && r.error.name !== "AbortError" && !r.error.killed;
  return /"is_error"\s*:\s*true/.test(r.stdout);
}

const scrub = (r: CliRun, key: string): CliRun => {
  if (!key) return r;
  const clean = (s: string) => s.split(key).join("<redacted>");
  const error = r.error ? Object.assign(r.error, { message: clean(r.error.message) }) : null;
  return { error, stdout: clean(r.stdout), stderr: clean(r.stderr) };
};

/** Runs a Claude Code call; out of capacity, once more on the fallback key, else throws CapacityError. Every other
 *  outcome (success, failure, timeout, cancel, launch error) is the caller's to read, as before. */
export async function runWithCapacityFallback(o: {
  env: NodeJS.ProcessEnv;
  run: (env: NodeJS.ProcessEnv) => Promise<CliRun>;
  log?: (line: string) => void;
  /** Where the fallback settings come from (default process.env). */
  settings?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<CliRun & { usedKey: boolean }> {
  const settings = o.settings ?? process.env;
  const now = o.now ?? Date.now;
  const recorded = limitUntil(settings, now());
  // a recorded limit that has not reset yet: straight to the key (as the official lanes do)
  let key = recorded ? readFallbackKey(settings, o.log) : "";
  const first = await o.run(key ? withKey(o.env, key) : o.env);
  const hit = ranAndFailed(first) ? detectCapacity(first.stdout, first.stderr) : null;
  if (!hit) return { ...scrub(first, key), usedKey: Boolean(key) };
  // only the reset Claude Code gave on this call: the recorded limit may be the one-hour guess (markLimit, and the
  // official lanes' auth_fallback.mark write the same file without saying which), so it is never shown as the reset
  const reset = { resetsAt: hit.resetsAt, resetsText: hit.resetsText };
  if (key) {
    o.log?.(`AI capacity: the fallback API key is out of capacity too (${hit.kind})`);
    throw new CapacityError(reset);
  }
  if (hit.kind === "limit") markLimit(hit.resetsAt, settings, now());
  key = readFallbackKey(settings, o.log);
  if (!key) {
    o.log?.(`AI capacity: used up (${hit.kind}), no fallback API key is set`);
    throw new CapacityError(reset);
  }
  o.log?.(`AI capacity: used up (${hit.kind}); trying once more on the fallback API key`);
  const second = scrub(await o.run(withKey(o.env, key)), key);
  if (!ranAndFailed(second)) return { ...second, usedKey: true };
  o.log?.(`AI capacity: the call failed on the fallback API key too${detectCapacity(second.stdout, second.stderr) ? " (out of capacity)" : ""}`);
  throw new CapacityError(reset);
}

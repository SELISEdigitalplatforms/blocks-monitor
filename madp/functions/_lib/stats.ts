// Per-request gateway counters for the Host A log line (dev only): how many Data Gateway calls one operation made,
// the sum of their durations, and how many of them ran one after another. Counts only; no values, no secrets.
import type { RawGateway } from "./gateway";
import { OpError } from "./errors";

/** One gateway call that hit its own deadline (see deadline.ts). */
export interface UnfinishedCall {
  schema: string;
  method: string;
  ms: number;
}

export interface GatewayStats {
  /** Gateway calls made. */
  count: number;
  /** Sum of the call durations (parallel calls add up). */
  ms: number;
  /** Longest chain of calls that ran one after another. */
  depth: number;
  /** "cached", "fetched <ms>ms" or "-" when the request never needed the service token. */
  svcToken: string;
  /** The settled calls (at most 64): what was called, how long it took and its depth. */
  calls: { label: string; ms: number; depth: number }[];
  /** HTTP requests sent to the Data Gateway (a batch of reads counts once). */
  requests: number;
  /** Read roots that travelled inside a multi-root batch request. */
  batchedRoots: number;
  /** The depth when the router invoked the handler (set by the router). */
  handlerStart?: number;
  /** The depth when the handler resolved (set by the router). */
  handlerEnd?: number;
  /** The calls started and not yet settled, by start sequence number. */
  inFlight?: Map<number, { label: string; started: number; depth: number }>;
  /** The calls that hit their deadline (at most 64). */
  unfinished?: UnfinishedCall[];
  /** Told at once, for every call that hits its deadline (set by the host). */
  onUnfinished?: (u: UnfinishedCall) => void;
}

/** The most sequential gateway rounds one operation may take. */
export const ROUND_BUDGET = 3;

/** The rounds the handler itself took, or undefined when the router did not mark both ends. */
export function handlerRounds(s: GatewayStats): number | undefined {
  if (s.handlerStart === undefined || s.handlerEnd === undefined) return undefined;
  return Math.max(0, s.handlerEnd - s.handlerStart);
}

const MAX_TRACED_CALLS = 64;

export function createGatewayStats(): GatewayStats {
  return { count: 0, ms: 0, depth: 0, svcToken: "-", requests: 0, batchedRoots: 0, calls: [], inFlight: new Map(), unfinished: [] };
}

/** The calls still open at `now`, in start order (at most 64). */
export function openCalls(stats: GatewayStats, now: number): { label: string; ms: number; depth: number }[] {
  const out: { label: string; ms: number; depth: number }[] = [];
  for (const c of stats.inFlight?.values() ?? []) {
    if (out.length >= MAX_TRACED_CALLS) break;
    out.push({ label: c.label, ms: Math.max(0, now - c.started), depth: c.depth });
  }
  return out;
}

let nextCallId = 0;

/** Records a call that hit its deadline and tells the host; never throws. */
export function recordUnfinished(stats: GatewayStats, u: UnfinishedCall): void {
  try {
    if (!stats.unfinished) stats.unfinished = [];
    if (stats.unfinished.length < MAX_TRACED_CALLS) stats.unfinished.push(u);
    stats.onUnfinished?.(u);
  } catch {
    /* logging must never break a request */
  }
}

/** `[gw] unfinished Membership.find 9001ms project.scope.save` */
export function formatGwUnfinished(e: { fn: string; op?: string } & UnfinishedCall): string {
  return `[gw] unfinished ${e.schema}.${e.method} ${e.ms}ms ${e.fn}${e.op ? "." + e.op : ""}`;
}

const METHODS = ["get", "find", "findAll", "insert", "insertMany", "update", "updateMany", "remove"] as const;

/** The class and code of a failure, never its message (it can carry values). */
function diagnose(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const cls = cause && typeof cause === "object" ? ((cause as { name?: unknown }).name ?? cause.constructor?.name) : typeof cause;
  const status = (cause as { status?: unknown } | null)?.status;
  const code = (cause as { code?: unknown } | null)?.code;
  const safe = (x: unknown): string => String(x).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return `class=${safe(cls)}${typeof status === "number" ? ` status=${status}` : ""}${typeof code === "string" ? ` code=${safe(code)}` : ""}`;
}

/** The same gateway, logging one sanitized line (`[gw] internal <schema>.<method> class=.. status=..`) for every call that fails as `internal`. */
export function logInternal(raw: RawGateway, log: (line: string) => void): RawGateway {
  const out = {} as Record<string, unknown>;
  for (const method of METHODS) {
    out[method] = async (...args: unknown[]): Promise<unknown> => {
      try {
        return await (raw[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        if (error instanceof OpError && error.code === "internal") {
          log(`[gw] internal ${typeof args[0] === "string" ? args[0].replace(/[^A-Za-z0-9_]/g, "") : ""}.${method} ${diagnose(error)}`);
        }
        throw error;
      }
    };
  }
  return out as unknown as RawGateway;
}

/** The same gateway, counting every call into `stats`. A call's depth is one more than the deepest call finished before it started. */
export function countGateway(raw: RawGateway, stats: GatewayStats, now: () => number = Date.now): RawGateway {
  let settled = 0;
  const out = {} as Record<string, unknown>;
  for (const method of METHODS) {
    out[method] = (...args: unknown[]): Promise<unknown> => {
      const depth = settled + 1;
      const label = `${method}:${typeof args[0] === "string" ? args[0] : ""}`;
      const started = now();
      stats.count += 1;
      if (!stats.inFlight) stats.inFlight = new Map();
      const id = nextCallId++;
      stats.inFlight.set(id, { label, started, depth });
      const done = (): void => {
        stats.inFlight?.delete(id);
        const took = Math.max(0, now() - started);
        stats.ms += took;
        if (stats.calls.length < MAX_TRACED_CALLS) stats.calls.push({ label, ms: took, depth });
        settled = Math.max(settled, depth);
        stats.depth = settled;
      };
      let pending: Promise<unknown>;
      try {
        pending = (raw[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        done();
        throw error;
      }
      return pending.then(
        (value) => {
          done();
          return value;
        },
        (error: unknown) => {
          done();
          throw error;
        },
      );
    };
  }
  return out as unknown as RawGateway;
}

export interface FnLogFields {
  fn: string;
  op?: string;
  status: number;
  ms: number;
  gw?: { count: number; ms: number };
  svcToken?: string;
  rounds?: number;
  handler?: number;
  overBudget?: boolean;
  slowest?: { label: string; ms: number };
  net?: { opened: number; reused: number; connectMs: number };
  cache?: "hit" | "shared" | "miss";
  calls?: { label: string; ms: number; depth: number }[];
  unfinished?: number;
  requests?: number;
  /** Calls still open when the answer was written. */
  open?: { label: string; ms: number; depth: number }[];
}

/** `[fn] workspace.create 200 812ms gw=3/640ms svcToken=cached` (the status is the HTTP status), then only the extra fields that are present. */
export function formatFnLogLine(e: FnLogFields): string {
  const gw = e.gw ?? { count: 0, ms: 0 };
  let line = `[fn] ${e.fn}${e.op ? "." + e.op : ""} ${e.status} ${e.ms}ms gw=${gw.count}/${gw.ms}ms svcToken=${e.svcToken ?? "-"}`;
  if (e.rounds !== undefined) line += ` rounds=${e.rounds}`;
  if (e.handler !== undefined) line += ` handler=${e.handler}`;
  if (e.overBudget === true) line += " over-budget";
  if (e.slowest) line += ` slowest=${e.slowest.label}:${e.slowest.ms}ms`;
  if (e.net) line += ` net=${e.net.opened}new/${e.net.reused}reused/${e.net.connectMs}ms`;
  if (e.cache) line += ` cache=${e.cache}`;
  if (e.unfinished !== undefined && e.unfinished > 0) line += ` unfinished=${e.unfinished}`;
  if (e.open && e.open.length > 0) line += ` open=${e.open.length}`;
  return line;
}

/** `[gw] workspace.me.bootstrap find:Members 120ms d1, ...` in start order, or null when no call was recorded. */
export function formatGwTrace(e: FnLogFields): string | null {
  const calls = e.calls ?? [];
  const open = e.open ?? [];
  if (!calls.length && !open.length) return null;
  // Depth never decreases from one start to the next, so a stable sort by depth restores the start order.
  const ordered = calls.map((c, i) => ({ c, i })).sort((a, b) => a.c.depth - b.c.depth || a.i - b.i);
  const req = e.requests !== undefined ? ` req=${e.requests}` : "";
  const parts = [...ordered.map(({ c }) => `${c.label} ${c.ms}ms d${c.depth}`), ...open.map((c) => `${c.label} open ${c.ms}ms d${c.depth}`)];
  return `[gw] ${e.fn}${e.op ? "." + e.op : ""} ${parts.join(", ")}${req}`;
}

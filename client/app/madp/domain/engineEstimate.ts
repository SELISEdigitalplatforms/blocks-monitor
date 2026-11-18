// Real build estimates (owner 15.11.2026: "Those estimations should be real"). The official MADP engine does the work
// of a build, so the honest estimate is how long the engine runs for it and what that costs, measured from the builds
// it finished before. No person-hours and never an invented default (pure; shared by the server op, the engine host's
// planner and the screens):
//
//   - a MEASURED build: a milestone build (build.run) or a change build (change.build: a change request, its fix rounds,
//     a revert) that succeeded on the engine, whose UsageJson records the engine's tokens or cost (so it ran on the
//     engine, not before it existed) and whose start and finish are known; a run that only finished the steps after an
//     earlier deploy is no build. Its tickets are the Ticket refs of its OutputRefs.
//   - its KIND: "fix" for a change request in the fix or change lane (their tickets are fix tickets), "feature" for a
//     milestone and for an added or enhanced feature (story and task tickets). A ticket's kind follows its type.
//   - per kind, a straight line through the measured builds, fitted by Theil-Sen (the median of the pairwise slopes, so
//     a few odd runs do not pull it): engine minutes = the per-build part (planning, gates, integration, deploy) + the
//     per-ticket part x tickets. The range is the RANGE_QUANTILES (20th to 80th percentile) of measured / estimated over
//     the same builds. The engine's measured cost (USD) is fitted the same way.
//   - a kind with fewer than MIN_MEASURED_BUILDS measured builds uses every kind together ("pooled"); with fewer than
//     that in all there is no estimate (null) and the screens say so instead of showing a number.
//
// ENGINE TIME is a build's running time on the engine, from its start to its finish: its agents work side by side
// inside it, so it is neither the sum of the agents' own minutes nor the calendar time until a person accepts the
// milestone. A ticket's estimate is the engine time it adds to its build; a build's estimate is its per-build part plus
// the parts of its tickets, so a build's tickets always add up to it.
import { parseJobUsage } from "./billing";

export const ESTIMATE_KINDS = ["feature", "fix"] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

/** The engine job kinds that are builds. */
export const ESTIMATE_JOB_KINDS = ["build.run", "change.build"] as const;
/** Below this many measured builds a kind has no line of its own (and all kinds together none at all). */
export const MIN_MEASURED_BUILDS = 10;
/** How many of the newest finished builds the calibration reads. */
export const CALIBRATION_WINDOW = 500;
/** The range shown around an estimate: these percentiles of measured / estimated. */
export const RANGE_QUANTILES = [0.2, 0.8] as const;
/** A measured run longer than this is a stuck job, not a build time. */
const MAX_BUILD_MINUTES = 24 * 60;

/** One build the engine finished, as far as the estimate needs it. */
export interface MeasuredBuild {
  /** null: a change build whose change request (lane) is not known; it counts only for all kinds together */
  kind: EstimateKind | null;
  tickets: number;
  /** engine time: its finish minus its start */
  minutes: number;
  /** the engine's measured cost; null when none was recorded */
  costUsd: number | null;
  finishedAt: string;
}

/** value = base + perTicket x tickets; [low, high] are the factors of the range around it. */
export interface EstimateLine {
  base: number;
  perTicket: number;
  low: number;
  high: number;
  /** the measured builds behind the line */
  builds: number;
  /** the most tickets one of them had */
  maxTickets: number;
}

export interface EstimateFit {
  /** measured builds of this kind (also when too few for a line) */
  builds: number;
  /** engine minutes */
  time: EstimateLine | null;
  /** USD */
  cost: EstimateLine | null;
}

export interface EstimateCalibration {
  v: 1;
  /** measured builds read */
  builds: number;
  /** finish of the oldest and the newest of them */
  from: string | null;
  to: string | null;
  minBuilds: number;
  all: EstimateFit;
  feature: EstimateFit;
  fix: EstimateFit;
}

export interface EstimateRange {
  value: number;
  low: number;
  high: number;
}

export interface BuildEstimate {
  kind: EstimateKind;
  tickets: number;
  /** engine minutes */
  minutes: EstimateRange;
  /** USD; null when too few builds recorded their cost */
  costUsd: EstimateRange | null;
  /** the per-build part (planning, gates, integration, deploy), minutes */
  baseMinutes: number;
  /** what the tickets add, minutes */
  ticketMinutes: number;
  /** measured builds behind the time line */
  builds: number;
  /** the line is every kind's together (this kind has too few builds of its own) */
  pooled: boolean;
  /** more tickets than any measured build had: the line is carried beyond what was measured */
  beyond: boolean;
}

export interface TicketEstimate {
  kind: EstimateKind;
  /** the engine minutes the ticket adds to its build */
  minutes: EstimateRange;
  costUsd: EstimateRange | null;
  /** its build's own per-build part, minutes (for the explanation) */
  baseMinutes: number;
  builds: number;
  pooled: boolean;
}

// ------------------------------------------------------------------ reading a job row

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function inputOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function refsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** A change request's lane as a kind: fix and change build fix tickets, add and enhance (and an imported "feature")
 *  build stories; anything else is not known. */
export function kindOfLane(lane: unknown): EstimateKind | null {
  const l = str(lane).trim().toLowerCase();
  if (l === "fix" || l === "change") return "fix";
  if (l === "add" || l === "enhance" || l === "feature") return "feature";
  return null;
}

/** A ticket's kind by its type: a fix ticket is a fix, a story or a task is feature work. */
export const kindOfTicket = (type: unknown): EstimateKind => (type === "fix" ? "fix" : "feature");

/** A build's kind by its tickets' types: a fix when every ticket is a fix, else feature work. */
export const kindOfTickets = (types: readonly unknown[]): EstimateKind => (types.length > 0 && types.every((x) => x === "fix") ? "fix" : "feature");

/** The change request an EngineJob row works on (its input's changeRequestId), or "". */
export const changeRequestOfJob = (row: Record<string, unknown>): string => str(inputOf(row.InputJson).changeRequestId);

/** One EngineJob row as a measured build, or null when it is not one (see the header). `laneOf` answers a change
 *  request's lane (null when not known). */
export function measuredBuildOf(row: Record<string, unknown>, laneOf: (changeRequestId: string) => string | null = () => null): MeasuredBuild | null {
  const jobKind = str(row.Kind);
  if (!(ESTIMATE_JOB_KINDS as readonly string[]).includes(jobKind) || row.Status !== "succeeded") return null;
  const input = inputOf(row.InputJson);
  if (input.afterDeploy === true) return null;
  const usage = parseJobUsage(row.UsageJson);
  if (!usage || (usage.tokens.total <= 0 && usage.costUsd <= 0)) return null;
  const start = Date.parse(str(row.StartedAt) || str(row.ClaimedAt));
  const finish = Date.parse(str(row.FinishedAt));
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  const minutes = (finish - start) / 60_000;
  if (!(minutes > 0) || minutes > MAX_BUILD_MINUTES) return null;
  const tickets = new Set(refsOf(row.OutputRefs).filter((r) => /^Ticket:./.test(r))).size;
  if (tickets === 0) return null;
  let kind: EstimateKind | null = "feature";
  if (jobKind === "change.build") {
    const crId = str(input.changeRequestId);
    kind = kindOfLane((crId ? laneOf(crId) : null) ?? input.lane);
  }
  return { kind, tickets, minutes, costUsd: usage.costUsd > 0 ? usage.costUsd : null, finishedAt: new Date(finish).toISOString() };
}

// ------------------------------------------------------------------ the fit

/** The p-quantile of the values (linear between neighbours); NaN for none. */
export function quantile(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const i = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;

/** The Theil-Sen line through (tickets, value) and its range factors; null below MIN_MEASURED_BUILDS points. The
 *  slope is never below zero (another ticket never makes a build shorter) and the per-build part never below zero. */
export function fitLine(points: readonly (readonly [number, number])[], min = MIN_MEASURED_BUILDS): EstimateLine | null {
  const pts = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0);
  if (pts.length < Math.max(1, min)) return null;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[j]![0] - pts[i]![0];
      if (dx !== 0) slopes.push((pts[j]![1] - pts[i]![1]) / dx);
    }
  }
  const perTicket = Math.max(0, slopes.length ? quantile(slopes, 0.5) : 0);
  const base = Math.max(0, quantile(pts.map(([x, y]) => y - perTicket * x), 0.5));
  const ratios = pts.map(([x, y]) => y / Math.max(1e-6, base + perTicket * x));
  return {
    base: round(base),
    perTicket: round(perTicket),
    low: round(Math.min(1, quantile(ratios, RANGE_QUANTILES[0]))),
    high: round(Math.max(1, quantile(ratios, RANGE_QUANTILES[1]))),
    builds: pts.length,
    maxTickets: Math.max(...pts.map(([x]) => x)),
  };
}

function fitOf(builds: readonly MeasuredBuild[], min: number): EstimateFit {
  return {
    builds: builds.length,
    time: fitLine(builds.map((b) => [b.tickets, b.minutes] as const), min),
    cost: fitLine(builds.flatMap((b) => (b.costUsd !== null ? [[b.tickets, b.costUsd] as const] : [])), min),
  };
}

/** The calibration from measured builds (any order). */
export function calibrate(builds: readonly MeasuredBuild[], min = MIN_MEASURED_BUILDS): EstimateCalibration {
  const times = builds.map((b) => b.finishedAt).filter(Boolean).sort();
  return {
    v: 1,
    builds: builds.length,
    from: times[0] ?? null,
    to: times[times.length - 1] ?? null,
    minBuilds: min,
    all: fitOf(builds, min),
    feature: fitOf(builds.filter((b) => b.kind === "feature"), min),
    fix: fitOf(builds.filter((b) => b.kind === "fix"), min),
  };
}

// ------------------------------------------------------------------ estimates

function lineOf(cal: EstimateCalibration, kind: EstimateKind, what: "time" | "cost"): { line: EstimateLine; pooled: boolean } | null {
  const own = cal[kind]?.[what] ?? null;
  if (own) return { line: own, pooled: false };
  const all = cal.all?.[what] ?? null;
  return all ? { line: all, pooled: true } : null;
}

const rangeOf = (value: number, line: EstimateLine): EstimateRange => ({ value, low: value * line.low, high: value * line.high });

/** What one ticket adds to its build's engine time and cost; null without enough history. */
export function estimateTicket(cal: EstimateCalibration | null | undefined, type: unknown): TicketEstimate | null {
  if (!cal) return null;
  const kind = kindOfTicket(type);
  const time = lineOf(cal, kind, "time");
  if (!time) return null;
  const cost = lineOf(cal, kind, "cost");
  return {
    kind,
    minutes: rangeOf(time.line.perTicket, time.line),
    costUsd: cost ? rangeOf(cost.line.perTicket, cost.line) : null,
    baseMinutes: time.line.base,
    builds: time.line.builds,
    pooled: time.pooled,
  };
}

/** The engine time and cost of one build of these tickets (their types); null without tickets or enough history.
 *  The per-build part follows the build's kind; each ticket adds its own kind's per-ticket part. */
export function estimateBuild(cal: EstimateCalibration | null | undefined, types: readonly unknown[]): BuildEstimate | null {
  if (!cal || types.length === 0) return null;
  const kind = kindOfTickets(types);
  const time = lineOf(cal, kind, "time");
  if (!time) return null;
  let ticketMinutes = 0;
  for (const type of types) {
    const own = lineOf(cal, kindOfTicket(type), "time");
    ticketMinutes += (own ?? time).line.perTicket;
  }
  const minutes = time.line.base + ticketMinutes;
  const cost = lineOf(cal, kind, "cost");
  let costUsd: EstimateRange | null = null;
  if (cost) {
    let perTickets = 0;
    for (const type of types) perTickets += (lineOf(cal, kindOfTicket(type), "cost") ?? cost).line.perTicket;
    costUsd = rangeOf(cost.line.base + perTickets, cost.line);
  }
  return {
    kind,
    tickets: types.length,
    minutes: rangeOf(minutes, time.line),
    costUsd,
    baseMinutes: time.line.base,
    ticketMinutes,
    builds: time.line.builds,
    pooled: time.pooled,
    beyond: types.length > time.line.maxTickets,
  };
}

/** Ticket.EstimateHours for a planned ticket: the engine minutes it adds to its build, as a fraction of an hour (no
 *  schema change); undefined without enough history (the field is then left out: never a made-up number). */
export function ticketEstimateHours(cal: EstimateCalibration | null | undefined, type: unknown): number | undefined {
  const e = estimateTicket(cal, type);
  return e ? round(e.minutes.value / 60) : undefined;
}

/** Board.PlanHours: the engine time of every milestone's build of the plan, in hours; undefined without enough history. */
export function planEstimateHours(cal: EstimateCalibration | null | undefined, builds: readonly (readonly unknown[])[]): number | undefined {
  let minutes = 0;
  let any = false;
  for (const types of builds) {
    if (types.length === 0) continue;
    const e = estimateBuild(cal, types);
    if (!e) return undefined;
    minutes += e.minutes.value;
    any = true;
  }
  return any ? round(minutes / 60) : undefined;
}

/** Minutes in plain English for the engine's own texts (the agents' chat answers are written in English): "45 seconds"
 *  (to 5 s), "1 minute", "19 minutes", "1 hour 5 minutes". The screens use their own translated words. */
export function minutesInWords(minutes: number): string {
  const seconds = Math.max(5, Math.round((Math.max(0, minutes) * 60) / 5) * 5);
  if (seconds < 60) return `${seconds} seconds`;
  const total = Math.max(1, Math.round(minutes));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (total < 60) return unit(total, "minute");
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
}

// ------------------------------------------------------------------ the wire

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function lineFrom(v: unknown): EstimateLine | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base = num(o.base), perTicket = num(o.perTicket), low = num(o.low), high = num(o.high), builds = num(o.builds), maxTickets = num(o.maxTickets);
  if (base === null || perTicket === null || low === null || high === null || builds === null || maxTickets === null) return null;
  if (base < 0 || perTicket < 0 || low <= 0 || high < low || builds < 1) return null;
  return { base, perTicket, low, high, builds, maxTickets };
}

function fitFrom(v: unknown): EstimateFit {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { builds: Math.max(0, num(o.builds) ?? 0), time: lineFrom(o.time), cost: lineFrom(o.cost) };
}

/** The server's answer (engine.estimates) as a calibration, or null when it is not one. */
export function parseCalibration(v: unknown): EstimateCalibration | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || num(o.builds) === null) return null;
  return {
    v: 1,
    builds: num(o.builds)!,
    from: typeof o.from === "string" ? o.from : null,
    to: typeof o.to === "string" ? o.to : null,
    minBuilds: num(o.minBuilds) ?? MIN_MEASURED_BUILDS,
    all: fitFrom(o.all),
    feature: fitFrom(o.feature),
    fix: fitFrom(o.fix),
  };
}

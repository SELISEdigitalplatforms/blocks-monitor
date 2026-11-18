/** The Build step's Studio and Timeline, as pure functions over real records only: the build EngineJob (a milestone's
 *  build.run or a change request's change.build: status, progress, message, claim and finish times), the Ticket rows it
 *  works on (current column) and their TicketEvent rows (column moves, notes, artifacts). Nothing here invents a time,
 *  a count or a state: a stage, clip, gate or feed line exists only when a record says so. */
import { STAGES, type StageState, type StageStatus } from "@/madp/data/pipeline";
import type { ChipTone, StageId } from "@/madp/data/types";
import { TICKET_COLUMNS, changeCode, type TicketColumn } from "@/madp/domain/delivery";
import { incrementsOf, nextIncrement, parseChangeAnalysis, planIndexOf } from "@/madp/domain/changeAnalysis";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import { deployedNothing, isAfterDeployRetry, jobAttention, newestDelivered, openAttention, type AfterDeployAttention } from "@/madp/domain/afterDeploy";
import { baseJobOf, isFixRound, isRevert } from "@/madp/domain/changeChecks";
import type { DeliveryChangeRequest, DeliveryMilestone, DeliveryTicket, DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import { agentName, agentStage } from "@/madp/components/board/blocksBoard";
import { t } from "@/madp/i18n";
import { changeWords, type StepChangeBuild, type StepTests } from "./buildStep";

/* ── stages and columns ───────────────────────────────────────────────────── */

/** The board column each pipeline stage works in (Plan = the planned tickets). Release to dev has no column: its track is
 *  the milestone's preview.deploy job. */
export const STAGE_COLUMN: Partial<Record<StageId, TicketColumn>> = {
  "01": "planned", "02": "dev", "03": "review", "04": "test", "05": "security", "06": "docs", "07": "gate",
};
export const COLUMN_STAGE: Record<TicketColumn, StageId> = {
  planned: "01", dev: "02", review: "03", test: "04", security: "05", docs: "06", gate: "07", done: "deploy",
};
const colIndex = (c: TicketColumn | null | undefined) => (c ? TICKET_COLUMNS.indexOf(c) : -1);

/** Epoch ms of an ISO date, or null. */
export const ms = (iso: string | null | undefined): number | null => {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** "40 s", "42 min", "1 h 05 min", "2 d 3 h". */
export function fmtElapsed(span: number): string {
  // under a minute in seconds, so a short build never reads "0 min"
  if (span < 60_000) return `${Math.max(0, Math.floor(span / 1_000))} s`;
  const m = Math.floor(span / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** The milestone a build job was started for (its InputJson), or null. */
export function jobMilestoneId(job: Pick<EngineJob, "inputJson"> | null | undefined): string | null {
  if (!job?.inputJson) return null;
  try {
    const v = JSON.parse(job.inputJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) && typeof (v as { milestoneId?: unknown }).milestoneId === "string"
      ? (v as { milestoneId: string }).milestoneId : null;
  } catch {
    return null;
  }
}

/** The change request a job was started for (its InputJson), or null. */
export function jobChangeRequestId(job: Pick<EngineJob, "inputJson"> | null | undefined): string | null {
  if (!job?.inputJson) return null;
  try {
    const v = JSON.parse(job.inputJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) && typeof (v as { changeRequestId?: unknown }).changeRequestId === "string"
      ? (v as { changeRequestId: string }).changeRequestId : null;
  } catch {
    return null;
  }
}

/* ── change builds ────────────────────────────────────────────────────────── */

/** The change request a change build (change.build) is for, as the build page names it. */
export interface BuildChange {
  /** the ChangeRequest id */
  id: string;
  /** "CR-002" or "FX-3"; null when the change request can't be read */
  code: string | null;
  number: number | null;
  title: string;
  /** a new feature on an existing product is built increment by increment: the one this build is for */
  increment: { n: number; of: number; title: string } | null;
  /** the tickets planned for this build (the build puts them on the board when it starts, so it can be more than the
   *  tickets the board shows yet) */
  planned: number;
}

/** Done at `at`, from the ticket's recorded moves: the last move up to then; before its first recorded move it was
 *  not done; a ticket without any recorded move counts as it stands now. */
function doneAt(t: DeliveryTicket, moves: readonly DeliveryTicketEvent[], at: number): boolean {
  let last: DeliveryTicketEvent | null = null;
  for (const e of moves) {
    const when = ms(e.at);
    if (when !== null && when <= at) last = e;
  }
  if (last) return last.toColumn === "done";
  return moves.length === 0 && t.column === "done";
}

/**
 * What a change build works on: the change's tickets on the board (PlanRef cr:<id>:<k>, fx:<n>:<id> or fx:<n>:<id>:<k>);
 * for a new feature on an existing product (Analysis route "feature") only those of the increment the build is for:
 * the first increment with a ticket that was not done when the build was requested, as the engine picks it when the
 * build starts (kinds/delivery.ts featureIncrementOf). A fix round, a revert or the steps after a deploy work on the
 * increment of the build they follow (its base build, src/domain/changeChecks.ts baseJobOf): that increment was
 * requested before its tickets were done, never the next one whose tickets were still waiting. With `jobs` the base
 * build is read from them; without it (or when it is not among them) it is the newest increment whose tickets were
 * all done when the job was requested. Pure; null for any other job.
 */
export function changeBuildScope(input: {
  job: EngineJob;
  changes: readonly DeliveryChangeRequest[];
  tickets: readonly DeliveryTicket[];
  events: readonly DeliveryTicketEvent[];
  /** The project's jobs: a fix round's, a revert's or a finishing job's base build is one of them. */
  jobs?: readonly EngineJob[];
}): { change: BuildChange; tickets: DeliveryTicket[] } | null {
  const { job } = input;
  if (job.kind !== "change.build") return null;
  const id = jobChangeRequestId(job);
  if (!id) return null;
  const cr = input.changes.find((c) => c.id === id) ?? null;
  const mine = input.tickets.filter((t) => planIndexOf(t.planRef, id) !== null);
  const analysis = cr?.analysis ? parseChangeAnalysis(cr.analysis) : null;
  const base = { id, code: cr ? changeCode(cr) : null, number: cr?.number ?? null, title: cr?.title ?? "" };
  if (!analysis || analysis.route !== "feature" || !analysis.feature) {
    return { change: { ...base, increment: null, planned: Math.max(analysis?.tickets.length ?? 0, mine.length) }, tickets: mine };
  }
  const incs = incrementsOf(analysis);
  // the build this job follows: itself, unless it fixes, reverts or finishes an earlier build of the change
  const follows = isFixRound(job) || isRevert(job) || isAfterDeployRetry(job);
  const baseId = baseJobOf(job, input.jobs ?? []);
  const built = baseId !== job.id ? (input.jobs ?? []).find((j) => j.id === baseId) ?? null : follows ? null : job;
  const at = ms((built ?? job).createdAt) ?? ms((built ?? job).claimedAt) ?? Infinity;
  const ids = new Set(mine.map((t) => t.id));
  const movesOf = new Map<string, DeliveryTicketEvent[]>();
  for (const e of input.events) {
    if (e.kind !== "move" || !e.toColumn || !ids.has(e.ticketId) || ms(e.at) === null) continue;
    const list = movesOf.get(e.ticketId) ?? [];
    list.push(e);
    movesOf.set(e.ticketId, list);
  }
  const done = new Map<number, boolean>();
  for (const t of mine) {
    const k = planIndexOf(t.planRef, id)!;
    done.set(k, (done.get(k) ?? true) && doneAt(t, movesOf.get(t.id) ?? [], at));
  }
  const next = nextIncrement(analysis, (k) => done.get(k) === true);
  // a job that follows a build no longer listed: the newest increment that was built when it was requested
  const n = built ? next ?? incs.length : Math.max(1, (next ?? incs.length + 1) - 1);
  const inc = incs.find((i) => i.n === n) ?? incs[0]!;
  const ks = new Set(inc.tickets);
  const tickets = mine.filter((t) => ks.has(planIndexOf(t.planRef, id)!));
  return { change: { ...base, increment: { n: inc.n, of: incs.length, title: inc.title }, planned: Math.max(inc.tickets.length, tickets.length) }, tickets };
}

/* ── the build in focus ───────────────────────────────────────────────────── */

export interface BuildFocus {
  job: EngineJob | null;
  milestone: DeliveryMilestone | null;
  /** the change request of a change build (then `milestone` is null) */
  change: BuildChange | null;
  /** the tickets the build works on: the milestone's, or the change's (of its increment) */
  tickets: DeliveryTicket[];
  /** those tickets' events, At ascending */
  events: DeliveryTicketEvent[];
  /** the milestone's preview.deploy jobs */
  previewJobs: EngineJob[];
  /** a board.plan job is running, or the running change build is still planning its tickets */
  planning: boolean;
  live: boolean;
  /** the build is live, but what its steps after the deploy left open is still open now (src/domain/afterDeploy.ts) */
  afterDeploy?: AfterDeployAttention | null;
}

// a job that only finishes the steps after an earlier deploy (build.retryAfterDeploy) moves no ticket: it is no build
const buildJobsOf = (jobs: readonly EngineJob[], kinds: readonly EngineJob["kind"][]) => jobs.filter((j) => kinds.includes(j.kind) && !isAfterDeployRetry(j))
  .sort((a, b) => (ms(b.createdAt) ?? -Infinity) - (ms(a.createdAt) ?? -Infinity));

/** The milestone build jobs of the project, newest first. */
export const buildJobs = (jobs: readonly EngineJob[]): EngineJob[] => buildJobsOf(jobs, ["build.run"]);

/** Every build of the project, newest first: the milestones' (build.run) and the change requests' (change.build). */
export const allBuildJobs = (jobs: readonly EngineJob[]): EngineJob[] => buildJobsOf(jobs, ["build.run", "change.build"]);

/** A running change build plans its own tickets first: none on the board yet, or none has left Planned. */
const changePlanning = (live: boolean, tickets: readonly Pick<DeliveryTicket, "column">[]) => live && tickets.every((t) => t.column === "planned");

/** The picked build, else the running one, else the newest (a milestone's or a change request's); with its milestone or
 *  change request, its tickets and their events. */
export function buildFocus(input: {
  jobs: readonly EngineJob[];
  milestones: readonly DeliveryMilestone[];
  tickets: readonly DeliveryTicket[];
  events: readonly DeliveryTicketEvent[];
  /** the project's change requests (a change build's code, title and increment); none = a change build stays unnamed */
  changes?: readonly DeliveryChangeRequest[];
  pickedJobId?: string | null;
}): BuildFocus {
  const builds = allBuildJobs(input.jobs);
  const picked = input.pickedJobId ? builds.find((j) => j.id === input.pickedJobId) : undefined;
  const job = picked ?? builds.find((j) => isActiveEngineJob(j)) ?? latestEngineJob(builds) ?? null;
  const live = !!job && isActiveEngineJob(job);
  const scope = job ? changeBuildScope({ job, changes: input.changes ?? [], tickets: input.tickets, events: input.events, jobs: input.jobs }) : null;
  const mid = scope ? null : jobMilestoneId(job);
  const milestone = mid ? input.milestones.find((m) => m.id === mid) ?? null : null;
  const tickets = scope ? scope.tickets : mid ? input.tickets.filter((t) => t.milestoneId === mid) : [];
  const ids = new Set(tickets.map((t) => t.id));
  const events = input.events.filter((e) => ids.has(e.ticketId))
    .sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));
  const previewJobs = mid ? buildJobsOf(input.jobs, ["preview.deploy"]).filter((j) => jobMilestoneId(j) === mid) : [];
  const planning = input.jobs.some((j) => j.kind === "board.plan" && isActiveEngineJob(j)) || (scope !== null && changePlanning(live, tickets));
  const afterDeploy = job ? openAttention(job, newestDelivered(input.jobs)) : null;
  return { job, milestone, change: scope?.change ?? null, tickets, events, previewJobs, planning, live, afterDeploy };
}

/** The change build the Build step's header is about, from the build in focus: the increment its run works on, that
 *  increment's tickets, its automatic tests and what its newest deploy left open; null when the focus is no change. */
export function stepChangeOf(f: Pick<BuildFocus, "job" | "change" | "tickets">, o: { tests?: StepTests | null; unfinished?: AfterDeployAttention | null } = {}): StepChangeBuild | null {
  if (!f.change || !f.job) return null;
  return {
    job: f.job, code: f.change.code, number: f.change.number, title: f.change.title, increment: f.change.increment,
    tickets: { total: Math.max(f.change.planned, f.tickets.length), done: f.tickets.filter((t) => t.column === "done").length },
    tests: o.tests ?? null,
    unfinished: o.unfinished ?? null,
  };
}

/** The build in focus in plain words: "Milestone 2: Payments", "CR-002 increment 1 of 4: Find overdue invoices" or
 *  "CR-002: Filter by price"; null without one. */
export function focusName(f: Pick<BuildFocus, "milestone" | "change">): string | null {
  if (f.milestone) return t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: f.milestone.number, name: f.milestone.name });
  if (!f.change) return null;
  const what = changeWords(f.change);
  const name = f.change.increment?.title || f.change.title;
  return name ? `${what[0]!.toUpperCase()}${what.slice(1)}: ${name}` : `${what[0]!.toUpperCase()}${what.slice(1)}`;
}

/* ── time window ──────────────────────────────────────────────────────────── */

export interface BuildWindow {
  start: number;
  /** the right edge of the tracks */
  end: number;
  /** now while the build runs, else when it finished; the playhead */
  head: number;
  live: boolean;
}

/** When the job ended (finish, else last update), or null while it runs. */
const jobEnd = (j: EngineJob) => (isActiveEngineJob(j) ? null : ms(j.finishedAt) ?? ms(j.updatedAt));
const jobStart = (j: EngineJob) => ms(j.claimedAt) ?? ms(j.createdAt);

/** From the engine's claim of the build to now (running) or its finish, widened to the milestone's later preview
 *  deploys. A running build keeps some room right of the playhead. Null without a dated job. */
export function buildWindow(f: BuildFocus, now: number): BuildWindow | null {
  if (!f.job) return null;
  const start = jobStart(f.job);
  if (start === null) return null;
  const head = f.live ? Math.max(now, start) : jobEnd(f.job) ?? Math.max(now, start);
  let last = head;
  for (const p of f.previewJobs) {
    const s = jobStart(p);
    if (s === null || s < start) continue;
    last = Math.max(last, jobEnd(p) ?? now);
  }
  const span = Math.max(last - start, 60_000);
  const end = f.live ? start + span * 1.12 : start + span;
  return { start, end, head, live: f.live };
}

/** A time as a percentage of the window. */
export const pctOf = (w: BuildWindow, t: number) => Math.min(100, Math.max(0, ((t - w.start) / (w.end - w.start)) * 100));

/* ── ticket segments, clips and send-backs ────────────────────────────────── */

export interface Segment { ticketId: string; column: TicketColumn; from: number; to: number; open: boolean; viaSendBack: boolean }

/** Where each ticket stood over the window, from its real column moves. A ticket without a move inside the window sat in
 *  the column it had at the start (its last earlier move, else its current column). */
export function ticketSegments(f: BuildFocus, w: BuildWindow): Segment[] {
  const out: Segment[] = [];
  const end = w.live ? w.head : w.end;
  for (const t of f.tickets) {
    const moves = f.events.filter((e) => e.ticketId === t.id && e.kind === "move" && e.toColumn && ms(e.at) !== null);
    const before = moves.filter((e) => (ms(e.at) as number) <= w.start);
    const inside = moves.filter((e) => { const at = ms(e.at) as number; return at > w.start && at <= end; });
    let col: TicketColumn | null = before.length ? before[before.length - 1].toColumn : inside[0]?.fromColumn ?? (inside.length ? null : t.column);
    let from = w.start;
    let via = false;
    for (const e of inside) {
      const at = ms(e.at) as number;
      if (col) out.push({ ticketId: t.id, column: col, from, to: at, open: false, viaSendBack: via });
      via = colIndex(e.toColumn) < colIndex(e.fromColumn ?? col);
      col = e.toColumn;
      from = at;
    }
    if (col) out.push({ ticketId: t.id, column: col, from, to: end, open: col === t.column, viaSendBack: via });
  }
  return out;
}

export type ClipState = "planned" | "active" | "held" | "done";

export interface Clip {
  id: string;
  stage: StageId;
  from: number;
  to: number;
  ticketIds: string[];
  state: ClipState;
  sendBack: boolean;
  /** a preview.deploy job, not tickets */
  job?: EngineJob;
}

/** One clip per stretch of work in a stage: overlapping ticket stretches in one column merge into one clip. Rework after
 *  a send-back merges only with rework, so it draws as its own clip over the stage's regular work. Done tickets have no
 *  track; the Release to dev track holds the milestone's preview.deploy jobs. */
export function stageClips(f: BuildFocus, w: BuildWindow): Clip[] {
  const segs = ticketSegments(f, w).filter((s) => s.column !== "done" && s.to > s.from);
  const out: Clip[] = [];
  for (const col of TICKET_COLUMNS) for (const rework of [false, true]) {
    if (col === "done") continue;
    const list = segs.filter((s) => s.column === col && s.viaSendBack === rework).sort((a, b) => a.from - b.from);
    let cur: Clip | null = null;
    for (const s of list) {
      if (cur && s.from <= cur.to) {
        cur.to = Math.max(cur.to, s.to);
        if (!cur.ticketIds.includes(s.ticketId)) cur.ticketIds.push(s.ticketId);
        if (s.open) cur.state = col === "planned" ? "planned" : w.live ? "active" : "held";
        continue;
      }
      cur = {
        id: `${col}-${s.from}-${s.ticketId}`, stage: COLUMN_STAGE[col], from: s.from, to: s.to, ticketIds: [s.ticketId],
        state: col === "planned" ? "planned" : s.open ? (w.live ? "active" : "held") : "done", sendBack: s.viaSendBack,
      };
      out.push(cur);
    }
  }
  for (const p of f.previewJobs) {
    const from = jobStart(p);
    if (from === null || from < w.start) continue;
    const to = jobEnd(p) ?? w.head;
    out.push({ id: `deploy-${p.id}`, stage: "deploy", from, to: Math.max(to, from), ticketIds: [], job: p,
      state: isActiveEngineJob(p) ? "active" : p.status === "succeeded" ? "done" : "held", sendBack: false });
  }
  return out;
}

export interface SendBack {
  id: string;
  at: number;
  ticketId: string;
  from: TicketColumn;
  to: TicketColumn;
  /** open = the ticket is still before the column that sent it back; rechecking = it is back in that column */
  phase: "open" | "rechecking" | "closed";
}

/** Every real backward column move (a stage sent a ticket back), with where the ticket stands now. */
export function sendBacks(f: BuildFocus, w?: BuildWindow | null): SendBack[] {
  const byId = new Map(f.tickets.map((t) => [t.id, t]));
  const out: SendBack[] = [];
  for (const e of f.events) {
    if (e.kind !== "move" || !e.fromColumn || !e.toColumn || colIndex(e.toColumn) >= colIndex(e.fromColumn)) continue;
    const at = ms(e.at);
    if (at === null || (w && (at < w.start || at > w.end))) continue;
    const t = byId.get(e.ticketId);
    if (!t) continue;
    const now = colIndex(t.column), src = colIndex(e.fromColumn);
    out.push({ id: e.id, at, ticketId: e.ticketId, from: e.fromColumn, to: e.toColumn, phase: now < src ? "open" : now === src ? "rechecking" : "closed" });
  }
  return out;
}

/* ── stage states ─────────────────────────────────────────────────────────── */

export interface StageCounts { total: number; here: number; past: number }

export function stageCounts(f: BuildFocus, id: StageId): StageCounts {
  const col = STAGE_COLUMN[id];
  const total = f.tickets.length;
  if (!col) {
    const done = f.tickets.filter((t) => t.column === "done").length;
    return { total, here: 0, past: done };
  }
  const i = colIndex(col);
  return {
    total,
    here: f.tickets.filter((t) => t.column === col).length,
    past: f.tickets.filter((t) => colIndex(t.column) > i).length,
  };
}

/** How many of the tickets a stage has passed, for its inspector. Plan passes a ticket by planning it: once Plan is done
 *  (stageStates: the plan's tickets exist) every ticket is through it, although the tickets wait in Planned until the
 *  Build stage takes them. Every other stage has passed a ticket once it moved past the stage's column. */
export function stagePassed(c: StageCounts, id: StageId, status: StageStatus): number {
  return id === "01" && status === "done" ? c.total : c.past;
}

/** Release to dev of a change build: the build itself puts the change on dev once its tickets are done (no preview job). */
function changeRelease(f: BuildFocus, c: StageCounts): StageState {
  const job = f.job;
  const built = c.total > 0 && c.past === c.total;
  if (job?.status === "succeeded") return { id: "deploy", status: "done", progress: 1 };
  if (job && built && isActiveEngineJob(job)) return { id: "deploy", status: "active", caption: job.message ?? undefined };
  if (job && built && (job.status === "failed" || job.status === "cancelled")) return { id: "deploy", status: "blocked", caption: job.message ?? undefined };
  return { id: "deploy", status: "planned" };
}

/** Each stage's state from the tickets' real columns: Plan is done once the plan's tickets exist (a change build plans
 *  its own: Plan works until a ticket leaves Planned); a later stage is done when every ticket is past its column,
 *  working while tickets sit in it (or some passed and more are coming), sent back while a ticket it received from a
 *  later stage is still there, on hold when the build is not running. Release to dev follows the milestone's
 *  preview.deploy job and status, or the change build itself. */
export function stageStates(f: BuildFocus): StageState[] {
  const backs = sendBacks(f);
  const preview = latestEngineJob(f.previewJobs);
  return STAGES.map(({ id }): StageState => {
    const c = stageCounts(f, id);
    if (id === "01") {
      const planned = c.total === 1 ? t("build.stage.plannedOne", "1 ticket planned") : t("build.stage.planned", "{count} tickets planned", { count: c.total });
      if (f.change && f.planning) return { id, status: "active", ...(c.total > 0 ? { caption: planned } : {}) };
      if (c.total > 0) return { id, status: "done", progress: 1, caption: planned };
      return { id, status: f.planning ? "active" : "planned" };
    }
    if (id === "deploy" && f.change) return changeRelease(f, c);
    if (id === "deploy") {
      if (preview && isActiveEngineJob(preview)) return { id, status: "active", progress: preview.progress / 100, caption: preview.message ?? undefined };
      if (preview?.status === "failed") return { id, status: "blocked", caption: preview.message ?? undefined };
      if (preview?.status === "succeeded" || f.milestone?.status === "preview-ready" || f.milestone?.status === "done") return { id, status: "done", progress: 1 };
      return { id, status: "planned" };
    }
    if (c.total === 0) return { id, status: "planned" };
    const progress = c.past / c.total;
    const caption = t("build.stage.through", "{past} of {total} through", { past: c.past, total: c.total });
    if (c.past === c.total) return { id, status: "done", progress: 1, caption };
    const col = STAGE_COLUMN[id];
    if (c.here > 0) {
      const back = backs.some((b) => b.to === col && b.phase === "open" && f.tickets.find((t) => t.id === b.ticketId)?.column === col);
      if (back) return { id, status: "sent-back", progress, caption };
      return { id, status: f.live ? "active" : "blocked", progress, caption };
    }
    if (c.past === 0) return { id, status: "planned", progress: 0 };
    return { id, status: f.live ? "active" : "blocked", progress, caption };
  });
}

/* ── quality gates ────────────────────────────────────────────────────────── */

export type GateState = "pending" | "running" | "passed" | "failed" | "held";
export interface Gate { id: StageId; label: string; state: GateState; detail: string }

const GATES: { id: StageId; label: string }[] = [
  { id: "03", get label() { return t("build.gates.review", "Code review"); } }, { id: "04", get label() { return t("build.gates.tests", "Tests"); } },
  { id: "05", get label() { return t("build.gates.security", "Security"); } }, { id: "07", get label() { return t("build.gates.gate", "Release gate"); } },
];

/** The four automatic gates, read from where the milestone's tickets really are. */
export function qualityGates(f: BuildFocus, columnName: (c: string) => string): Gate[] {
  const backs = sendBacks(f).filter((b) => b.phase !== "closed");
  const states = new Map(stageStates(f).map((s) => [s.id, s]));
  return GATES.map(({ id, label }) => {
    const c = stageCounts(f, id);
    const col = STAGE_COLUMN[id] as TicketColumn;
    const open = backs.filter((b) => b.from === col && b.phase === "open");
    const through = c.total === 1 ? t("build.gates.passedOne", "{past} of 1 ticket passed", { past: c.past }) : t("build.gates.passed", "{past} of {total} tickets passed", { past: c.past, total: c.total });
    if (c.total === 0) return { id, label, state: "pending", detail: f.change ? t("build.gates.waitsChange", "Waits for the change's tickets.") : t("build.gates.waitsMilestone", "Waits for the milestone's tickets.") };
    if (open.length) {
      const to = columnName(open[0].to);
      return { id, label, state: "failed", detail: t("build.gates.sentBack", "{through} · {count} sent back to {to}", { through, count: open.length, to }) };
    }
    const st = states.get(id)?.status;
    if (st === "done") return { id, label, state: "passed", detail: through };
    if (c.here > 0) return { id, label, state: f.live ? "running" : "held", detail: f.live ? t("build.gates.checking", "{count} checking now · {through}", { count: c.here, through }) : t("build.gates.waiting", "{count} waiting here · {through}", { count: c.here, through }) };
    if (c.past > 0) return { id, label, state: f.live ? "running" : "held", detail: through };
    return { id, label, state: "pending", detail: t("build.gates.none", "No ticket has reached it yet.") };
  });
}

/* ── feed ─────────────────────────────────────────────────────────────────── */

export interface FeedItem { key: string; at: number; stage: StageId; tone: ChipTone; text: string; who: string }

const KIND_LABEL: Partial<Record<EngineJob["kind"], { label: string; stage: StageId }>> = {
  "board.plan": { get label() { return t("build.feed.kind.plan", "The ticket planning"); }, stage: "01" },
  "build.run": { get label() { return t("build.feed.kind.build", "The build"); }, stage: "02" },
  "change.build": { get label() { return t("build.feed.kind.change", "The build of a change"); }, stage: "02" },
  "preview.deploy": { get label() { return t("build.feed.kind.preview", "The preview update"); }, stage: "deploy" },
};
/** A preview.deploy with a release in its input is the release to development, not a preview. */
const kindLabel = (j: EngineJob): { label: string; stage: StageId } | undefined =>
  j.kind === "preview.deploy" && /"release"\s*:/.test(j.inputJson ?? "") ? { label: t("build.feed.kind.release", "The release to development"), stage: "deploy" } : KIND_LABEL[j.kind];

/** Role names stored on older ticket events ("02 Developer"), read by their stage since the owner's 08.11.2026 renaming. */
const LEGACY_ROLE: Readonly<Record<string, string>> = { Planner: "01", Developer: "02" };

/** The agent's role name of a ticket event's author label ("dev" or "02 Developer" read "Tech lead"); other labels as given. */
export function authorName(label: string | null | undefined): string {
  const l = (label ?? "").replace(/^0[1-7] /, "").trim();
  const agent = LEGACY_ROLE[l] ?? l;
  return l && agentStage(agent) ? agentName(agent) : l;
}

/** The project's real activity, newest first: engine job requests, claims and finishes, and every ticket event.
 *  `jobLabel` may name a job more precisely ("The build of CR-002"); null keeps the kind's words. */
export function feedItems(input: {
  jobs: readonly EngineJob[];
  events: readonly DeliveryTicketEvent[];
  tickets: readonly DeliveryTicket[];
  ticketCode: (t: DeliveryTicket) => string;
  columnName: (c: string) => string;
  jobLabel?: (j: EngineJob) => string | null;
  limit?: number;
}): FeedItem[] {
  const out: FeedItem[] = [];
  for (const j of input.jobs) {
    const kind = isAfterDeployRetry(j) ? { label: t("build.feed.kind.finishing", "Finishing the steps after the deploy"), stage: "deploy" as StageId } : kindLabel(j);
    if (!kind) continue;
    const k = { ...kind, label: input.jobLabel?.(j) ?? kind.label };
    const created = ms(j.createdAt), claimed = ms(j.claimedAt), finished = ms(j.finishedAt);
    if (created !== null) out.push({ key: `${j.id}:req`, at: created, stage: k.stage, tone: "neutral", text: t("build.feed.requested", "{what} was requested.", { what: k.label }), who: "MADP Factory" });
    if (claimed !== null) out.push({ key: `${j.id}:claim`, at: claimed, stage: k.stage, tone: "accent", text: t("build.feed.started", "{what} started.", { what: k.label }), who: t("build.feed.team", "Development team") });
    if (finished !== null && !isActiveEngineJob(j)) {
      // live, but its steps after the deploy did not all finish (src/domain/afterDeploy.ts): never a plain "finished"
      const open = jobAttention(j);
      // a fix round that found nothing to change deployed nothing: its own line says why and who decides
      const done = isAfterDeployRetry(j)
        ? (open ? t("build.feed.stepsOpen", "The steps after the deploy are still not finished: {line}", { line: open.line }) : t("build.feed.stepsDone", "The steps after the deploy are finished."))
        : deployedNothing(j) ? (j.message || t("build.feed.nothing", "{what} found nothing to change; a person decides.", { what: k.label }))
          : open ? (open.broken ? t("build.feed.liveBroken", "{what} is live, but not usable yet: {line}", { what: k.label, line: open.line }) : t("build.feed.liveUnfinished", "{what} is live, but not finished: {line}", { what: k.label, line: open.line }))
            : t("build.feed.finished", "{what} finished.", { what: k.label });
      // failed or cancelled, a build that ended without finishing "stopped" (one rule: src/components/changes/changeStopped.ts);
      // its own line when it already says how it stopped
      const stopped = j.message && /\bstopped\b/i.test(j.message) ? j.message
        : j.status === "failed" && j.message ? t("build.feed.stoppedWhy", "{what} stopped: {why}", { what: k.label, why: j.message }) : t("build.feed.stopped", "{what} stopped.", { what: k.label });
      const text = j.status === "succeeded" ? done : stopped;
      const tone: ChipTone = open ? (open.security ? "danger" : "warning") : deployedNothing(j) ? "warning" : j.status === "succeeded" ? "success" : "danger";
      out.push({ key: `${j.id}:end`, at: finished, stage: k.stage, tone, text, who: t("build.feed.team", "Development team") });
    }
  }
  const byId = new Map(input.tickets.map((t) => [t.id, t]));
  for (const e of input.events) {
    const at = ms(e.at);
    const tk = byId.get(e.ticketId);
    if (at === null || !tk) continue;
    const code = input.ticketCode(tk);
    const who = authorName(e.authorLabel) || (e.isAuto ? t("build.feed.agent", "MADP agent") : t("build.feed.member", "Team member"));
    if (e.kind === "move" && e.toColumn) {
      const back = colIndex(e.toColumn) < colIndex(e.fromColumn);
      out.push({ key: e.id, at, stage: COLUMN_STAGE[e.toColumn], tone: back ? "warning" : e.toColumn === "done" ? "success" : "accent",
        text: `${code} ${tk.title}: ${e.fromColumn ? `${input.columnName(e.fromColumn)} → ` : ""}${input.columnName(e.toColumn)}${back ? t("build.feed.sentBack", " (sent back)") : ""}`, who });
    } else if (e.text) {
      out.push({ key: e.id, at, stage: COLUMN_STAGE[tk.column], tone: e.kind === "artifact" ? "ai" : "neutral",
        text: `${code}: ${e.text.length > 180 ? `${e.text.slice(0, 179)}…` : e.text}`, who });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, input.limit ?? 60);
}

/* ── per stage: work items and proof ──────────────────────────────────────── */

/** The column a ticket stood in at a moment, from its moves (its current column when no move says otherwise). */
export function columnAt(f: BuildFocus, ticket: DeliveryTicket, at: number): TicketColumn {
  let col: TicketColumn | null = null;
  let first: TicketColumn | null = null;
  for (const e of f.events) {
    if (e.ticketId !== ticket.id || e.kind !== "move" || !e.toColumn) continue;
    const t = ms(e.at);
    if (t === null) continue;
    if (first === null) first = e.fromColumn;
    if (t <= at) col = e.toColumn; else break;
  }
  return col ?? first ?? ticket.column;
}

export interface WorkItem { ticket: DeliveryTicket; state: "planned" | "active" | "done"; since: number | null }

/** The milestone's tickets as this stage sees them: past it (done), in it (active) or still to come (planned); with when
 *  each last entered the stage's column, if a move records it. A done Plan (`status`) has planned every ticket: they
 *  wait in Planned for the Build stage, done as far as Plan goes (stagePassed). */
export function workItems(f: BuildFocus, id: StageId, status?: StageStatus): WorkItem[] {
  const col = STAGE_COLUMN[id];
  const i = col ? colIndex(col) : colIndex("done");
  const planned = id === "01" && status === "done";
  return f.tickets.map((t) => {
    const ti = colIndex(t.column);
    const entered = f.events.filter((e) => e.ticketId === t.id && e.kind === "move" && e.toColumn === (col ?? "done")).map((e) => ms(e.at)).filter((x): x is number => x !== null);
    const state: WorkItem["state"] = planned || ti > i || (!col && t.column === "done") ? "done" : ti === i ? "active" : "planned";
    return { ticket: t, state, since: entered.length ? entered[entered.length - 1] : null };
  }).sort((a, b) => ({ active: 0, done: 1, planned: 2 })[a.state] - ({ active: 0, done: 1, planned: 2 })[b.state] || a.ticket.sortOrder - b.ticket.sortOrder);
}

export interface ProofEntry { event: DeliveryTicketEvent; ticket: DeliveryTicket; at: number }

/** The artifacts and notes the stage's agent recorded on tickets: by the agent who wrote them (the developer's pull
 *  request, the tester's report, even when the ticket already moved on), else by the column the ticket stood in. */
export function proofEntries(f: BuildFocus, id: StageId): ProofEntry[] {
  const col = STAGE_COLUMN[id] ?? "done";
  const byId = new Map(f.tickets.map((t) => [t.id, t]));
  const out: ProofEntry[] = [];
  for (const e of f.events) {
    if (e.kind !== "artifact" && e.kind !== "note") continue;
    const t = byId.get(e.ticketId), at = ms(e.at);
    if (!t || at === null || !e.text) continue;
    const by = agentStage((e.authorLabel ?? "").trim().replace(/^(0[1-7]) .*$/, "$1"));
    if (by ? by === id : columnAt(f, t, at) === col) out.push({ event: e, ticket: t, at });
  }
  return out;
}

/** The stage the inspector follows: the first one working, sent back or on hold, else the last finished, else Plan. */
export function focusStage(states: readonly StageState[]): StageId {
  const busy = states.find((s) => s.status === "active" || s.status === "sent-back" || s.status === "blocked");
  if (busy) return busy.id;
  const done = [...states].reverse().find((s) => s.status === "done");
  return done?.id ?? "01";
}

export const isBusy = (s: StageStatus) => s === "active" || s === "sent-back";

/* ── replay of the recorded build ─────────────────────────────────────────── */

/** 1x replays the whole recorded build in about this many seconds (the original time-lapse length); 4x in a quarter. */
export const REPLAY_SECONDS = 75;
export type ReplaySpeed = "1x" | "4x";
export const REPLAY_FACTOR: Record<ReplaySpeed, number> = { "1x": 1, "4x": 4 };

/** The replay clock after `dtMs` of wall-clock time at `speed`, kept inside the recorded window. */
export function replayAdvance(w: BuildWindow, t: number, dtMs: number, speed: ReplaySpeed): number {
  const span = Math.max(w.head - w.start, 1);
  const step = (span / (REPLAY_SECONDS * 1000)) * Math.max(0, dtMs) * REPLAY_FACTOR[speed];
  return Math.min(w.head, Math.max(w.start, t + step));
}

/** The window with its playhead at `t`; the tracks keep the whole recorded build in view. The build was running at any
 *  moment before its recorded end, so such a moment reads as live. */
export function windowAt(w: BuildWindow, t: number): BuildWindow {
  const head = Math.min(w.head, Math.max(w.start, t));
  return { ...w, head, live: w.live || head < w.head };
}

/** A job as it stood at `t`: finished once its recorded end has passed, running from its claim, queued before. The engine
 *  keeps only its latest message and progress, so a past moment shows neither. */
export function jobAt(j: EngineJob, t: number): EngineJob {
  const end = jobEnd(j);
  if (end !== null && end <= t) return j;
  const claimed = ms(j.claimedAt);
  if (claimed !== null && claimed <= t) return { ...j, status: "running", message: null, finishedAt: null };
  return { ...j, status: "queued", message: null, claimedAt: null, finishedAt: null };
}

/** The build in focus as the records show it at `t`: every ticket in the column its recorded moves put it in, only the
 *  events and preview deploys up to then, and the job's state at that moment. Nothing is added; later records are
 *  left out. */
export function focusAt(f: BuildFocus, t: number): BuildFocus {
  const events = f.events.filter((e) => { const at = ms(e.at); return at !== null && at <= t; });
  const tickets = f.tickets.map((tk) => {
    const column = columnAt(f, tk, t);
    return column === tk.column ? tk : { ...tk, column, isDone: column === "done", doneAt: column === "done" ? tk.doneAt : null };
  });
  const previewJobs = f.previewJobs
    .filter((p) => { const s = ms(p.createdAt) ?? jobStart(p); return s !== null && s <= t; })
    .map((p) => jobAt(p, t));
  const job = f.job ? jobAt(f.job, t) : null;
  const previewDone = previewJobs.some((p) => p.status === "succeeded");
  const milestone = f.milestone && !previewDone && (f.milestone.status === "preview-ready" || f.milestone.status === "done")
    ? { ...f.milestone, status: "building" as const } : f.milestone;
  const live = !!job && isActiveEngineJob(job);
  return { ...f, job, milestone, tickets, events, previewJobs, planning: f.change ? changePlanning(live, tickets) : false, live };
}

/** Whole percent of the tickets in Done. */
export const donePct = (tickets: readonly Pick<DeliveryTicket, "column">[]): number =>
  tickets.length ? Math.round((tickets.filter((t) => t.column === "done").length / tickets.length) * 100) : 0;

/* ── the build page's status line ─────────────────────────────────────────── */

export interface BannerCopy { tone: ChipTone; title: string; text: string }

const milestoneWord = (f: BuildFocus) => focusName(f) ?? t("build.banner.theMilestone", "the milestone");

/** One status sentence for the build, from the job in focus, its tickets' real send-backs and the replay position. */
/** `replay.live` = the build is running now (the replayed focus always reads as running at a past moment); `w` is the
 *  whole recorded window. */
export function bannerFor(f: BuildFocus, w: BuildWindow | null, replay: { at: number; playing: boolean; live: boolean } | null,
  ticketCode: (t: DeliveryTicket) => string, columnName: (c: string) => string): BannerCopy {
  const job = f.job;
  if (replay && w) {
    const of = t("build.banner.of", "{at} of {total}", { at: fmtElapsed(replay.at - w.start), total: fmtElapsed(w.head - w.start) });
    return {
      tone: "neutral",
      title: t("build.banner.replaying", "Replaying the recorded build of {name} · {of}", { name: milestoneWord(f), of }),
      text: replay.playing ? t("build.banner.replayPlaying", "Every step shown is a recorded build step or ticket move.")
        : replay.live ? t("build.banner.replayPausedLive", "Replay paused at {of}. Live returns to now.", { of }) : t("build.banner.replayPaused", "Replay paused at {of}. Skip to the end shows the whole recorded build.", { of }),
    };
  }
  if (!job) return { tone: "accent", title: t("build.banner.noneTitle", "MADP agents build each milestone"), text: t("build.banner.noneText", "Progress, tickets and previews appear here as the team works.") };
  const name = milestoneWord(f);
  const Name = `${name[0]!.toUpperCase()}${name.slice(1)}`;
  if (job.status === "queued" || (job.status === "claimed" && !w)) {
    return { tone: "neutral", title: t("build.jobs.status.queued", "Waiting to start"), text: t("build.banner.requested", "The build of {name} was requested. It starts in a moment.", { name }) };
  }
  if (isActiveEngineJob(job)) {
    const open = sendBacks(f, w).find((b) => b.phase === "open");
    const tk = open ? f.tickets.find((x) => x.id === open.ticketId) : undefined;
    if (open) {
      return { tone: "warning", title: t("build.banner.sentBackTitle", "{stage} sent a ticket back. The fix runs automatically.", { stage: columnName(open.from) }),
        text: t("build.banner.sentBackText", "{ticket} went back to {to}; it passes {from} again before it moves on.", { ticket: tk ? `${ticketCode(tk)} ${tk.title}` : t("build.banner.aTicket", "A ticket"), to: columnName(open.to), from: columnName(open.from) }) };
    }
    return { tone: "accent", title: t("build.banner.building", "MADP agents are building {name}.", { name }), text: job.message ?? t("build.banner.verified", "Every stage is verified automatically.") };
  }
  if (job.status === "succeeded") {
    const done = f.tickets.filter((x) => x.column === "done").length;
    const open = f.afterDeploy;
    if (open) return { tone: open.security ? "danger" : "warning", title: open.broken ? t("build.banner.liveBroken", "{name} is built and live, but not usable yet.", { name: Name }) : t("build.banner.liveUnfinished", "{name} is built and live, but not finished.", { name: Name }), text: open.line };
    const n = f.tickets.length;
    return { tone: "success", title: t("build.banner.built", "{name} is built.", { name: Name }),
      text: w ? (n === 1 ? t("build.banner.throughOneTime", "{done} of 1 ticket through every stage in {time} of build time.", { done, time: fmtElapsed(w.head - w.start) }) : t("build.banner.throughTime", "{done} of {total} tickets through every stage in {time} of build time.", { done, total: n, time: fmtElapsed(w.head - w.start) }))
        : n === 1 ? t("build.banner.throughOne", "{done} of 1 ticket through every stage.", { done }) : t("build.banner.through", "{done} of {total} tickets through every stage.", { done, total: n }) };
  }
  if (job.status === "failed") return { tone: "danger", title: t("build.banner.failed", "The build of {name} stopped with an error.", { name }), text: job.message ?? t("build.banner.failedText", "Start it again once the cause is fixed.") };
  return { tone: "neutral", title: t("build.banner.cancelled", "The build of {name} was cancelled.", { name }), text: t("build.banner.cancelledText", "Nothing more runs until a build is started again.") };
}

/** The title chip: what the build in focus is doing now; null before any build. */
export function buildChip(f: BuildFocus): { tone: ChipTone; label: string; pulse: boolean } | null {
  const job = f.job;
  if (!job) return null;
  if (job.status === "running" || job.status === "claimed") return { tone: "accent", label: t("build.chip.building", "Building"), pulse: true };
  if (job.status === "queued") return { tone: "neutral", label: t("build.jobs.status.queued", "Waiting to start"), pulse: false };
  if (job.status === "succeeded") {
    const open = f.afterDeploy;
    if (open) return { tone: open.security ? "danger" : "warning", label: t("build.chip.builtUnfinished", "Built, not finished"), pulse: false };
    return { tone: "success", label: f.milestone ? t("build.chip.milestoneBuilt", "Milestone {number} built", { number: f.milestone.number }) : t("build.chip.built", "Built"), pulse: false };
  }
  if (job.status === "failed") return { tone: "danger", label: t("build.step.milestone.stopped", "Stopped"), pulse: false };
  return { tone: "neutral", label: t("build.jobs.status.cancelled", "Cancelled"), pulse: false };
}

export interface ReplayClock { at: number | null; playing: boolean }

/** Play: from the start of the recorded window, or on from where the replay was paused. */
export function replayPlay(c: ReplayClock, w: BuildWindow): ReplayClock {
  return { at: c.at === null || c.at >= w.head ? w.start : Math.max(w.start, c.at), playing: true };
}

/** One tick of a playing replay; at the recorded end the replay stops and the views follow the records again. */
export function replayTick(c: ReplayClock, w: BuildWindow, dtMs: number, speed: ReplaySpeed): ReplayClock {
  if (!c.playing || c.at === null) return c;
  const at = replayAdvance(w, c.at, dtMs, speed);
  return at >= w.head ? { at: null, playing: false } : { at, playing: true };
}

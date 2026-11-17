/** The Build step's queue: the development team's planned work (the project's tickets) as MADP Studio's queue of
 *  planned runs — what can start now, what waits for what, what runs and what is done. Pure, over real records only:
 *  the Ticket rows (column, DependsOn), their TicketEvent rows (moves, the pull request), the milestones and the
 *  build jobs (build.run per milestone, change.build per change request).
 *
 *  Status mapping (frontend-local/QUEUE-SPEC.md):
 *    pending     column planned                                   "Waiting for MF-3, MF-4" / "Ready to start"
 *    running     column dev … gate                                "In progress · In review"
 *    recovering  sent back and not yet past the stage that sent it back, or a feedback fix in progress  "Being fixed"
 *    landed      column done                                      "Done"
 *    failed      not done, started, and its latest build job failed or was cancelled  "Stopped"; a ticket of a change
 *                request whose build stopped is "Stopped" too, also before it started (one rule for a stopped change:
 *                src/components/changes/changeStopped.ts), never "Ready to start"
 *
 *  queueDepths / queueColumns / waitingOn are Studio's (madp-studio shared/src/queue.ts), keyed by the ticket id (two
 *  fix tickets can share a display key). queueFlow turns the items into FlowMap nodes and edges. */
import { ticketLabel } from "@/data/board";
import type { TicketColumn } from "@/domain/delivery";
import type { FlowEdge, FlowEdgeState, FlowGroup, FlowNode, FlowStatus } from "@/domain/flowMap";
import type { EngineJob } from "@/blocks/engine/types";
import type { DeliveryMilestone, DeliveryTicket, DeliveryTicketEvent, TicketKind } from "@/blocks/delivery/types";
import { agentName } from "@/components/board/blocksBoard";
import { changeStopped, type StoppableChange } from "@/components/changes/changeStopped";
import { changeCode } from "@/domain/delivery";
import { t } from "@/i18n";

export const QUEUE_STATUSES = ["pending", "running", "recovering", "landed", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export interface QueueItem {
  /** the ticket id (unique) */
  id: string;
  /** the display key, as the Board shows it ("MF-12", "FX-1") */
  key: string;
  title: string;
  /** ticket ids this one waits for */
  deps: string[];
  status: QueueStatus;
  column: TicketColumn;
  /** the stage in plain words while it runs or where it stopped ("In review"); null before and after */
  stage: string | null;
  type: TicketKind;
  milestoneId: string | null;
  /** "Milestone 2"; for work after go-live its change request ("CR-006"), else "Changes and fixes" */
  milestone: string;
  /** The change request the ticket belongs to ("CR-006"), when the change requests are given; null otherwise. */
  change: string | null;
  /** the agent role in plain words ("Tech lead") */
  agent: string;
  startedAt: string | null;
  endedAt: string | null;
  /** "#52" when the ticket's events name a pull request */
  pullRequest: string | null;
  commit: string | null;
  /** the stage that sent it back (while it is being fixed) */
  sentBackFrom: TicketColumn | null;
  /** a fix for the client's feedback */
  feedback: boolean;
}

/** The stage of each working column in plain words (the spec's labels). */
export const QUEUE_STAGE: Record<Exclude<TicketColumn, "planned" | "done">, string> = {
  get dev() { return t("build.queue.stage.dev", "In development"); },
  get review() { return t("build.queue.stage.review", "In review"); },
  get test() { return t("build.queue.stage.test", "Testing"); },
  get security() { return t("build.queue.stage.security", "Security check"); },
  get docs() { return t("build.queue.stage.docs", "Docs"); },
  get gate() { return t("build.queue.stage.gate", "Final check"); },
};
/** QUEUE_STAGE inside a sentence ("sent back from in review"): lower case in English, as each language writes it there. */
const QUEUE_STAGE_INLINE: Record<keyof typeof QUEUE_STAGE, string> = {
  get dev() { return t("build.queue.stageLower.dev", "in development"); },
  get review() { return t("build.queue.stageLower.review", "in review"); },
  get test() { return t("build.queue.stageLower.test", "testing"); },
  get security() { return t("build.queue.stageLower.security", "security check"); },
  get docs() { return t("build.queue.stageLower.docs", "docs"); },
  get gate() { return t("build.queue.stageLower.gate", "final check"); },
};
/** "Changes and fixes": the work after go-live, in the current language. */
export const changesAndFixes = (): string => t("build.queue.changesAndFixes", "Changes and fixes");
const FLOW: readonly TicketColumn[] = ["planned", "dev", "review", "test", "security", "docs", "gate", "done"];
const at = (c: TicketColumn | null | undefined) => (c ? FLOW.indexOf(c) : -1);
const stageOf = (c: TicketColumn): string | null => (c === "planned" || c === "done" ? null : QUEUE_STAGE[c]);
const time = (iso: string | null | undefined) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/* ── Studio's queue logic ─────────────────────────────────────────────────────────────────────────────────────── */

type Linked = Pick<QueueItem, "id" | "deps">;

export function queueDepths(items: readonly Linked[]): Record<string, number> {
  const byId = new Map(items.map((t) => [t.id, t]));
  const depth: Record<string, number> = {};
  const stack = new Set<string>();
  const visit = (id: string): number => {
    if (id in depth) return depth[id];
    stack.add(id);
    let d = 0;
    for (const dep of byId.get(id)?.deps ?? []) {
      if (!byId.has(dep) || stack.has(dep)) continue;
      d = Math.max(d, visit(dep) + 1);
    }
    stack.delete(id);
    depth[id] = d;
    return d;
  };
  for (const t of items) visit(t.id);
  return depth;
}

export function queueColumns<T extends Linked>(items: readonly T[]): T[][] {
  const depth = queueDepths(items);
  const cols: T[][] = [];
  for (const t of items) (cols[depth[t.id]] ??= []).push(t);
  return cols.filter(Boolean);
}

/** The dependencies not done yet (ids, also ids that are not in the list). */
export function waitingOn(item: Linked, items: readonly Pick<QueueItem, "id" | "status">[]): string[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const out: string[] = [];
  for (const d of item.deps) if (byId.get(d)?.status !== "landed" && !out.includes(d)) out.push(d);
  return out;
}

/** What to start next: the ready ones first, then the ones still waiting (Studio's nextUp). */
export function nextUp<T extends QueueItem>(items: readonly T[], n = 3): Array<{ item: T; waitingOn: string[] }> {
  const pending = items.filter((t) => t.status === "pending").map((item) => ({ item, waitingOn: waitingOn(item, items) }));
  return [...pending.filter((p) => p.waitingOn.length === 0), ...pending.filter((p) => p.waitingOn.length > 0)].slice(0, n);
}

/* ── tickets → queue items ────────────────────────────────────────────────────────────────────────────────────── */

export type QueueTicket = Pick<DeliveryTicket, "id" | "number" | "planRef" | "title" | "type" | "agent" | "column" | "isDone" | "doneAt" | "milestoneId" | "sortOrder" | "source"> & { dependsOn?: readonly string[] };
export type QueueJob = Pick<EngineJob, "id" | "kind" | "status" | "inputJson" | "createdAt">;

const inputOf = (job: QueueJob): Record<string, unknown> => {
  try {
    const v = job.inputJson ? JSON.parse(job.inputJson) as unknown : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch { return {}; }
};
/** The change request a change ticket belongs to: "cr:<id>:<k>" or "fx:<n>:<id>[:k]". */
export const changeOf = (planRef: string): string | null => /^(?:cr|fx:\d+):([^:]+)/.exec(planRef)?.[1] ?? null;

/** A change request as the queue reads it: its code and whether its build stopped. */
export type QueueChange = StoppableChange & { id: string; number: number; lane: string };

/** The newest build job of each milestone (build.run) and of each change request (change.build). */
function latestJobs(jobs: readonly QueueJob[]): { milestone: Map<string, QueueJob>; change: Map<string, QueueJob> } {
  const milestone = new Map<string, QueueJob>();
  const change = new Map<string, QueueJob>();
  const newer = (a: QueueJob | undefined, b: QueueJob) => !a || (time(b.createdAt) ?? -Infinity) > (time(a.createdAt) ?? -Infinity);
  for (const j of jobs) {
    const input = inputOf(j);
    const [map, id] = j.kind === "build.run" ? [milestone, input.milestoneId] : j.kind === "change.build" ? [change, input.changeRequestId] : [null, null];
    if (!map || typeof id !== "string" || !id) continue;
    if (newer(map.get(id), j)) map.set(id, j);
  }
  return { milestone, change };
}

const PR_RE = /pull request\s*#?(\d+)/i;
const COMMIT_RE = /\bcommit\s+([0-9a-f]{7,40})\b/i;

/** Every ticket of the project as a queue item, in milestone order (then the board's order); change work last. */
export function buildQueue(input: {
  tickets: readonly QueueTicket[];
  events: readonly Pick<DeliveryTicketEvent, "ticketId" | "kind" | "fromColumn" | "toColumn" | "text" | "at">[];
  milestones: readonly Pick<DeliveryMilestone, "id" | "number" | "sortOrder">[];
  jobs: readonly QueueJob[];
  /** The project's change requests: a change ticket then names its request and follows its stopped build. */
  changes?: readonly QueueChange[];
}): QueueItem[] {
  const ms = new Map(input.milestones.map((m) => [m.id, m]));
  const crs = new Map((input.changes ?? []).map((c) => [c.id, c]));
  const jobs = latestJobs(input.jobs);
  const evs = new Map<string, typeof input.events[number][]>();
  for (const e of input.events) (evs.get(e.ticketId) ?? evs.set(e.ticketId, []).get(e.ticketId)!).push(e);
  const ids = new Set(input.tickets.map((t) => t.id));

  const order = (t: QueueTicket) => {
    const m = t.milestoneId ? ms.get(t.milestoneId) : undefined;
    return [m ? 0 : 1, m?.sortOrder ?? 0, m?.number ?? 0, t.sortOrder, t.number] as const;
  };
  const sorted = [...input.tickets].sort((a, b) => {
    const x = order(a), y = order(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });

  const milestoneLabel = (n: number | null) => (n === null ? t("build.queue.milestone", "Milestone") : t("build.queue.milestoneN", "Milestone {number}", { number: n }));
  return sorted.map((t) => {
    const events = [...(evs.get(t.id) ?? [])].sort((a, b) => (time(a.at) ?? 0) - (time(b.at) ?? 0));
    const moves = events.filter((e) => e.kind === "move");
    const started = moves.find((e) => e.toColumn && e.toColumn !== "planned" && (e.fromColumn === "planned" || e.fromColumn === null)) ?? moves.find((e) => e.toColumn && e.toColumn !== "planned");
    const done = t.isDone || t.column === "done";
    const endedAt = done ? t.doneAt ?? [...moves].reverse().find((e) => e.toColumn === "done")?.at ?? null : null;
    // the newest send-back that the ticket has not yet got past (it is still before the stage that sent it back)
    const back = [...moves].reverse().find((e) => e.fromColumn && e.toColumn && at(e.toColumn) < at(e.fromColumn) && e.toColumn !== "planned");
    const sentBackFrom = !done && back?.fromColumn && at(t.column) < at(back.fromColumn) ? back.fromColumn : null;
    const feedback = t.source === "feedback";
    const cr = t.milestoneId ? null : changeOf(t.planRef);
    const job = t.milestoneId ? jobs.milestone.get(t.milestoneId) : cr ? jobs.change.get(cr) : undefined;
    const row = cr ? crs.get(cr) : undefined;
    // a change request's stopped build: the one rule (its newest build failed or was cancelled, or the request failed)
    const stopped = row ? changeStopped(row, job ?? null) : !!job && (job.status === "failed" || job.status === "cancelled");

    let status: QueueStatus;
    if (done) status = "landed";
    // a ticket of a change whose build stopped does not start by itself: it waits for the build to start again
    else if (t.column === "planned") status = cr && stopped ? "failed" : "pending";
    else if (stopped) status = "failed";
    else if (sentBackFrom || feedback) status = "recovering";
    else status = "running";

    let pullRequest: string | null = null;
    let commit: string | null = null;
    for (const e of events) {
      if (e.kind !== "artifact" && e.kind !== "note") continue;
      const pr = PR_RE.exec(e.text)?.[1];
      if (pr) pullRequest = `#${pr}`;
      commit = COMMIT_RE.exec(e.text)?.[1] ?? commit;
    }
    const m = t.milestoneId ? ms.get(t.milestoneId) : undefined;
    return {
      id: t.id,
      key: ticketLabel(t),
      title: t.title,
      deps: [...new Set(t.dependsOn ?? [])].filter((d) => d !== t.id && ids.has(d)),
      status,
      column: t.column,
      stage: done ? null : stageOf(t.column),
      type: t.type,
      milestoneId: t.milestoneId,
      milestone: t.milestoneId === null ? (row ? changeCode(row) : changesAndFixes()) : milestoneLabel(m?.number ?? null),
      change: row ? changeCode(row) : null,
      agent: agentName(t.agent),
      startedAt: started?.at ?? null,
      endedAt,
      pullRequest,
      commit,
      sentBackFrom: status === "recovering" ? sentBackFrom : null,
      feedback,
    };
  });
}

/* ── words ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
/** dd.MM.yyyy HH:mm (Swiss), local time; "–" for none. */
export function swissStamp(iso: string | null | undefined): string {
  const t = time(iso);
  if (t === null) return "–";
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The keys of the items an item waits for ("an earlier task" for one that is not on the board any more). */
export function waitingKeys(item: QueueItem, items: readonly QueueItem[]): string[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  return waitingOn(item, items).map((d) => byId.get(d)?.key ?? "an earlier task");
}

/** The queue status as the map shows it: pending splits into waiting (something to wait for) and ready. */
export function queueFlowStatus(item: QueueItem, items: readonly QueueItem[]): FlowStatus {
  switch (item.status) {
    case "pending": return waitingOn(item, items).length ? "waiting" : "ready";
    case "running": return "active";
    case "recovering": return "fixing";
    case "landed": return "done";
    case "failed": return "stopped";
  }
}

/** The status in plain words (the spec's labels). */
export function queueStatusText(item: QueueItem, items: readonly QueueItem[]): string {
  switch (item.status) {
    case "pending": {
      const keys = waitingKeys(item, items);
      return keys.length ? t("build.queue.status.waitingFor", "Waiting for {keys}", { keys: keys.join(", ") }) : t("build.queue.status.ready", "Ready to start");
    }
    case "running": return item.stage ? t("build.queue.status.inProgressAt", "In progress · {stage}", { stage: item.stage }) : t("build.queue.status.inProgress", "In progress");
    case "recovering": return t("build.queue.status.fixing", "Being fixed");
    case "landed": return t("build.queue.status.done", "Done");
    case "failed": return t("build.queue.status.stopped", "Stopped");
  }
}

/** The short line under a card's title (as on Studio's cards: what a pending task waits for, where a stopped one
 *  stopped; a running one names its stage; a finished one has none). */
export function queueNote(item: QueueItem, items: readonly QueueItem[]): { note: string; tone: "muted" | "success" | "danger" } {
  switch (item.status) {
    case "pending": {
      const keys = waitingKeys(item, items);
      return keys.length ? { note: t("build.queue.note.waitsFor", "waits for {keys}", { keys: keys.join(", ") }), tone: "muted" } : { note: t("build.queue.note.ready", "ready to start"), tone: "muted" };
    }
    case "running": return { note: [item.stage, item.agent].filter(Boolean).join(" · "), tone: "muted" };
    case "recovering":
      if (item.sentBackFrom && item.sentBackFrom in QUEUE_STAGE) {
        return { note: t("build.queue.note.sentBack", "sent back from {stage}", { stage: QUEUE_STAGE_INLINE[item.sentBackFrom as keyof typeof QUEUE_STAGE] }), tone: "muted" };
      }
      return { note: item.feedback ? t("build.queue.note.fixingFeedback", "fixing your feedback") : t("build.queue.note.fixing", "being fixed"), tone: "muted" };
    case "landed": return { note: "", tone: "muted" };
    case "failed": return { note: item.stage ? t("build.queue.note.stoppedIn", "stopped in {stage}", { stage: item.column in QUEUE_STAGE_INLINE ? QUEUE_STAGE_INLINE[item.column as keyof typeof QUEUE_STAGE] : item.stage.toLowerCase() }) : t("build.queue.note.buildStopped", "the build stopped"), tone: "danger" };
  }
}

/** How many items are in each state of the map (the legend's counts). */
export function queueCounts(items: readonly QueueItem[], all: readonly QueueItem[] = items): Partial<Record<FlowStatus, number>> {
  const out: Partial<Record<FlowStatus, number>> = {};
  for (const t of items) { const s = queueFlowStatus(t, all); out[s] = (out[s] ?? 0) + 1; }
  return out;
}

/* ── the FlowMap adapter ──────────────────────────────────────────────────────────────────────────────────────── */

/** Studio's edge rule: moving while the waiting task runs (or is being fixed), dashed while the dependency is not
 *  done, solid once it is. */
export function queueEdgeState(dep: Pick<QueueItem, "status">, item: Pick<QueueItem, "status">): FlowEdgeState {
  if (item.status === "running" || item.status === "recovering") return "active";
  return dep.status !== "landed" ? "pending" : "done";
}

/** The shown items as FlowMap nodes and edges; `all` (every item of the project) decides what is still waited for, so a
 *  filtered map still names a dependency in another milestone. Grouped by milestone ("changes" = after go-live). */
export function queueFlow(shown: readonly QueueItem[], all: readonly QueueItem[] = shown): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const byId = new Map(shown.map((t) => [t.id, t]));
  const fixWord = t("build.queue.fix", "Fix");
  const openTask = t("build.queue.openTask", "Open task");
  const nodes: FlowNode[] = shown.map((t) => {
    const { note, tone } = queueNote(t, all);
    return {
      id: t.id, key: t.key, title: t.title, kind: t.type === "fix" ? fixWord : undefined,
      status: queueFlowStatus(t, all), note: note || undefined, noteTone: tone, group: t.milestoneId ?? "changes",
      // like Studio's "Open run": the link shows once there is work to look at (every card opens its ticket)
      linkLabel: t.status === "pending" ? undefined : openTask,
      description: `${t.milestone} · ${queueStatusText(t, all)}`,
    };
  });
  const edges: FlowEdge[] = [];
  for (const t of shown) {
    for (const d of t.deps) {
      const dep = byId.get(d);
      if (dep) edges.push({ from: d, to: t.id, state: queueEdgeState(dep, t) });
    }
  }
  return { nodes, edges };
}

/** The milestone lanes of the map, in milestone order; "Changes and fixes" last. */
export function queueGroups(milestones: readonly Pick<DeliveryMilestone, "id" | "number" | "name" | "sortOrder">[]): FlowGroup[] {
  return [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
    .map((m) => ({ id: m.id, label: t("build.queue.lane", "Milestone {number} · {name}", { number: m.number, name: m.name }) }))
    .concat({ id: "changes", label: changesAndFixes() });
}

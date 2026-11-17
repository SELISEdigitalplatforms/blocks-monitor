// Parallel streams on the engine host (src/domain/parallelStreams.ts):
//
//   - the start of a change build: the job runner (driver.ts) claims a queued change.build only when the project's plan
//     of streams (planStreams over the project's rows) names it; otherwise it stays queued and its line says what it
//     waits for (a free stream, or a running build whose analysis touches the same code, data tables or change);
//   - the merge queue: ONE build of a product at a time integrates and lands on its development environment (the
//     rebase onto the latest branch, the gates, the push, the deploy, the data tables, the texts and the change's own
//     checks after it). A stream develops in its own working copies without the turn and asks for it right before it
//     integrates (the lane's `--merge-turn`); every other delivery job that deploys or checks (a build in the main
//     working tree, a fix round, a revert, the steps after a deploy) holds it for its whole run. First asked, first
//     served; a stopped job leaves the queue. The environment's limits on check runs (acceptance.limits, live_debug
//     caps) therefore see one run at a time, as before streams.
//   - the tech lead's advice (Project.StreamsAdvice): what the product's set-up on this host allows.
//
// The queue lives in this process (the engine that runs the product's builds; the product's repositories are on its
// host), on globalThis so a reloaded writer module shares it. After a restart the resumed jobs ask again.
import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../../functions/_lib/gateway";
import {
  MAX_STREAMS, STREAM_KINDS, parseStreamsAdvice, parseStreamsChoice, planStreams, productFriendly, queuedWords, repoKeysOf, sameAdvice, serializeStreamsAdvice, streamsInUse,
  type StreamChange, type StreamJob, type StreamPlan, type StreamsAdvice,
} from "../../../src/domain/parallelStreams";
import type { RowStore } from "../rowStore.ts";
import { num, str } from "./context.ts";
import { JobGone } from "./run.ts";

// ------------------------------------------------------------------ the plan from the store

export const streamJobOf = (j: Row): StreamJob => ({
  id: str(j.ItemId), kind: str(j.Kind), status: str(j.Status), inputJson: str(j.InputJson) || null,
  createdAt: str(j.CreatedDate) || null, claimedAt: str(j.ClaimedAt) || null, finishedAt: str(j.FinishedAt) || null,
});

export const streamChangeOf = (c: Row): StreamChange => ({
  id: str(c.ItemId), lane: str(c.Lane), number: num(c.Number, 1) || 1, title: str(c.Title), status: str(c.Status), analysis: c.Analysis ?? null,
});

/** The streams a project uses now: the person's choice (Project.ParallelStreams), never above the advice. */
export const projectStreams = (project: Row | null | undefined): number =>
  streamsInUse(parseStreamsChoice(project?.ParallelStreams), parseStreamsAdvice(project?.StreamsAdvice));

/** The project's plan of streams from the rows the engine holds (pure but for the reads). */
export function storePlan(store: Pick<RowStore, "rows" | "get">, projectId: string): StreamPlan {
  const jobs = store.rows("EngineJob").filter((j) => j.ProjectId === projectId && (j.Kind === "change.build" || j.Kind === "build.run"));
  const changes = store.rows("ChangeRequest").filter((c) => c.ProjectId === projectId && c.IsDeleted !== true);
  const project = store.get("Project", projectId);
  return planStreams({
    jobs: jobs.map(streamJobOf), changes: changes.map(streamChangeOf), limit: projectStreams(project),
    repoKeys: repoKeysOf(parseStreamsAdvice(project?.StreamsAdvice)), friendly: productFriendly(parseStreamsAdvice(project?.StreamsAdvice)),
  });
}

/** The change requests the project's active change builds name that the engine does not hold yet (the Blocks worker
 *  loads a project's rows only when one of its jobs starts): their analyses decide what may run side by side. */
export function missingChanges(store: Pick<RowStore, "rows" | "get">, projectId: string): string[] {
  const ids = new Set<string>();
  for (const j of store.rows("EngineJob")) {
    if (j.ProjectId !== projectId || str(j.Kind) !== "change.build" || !["queued", "claimed", "running"].includes(str(j.Status))) continue;
    let id = "";
    try {
      id = str((JSON.parse(str(j.InputJson) || "{}") as Record<string, unknown>).changeRequestId);
    } catch {
      /* no change named */
    }
    if (id && !store.get("ChangeRequest", id)) ids.add(id);
  }
  return [...ids];
}

/** The line of a held-back job while the analyses it is weighed against are being read. */
export const READING_WORDS = "Waits while the analyses of the builds are read.";

/** What a queued job waits for before the job runner may claim it, or null when it may start now. Only change builds
 *  are held back (a milestone's build and every other kind start as before). `load` (the Blocks worker) starts reading
 *  the change requests the store does not hold yet and answers the ones still being read; while any is, the job waits
 *  with READING_WORDS (one that cannot be read counts as naming no code). */
export function holdBack(store: Pick<RowStore, "rows" | "get">, job: Row, load?: (changeRequestIds: string[]) => string[]): string | null {
  if (!STREAM_KINDS.includes(str(job.Kind)) || str(job.Kind) !== "change.build" || str(job.Status) !== "queued") return null;
  if (load) {
    const missing = missingChanges(store, str(job.ProjectId));
    if (missing.length && load(missing).length) return READING_WORDS;
  }
  const plan = storePlan(store, str(job.ProjectId));
  if (plan.startable.includes(str(job.ItemId))) return null;
  return queuedWords(plan, str(job.ItemId)) || "Waits for a free stream.";
}

// ------------------------------------------------------------------ the merge queue

interface Waiter { jobId: string; grant: () => void; moved?: (position: number) => void }
interface Queue { holder: string | null; waiters: Waiter[]; landed?: string }
const KEY = Symbol.for("madp.engine.mergeQueues");
const queues = (): Map<string, Queue> => {
  const g = globalThis as unknown as Record<symbol, Map<string, Queue> | undefined>;
  return (g[KEY] ??= new Map());
};

/** Who holds a project's merge turn and who waits for it, in order (tests, lines). */
export function mergeQueueOf(projectId: string): { holder: string | null; waiting: string[] } {
  const q = queues().get(projectId);
  return { holder: q?.holder ?? null, waiting: q?.waiters.map((w) => w.jobId) ?? [] };
}

/** The job that held a project's merge turn last (the change that landed before): "" when none did in this process. */
const LANDED = Symbol.for("madp.engine.lastLanded");
const landedMap = (): Map<string, string> => {
  const g = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;
  return (g[LANDED] ??= new Map());
};
export const lastLandedOf = (projectId: string): string => landedMap().get(projectId) ?? "";

/** Empties every queue (tests). */
export function resetMergeQueues(): void {
  queues().clear();
}

/** Its place in line: the build landing now is the 1st, the first waiting one the 2nd, … */
const placeOf = (q: Queue, jobId: string): number => q.waiters.findIndex((w) => w.jobId === jobId) + 2;

function acquire(projectId: string, jobId: string, signal: AbortSignal, onWait?: (holder: string, position: number) => void, moved?: (position: number) => void): Promise<void> {
  if (signal.aborted) return Promise.reject(new JobGone("stopped"));
  const all = queues();
  const q = all.get(projectId) ?? { holder: null, waiters: [] };
  all.set(projectId, q);
  if (q.holder === null || q.holder === jobId) {
    q.holder = jobId;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      q.waiters = q.waiters.filter((w) => w !== me);
      for (const w of q.waiters) w.moved?.(placeOf(q, w.jobId));
      reject(new JobGone("stopped"));
    };
    const me: Waiter = { jobId, grant: () => { signal.removeEventListener("abort", onAbort); resolve(); }, moved };
    q.waiters.push(me);
    signal.addEventListener("abort", onAbort, { once: true });
    onWait?.(q.holder!, placeOf(q, jobId));
  });
}

function release(projectId: string, jobId: string): void {
  const all = queues();
  const q = all.get(projectId);
  if (!q || q.holder !== jobId) return;
  landedMap().set(projectId, jobId);
  const next = q.waiters.shift();
  q.holder = next?.jobId ?? null;
  if (next) next.grant();
  else all.delete(projectId);
  // everyone still in line moved up one place
  for (const w of q.waiters) w.moved?.(placeOf(q, w.jobId));
}

/** One job's turn in its project's merge queue: `grant` waits for it (again after a release), `release` hands it on
 *  (idempotent). `onWait` hears which job holds it when this one has to wait. */
export interface MergeTurn {
  readonly held: boolean;
  /** `onWait` hears which job holds the turn and this one's place in line when it has to wait; `moved` its new place
   *  each time the line moves up. */
  grant(onWait?: (holder: string, position: number) => void, moved?: (position: number) => void): Promise<void>;
  release(): void;
}

export function mergeTurn(projectId: string, jobId: string, signal: AbortSignal): MergeTurn {
  let held = false;
  return {
    get held() { return held; },
    async grant(onWait, moved) {
      if (held) return;
      await acquire(projectId, jobId, signal, onWait, moved);
      held = true;
    },
    release() {
      if (!held) return;
      held = false;
      release(projectId, jobId);
    },
  };
}

/** Runs `work` holding the project's merge turn (a delivery job that deploys or checks from the start), and hands it on
 *  however the work ends. */
export async function inMergeTurn<T>(o: { projectId: string; jobId: string; signal: AbortSignal; onWait?: (holder: string, position: number) => void | Promise<void> }, work: () => Promise<T>): Promise<T> {
  const turn = mergeTurn(o.projectId, o.jobId, o.signal);
  try {
    await turn.grant((h, p) => void o.onWait?.(h, p));
    return await work();
  } finally {
    turn.release();
  }
}

/** The file an isolated lane waits on (`--merge-turn`): "go" is written into it when the job gets its turn. */
export function turnFile(projectDir: string, jobId: string): string {
  return path.join(projectDir, "turns", `${jobId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "job"}.turn`);
}

export function writeGo(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "go\n");
}

export function removeTurnFile(file: string): void {
  for (const f of [file, `${file}.ask`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* gone */
    }
  }
}

// ------------------------------------------------------------------ the tech lead's advice (Project.StreamsAdvice)

const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** What a product's registry on this host allows (pure): every repository with npm packages links them into a separate
 *  working copy (`isolation.links: [node_modules]`), the engine knows `--merge-turn`, and no limit of the environment
 *  that survives a deploy (acceptance.limits without `resets: deploy`) is smaller per hour than what one landing's checks
 *  need. The live-debug cap paces the developers' probes by itself and keeps room for the checks: never a cap here.
 *  `hasPackages` says whether a repository path has a package.json. */
export function adviceOf(data: Row, o: { engineStreams: boolean; hasPackages: (repoPath: string) => boolean; now: string }): StreamsAdvice {
  const repos = Object.entries(rec(data.repos));
  const at = o.now;
  // the repo keys: a path a ticket names as "api/src/x.ts" is the api repo's
  const keys = repos.map(([k]) => k.toLowerCase()).filter((k) => /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(k)).slice(0, 12);
  // the product's append-only registration files that never make changes wait (registry streams.merge_friendly)
  const friendly = list(rec(data.streams).merge_friendly)
    .map((x) => /^([A-Za-z0-9_.-]{1,40})\s*:\s*(\S.*)$/.exec(x.trim()))
    .filter((m): m is RegExpExecArray => !!m && !m[2]!.split(/[\\/]/).includes("..") && !/^[/\\]|^[A-Za-z]:/.test(m[2]!))
    .map((m) => `${m[1]!.toLowerCase()}: ${m[2]!.trim().replace(/\\/g, "/")}`)
    .slice(0, 40);
  const base = { v: 1 as const, repos: repos.length, ...(keys.length ? { keys } : {}), ...(friendly.length ? { friendly } : {}), at };
  if (!o.engineStreams) return { ...base, cap: 1, why: "The engine on the build host cannot build changes side by side yet." };
  const notReady = repos.filter(([, v]) => {
    const r = rec(v);
    return o.hasPackages(str(r.path)) && !list(rec(r.isolation).links).some((l) => l.replace(/\/+$/, "") === "node_modules");
  });
  if (!repos.length || notReady.length) {
    return { ...base, cap: 1, why: "The product's repositories are not set up for separate working copies yet, so its changes build one at a time." };
  }
  // the environment's limits on what the checks use (acceptance.limits). A limit that resets with every deploy is a
  // budget per landing: each landing redeploys and its checks start from a fresh budget, and landings come one at a time
  // anyway, so it never limits the streams. A limit that does not reset lowers the cap only when the checks of ONE
  // landing need more than it allows in an hour (the fixtures' share plus one test file's).
  const tight: { name: string; perHour: number; need: number }[] = [];
  for (const [, v] of repos) {
    const acc = rec(rec(v).acceptance);
    for (const l of Array.isArray(acc.limits) ? acc.limits : []) {
      const lim = rec(l);
      if (str(lim.resets).toLowerCase() === "deploy") continue;
      // the engine's AcceptanceLimit: max per window (seconds, default an hour), per_file, fixtures
      const max = num(lim.max, 0);
      const seconds = num(lim.window, 0) || 3600;
      if (max <= 0) continue;
      const perHour = (max * 3600) / seconds;
      const need = Math.max(1, num(lim.per_file, 1)) + Math.max(0, num(lim.fixtures, 0));
      if (need > perHour) tight.push({ name: str(lim.name) || "a limit", perHour, need });
    }
  }
  if (tight.length) {
    const t = tight.sort((a, b) => a.perHour / a.need - b.perHour / b.need)[0]!;
    const per = Number.isInteger(t.perHour) ? String(t.perHour) : t.perHour.toFixed(1);
    return { ...base, cap: 2, why: `The development environment allows ${per} ${t.name.replace(/[-_]+/g, " ")} an hour and does not reset that with a deploy, while one change's checks need ${t.need}; 2 at most.` };
  }
  return { ...base, cap: MAX_STREAMS, why: "" };
}

/** The advice row's value when it changed (null when the stored one says the same). */
export function adviceUpdate(project: Row | null | undefined, advice: StreamsAdvice): string | null {
  return sameAdvice(parseStreamsAdvice(project?.StreamsAdvice), advice) ? null : serializeStreamsAdvice(advice);
}

/** A loader of change requests for holdBack (the Blocks worker): reads each missing one once, in the background, and
 *  calls `done` when a read ends (the job runner looks again); answers the ones still being read. A change request that
 *  is not there any more is not read again. */
export function changeLoader(read: (id: string) => Promise<unknown>, done: () => void, log: (line: string) => void = () => undefined): (ids: string[]) => string[] {
  const reading = new Set<string>();
  const tried = new Set<string>();
  return (ids) => {
    for (const id of ids) {
      if (reading.has(id) || tried.has(id)) continue;
      reading.add(id);
      void read(id).then(
        () => undefined,
        (e: unknown) => log(`streams: change request ${id.slice(0, 8)} not read (${String(e).slice(0, 120)})`),
      ).finally(() => {
        reading.delete(id);
        tried.add(id);
        done();
      });
    }
    return ids.filter((id) => reading.has(id));
  };
}

/** "2nd", "3rd", "11th" (pure). */
export function ordinal(n: number): string {
  const ten = n % 100;
  const suffix = ten >= 11 && ten <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** The line of a built stream waiting for its turn to land: "Ready, waits for its turn to land (2nd in line)." */
export const readyWords = (position: number): string => `Ready, waits for its turn to land (${ordinal(position)} in line).`;

// Host A background worker for the durable project purge (functions/_lib/purge.ts): a tick at once after a
// project.delete (wake hook) and on a slow idle poll that resumes work left over by a restart.
type Level = "info" | "warn" | "error";

export interface PurgeTickResultLike {
  picked: number;
  finished: string[];
  pending: string[];
  failed: string[];
  nextDueMs: number | null;
}

interface PurgePlatform {
  env: Record<string, string | undefined>;
  apiUrl?: string;
  fetch?: typeof fetch;
  tokenStore?: unknown;
}

export interface PurgeModuleLike {
  runProjectPurgeTick: (platform: PurgePlatform & { log?: (level: Level, line: string) => void }, opts?: unknown) => Promise<PurgeTickResultLike>;
  onProjectPurgeWake: (fn: (projectId: string) => void) => () => void;
}

export interface PurgeWorkerDeps {
  load(): Promise<PurgeModuleLike>;
  platform: PurgePlatform;
  log?: (level: Level, line: string) => void;
  idleMs?: number;
  busyMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  /** True while interactive user requests wait on the Blocks gateway; the worker then yields. */
  isBusy?: () => boolean;
  /** Re-check interval while busy. */
  yieldMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  tickOpts?: { maxProjects?: number; concurrency?: number; budgetMs?: number };
}

/** Small batches: one project per tick, a modest fan-out, a short budget. */
export const PURGE_TICK_OPTS = { maxProjects: 1, concurrency: 2, budgetMs: 10_000 };

/** Delay before the next attempt after `failures` consecutive failed ticks (30 s, 1 min, 2 min … max 10 min). */
export function purgeWorkerBackoffMs(failures: number, idleMs = 30_000, maxMs = 600_000): number {
  if (!(failures >= 1)) return 0;
  return Math.min(maxMs, idleMs * 2 ** (failures - 1));
}

const CONFIG_KEYS = ["MF_SVC_CLIENT_ID", "MF_SVC_CLIENT_SECRET", "MF_BLOCKS_TENANT"] as const;

/** The error's class or code only, never its message (it may carry data). */
function errorTag(e: unknown): string {
  if (e && typeof e === "object") {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[\w.-]{1,40}$/.test(code)) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string" && /^[\w.-]{1,40}$/.test(name)) return name;
  }
  return "Error";
}

export function createPurgeWorker(deps: PurgeWorkerDeps) {
  const idleMs = deps.idleMs ?? 30000;
  const busyMs = deps.busyMs ?? 1000;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const log = deps.log ?? (() => undefined);
  const yieldMs = deps.yieldMs ?? 2_000;
  const maxBackoffMs = deps.maxBackoffMs ?? 600_000;
  const now = deps.now ?? Date.now;
  const tickOpts = deps.tickOpts ?? PURGE_TICK_OPTS;
  const safeIsBusy = (): boolean => {
    try {
      return deps.isBusy?.() === true;
    } catch {
      return false;
    }
  };
  let failures = 0;
  let mod: PurgeModuleLike | null = null;
  let unhook: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let stopped = false;
  let ticking = false;
  let again = false;

  const clear = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    if (stopped) return;
    clear();
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };

  async function tick(): Promise<void> {
    if (stopped || !mod) return;
    if (ticking) {
      again = true;
      return;
    }
    if (safeIsBusy()) {
      schedule(yieldMs);
      return;
    }
    ticking = true;
    clear();
    let next = idleMs;
    let failed = false;
    try {
      const platform = {
        ...deps.platform,
        env: {
          ...deps.platform.env,
          BLOCKS_API_URL: deps.platform.apiUrl ?? deps.platform.env.MF_BLOCKS_API_URL,
          BLOCKS_TENANT: deps.platform.env.MF_BLOCKS_TENANT,
          SVC_CLIENT_ID: deps.platform.env.MF_SVC_CLIENT_ID,
          SVC_CLIENT_SECRET: deps.platform.env.MF_SVC_CLIENT_SECRET,
        },
        log,
      };
      const r = await mod.runProjectPurgeTick(platform, { ...tickOpts, yieldNow: () => safeIsBusy() });
      failures = 0;
      if (r.finished.length || r.failed.length || r.picked) {
        log("info", `[fn] purge finished ${r.finished.length}, pending ${r.pending.length}, failed ${r.failed.length}`);
      }
      if (r.pending.length > 0) next = busyMs;
      else if (r.nextDueMs !== null) next = Math.max(busyMs, Math.min(r.nextDueMs, idleMs));
    } catch (e) {
      failures += 1;
      failed = true;
      next = purgeWorkerBackoffMs(failures, idleMs, maxBackoffMs);
      log("warn", `[fn] purge tick failed (${errorTag(e)}); next attempt in ${Math.round(next / 1000)} s at ${new Date(now() + next).toISOString()}`);
    } finally {
      ticking = false;
    }
    if (stopped) return;
    if (failed) {
      again = false;
      schedule(next);
      return;
    }
    if (again) {
      again = false;
      void tick();
      return;
    }
    schedule(next);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      stopped = false;
      if (CONFIG_KEYS.some((k) => !deps.platform.env[k]?.trim())) {
        log("info", "[fn] purge worker off: not configured");
        return;
      }
      void (async () => {
        try {
          const loaded = await deps.load();
          if (stopped) return;
          mod = loaded;
          unhook = loaded.onProjectPurgeWake(() => this_wake());
          await tick();
        } catch (e) {
          log("warn", `[fn] purge worker not started (${errorTag(e)})`);
        }
      })();
    },
    wake(): void {
      this_wake();
    },
    stop(): void {
      stopped = true;
      again = false;
      clear();
      unhook?.();
      unhook = null;
    },
    isRunning(): boolean {
      return started && !stopped && mod !== null;
    },
  };

  function this_wake(): void {
    if (stopped || !mod) return;
    if (failures > 0 && !ticking && timer) return; // in backoff: the scheduled attempt picks the work up
    void tick();
  }
}

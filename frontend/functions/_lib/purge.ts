// The durable background purge of a deleted project. project.delete only marks the Project Status 'deleting'; this
// module finishes the job: cancel the engine jobs, remove every child row of PROJECT_PURGE_SCHEMAS (its Storage objects
// first; the recipients' notifications too), write the audit event, remove the Project row LAST. The kept history
// (PROJECT_CASCADE_KEEP: command log, audit trail, credit ledger) stays. The job is the Project Status plus one
// Operation row per project (backoff and progress). Idempotent and resumable: every tick starts from the rows that
// still exist. Every host runs it: server/local/host.ts and server/blocks/host.ts (server/fnHost/purgeWorker.ts).
import { applyJobEvent, isEngineJobStatus, isTerminal } from "../../src/domain/engineJob";
import { PROJECT_PURGE_SCHEMAS, cascadeFieldsOf, fileIdsOf } from "../../src/domain/projects";
import { sanitizeDetails } from "./audit";
import { readEnv } from "./env";
import { OpError, toErrorBody } from "./errors";
import { LIB_FIELDS } from "./fields";
import { f } from "./filter";
import { createRawGateway, type RawGateway, type Row } from "./gateway";
import { readCaller } from "./caller";
import { deadlineGateway } from "./deadline";
import { uuid5 } from "./ids";
import { MAX_RESULT_CHARS } from "./operation";
import { guardPaging } from "./paging";
import { defaultSdk, type SdkFactory } from "./sdk";
import { serviceClient, serviceTokens, type TokenStore } from "./serviceToken";
import { createFiles } from "./storage";

export const PURGE_OP = "project.purge";

type Level = "info" | "warn" | "error";

const WAKE_KEY = Symbol.for("mf.projectPurge.wake");
const TICK_KEY = Symbol.for("mf.projectPurge.tick");
const g = globalThis as unknown as Record<symbol, unknown>;

function hooks(): Set<(projectId: string) => void> {
  let set = g[WAKE_KEY] as Set<(projectId: string) => void> | undefined;
  if (!set) {
    set = new Set();
    g[WAKE_KEY] = set;
  }
  return set;
}

/** Registers a hook told when a project was marked 'deleting'; returns the function that removes it. */
export function onProjectPurgeWake(fn: (projectId: string) => void): () => void {
  const set = hooks();
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** Tells every registered hook (never throws). */
export function wakeProjectPurge(projectId: string): void {
  for (const fn of [...hooks()]) {
    try {
      fn(projectId);
    } catch {
      // a hook never changes the answer of project.delete
    }
  }
}

export interface PurgeDeps {
  raw: RawGateway;
  files: { remove(fileId: string): Promise<void> };
  ids: { uuid5(name: string): string };
  now: () => Date;
  monoMs?: () => number;
  log?: (level: Level, line: string) => void;
}

export interface PurgeTickResult {
  picked: number;
  finished: string[];
  pending: string[];
  failed: string[];
  nextDueMs: number | null;
}

export interface PurgeOptions {
  maxProjects?: number;
  budgetMs?: number;
  concurrency?: number;
  /** True while user requests are waiting: stop taking more projects (user traffic has priority). */
  yieldNow?: () => boolean;
}

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 300_000;
const MAX_ATTEMPT = 10;
const PAGE = 100;
// The Operation schema accepts pending|done|failed: 'pending' is the running state.
const RUNNING = "pending";

/** 0 for attempt 0, then 2 s * 2^(attempt-1), capped at 300 s. */
export function purgeBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (Math.min(attempt, 30) - 1));
}

const CHILD_SCHEMAS = PROJECT_PURGE_SCHEMAS;
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const ENGINE_FIELDS = ["ItemId", "Status", "Progress", "Attempts", "Message"];

interface OpState {
  itemId: string | null;
  attempt: number;
  nextAt: number;
  phase: string;
  deleted: Record<string, number>;
  status: string;
}

function parseResult(json: unknown): { nextAt: number; phase: string; deleted: Record<string, number> } {
  const out = { nextAt: 0, phase: "", deleted: {} as Record<string, number> };
  if (typeof json !== "string" || json === "") return out;
  try {
    const v = JSON.parse(json) as { nextAt?: unknown; phase?: unknown; deleted?: unknown };
    if (typeof v.nextAt === "number" && Number.isFinite(v.nextAt)) out.nextAt = v.nextAt;
    if (typeof v.phase === "string") out.phase = v.phase;
    if (v.deleted && typeof v.deleted === "object" && !Array.isArray(v.deleted)) {
      for (const [k, n] of Object.entries(v.deleted)) if (typeof n === "number" && Number.isFinite(n) && n >= 0) out.deleted[k] = n;
    }
  } catch {
    // an unreadable record starts from scratch
  }
  return out;
}

function opStateOf(row: Row | undefined): OpState {
  const r = parseResult(row?.ResultJson);
  const attempt = typeof row?.Attempt === "number" && Number.isFinite(row.Attempt) ? Math.max(0, Math.min(MAX_ATTEMPT, Math.trunc(row.Attempt))) : 0;
  return {
    itemId: row && str(row.ItemId) ? str(row.ItemId) : null,
    attempt,
    nextAt: r.nextAt,
    phase: r.phase,
    deleted: r.deleted,
    status: str(row?.Status),
  };
}

function resultJson(s: { nextAt: number; phase: string; deleted: Record<string, number> }): string {
  let json = JSON.stringify({ nextAt: s.nextAt, phase: s.phase, deleted: s.deleted });
  if (json.length > MAX_RESULT_CHARS) json = JSON.stringify({ nextAt: s.nextAt, phase: s.phase, deleted: { total: Object.values(s.deleted).reduce((a, b) => a + b, 0) } });
  return json;
}

/** Runs the tasks through a pool; stops starting new ones after the first failure and rethrows it. */
async function pool<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { e: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await run(item);
      } catch (e) {
        failure ??= { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker));
  if (failure) throw (failure as { e: unknown }).e;
}

class Where extends Error {
  constructor(readonly cause0: unknown, readonly phase: string, readonly schema: string, readonly deleted: Record<string, number> = {}) {
    super("purge");
  }
}

async function purgeOne(
  deps: PurgeDeps,
  project: Row,
  existing: Row | undefined,
  o: { concurrency: number; budgetLeft: () => boolean },
): Promise<"finished" | "pending"> {
  const { raw, now } = deps;
  const projectId = str(project.ItemId);
  const workspaceId = str(project.WorkspaceId);
  const actor = str(project.UpdatedByUserId) || "system";
  const requestKey = deps.ids.uuid5(`natural:project.purge:${projectId}`);
  const op = opStateOf(existing);
  let step = { phase: "start", schema: "" };
  let wroteRunning = false;
  const deleted = { ...op.deleted };

  const saveOp = async (patch: { Status: string; ErrorCode: string; Attempt: number; ResultJson: string }): Promise<void> => {
    if (op.itemId) {
      await raw.update("Operation", op.itemId, { ...patch, UpdatedByUserId: actor });
      return;
    }
    const row: Row = {
      RequestKey: requestKey,
      RequestId: requestKey,
      Op: PURGE_OP,
      ActorUserId: actor,
      ...(workspaceId ? { WorkspaceId: workspaceId } : {}),
      ProjectId: projectId,
      ...patch,
      CreatedByUserId: actor,
      UpdatedByUserId: actor,
    };
    const res = await raw.insert("Operation", row);
    if (res.itemId) op.itemId = res.itemId;
    if (!res.created) {
      if (!res.itemId) throw new OpError("unavailable");
      await raw.update("Operation", res.itemId, { ...patch, UpdatedByUserId: actor });
    }
  };
  const progress = (phase: string): Promise<void> =>
    saveOp({ Status: RUNNING, ErrorCode: "", Attempt: op.attempt, ResultJson: resultJson({ nextAt: 0, phase, deleted }) });

  try {
    // R2: one turn, the first page of every child schema.
    step = { phase: "read", schema: "" };
    let pages = await readPages(raw, projectId);
    for (let round = 1; ; round += 1) {
      const rows = pages.flatMap((p) => p.items.map((row) => ({ schema: p.schema, row })));
      if (rows.length === 0) break;
      // The Operation row is written only once there is work (an empty project needs none until it is done).
      if (!wroteRunning) {
        wroteRunning = true;
        step = { phase: "progress", schema: "Operation" };
        await progress("children");
      }
      step = { phase: "children", schema: "" };
      const at = now().toISOString();
      // The engine must write nothing into a project being deleted: every job of this page is cancelled before any row
      // is removed. A full page of jobs is worked off alone first, so no job outlives the first removal of another schema.
      const jobs = rows.filter((x) => x.schema === "EngineJob");
      step = { phase: "children", schema: "EngineJob" };
      await pool(jobs, o.concurrency, ({ row }) => cancelJob(raw, row, at));
      const work = jobs.length >= PAGE ? jobs : rows;
      await pool(work, o.concurrency, async ({ schema, row }) => {
        step = { phase: "children", schema };
        const id = str(row.ItemId);
        if (!id) return;
        for (const fileId of fileIdsOf(schema, row)) {
          try {
            await deps.files.remove(fileId);
          } catch (e) {
            if (!(e instanceof OpError && e.code === "not_found")) throw e;
          }
        }
        await raw.remove(schema, id);
        deleted[schema] = (deleted[schema] ?? 0) + 1;
      });
      if (!o.budgetLeft()) {
        step = { phase: "progress", schema: "Operation" };
        await progress("children");
        return "pending";
      }
      step = { phase: "read", schema: "" };
      pages = await readPages(raw, projectId);
    }

    step = { phase: "audit", schema: "AuditEvent" };
    const auditKey = deps.ids.uuid5(`natural:project.purge.audit:${projectId}`);
    await raw.insert("AuditEvent", {
      RequestKey: auditKey,
      ActorUserId: actor,
      ActorIsSuperAdmin: false,
      Impersonated: false,
      Action: "project.delete",
      TargetType: "project",
      TargetId: projectId,
      DetailsJson: sanitizeDetails({ deleted }),
      At: now().toISOString(),
      CreatedByUserId: actor,
      UpdatedByUserId: actor,
      ...(workspaceId ? { WorkspaceId: workspaceId } : {}),
      ProjectId: projectId,
    });

    step = { phase: "project", schema: "Project" };
    try {
      await raw.remove("Project", projectId);
    } catch (e) {
      // Gone already (another host finished it first) is success.
      if ((await raw.get("Project", projectId, ["ItemId"]).catch(() => ({}) as Row | null)) !== null) throw e;
    }

    step = { phase: "done", schema: "Operation" };
    await saveOp({ Status: "done", ErrorCode: "", Attempt: op.attempt, ResultJson: resultJson({ nextAt: 0, phase: "done", deleted }) });
    return "finished";
  } catch (e) {
    throw new Where(e, step.phase, step.schema, deleted);
  }
}

async function cancelJob(raw: RawGateway, row: Row, at: string): Promise<void> {
  const id = str(row.ItemId);
  if (!isEngineJobStatus(row.Status) || isTerminal(row.Status)) return;
  const res = applyJobEvent(
    {
      status: row.Status,
      progress: typeof row.Progress === "number" ? row.Progress : 0,
      attempts: typeof row.Attempts === "number" ? row.Attempts : 0,
      message: str(row.Message) || null,
    },
    "cancel",
    "system",
  );
  if (!res.ok) return;
  await raw.update("EngineJob", id, {
    Status: res.job.status,
    Progress: res.job.progress,
    Attempts: res.job.attempts,
    Message: res.job.message ?? "",
    FinishedAt: at,
    ActiveKey: id,
  });
}

async function readPages(raw: RawGateway, projectId: string): Promise<{ schema: string; items: Row[] }[]> {
  return Promise.all(
    CHILD_SCHEMAS.map(async (schema) => {
      const fields = schema === "EngineJob" ? ENGINE_FIELDS : cascadeFieldsOf(schema);
      const res = await raw.find(schema, { where: f.eq("ProjectId", projectId), fields, pageSize: PAGE });
      return { schema, items: res.items };
    }),
  );
}

export async function runPurgeTick(deps: PurgeDeps, opts: PurgeOptions = {}): Promise<PurgeTickResult> {
  const running = g[TICK_KEY] as Promise<PurgeTickResult> | undefined;
  if (running) return running;
  const p = tick(deps, opts).finally(() => {
    if (g[TICK_KEY] === p) delete g[TICK_KEY];
  });
  g[TICK_KEY] = p;
  return p;
}

async function tick(deps: PurgeDeps, opts: PurgeOptions): Promise<PurgeTickResult> {
  const maxProjects = opts.maxProjects ?? 5;
  const budgetMs = opts.budgetMs ?? 20_000;
  const concurrency = opts.concurrency ?? 8;
  const mono = deps.monoMs ?? (() => Date.now());
  const began = mono();
  const yieldNow = () => {
    try {
      return opts.yieldNow?.() === true;
    } catch {
      return false;
    }
  };
  const log = deps.log ?? (() => undefined);
  const out: PurgeTickResult = { picked: 0, finished: [], pending: [], failed: [], nextDueMs: null };
  const wait = (ms: number): void => {
    out.nextDueMs = out.nextDueMs === null ? ms : Math.min(out.nextDueMs, ms);
  };

  // R1: one turn.
  const [deleting, ops] = await Promise.all([
    deps.raw.find("Project", {
      where: f.eq("Status", "deleting"),
      fields: ["ItemId", "WorkspaceId", "UpdatedByUserId", "LastUpdatedDate"],
      sort: { field: "LastUpdatedDate", dir: "asc" },
      pageSize: 20,
    }),
    deps.raw.find("Operation", {
      where: f.and(f.eq("Op", PURGE_OP), f.in("Status", ["pending", "failed"])),
      fields: LIB_FIELDS.Operation,
      pageSize: PAGE,
    }),
  ]);
  const byProject = new Map<string, Row>();
  for (const row of ops.items) if (str(row.ProjectId)) byProject.set(str(row.ProjectId), row);

  const nowMs = deps.now().getTime();
  const due: { project: Row; existing: Row | undefined }[] = [];
  for (const project of deleting.items) {
    const id = str(project.ItemId);
    if (!id) continue;
    const existing = byProject.get(id);
    if (existing && existing.Status === "failed") {
      const st = opStateOf(existing);
      if (st.nextAt > nowMs) {
        wait(st.nextAt - nowMs);
        continue;
      }
    }
    due.push({ project, existing });
  }

  for (const { project, existing } of due) {
    if (out.picked >= maxProjects || (out.picked > 0 && (mono() - began >= budgetMs || yieldNow()))) {
      out.pending.push(str(project.ItemId));
      continue;
    }
    out.picked += 1;
    const projectId = str(project.ItemId);
    try {
      const r = await purgeOne(deps, project, existing, { concurrency, budgetLeft: () => mono() - began < budgetMs && !yieldNow() });
      (r === "finished" ? out.finished : out.pending).push(projectId);
      if (r === "finished") log("info", `purge done project=${projectId}`);
    } catch (e) {
      const w = e instanceof Where ? e : new Where(e, "start", "");
      const code = w.cause0 instanceof OpError ? w.cause0.code : "internal";
      const st = opStateOf(existing);
      const attempt = Math.min(MAX_ATTEMPT, st.attempt + 1);
      const nextAt = deps.now().getTime() + purgeBackoffMs(attempt);
      log("warn", `purge failed project=${projectId} phase=${w.phase} schema=${w.schema || "-"} code=${code} attempt=${attempt}`);
      out.failed.push(projectId);
      wait(nextAt - deps.now().getTime());
      await recordFailure(deps, project, code, attempt, nextAt, st, w.deleted).catch(() => undefined);
    }
  }
  return out;
}

async function recordFailure(deps: PurgeDeps, project: Row, code: string, attempt: number, nextAt: number, st: OpState, deleted: Record<string, number>): Promise<void> {
  const projectId = str(project.ItemId);
  const actor = str(project.UpdatedByUserId) || "system";
  const patch = { Status: "failed", ErrorCode: code, Attempt: attempt, ResultJson: resultJson({ nextAt, phase: st.phase, deleted: Object.keys(deleted).length ? deleted : st.deleted }) };
  let itemId = st.itemId;
  if (!itemId) {
    // The run may have created the row before it failed: find it by its unique key.
    const key = deps.ids.uuid5(`natural:project.purge:${projectId}`);
    const workspaceId = str(project.WorkspaceId);
    const res = await deps.raw.insert("Operation", {
      RequestKey: key,
      RequestId: key,
      Op: PURGE_OP,
      ActorUserId: actor,
      ...(workspaceId ? { WorkspaceId: workspaceId } : {}),
      ProjectId: projectId,
      ...patch,
      CreatedByUserId: actor,
      UpdatedByUserId: actor,
    });
    if (res.created) return;
    itemId = res.itemId;
  }
  if (itemId) await deps.raw.update("Operation", itemId, { ...patch, UpdatedByUserId: actor });
}

/**
 * Test hook: runs the purge to completion without timers (deterministic). A project in backoff is retried by moving
 * the clock forward by the wait the tick reported; stops when nothing is left or after `maxTicks`.
 */
export async function drainProjectPurge(deps: PurgeDeps, opts: PurgeOptions & { maxTicks?: number } = {}): Promise<PurgeTickResult> {
  let offset = 0;
  const shifted: PurgeDeps = { ...deps, now: () => new Date(deps.now().getTime() + offset) };
  let last: PurgeTickResult = { picked: 0, finished: [], pending: [], failed: [], nextDueMs: null };
  for (let i = 0; i < (opts.maxTicks ?? 50); i += 1) {
    last = await runPurgeTick(shifted, opts);
    if (last.picked === 0 && last.nextDueMs === null) break;
    if (last.nextDueMs !== null) offset += last.nextDueMs + 1;
  }
  return last;
}

export interface PurgePlatform {
  env: Record<string, string | undefined>;
  apiUrl?: string;
  fetch?: typeof fetch;
  tokenStore?: unknown;
  log?: (level: Level, line: string) => void;
}

/** The service gateway and the Storage service for the background purge, built the way the router builds them. */
export async function runProjectPurgeTick(platform: PurgePlatform, opts?: PurgeOptions): Promise<PurgeTickResult> {
  const base = readEnv(platform.env);
  const apiUrl = platform.apiUrl ? platform.apiUrl.trim().replace(/\/+$/, "") : base.apiUrl;
  const env = { ...base, apiUrl };
  const sdkOf: SdkFactory = platform.fetch ? (o) => defaultSdk({ ...o, fetch: o.fetch ?? platform.fetch }) : defaultSdk;
  const tokens = serviceTokens(env, sdkOf, Date.now, platform.tokenStore ? { store: platform.tokenStore as TokenStore } : {});
  const raw = deadlineGateway(guardPaging(createRawGateway({ env, sdk: sdkOf, tokens, fetch: platform.fetch })));
  const files = createFiles({
    client: serviceClient(env, sdkOf, tokens),
    workspaceIdOf: async () => {
      throw new OpError("internal");
    },
  });
  return runPurgeTick(
    {
      raw,
      files: {
        async remove(fileId) {
          try {
            await files.remove(fileId);
          } catch (e) {
            if (!(e instanceof OpError && e.code === "not_found")) throw e;
          }
        },
      },
      ids: { uuid5: (name) => uuid5(name) },
      now: () => new Date(),
      ...(platform.log ? { log: platform.log } : {}),
    },
    opts,
  );
}

/** Blocks Logic Function entry (Host B): the same tick for a signed-in caller. */
export async function handleProjectPurge(
  request: unknown,
  platformCtx: unknown,
): Promise<{ statusCode: number; headers?: Record<string, string>; body: unknown }> {
  void request;
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  const ctx = (platformCtx && typeof platformCtx === "object" ? platformCtx : {}) as {
    context?: unknown;
    env?: unknown;
    fetch?: typeof fetch;
    tokenStore?: unknown;
    log?: { info?(s: string): void; warn?(s: string): void; error?(s: string): void };
  };
  const serverNow = (): string => new Date().toISOString();
  try {
    const env = readEnv(ctx.env);
    readCaller(ctx.context, env.tenant);
    const data = await runProjectPurgeTick({
      env: ctx.env as Record<string, string | undefined>,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      ...(ctx.tokenStore ? { tokenStore: ctx.tokenStore } : {}),
      log: (level, line) => {
        try {
          ctx.log?.[level]?.(line);
        } catch {
          // logging never changes the answer
        }
      },
    });
    return { statusCode: 200, headers: { ...headers }, body: { ok: true, data, serverNow: serverNow() } };
  } catch (e) {
    const eb = toErrorBody(e instanceof OpError ? e : null);
    return { statusCode: eb.status, headers: { ...headers }, body: { ok: false, error: eb.error, serverNow: serverNow() } };
  }
}

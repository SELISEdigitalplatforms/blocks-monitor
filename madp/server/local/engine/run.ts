// One claimed job while the engine works on it: what a kind's writer reads (the job, its input, the project) and how
// it writes (stamped rows with job-scoped RequestKeys, progress, notifications, files). Every write first checks that
// the job is still this attempt's and still active, so a cancel, a retry or a reset stops the work cleanly.
//
// Restart safety: a writer that runs again for the same attempt (after a server restart) repeats its steps. Inserts
// reuse their RequestKey (the gateway answers the existing row), updates are idempotent, and until the writer's
// progress reaches the progress the job had stored, its waits are skipped, so it catches up at once and then goes on.
import fs from "node:fs";
import path from "node:path";
import { capKey } from "../../../functions/_lib/ids";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { JOB_CLAIM_LEASE_MS, JOB_HEARTBEAT_MS, isHostMaintenance, type EngineJobKind } from "../../../src/domain/engineJob";
import type { AfterDeployDetails, AfterDeployIssue } from "../../../src/domain/afterDeploy";
import type { RowStore } from "../rowStore.ts";
import type { EngineConfig } from "./config.ts";
import { ProjectView, num, str, strs } from "./context.ts";
import type { ProjectFolder } from "./projectFolder.ts";
import { rand, type Rand } from "./text.ts";

/** The job is no longer this run's to work on (cancelled, retried, removed by a reset, or the engine stopped). */
export class JobGone extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JobGone";
  }
}

/** A job that cannot be done, with a plain reason for people: the job fails with this message (and code) instead of the
 *  engine's general one (driver.ts). A message that is not plain (tool output, an exit code, a path, a stack) is
 *  replaced by the kind's plain sentence on the way out (plainMessages.ts); the code stays. */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly code = "engine.failed",
  ) {
    super(message);
    this.name = "JobFailure";
  }
}

export interface RunDeps {
  store: RowStore;
  gateway: RawGateway;
  config(): EngineConfig;
  now(): Date;
  log(line: string): void;
  /** Waits ms; rejects when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Stores bytes as a ready Storage file of the project; answers its file id. */
  putFile?(f: { workspaceId: string; projectId: string; name: string; mime: string; bytes: Uint8Array }): Promise<string>;
  /** The bytes of a Storage file (a DocFile's StorageObjectId), or null when it is not there. */
  readFile?(fileId: string): Promise<Uint8Array | null>;
  /** A child-only repository credential resolved from the current Blocks connection and job requester. */
  repositoryEnvironment?(project: Row, job: Row): Promise<{ env: Record<string, string>; redact(text: string): string }>;
  /** The project's folder on the engine host (projectFolder.ts, under MF_ENGINE_ROOT); absent when no root is set. */
  projectFolder?(workspaceId: string, projectId: string, o?: { name?: string }): ProjectFolder;
  /** Factor on a kind's waits (the paced "working" time of local mode). The Blocks worker answers 0 for the steps whose
   *  work is real (Claude's text, the writes): they finish as soon as the work is done. Default 1. */
  waitScale?(kind: EngineJobKind): number;
  /** Progress reports go to the Data Gateway in the background (the latest one wins; finish waits for them), so a
   *  writer never waits for a progress line. Default false: every report is written before the writer goes on. */
  backgroundProgress?: boolean;
  /** Cloud release on Blocks workers; never falls back to the local preview server. */
}

/** Runs fn over the items with at most `limit` at once; answers the results in the items' order. The first failure
 *  rejects (after the ones already started have settled), so a JobGone stops the work like a sequential loop would. */
export async function inParallel<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed: { e: unknown } | null = null;
  const lane = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        failed ??= { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (failed) throw (failed as { e: unknown }).e;
  return out;
}

export interface KindResult {
  /** "Schema:ItemId" of every row the job wrote. */
  outputs: string[];
  /** The job's last line for people (at most 200 characters). */
  message: string;
  /** A delivery build whose code is live but whose steps after the deploy did not all finish (official/afterDeploy.ts):
   *  the job still succeeds and its ErrorCode names these (src/domain/afterDeploy.ts afterDeployCode). */
  attention?: AfterDeployIssue[];
  /** Their details for the ErrorCode (the change's own checks: "<failed>/<files>" test files, or "fixtures"). */
  attentionDetails?: AfterDeployDetails;
  /** The ErrorCode of a delivery job that succeeded without deploying anything (src/domain/afterDeploy.ts
   *  NOTHING_DEPLOYED_CODE: a fix round that found nothing to change); never a delivery, so the build it followed keeps
   *  what it left open. Wins over `attention`. */
  code?: string;
}

export type KindWriter = (run: JobRun) => Promise<KindResult>;

const ACTIVE = new Set(["claimed", "running"]);
/** The names a file of a job's attempt folder may have. */
const JOB_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export function parseInput(raw: unknown): Record<string, unknown> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The workspace of a job's project folder: the job's own, which must be its project's (a job row naming another
 *  workspace than its project row is refused, so no job can reach a folder outside its own project). */
export function folderWorkspaceOf(run: { workspaceId: string; p: { workspaceId: string } }): string {
  const own = run.p.workspaceId;
  if (own && run.workspaceId && own !== run.workspaceId) throw new Error("this job's workspace is not its project's workspace");
  return run.workspaceId || own;
}

/** A heartbeat this soon after the job row's last write is skipped. The lease (JOB_CLAIM_LEASE_MS) is still renewed
 *  at least every gap + beat interval (about 55 s), well inside it. */
export const HEARTBEAT_MIN_GAP_MS = 25_000;
if (HEARTBEAT_MIN_GAP_MS + JOB_HEARTBEAT_MS * 2 >= JOB_CLAIM_LEASE_MS) throw new Error("heartbeat gap must keep the claim lease");

export class JobRun {
  readonly id: string;
  readonly kind: EngineJobKind;
  readonly attempt: number;
  readonly input: Record<string, unknown>;
  readonly projectId: string;
  readonly workspaceId: string;
  /** The person who asked for the work; rows the engine writes for them carry their id, as the engine's writes do. */
  readonly requester: string;
  readonly readers: string[];
  readonly rand: Rand;
  readonly p: ProjectView;
  /** Present only after a successful, smoke-tested Blocks deployment. */
  /** The progress the job had when this run started (a resumed run catches up to it without waiting). */
  readonly resumeFrom: number;
  private shown: number;
  private reached = 0;
  private holding = 0;
  private folderCache: ProjectFolder | null = null;
  private jobDirCache: string | null | undefined;
  /** Background progress (deps.backgroundProgress): the patch not written yet, and the write under way. */
  private pendingProgress: Row | null = null;
  private progressWrite: Promise<void> | null = null;
  /** When the job's row was last written by this run (epoch ms): a heartbeat soon after any write writes nothing. */
  private lastWrittenAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly deps: RunDeps,
    job: Row,
    readonly signal: AbortSignal,
  ) {
    this.id = str(job.ItemId);
    this.kind = str(job.Kind) as EngineJobKind;
    this.attempt = num(job.Attempts, 1) || 1;
    this.input = parseInput(job.InputJson);
    this.projectId = str(job.ProjectId);
    this.workspaceId = str(job.WorkspaceId);
    this.requester = str(job.RequestedByUserId) || str(job.CreatedByUserId);
    this.p = new ProjectView(deps.store, this.projectId);
    const readers = strs(job.ReaderIds);
    this.readers = readers.length > 0 ? readers : strs(this.p.project.ReaderIds);
    this.rand = rand(`engine:${this.id}:${this.attempt}`);
    this.resumeFrom = job.Status === "running" ? num(job.Progress) : 0;
    this.shown = num(job.Progress);
  }

  /** The job row as stored now. */
  get job(): Row {
    return this.deps.store.get("EngineJob", this.id) ?? { ItemId: this.id };
  }

  now(): Date {
    return this.deps.now();
  }
  iso(offsetMs = 0): string {
    return new Date(this.deps.now().getTime() + offsetMs).toISOString();
  }
  get config(): EngineConfig {
    return this.deps.config();
  }

  /** Throws JobGone unless the job is still this attempt's and claimed or running. */
  check(): void {
    if (this.signal.aborted && this.holding === 0) throw new JobGone("stopped");
    const j = this.deps.store.get("EngineJob", this.id);
    if (!j) throw new JobGone("removed");
    if (j.ErrorCode === "design.stopRequested") throw new JobGone("cancel requested");
    if (!ACTIVE.has(str(j.Status))) throw new JobGone(`status ${str(j.Status)}`);
    if ((num(j.Attempts, 1) || 1) !== this.attempt) throw new JobGone("another attempt");
  }

  /** Runs a group of writes that belong together (a ticket move and its events): a stop of the engine waits for the end
   *  of the group instead of cutting it in half. A cancel by a person still stops it. */
  async together<T>(fn: () => Promise<T>): Promise<T> {
    this.check();
    this.holding += 1;
    try {
      return await fn();
    } finally {
      this.holding -= 1;
    }
  }

  /** True while the run is catching up with the progress stored before a restart. */
  get replaying(): boolean {
    return this.reached < this.resumeFrom;
  }

  /** For a writer that works out where it stands from the rows themselves (a build): no catching up, every wait is real. */
  resumeHere(): void {
    this.reached = Math.max(this.reached, this.resumeFrom);
  }

  /** Works for about `seconds` at pace 1 (scaled by the pace, with a little natural variation). */
  async wait(seconds: number, jitter = 0.15): Promise<void> {
    this.check();
    if (this.replaying) return;
    const j = 1 + (this.rand.next() * 2 - 1) * jitter;
    const scale = this.deps.waitScale ? Math.max(0, this.deps.waitScale(this.kind)) : 1;
    if (scale === 0) return;
    const ms = Math.max(0, seconds * j * 1000 * this.config.pace * scale);
    if (ms > 0) await this.deps.sleep(ms, this.signal);
    this.check();
  }

  /** Reports progress (0–100, never backwards) and the line people see (made plain and fitted to 200 characters on
   *  the way out: plainMessages.ts; a raw line is left out and logged). */
  /** A new line at the progress shown now (a wait inside a step: "Ready, waits for its turn to land (2nd in line)."). */
  say(message: string): Promise<void> {
    return this.step(this.shown, message);
  }

  async step(progress: number, message?: string): Promise<void> {
    this.check();
    const p = Math.max(0, Math.min(99, Math.round(progress)));
    this.reached = Math.max(this.reached, p);
    if (p < this.shown) return;
    const patch: Row = { Progress: p };
    if (message !== undefined) patch.Message = message;
    if (this.job.Status === "claimed") patch.Status = "running";
    this.shown = p;
    if (!this.deps.backgroundProgress) {
      await this.deps.gateway.update("EngineJob", this.id, patch);
      this.lastWrittenAt = this.deps.now().getTime();
      return;
    }
    this.pendingProgress = { ...(this.pendingProgress ?? {}), ...patch };
    this.progressWrite ??= this.writeProgress();
  }

  /** Writes the pending progress, one write at a time (the conditional EngineJob update needs the state it saw). */
  private async writeProgress(): Promise<void> {
    try {
      while (this.pendingProgress) {
        const patch = this.pendingProgress;
        this.pendingProgress = null;
        try {
          await this.deps.gateway.update("EngineJob", this.id, patch);
          this.lastWrittenAt = this.deps.now().getTime();
        } catch (e) {
          // a progress line is not the work: the next report or the finish writes the state again
          this.deps.log(`[engine] ${this.kind} ${this.id.slice(0, 8)}: progress not written (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
        }
      }
    } finally {
      this.progressWrite = null;
    }
  }

  /** Waits until the progress reported so far is written (before the job's last state is written). */
  async flush(): Promise<void> {
    while (this.progressWrite) await this.progressWrite;
  }

  /** Refresh the live lease without replacing the latest progress message or reporting an older progress value. The
   *  job's own 30 s beat and a lane's 20 s beat both call this: a beat within HEARTBEAT_MIN_GAP_MS of the row's last
   *  write (a progress line counts) writes nothing, so the lease costs one write per ~30 s, not one per beat. */
  async heartbeat(): Promise<void> {
    this.check();
    if (!this.pendingProgress && this.deps.now().getTime() - this.lastWrittenAt < HEARTBEAT_MIN_GAP_MS) return;
    await this.step(this.shown);
  }

  /** The RequestKey of an output row of this attempt. */
  key(local: string): string {
    return capKey(`engine:${this.id}:${this.attempt}:${local}`);
  }

  /** The workspace access fields every project row carries. */
  stamp(by?: string): Row {
    const who = by || this.requester;
    return { WorkspaceId: this.workspaceId, ReaderIds: [...this.readers], CreatedByUserId: who, UpdatedByUserId: who };
  }

  /** Inserts a project row (ProjectId, workspace access, CreatedBy/UpdatedBy, RequestKey); answers its ItemId. */
  async insert(schema: string, fields: Row, local: string, o?: { by?: string; requestKey?: string }): Promise<string> {
    this.check();
    const row: Row = { ProjectId: this.projectId, ...fields, ...this.stamp(o?.by), RequestKey: o?.requestKey ?? this.key(local) };
    const res = await this.deps.gateway.insert(schema, row);
    if (res.itemId) return res.itemId;
    // Another unique index holds the values (a person made the same record meanwhile): answer that row.
    const hit = this.deps.store.conflict(schema, row);
    if (hit) return hit.itemId;
    throw new Error(`${schema} ${local} was not stored`);
  }

  async update(schema: string, itemId: string, patch: Row): Promise<void> {
    this.check();
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null));
    if (Object.keys(clean).length === 0) return;
    await this.deps.gateway.update(schema, itemId, clean);
  }

  async remove(schema: string, itemId: string): Promise<void> {
    this.check();
    await this.deps.gateway.remove(schema, itemId);
  }

  /** One bell item per recipient (Notification rows carry no ReaderIds: the recipient reads their own). */
  async notify(n: { kind: string; to: readonly string[]; params: Record<string, string | number>; link: string; eventKey: string }): Promise<void> {
    this.check();
    const eventKey = n.eventKey.slice(0, 160);
    const params = { projectId: this.projectId, projectName: this.p.name, workspaceId: this.workspaceId, ...n.params };
    for (const to of [...new Set(n.to)].filter(Boolean)) {
      await this.deps.gateway.insert("Notification", {
        RecipientUserId: to,
        WorkspaceId: this.workspaceId,
        ProjectId: this.projectId,
        EventKey: eventKey,
        Kind: n.kind,
        ParamsJson: JSON.stringify(params),
        Link: n.link,
        IsRead: false,
        EmailStatus: "none",
        CreatedByUserId: to,
        UpdatedByUserId: to,
        RequestKey: capKey(`notify:${eventKey}:${to}`),
      });
    }
  }

  /** Stores a file the job made (a screen design) in the project's Storage folder; answers its file id. */
  async putFile(name: string, mime: string, bytes: Uint8Array): Promise<string> {
    this.check();
    if (!this.deps.putFile) throw new Error("no file storage");
    return this.deps.putFile({ workspaceId: this.workspaceId, projectId: this.projectId, name, mime, bytes });
  }

  /** Reads a Storage file the people shared (a DocFile's StorageObjectId); null when it cannot be read. */
  async readFile(fileId: string): Promise<Uint8Array | null> {
    this.check();
    if (!this.deps.readFile || !fileId) return null;
    try {
      return await this.deps.readFile(fileId);
    } catch {
      return null;
    }
  }

  /** Queues a follow-on job of the engine itself (a preview after a build); answers its id (an active one is reused). */
  async queueJob(o: { kind: EngineJobKind; input: Row; target?: { type: string; id: string }; requestKey: string }): Promise<string> {
    this.check();
    const activeKey = `${o.kind}:${o.target?.id ?? "project"}`;
    const row: Row = {
      ProjectId: this.projectId,
      Kind: o.kind,
      Status: "queued",
      Progress: 0,
      Attempts: 0,
      Message: "",
      ActiveKey: activeKey,
      InputJson: JSON.stringify(o.input),
      RequestedByUserId: this.requester,
      ...(o.target ? { TargetType: o.target.type, TargetId: o.target.id } : {}),
      ...this.stamp(),
      RequestKey: capKey(o.requestKey),
    };
    // The compiled output belongs to the build host. Its preview must start there,
    // rather than a different worker that only has the shared job records.
    const buildHost = str(this.job.ClaimedBy);
    if (o.kind === "preview.deploy" && (this.kind === "build.run" || this.kind === "change.build") && buildHost && this.deps.projectFolder) {
      Object.assign(row, { Status: "claimed", Attempts: 1, ClaimedBy: buildHost, ClaimedAt: this.iso() });
    }
    const res = await this.deps.gateway.insert("EngineJob", row);
    if (res.itemId) return res.itemId;
    const active = this.deps.store.rows("EngineJob").find((j) => j.ProjectId === this.projectId && j.ActiveKey === activeKey);
    if (active) return str(active.ItemId);
    throw new Error(`${o.kind} was not queued`);
  }

  /** The project's folder on the engine host (repo/, worktrees/, inputs/, artifacts/, builds/, jobs/, logs/). Throws when
   *  the engine runs without MF_ENGINE_ROOT (local mode, tests). */
  folder(): ProjectFolder {
    if (this.folderCache) return this.folderCache;
    if (!this.deps.projectFolder) throw new Error("this engine has no project folders (MF_ENGINE_ROOT is not set)");
    this.folderCache = this.deps.projectFolder(this.folderWorkspaceId(), this.projectId, { name: this.p.name });
    return this.folderCache;
  }

  /** The workspace of the project's folder: the job's, which must be its project's own (a job row that names another
   *  workspace than its project row is refused, so no job can reach a folder outside its own project). */
  folderWorkspaceId(): string {
    return folderWorkspaceOf(this);
  }

  /** This attempt's folder (jobs/<jobId>-<attempt>/) for its prompt, transcript, result and log; null without folders. */
  jobDir(): string | null {
    if (this.jobDirCache !== undefined) return this.jobDirCache;
    // A host-maintenance job has no project folder (its ProjectId is the "system" sentinel): making one would drop a
    // fake projects/system/<jobId> folder with git and project.json on the host for every attempt.
    if (isHostMaintenance(this.kind)) return (this.jobDirCache = null);
    try {
      this.jobDirCache = this.deps.projectFolder ? this.folder().job(this.id, this.attempt) : null;
    } catch (e) {
      this.jobDirCache = null;
      this.deps.log(`[engine] ${this.kind} ${this.id.slice(0, 8)}: no job folder (${e instanceof Error ? e.message : String(e)})`);
    }
    return this.jobDirCache;
  }

  /** True when this attempt's folder already has the file (an earlier start of this attempt on this host wrote it). */
  hasJobFile(name: string): boolean {
    const dir = this.jobDir();
    if (!dir || !JOB_FILE.test(name)) return false;
    return fs.existsSync(path.join(dir, name));
  }

  /** A JSON file of this attempt's folder (job.json, result.json); null when it is missing or not JSON. */
  readJobFile(name: string): unknown {
    const dir = this.jobDir();
    if (!dir || !JOB_FILE.test(name)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  /** Writes a file into this attempt's folder (best effort: never fails the job); answers its path or null. */
  writeJobFile(name: string, data: string | Uint8Array | object): string | null {
    const dir = this.jobDir();
    if (!dir || !JOB_FILE.test(name)) return null;
    try {
      const file = path.join(dir, name);
      const body = typeof data === "string" || data instanceof Uint8Array ? data : `${JSON.stringify(data, null, 2)}\n`;
      fs.writeFileSync(file, body);
      return file;
    } catch {
      return null;
    }
  }

  log(line: string): void {
    const text = `[engine] ${this.kind} ${this.id.slice(0, 8)}: ${line}`;
    this.deps.log(text);
    const dir = this.jobDir();
    if (dir) {
      try {
        fs.appendFileSync(path.join(dir, "log.txt"), `${new Date().toISOString()} ${line}\n`);
      } catch {
        /* the main log has the line */
      }
    }
  }
}

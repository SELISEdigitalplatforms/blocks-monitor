// deps.jobs: create, cancel and retry of EngineJob rows (docs/ENGINE-CONTRACT.md, design 12.3).
import {
  applyJobEvent,
  isEngineJobKind,
  isEngineJobStatus,
  isTerminal,
  MAX_JOB_ATTEMPTS,
  newJobState,
  type EngineJobKind,
  type EngineJobState,
} from "../../src/domain/engineJob";
import { OpError } from "./errors";
import { f } from "./filter";
import type { FindOptions, RawGateway, Row } from "./gateway";
import type { BoundIds } from "./ids";
import { assertPaywall, isPaywalledKind } from "./paywall";
import type { ScopedGateway } from "./scopedGateway";

/** Copy of blocks/data/validations.json EngineJob.InputJson maxLength. */
export const MAX_JOB_INPUT_CHARS = 200000;

export interface JobCreateInput {
  kind: EngineJobKind;
  projectId: string;
  input: unknown;
  targetType?: string;
  targetId?: string;
  eventKey?: string;
  /**
   * Server-derived only: an active member id an op read from a record (for example a brief confirmer).
   * It is never an args value; the default is the caller.
   */
  requestedByUserId?: string;
}

export interface JobsService {
  create(i: JobCreateInput): Promise<{ job: Row; existing: boolean }>;
  /** `row` is a job row the op already read: the load is skipped. */
  cancel(jobId: string, opts: { actor: "user" | "system"; row?: Row }): Promise<Row>;
  retry(jobId: string, opts?: { row?: Row }): Promise<Row>;
  /** Cancels many job rows the op already read, in one round with no reads; terminal rows and rows the actor may not cancel are skipped. */
  cancelRows(rows: readonly Row[], opts: { actor: "user" | "system" }): Promise<{ cancelled: string[]; skipped: string[] }>;
  /** Points a job at another target in one update (ActiveKey follows); returns the merged row. */
  relink(job: Row, opts: { targetId: string; input: unknown }): Promise<Row>;
  load(jobId: string): Promise<Row>;
}

export interface JobsOptions {
  gw: ScopedGateway;
  raw: RawGateway;
  ids: BoundIds;
  caller: { userId: string };
  workspaceId: string | null;
  now: () => Date;
  /** The project id the router already loaded and checked against the workspace; its existence read is skipped. */
  verifiedProjectId?: string | null;
  /** Operator-configured routing, never a browser argument. Inserts atomically assigned to the upgraded worker. */
  factoryDesignWorkerId?: string;
  figmaDesignWorkerId?: string;
  extractionWorkerId?: string;
}

/** The ActiveKey of a job that is queued, claimed or running. */
export function activeKeyOf(kind: string, targetId?: string): string {
  return `${kind}:${targetId ?? "project"}`;
}

function rowsOf(res: unknown): Row[] {
  if (Array.isArray(res)) return res as Row[];
  if (res && typeof res === "object") {
    const r = res as { items?: unknown; rows?: unknown; data?: unknown };
    for (const c of [r.items, r.rows, r.data]) if (Array.isArray(c)) return c as Row[];
  }
  return [];
}

function stateOf(job: Row): EngineJobState {
  const status = job.Status;
  if (!isEngineJobStatus(status)) throw new OpError("internal");
  const msg = job.Message;
  return {
    status,
    progress: typeof job.Progress === "number" ? job.Progress : 0,
    attempts: typeof job.Attempts === "number" ? job.Attempts : 0,
    message: typeof msg === "string" && msg !== "" ? msg : null,
  };
}

function stateFields(s: EngineJobState): Row {
  return { Status: s.status, Progress: s.progress, Attempts: s.attempts, Message: s.message ?? "" };
}

export const JOB_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId",
  "Progress", "Message", "Attempts", "FinishedAt", "RequestedByUserId", "ClaimedBy", "ClaimedAt",
];

/** Retry host-local delivery work where its source and build files already live. */
export function retryHostClaim(job: Row, now: string): Row {
  const host = job.ClaimedBy;
  if (!["build.run", "change.build", "preview.deploy"].includes(String(job.Kind)) || typeof host !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(host)) return {};
  return { Status: "claimed", Attempts: Number(job.Attempts ?? 0) + 1, ClaimedBy: host, ClaimedAt: now, ErrorCode: "" };
}

/** The exact read create() and retry() make for the active job of a key, so an op can prefetch it. */
export function activeJobQuery(projectId: string, activeKey: string): FindOptions {
  return { where: f.and(f.eq("ProjectId", projectId), f.eq("ActiveKey", activeKey)), fields: JOB_FIELDS, pageSize: 1 };
}

export function createJobs(o: JobsOptions): JobsService {
  const activeByKey = async (projectId: string, activeKey: string): Promise<Row | null> => {
    const res = await o.gw.find("EngineJob", activeJobQuery(projectId, activeKey));
    return rowsOf(res)[0] ?? null;
  };

  async function load(jobId: string): Promise<Row> {
    const job = await o.gw.get("EngineJob", jobId, JOB_FIELDS);
    if (!job) throw new OpError("not_found");
    return { ...job, ItemId: jobId };
  }

  return {
    load,

    async create(i) {
      if (!isEngineJobKind(i.kind)) throw new TypeError("Unknown engine job kind.");
      if (o.workspaceId === null) throw new TypeError("Engine jobs need a workspace.");
      if (!o.verifiedProjectId || i.projectId !== o.verifiedProjectId) {
        const projects = rowsOf(
          await o.raw.find("Project", {
            where: f.and(f.eq("ItemId", i.projectId), f.eq("WorkspaceId", o.workspaceId)),
            fields: ["ItemId"],
            pageSize: 1,
          }),
        );
        if (projects.length === 0) throw new OpError("not_found");
      }

      const inputJson = JSON.stringify(i.input ?? {});
      if (inputJson.length > MAX_JOB_INPUT_CHARS) throw new OpError("too_large");
      // Builds, analyses and fix rounds need credit left when the platform enforces billing (functions/_lib/paywall.ts).
      if (isPaywalledKind(i.kind)) await assertPaywall(o.raw, o.workspaceId);

      const activeKey = activeKeyOf(i.kind, i.targetId);
      const row: Row = {
        ProjectId: i.projectId,
        Kind: i.kind,
        ...stateFields(newJobState()),
        ActiveKey: activeKey,
        InputJson: inputJson,
        RequestedByUserId: i.requestedByUserId ?? o.caller.userId,
      };
      if (i.kind === "design.generate" && i.input && typeof i.input === "object" && ["factory", "screens"].includes(String((i.input as { workflow?: unknown }).workflow))) {
        const workerId = (i.input as { workflow?: unknown }).workflow === 'screens' ? o.figmaDesignWorkerId ?? o.factoryDesignWorkerId : o.factoryDesignWorkerId;
        if (!workerId) throw new OpError("not_configured", "design.workerNotConfigured");
        Object.assign(row, { Status: "claimed", Attempts: 1, ClaimedBy: workerId, ClaimedAt: o.now().toISOString(),
          Message: "Waiting for the design worker." });
      }
      const extractionWorker = o.extractionWorkerId ?? o.factoryDesignWorkerId;
      if (i.kind === "file.extract" && extractionWorker) {
        Object.assign(row, { Status: "claimed", Attempts: 1, ClaimedBy: extractionWorker, ClaimedAt: o.now().toISOString(),
          Message: "Waiting for the extraction worker." });
      }
      const buildWorker = process.env.MF_BUILD_WORKER_ID?.trim();
      if (i.kind === "build.run" && buildWorker) {
        Object.assign(row, { Status: "claimed", Attempts: 1, ClaimedBy: buildWorker, ClaimedAt: o.now().toISOString(),
          Message: "Waiting for the build worker." });
      }
      if (i.targetType !== undefined) row.TargetType = i.targetType;
      if (i.targetId !== undefined) row.TargetId = i.targetId;

      const requestKey = o.ids.job(i.eventKey);
      const res = await o.gw.insert("EngineJob", row, { requestKey });
      if (res.created) return { job: { ...row, ItemId: res.itemId }, existing: false };
      // The same RequestKey wrote it already (a retried run, or a key that names an earlier job): the job as it is now,
      // so a caller never takes a job that already finished for one that was just queued. One read, on this path only;
      // a row that cannot be read yet was written a moment ago and is answered as it was written.
      if (res.itemId) {
        const stored = await o.gw.get("EngineJob", res.itemId, JOB_FIELDS);
        return { job: { ...row, ...(stored ?? {}), ItemId: res.itemId }, existing: true };
      }

      const active = await activeByKey(i.projectId, activeKey);
      if (active) return { job: active, existing: true };
      const byKey = rowsOf(
        await o.gw.find("EngineJob", { where: f.eq("RequestKey", requestKey), fields: JOB_FIELDS, pageSize: 1 }),
      )[0];
      if (byKey) return { job: byKey, existing: true };
      throw new OpError("conflict");
    },

    async cancel(jobId, { actor, row }) {
      const job = row ? { ...row, ItemId: jobId } : await load(jobId);
      // A repeat of a cancel that already went through (a retried invocation) is not an error.
      if (job.Status === "cancelled") return job;
      if (job.Kind === "design.generate" && job.ErrorCode === "design.stopRequested") return job;
      const res = applyJobEvent(stateOf(job), "cancel", actor);
      if (!res.ok) throw new OpError("conflict", "job.notCancellable");
      const patch: Row = job.Kind === "design.generate" && ["claimed", "running"].includes(String(job.Status))
        ? { ErrorCode: "design.stopRequested", Message: "Stop requested. Waiting for the design runner to exit." }
        : { ...stateFields(res.job), FinishedAt: o.now().toISOString(), ActiveKey: jobId };
      if (job.Kind === "design.generate") {
        const result = await o.gw.updateMany("EngineJob", f.and(f.eq("ItemId", jobId), f.eq("Status", String(job.Status)), f.eq("Attempts", Number(job.Attempts ?? 0))), patch);
        if (result.matched === 0) {
          const current = await load(jobId);
          if (current.Status === "cancelled" || current.ErrorCode === "design.stopRequested") return current;
          throw new OpError("conflict", "job.notCancellable");
        }
      } else await o.gw.update("EngineJob", jobId, patch);
      return { ...job, ...patch };
    },

    async retry(jobId, opts) {
      const job = opts?.row ? { ...opts.row, ItemId: jobId } : await load(jobId);
      const s = stateOf(job);
      if (s.status !== "failed" || s.attempts >= MAX_JOB_ATTEMPTS) throw new OpError("conflict", "job.notRetryable");
      const res = applyJobEvent(s, "retry", "user");
      if (!res.ok) throw new OpError("conflict", "job.notRetryable");
      const kind = String(job.Kind);
      const targetId = typeof job.TargetId === "string" && job.TargetId !== "" ? job.TargetId : undefined;
      const activeKey = activeKeyOf(kind, targetId);
      if (isTerminal(res.job.status)) throw new OpError("internal");
      const clash = await activeByKey(String(job.ProjectId), activeKey);
      if (clash && clash.ItemId !== jobId) throw new OpError("conflict", "job.alreadyActive");
      const patch: Row = { ...stateFields(res.job), ActiveKey: activeKey, ...retryHostClaim(job, o.now().toISOString()) };
      try {
        await o.gw.update("EngineJob", jobId, patch);
      } catch (e) {
        if (e instanceof OpError && e.code === "conflict") throw new OpError("conflict", "job.alreadyActive");
        throw e;
      }
      return { ...job, ...patch };
    },

    async cancelRows(rows, { actor }) {
      const cancelled: string[] = [];
      const skipped: string[] = [];
      const at = o.now().toISOString();
      const work: Promise<void>[] = [];
      for (const row of rows) {
        const id = typeof row.ItemId === "string" ? row.ItemId : "";
        if (id === "") continue;
        if (!isEngineJobStatus(row.Status) || isTerminal(row.Status)) {
          skipped.push(id);
          continue;
        }
        const res = applyJobEvent(stateOf(row), "cancel", actor);
        if (!res.ok) {
          skipped.push(id);
          continue;
        }
        cancelled.push(id);
        work.push(o.gw.update("EngineJob", id, { ...stateFields(res.job), FinishedAt: at, ActiveKey: id }));
      }
      await Promise.all(work);
      return { cancelled, skipped };
    },

    async relink(job, { targetId, input }) {
      const jobId = String(job.ItemId ?? "");
      if (jobId === "") throw new OpError("internal");
      const inputJson = JSON.stringify(input ?? {});
      if (inputJson.length > MAX_JOB_INPUT_CHARS) throw new OpError("too_large");
      const patch: Row = { TargetId: targetId, InputJson: inputJson, ActiveKey: activeKeyOf(String(job.Kind), targetId) };
      await o.gw.update("EngineJob", jobId, patch);
      return { ...job, ...patch };
    },
  };
}

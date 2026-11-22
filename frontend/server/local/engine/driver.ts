// The local MADP engine: claims the queued EngineJob rows and does their work, the way the engine bridge does it in
// production (docs/ENGINE-CONTRACT.md, src/domain/engineJob.ts): queued -> claimed (Attempts + 1, ClaimedBy,
// ClaimedAt) -> running (Progress, Message) -> succeeded (OutputRefs, FinishedAt) or failed (Message, ErrorCode).
// A finished job hands its ActiveKey back (it becomes the job's own id), so the next request of that kind is new.
//
// The work of each kind lives in kinds/<group>.ts and is loaded when a job of the kind runs, so an edited writer is
// used by the next job and a broken one fails only its own jobs. Pace and on/off: config.ts.
//
// A job that cannot start (its writer does not load, its records cannot be read) is looked at again every 20 s while
// the error is one a new look may get past (a service that did not answer); one that a new look cannot fix (a module
// that does not load, a programming error, a refusal) fails the job plainly on its third look in a row, instead of
// leaving it waiting for ever (UNFIXABLE_LOOKS, retryCanFix).
//
// Restart safe: every few seconds (and on every newly queued job) the engine looks at the store. Queued jobs are
// claimed; claimed and running jobs without a worker in this process (after a restart, a code reload or a reset) are
// resumed in place by their writer (see run.ts). Three cases of such a job are told apart by the attempt's folder:
//   - its result.json is there (the work ended on this host, but the row never got the outcome): the recorded outcome
//     is written to the row, the work is never run again;
//   - the row is "claimed" and no job.json is there (claimed for this engine before it ever ran: jobs.ts pre-claims
//     design, extraction and build jobs for their worker): its first start, like a claim: claimed -> running, "picked up";
//   - otherwise a true resume (the writer catches up to the stored progress).
//
// What people read: every EngineJob write passes plainJobWrites (plainMessages.ts), so a job's line is plain, never raw
// tool output; the raw text and the stack go to the engine log and the job's result.json.
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { isEngineJobKind, isProjectless, JOB_HEARTBEAT_MS, PLATFORM_FEEDBACK_KIND, type EngineJobKind } from "../../../src/domain/engineJob";
import type { RowStore } from "../rowStore.ts";
import type { EngineConfig } from "./config.ts";
import { num, str } from "./context.ts";
import { JobFailure, JobGone, JobRun, type KindResult, type KindWriter, type RunDeps } from "./run.ts";
import { NOTHING_DEPLOYED_CODE, afterDeployCode, orderIssues } from "../../../src/domain/afterDeploy";
import { plainJobWrites } from "./plainMessages.ts";
import { failureSentence, isTransientFailure, plainFailureMessage } from "../../../src/domain/jobMessage";
import { withContext } from "../../engine-context/hooks.ts";
import { withFactoryBlocks } from "../../blocks/sharedCliBroker.ts";
import { CAPACITY_CODE } from "../../api/extraction/claudeCapacity.ts";
import { hashOf } from "./text.ts";
import { createBuildFailureNotifier } from "./buildFailureNotification.ts";
import { holdBack as streamsHoldBack } from "./streams.ts";

export const ENGINE_WORKERS = ["madp-engine-zrh-01", "madp-engine-zrh-02", "madp-engine-fra-01"] as const;

/** Loads the writer of a kind. */
export type WriterLoader = (kind: EngineJobKind) => Promise<KindWriter>;

export interface EngineOptions {
  store: RowStore;
  gateway: RawGateway;
  config(): EngineConfig;
  log(line: string): void;
  writers: WriterLoader;
  now?: () => Date;
  sleep?: RunDeps["sleep"];
  putFile?: RunDeps["putFile"];
  readFile?: RunDeps["readFile"];
  /** The project folders on the engine host (projectFolder.ts, MF_ENGINE_ROOT); the Blocks worker passes them. */
  projectFolder?: RunDeps["projectFolder"];
  /** See RunDeps: the factor on a kind's waits, and progress written in the background. */
  waitScale?: RunDeps["waitScale"];
  backgroundProgress?: boolean;
  /** False: a queued job is claimed as soon as it is seen, without the paced pick-up and set-up pauses of local mode
   *  (the Blocks worker, whose poll is the real pick-up time). Default true. */
  pickupDelay?: boolean;
  /** How often the store is looked at (ms); 0 = only on demand (tests call tick()). */
  sweepMs?: number;
  /** False while the store is being rewritten by another process (npm run reset): no job is started or resumed. */
  ready?: () => boolean;
  /** The ClaimedBy of this engine (default: a stable id per job, workerOf). The Blocks worker passes its host id. */
  workerId?: string;
  /** Loads what a job needs (the Blocks worker loads the project's rows): before a resumed job runs, and at the same
   *  time as the claim of a queued one (the job runs once both are done). A throw parks the job: a queued one stays
   *  queued, a claimed one is resumed on a later look. */
  prepare?: (job: Row) => Promise<void>;
  /** False leaves a claimed or running job alone (another live engine holds it). Default: every one is resumed. */
  canResume?: (job: Row) => boolean;
  /** Operator scope (for example one project's local planner); also checked for jobs loaded in project snapshots. */
  acceptsJob?: (job: Row) => boolean;
  /** What a queued job still waits for before it may be claimed (null: claim it now). Default: the project's parallel
   *  streams (streams.ts holdBack: a change build starts when a stream is free and nothing running touches what it
   *  touches). The job's line says what it waits for. */
  holdBack?: (job: Row) => string | null;
}

export interface Engine {
  /** Looks at the store now: claims queued jobs and resumes orphaned active ones. */
  tick(): void;
  /** Called with every newly queued job (the hook's onQueued). */
  queued(job: Row): void;
  /** Resolves when no job is being worked on, including the ending of jobs stop() aborted (tests). */
  idle(): Promise<void>;
  /** Job ids being worked on now. */
  working(): string[];
  stop(): void;
}

const ACTIVE = new Set(["queued", "claimed", "running"]);
/** The line of a job claimed for this engine at its first start, until its writer reports its first step. */
const STARTED = "Started.";

/** The line people see for a job that failed with this error: a JobFailure's own plain reason (made plain when it is
 *  not), else the plain sentence of the kind; a service that did not answer asks for a new start in a few minutes. */
export function failureMessageOf(kind: string, e: unknown): string {
  if (e instanceof JobFailure) return plainFailureMessage(kind, e.message);
  const code = (e as { code?: unknown } | null)?.code;
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return failureSentence(kind, { transient: code === "unavailable" || code === "timeout" || isTransientFailure(text) });
}

/** A job that cannot start (its writer does not load, its records cannot be read, ...) is looked at again 20 s later.
 *  When the error is one a new look cannot fix (retryCanFix), the job is failed on this many looks in a row instead of
 *  waiting for ever; a new code generation of the worker counts afresh. */
export const UNFIXABLE_LOOKS = 3;

/** Error codes of a service that did not answer, or of a write that lost a race: a later look may succeed. */
const RETRY_CODES = new Set([
  "unavailable", "timeout", "internal", "rate_limited", "conflict",
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
  "ENETDOWN", "EMFILE", "ENFILE", "EBUSY", "EAGAIN",
]);

/** True when a new look at a job may get past the error its start failed with: a service that did not answer in time
 *  (the Data Gateway, Storage, the network), a write that lost a race. Anything else (a writer module that does not
 *  load, a programming error, a refusal) fails the same way on every look. */
export function retryCanFix(e: unknown): boolean {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  if ([err?.code, err?.cause?.code].some((c) => typeof c === "string" && RETRY_CODES.has(c))) return true;
  return isTransientFailure(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
}

export function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new JobGone("stopped"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new JobGone("stopped"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The outcome an attempt recorded in its folder (result.json: succeeded or failed, with its finishedAt) when it belongs
 *  to the job's current claim; null otherwise. An outcome older than the row's claim belongs to an earlier run of the
 *  same attempt number (a retry claimed for the same host, or a try handed back after a capacity failure). */
export function recordedOutcome(result: unknown, job: Row): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (r.status !== "succeeded" && r.status !== "failed") return null;
  const endedAt = Date.parse(str(r.finishedAt));
  const claimedAt = Date.parse(str(job.ClaimedAt));
  return Number.isFinite(endedAt) && Number.isFinite(claimedAt) && endedAt >= claimedAt ? r : null;
}

/** The worker id of a job: stable for the job, like a bridge that keeps its jobs. */
export function workerOf(jobId: string): string {
  return ENGINE_WORKERS[hashOf(jobId) % ENGINE_WORKERS.length]!;
}

/** Seconds between a job being queued and being claimed: a worker polls, so it is never instant. */
function pickupSeconds(jobId: string, kind: string): number {
  const base = kind === "chat.reply" ? 0.8 : 1.6;
  return base + (hashOf(`pickup:${jobId}`) % 1000) / 1000;
}

export function createEngine(o: EngineOptions): Engine {
  const localFailureAlert = createBuildFailureNotifier(o.gateway, async (id) => {
    const account = o.store.rows("Account").find(a => a.UserId === id && a.Status === "active");
    return str(account?.Email) || null;
  });
  // the safety net for what people read on a job (plainMessages.ts): every EngineJob write of this engine passes it
  const gateway = plainJobWrites(o.gateway, { job: (id) => o.store.get("EngineJob", id), log: o.log, onFailed: localFailureAlert });
  const deps: RunDeps = {
    store: o.store,
    gateway,
    config: o.config,
    now: o.now ?? (() => new Date()),
    log: o.log,
    sleep: o.sleep ?? realSleep,
    putFile: o.putFile,
    readFile: o.readFile,
    projectFolder: o.projectFolder,
    waitScale: o.waitScale,
    backgroundProgress: o.backgroundProgress,
  };
  const pickupDelay = o.pickupDelay !== false;
  const holdBack = o.holdBack ?? ((job: Row) => streamsHoldBack(o.store, job));
  /** The line written on each held-back job (written again only when it changes). */
  const waitLines = new Map<string, string>();
  /** jobId -> the worker on it. */
  const work = new Map<string, { attempt: number; stage: "pickup" | "running"; abort: AbortController; done: Promise<void> }>();
  /** Jobs that could not start (a writer module being edited, records that could not be read): left as they are,
   *  looked at again later. */
  const parked = new Map<string, number>();
  /** Jobs whose start failed with an error a new look cannot fix: on how many looks in a row (UNFIXABLE_LOOKS). */
  const unfixable = new Map<string, number>();
  /** Jobs this engine finished or failed, by attempt: never resumed again from a store answer that was read before. */
  const ended = new Map<string, number>();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let soon: ReturnType<typeof setTimeout> | null = null;
  /** The endings of the jobs stop() aborted: each still runs its finally (its last reads and writes of the store). */
  let stopping: Promise<unknown> = Promise.resolve();

  const jobRow = (id: string): Row | undefined => o.store.get("EngineJob", id);
  const projectAlive = (job: Row): boolean => {
    const p = o.store.get("Project", str(job.ProjectId));
    return Boolean(p) && p!.IsDeleted !== true;
  };

  async function claim(id: string, signal: AbortSignal): Promise<Row | null> {
    const job = jobRow(id);
    if (!job || job.Status !== "queued" || signal.aborted) return null;
    const attempts = num(job.Attempts) + 1;
    const claimedBy = o.workerId ?? workerOf(id);
    await gateway.update("EngineJob", id, {
      Status: "claimed",
      Attempts: attempts,
      ClaimedBy: claimedBy,
      ClaimedAt: deps.now().toISOString(),
      Message: "",
    });
    // A conditional gateway (the Blocks worker) leaves the row as it was when another engine or a person got there first.
    const row = jobRow(id);
    if (!row || row.Status !== "claimed" || num(row.Attempts) !== attempts || str(row.ClaimedBy) !== claimedBy) return null;
    return row;
  }

  async function finish(run: JobRun, outputs: string[], message: string, attention: KindResult["attention"], details?: KindResult["attentionDetails"], finishedAt?: string, own?: string): Promise<void> {
    await run.flush();
    run.check();
    ended.set(run.id, run.attempt);
    // a delivery build whose steps after the deploy are not all finished still succeeds (its code is live); its
    // ErrorCode names what is left (src/domain/afterDeploy.ts); one that deployed nothing says so (its own code). A
    // code left from an earlier failed attempt is cleared.
    const code = own || afterDeployCode(attention ?? [], details ?? {});
    await gateway.update("EngineJob", run.id, {
      Status: "succeeded",
      Progress: 100,
      Message: message,
      OutputRefs: [...new Set(outputs)],
      FinishedAt: finishedAt ?? deps.now().toISOString(),
      ActiveKey: run.id,
      ...(code || str(run.job.ErrorCode) ? { ErrorCode: code } : {}),
    });
  }

  /** First start of a job claimed for this engine before it ever ran here: what a claim does, from the claimed state
   *  (claimed -> running, conditional like a claim on the Blocks worker). Null when the row moved meanwhile. */
  async function begin(id: string, attempt: number, signal: AbortSignal): Promise<Row | null> {
    const job = jobRow(id);
    if (!job || job.Status !== "claimed" || (num(job.Attempts, 1) || 1) !== attempt || signal.aborted) return null;
    const claimedBy = str(job.ClaimedBy);
    await gateway.update("EngineJob", id, { Status: "running", Progress: num(job.Progress), Message: STARTED });
    const row = jobRow(id);
    if (!row || row.Status !== "running" || (num(row.Attempts, 1) || 1) !== attempt || str(row.ClaimedBy) !== claimedBy) return null;
    return row;
  }

  function pickedUp(job: Row): void {
    const queuedAt = Date.parse(str(job.CreatedDate));
    if (Number.isFinite(queuedAt)) o.log(`[engine] ${str(job.Kind)} ${str(job.ItemId).slice(0, 8)} picked up ${((deps.now().getTime() - queuedAt) / 1000).toFixed(1)} s after it was queued`);
  }

  async function failJob(id: string, attempt: number, message: string, code: string, at?: string): Promise<void> {
    const job = jobRow(id);
    if (!job || !["claimed", "running"].includes(str(job.Status)) || (num(job.Attempts, 1) || 1) !== attempt) return;
    // Out of AI capacity (claudeCapacity.ts) the job did no work: it keeps its tries, so people can start it again
    // (and again) once the capacity is back. Its try is handed back, and a retry claimed straight for this host
    // (jobs.ts retryHostClaim, the same Attempts again) is resumed.
    const refund = code === CAPACITY_CODE;
    ended.set(id, refund ? attempt - 1 : attempt);
    await gateway.update("EngineJob", id, {
      Status: "failed",
      Message: message,
      ErrorCode: code,
      FinishedAt: at ?? deps.now().toISOString(),
      ActiveKey: id,
      ...(refund ? { Attempts: Math.max(0, attempt - 1) } : {}),
    });
  }

  /** Fails a job whose start failed `looks` times in a row with an error a new look cannot fix (retryCanFix): a queued
   *  one from the queue, a claimed or running one like any failed attempt. The raw error goes to the log, people read
   *  the kind's plain sentence. False when the failure could not be written (the job is looked at again later). */
  async function giveUp(id: string, kind: string, e: unknown, looks: number): Promise<boolean> {
    const job = jobRow(id);
    if (!job || !ACTIVE.has(str(job.Status))) return true;
    o.log(`[engine] job ${id.slice(0, 8)} failed: it could not start on ${looks} looks in a row, with an error a new look cannot fix: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    const message = failureMessageOf(kind, e);
    try {
      if (job.Status === "queued") {
        await gateway.update("EngineJob", id, { Status: "failed", Message: message, ErrorCode: "engine.failed", FinishedAt: deps.now().toISOString(), ActiveKey: id });
      } else {
        await failJob(id, num(job.Attempts, 1) || 1, message, "engine.failed");
      }
      return true;
    } catch (w) {
      o.log(`[engine] job ${id.slice(0, 8)}: the failure was not written (${String(w).slice(0, 160)}); looked at again later`);
      return false;
    }
  }

  /** Writes the outcome this attempt recorded in its folder (result.json) when the row never got it (the final write
   *  was lost: a crash or a restart between the end of the work and the row's update, or an update that missed). The
   *  same fields finish() and failJob() write; the work is not run again. False when there is no such outcome
   *  (recordedOutcome). */
  async function applyRecorded(run: JobRun, row: Row): Promise<boolean> {
    const r = recordedOutcome(run.readJobFile("result.json"), row);
    if (!r) return false;
    const finishedAt = str(r.finishedAt);
    const message = str(r.message);
    o.log(`[engine] ${run.kind} ${run.id.slice(0, 8)} ${r.status} on this host at ${finishedAt}, but the job never got the outcome: written now (the work is not run again)`);
    if (r.status === "succeeded") {
      const outputs = Array.isArray(r.outputs) ? r.outputs.filter((x): x is string => typeof x === "string") : [];
      const attention = (Array.isArray(r.attention) ? r.attention : []) as NonNullable<KindResult["attention"]>;
      const details = (r.attentionDetails && typeof r.attentionDetails === "object" ? r.attentionDetails : {}) as NonNullable<KindResult["attentionDetails"]>;
      await finish(run, outputs, message || "Done.", attention, details, finishedAt, str(r.code) === NOTHING_DEPLOYED_CODE ? NOTHING_DEPLOYED_CODE : "");
    } else {
      await failJob(run.id, run.attempt, message || failureMessageOf(run.kind, null), str(r.code) || "engine.failed", finishedAt);
    }
    return true;
  }

  function start(id: string, mode: "claim" | "resume"): void {
    const job = jobRow(id);
    if (!job || (o.acceptsJob && !o.acceptsJob(job))) return;
    const abort = new AbortController();
    const attempt = mode === "claim" ? num(job.Attempts) + 1 : num(job.Attempts, 1) || 1;
    const entry = { attempt, stage: (mode === "claim" ? "pickup" : "running") as "pickup" | "running", abort, done: Promise.resolve() };
    work.set(id, entry);
    entry.done = (async () => {
      let row: Row | null | undefined = job;
      let writer: KindWriter;
      let run: JobRun | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      // The job cannot start now: looked at again in 20 s. A step that may fail the job (loading its writer, reading its
      // records) fails it on the UNFIXABLE_LOOKS-th look in a row that ends with an error a new look cannot fix.
      const waits = async (e: unknown, mayFail = true): Promise<void> => {
        const looks = !mayFail || retryCanFix(e) ? 0 : (unfixable.get(id) ?? 0) + 1;
        if (looks >= UNFIXABLE_LOOKS && (await giveUp(id, str(job.Kind), e, looks))) {
          unfixable.delete(id);
          parked.delete(id);
        } else {
          if (looks > 0) unfixable.set(id, looks);
          else unfixable.delete(id);
          parked.set(id, Date.now());
          o.log(`[engine] ${str(job.Kind)} ${id.slice(0, 8)} waits: ${e instanceof Error ? e.message : String(e)} (cause: ${JSON.stringify((e as any)?.cause)})${looks > 0 ? ` (a new look cannot fix this: ${looks} of ${UNFIXABLE_LOOKS} before the job fails)` : ""}`);
        }
        if (work.get(id) === entry) work.delete(id);
      };
      const goesOn = (): void => {
        parked.delete(id);
        unfixable.delete(id);
      };
      try {
        const k = str(job.Kind);
        if (!isEngineJobKind(k)) throw new Error(`unknown kind ${k}`);
        writer = await o.writers(k);
      } catch (e) {
        return await waits(e);
      }
      // a queued job: claimed while its project is loaded; a resumed one: loaded first
      const prepared: Promise<unknown> = o.prepare ? o.prepare(job).then(() => null, (e: unknown) => ({ e })) : Promise.resolve(null);
      if (mode === "resume") {
        const r = (await prepared) as { e: unknown } | null;
        if (r) return await waits(r.e);
        goesOn();
      }
      try {
        if (mode === "claim") {
          if (pickupDelay) await deps.sleep(pickupSeconds(id, str(job.Kind)) * 1000 * Math.min(1, o.config().pace), abort.signal);
          if (!o.config().enabled) return;
          row = await claim(id, abort.signal);
          const r = (await prepared) as { e: unknown } | null;
          if (!row) return;
          if (r) return await waits(r.e);
          goesOn();
          entry.stage = "running";
          pickedUp(job);
          // The worker sets up (checks out the repository, loads the records) before the first progress report.
          if (pickupDelay) await deps.sleep(900 * Math.min(1, o.config().pace), abort.signal);
        }
        const kind = str(row.Kind);
        const startedAt = Date.now();
        run = new JobRun(deps, row, abort.signal);
        run.check();
        let started: "claim" | "start" | "resume" = mode;
        if (mode === "resume") {
          // The work of this attempt already ended here (its outcome is recorded): the row gets it, nothing runs again.
          // (a write that fails here is tried again on a later look, never turned into a failure of the job)
          let recorded: boolean;
          try {
            recorded = await applyRecorded(run, row);
          } catch (e) {
            if (e instanceof JobGone) throw e;
            return await waits(e, false);
          }
          if (recorded) return;
          // Claimed for this engine and never started here: its first start, like a claim.
          if (row.Status === "claimed" && !run.hasJobFile("job.json")) {
            let begun: Row | null;
            try {
              begun = await begin(id, entry.attempt, abort.signal);
            } catch (e) {
              return await waits(e, false);
            }
            if (!begun) return;
            pickedUp(begun);
            started = "start";
            run.check();
          }
        }
        heartbeat = setInterval(() => { void run?.heartbeat().catch(() => undefined); }, JOB_HEARTBEAT_MS);
        run.writeJobFile("job.json", { jobId: id, kind, attempt: run.attempt, mode: started, input: run.input, startedAt: deps.now().toISOString() });
        // project context before/after (engine-context/hooks.ts; never fails the job); platform feedback has no project
        const delivery = kind === "build.run" || kind === "preview.deploy" || kind === "change.build";
        const runWriter = delivery ? (job: JobRun) => withFactoryBlocks(job, () => writer(job)) : writer;
        const result = kind === PLATFORM_FEEDBACK_KIND ? await writer(run) : await withContext(run, runWriter);
        await finish(run, result.outputs, result.message, result.attention, result.attentionDetails, undefined, result.code);
        const open = orderIssues(result.attention ?? []);
        run.writeJobFile("result.json", {
          status: "succeeded", message: result.message, outputs: [...new Set(result.outputs)], ...(result.code ? { code: result.code } : {}),
          ...(open.length ? { attention: open, ...(result.attentionDetails ? { attentionDetails: result.attentionDetails } : {}) } : {}),
          finishedAt: deps.now().toISOString(),
        });
        o.log(`[engine] ${kind} ${id.slice(0, 8)} done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s${open.length ? `, not finished after the deploy (${open.join(", ")})` : ""}: ${result.message}`);
      } catch (e) {
        if (e instanceof JobGone || abort.signal.aborted) {
          if (e instanceof JobGone) run?.writeJobFile("stopped.json", { reason: e.message, at: deps.now().toISOString() });
          return;
        }
        o.log(`[engine] job ${id.slice(0, 8)} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        await run?.flush().catch(() => undefined);
        // people read `message` (also in the project's outputs); `error` is the raw text for the engine team
        const shown = failureMessageOf(str(job.Kind), e);
        const code = e instanceof JobFailure ? e.code : "engine.failed";
        run?.writeJobFile("result.json", { status: "failed", message: shown, code, error: e instanceof Error ? (e.stack ?? e.message) : String(e), finishedAt: deps.now().toISOString() });
        try {
          await failJob(id, entry.attempt, shown, code);
        } catch {
          /* the next look at the store sees the job as it is */
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        const current = jobRow(id);
        if (current?.ErrorCode === "design.stopRequested" && num(current.Attempts) === entry.attempt) {
          try {
            await gateway.update("EngineJob", id, {
              Status: "cancelled", ErrorCode: "", Message: "Design stopped. Existing designs and saved previews were kept. Figma changes already submitted may remain.",
              FinishedAt: deps.now().toISOString(), ActiveKey: id,
            });
          } catch (error) { o.log(`[engine] cancellation acknowledgement failed: ${String(error)}`); }
        }
        if (work.get(id) === entry) work.delete(id);
        // a build that ended may free a stream (or the turn) a held-back build waits for
        if (!stopped) tickSoon();
      }
    })();
  }

  /** A queued job the streams hold back: its line says what it waits for (once per change of the words). */
  function noteWait(job: Row, words: string): void {
    const id = str(job.ItemId);
    if (waitLines.get(id) === words) return;
    waitLines.set(id, words);
    if (str(job.Message) === words) return;
    o.log(`[engine] ${str(job.Kind)} ${id.slice(0, 8)} waits: ${words}`);
    void gateway.update("EngineJob", id, { Message: words }).catch((e) => o.log(`[engine] ${id.slice(0, 8)} wait line not written: ${String(e).slice(0, 160)}`));
  }

  function tick(): void {
    if (stopped) return;
    const cfg = o.config();
    const jobs = o.store.rows("EngineJob").filter((j) => ACTIVE.has(str(j.Status)));
    const live = new Set(jobs.map((j) => str(j.ItemId)));
    // A job that left the active states (cancelled, removed by a reset) loses its worker at once.
    for (const [id, w] of work) {
      const j = jobRow(id);
      if (!j || !live.has(id) || j.ErrorCode === "design.stopRequested") w.abort.abort();
      else if (w.stage === "running" && (num(j.Attempts, 1) || 1) !== w.attempt) w.abort.abort();
    }
    if (!cfg.enabled || (o.ready && !o.ready())) return;
    for (const j of jobs) {
      const id = str(j.ItemId);
      // The projectless kinds (host maintenance, platform feedback) have no project behind them (their ProjectId is the
      // "system" sentinel): the project guard below is for project work and must never hold them back — an invisible
      // skip would park the daily sync or a tester's feedback forever.
      if (!id || work.has(id) || (!isProjectless(str(j.Kind)) && !projectAlive(j)) || !isEngineJobKind(j.Kind)) continue;
      if (j.Status !== "queued" && o.canResume && !o.canResume(j)) continue;
      if (j.Status !== "queued" && ended.get(id) === (num(j.Attempts, 1) || 1)) continue;
      const parkedAt = parked.get(id);
      if (parkedAt !== undefined && Date.now() - parkedAt < 20_000) continue;
      if (j.Status === "queued") {
        let wait: string | null = null;
        try {
          wait = holdBack(j);
        } catch (e) {
          o.log(`[engine] ${id.slice(0, 8)} streams: ${String(e).slice(0, 160)} (started as before)`);
        }
        if (wait !== null) {
          noteWait(j, wait);
          continue;
        }
        waitLines.delete(id);
      }
      start(id, j.Status === "queued" ? "claim" : "resume");
    }
  }

  const tickSoon = (): void => {
    if (stopped || soon) return;
    soon = setTimeout(() => {
      soon = null;
      tick();
    }, 250);
  };

  if ((o.sweepMs ?? 3000) > 0) timer = setInterval(tick, o.sweepMs ?? 3000);

  return {
    tick,
    queued: () => tickSoon(),
    working: () => [...work.keys()],
    async idle() {
      while (work.size > 0) await Promise.all([...work.values()].map((w) => w.done));
      // and the jobs stop() aborted have ended too (nothing of this engine touches the store after idle)
      await stopping;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (soon) clearTimeout(soon);
      const ending = [...work.values()].map((w) => w.done.catch(() => undefined));
      for (const w of work.values()) w.abort.abort();
      work.clear();
      stopping = Promise.all([stopping, ...ending]);
    },
  };
}

// The engine's safety net for the line people read on a job (EngineJob.Message). Every EngineJob row the engine writes
// passes plainJobWrites(): a plain line is kept as it is (cut at a sentence end past 200 characters), and a line that
// looks like raw tool output (stack frames, exit codes, host paths, npm or pip warnings, JSON, library error names:
// src/domain/jobMessage.ts) becomes the plain sentence of the job's kind. The raw text goes to the engine log only (the
// worker's log and the project's logs/engine.log). ErrorCode and every other field pass unchanged.
//
// The driver wraps the gateway it is given (driver.ts), so the failures it writes, the progress lines of run.ts, the
// writers' own failures (build/jobKit.ts) and the Blocks worker's limits (engineWorker/worker.ts) all pass here.
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { plainJobMessage, technicalSignal } from "../../../src/domain/jobMessage";

const JOB = "EngineJob";
const WRAPPED = Symbol.for("madp.engine.plainJobWrites");

export interface PlainJobOptions {
  /** The job row as the engine holds it (its Kind and Status when a patch does not carry them). */
  job(id: string): Row | undefined;
  log(line: string): void;
  onFailed?(job: Row): Promise<void>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The patch with its Message made plain for people; the raw text, when it was not plain, is logged. A raw line on a job
 *  still at work is left out (the job keeps the line it had). */
export function plainJobPatch(id: string, patch: Row, o: PlainJobOptions): Row {
  if (typeof patch.Message !== "string" || patch.Message === "") return patch;
  const row = id ? o.job(id) : undefined;
  const kind = str(patch.Kind) || str(row?.Kind);
  const status = str(patch.Status) || str(row?.Status);
  const raw = patch.Message;
  const shown = plainJobMessage(kind, status, raw);
  if (shown === raw) return patch;
  const signal = technicalSignal(raw.trim());
  if (signal) {
    o.log(`[engine] ${kind || "job"} ${id.slice(0, 8)}: the job's line was raw output (${signal}); people see ${shown === null ? "the line before it" : `"${shown}"`}. Raw: ${raw.replace(/\s+/g, " ").trim().slice(0, 2000)}`);
  }
  const out: Row = { ...patch };
  if (shown === null) delete out.Message;
  else out.Message = shown;
  return out;
}

/** The gateway with every EngineJob insert and update passed through plainJobPatch; everything else as it is. Wrapping
 *  a wrapped gateway answers it unchanged. */
export function plainJobWrites(raw: RawGateway, o: PlainJobOptions): RawGateway {
  if ((raw as unknown as Record<symbol, unknown>)[WRAPPED]) return raw;
  const wrapped: RawGateway = {
    get: (schema, itemId, fields) => raw.get(schema, itemId, fields),
    find: (schema, opts) => raw.find(schema, opts),
    findAll: (schema, opts) => raw.findAll(schema, opts),
    insert: (schema, row) => raw.insert(schema, schema === JOB ? plainJobPatch(str(row.ItemId), row, o) : row),
    insertMany: (schema, rows) => raw.insertMany(schema, schema === JOB ? rows.map((r) => plainJobPatch(str(r.ItemId), r, o)) : rows),
    update: async (schema, itemId, patch) => {
      if (schema !== JOB) return raw.update(schema, itemId, patch);
      const clean = plainJobPatch(itemId, patch, o);
      if (Object.keys(clean).length === 0) return;
      await raw.update(schema, itemId, clean);
      const saved = o.job(itemId);
      if (clean.Status === "failed" && saved?.Status === "failed") {
        try { await o.onFailed?.(saved); }
        catch (e) { o.log(`[engine] build failure alert deferred (${e instanceof Error ? e.message.slice(0, 160) : "error"}); reconciliation will retry`); }
      }
    },
    updateMany: (schema, where, patch) => raw.updateMany(schema, where, schema === JOB ? plainJobPatch("", patch, o) : patch),
    remove: (schema, itemId) => raw.remove(schema, itemId),
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

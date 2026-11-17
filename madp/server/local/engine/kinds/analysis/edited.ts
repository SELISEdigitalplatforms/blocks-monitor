// Whether a person changed a requirement or the objective the engine drafted: the requirements refresh rewrites only
// what nobody changed. The engine's own writes are never "the team's edits": the first draft writes the rows, a later
// refresh rewrites them, and the jobs that did it are on record (the job named in the row's RequestKey, and every job
// that lists the row in its outputs). A person's save is told apart by who and when:
//  - who: the engine stamps who created and last saved a row only when it creates it (run.stamp) and never changes
//    those fields when it rewrites it; a person's save stamps the person (the ops' scoped gateway). Another name in
//    UpdatedByUserId than in CreatedByUserId is a person's save.
//  - when: a save after the end of the last job that wrote the row is not the engine's. Both dates come from the same
//    clock (the stored rows' LastUpdatedDate, stamped by the Data Gateway / the local store), never the engine host's.
// A re-ordering never reaches the refresh: requirement.reorder is refused until the requirements step, and the refresh
// runs only while the questions are answered (autoDraft.ts).
import type { Row } from "../../../../../functions/_lib/gateway";
import { str } from "../../context.ts";

/** The platform stamps a write a little after it is made (functions/_lib/stamps.ts): a row the engine wrote may carry
 *  a date up to this much after the last write of the job that wrote it. */
export const ENGINE_WRITE_SLACK_MS = 30_000;

/** The kinds that write requirements and the objective (the draft and its refresh; the assist adds requirements). */
const WRITER_KINDS: ReadonlySet<string> = new Set(["requirements.draft", "sanitization.assist"]);

const time = (v: unknown): number => {
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? t : Number.NaN;
};

/** The job of an engine RequestKey ("engine:<jobId>:<attempt>:<local>"), "" for a person's row. */
export function creatorJobId(row: Row): string {
  const m = /^engine:([^:]+):/.exec(str(row.RequestKey));
  return m ? m[1]! : "";
}

/** When the engine last wrote the row, as the project's jobs say: the last write (the job row's LastUpdatedDate, its
 *  outcome) of the job that created it and of every job that lists it in its outputs. Null when none is on record. */
export function engineWroteAt(row: Row, schema: string, jobs: readonly Row[]): number | null {
  const creator = creatorJobId(row);
  const ref = `${schema}:${str(row.ItemId)}`;
  let last: number | null = null;
  for (const j of jobs) {
    if (!WRITER_KINDS.has(str(j.Kind))) continue;
    const outputs = Array.isArray(j.OutputRefs) ? j.OutputRefs : [];
    if (str(j.ItemId) !== creator && !outputs.includes(ref)) continue;
    const at = Number.isFinite(time(j.LastUpdatedDate)) ? time(j.LastUpdatedDate) : time(j.FinishedAt);
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/** True when a person changed the row since the engine wrote it (or a person made it): the refresh leaves it as it is. */
export function editedByPerson(row: Row, schema: string, jobs: readonly Row[]): boolean {
  if (!creatorJobId(row)) return true;
  const by = str(row.UpdatedByUserId);
  if (by && by !== str(row.CreatedByUserId)) return true;
  const updated = time(row.LastUpdatedDate);
  if (!Number.isFinite(updated)) return false;
  // without the jobs on record (an older project), the row as it was created
  const wrote = engineWroteAt(row, schema, jobs) ?? time(row.CreatedDate);
  if (!Number.isFinite(wrote)) return false;
  return updated - wrote > ENGINE_WRITE_SLACK_MS;
}

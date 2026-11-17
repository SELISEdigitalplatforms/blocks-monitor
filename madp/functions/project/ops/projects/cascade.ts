/**
 * The resumable delete cascade: children by id, bytes before rows, within a time budget.
 * Used by project.delete and doc.folder.delete; the caller sets Status "deleting" first.
 */
import type { Filter, GatewayPort, Ports, Row } from "./ports";

export interface CascadeStep {
  schema: string;
  filter: Filter;
  /** The Storage-file fields of this schema; their objects are deleted permanently before the row. */
  fileFields?: readonly string[];
}

const fieldsOf = (step: CascadeStep): string[] => ["ItemId", ...(step.fileFields ?? [])];

/** The Storage objects of one row (bytes before the row). */
async function removeFiles(ports: Pick<Ports, "files">, step: CascadeStep, row: Row): Promise<void> {
  for (const field of step.fileFields ?? []) {
    const fileId = row[field];
    if (typeof fileId === "string" && fileId) await ports.files.remove(fileId, { permanent: true });
  }
}

export interface CascadeResult {
  done: boolean;
  remaining: number;
  deleted: Record<string, number>;
}

const PAGE = 100;
export const PAGE_SIZE = PAGE;

export async function runCascade(
  ports: Ports,
  steps: readonly CascadeStep[],
  opts: { budgetMs?: number; concurrency?: number } = {},
): Promise<CascadeResult> {
  const budget = opts.budgetMs ?? 20_000;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const start = ports.clock.monoMs();
  const outOfTime = () => ports.clock.monoMs() - start >= budget;
  const deleted: Record<string, number> = {};
  let stoppedAt = steps.length;

  const deleteRow = async (step: CascadeStep, row: Row) => {
    await removeFiles(ports, step, row);
    await ports.db.remove(step.schema, row.ItemId);
    deleted[step.schema] = (deleted[step.schema] ?? 0) + 1;
  };

  outer: for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const fields = fieldsOf(step);
    for (;;) {
      if (outOfTime()) {
        stoppedAt = i;
        break outer;
      }
      const page = await ports.db.query(step.schema, step.filter, { fields, limit: PAGE });
      if (page.length === 0) break;
      let next = 0;
      const worker = async () => {
        while (next < page.length && !outOfTime()) {
          const row = page[next++];
          await deleteRow(step, row);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, page.length) }, worker));
    }
  }

  let remaining = 0;
  for (let i = stoppedAt; i < steps.length; i++) remaining += await ports.db.count(steps[i].schema, steps[i].filter);
  return { done: remaining === 0, remaining, deleted };
}

export interface CascadePage {
  step: CascadeStep;
  rows: Row[];
}

/** Page 1 (at most 100 rows, ItemId and the file field only) of every step, all in one parallel round. */
export function readCascadePages(db: Pick<GatewayPort, "query">, steps: readonly CascadeStep[]): Promise<CascadePage[]> {
  return Promise.all(
    steps.map(async (step) => ({
      step,
      rows: await db.query(step.schema, step.filter, { fields: fieldsOf(step), limit: PAGE }),
    })),
  );
}

/**
 * One bounded write round of the resumable delete: the rows of the FIRST non-empty step (the order of `steps` is the
 * cascade order), bytes before each row, all in one Promise.all. `pages` were read beforehand (the prefetch).
 */
export async function deleteFirstPage(
  ports: Pick<Ports, "db" | "files">,
  pages: readonly CascadePage[],
): Promise<{ schema: string; deleted: number } | null> {
  const hit = pages.find((p) => p.rows.length > 0);
  if (!hit) return null;
  const { step, rows } = hit;
  await Promise.all(
    rows.map(async (row) => {
      await removeFiles(ports, step, row);
      await ports.db.remove(step.schema, row.ItemId);
    }),
  );
  return { schema: step.schema, deleted: rows.length };
}

/**
 * One bounded write round of the resumable delete: the rows of EVERY schema in `pages` (read beforehand), bytes before
 * each row, all in one Promise.all. Returns the number of rows removed.
 */
export async function deleteAllPages(ports: Pick<Ports, "db" | "files">, pages: readonly CascadePage[]): Promise<number> {
  let n = 0;
  await Promise.all(
    pages.flatMap(({ step, rows }) =>
      rows.map(async (row) => {
        await removeFiles(ports, step, row);
        await ports.db.remove(step.schema, row.ItemId, { rowRead: true });
        n++;
      }),
    ),
  );
  return n;
}

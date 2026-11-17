// Bookkeeping the analysis writers share: which rows this job wrote itself (so a resumed run plans the same work),
// the next free number, a free key, and the similarity test that keeps duplicates out.
import type { Row } from "../../../../../functions/_lib/gateway";
import { inParallel, type JobRun } from "../../run.ts";
import { num, str } from "../../context.ts";
import { slugOf, wordsOf } from "../../text.ts";

/** True for a row this job (any attempt) wrote. */
export function writtenBy(run: JobRun, row: Row): boolean {
  return str(row.RequestKey).startsWith(`engine:${run.id}:`);
}

/** The project's rows of a schema as they were before this job wrote anything. */
export function before(run: JobRun, schema: string): Row[] {
  return run.p.rows(schema).filter((r) => !writtenBy(run, r));
}

/** The next Number of a schema in the project, counting every row (a person may add one meanwhile). */
export function nextNumber(run: JobRun, schema: string): number {
  return run.p.rows(schema).reduce((m, r) => Math.max(m, num(r.Number)), 0) + 1;
}

/** The row this job wrote under a local key, if any (a resumed run). */
export function mine(run: JobRun, schema: string, local: string): Row | undefined {
  const key = run.key(local);
  return run.p.rows(schema).find((r) => r.RequestKey === key);
}

/** A Key (^[a-z0-9][a-z0-9-]{0,62}$) not used by another row of the schema in the project. */
export function freeKey(run: JobRun, schema: string, wanted: string, local: string, max = 40): string {
  const own = mine(run, schema, local);
  if (own && str(own.Key)) return str(own.Key);
  const taken = new Set(run.p.rows(schema).map((r) => str(r.Key)));
  const base = slugOf(wanted, max - 3);
  let k = base;
  for (let i = 2; taken.has(k); i++) k = `${base}-${i}`;
  return k;
}

/** Two texts say the same thing: they share most of their meaningful words. */
export function similar(a: string | Set<string>, b: string | Set<string>, ratio = 0.6): boolean {
  const A = typeof a === "string" ? wordsOf(a) : a;
  const B = typeof b === "string" ? wordsOf(b) : b;
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const small = Math.min(A.size, B.size);
  return shared >= Math.max(2, Math.ceil(small * ratio));
}

/** Inserts numbered rows a few at a time: the numbers are given out in the items' order before any write, a row this
 *  job wrote already (a resumed run) is answered as it is. `before` runs ahead of each insert (progress). */
export async function insertNumberedAll<T>(
  run: JobRun,
  schema: string,
  items: readonly T[],
  o: { fields(item: T, n: number): Row; local(item: T): string; before?(item: T, index: number): Promise<void> },
): Promise<string[]> {
  let next = nextNumber(run, schema);
  const plan = items.map((item) => {
    const own = mine(run, schema, o.local(item));
    return { item, own, n: own ? 0 : next++ };
  });
  return inParallel(plan, 4, async ({ item, own, n }, i) => {
    await o.before?.(item, i);
    if (own) return str(own.ItemId);
    return run.insert(schema, { ...o.fields(item, n), Number: n }, o.local(item));
  });
}

/** Inserts a numbered row; a resumed run gets its own row back (same RequestKey) whatever the number is now. */
export async function insertNumbered(run: JobRun, schema: string, fields: (n: number) => Row, local: string): Promise<string> {
  const own = mine(run, schema, local);
  if (own) return str(own.ItemId);
  const n = nextNumber(run, schema);
  return run.insert(schema, { ...fields(n), Number: n }, local);
}

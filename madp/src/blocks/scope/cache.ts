// Read-your-write: put the rows a function answered straight into the cached lists and items of a schema.
// Reads stay Data Gateway hooks; this only updates what they already hold, then the caller invalidates in the background.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { blocksKeys } from "../data/keys";

export type Row = Record<string, unknown>;

type Node = { op: string; field?: string; value?: unknown; values?: unknown[]; clauses?: Node[] };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function matches(where: Node | undefined, row: Row): boolean {
  if (!where) return true;
  if (where.op === "and") return (where.clauses ?? []).every((c) => matches(c, row));
  // a field the cached row does not carry (it selects only some) cannot disprove a clause
  const v = row[where.field ?? ""];
  if (where.op === "eq") return v === undefined || v === where.value;
  if (where.op === "in") return v === undefined || (where.values ?? []).includes(v);
  return false;
}

/** The value of the list's `field = value` clause, if it has one. */
function eqValue(where: Node | undefined, field: string): unknown {
  if (!where) return undefined;
  if (where.op === "and") {
    for (const c of where.clauses ?? []) {
      const v = eqValue(c, field);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  return where.op === "eq" && where.field === field ? where.value : undefined;
}

type SortSpec = { field: string; dir?: "asc" | "desc" };

function compare(a: Row, b: Row, sort: readonly SortSpec[]): number {
  for (const s of sort) {
    const x = a[s.field];
    const y = b[s.field];
    if (x === y) continue;
    const dir = s.dir === "desc" ? -1 : 1;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    return (x < y ? -1 : 1) * dir;
  }
  return 0;
}

function mergeList(items: Row[], params: Row, rows: readonly Row[], removed: ReadonlySet<string>): Row[] {
  const where = params.where as Node | undefined;
  const sort = Array.isArray(params.sort) ? (params.sort as SortSpec[]) : [];
  const byId = new Map(rows.map((r) => [String(r.ItemId), r]));
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const old of items) {
    const id = String(old.ItemId);
    seen.add(id);
    if (removed.has(id)) continue;
    const next = byId.get(id);
    const merged = next ? { ...old, ...next } : old;
    if (next && !matches(where, merged)) continue;
    out.push(merged);
  }
  // only a list filtered by ProjectId takes new rows; they must pass every clause of its filter
  const projectId = eqValue(where, "ProjectId");
  let inserted = false;
  if (projectId !== undefined) {
    for (const r of rows) {
      const id = String(r.ItemId);
      if (seen.has(id) || removed.has(id) || r.ProjectId !== projectId || !matches(where, r)) continue;
      out.push(r);
      inserted = true;
    }
  }
  if (inserted && sort.length) out.sort((a, b) => compare(a, b, sort));
  return out;
}

/** Merge raw rows by ItemId into every cached query of one schema (a Page, an array or an item) and drop removed ids. */
export function mergeRows(
  client: QueryClient,
  workspaceId: string,
  schema: string,
  rows: readonly Row[],
  removedIds: readonly string[] = [],
): void {
  const removed = new Set(removedIds);
  const keyed = rows.filter((r) => typeof r.ItemId === "string");
  const entries = client.getQueriesData({ queryKey: blocksKeys.schema(workspaceId, schema) }) as [QueryKey, unknown][];
  for (const [key, data] of entries) {
    const params = isRecord(key[3]) ? key[3] : {};
    if (data === undefined) continue;
    if (params.kind === "item") {
      const id = String(params.id ?? "");
      if (removed.has(id)) client.setQueryData(key, null);
      else {
        const next = keyed.find((r) => r.ItemId === id);
        if (next) client.setQueryData(key, isRecord(data) ? { ...data, ...next } : next);
      }
      continue;
    }
    if (Array.isArray(data)) {
      client.setQueryData(key, mergeList(data as Row[], params, keyed, removed));
    } else if (isRecord(data) && Array.isArray(data.items)) {
      const items = mergeList(data.items as Row[], params, keyed, removed);
      const delta = items.length - data.items.length;
      const totalCount = typeof data.totalCount === "number" ? Math.max(0, data.totalCount + delta) : items.length;
      client.setQueryData(key, { ...data, items, totalCount });
    } else if (isRecord(data) && typeof data.ItemId === "string") {
      // an item cached without the item key shape
      const next = keyed.find((r) => r.ItemId === data.ItemId);
      if (removed.has(data.ItemId)) client.setQueryData(key, null);
      else if (next) client.setQueryData(key, { ...data, ...next });
    }
  }
}

// Reading rows the way the hosted Data Gateway does: the live filter semantics (functions/_lib/testing/gatewaySemantics.ts,
// proven against the live gateway, including "ItemId only at the top level"), MongoDB sort order (missing and null first
// ascending, binary string order), 1-based pages, and GraphQL projection (ItemId plus every asked field, null when unset).
import { wireMatches } from "../../functions/_lib/testing/gatewaySemantics.ts";
import type { Row } from "./rowStore.ts";
import { ROW_KEY } from "../../src/domain/gatewaySort.ts";

export type SortKey = { field: string; dir: "asc" | "desc" };

export function selectRows(rows: readonly Row[], wire: Record<string, unknown> | null | undefined): Row[] {
  if (wire === null) return [];
  if (wire === undefined || Object.keys(wire).length === 0) return [...rows];
  return rows.filter((r) => wireMatches(wire, r));
}

// MongoDB's cross-type order: null < numbers < strings < objects < arrays < booleans.
function rank(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return 1;
  if (typeof v === "string") return 2;
  if (Array.isArray(v)) return 4;
  if (typeof v === "object") return 3;
  if (typeof v === "boolean") return 5;
  return 6;
}

export function compareValues(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1 || ra === 2) return (a as number | string) < (b as number | string) ? -1 : (a as number | string) > (b as number | string) ? 1 : 0;
  if (ra === 5) return Number(a) - Number(b);
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The value a sort key reads: the gateway's row key `_id` is the row's ItemId (src/domain/gatewaySort.ts). */
const sortValue = (row: Row, field: string): unknown => (field === ROW_KEY ? row.ItemId : row[field]);

/** A stable sort on the keys in order; without keys the insertion order stays (the gateway's natural order). */
export function sortRows(rows: Row[], keys: readonly SortKey[]): Row[] {
  if (keys.length === 0) return rows;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((p, q) => {
      for (const k of keys) {
        const c = compareValues(sortValue(p.row, k.field), sortValue(q.row, k.field));
        if (c !== 0) return k.dir === "desc" ? -c : c;
      }
      return p.i - q.i;
    })
    .map((x) => x.row);
}

/** The gateway's sort input ({"Field": 1 | -1, ...} as JSON or object) as sort keys, in order. */
export function sortKeysOf(sort: unknown): SortKey[] {
  let o: unknown = sort;
  if (typeof sort === "string") {
    try {
      o = JSON.parse(sort);
    } catch {
      return [];
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).map(([field, d]) => ({ field, dir: d === -1 || d === "desc" ? "desc" : "asc" }));
}

const clone = <T>(v: T): T => (v !== null && typeof v === "object" ? structuredClone(v) : v);

/** ItemId plus every asked field (null when the row does not have it), copied. */
export function projectRow(row: Row, fields: readonly string[]): Row {
  const out: Row = { ItemId: row.ItemId };
  for (const f of fields) {
    if (f === "ItemId") continue;
    const v = row[f];
    out[f] = v === undefined ? null : clone(v);
  }
  return out;
}

export function pageOf(rows: readonly Row[], pageNo: number, pageSize: number): Row[] {
  const start = (pageNo - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

// The typed filter builder. Raw filter objects from input are never accepted: only f.eq / f.in / f.and.
import { flattenConditions, type FilterCondition } from "../../src/domain/gatewayFilter";

declare const brand: unique symbol;

export type Scalar = string | number | boolean;

type Node =
  | { kind: "eq"; field: string; value: Scalar }
  | { kind: "in"; field: string; values: readonly (string | number)[] }
  | { kind: "range"; field: string; gte?: string; lte?: string }
  | { kind: "and"; parts: readonly Filter[] };

export type Filter = { readonly [brand]: true };

export const FIELD_NAME = /^(ItemId|[A-Z][A-Za-z0-9]{0,63})$/;
const MAX_IN = 500;

const nodes = new WeakMap<object, Node>();

function make(node: Node): Filter {
  const f = Object.freeze({}) as Filter;
  nodes.set(f, node);
  return f;
}

function node(f: Filter): Node {
  const n = typeof f === "object" && f !== null ? nodes.get(f) : undefined;
  if (!n) throw new TypeError("filter must be built with f.eq / f.in / f.and");
  return n;
}

function checkField(field: unknown): string {
  if (typeof field !== "string" || !FIELD_NAME.test(field)) throw new TypeError("invalid filter field name");
  return field;
}

function checkScalar(value: unknown): Scalar {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError("filter values must be scalars");
}

export const f = {
  eq(field: string, value: Scalar): Filter {
    return make({ kind: "eq", field: checkField(field), value: checkScalar(value) });
  },
  in(field: string, values: readonly (string | number)[]): Filter {
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_IN) throw new TypeError("f.in needs 1-500 values");
    for (const v of values) if (typeof v !== "string" && typeof v !== "number") throw new TypeError("f.in values must be strings or numbers");
    for (const v of values) checkScalar(v);
    return make({ kind: "in", field: checkField(field), values: [...values] });
  },
  /** An inclusive string range (ISO timestamps compare lexicographically). At least one bound; ItemId is refused. */
  range(field: string, bounds: { gte?: string; lte?: string }): Filter {
    const name = checkField(field);
    if (name === "ItemId") throw new TypeError("f.range cannot filter ItemId");
    const b = typeof bounds === "object" && bounds !== null ? bounds : {};
    const { gte, lte } = b;
    if (gte === undefined && lte === undefined) throw new TypeError("f.range needs gte or lte");
    if ((gte !== undefined && typeof gte !== "string") || (lte !== undefined && typeof lte !== "string")) throw new TypeError("f.range bounds must be strings");
    return make({ kind: "range", field: name, ...(gte !== undefined ? { gte } : {}), ...(lte !== undefined ? { lte } : {}) });
  },
  and(...filters: Filter[]): Filter {
    if (filters.length === 0) throw new TypeError("f.and needs at least one filter");
    for (const x of filters) node(x);
    return make({ kind: "and", parts: [...filters] });
  },
};

export function isFilter(x: unknown): x is Filter {
  return typeof x === "object" && x !== null && nodes.has(x);
}

/** True for a filter that restricts nothing (an `and` of nothing cannot be built, so only a non-filter is empty). */
export function isEmptyFilter(x: unknown): boolean {
  return !isFilter(x);
}

function conditionsOf(filter: Filter): FilterCondition[] {
  const n = node(filter);
  if (n.kind === "range") return [];
  if (n.kind === "eq") return [{ field: n.field, op: "eq", value: n.value }];
  if (n.kind === "in") return [{ field: n.field, op: "in", values: [...n.values] }];
  return n.parts.flatMap(conditionsOf);
}

/** The flat gateway filter, or null when no row can match (for example two different ItemIds). */
export function toGatewayFilter(filter: Filter): Record<string, unknown> | null {
  const conditions = conditionsOf(filter);
  const { filter: flat, matchesNothing } = flattenConditions(conditions);
  if (matchesNothing) return null;
  const ranges = new Map<string, { gte?: string; lte?: string }>();
  for (const r of rangesOf(filter)) {
    if (conditions.some((c) => c.field === r.field)) throw new TypeError("a range field cannot also have eq / in");
    const have = ranges.get(r.field) ?? {};
    if (r.gte !== undefined && (have.gte === undefined || r.gte > have.gte)) have.gte = r.gte;
    if (r.lte !== undefined && (have.lte === undefined || r.lte < have.lte)) have.lte = r.lte;
    ranges.set(r.field, have);
  }
  if (flat === undefined && ranges.size === 0) return null;
  const out: Record<string, unknown> = flat ? { ...flat } : {};
  for (const [field, b] of ranges) out[field] = { ...(b.gte !== undefined ? { $gte: b.gte } : {}), ...(b.lte !== undefined ? { $lte: b.lte } : {}) };
  return out;
}

function rangesOf(filter: Filter): { field: string; gte?: string; lte?: string }[] {
  const n = node(filter);
  if (n.kind === "range") return [{ field: n.field, ...(n.gte !== undefined ? { gte: n.gte } : {}), ...(n.lte !== undefined ? { lte: n.lte } : {}) }];
  if (n.kind === "and") return n.parts.flatMap(rangesOf);
  return [];
}

export function matches(filter: Filter, row: Record<string, unknown>): boolean {
  const n = node(filter);
  if (n.kind === "and") return n.parts.every((p) => matches(p, row));
  const actual = row[n.field];
  const candidates = Array.isArray(actual) ? actual : [actual];
  if (n.kind === "range") {
    return candidates.some((c) => typeof c === "string" && (n.gte === undefined || c >= n.gte) && (n.lte === undefined || c <= n.lte));
  }
  if (n.kind === "eq") return candidates.some((c) => c === n.value);
  return candidates.some((c) => n.values.includes(c as string | number));
}

export function filterFields(filter: Filter): string[] {
  const n = node(filter);
  if (n.kind === "and") return [...new Set(n.parts.flatMap(filterFields))];
  return [n.field];
}

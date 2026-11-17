// Test kit only: an in-memory RawGateway with the production insert/update/remove rules.
import { OpError } from "../errors";
import { uuid5 } from "../ids";
import { isEmptyFilter, toGatewayFilter } from "../filter";
import type { RawGateway } from "../gateway";
import { checkPaging } from "../paging";
import { wireMatches } from "./gatewaySemantics";
import { assertRowValid, uniqueIndexesFromS1 } from "./schemaRules";

type Row = Record<string, unknown>;
type Method = "get" | "find" | "findAll" | "insert" | "insertMany" | "update" | "updateMany" | "remove";

export type MemoryGateway = RawGateway & {
  rows(schema: string): Row[];
  calls: { method: string; schema: string }[];
  failNext(method: Method | "*", error: unknown, opts?: { schema?: string; times?: number }): void;
  seed(schema: string, row: Row): string;
  /** The virtual clock (ms) in latency 'live' mode, Date.now() otherwise. */
  now(): number;
};

type Failure = { method: Method | "*"; error: unknown; schema?: string; times: number };

const copy = <T,>(v: T): T => structuredClone(v);

const METHODS = ["get", "find", "findAll", "insert", "insertMany", "update", "updateMany", "remove"] as const;
// Live-model base duration per method in ms; a deterministic jitter below 1200 ms is added per call.
const BASE_MS: Record<Method, number> = { get: 200, find: 300, findAll: 400, insert: 350, insertMany: 450, update: 350, updateMany: 450, remove: 300 };
const LIVE_START = Date.parse("2026-10-20T12:00:00.000Z");

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Evaluates the compiled wire filter with the live gateway rules (null = no row can match).
function select(rows: Row[], where: unknown): Row[] {
  const wire = toGatewayFilter(where as never) as Record<string, unknown> | null;
  return wire === null ? [] : rows.filter((r) => wireMatches(wire, r));
}

function sortRows(rows: Row[], sort: unknown): Row[] {
  const keys: { field: string; desc: boolean }[] = [];
  const add = (field: string, desc: boolean) => keys.push({ field, desc });
  const parse = (s: unknown): void => {
    if (typeof s === "string") add(s.replace(/^-/, ""), s.startsWith("-"));
    else if (Array.isArray(s)) s.forEach(parse);
    else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      if (typeof o.field === "string") add(o.field, o.desc === true || o.dir === "desc");
      else for (const [k, d] of Object.entries(o)) add(k, d === "desc" || d === -1 || d === true);
    }
  };
  parse(sort);
  if (!keys.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { field, desc } of keys) {
      // the gateway's row key `_id` is the row's ItemId (src/domain/gatewaySort.ts)
      const x = (field === "_id" ? a.ItemId : a[field]) as any;
      const y = (field === "_id" ? b.ItemId : b[field]) as any;
      if (x === y) continue;
      const c = x === undefined || x === null ? -1 : y === undefined || y === null ? 1 : x < y ? -1 : 1;
      return desc ? -c : c;
    }
    return 0;
  });
}

function project(row: Row, fields: unknown): Row {
  if (!Array.isArray(fields) || !fields.length) return copy(row);
  const out: Row = { ItemId: row.ItemId };
  for (const f of fields) if (typeof f === "string" && f in row) out[f] = copy(row[f]);
  return out;
}

export function memoryGateway(
  opts: { rows?: Record<string, Row[]>; uniqueIndexes?: Record<string, string[][]>; validate?: boolean; latency?: boolean | "live" } = {},
): MemoryGateway {
  const validate = opts.validate !== false;
  const indexes = opts.uniqueIndexes ?? uniqueIndexesFromS1();
  const store = new Map<string, Row[]>();
  const counters = new Map<string, number>();
  const calls: { method: string; schema: string }[] = [];
  const failures: Failure[] = [];
  const live = opts.latency === "live";
  let clock = LIVE_START;
  // Set by the live wrapper just before a call runs; the write paths stamp rows with it (seed() never does).
  let stampAt: string | null = null;

  const table = (schema: string): Row[] => {
    let t = store.get(schema);
    if (!t) store.set(schema, (t = []));
    return t;
  };
  const nextId = (schema: string): string => {
    const n = (counters.get(schema) ?? 0) + 1;
    counters.set(schema, n);
    return uuid5(`${schema}:${n}`);
  };
  const enter = (method: Method, schema: string): void => {
    calls.push({ method, schema });
    const i = failures.findIndex((f) => (f.method === "*" || f.method === method) && (!f.schema || f.schema === schema));
    const hit = failures[i];
    if (!hit) return;
    if (--hit.times <= 0) failures.splice(i, 1);
    throw hit.error;
  };
  const duplicate = (schema: string, row: Row): { itemId: string | null } | null => {
    for (const fields of [["RequestKey"], ...(indexes[schema] ?? [])]) {
      if (fields.some((f) => row[f] === undefined || row[f] === null)) continue;
      const other = table(schema).find((r) => fields.every((f) => r[f] === row[f]));
      if (other) return { itemId: fields.length === 1 && fields[0] === "RequestKey" ? (other.ItemId as string) : null };
    }
    return null;
  };
  const store1 = (schema: string, row: Row, itemId?: string): { created: boolean; itemId: string | null } => {
    if (validate) assertRowValid(schema, row, { read: itemId !== undefined });
    const dup = duplicate(schema, row);
    if (dup) return { created: false, itemId: dup.itemId };
    const id = itemId ?? nextId(schema);
    const stored: Row = { ...copy(row), ItemId: id };
    if (stampAt) {
      stored.CreatedDate = stampAt;
      stored.LastUpdatedDate = stampAt;
    }
    table(schema).push(stored);
    return { created: true, itemId: id };
  };
  const checkPatch = (schema: string, patch: Row): void => {
    for (const [field, value] of Object.entries(patch)) {
      if (value === null || value === undefined) throw new OpError("internal", "fn.nullPatch", { schema, field });
    }
    if (validate) assertRowValid(schema, patch, { partial: true });
  };

  const gw = {
    calls,
    rows: (schema: string) => table(schema).map(copy),
    failNext(method: Method | "*", error: unknown, o: { schema?: string; times?: number } = {}) {
      failures.push({ method, error, schema: o.schema, times: o.times ?? 1 });
    },
    now: () => (live ? clock : Date.now()),
    seed(schema: string, row: Row): string {
      const { ItemId, ...rest } = row;
      const out = store1(schema, rest, typeof ItemId === "string" ? ItemId : undefined);
      if (!out.created) throw new OpError("internal", "fn.duplicateSeed", { schema });
      return out.itemId as string;
    },
    async get(schema: string, id: string, fields?: unknown) {
      enter("get", schema);
      const row = table(schema).find((r) => r.ItemId === id);
      return row ? project(row, fields) : null;
    },
    async find(schema: string, o: { where?: unknown; fields?: unknown; sort?: unknown; page?: number; pageSize?: number } = {}) {
      enter("find", schema);
      const hits = sortRows(select(table(schema), o.where), o.sort);
      // page is 1-based, as in the production gateway
      const size = o.pageSize ?? 50;
      checkPaging(o.page ?? 1, size);
      const start = ((o.page ?? 1) - 1) * size;
      return { items: hits.slice(start, start + size).map((r) => project(r, o.fields)), totalCount: hits.length };
    },
    async findAll(schema: string, o: { where?: unknown; fields?: unknown; sort?: unknown; max?: number } = {}) {
      enter("findAll", schema);
      const hits = sortRows(select(table(schema), o.where), o.sort);
      if (hits.length > (o.max ?? 1000)) throw new OpError("limit_reached", "fn.error.limit_reached");
      return hits.map((r) => project(r, o.fields));
    },
    async insert(schema: string, row: Row) {
      enter("insert", schema);
      if ("ItemId" in row) throw new OpError("internal", "fn.clientItemId", { schema });
      if (typeof row.RequestKey !== "string" || !row.RequestKey) throw new TypeError(`insert into ${schema} needs a RequestKey`);
      return store1(schema, row);
    },
    async insertMany(schema: string, rows: Row[]) {
      enter("insertMany", schema);
      let created = 0;
      let existing = 0;
      for (const row of rows) {
        if ("ItemId" in row) throw new OpError("internal", "fn.clientItemId", { schema });
        if (typeof row.RequestKey !== "string" || !row.RequestKey) throw new TypeError(`insert into ${schema} needs a RequestKey`);
        if (store1(schema, row).created) created++;
        else existing++;
      }
      return { created, existing };
    },
    async update(schema: string, id: string, patch: Row) {
      enter("update", schema);
      checkPatch(schema, patch);
      const row = table(schema).find((r) => r.ItemId === id);
      if (row) Object.assign(row, copy(patch), stampAt ? { LastUpdatedDate: stampAt } : {});
    },
    async updateMany(schema: string, where: unknown, patch: Row) {
      enter("updateMany", schema);
      if (isEmptyFilter(where as never)) throw new OpError("internal", "fn.emptyFilter", { schema });
      checkPatch(schema, patch);
      const hits = select(table(schema), where);
      for (const r of hits) Object.assign(r, copy(patch), stampAt ? { LastUpdatedDate: stampAt } : {});
      return { matched: hits.length };
    },
    async remove(schema: string, id: string) {
      enter("remove", schema);
      const t = table(schema);
      const i = t.findIndex((r) => r.ItemId === id);
      if (i >= 0) t.splice(i, 1);
    },
  };
  for (const [schema, rows] of Object.entries(opts.rows ?? {})) for (const row of rows) gw.seed(schema, row);
  if (live) {
    // Live model: every call gets a deterministic virtual duration; it settles after duration/50 macrotasks, so the calls of
    // one round settle in order of duration, and the virtual clock moves to the longest end just before each settles.
    const target = gw as unknown as Record<Method, (...a: unknown[]) => Promise<unknown>>;
    let ordinal = 0;
    for (const method of METHODS) {
      const original = target[method].bind(gw);
      target[method] = (...a: unknown[]) => {
        const schema = String(a[0]);
        const start = clock;
        const d = BASE_MS[method] + (fnv1a(`${method}:${schema}:${ordinal++}`) % 1200);
        const writes = method === "insert" || method === "insertMany" || method === "update" || method === "updateMany";
        stampAt = writes ? new Date(start + d).toISOString() : null;
        const answer = original(...a);
        stampAt = null;
        const hops = Math.max(1, Math.round(d / 50));
        return (async () => {
          let failure: { error: unknown } | null = null;
          let value: unknown;
          try {
            value = await answer;
          } catch (error) {
            failure = { error };
          }
          for (let i = 0; i < hops; i++) await new Promise<void>((resolve) => setImmediate(resolve));
          clock = Math.max(clock, start + d);
          if (failure) throw failure.error;
          return value;
        })();
      };
    }
  } else if (opts.latency) {
    // Every call answers one macrotask later, like a network call: calls started in the same turn all start before
    // any of them finishes, so a counter can tell parallel calls from sequential ones.
    const target = gw as unknown as Record<Method, (...a: unknown[]) => Promise<unknown>>;
    for (const method of METHODS) {
      const original = target[method].bind(gw);
      target[method] = async (...a: unknown[]) => {
        const answer = original(...a);
        const tick = new Promise<void>((resolve) => setImmediate(resolve));
        try {
          return await answer;
        } finally {
          await tick;
        }
      };
    }
  }
  return gw as unknown as MemoryGateway;
}

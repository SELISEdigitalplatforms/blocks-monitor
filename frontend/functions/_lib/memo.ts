// A per-request read memo. Within one request the caller's Account, Membership, Workspace, roles and Project are read
// by the router and read again by handlers and helpers; the memo answers the repeat for free. Any write on a schema
// drops that schema's entries first, so a later read always sees the write.
import { toGatewayFilter, type Filter } from "./filter";
import type { FindOptions, RawGateway, Row } from "./gateway";

const WRITES = ["insert", "insertMany", "update", "updateMany", "remove"] as const;

function copy<T>(x: T): T {
  return typeof structuredClone === "function" ? structuredClone(x) : (JSON.parse(JSON.stringify(x)) as T);
}

function key(parts: unknown): string {
  return JSON.stringify(parts);
}

/** A filter is an opaque object; its wire form is the canonical text. Null when it cannot be built (the gateway then refuses it). */
function whereKey(where: Filter): string | null {
  try {
    return JSON.stringify(toGatewayFilter(where)) ?? null;
  } catch {
    return null;
  }
}

/** Entries older than this are read again: a handler that sleeps and re-reads (acl.restamp's second pass) must see new rows. */
const MAX_AGE_MS = 1000;

/** For a whole request: the router passes this so reads prefetched in round 1 are still there when the handler asks. */
export const REQUEST_MEMO_MAX_AGE_MS = Number.POSITIVE_INFINITY;

const INNER = Symbol("memo.inner");

/** The gateway a memo wraps (reads that must see other requests' rows after a wait); gw itself when it is not a memo. */
export function unmemoised(gw: RawGateway): RawGateway {
  return ((gw as unknown as Record<symbol, RawGateway | undefined>)[INNER] ?? gw) as RawGateway;
}

export function memoGateway(raw: RawGateway, o: { now?: () => number; maxAgeMs?: number } = {}): RawGateway {
  const now = o.now ?? Date.now;
  const maxAge = o.maxAgeMs ?? MAX_AGE_MS;
  // Row reads: schema -> id -> the row and the fields it holds.
  const rows = new Map<string, Map<string, { row: Row; fields: Set<string>; at: number }>>();
  const pendingGets = new Map<string, Map<string, Promise<Row | null>>>();
  // `at` is null while the call is in flight (always shared) and the settle time afterwards: a slow read must not expire before it is used.
  type ListEntry = { p: Promise<unknown>; at: number | null; base: string; fields: ReadonlySet<string> };
  const lists = new Map<string, Map<string, ListEntry>>();
  // Bumped by every write, so a read that was in flight during the write never fills the memo.
  const generation = new Map<string, number>();
  const gen = (schema: string): number => generation.get(schema) ?? 0;

  const project = (row: Row, fields: readonly string[]): Row => {
    const out: Row = {};
    if ("ItemId" in row) out.ItemId = row.ItemId;
    for (const k of fields) if (k in row) out[k] = copy(row[k]);
    return out;
  };

  const drop = (schema: string): void => {
    generation.set(schema, gen(schema) + 1);
    rows.delete(schema);
    pendingGets.delete(schema);
    lists.delete(schema);
  };

  const listOf = (schema: string): Map<string, ListEntry> => {
    let m = lists.get(schema);
    if (!m) lists.set(schema, (m = new Map()));
    return m;
  };

  /** A settled find/findAll answers a later get of one of its ids when it carried every field asked for. */
  const remember = (schema: string, g: number, fields: readonly string[], found: readonly Row[]): void => {
    if (g !== gen(schema)) return;
    let byId = rows.get(schema);
    if (!byId) rows.set(schema, (byId = new Map()));
    for (const row of found) {
      const id = row.ItemId;
      if (typeof id !== "string" || id === "") continue;
      const prev = byId.get(id);
      const held = new Set([...(prev?.fields ?? []), ...fields, ...Object.keys(row)]);
      byId.set(id, { row: { ...(prev?.row ?? {}), ...copy(row) }, fields: held, at: now() });
    }
  };

  /** The result cut to the requested fields (plus ItemId); the held copy is never handed out. */
  const projectResult = <T>(res: T, fields: readonly string[]): T => {
    if (Array.isArray(res)) return (res as Row[]).map((r) => project(r, fields)) as unknown as T;
    const items = (res as { items?: Row[] } | null)?.items;
    if (res && Array.isArray(items)) return { ...(res as object), items: items.map((r) => project(r, fields)) } as unknown as T;
    return copy(res);
  };

  const cachedList = <T>(schema: string, base: string, fields: readonly string[], run: () => Promise<T>): Promise<T> => {
    const m = listOf(schema);
    const k = key([base, fields]);
    const fresh = (e: ListEntry): boolean => e.at === null || now() - e.at < maxAge;
    const hit = m.get(k);
    if (hit && fresh(hit)) return (hit.p as Promise<T>).then(copy);
    // The same query read with a superset of the fields (in flight or settled) answers this one.
    for (const e of m.values()) {
      if (e.base === base && fresh(e) && fields.every((x) => e.fields.has(x))) return (e.p as Promise<T>).then((res) => projectResult(res, fields));
    }
    const g = gen(schema);
    const p = run();
    const entry: ListEntry = { p: p as Promise<unknown>, at: null, base, fields: new Set(fields) };
    m.set(k, entry);
    p.then(
      (res) => {
        entry.at = now();
        const found = Array.isArray(res) ? (res as Row[]) : ((res as { items?: Row[] } | null)?.items ?? []);
        if (Array.isArray(found)) remember(schema, g, fields, found);
      },
      () => {
        if (m.get(k) === entry) m.delete(k);
      },
    );
    return p.then(copy);
  };

  const out = {} as Record<string, unknown>;
  out.get = (schema: string, itemId: string, fields: readonly string[]): Promise<Row | null> => {
    const cached = rows.get(schema)?.get(itemId);
    if (cached && now() - cached.at < maxAge && fields.every((x) => cached.fields.has(x))) return Promise.resolve(project(cached.row, fields));
    const pend = pendingGets.get(schema)?.get(itemId + "|" + key(fields));
    if (pend) return pend.then((r) => (r ? copy(r) : null));
    const g = gen(schema);
    const p = raw.get(schema, itemId, fields).then((row) => {
      if (row && g === gen(schema)) {
        let byId = rows.get(schema);
        if (!byId) rows.set(schema, (byId = new Map()));
        const prev = byId.get(itemId);
        const held = new Set([...(prev?.fields ?? []), ...fields, ...Object.keys(row)]);
        byId.set(itemId, { row: { ...(prev?.row ?? {}), ...copy(row) }, fields: held, at: now() });
      }
      return row;
    });
    let pendById = pendingGets.get(schema);
    if (!pendById) pendingGets.set(schema, (pendById = new Map()));
    const pk = itemId + "|" + key(fields);
    pendById.set(pk, p);
    const clear = (): void => {
      if (pendById && pendById.get(pk) === p) pendById.delete(pk);
    };
    p.then(clear, clear);
    return p.then((r) => (r ? copy(r) : null));
  };
  out.find = (schema: string, o: FindOptions) => {
    const w = whereKey(o.where);
    if (w === null) return raw.find(schema, o);
    return cachedList(schema, key(["find", w, o.sort ?? null, o.page ?? null, o.pageSize ?? null]), o.fields, () => raw.find(schema, o));
  };
  out.findAll = (schema: string, o: Parameters<RawGateway["findAll"]>[1]) => {
    const w = whereKey(o.where);
    if (w === null) return raw.findAll(schema, o);
    return cachedList(schema, key(["findAll", w, o.sort ?? null, o.max ?? null]), o.fields, () => raw.findAll(schema, o));
  };
  for (const m of WRITES) {
    out[m] = (schema: string, ...args: unknown[]): Promise<unknown> => {
      drop(schema);
      const p = (raw[m] as (...a: unknown[]) => Promise<unknown>)(schema, ...args);
      // The write may land after a read started now; drop again once it is done.
      const after = (): void => drop(schema);
      p.then(after, after);
      return p;
    };
  }
  Object.defineProperty(out, INNER, { value: raw, enumerable: false });
  return out as unknown as RawGateway;
}

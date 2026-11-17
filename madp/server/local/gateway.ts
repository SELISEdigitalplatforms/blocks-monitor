// The RawGateway of functions/_lib/gateway.ts on the local SQLite store, with the hosted gateway's semantics: argument
// checks and their TypeErrors, no client ItemId, a RequestKey on every insert, unique indexes (a RequestKey hit answers
// the existing ItemId, any other unique hit answers created:false with no id), null patch values refused, a unique hit
// on update is a conflict, paging 1-100, findAll max 1000 (hard 5000), and the live filter semantics.
// Loaded in the same module graph as the functions (Vite SSR), so Filter objects and OpError are the same instances.
import { OpError } from "../../functions/_lib/errors";
import { FIELD_NAME, isEmptyFilter, isFilter, toGatewayFilter, type Filter } from "../../functions/_lib/filter";
import type { FindOptions, RawGateway, Row } from "../../functions/_lib/gateway";
import { pageOf, projectRow, selectRows, sortRows } from "./query.ts";
import { UniqueViolation, type RowStore } from "./rowStore.ts";

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const PAGE_SIZE = 100;
const DEFAULT_MAX = 1000;
const HARD_MAX = 5000;
const MAX_MANY = 100;

function schemaName(schema: string): string {
  if (typeof schema !== "string" || !SCHEMA_NAME.test(schema)) throw new TypeError("invalid schema name");
  return schema;
}

function fieldList(fields: readonly string[]): string[] {
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError("fields must be a non-empty list");
  for (const x of fields) if (typeof x !== "string" || !FIELD_NAME.test(x)) throw new TypeError("invalid field name");
  return [...fields];
}

function itemIdOf(itemId: string): string {
  if (typeof itemId !== "string" || itemId.length < 1 || itemId.length > 100) throw new TypeError("invalid itemId");
  return itemId;
}

function insertRow(row: Row): Row {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("row must be an object");
  if ("ItemId" in row) throw new TypeError("ItemId must not be sent on insert");
  for (const k of Object.keys(row)) if (!FIELD_NAME.test(k)) throw new TypeError("invalid field name");
  const key = row.RequestKey;
  if (typeof key !== "string" || key.length < 1 || key.length > 200) throw new TypeError("RequestKey is required (1-200 characters)");
  return row;
}

function patchOf(patch: Row): Row {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("patch must be an object");
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new TypeError("patch must not be empty");
  for (const k of keys) {
    if (!FIELD_NAME.test(k) || k === "ItemId" || k === "RequestKey") throw new TypeError("invalid patch key");
    if (patch[k] === null || patch[k] === undefined) throw new TypeError("null or undefined patch values are ignored by the gateway; use a real value");
  }
  return patch;
}

/** A storage failure the caller may retry; a unique hit is a conflict. */
function mapError(e: unknown): Error {
  if (e instanceof OpError || e instanceof TypeError) return e;
  if (e instanceof UniqueViolation) return new OpError("conflict");
  const out = new OpError("unavailable");
  (out as { cause?: unknown }).cause = e;
  return out;
}

/** Runs one store call; its failures surface as the gateway's errors. */
function run<T>(work: () => T): T {
  try {
    return work();
  } catch (e) {
    throw mapError(e);
  }
}

function query(store: RowStore, schema: string, where: Filter): Row[] | null {
  const wire = toGatewayFilter(where);
  if (wire === null) return null;
  return selectRows(store.rows(schema), wire as Record<string, unknown>);
}

export function createLocalGateway(store: RowStore): RawGateway {
  const insertOne = (schema: string, row: Row): { created: boolean; itemId: string | null } => {
    const hit = store.conflict(schema, row);
    if (hit) return { created: false, itemId: hit.fields.length === 1 && hit.fields[0] === "RequestKey" ? hit.itemId : null };
    return { created: true, itemId: store.insert(schema, row).ItemId as string };
  };

  const gateway: RawGateway = {
    async get(schema, itemId, fields) {
      schemaName(schema);
      itemIdOf(itemId);
      const cols = fieldList(fields);
      return run(() => {
        const row = store.get(schema, itemId);
        return row ? projectRow(row, cols) : null;
      });
    },

    async find(schema, opts: FindOptions) {
      schemaName(schema);
      if (!isFilter(opts.where)) throw new TypeError("where must be built with the filter builder");
      const cols = fieldList(opts.fields);
      if (opts.sort && !FIELD_NAME.test(opts.sort.field)) throw new TypeError("invalid sort field");
      const page = opts.page ?? 1;
      const size = opts.pageSize ?? PAGE_SIZE;
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > PAGE_SIZE) throw new TypeError("invalid paging");
      return run(() => {
        const hits = query(store, schema, opts.where);
        if (hits === null) return { items: [], totalCount: 0 };
        const sorted = sortRows(hits, opts.sort ? [opts.sort] : []);
        return { items: pageOf(sorted, page, size).map((r) => projectRow(r, cols)), totalCount: sorted.length };
      });
    },

    async findAll(schema, opts) {
      const max = opts.max ?? DEFAULT_MAX;
      if (!Number.isInteger(max) || max < 1 || max > HARD_MAX) throw new TypeError("max must be between 1 and 5000");
      schemaName(schema);
      if (!isFilter(opts.where)) throw new TypeError("where must be built with the filter builder");
      const cols = fieldList(opts.fields);
      if (opts.sort && !FIELD_NAME.test(opts.sort.field)) throw new TypeError("invalid sort field");
      return run(() => {
        const hits = query(store, schema, opts.where);
        if (hits === null) return [];
        if (hits.length > max) throw new OpError("limit_reached", "fn.tooManyRows");
        return sortRows(hits, opts.sort ? [opts.sort] : []).map((r) => projectRow(r, cols));
      });
    },

    async insert(schema, row) {
      schemaName(schema);
      insertRow(row);
      return run(() => insertOne(schema, row));
    },

    async insertMany(schema, rows) {
      schemaName(schema);
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_MANY) throw new TypeError("insertMany takes 1-100 rows");
      rows.forEach(insertRow);
      return run(() => {
        let created = 0;
        for (const row of rows) if (insertOne(schema, row).created) created += 1;
        return { created, existing: rows.length - created };
      });
    },

    async update(schema, itemId, patch) {
      schemaName(schema);
      itemIdOf(itemId);
      patchOf(patch);
      return run(() => {
        store.update(schema, [itemId], patch);
      });
    },

    async updateMany(schema, where, patch) {
      schemaName(schema);
      if (isEmptyFilter(where)) throw new TypeError("updateMany needs a non-empty filter");
      patchOf(patch);
      return run(() => {
        const hits = query(store, schema, where);
        if (hits === null) return { matched: 0 };
        const ids = hits.map((r) => r.ItemId as string);
        if (ids.length > 0) store.update(schema, ids, patch);
        return { matched: ids.length };
      });
    },

    async remove(schema, itemId) {
      schemaName(schema);
      itemIdOf(itemId);
      return run(() => {
        store.remove(schema, itemId);
      });
    },
  };
  return gateway;
}

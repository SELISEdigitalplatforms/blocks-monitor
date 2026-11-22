// The rows of every schema, persisted in SQLite (one JSON document per row) and held in memory per schema in insertion
// order, with the unique indexes of blocks/data/indexes.json (plus RequestKey on every schema) kept as maps.
// A commit by another process (npm run reset) is noticed through PRAGMA data_version and drops the memory copy.
// Plain module, shared per database through globalThis: no OpError, no Filter (the gateway on top maps errors).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { inTransaction } from "./db.ts";

export type Row = Record<string, unknown>;

export type RowChange = { kind: "insert" | "update" | "remove"; schema: string; row: Row };

export interface RowStore {
  /** The live rows of a schema in insertion order. Read only: never mutate what this returns. */
  rows(schema: string): readonly Row[];
  get(schema: string, itemId: string): Row | undefined;
  /** The row a unique index (RequestKey first) already holds for these values, other than `exceptId`. */
  conflict(schema: string, row: Row, exceptId?: string): { fields: readonly string[]; itemId: string } | null;
  /** Stores a new row: a new ItemId and the platform system fields. Throws UniqueViolation. */
  insert(schema: string, row: Row): Row;
  /** Merges the patch into each row (all or none). Throws UniqueViolation. Missing ids are skipped. */
  update(schema: string, itemIds: readonly string[], patch: Row): Row[];
  remove(schema: string, itemId: string): boolean;
  /** Runs fn in one SQLite transaction; a throw rolls the rows and the memory copy back. */
  transaction<T>(fn: () => T): T;
  /** One listener per key (a re-evaluated module replaces its own). */
  onChange(key: string, fn: ((c: RowChange) => void) | null): void;
  schemaNames(): string[];
  /** Forgets the memory copy (the next read loads from SQLite). */
  reload(): void;
}

export class UniqueViolation extends Error {
  constructor(
    readonly schema: string,
    readonly fields: readonly string[],
    readonly itemId: string,
  ) {
    super("unique index violation");
    this.name = "UniqueViolation";
  }
}

const SYSTEM_DEFAULTS = (): Row => ({ CreatedBy: "", LastUpdatedBy: "", Language: "en-US", OrganizationIds: [], Tags: [], IsDeleted: false });

/** Unique field lists per schema from indexes.json; RequestKey first for every schema. */
export function loadUniqueIndexes(root: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const file = path.join(root, "blocks", "data", "indexes.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { schemas?: { schemaName: string; indexes: { fields: string[]; unique?: boolean }[] }[] };
  for (const s of doc.schemas ?? []) {
    const lists = s.indexes
      .filter((i) => i.unique === true)
      .map((i) => i.fields.map((f) => f.split(":")[0]!))
      .filter((fields) => !(fields.length === 1 && fields[0] === "RequestKey"));
    out.set(s.schemaName, lists);
  }
  return out;
}

const keyOf = (row: Row, fields: readonly string[]): string | null => {
  const parts: unknown[] = [];
  for (const f of fields) {
    const v = row[f];
    if (v === undefined || v === null) return null;
    parts.push(v);
  }
  return JSON.stringify(parts);
};

interface Table {
  rows: Map<string, Row>;
  list: Row[] | null;
  /** One map per unique index (same order as indexesOf). */
  unique: Map<string, string>[];
}

export function createRowStore(db: DatabaseSync, uniqueIndexes: Map<string, string[][]>): RowStore {
  const tables = new Map<string, Table>();
  const listeners = new Map<string, (c: RowChange) => void>();
  const version = db.prepare("PRAGMA data_version");
  let seen = Number((version.get() as { data_version: number }).data_version);
  const stmt = {
    load: db.prepare("SELECT item_id, doc FROM rows WHERE schema = ? ORDER BY seq"),
    insert: db.prepare("INSERT INTO rows (schema, item_id, doc) VALUES (?, ?, ?)"),
    update: db.prepare("UPDATE rows SET doc = ? WHERE schema = ? AND item_id = ?"),
    remove: db.prepare("DELETE FROM rows WHERE schema = ? AND item_id = ?"),
    schemas: db.prepare("SELECT DISTINCT schema FROM rows"),
  } satisfies Record<string, StatementSync>;

  const indexesOf = (schema: string): string[][] => [["RequestKey"], ...(uniqueIndexes.get(schema) ?? [])];

  function fresh(): void {
    const v = Number((version.get() as { data_version: number }).data_version);
    if (v !== seen) {
      seen = v;
      tables.clear();
    }
  }

  function table(schema: string): Table {
    fresh();
    let t = tables.get(schema);
    if (t) return t;
    const indexes = indexesOf(schema);
    t = { rows: new Map(), list: null, unique: indexes.map(() => new Map()) };
    for (const r of stmt.load.all(schema) as { item_id: string; doc: string }[]) {
      let row: Row;
      try {
        row = JSON.parse(r.doc) as Row;
      } catch {
        continue;
      }
      row.ItemId = r.item_id;
      t.rows.set(r.item_id, row);
      indexes.forEach((fields, i) => {
        const k = keyOf(row, fields);
        if (k !== null) t!.unique[i]!.set(k, r.item_id);
      });
    }
    tables.set(schema, t);
    return t;
  }

  function conflictIn(schema: string, t: Table, row: Row, exceptId?: string): { fields: readonly string[]; itemId: string } | null {
    const indexes = indexesOf(schema);
    for (let i = 0; i < indexes.length; i += 1) {
      const k = keyOf(row, indexes[i]!);
      if (k === null) continue;
      const other = t.unique[i]!.get(k);
      if (other !== undefined && other !== exceptId) return { fields: indexes[i]!, itemId: other };
    }
    return null;
  }

  function indexRow(schema: string, t: Table, row: Row, add: boolean): void {
    indexesOf(schema).forEach((fields, i) => {
      const k = keyOf(row, fields);
      if (k === null) return;
      if (add) t.unique[i]!.set(k, row.ItemId as string);
      else if (t.unique[i]!.get(k) === row.ItemId) t.unique[i]!.delete(k);
    });
  }

  const docOf = (row: Row): string => {
    const { ItemId: _id, ...rest } = row;
    void _id;
    return JSON.stringify(rest);
  };

  function emit(c: RowChange): void {
    for (const fn of [...listeners.values()]) {
      try {
        fn(c);
      } catch {
        /* a listener never changes a write */
      }
    }
  }

  const store: RowStore = {
    rows(schema) {
      const t = table(schema);
      t.list ??= [...t.rows.values()];
      return t.list;
    },
    get(schema, itemId) {
      return table(schema).rows.get(itemId);
    },
    conflict(schema, row, exceptId) {
      return conflictIn(schema, table(schema), row, exceptId);
    },
    insert(schema, input) {
      const t = table(schema);
      const hit = conflictIn(schema, t, input);
      if (hit) throw new UniqueViolation(schema, hit.fields, hit.itemId);
      const at = new Date().toISOString();
      const itemId = randomUUID();
      // A CreatedDate / LastUpdatedDate given on insert is kept (seeded history); ops never send them.
      const row: Row = {
        ...SYSTEM_DEFAULTS(),
        ...structuredClone(input),
        ItemId: itemId,
        CreatedDate: typeof input.CreatedDate === "string" ? input.CreatedDate : at,
        LastUpdatedDate: typeof input.LastUpdatedDate === "string" ? input.LastUpdatedDate : typeof input.CreatedDate === "string" ? input.CreatedDate : at,
      };
      stmt.insert.run(schema, itemId, docOf(row));
      t.rows.set(itemId, row);
      t.list = null;
      indexRow(schema, t, row, true);
      emit({ kind: "insert", schema, row });
      return row;
    },
    update(schema, itemIds, patch) {
      const t = table(schema);
      const at = new Date().toISOString();
      const planned: { before: Row; after: Row }[] = [];
      for (const id of itemIds) {
        const before = t.rows.get(id);
        if (!before) continue;
        // A LastUpdatedDate in the patch is kept (seeded history); ops never send it.
        const stamp = typeof patch.LastUpdatedDate === "string" ? patch.LastUpdatedDate : at;
        planned.push({ before, after: { ...before, ...structuredClone(patch), ItemId: id, LastUpdatedDate: stamp, LastUpdatedBy: "" } });
      }
      if (planned.length === 0) return [];
      // All or none: every new value must be free of the other rows (and of each other).
      const moving = new Set(planned.map((p) => p.before.ItemId as string));
      const claimed = indexesOf(schema).map(() => new Map<string, string>());
      for (const p of planned) {
        indexesOf(schema).forEach((fields, i) => {
          const k = keyOf(p.after, fields);
          if (k === null) return;
          const other = t.unique[i]!.get(k);
          if (other !== undefined && other !== p.after.ItemId && !moving.has(other)) throw new UniqueViolation(schema, fields, other);
          const twin = claimed[i]!.get(k);
          if (twin !== undefined && twin !== p.after.ItemId) throw new UniqueViolation(schema, fields, twin);
          claimed[i]!.set(k, p.after.ItemId as string);
        });
      }
      inTransaction(db, () => {
        for (const p of planned) stmt.update.run(docOf(p.after), schema, p.after.ItemId as string);
      });
      for (const p of planned) {
        indexRow(schema, t, p.before, false);
        t.rows.set(p.after.ItemId as string, p.after);
        indexRow(schema, t, p.after, true);
      }
      t.list = null;
      for (const p of planned) emit({ kind: "update", schema, row: p.after });
      return planned.map((p) => p.after);
    },
    remove(schema, itemId) {
      const t = table(schema);
      const row = t.rows.get(itemId);
      if (!row) return false;
      stmt.remove.run(schema, itemId);
      t.rows.delete(itemId);
      t.list = null;
      indexRow(schema, t, row, false);
      emit({ kind: "remove", schema, row });
      return true;
    },
    transaction(fn) {
      try {
        return inTransaction(db, fn);
      } catch (e) {
        // The memory copy may hold rows the rollback removed: load again from SQLite.
        tables.clear();
        throw e;
      }
    },
    onChange(key, fn) {
      if (fn) listeners.set(key, fn);
      else listeners.delete(key);
    },
    schemaNames() {
      fresh();
      const names = new Set((stmt.schemas.all() as { schema: string }[]).map((r) => r.schema));
      for (const k of tables.keys()) names.add(k);
      return [...names].sort();
    },
    reload() {
      tables.clear();
      seen = Number((version.get() as { data_version: number }).data_version);
    },
  };
  return store;
}

const STORE_KEY = Symbol.for("madp.factory.local.rowStore");

/** The process's row store for this database (one per database file). */
export function sharedRowStore(db: DatabaseSync, root: string): RowStore {
  const g = globalThis as unknown as Record<symbol, WeakMap<DatabaseSync, RowStore> | undefined>;
  const held = (g[STORE_KEY] ??= new WeakMap());
  let store = held.get(db);
  if (!store) {
    store = createRowStore(db, loadUniqueIndexes(root));
    held.set(db, store);
  }
  return store;
}

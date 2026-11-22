// POST /api/data read validation and compile (pure; the only I/O is loadS1Catalog). Every read is checked against the
// S1 schemas, then compiled exactly as src/blocks/data/gql.ts does so gateway inputs and cache keys match. The server
// writes the GraphQL text itself (buildBatchQuery): client text never reaches the gateway.
import fs from "node:fs";
import path from "node:path";
import { batchKey, type BatchMember } from "../../functions/_lib/batch.ts";
import { flattenConditions, type FilterCondition } from "../../src/domain/gatewayFilter.ts";
import { gatewaySort } from "../../src/domain/gatewaySort.ts";

export type S1Catalog = ReadonlyMap<string, ReadonlySet<string>>;

export const MAX_READS = 40;
export const MAX_FIELDS = 80;
export const MAX_CONDITIONS = 16;
export const MAX_IN_VALUES = 500;
export const MAX_SORT = 4;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_NO = 10000;
export const MAX_VALUE_CHARS = 1024;

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

export interface ValidRead {
  schema: string;
  fields: string[];
  pageNo: number;
  pageSize: number;
  workspaceId: string | null;
  matchesNothing: boolean;
  member: BatchMember;
  key: string;
}

export type DataValidation = { ok: true; reads: ValidRead[] } | { ok: false; index: number | null; reason: string };

/** Every blocks/data/schemas/*.json plus ItemId and the platform system fields from blocks/data/README.md. */
export function loadS1Catalog(root: string): S1Catalog {
  const readme = fs.readFileSync(path.join(root, "blocks/data/README.md"), "utf8");
  const start = readme.indexOf("## Platform system fields");
  const rest = readme.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = start < 0 ? "" : end < 0 ? rest : rest.slice(0, end);
  const system = [...section.matchAll(/^- `([A-Za-z]+)`/gm)].map((m) => m[1]);

  const catalog = new Map<string, Set<string>>();
  const dir = path.join(root, "blocks/data/schemas");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { schemaName?: unknown; fields?: unknown };
    if (typeof doc.schemaName !== "string" || !Array.isArray(doc.fields)) continue;
    const names = new Set<string>(["ItemId", ...system]);
    for (const f of doc.fields as { name?: unknown }[]) if (typeof f?.name === "string") names.add(f.name);
    catalog.set(doc.schemaName, names);
  }
  if (catalog.size === 0) throw new Error("no S1 schema loaded");
  return catalog;
}

/** What the catalogue is read from, as modification times and sizes: changes when a schema file is added, removed or
 *  written, or the README's system fields change. */
function catalogStamp(root: string): string {
  const dir = path.join(root, "blocks/data/schemas");
  const parts: string[] = [];
  for (const f of [path.join(root, "blocks/data/README.md"), ...fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort().map((x) => path.join(dir, x))]) {
    try {
      const st = fs.statSync(f);
      parts.push(`${path.basename(f)}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${path.basename(f)}:-`);
    }
  }
  return parts.join("|");
}

/**
 * The catalogue as a getter that follows blocks/data/schemas: a new schema field is readable through POST /api/data
 * without a restart of the server (it was read once at start, so a new field gave 400 until then). At most once per
 * `everyMs` (default 1 s) a cheap check of the files' modification times and sizes; only when they changed is the
 * catalogue read again. A catalogue that cannot be read then (a file half written) keeps the one before, and the next
 * check tries again.
 */
export function liveS1Catalog(root: string, o: { everyMs?: number; now?: () => number } = {}): () => S1Catalog {
  const every = o.everyMs ?? 1000;
  const now = o.now ?? Date.now;
  let catalog = loadS1Catalog(root);
  let stamp = catalogStamp(root);
  let checked = now();
  return () => {
    const t = now();
    if (t - checked < every) return catalog;
    checked = t;
    let next: string;
    try {
      next = catalogStamp(root);
    } catch {
      return catalog;
    }
    if (next === stamp) return catalog;
    try {
      catalog = loadS1Catalog(root);
      stamp = next;
    } catch {
      /* half written: the catalogue before stays, the next check reads it again */
    }
    return catalog;
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function scalarOk(v: unknown): v is string | number | boolean {
  return (typeof v === "string" && v.length <= MAX_VALUE_CHARS) || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

type ReadResult = { ok: true; read: ValidRead } | { ok: false; reason: string };

function validateRead(raw: unknown, catalog: S1Catalog): ReadResult {
  const bad = (reason: string): ReadResult => ({ ok: false, reason });
  if (!isObject(raw)) return bad("read must be an object");
  if (!onlyKeys(raw, ["schema", "fields", "filter", "sort", "pageNo", "pageSize"])) return bad("unknown key in read");
  const { schema } = raw;
  if (typeof schema !== "string" || !SCHEMA_NAME.test(schema)) return bad("invalid schema");
  const known = catalog.get(schema);
  if (!known) return bad("unknown schema");

  const rawFields = raw.fields;
  if (!Array.isArray(rawFields) || rawFields.length < 1 || rawFields.length > MAX_FIELDS) return bad("fields must list 1 to 80 names");
  for (const f of rawFields) if (typeof f !== "string" || !known.has(f)) return bad("unknown field");
  const fields = [...new Set(rawFields as string[])];

  const conditions: FilterCondition[] = [];
  if (raw.filter !== undefined) {
    if (!Array.isArray(raw.filter) || raw.filter.length > MAX_CONDITIONS) return bad("filter must list at most 16 conditions");
    for (const c of raw.filter) {
      if (!isObject(c)) return bad("condition must be an object");
      if (typeof c.field !== "string" || !known.has(c.field)) return bad("unknown filter field");
      if (c.op === "eq") {
        if (!onlyKeys(c, ["field", "op", "value"])) return bad("unknown key in condition");
        if (!scalarOk(c.value)) return bad("invalid filter value");
        conditions.push({ field: c.field, op: "eq", value: c.value });
      } else if (c.op === "in") {
        if (!onlyKeys(c, ["field", "op", "values"])) return bad("unknown key in condition");
        if (!Array.isArray(c.values) || c.values.length > MAX_IN_VALUES) return bad("too many filter values");
        if (!c.values.every(scalarOk)) return bad("invalid filter value");
        conditions.push({ field: c.field, op: "in", values: [...(c.values as (string | number | boolean)[])] });
      } else return bad("unsupported filter op");
    }
  }

  const sortEntries: { field: string; dir: "asc" | "desc" }[] = [];
  if (raw.sort !== undefined) {
    if (!Array.isArray(raw.sort) || raw.sort.length > MAX_SORT) return bad("sort must list at most 4 entries");
    for (const s of raw.sort) {
      if (!isObject(s) || !onlyKeys(s, ["field", "dir"])) return bad("invalid sort entry");
      if (typeof s.field !== "string" || !known.has(s.field)) return bad("unknown sort field");
      if (s.dir !== "asc" && s.dir !== "desc") return bad("invalid sort direction");
      sortEntries.push({ field: s.field, dir: s.dir });
    }
  }

  if (!isInt(raw.pageNo, 1, MAX_PAGE_NO)) return bad("invalid pageNo");
  if (!isInt(raw.pageSize, 1, MAX_PAGE_SIZE)) return bad("invalid pageSize");
  const { pageNo, pageSize } = raw;

  const { filter, matchesNothing } = flattenConditions(conditions);
  // ItemId as `_id`, and `_id` as the tie-break: the gateway ignores a sort on ItemId (src/domain/gatewaySort.ts)
  const sort = gatewaySort(sortEntries);
  const input: Record<string, unknown> = {};
  if (filter !== undefined) input.filter = JSON.stringify(filter);
  if (sort !== undefined) input.sort = JSON.stringify(sort);
  input.pageNo = pageNo;
  input.pageSize = pageSize;

  const ws = conditions.find((c) => c.field === "WorkspaceId" && c.op === "eq");
  const workspaceId = ws && ws.op === "eq" && typeof ws.value === "string" ? ws.value : null;

  const member: BatchMember = { schema, fields, input };
  return { ok: true, read: { schema, fields, pageNo, pageSize, workspaceId, matchesNothing, member, key: batchKey(member) } };
}

export function validateDataRequest(body: unknown, catalog: S1Catalog): DataValidation {
  if (!isObject(body) || !onlyKeys(body, ["reads"])) return { ok: false, index: null, reason: "body must be exactly { reads }" };
  const list = body.reads;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_READS) return { ok: false, index: null, reason: "reads must list 1 to 40 reads" };
  const reads: ValidRead[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const r = validateRead(list[i], catalog);
    if (!r.ok) return { ok: false, index: i, reason: r.reason };
    reads.push(r.read);
  }
  return { ok: true, reads };
}

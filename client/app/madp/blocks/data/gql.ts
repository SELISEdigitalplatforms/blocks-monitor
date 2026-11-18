// SELISE Blocks data layer: typed GraphQL reads with an injection-safe where builder.
import { blocks } from "../client";
import { flattenConditions, type FilterCondition } from "../../domain/gatewayFilter";
import { gatewaySort } from "../../domain/gatewaySort";
import { BlocksDataError, MSG_GENERIC, fromGraphqlErrors, toBlocksError } from "./errors";
import { activeDataTransport, type DataRead, type DataTransport } from "./transport";

export type Scalar = string | number | boolean;
export type FieldOf<T> = Extract<keyof T, string>;

/** A typed, JSON-safe filter tree (it becomes part of TanStack query keys). */
export type Where<T = Record<string, unknown>> =
  | { readonly op: "eq"; readonly field: FieldOf<T>; readonly value: Scalar }
  | { readonly op: "in"; readonly field: FieldOf<T>; readonly values: readonly Scalar[] }
  | { readonly op: "and"; readonly clauses: readonly Where<T>[] };

/** Builder for a schema's where clauses. */
export function whereOf<T>(): {
  eq<K extends FieldOf<T>>(field: K, value: NonNullable<T[K]> & Scalar): Where<T>;
  in<K extends FieldOf<T>>(field: K, values: readonly (NonNullable<T[K]> & Scalar)[]): Where<T>;
  and(...clauses: (Where<T> | null | undefined | false)[]): Where<T>;
} {
  return {
    eq: (field, value) => ({ op: "eq", field, value }),
    in: (field, values) => ({ op: "in", field, values: [...values] }),
    and: (...clauses) => ({
      op: "and",
      clauses: clauses.filter((c): c is Where<T> => !!c),
    }),
  };
}

export interface SortSpec<T> {
  field: FieldOf<T>;
  dir?: "asc" | "desc";
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
const MAX_IN_VALUES = 500;
const DEFAULT_MAX_ITEMS = 1000;
const HARD_MAX_ITEMS = 5000;

const FIELD_NAME = /^[A-Z][A-Za-z0-9]*$/;
const GQL_FIELD = /^[_A-Za-z][_0-9A-Za-z]*$/;

/** Page size: default 50, floored, clamped to [1, 100] (the Data Gateway answers at most 100 rows per page, CON-07/C2). */
export function clampPageSize(n?: number): number {
  if (n === undefined || typeof n !== "number" || Number.isNaN(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(n)));
}

/** Page number: integer, at least 1, default 1. */
export function clampPage(n?: number): number {
  if (n === undefined || typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function checkField(field: unknown): string {
  if (typeof field !== "string" || !FIELD_NAME.test(field)) throw new TypeError("Invalid field name");
  return field;
}

function checkValue(value: unknown): Scalar {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError("Invalid filter value");
}

type Compiled = { filter: Record<string, unknown> | undefined; matchesNothing: boolean };

function collect(where: Where<any>, out: FilterCondition[]): void {
  switch (where.op) {
    case "eq":
      out.push({ field: checkField(where.field), op: "eq", value: checkValue(where.value) });
      return;
    case "in": {
      const field = checkField(where.field);
      if (!Array.isArray(where.values)) throw new TypeError("Invalid filter value");
      if (where.values.length > MAX_IN_VALUES) throw new TypeError("Too many filter values");
      out.push({ field, op: "in", values: where.values.map(checkValue) });
      return;
    }
    case "and":
      for (const clause of where.clauses) collect(clause, out);
      return;
    default:
      throw new TypeError("Invalid filter value");
  }
}

/** Compile a where tree to the gateway's flat JSON filter (the operator spellings live in src/domain/gatewayFilter.ts). */
export function compileWhere(where?: Where<any>): Compiled {
  if (!where) return { filter: undefined, matchesNothing: false };
  const conds: FilterCondition[] = [];
  collect(where, conds);
  return flattenConditions(conds);
}

/** Compile a sort list (src/domain/gatewaySort.ts): ItemId is written as the gateway's `_id`, and `_id` is appended as
 *  the tie-break (the gateway ignores a sort on ItemId, so pages tied on the sort overlapped). */
export function compileSort(sort?: readonly SortSpec<any>[]): Record<string, 1 | -1> | undefined {
  if (!sort || sort.length === 0) return undefined;
  return gatewaySort(sort.map((s) => ({ field: checkField(s.field), dir: s.dir })));
}

/** The list query text for a schema; it never holds a filter or sort value. */
export function buildListQuery(schema: string, fields: readonly string[]): { operationName: string; query: string } {
  if (!FIELD_NAME.test(schema)) throw new TypeError("Invalid schema name");
  for (const f of fields) if (!GQL_FIELD.test(f)) throw new TypeError("Invalid field name");
  const selection = ["ItemId", ...fields.filter((f) => f !== "ItemId")];
  const unique = [...new Set(selection)];
  const name = `get${schema}s`;
  return {
    operationName: name,
    query: `query ${name}($input: DynamicQueryInput) { ${name}(input: $input) { items { ${unique.join(" ")} } totalCount pageNo pageSize totalPages hasNextPage } }`,
  };
}

export interface PageParams<T> {
  fields: readonly FieldOf<T>[];
  where?: Where<T>;
  sort?: readonly SortSpec<T>[];
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One page of a schema's records. */
export async function queryPage<T>(schema: string, params: PageParams<T>): Promise<Page<T>> {
  const { operationName, query } = buildListQuery(schema, params.fields);
  const conds: FilterCondition[] = [];
  if (params.where) collect(params.where, conds);
  const { filter, matchesNothing } = flattenConditions(conds);
  const sort = compileSort(params.sort);
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  if (matchesNothing) return { items: [], totalCount: 0, page, pageSize, hasNextPage: false };

  const transport = activeDataTransport();
  if (transport) return readViaTransport<T>(transport, schema, params, conds, page, pageSize);

  let body: unknown;
  try {
    body = await blocks.data.graphql({
      operationName,
      query,
      variables: {
        input: {
          filter: filter && JSON.stringify(filter),
          sort: sort && JSON.stringify(sort),
          pageNo: page,
          pageSize,
        },
      },
    });
  } catch (e) {
    throw toBlocksError(e);
  }

  const root = isObject(body) ? body : {};
  if (Array.isArray(root.errors) && root.errors.length > 0) throw fromGraphqlErrors(root.errors);
  const data = isObject(root.data) ? root.data : undefined;
  const result = data && isObject(data[operationName]) ? (data[operationName] as Record<string, unknown>) : undefined;
  if (!result || !Array.isArray(result.items)) throw new BlocksDataError("unknown", MSG_GENERIC);

  const items = result.items.filter(isObject) as T[];
  const totalCount = typeof result.totalCount === "number" ? result.totalCount : items.length;
  const outPage = typeof result.pageNo === "number" ? result.pageNo : page;
  const hasNextPage = typeof result.hasNextPage === "boolean" ? result.hasNextPage : page * pageSize < totalCount;
  return { items, totalCount, page: outPage, pageSize, hasNextPage };
}

/** The read goes to this app's /api/data (the server runs it with the person's own token). */
async function readViaTransport<T>(
  transport: DataTransport,
  schema: string,
  params: PageParams<T>,
  conds: FilterCondition[],
  page: number,
  pageSize: number,
): Promise<Page<T>> {
  const sort = (params.sort ?? []).map((s) => ({ field: checkField(s.field), dir: s.dir ?? ("asc" as const) }));
  const read: DataRead = {
    schema,
    fields: [...new Set(["ItemId", ...params.fields])],
    ...(conds.length > 0 ? { filter: conds } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    pageNo: page,
    pageSize,
  };
  let res;
  try {
    res = await transport.read(read);
  } catch (e) {
    throw toBlocksError(e);
  }
  const items = res.items.filter(isObject) as T[];
  return { items, totalCount: res.totalCount, page: res.pageNo, pageSize, hasNextPage: res.hasNextPage };
}

export interface ListResult<T> {
  items: T[];
  totalCount: number;
  capped: boolean;
}

/** All records matching the params, following pages up to maxItems (default 1000, cap 5000); says when the list was capped.
 *  Every row comes once. Pages are read by position: when rows are added between two page reads (a build writing its
 *  ticket events while the page loads) or rows tie on the sort, a row can come back on the next page while another is
 *  skipped. A repeated row is kept once (by ItemId); when that leaves fewer rows than the list holds, the pages are read
 *  once more, the missing rows added, and the list put back in the asked order. */
export async function queryListResult<T>(
  schema: string,
  params: Omit<PageParams<T>, "page"> & { maxItems?: number; expectedCount?: number },
): Promise<ListResult<T>> {
  const { maxItems, expectedCount, ...rest } = params;
  const cap = Math.min(HARD_MAX_ITEMS, Math.max(1, Math.floor(maxItems ?? DEFAULT_MAX_ITEMS)));
  const items: T[] = [];
  const seen = new Set<string>();
  const first = await readPages<T>(schema, rest, cap, expectedCount);
  addUnique(items, seen, first.items);
  const expected = Math.min(cap, first.totalCount);
  if (first.pages > 1 && items.length < expected) {
    const again = await readPages<T>(schema, rest, cap, first.totalCount);
    addUnique(items, seen, again.items);
    if (rest.sort && rest.sort.length > 0) items.sort(compareBySort(rest.sort));
  }
  return finishList(items, cap, first.totalCount, first.lastHasNext);
}

/** One pass over the pages (as the gateway returns them, repeats included). `expected`: how many rows the list held when
 *  it was last read; through the batched transport its pages are asked together with the first one (one request for a
 *  list read again), and only pages beyond them wait for the first page's count. */
async function readPages<T>(
  schema: string,
  rest: Omit<PageParams<T>, "page">,
  cap: number,
  expected?: number,
): Promise<{ items: T[]; totalCount: number; lastHasNext: boolean; pages: number }> {
  const items: T[] = [];
  let totalCount = 0;
  let lastHasNext = false;
  let pages = 0;
  if (activeDataTransport()) {
    const pageSize = clampPageSize(rest.pageSize);
    const maxPages = Math.ceil(cap / pageSize);
    const known = typeof expected === "number" && Number.isFinite(expected) && expected > 0 ? Math.ceil(expected / pageSize) : 1;
    // Same tick: the first page and every page the list had last time share one request.
    const wave = Math.max(1, Math.min(maxPages, known));
    const firstWave = await Promise.all(Array.from({ length: wave }, (_, i) => queryPage<T>(schema, { ...rest, page: i + 1 })));
    const head = firstWave[0]!;
    totalCount = head.totalCount;
    const lastPage = Math.min(maxPages, Math.ceil(head.totalCount / pageSize));
    // Same tick: every page the first one says is there beyond those (up to the cap) shares one more request.
    const more = head.hasNextPage && head.items.length > 0 && lastPage > wave
      ? await Promise.all(Array.from({ length: lastPage - wave }, (_, i) => queryPage<T>(schema, { ...rest, page: wave + i + 1 })))
      : [];
    for (const res of [...firstWave, ...more]) {
      pages += 1;
      lastHasNext = res.hasNextPage;
      items.push(...res.items);
      if (!res.hasNextPage || res.items.length === 0) break;
    }
    return { items, totalCount, lastHasNext, pages };
  }
  for (let page = 1; items.length < cap; page++) {
    const res = await queryPage<T>(schema, { ...rest, page });
    pages = page;
    if (page === 1) totalCount = res.totalCount;
    lastHasNext = res.hasNextPage;
    items.push(...res.items);
    if (!res.hasNextPage || res.items.length === 0) break;
  }
  return { items, totalCount, lastHasNext, pages };
}

/** Appends the rows whose ItemId was not read yet (a row without one is always kept). */
export function addUnique<T>(items: T[], seen: Set<string>, rows: readonly T[]): void {
  for (const r of rows) {
    const id = (r as { ItemId?: unknown }).ItemId;
    if (typeof id === "string" && id !== "") {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    items.push(r);
  }
}

/** The asked order on the client (the gateway's: each field in turn, then ItemId; numbers by value, the rest by their
 *  text, empty first), for a list whose missing rows were added after a second read. */
export function compareBySort<T>(sort: readonly SortSpec<T>[]): (a: T, b: T) => number {
  const keys = [...sort.map((s) => ({ field: s.field as string, dir: s.dir === "desc" ? -1 : 1 })), { field: "ItemId", dir: 1 }];
  return (a, b) => {
    for (const k of keys) {
      const x = (a as Record<string, unknown>)[k.field];
      const y = (b as Record<string, unknown>)[k.field];
      if (x === y) continue;
      const c = typeof x === "number" && typeof y === "number" ? x - y : x == null ? -1 : y == null ? 1 : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
      if (c !== 0) return c * k.dir;
    }
    return 0;
  };
}

function finishList<T>(items: T[], cap: number, firstTotal: number, lastHasNext: boolean): ListResult<T> {
  const fetched = items.length;
  return {
    items: items.slice(0, cap),
    totalCount: Math.max(firstTotal, fetched),
    capped: fetched > cap || (fetched >= cap && lastHasNext),
  };
}

/** All records matching the params, following pages up to maxItems (default 1000, cap 5000). */
export async function queryList<T>(
  schema: string,
  params: Omit<PageParams<T>, "page"> & { maxItems?: number; expectedCount?: number },
): Promise<T[]> {
  return (await queryListResult<T>(schema, params)).items;
}

/** One record by ItemId, or null. */
export async function queryById<T>(schema: string, id: string, fields: readonly FieldOf<T>[]): Promise<T | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) throw new TypeError("Invalid id");
  const where = { op: "eq", field: "ItemId", value: id } as unknown as Where<T>;
  const res = await queryPage<T>(schema, { fields, where, pageSize: 1 });
  return res.items[0] ?? null;
}

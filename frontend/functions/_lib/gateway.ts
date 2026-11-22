// The raw data gateway, as the service identity, through the official SDK only (data.collection(...) and
// data.graphql). No caller scoping happens here: that is the scoped gateway's job. Logs nothing, and no
// OpError carries server text.
import type { FnEnv } from "./env";
import { batchKey, buildBatchQuery, createCoalescer, MAX_BATCH_ROOTS, splitBatchAnswer } from "./batch";
import { currentCallSignal, withCallSignal } from "./deadline";
import { OpError } from "./errors";
import { FIELD_NAME, type Filter, isEmptyFilter, isFilter, toGatewayFilter } from "./filter";
import { gatewaySort } from "../../src/domain/gatewaySort";
import type { SdkClient, SdkFactory } from "./sdk";
import { serviceClient, type TokenProvider } from "./serviceToken";

export type Row = Record<string, unknown>;

export interface FindOptions {
  where: Filter;
  fields: readonly string[];
  sort?: { field: string; dir: "asc" | "desc" };
  page?: number;
  pageSize?: number;
}

export interface RawGateway {
  get(schema: string, itemId: string, fields: readonly string[]): Promise<Row | null>;
  find(schema: string, opts: FindOptions): Promise<{ items: Row[]; totalCount: number | null }>;
  findAll(schema: string, opts: Omit<FindOptions, "page" | "pageSize"> & { max?: number }): Promise<Row[]>;
  insert(schema: string, row: Row): Promise<{ created: boolean; itemId: string | null }>;
  insertMany(schema: string, rows: Row[]): Promise<{ created: number; existing: number }>;
  update(schema: string, itemId: string, patch: Row): Promise<void>;
  updateMany(schema: string, where: Filter, patch: Row): Promise<{ matched: number | null }>;
  remove(schema: string, itemId: string): Promise<void>;
}

type DuplicateAs = "marker" | "conflict" | "none";

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const DUPLICATE = /duplicate|E11000|already exists/i;
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

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

function bodyText(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    try {
      return JSON.stringify((error as { body: unknown }).body) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

function gatewayErrorText(body: unknown): string | null {
  const errors = body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors.map((e) => String((e as { message?: unknown } | null)?.message ?? "")).join("\n");
}

/** Internal marker for a unique-key hit on insert; never leaves this module. */
class Duplicate extends Error {}

/** Wording of a gateway answer that means "try again later" (5xx, timeouts, resets, throttling), never a defect of the request. */
const TRANSIENT_TEXT = /\b(5\d\d|408|429)\b|time(d)?[ -]?out|unavailable|temporar|overload|too many requests|rate limit|econn|etimedout|epipe|eai_again|socket|network|reset|bad gateway|try again/i;
const TRANSIENT_CODE = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_[A-Z_]+)$/;

/** `internal` that keeps the original failure as `cause`, so the router can log its class and code (never its message). */
function internal(cause: unknown): OpError {
  const e = new OpError("internal");
  (e as { cause?: unknown }).cause = cause;
  return e;
}

function mapError(error: unknown, duplicateAs: DuplicateAs): Error {
  // Argument validation happens before run(), so a TypeError in here is the SDK's network failure.
  if (error instanceof OpError || error instanceof Duplicate) return error;
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") return new OpError("timeout");
  const status = statusOf(error);
  if (status === null) return new OpError("unavailable"); // network failure
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && TRANSIENT_CODE.test(code)) return new OpError("unavailable");
  if (status === 0 || status === 408 || status === 429 || status >= 500 || status === 401) return new OpError("unavailable");
  if (DUPLICATE.test(bodyText(error))) {
    if (duplicateAs === "marker") return new Duplicate();
    if (duplicateAs === "conflict") return new OpError("conflict");
  }
  return internal(error);
}

function checkBody(body: unknown, duplicateAs: DuplicateAs): void {
  const text = gatewayErrorText(body);
  if (text === null) return;
  if (DUPLICATE.test(text)) {
    if (duplicateAs === "marker") throw new Duplicate();
    if (duplicateAs === "conflict") throw new OpError("conflict");
  }
  if (TRANSIENT_TEXT.test(text)) throw new OpError("unavailable");
  throw internal(Object.assign(new Error("gateway errors: " + text), { name: "GatewayErrors", errorText: text }));
}

function mutationResult(body: unknown, field: string): { acknowledged: boolean; itemId: string | null; impacted: number | null } {
  const r = (body as { data?: Record<string, unknown> } | null)?.data?.[field] as
    | { acknowledged?: unknown; itemId?: unknown; totalImpactedData?: unknown }
    | undefined;
  return {
    acknowledged: r?.acknowledged === true,
    itemId: typeof r?.itemId === "string" && r.itemId ? r.itemId : null,
    impacted: typeof r?.totalImpactedData === "number" ? r.totalImpactedData : null,
  };
}

function listResult(body: unknown, schema: string): { items: Row[]; totalCount: number | null } {
  const r = (body as { data?: Record<string, unknown> } | null)?.data?.[`get${schema}s`] as { items?: unknown; totalCount?: unknown } | undefined;
  return {
    items: Array.isArray(r?.items) ? (r.items as Row[]) : [],
    totalCount: typeof r?.totalCount === "number" ? r.totalCount : null,
  };
}

export interface RequestInfo {
  kind: "read" | "batch" | "write";
  roots: number;
  ms: number;
}

type ReadResult = { items: Row[]; totalCount: number | null };

/** One read waiting for its flush: the single-call arguments, its own signal and its settle functions. */
interface ReadMember {
  schema: string;
  cols: string[];
  /** The exact DynamicQueryInput the single read sends. */
  input: Record<string, unknown>;
  itemId?: string;
  filter?: Record<string, unknown>;
  pageNo: number;
  pageSize: number;
  sort?: FindOptions["sort"];
  signal?: AbortSignal;
  settled(): boolean;
  ok(r: ReadResult): void;
  fail(e: unknown): void;
}

/** Aborts only when EVERY signal has aborted; a member without a signal keeps it from ever aborting. */
function allOfSignal(list: (AbortSignal | undefined)[]): AbortSignal | undefined {
  if (list.some((s) => !s)) return undefined;
  const all = list as AbortSignal[];
  const ctl = new AbortController();
  const check = (): void => {
    if (all.every((s) => s.aborted)) ctl.abort();
  };
  for (const s of all) if (!s.aborted) s.addEventListener("abort", check, { once: true });
  check();
  return ctl.signal;
}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

export function createRawGateway(deps: {
  env: FnEnv;
  sdk: SdkFactory;
  tokens: TokenProvider;
  fetch?: typeof fetch;
  batch?: false | { maxRoots?: number };
  onRequest?: (info: RequestInfo) => void;
}): RawGateway {
  // Every SDK client gets a fetch that also listens to the signal of the gateway call it runs in (deadline.ts).
  const sdk: SdkFactory = (o) => {
    const base = o.fetch ?? deps.fetch ?? globalThis.fetch;
    const fetchWithSignal = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const signal = currentCallSignal();
      if (!signal) return base(input, init);
      return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
    }) as typeof fetch;
    return deps.sdk({ ...o, fetch: fetchWithSignal });
  };
  const clientOf = serviceClient(deps.env, sdk, deps.tokens);

  /** Runs one SDK call; a 401 drops the cached token and retries the same call once. */
  async function run<T>(call: (client: SdkClient) => Promise<T>, duplicateAs: DuplicateAs = "none"): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const client = await clientOf();
        return await call(client);
      } catch (error) {
        if (statusOf(error) === 401 && attempt === 0) {
          deps.tokens.invalidate();
          continue;
        }
        throw mapError(error, duplicateAs);
      }
    }
  }

  /** Reports one HTTP request to onRequest (a throw inside it is swallowed). */
  function tracked<T>(kind: RequestInfo["kind"], roots: number, call: (client: SdkClient) => Promise<T>): (client: SdkClient) => Promise<T> {
    return async (client) => {
      const t0 = Date.now();
      try {
        return await call(client);
      } finally {
        try {
          deps.onRequest?.({ kind, roots, ms: Date.now() - t0 });
        } catch {
          /* a report must not change the outcome */
        }
      }
    };
  }

  /** The single read path (one collection call): the recorded contract. */
  async function singleRead(m: ReadMember): Promise<ReadResult> {
    const { schema, cols } = m;
    const body = await run(
      tracked("read", 1, (c) =>
        m.itemId !== undefined
          ? c.data.collection(schema).get(m.itemId, { fields: cols })
          : c.data.collection(schema).list({
              fields: cols,
              filter: m.filter ?? {},
              pageNo: m.pageNo,
              pageSize: m.pageSize,
              ...(m.sort ? { sort: gatewaySort([m.sort]) } : {}),
            }),
      ),
    );
    checkBody(body, "none");
    return listResult(body, schema);
  }

  function partError(errorText: string | null): OpError {
    if (errorText === null) return new OpError("internal");
    if (TRANSIENT_TEXT.test(errorText)) return new OpError("unavailable");
    return internal(Object.assign(new Error("gateway errors"), { name: "GatewayErrors" }));
  }

  async function flushReads(all: ReadMember[]): Promise<void> {
    const members = all.filter((m) => !m.settled());
    if (members.length === 0) return;
    const groups = new Map<string, ReadMember[]>();
    for (const m of members) {
      const key = batchKey({ schema: m.schema, input: m.input, fields: m.cols });
      const g = groups.get(key);
      if (g) g.push(m);
      else groups.set(key, [m]);
    }
    const reps = [...groups.values()];
    try {
      await withCallSignal(allOfSignal(members.map((m) => m.signal)), async () => {
        if (reps.length === 1) {
          const r = await singleRead(reps[0][0]);
          for (const m of reps[0]) m.ok({ items: [...r.items], totalCount: r.totalCount });
          return;
        }
        const roots = reps.length;
        const body = await run(
          tracked("batch", roots, (c) => c.data.graphql(buildBatchQuery(reps.map((g) => ({ schema: g[0].schema, input: g[0].input, fields: g[0].cols }))))),
        );
        const parts = splitBatchAnswer(body, roots);
        await Promise.all(reps.map(async (g, i) => {
          const part = parts[i];
          if (part.ok) {
            for (const m of g) m.ok({ items: [...part.items], totalCount: part.totalCount });
            return;
          }
          // Some Data Gateway deployments reject a GraphQL alias/query even though the equivalent
          // collection read is supported. Retry only failed aliases through the canonical SDK path.
          // This also keeps one bad root from failing unrelated reads in the same request.
          try {
            const fallback = await singleRead(g[0]);
            for (const m of g) m.ok({ items: [...fallback.items], totalCount: fallback.totalCount });
          } catch (error) {
            for (const m of g) m.fail(error instanceof OpError ? error : partError(part.errorText));
          }
        }));
      });
    } catch (error) {
      for (const m of members) m.fail(error);
    }
  }

  const coalescer = createCoalescer<ReadMember>({
    maxPerRequest: deps.batch === false ? 1 : Math.max(1, Math.min(deps.batch?.maxRoots ?? MAX_BATCH_ROOTS, MAX_BATCH_ROOTS)),
    flush: flushReads,
  });

  function readRows(
    spec: Pick<ReadMember, "schema" | "cols" | "input" | "itemId" | "filter" | "pageNo" | "pageSize" | "sort">,
  ): Promise<ReadResult> {
    const signal = currentCallSignal();
    return new Promise<ReadResult>((resolve, reject) => {
      let settled = false;
      let onAbort: (() => void) | undefined;
      const done = (): void => {
        settled = true;
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      };
      const m: ReadMember = {
        ...spec,
        signal,
        settled: () => settled,
        ok(r) {
          if (settled) return;
          done();
          resolve(r);
        },
        fail(e) {
          if (settled) return;
          done();
          reject(mapError(e, "none"));
        },
      };
      if (signal) {
        if (signal.aborted) return m.fail(abortError());
        onAbort = () => m.fail(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
      }
      coalescer.add(m);
    });
  }

  async function list(schema: string, filter: Record<string, unknown>, fields: string[], pageNo: number, pageSize: number, sort?: FindOptions["sort"]) {
    return readRows({
      schema,
      cols: fields,
      filter,
      pageNo,
      pageSize,
      sort,
      input: {
        filter: JSON.stringify(filter),
        pageNo,
        pageSize,
        // ItemId as `_id`, and `_id` as the tie-break: the gateway ignores a sort on ItemId (src/domain/gatewaySort.ts)
        ...(sort ? { sort: JSON.stringify(gatewaySort([sort])) } : {}),
      },
    });
  }

  const readBack = async (schema: string, requestKey: string): Promise<Row | null> =>
    (await list(schema, { RequestKey: requestKey }, ["ItemId", "RequestKey"], 1, 1)).items[0] ?? null;

  /** One insert without any read-back: true when created, false when the RequestKey already existed. */
  async function insertCounted(schema: string, row: Row): Promise<boolean> {
    try {
      const body = await run(tracked("write", 1, (c) => c.data.collection(schema).create(row)), "marker");
      checkBody(body, "marker");
      if (!mutationResult(body, `insert${schema}`).acknowledged) throw new OpError("internal");
      return true;
    } catch (error) {
      if (error instanceof Duplicate) return false;
      throw error;
    }
  }

  // The Data Gateway fails a share of calls at random (Factory DEV tenant, 03.11.2026: about 5 % "Unexpected Execution
  // Error", answered as internal), reads and writes alike. Each call is tried again twice with short pauses. Writes are
  // safe to repeat: an insert carries its RequestKey (unique: a repeat finds the row written the first time), a batch
  // that meets a duplicate is written row by row, and updates and removals set the same state again.
  async function retryRead<T>(read: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await read();
      } catch (e) {
        const code = e instanceof OpError ? e.code : "";
        if (attempt >= 2 || (code !== "internal" && code !== "unavailable")) throw e;
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.floor(Math.random() * 100)));
      }
    }
  }

  const gateway: RawGateway = {
    async get(schema, itemId, fields) {
      schemaName(schema);
      itemIdOf(itemId);
      const cols = fieldList(fields);
      const r = await retryRead(() => readRows({
        schema,
        cols,
        itemId,
        pageNo: 1,
        pageSize: 1,
        input: { filter: JSON.stringify({ ItemId: itemId }), pageNo: 1, pageSize: 1 },
      }));
      return r.items[0] ?? null;
    },

    async find(schema, opts) {
      schemaName(schema);
      if (!isFilter(opts.where)) throw new TypeError("where must be built with the filter builder");
      const cols = fieldList(opts.fields);
      if (opts.sort && !FIELD_NAME.test(opts.sort.field)) throw new TypeError("invalid sort field");
      const page = opts.page ?? 1;
      const size = opts.pageSize ?? PAGE_SIZE;
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > PAGE_SIZE) throw new TypeError("invalid paging");
      const where = toGatewayFilter(opts.where);
      if (where === null) return { items: [], totalCount: 0 };
      return retryRead(() => list(schema, where, cols, page, size, opts.sort));
    },

    async findAll(schema, opts) {
      const max = opts.max ?? DEFAULT_MAX;
      if (!Number.isInteger(max) || max < 1 || max > HARD_MAX) throw new TypeError("max must be between 1 and 5000");
      const out: Row[] = [];
      // Pages are read by position: a row written between two page reads moves the next page by one, so a row can come
      // back twice. Each ItemId is kept once (a row without one is always kept); the list ends at the first short page
      // or at the page that reaches the count.
      const seen = new Set<string>();
      for (let page = 1; ; page += 1) {
        const res = await gateway.find(schema, { where: opts.where, fields: opts.fields, sort: opts.sort, page, pageSize: PAGE_SIZE });
        for (const row of res.items) {
          const id = row.ItemId;
          if (typeof id === "string" && id !== "") {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          out.push(row);
        }
        if (out.length > max || (res.totalCount !== null && res.totalCount > max)) throw new OpError("limit_reached", "fn.tooManyRows");
        if (res.items.length < PAGE_SIZE) return out;
        if (res.totalCount !== null && (out.length >= res.totalCount || page * PAGE_SIZE >= res.totalCount)) return out;
      }
    },

    async insert(schema, row) {
      schemaName(schema);
      insertRow(row);
      const requestKey = row.RequestKey as string;
      try {
        const body = await run(tracked("write", 1, (c) => c.data.collection(schema).create(row)), "marker");
        checkBody(body, "marker");
        const res = mutationResult(body, `insert${schema}`);
        if (!res.acknowledged) throw new OpError("internal");
        if (res.itemId) return { created: true, itemId: res.itemId };
        const back = await readBack(schema, requestKey);
        return { created: true, itemId: typeof back?.ItemId === "string" ? back.ItemId : null };
      } catch (error) {
        if (!(error instanceof Duplicate)) throw error;
        const back = await readBack(schema, requestKey);
        return { created: false, itemId: typeof back?.ItemId === "string" ? back.ItemId : null };
      }
    },

    async insertMany(schema, rows) {
      schemaName(schema);
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_MANY) throw new TypeError("insertMany takes 1-100 rows");
      rows.forEach(insertRow);
      const name = `insertMany${schema}`;
      try {
        const body = await run(
          tracked("write", 1, (c) =>
            c.data.graphql({
              operationName: name,
              query: `mutation ${name}($input: [${schema}InsertInput!]!) {
  ${name}(input: $input) {
    acknowledged
    message
    totalImpactedData
  }
}`,
              variables: { input: rows },
            }),
          ),
          "marker",
        );
        checkBody(body, "marker");
        if (!mutationResult(body, name).acknowledged) throw new OpError("internal");
        return { created: rows.length, existing: 0 };
      } catch (error) {
        if (!(error instanceof Duplicate)) throw error;
      }
      // The batch hit a duplicate: write the rows one by one, all at once (one round), counting only.
      const flags = await Promise.all(rows.map((row) => insertCounted(schema, row)));
      const created = flags.filter(Boolean).length;
      return { created, existing: rows.length - created };
    },

    async update(schema, itemId, patch) {
      schemaName(schema);
      itemIdOf(itemId);
      patchOf(patch);
      const body = await run(tracked("write", 1, (c) => c.data.collection(schema).update(itemId, patch)), "conflict");
      checkBody(body, "conflict");
      if (!mutationResult(body, `update${schema}`).acknowledged) throw new OpError("internal");
    },

    async updateMany(schema, where, patch) {
      schemaName(schema);
      if (isEmptyFilter(where)) throw new TypeError("updateMany needs a non-empty filter");
      patchOf(patch);
      const flat = toGatewayFilter(where);
      if (flat === null) return { matched: 0 };
      const name = `updateMany${schema}`;
      const body = await run(
        tracked("write", 1, (c) =>
          c.data.graphql({
            operationName: name,
            query: `mutation ${name}($filter: String, $input: ${schema}UpdateInput!) {
  ${name}(filter: $filter, input: $input) {
    acknowledged
    message
    totalImpactedData
  }
}`,
            variables: { filter: JSON.stringify(flat), input: patch },
          }),
        ),
        "conflict",
      );
      checkBody(body, "conflict");
      const res = mutationResult(body, name);
      if (!res.acknowledged) throw new OpError("internal");
      return { matched: res.impacted };
    },

    async remove(schema, itemId) {
      schemaName(schema);
      itemIdOf(itemId);
      const body = await run(tracked("write", 1, (c) => c.data.collection(schema).delete(itemId, { hardDelete: true })));
      checkBody(body, "none");
      if (!mutationResult(body, `delete${schema}`).acknowledged) throw new OpError("internal");
    },
  };
  for (const method of ["insert", "insertMany", "update", "updateMany", "remove"] as const) {
    const write = gateway[method] as (...args: unknown[]) => Promise<unknown>;
    (gateway as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method] = (...args: unknown[]) => retryRead(() => write.apply(gateway, args));
  }
  return gateway;
}

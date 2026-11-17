// Test kit only (never imported by production code): a fake SdkClient over an in-memory store that answers the
// recorded Data Gateway shapes (single list/get, the multi-root `query batch`, insert/update/delete, insertMany and
// updateMany) and counts every SDK call as one HTTP request.
import { currentCallSignal } from "../deadline";
import type { SdkFactory } from "../sdk";
import { wireMatches } from "./gatewaySemantics";

type Row = Record<string, unknown>;

export interface WireCall {
  kind: "list" | "get" | "create" | "update" | "delete" | "graphql";
  schema?: string;
  operationName?: string;
  roots: number;
  mutation: boolean;
}

export interface SdkWire {
  sdk: SdkFactory;
  requests(): number;
  calls(): WireCall[];
  reset(): void;
  seed(schema: string, rows: Row[]): void;
  rows(schema: string): Row[];
  failNext(m: { alias?: string; schema?: string; status?: number; message?: string }): void;
  hold(m: { schema?: string } | null): void;
  release(): void;
}

class WireHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown = {},
  ) {
    super(`HTTP ${status}`);
  }
}

interface Root {
  alias: string;
  schema: string;
  input: Record<string, unknown>;
  fields: string[];
}

export function createSdkWire(o: { seed?: Record<string, Row[]> } = {}): SdkWire {
  const store = new Map<string, Row[]>();
  let log: WireCall[] = [];
  let count = 0;
  let nextId = 1;
  let failures: Array<{ alias?: string; schema?: string; status?: number; message?: string }> = [];
  let holding: { schema?: string } | null = null;
  let waiting: Array<() => void> = [];

  const table = (schema: string): Row[] => {
    let t = store.get(schema);
    if (!t) store.set(schema, (t = []));
    return t;
  };
  const seed = (schema: string, rows: Row[]): void => {
    for (const r of rows) table(schema).push({ ItemId: `seed${nextId++}`, ...r });
  };
  for (const [schema, rows] of Object.entries(o.seed ?? {})) seed(schema, rows);

  const pick = (row: Row, fields: readonly string[]): Row => {
    const out: Row = { ItemId: row.ItemId };
    for (const f of fields) out[f] = row[f];
    return out;
  };

  function queryRows(schema: string, input: Record<string, unknown>, fields: readonly string[]) {
    const filter = typeof input.filter === "string" ? (JSON.parse(input.filter) as Record<string, unknown>) : {};
    let rows = table(schema).filter((r) => wireMatches(filter, r));
    if (typeof input.sort === "string") {
      const sort = JSON.parse(input.sort) as Record<string, number>;
      for (const [field, dir] of Object.entries(sort).reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = a[field] as never;
          const y = b[field] as never;
          return (x < y ? -1 : x > y ? 1 : 0) * dir;
        });
      }
    }
    const pageNo = typeof input.pageNo === "number" ? input.pageNo : 1;
    const pageSize = typeof input.pageSize === "number" ? input.pageSize : 20;
    const slice = rows.slice((pageNo - 1) * pageSize, pageNo * pageSize);
    return { items: slice.map((r) => pick(r, fields)), totalCount: rows.length, pageNo, pageSize };
  }

  const matches = (m: { schema?: string } | null | undefined, schemas: string[]): boolean => !m || m.schema === undefined || schemas.includes(m.schema);

  /** Counts the request, applies hold() and failNext(), then answers. */
  async function request(call: WireCall, schemas: string[], answer: (failure: { alias?: string; message?: string } | null) => unknown): Promise<unknown> {
    count += 1;
    log.push(call);
    if (matches(holding, schemas) && holding) {
      const signal = currentCallSignal();
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        const go = (): void => resolve();
        waiting.push(go);
        signal?.addEventListener(
          "abort",
          () => {
            waiting = waiting.filter((w) => w !== go);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    }
    const at = failures.findIndex((f) => matches(f, schemas) && (!f.alias || call.roots > 1));
    let failure: { alias?: string; status?: number; message?: string } | null = null;
    if (at >= 0) {
      failure = failures[at];
      failures.splice(at, 1);
      if (failure.status !== undefined) throw new WireHttpError(failure.status, { errors: [{ message: failure.message ?? "failure" }] });
    }
    return answer(failure);
  }

  function listBody(schema: string, input: Record<string, unknown>, fields: readonly string[], failure: { message?: string } | null) {
    if (failure) return { errors: [{ message: failure.message ?? "internal error" }] };
    return { data: { [`get${schema}s`]: queryRows(schema, input, fields) } };
  }

  const fieldsOf = (fields?: readonly string[]): string[] => (fields?.length ? [...fields] : []);

  function parseRoots(query: string, variables: Record<string, unknown>): Root[] {
    const roots: Root[] = [];
    const re = /(q\d+): get([A-Za-z0-9]+)s\(input: \$(input\d+)\) \{ items \{ ([^}]*) \}/g;
    for (let m = re.exec(query); m; m = re.exec(query)) {
      roots.push({
        alias: m[1],
        schema: m[2],
        input: variables[m[3]] as Record<string, unknown>,
        fields: m[4].trim().split(/\s+/),
      });
    }
    return roots;
  }

  const client = {
    auth: { oidc: { clientCredentials: async () => ({ access_token: "wire-token", expires_in: 3600 }) } },
    data: {
      collection: (schema: string) => ({
        list: (opts: { fields?: string[]; filter?: unknown; pageNo?: number; pageSize?: number; sort?: unknown }) =>
          request({ kind: "list", schema, roots: 1, mutation: false }, [schema], (failure) =>
            listBody(
              schema,
              {
                filter: typeof opts.filter === "string" ? opts.filter : opts.filter === undefined ? undefined : JSON.stringify(opts.filter),
                pageNo: opts.pageNo ?? 1,
                pageSize: opts.pageSize ?? 20,
                sort: typeof opts.sort === "string" ? opts.sort : opts.sort === undefined ? undefined : JSON.stringify(opts.sort),
              },
              fieldsOf(opts.fields),
              failure,
            ),
          ),
        get: (itemId: string, opts: { fields?: string[] } = {}) =>
          request({ kind: "get", schema, roots: 1, mutation: false }, [schema], (failure) =>
            listBody(schema, { filter: JSON.stringify({ ItemId: itemId }), pageNo: 1, pageSize: 1 }, fieldsOf(opts.fields), failure),
          ),
        create: (payload: Row) =>
          request({ kind: "create", schema, roots: 1, mutation: true }, [schema], (failure) => {
            if (failure) return { errors: [{ message: failure.message ?? "internal error" }] };
            const itemId = `id${nextId++}`;
            table(schema).push({ ItemId: itemId, ...payload });
            return { data: { [`insert${schema}`]: { acknowledged: true, itemId, message: null, totalImpactedData: 1 } } };
          }),
        update: (itemId: string, patch: Row) =>
          request({ kind: "update", schema, roots: 1, mutation: true }, [schema], (failure) => {
            if (failure) return { errors: [{ message: failure.message ?? "internal error" }] };
            const row = table(schema).find((r) => r.ItemId === itemId);
            if (row) Object.assign(row, patch);
            return { data: { [`update${schema}`]: { acknowledged: true, itemId, message: null, totalImpactedData: row ? 1 : 0 } } };
          }),
        delete: (itemId: string) =>
          request({ kind: "delete", schema, roots: 1, mutation: true }, [schema], (failure) => {
            if (failure) return { errors: [{ message: failure.message ?? "internal error" }] };
            const t = table(schema);
            const at = t.findIndex((r) => r.ItemId === itemId);
            if (at >= 0) t.splice(at, 1);
            return { data: { [`delete${schema}`]: { acknowledged: true, itemId, message: null, totalImpactedData: at >= 0 ? 1 : 0 } } };
          }),
      }),
      graphql: (req: { operationName?: string; query: string; variables?: Record<string, unknown> }) => {
        const vars = req.variables ?? {};
        const name = req.operationName ?? "";
        if (name === "batch") {
          const roots = parseRoots(req.query, vars);
          return request({ kind: "graphql", operationName: name, roots: roots.length, mutation: false }, roots.map((r) => r.schema), (failure) => {
            if (failure && !failure.alias) return { errors: [{ message: failure.message ?? "internal error" }] };
            const data: Record<string, unknown> = {};
            const errors: unknown[] = [];
            for (const r of roots) {
              if (failure?.alias === r.alias) {
                data[r.alias] = null;
                errors.push({ message: failure.message ?? "internal error", path: [r.alias] });
              } else data[r.alias] = queryRows(r.schema, r.input, r.fields);
            }
            return errors.length ? { data, errors } : { data };
          });
        }
        const many = /^(insertMany|updateMany)([A-Z][A-Za-z0-9]*)$/.exec(name);
        const schema = many?.[2] ?? "";
        return request({ kind: "graphql", schema: schema || undefined, operationName: name, roots: 1, mutation: true }, schema ? [schema] : [], (failure) => {
          if (failure || !many) return { errors: [{ message: failure?.message ?? "unsupported operation" }] };
          const t = table(schema);
          if (many[1] === "insertMany") {
            const rows = vars.input as Row[];
            if (rows.some((r) => r.RequestKey !== undefined && t.some((x) => x.RequestKey === r.RequestKey))) return { errors: [{ message: "E11000 duplicate key" }] };
            for (const r of rows) t.push({ ItemId: `id${nextId++}`, ...r });
            return { data: { [name]: { acknowledged: true, message: null, totalImpactedData: rows.length } } };
          }
          const filter = JSON.parse(String(vars.filter ?? "{}")) as Record<string, unknown>;
          const hit = t.filter((r) => wireMatches(filter, r));
          for (const r of hit) Object.assign(r, vars.input as Row);
          return { data: { [name]: { acknowledged: true, message: null, totalImpactedData: hit.length } } };
        });
      },
    },
  };

  return {
    sdk: (() => client) as unknown as SdkFactory,
    requests: () => count,
    calls: () => [...log],
    reset() {
      count = 0;
      log = [];
      failures = [];
      holding = null;
      waiting = [];
    },
    seed,
    rows: (schema) => table(schema).map((r) => ({ ...r })),
    failNext: (m) => void failures.push(m),
    hold: (m) => void (holding = m),
    release() {
      holding = null;
      const w = waiting;
      waiting = [];
      for (const go of w) go();
    },
  } satisfies SdkWire & { sdk: SdkFactory };
}

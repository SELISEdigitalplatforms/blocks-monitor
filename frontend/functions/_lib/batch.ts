// Read batching for the Data Gateway: several `get<Schema>s` roots in ONE GraphQL request. Pure (no SDK, no clock):
// the query builder, the answer splitter and the same-turn coalescer. Values travel in variables only.
import { FIELD_NAME } from "./filter";

export const MAX_BATCH_ROOTS = 20;

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

export interface BatchMember {
  schema: string;
  /** The exact DynamicQueryInput the single read sends (filter and sort as JSON strings). */
  input: Record<string, unknown>;
  fields: readonly string[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, stable(o[k])]),
    );
  }
  return value;
}

/** Identical members (same schema, input and field set) share one alias. */
export function batchKey(m: BatchMember): string {
  return JSON.stringify(stable({ schema: m.schema, input: m.input, fields: [...new Set(m.fields)].sort() }));
}

export function buildBatchQuery(members: readonly BatchMember[]): { operationName: "batch"; query: string; variables: Record<string, unknown> } {
  if (members.length === 0) throw new TypeError("a batch needs at least one member");
  const decls: string[] = [];
  const roots: string[] = [];
  const variables: Record<string, unknown> = {};
  members.forEach((m, i) => {
    if (typeof m.schema !== "string" || !SCHEMA_NAME.test(m.schema)) throw new TypeError("invalid schema name");
    for (const f of m.fields) if (typeof f !== "string" || !FIELD_NAME.test(f)) throw new TypeError("invalid field name");
    const cols = [...new Set(["ItemId", ...m.fields])];
    decls.push(`$input${i}: DynamicQueryInput`);
    roots.push(`  q${i}: get${m.schema}s(input: $input${i}) { items { ${cols.join(" ")} } totalCount }`);
    variables[`input${i}`] = m.input;
  });
  return { operationName: "batch", query: `query batch(${decls.join(", ")}) {\n${roots.join("\n")}\n}`, variables };
}

export type BatchPart = { ok: true; items: Record<string, unknown>[]; totalCount: number | null } | { ok: false; errorText: string | null };

export function splitBatchAnswer(body: unknown, n: number): BatchPart[] {
  const root = body && typeof body === "object" ? (body as { data?: unknown; errors?: unknown }) : {};
  const errors = Array.isArray(root.errors) ? (root.errors as unknown[]) : [];
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
  const textOf = (list: unknown[]): string => list.map((e) => String((e as { message?: unknown } | null)?.message ?? "")).join("\n");
  const aliasOf = (e: unknown): string | null => {
    const p = (e as { path?: unknown } | null)?.path;
    return Array.isArray(p) && typeof p[0] === "string" ? p[0] : null;
  };
  const named = new Set<string>();
  const global: unknown[] = [];
  for (const e of errors) {
    const a = aliasOf(e);
    if (a !== null && /^q\d+$/.test(a)) named.add(a);
    else global.push(e);
  }
  const out: BatchPart[] = [];
  for (let i = 0; i < n; i += 1) {
    const alias = `q${i}`;
    if (global.length > 0) {
      out.push({ ok: false, errorText: textOf(global) });
      continue;
    }
    if (named.has(alias)) {
      out.push({ ok: false, errorText: textOf(errors.filter((e) => aliasOf(e) === alias)) });
      continue;
    }
    const r = data[alias];
    if (!r || typeof r !== "object") {
      out.push({ ok: false, errorText: null });
      continue;
    }
    const { items, totalCount } = r as { items?: unknown; totalCount?: unknown };
    out.push({
      ok: true,
      items: Array.isArray(items) ? (items as Record<string, unknown>[]) : [],
      totalCount: typeof totalCount === "number" ? totalCount : null,
    });
  }
  return out;
}

/**
 * Collects members added in the same turn and flushes them together. The default scheduler (setImmediate) runs after
 * the microtask queue drains, so reads started in microtask chains share one flush. A full batch is cut at once.
 */
export function createCoalescer<M, R = void>(o: {
  maxPerRequest: number;
  schedule?: (fn: () => void) => void;
  flush(members: M[]): Promise<void>;
}): { add(member: M): void } {
  void (undefined as R | undefined);
  const schedule = o.schedule ?? ((fn: () => void) => (typeof setImmediate === "function" ? void setImmediate(fn) : void setTimeout(fn, 0)));
  let open: M[] = [];
  const cut = (batch: M[]): void => {
    o.flush(batch).catch(() => {
      /* the flush settles its own members */
    });
  };
  return {
    add(member) {
      open.push(member);
      if (open.length >= o.maxPerRequest) {
        const full = open;
        open = [];
        cut(full);
        return;
      }
      if (open.length === 1) {
        const mine = open;
        schedule(() => {
          if (open !== mine) return; // already cut because it filled up
          open = [];
          cut(mine);
        });
      }
    },
  };
}

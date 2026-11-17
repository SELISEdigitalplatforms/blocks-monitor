// The caller-scoped gateway (deps.gw) and the service gateway (deps.svc).
// Both stamp RequestKey on every insert and refuse writes to the router-owned
// schemas; deps.gw also stamps and enforces the workspace ACL.
import { OpError } from "./errors";
import { ROUTED_SCHEMAS } from "./fields";
import { f, isEmptyFilter, type Filter } from "./filter";
import type { RawGateway, Row } from "./gateway";
import { requestKey } from "./ids";

export interface GwScope {
  fn: string;
  op: string;
  requestId: string;
  kind: "command" | "view";
  workspaceId: string | null;
  callerUserId: string;
  aclSchemas: ReadonlySet<string>;
  readerIds(): Promise<readonly string[]>;
}

export interface InsertOpts {
  /** Distinguishes inserts of one command; pass it whenever inserts run concurrently. */
  key?: string | number;
  /** Absolute RequestKey from a deps.ids helper (1-200 characters). */
  requestKey?: string;
  /** For ops without a workspace in scope (workspace.create, the engine). */
  acl?: { workspaceId: string; readerIds: readonly string[] };
}

export interface ScopedGateway {
  get: RawGateway["get"];
  find: RawGateway["find"];
  findAll: RawGateway["findAll"];
  insert(schema: string, row: Row, opts?: InsertOpts): ReturnType<RawGateway["insert"]>;
  insertMany(
    schema: string,
    rows: Row[],
    opts?: { keys?: (string | number)[]; acl?: InsertOpts["acl"] },
  ): ReturnType<RawGateway["insertMany"]>;
  update: RawGateway["update"];
  updateMany: RawGateway["updateMany"];
  /** `rowRead`: the row was just read through this same scope (a cascade page), so the ownership read is skipped. */
  remove(schema: string, id: string, opts?: { rowRead?: boolean }): ReturnType<RawGateway["remove"]>;
}

const ROUTED = new Set<string>(ROUTED_SCHEMAS as Iterable<string>);
const ACL_LOCKED = ["WorkspaceId", "ReaderIds", "CreatedByUserId"];

function internal(): OpError {
  return new OpError("internal");
}

function checkPatch(patch: Row): void {
  for (const v of Object.values(patch)) {
    if (v === null || v === undefined) throw internal(); // the gateway ignores null (MF-B14)
  }
}

interface Common {
  guardWrite(schema: string, o?: { update?: boolean }): void;
  keyFor(opts: { key?: string | number; requestKey?: string } | undefined, nth?: string | number): string;
  unkeyed(): number;
}

function common(base: { fn: string; op: string; requestId: string; kind: "command" | "view" }): Common {
  let counter = 0;
  return {
    guardWrite(schema, o) {
      if (base.kind === "view") throw internal();
      // Notification rows are inserted by the router only, but the recipient's read flag is updated by the ops.
      if (ROUTED.has(schema) && !(o?.update && schema === "Notification")) throw internal();
    },
    unkeyed() {
      counter += 1;
      return counter;
    },
    keyFor(opts, nth) {
      if (opts?.requestKey !== undefined) {
        if (opts.requestKey.length < 1 || opts.requestKey.length > 200) throw internal();
        return opts.requestKey;
      }
      const suffix = nth ?? opts?.key;
      return requestKey(base.fn, base.op, base.requestId, suffix !== undefined ? String(suffix) : "#" + counter);
    },
  };
}

function plainWhere(where: Filter): void {
  if (isEmptyFilter(where)) throw internal();
}

function build(
  raw: RawGateway,
  base: { fn: string; op: string; requestId: string; kind: "command" | "view" },
  scope: GwScope | null,
): ScopedGateway {
  const c = common(base);
  const isAcl = (schema: string): boolean => !!scope && scope.aclSchemas.has(schema);

  const wsOf = (): string => {
    if (!scope?.workspaceId) throw internal();
    return scope.workspaceId;
  };
  const scoped = (schema: string, where: Filter): Filter =>
    isAcl(schema) ? f.and(where, f.eq("WorkspaceId", wsOf())) : where;

  async function aclStamp(row: Row, acl: InsertOpts["acl"]): Promise<Row> {
    const ws = acl?.workspaceId ?? scope?.workspaceId ?? null;
    if (!ws) throw internal();
    if (acl && scope?.workspaceId && acl.workspaceId !== scope.workspaceId) throw internal();
    if (row.WorkspaceId !== undefined && row.WorkspaceId !== null && row.WorkspaceId !== ws) throw internal();
    const readers = [...(acl ? acl.readerIds : await scope!.readerIds())].sort();
    return {
      ...row,
      WorkspaceId: ws,
      ReaderIds: readers,
      CreatedByUserId: scope!.callerUserId,
      UpdatedByUserId: scope!.callerUserId,
    };
  }

  async function prepare(schema: string, row: Row, opts: InsertOpts | undefined, nth?: string | number): Promise<Row> {
    c.guardWrite(schema);
    const key = c.keyFor(opts, nth);
    const out = isAcl(schema) ? await aclStamp(row, opts?.acl) : { ...row };
    delete (out as Row).ItemId;
    out.RequestKey = key;
    return out;
  }

  function aclPatch(patch: Row): Row {
    checkPatch(patch);
    for (const k of ACL_LOCKED) if (k in patch) throw internal();
    return { ...patch, UpdatedByUserId: scope!.callerUserId };
  }

  return {
    async get(schema, id, fields) {
      if (!isAcl(schema)) return raw.get(schema, id, fields);
      const ws = wsOf();
      const r = await raw.find(schema, { where: f.and(f.eq("ItemId", id), f.eq("WorkspaceId", ws)), fields, page: 1, pageSize: 1 });
      return r.items[0] ?? null;
    },
    async find(schema, q) {
      return raw.find(schema, { ...q, where: scoped(schema, q.where) });
    },
    async findAll(schema, q) {
      return raw.findAll(schema, { ...q, where: scoped(schema, q.where) });
    },
    async insert(schema, row, opts) {
      if (!opts?.requestKey && opts?.key === undefined) c.unkeyed();
      const out = await prepare(schema, row, opts);
      return raw.insert(schema, out);
    },
    async insertMany(schema, rows, opts) {
      c.guardWrite(schema);
      const out: Row[] = [];
      for (let i = 0; i < rows.length; i++) {
        const k = opts?.keys?.[i];
        if (k === undefined) c.unkeyed();
        out.push(await prepare(schema, rows[i], { key: k, acl: opts?.acl }));
      }
      return raw.insertMany(schema, out);
    },
    async update(schema, id, patch) {
      c.guardWrite(schema, { update: true });
      if (!id) throw internal();
      if (!isAcl(schema)) {
        checkPatch(patch);
        return raw.update(schema, id, patch);
      }
      const p = aclPatch(patch);
      const r = await raw.updateMany(schema, f.and(f.eq("ItemId", id), f.eq("WorkspaceId", wsOf())), p);
      if (!r || r.matched === 0) throw new OpError("not_found");
    },
    async updateMany(schema, where, patch) {
      c.guardWrite(schema, { update: true });
      plainWhere(where);
      if (!isAcl(schema)) {
        checkPatch(patch);
        return raw.updateMany(schema, where, patch);
      }
      return raw.updateMany(schema, f.and(where, f.eq("WorkspaceId", wsOf())), aclPatch(patch));
    },
    async remove(schema, id, opts) {
      c.guardWrite(schema);
      if (!id) throw internal();
      if (isAcl(schema) && !opts?.rowRead) {
        const r = await this.get(schema, id, ["ItemId"]);
        if (!r) throw new OpError("not_found");
      }
      return raw.remove(schema, id);
    },
  };
}

/** The same gateway for reads; every write is refused. Prefetch runs on it, before the caller is known to be allowed. */
export function readOnlyGateway(raw: RawGateway): RawGateway {
  const refuse = (): Promise<never> => Promise.reject(internal());
  return {
    get: (schema, id, fields) => raw.get(schema, id, fields),
    find: (schema, q) => raw.find(schema, q),
    findAll: (schema, q) => raw.findAll(schema, q),
    insert: refuse,
    insertMany: refuse,
    update: refuse,
    updateMany: refuse,
    remove: refuse,
  };
}

export function createScopedGateway(raw: RawGateway, scope: GwScope): ScopedGateway {
  return build(raw, scope, scope);
}

export function createServiceGateway(
  raw: RawGateway,
  base: { fn: string; op: string; requestId: string; kind: "command" | "view" },
): ScopedGateway {
  return build(raw, base, null);
}

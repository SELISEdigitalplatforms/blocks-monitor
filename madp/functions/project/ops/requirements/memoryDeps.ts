/**
 * An in-memory LaneDeps for tests (not imported by any index.ts). It behaves
 * like the hosted gateway where it matters: an insert carrying ItemId throws,
 * unique indexes raise a duplicate-key error, every insert and update is
 * checked against the field rules, and ReaderIds are the active members.
 */
import type { FactoryNoteInput } from "../../../../src/domain/factoryNotes";
import type { RoleDef } from "../../../../src/domain/roles";
import {
  type FindOptions,
  handleWritesAudit,
  type LaneDeps,
  type LaneOp,
  type OpEnvelope,
  type PresignRequest,
  type Row,
  type ScopedGateway,
  type Where,
} from "./ports";
import { FIELD_RULES, type ValidationRule } from "./records";

type Action = "insert" | "update" | "remove";

export class MemoryDuplicateKeyError extends Error {
  constructor(schema: string, fields: readonly string[]) {
    super(`duplicate key on ${schema} (${fields.join(", ")})`);
    this.name = "MemoryDuplicateKeyError";
  }
}

export class MemoryValidationError extends Error {
  constructor(schema: string, field: string, kind: string) {
    super(`validation failed: ${schema}.${field} (${kind})`);
    this.name = "MemoryValidationError";
  }
}

const UNIQUE: Record<string, string[][]> = {
  ItemVersion: [["ProjectId", "ItemKey", "N"]],
  Objective: [["ProjectId"]],
  DesignBrief: [["ProjectId"]],
  Requirement: [["ProjectId", "Number"], ["ProjectId", "Key"]],
  Suggestion: [["ProjectId", "Key"]],
};

const STAMPED = ["ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId"];

/** Maps blocks/data/validations.json (the `schemas` object or the whole file) to ValidationRule[]; min/max are ignored. */
export function rulesFromValidations(json: unknown): ValidationRule[] {
  const root = json as { schemas?: Record<string, Record<string, Record<string, unknown>>> };
  const schemas = root.schemas ?? (json as Record<string, Record<string, Record<string, unknown>>>);
  const out: ValidationRule[] = [];
  for (const [schema, fields] of Object.entries(schemas)) {
    for (const [field, def] of Object.entries(fields)) {
      if (def.required === true) out.push({ schema, field, kind: "required" });
      if (Array.isArray(def.enum)) out.push({ schema, field, kind: "regex", value: `^(${(def.enum as string[]).join("|")})$` });
      if (typeof def.pattern === "string") out.push({ schema, field, kind: "regex", value: def.pattern });
      if (typeof def.maxLength === "number") out.push({ schema, field, kind: "maxLength", value: def.maxLength });
    }
  }
  return out;
}

export interface MemoryWorld {
  deps: LaneDeps;
  rows(schema: string): Row[];
  insertRaw(schema: string, row: Record<string, unknown>): Row;
  /** Inserts like the hosted gateway does: throws when the row carries an ItemId. */
  hostedInsert(schema: string, row: Record<string, unknown>): Row;
  writes: { schema: string; action: Action; row: Row }[];
  files: {
    presigned: PresignRequest[];
    removed: string[];
    setInfo(fileId: string, info: { sizeInBytes: number; contentType: string | null } | null): void;
    setHead(fileId: string, bytes: number[]): void;
  };
  jobs: { created: unknown[] };
  auditLog: unknown[];
  /** Notes the ops queued through deps.notify, in order. */
  notifications: FactoryNoteInput[];
  crashNext(match: { schema: string; action: Action }): void;
  setNow(d: Date): void;
}

function matches(row: Row, where: Where): boolean {
  for (const [k, v] of Object.entries(where)) {
    const x = row[k];
    if (v !== null && typeof v === "object") {
      if (!(v.in as readonly unknown[]).includes(x as never)) return false;
    } else if (v === null) {
      if (x !== null && x !== undefined) return false;
    } else if (x !== v) return false;
  }
  return true;
}

export function createMemoryWorld(opts?: { now?: Date; validations?: readonly ValidationRule[] }): MemoryWorld {
  let clock = opts?.now ?? new Date("2026-10-20T10:00:00.000Z");
  let seq = 0;
  const tables = new Map<string, Row[]>();
  const writes: MemoryWorld["writes"] = [];
  const crashes: { schema: string; action: Action }[] = [];
  const rules = [...FIELD_RULES, ...(opts?.validations ?? [])];
  const operations = new Map<string, { status: "pending" | "done" | "failed"; result: OpEnvelope | null }>();
  const jobs: MemoryWorld["jobs"] = { created: [] };
  const auditLog: unknown[] = [];
  const notifications: FactoryNoteInput[] = [];
  const presigned: PresignRequest[] = [];
  const removed: string[] = [];
  const infoMap = new Map<string, { sizeInBytes: number; contentType: string | null } | null>();
  const headMap = new Map<string, number[]>();
  let fileSeq = 0;

  const table = (s: string) => {
    let t = tables.get(s);
    if (!t) tables.set(s, (t = []));
    return t;
  };
  const clone = <T,>(v: T): T => structuredClone(v);

  const validate = (schema: string, row: Row) => {
    for (const r of rules) {
      if (r.schema !== schema) continue;
      const v = row[r.field];
      if (r.kind === "required") {
        if (v === undefined || v === null || v === "") throw new MemoryValidationError(schema, r.field, "required");
        continue;
      }
      if (v === undefined || v === null) continue;
      for (const x of Array.isArray(v) ? v : [v]) {
        if (r.kind === "maxLength" && typeof x === "string" && x.length > (r.value as number)) throw new MemoryValidationError(schema, r.field, "maxLength");
        if (r.kind === "regex" && !new RegExp(r.value as string).test(String(x))) throw new MemoryValidationError(schema, r.field, "regex");
      }
    }
  };

  const checkUnique = (schema: string, row: Row) => {
    for (const idx of UNIQUE[schema] ?? []) {
      if (idx.some((f) => row[f] === undefined || row[f] === null)) continue;
      const clash = table(schema).some((o) => o.ItemId !== row.ItemId && idx.every((f) => o[f] === row[f]));
      if (clash) throw new MemoryDuplicateKeyError(schema, idx);
    }
  };

  const record = (schema: string, action: Action, row: Row) => {
    writes.push({ schema, action, row: clone(row) });
    const i = crashes.findIndex((c) => c.schema === schema && c.action === action);
    if (i >= 0) {
      crashes.splice(i, 1);
      throw new Error("crash");
    }
  };

  const insertRaw = (schema: string, row: Record<string, unknown>): Row => {
    const full = { CreatedDate: clock.toISOString(), ...clone(row), ItemId: (row.ItemId as string) ?? `mem-${++seq}` } as Row;
    table(schema).push(full);
    return clone(full);
  };

  const hostedInsert = (schema: string, row: Record<string, unknown>): Row => {
    if ("ItemId" in row) throw new Error("gateway rejects a client-supplied ItemId");
    const full = { ...clone(row), ItemId: `mem-${++seq}`, CreatedDate: clock.toISOString() } as Row;
    validate(schema, full);
    checkUnique(schema, full);
    table(schema).push(full);
    record(schema, "insert", full);
    return clone(full);
  };

  const find = (schema: string, where: Where, o?: FindOptions): Row[] => {
    let out = table(schema).filter((r) => matches(r, where));
    if (o?.sort?.length) {
      out = out.slice().sort((a, b) => {
        for (const s of o.sort!) {
          const x = a[s.field] as never;
          const y = b[s.field] as never;
          if (x === y) continue;
          const c = x < y ? -1 : 1;
          return s.dir === "asc" ? c : -c;
        }
        return 0;
      });
    }
    if (o?.limit !== undefined) out = out.slice(0, o.limit);
    return out.map((r) => {
      if (!o?.fields) return clone(r);
      const p: Record<string, unknown> = { ItemId: r.ItemId };
      for (const f of o.fields) if (f in r) p[f] = clone(r[f]);
      return p as Row;
    });
  };

  const isDup = (e: unknown) => e instanceof MemoryDuplicateKeyError;

  const scoped = async (workspaceId: string, actor: string): Promise<ScopedGateway> => {
    const readerIds = table("Membership")
      .filter((m) => m.WorkspaceId === workspaceId && m.Status === "active")
      .map((m) => m.UserId as string);
    return {
      workspaceId,
      readerIds,
      find: async (schema, where, o) => find(schema, { ...where, WorkspaceId: workspaceId }, o),
      insert: async (schema, input) => {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input)) if (!STAMPED.includes(k)) clean[k] = v;
        return hostedInsert(schema, {
          ...clean,
          WorkspaceId: workspaceId,
          ReaderIds: [...readerIds],
          CreatedByUserId: actor,
          UpdatedByUserId: actor,
        });
      },
      update: async (schema, itemId, patch) => {
        const cur = table(schema).find((r) => r.ItemId === itemId);
        if (!cur || cur.WorkspaceId !== workspaceId) throw new Error("row not found in this workspace");
        const next = { ...cur } as Row;
        for (const [k, v] of Object.entries(patch)) if (!STAMPED.includes(k)) next[k] = clone(v);
        next.UpdatedByUserId = actor;
        validate(schema, next);
        checkUnique(schema, next);
        Object.assign(cur, next);
        record(schema, "update", cur);
        return clone(cur);
      },
      remove: async (schema, itemId) => {
        const t = table(schema);
        const i = t.findIndex((r) => r.ItemId === itemId && r.WorkspaceId === workspaceId);
        if (i < 0) return;
        const [gone] = t.splice(i, 1);
        record(schema, "remove", gone);
      },
      isDuplicateKey: isDup,
    };
  };

  const deps: LaneDeps = {
    gateway: { find: async (s, w, o) => find(s, w, o), isDuplicateKey: isDup },
    scoped,
    files: {
      projectDirectory: async (w, p) => `mf/${w}/${p}/`,
      presignUpload: async (req) => {
        presigned.push(clone(req));
        const n = ++fileSeq;
        return { fileId: `file-${n}`, uploadUrl: `https://storage.invalid/${n}`, requiredHeaders: { "x-ms-blob-type": "BlockBlob" } };
      },
      info: async (id) => infoMap.get(id) ?? null,
      head: async (id, length) => new Uint8Array((headMap.get(id) ?? []).slice(0, length)),
      downloadUrl: async (id) => ({ url: `https://storage.invalid/get/${id}`, expiresAt: new Date(clock.getTime() + 5 * 60_000).toISOString() }),
      remove: async (id) => {
        removed.push(id);
      },
    },
    jobs: {
      create: async (req) => {
        const active = table("EngineJob").find(
          (j) => j.WorkspaceId === req.workspaceId && j.ProjectId === req.projectId && j.Kind === req.kind && j.TargetId === req.targetKey && (j.Status === "queued" || j.Status === "running"),
        );
        if (active) return { job: clone(active), created: false };
        jobs.created.push(clone(req));
        const job = insertRaw("EngineJob", {
          WorkspaceId: req.workspaceId,
          ProjectId: req.projectId,
          Kind: req.kind,
          TargetId: req.targetKey,
          Status: "queued",
          InputJson: JSON.stringify(req.input),
          RequestedByUserId: req.actorUserId,
        });
        return { job, created: true };
      },
    },
    access: {
      accountStatus: async (userId) => (table("Account").find((a) => a.UserId === userId)?.Status as string | undefined) ?? null,
      membership: async (workspaceId, userId) => {
        const m = table("Membership").find((x) => x.WorkspaceId === workspaceId && x.UserId === userId);
        return m ? { roleKey: String(m.RoleKey), status: String(m.Status) } : null;
      },
      customRoles: async (workspaceId) =>
        table("WorkspaceRole")
          .filter((r) => r.WorkspaceId === workspaceId && r.IsBuiltIn !== true)
          .map((r): RoleDef => ({ key: String(r.Key), name: String(r.Name ?? r.Key), permissions: (r.Permissions as string[]) ?? [], isBuiltIn: false })),
      audit: async (e) => {
        auditLog.push(clone(e));
      },
    },
    operations: {
      load: async (id) => {
        const o = operations.get(id);
        return o ? clone(o) : null;
      },
      begin: async (rec) => {
        if (!operations.has(rec.requestId)) operations.set(rec.requestId, { status: "pending", result: null });
      },
      finish: async (id, envelope) => {
        operations.set(id, { status: envelope.ok ? "done" : "failed", result: clone(envelope) });
      },
    },
    notify: (n) => {
      notifications.push(clone(n));
    },
    now: () => new Date(clock.getTime()),
    // Notes are queued at once here, so there is nothing to flush; a lane op's handle() collects the after work itself.
    after: (work) => void work(),
    flush: async () => undefined,
    // handle() queues the op's events and writes them through access.audit (auditLog) once the op has answered.
    audit: handleWritesAudit(() => undefined),
  };

  return {
    deps,
    rows: (schema) => table(schema).map(clone),
    insertRaw,
    hostedInsert,
    writes,
    files: {
      presigned,
      removed,
      setInfo: (id, info) => void infoMap.set(id, info),
      setHead: (id, bytes) => void headMap.set(id, bytes),
    },
    jobs,
    auditLog,
    notifications,
    crashNext: (m) => void crashes.push(m),
    setNow: (d) => {
      clock = d;
    },
  };
}

export interface StandardFixture {
  workspaceId: "w1";
  projectId: string;
  otherWorkspaceId: "w2";
  otherProjectId: string;
  users: { owner: string; member: string; viewer: string; outsider: string; superAdmin: string; deactivated: string };
}

/** Seeds Project p1 in w1, Project p2 in w2, the memberships and the accounts. */
export function seedStandard(world: MemoryWorld, opts?: { stage?: string }): StandardFixture {
  const users = { owner: "u-owner", member: "u-member", viewer: "u-viewer", outsider: "u-outsider", superAdmin: "u-super", deactivated: "u-deactivated" };
  for (const [name, id] of Object.entries(users)) {
    world.insertRaw("Account", { UserId: id, Email: `${name}@example.com`, Status: name === "deactivated" ? "deactivated" : "active" });
  }
  const members: [string, string, string][] = [
    ["w1", users.owner, "owner"],
    ["w1", users.member, "member"],
    ["w1", users.viewer, "viewer"],
    ["w1", users.deactivated, "member"],
    ["w2", users.outsider, "owner"],
  ];
  for (const [w, u, r] of members) world.insertRaw("Membership", { WorkspaceId: w, UserId: u, RoleKey: r, Status: "active" });
  world.insertRaw("Project", {
    ItemId: "p1",
    WorkspaceId: "w1",
    ReaderIds: [users.owner, users.member, users.viewer, users.deactivated],
    Name: "Project one",
    ClientName: "Client",
    Stage: opts?.stage ?? "requirements",
  });
  world.insertRaw("Project", { ItemId: "p2", WorkspaceId: "w2", ReaderIds: [users.outsider], Name: "Project two", Stage: "requirements" });
  return { workspaceId: "w1", projectId: "p1", otherWorkspaceId: "w2", otherProjectId: "p2", users };
}

let requestCounter = 0;

export async function invoke(
  world: MemoryWorld,
  op: LaneOp,
  args: Record<string, unknown>,
  caller: { userId: string | null; roles?: string[]; requestId?: string },
): Promise<OpEnvelope> {
  return op.handle(world.deps, {
    op: op.op,
    requestId: caller.requestId ?? `req-${++requestCounter}`,
    args,
    context: { isAuthenticated: caller.userId !== null, userId: caller.userId, roles: caller.roles ?? ["mf-user"] },
  });
}

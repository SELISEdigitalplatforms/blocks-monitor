/**
 * In-memory DeliveryPorts for tests. Never imported by index.ts.
 * Mirrors the gateway rules the handlers rely on: no client ItemId, RequestKey replays,
 * unique indexes, and the row contract (checkRowShape) on every write.
 */
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { BUILT_IN_ROLE_PERMISSIONS, WORKSPACE_PERMISSIONS, type WorkspacePermission } from "../../../../src/domain/rbac";
import type { RoleDef } from "../../../../src/domain/roles";
import type { DeliveryErrorCode, DeliveryPorts, DeliverySchema, Filter, OpAnswer, Row } from "../ports";
import { checkRowShape } from "../rows";

export const FX = {
  ws: "ws-1",
  otherWs: "ws-2",
  project: "0a000000-0000-4000-8000-000000000001",
  otherProject: "0a000000-0000-4000-8000-000000000002",
  owner: "u-owner",
  member: "u-member",
  viewer: "u-viewer",
  customWith: "u-custom-with",
  customWithout: "u-custom-without",
  outsider: "u-outsider",
  inactive: "u-inactive",
  superAdmin: "u-super",
  foreign: "u-foreign",
  now: "2026-10-20T10:00:00.000Z",
} as const;

export class FakeDuplicateKeyError extends Error {
  constructor(message = "E11000 duplicate key") {
    super(message);
    this.name = "FakeDuplicateKeyError";
  }
}

const UNIQUE: Partial<Record<DeliverySchema, readonly string[]>> = {
  Ticket: ["ProjectId", "Number"],
  ChangeRequest: ["ProjectId", "Number"],
  Release: ["ProjectId", "Environment", "Version"],
  ApprovalStep: ["ParentId", "StepKey"],
};

const DELIVERY_LEAD: RoleDef = {
  key: "delivery-lead",
  name: "Delivery lead",
  permissions: WORKSPACE_PERMISSIONS.filter((p) => !["workspace.manage", "members.manage", "roles.manage"].includes(p)),
  isBuiltIn: false,
};
const READER: RoleDef = { key: "reader", name: "Reader", permissions: ["view"], isBuiltIn: false };

type Member = { workspaceId: string; userId: string; roleKey: string; displayName: string };
export type WriteRecord = {
  kind: "insert" | "update" | "remove";
  schema: DeliverySchema;
  id: string;
  data?: Record<string, unknown>;
};

export function createFakeWorld() {
  const tables = new Map<DeliverySchema, Row[]>();
  const counters = new Map<string, number>();
  const operations = new Map<string, OpAnswer>();
  const jobKeys = new Map<string, string>();
  /** Jobs a key names that the ops' reads do not see (staleJobKey): their status by id. */
  const hiddenJobs = new Map<string, string>();
  const requestKeys = new Map<string, string>();
  const hooks: { schema: DeliverySchema; fn: () => void | Promise<void> }[] = [];
  const failures: { schema: DeliverySchema; error: unknown }[] = [];
  const writes: WriteRecord[] = [];
  type NotifyInput = Parameters<DeliveryPorts["notify"]>[0];
  const notifications: Extract<NotifyInput, { recipientUserId: string }>[] = [];
  const followerNotes: Extract<NotifyInput, { audience: unknown }>[] = [];
  const audits: Parameters<DeliveryPorts["audit"]>[0][] = [];
  const jobs: Parameters<DeliveryPorts["createEngineJob"]>[0][] = [];
  let caller: { userId: string | null; isSuperAdmin: boolean } = { userId: FX.owner, isSuperAdmin: false };

  const members: Member[] = [
    { workspaceId: FX.ws, userId: FX.owner, roleKey: "owner", displayName: "Olivia Owner" },
    { workspaceId: FX.ws, userId: FX.member, roleKey: "member", displayName: "Mia Member" },
    { workspaceId: FX.ws, userId: FX.viewer, roleKey: "viewer", displayName: "Vic Viewer" },
    { workspaceId: FX.ws, userId: FX.customWith, roleKey: "delivery-lead", displayName: "Dana Lead" },
    { workspaceId: FX.ws, userId: FX.customWithout, roleKey: "reader", displayName: "Rae Reader" },
    { workspaceId: FX.ws, userId: FX.inactive, roleKey: "owner", displayName: "Ines Inactive" },
    { workspaceId: FX.otherWs, userId: FX.foreign, roleKey: "owner", displayName: "Finn Foreign" },
  ];
  const accounts = new Map<string, string>(
    [FX.owner, FX.member, FX.viewer, FX.customWith, FX.customWithout, FX.outsider, FX.superAdmin, FX.foreign].map(
      (u) => [u, "active"],
    ),
  );
  accounts.set(FX.inactive, "deactivated");

  const table = (schema: DeliverySchema): Row[] => {
    let t = tables.get(schema);
    if (!t) tables.set(schema, (t = []));
    return t;
  };
  const nextId = (schema: DeliverySchema): string => {
    const n = (counters.get(schema) ?? 0) + 1;
    counters.set(schema, n);
    return `${schema.toLowerCase()}-${String(n).padStart(6, "0")}`;
  };
  const matches = (row: Row, filter: Filter): boolean =>
    Object.entries(filter).every(([k, f]) => {
      const v = row[k];
      return typeof f === "object" ? f.in.includes(v as never) : v === f;
    });
  const clash = (schema: DeliverySchema, row: Record<string, unknown>, selfId?: string): boolean => {
    const fields = UNIQUE[schema];
    return (
      !!fields &&
      table(schema).some((r) => r.ItemId !== selfId && fields.every((f) => r[f] === row[f]))
    );
  };
  const activeIds = (ws: string) => members.filter((m) => m.workspaceId === ws).map((m) => m.userId);

  function insertRow(schema: DeliverySchema, row: Record<string, unknown>, requestKey: string) {
    if ("ItemId" in row) throw new Error("insert: the client must not send ItemId (F0)");
    const reason = checkRowShape(schema, row);
    if (reason) throw new Error(`insert refused: ${reason}`);
    const rk = `${schema}|${requestKey}`;
    const known = requestKeys.get(rk);
    if (known) return { itemId: known, existing: true };
    if (clash(schema, row)) throw new FakeDuplicateKeyError();
    const itemId = nextId(schema);
    table(schema).push({ ...row, RequestKey: requestKey, ItemId: itemId });
    requestKeys.set(rk, itemId);
    writes.push({ kind: "insert", schema, id: itemId, data: { ...row } });
    return { itemId, existing: false };
  }

  const ports: DeliveryPorts = {
    caller: () => ({ ...caller }),
    flush: async () => undefined,
    account: async (userId) => (accounts.has(userId) ? { status: accounts.get(userId)! } : null),
    activeMembers: async (ws) =>
      members.filter((m) => m.workspaceId === ws).map((m) => ({ userId: m.userId, roleKey: m.roleKey, displayName: m.displayName })),
    customRoles: async (ws) => (ws === FX.ws ? [DELIVERY_LEAD, READER] : []),
    getById: async (schema, id) => {
      const r = table(schema).find((x) => x.ItemId === id);
      return r ? structuredClone(r) : null;
    },
    query: async (schema, filter, opts) => {
      let out = table(schema).filter((r) => matches(r, filter)).map((r) => structuredClone(r));
      for (const s of [...(opts?.sort ?? [])].reverse()) {
        out = out.sort((a, b) => {
          const x = a[s.field] as never, y = b[s.field] as never;
          const c = x < y ? -1 : x > y ? 1 : 0;
          return s.dir === "asc" ? c : -c;
        });
      }
      return opts?.limit !== undefined ? out.slice(0, opts.limit) : out;
    },
    insert: async (schema, row, opts) => {
      const failure = failures.findIndex((f) => f.schema === schema);
      if (failure >= 0) throw failures.splice(failure, 1)[0].error;
      const result = insertRow(schema, row, opts.requestKey);
      const hook = hooks.findIndex((h) => h.schema === schema);
      if (hook >= 0 && !result.existing) await hooks.splice(hook, 1)[0].fn();
      return result;
    },
    update: async (schema, id, patch) => {
      if ("ItemId" in patch) throw new Error("update: ItemId is read-only");
      const reason = checkRowShape(schema, patch);
      if (reason) throw new Error(`update refused: ${reason}`);
      const row = table(schema).find((x) => x.ItemId === id);
      if (!row) throw new Error(`update: ${schema} ${id} not found`);
      if (clash(schema, { ...row, ...patch }, id)) throw new FakeDuplicateKeyError();
      Object.assign(row, patch);
      writes.push({ kind: "update", schema, id, data: { ...patch } });
    },
    remove: async (schema, id) => {
      const t = table(schema);
      const i = t.findIndex((x) => x.ItemId === id);
      if (i < 0) throw new Error(`remove: ${schema} ${id} not found`);
      t.splice(i, 1);
      writes.push({ kind: "remove", schema, id });
    },
    isDuplicateKey: (e) => e instanceof FakeDuplicateKeyError,
    beginOperation: async (requestId, op) => operations.get(`${requestId}|${op}`) ?? null,
    finishOperation: async (requestId, op, answer) => {
      operations.set(`${requestId}|${op}`, answer);
    },
    createEngineJob: async (job) => {
      const known = jobKeys.get(job.dedupeKey);
      // like jobs.create: the job the key names, as it is stored now
      if (known) return { jobId: known, existing: true, status: hiddenJobs.get(known) ?? String(table("EngineJob").find((r) => r.ItemId === known)?.Status ?? "queued") };
      // like jobs.create on the hosted store: one active job per (project, ActiveKey) (the unique index), the ActiveKey
      // being "<kind>:<target id>" or "<kind>:project" without a target; a clash answers that active job, whoever's it is
      const activeKey = `${job.kind}:${job.target?.id ?? "project"}`;
      const holder = table("EngineJob").find((r) => r.ProjectId === job.projectId && r.ActiveKey === activeKey && ["queued", "claimed", "running"].includes(String(r.Status)));
      if (holder) return { jobId: String(holder.ItemId), existing: true, status: String(holder.Status) };
      jobs.push(job);
      const { itemId } = insertRow(
        "EngineJob",
        {
          WorkspaceId: job.workspaceId,
          ReaderIds: activeIds(job.workspaceId),
          CreatedByUserId: job.createdByUserId,
          UpdatedByUserId: job.createdByUserId,
          ProjectId: job.projectId,
          Kind: job.kind satisfies EngineJobKind,
          Status: "queued",
          ActiveKey: activeKey,
          TargetType: job.target?.type ?? "",
          TargetId: job.target?.id ?? "",
          InputJson: JSON.stringify(job.input),
          OutputRefs: [],
          Progress: 0,
          Message: "",
          Attempts: 0,
          ClaimedBy: "",
          ErrorCode: "",
          RequestedByUserId: job.createdByUserId,
        },
        `job:${job.dedupeKey}`,
      );
      jobKeys.set(job.dedupeKey, itemId);
      return { jobId: itemId, existing: false, status: "queued" };
    },
    notify: async (n) => {
      if (n.audience) followerNotes.push(n);
      else notifications.push(n);
    },
    audit: async (a) => {
      audits.push(a);
    },
    uuid5: (name) => {
      let h = 2166136261;
      for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
      return `u5-${h.toString(16).padStart(8, "0")}-${name.length.toString(16)}`;
    },
    now: () => FX.now,
  };

  const world = {
    seed(schema: DeliverySchema, fields: Record<string, unknown>): Row {
      const { ItemId, ...rest } = fields;
      const reason = checkRowShape(schema, rest);
      if (reason) throw new Error(`seed refused: ${reason}`);
      const row: Row = { ...rest, ItemId: typeof ItemId === "string" ? ItemId : nextId(schema) };
      table(schema).push(row);
      return structuredClone(row);
    },
    rows: (schema: DeliverySchema): Row[] => table(schema).map((r) => structuredClone(r)),
    writes,
    notifications,
    followerNotes,
    audits,
    jobs,
    operations,
    as(userId: string | null, opts?: { superAdmin?: boolean }) {
      caller = { userId, isSuperAdmin: !!opts?.superAdmin };
    },
    afterInsert(schema: DeliverySchema, fn: () => void | Promise<void>) {
      hooks.push({ schema, fn });
    },
    failNextInsert(schema: DeliverySchema, error: unknown) {
      failures.push({ schema, error });
    },
    /** A job under this dedupe key that already ended with `status`, which the ops' reads do not see (a key that
     *  collides with an earlier job, or a count read before that job was visible); answers its id. */
    staleJobKey(dedupeKey: string, status: "succeeded" | "failed" | "cancelled" = "succeeded"): string {
      const id = `enginejob-stale-${hiddenJobs.size + 1}`;
      hiddenJobs.set(id, status);
      jobKeys.set(dedupeKey, id);
      return id;
    },
    /** The dedupe keys jobs were created under, in order. */
    jobKeys: () => [...jobKeys.keys()],
    duplicateKeyError: () => new FakeDuplicateKeyError(),
  };

  const baseProject = { Name: "Project", Stage: "board", CurrentScopeVersion: 1, ScopeLockedAt: FX.now, AssigneeUserId: "" };
  world.seed("Project", {
    ItemId: FX.project, ...baseProject, WorkspaceId: FX.ws, ReaderIds: activeIds(FX.ws),
    CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner,
  });
  world.seed("Project", {
    ItemId: FX.otherProject, ...baseProject, WorkspaceId: FX.otherWs, ReaderIds: activeIds(FX.otherWs),
    CreatedByUserId: FX.foreign, UpdatedByUserId: FX.foreign,
  });

  return { ports, world, ...world };
}

export type FakeWorld = ReturnType<typeof createFakeWorld>;

/** The refusal matrix every handler must satisfy; code null means the caller passes the guard. */
export function guardCases(permission: WorkspacePermission | readonly WorkspacePermission[]) {
  const wanted = Array.isArray(permission) ? (permission as readonly WorkspacePermission[]) : [permission as WorkspacePermission];
  const builtIn = (role: "member" | "viewer"): DeliveryErrorCode | null =>
    wanted.some((p) => (BUILT_IN_ROLE_PERMISSIONS[role] as readonly string[]).includes(p)) ? null : "forbidden";
  return [
    { name: "no user id", userId: null as string | null, superAdmin: false, code: "forbidden" as DeliveryErrorCode | null },
    { name: "deactivated account", userId: FX.inactive, superAdmin: false, code: "account_inactive" as DeliveryErrorCode | null },
    { name: "not a member", userId: FX.outsider, superAdmin: false, code: "not_member" as DeliveryErrorCode | null },
    { name: "member of another workspace", userId: FX.foreign, superAdmin: false, code: "not_member" as DeliveryErrorCode | null },
    { name: "custom role without the key", userId: FX.customWithout, superAdmin: false, code: "forbidden" as DeliveryErrorCode | null },
    { name: "viewer", userId: FX.viewer, superAdmin: false, code: builtIn("viewer") },
    { name: "member", userId: FX.member, superAdmin: false, code: builtIn("member") },
    { name: "custom role with the key", userId: FX.customWith, superAdmin: false, code: null as DeliveryErrorCode | null },
  ];
}

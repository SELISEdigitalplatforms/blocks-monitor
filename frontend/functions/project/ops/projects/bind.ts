/**
 * The ONLY file of the projects and docs areas that imports functions/_lib. It binds L4's narrow Ports (ports.ts)
 * to the router's per-request ctx and deps and wraps every handler of PROJECT_HANDLERS and DOC_HANDLERS with defineOp.
 *
 * The router has already authenticated the caller, checked the account, membership and permission and owns the
 * Operation record and the super-admin AuditEvent; L4's own skeleton (op.ts) runs again on top for its checks and its
 * strict input parsing (defence in depth). Anything the router already resolved is answered from ctx, so the bound
 * op adds only the Project read (one round) to the router's own rounds (PX1 budget).
 * Rows never carry ItemId (F0); every insert goes through deps.gw with the RequestKey L4 computed.
 */
import { f, defineOp, OpError, NOTIFICATION_KINDS, issuedStamp, JOB_FIELDS } from "../../../_lib";
import { isOwnLandedWrite } from "../../../_lib/stamps";
import { wakeProjectPurge } from "../../../_lib/purge";
import type { Filter as GwFilter } from "../../../_lib/filter";
import type { OpCtx, OpDeps, Row as GwRow } from "../../../_lib/types";
import { ENGINE_JOB_STATUSES, isTerminal } from "../../../../src/domain/engineJob";
import { FILE_MAX_BYTES } from "../../../../src/domain/docs";
import { isOpFailureCode } from "../../../../src/domain/fnContract";
import type { RoleDef } from "../../../../src/domain/roles";
import { isWorkspaceRole, type WorkspacePermission } from "../../../../src/domain/rbac";
import { DOC_HANDLERS } from "../docs/index";
import { PROJECT_HANDLERS } from "./index";
import { runOp, type OpDef } from "./op";
import {
  DuplicateKeyError,
  type Filter,
  type FnErrorCode,
  type MembershipInfo,
  type Ports,
  type QueryOpts,
  type ReadEnv,
  type Row,
} from "./ports";
import { F } from "./records";

const str = (x: unknown): string => (typeof x === "string" ? x : "");
const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** What the rows the router did not already give us are read with: S1 fields and system fields only. */
const COMMON = ["ItemId", "WorkspaceId", "CreatedDate", "LastUpdatedDate", "CreatedByUserId", "UpdatedByUserId", "RequestKey"] as const;
export const PROJECT_BIND_FIELDS: Record<string, readonly string[]> = {
  Project: [
    ...COMMON,
    ...["name", "clientName", "clientContact", "clientIndustry", "clientRegion", "stage", "resumeTo", "assigneeUserId", "handedOverAt", "handedOverByUserId", "status"].map(
      (k) => F.project[k as keyof typeof F.project],
    ),
  ],
  ProjectAssignment: [...COMMON, ...Object.values(F.assignment)],
  Share: [...COMMON, ...Object.values(F.share)],
  DocFolder: [...COMMON, ...Object.values(F.folder)],
  DocNote: [...COMMON, ...Object.values(F.note)],
  DocFile: [...COMMON, ...Object.values(F.file)],
  Membership: ["ItemId", "WorkspaceId", "UserId", "RoleKey", "Status"],
  EngineJob: ["ItemId", "WorkspaceId", "ProjectId", "Status"],
};

const STAMPS = ["ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "RequestKey", "CreatedDate", "LastUpdatedDate"];

type Where = { field: string; value: Filter[string] };

function splitFilter(filter: Filter): { eqs: GwFilter[]; nes: Where[]; empty: boolean } {
  const eqs: GwFilter[] = [];
  const nes: Where[] = [];
  let empty = false;
  for (const [field, v] of Object.entries(filter)) {
    if (typeof v === "object" && v !== null) {
      if ("in" in v) {
        if (v.in.length === 0) empty = true;
        else eqs.push(f.in(field, v.in));
      } else nes.push({ field, value: v });
    } else eqs.push(f.eq(field, v));
  }
  return { eqs, nes, empty };
}

const notEqual = (row: Record<string, unknown>, w: Where): boolean => {
  const v = w.value as { ne: string | number | boolean };
  return row[w.field] !== v.ne;
};

/** The L3 catalogue params of the two notifications L4 sends. */
function catalogueParams(ctx: OpCtx, n: { kind: string; projectId: string; params: Record<string, string | number> }): Record<string, string> {
  const actorName = str(ctx.account?.DisplayName) || ctx.caller.email || "A teammate";
  const base = {
    projectId: n.projectId,
    projectName: str(n.params.projectName) || "A project",
    actorName,
    ...(ctx.project ? { workspaceId: str(ctx.project.WorkspaceId) } : {}),
  };
  if (n.kind === "shared") {
    const label = n.params.itemType === "scope" ? "Scope" : n.params.itemType === "screens" ? "Screens" : "A screen";
    return { ...base, itemLabel: label };
  }
  return base;
}

type Gw = OpDeps["gw"];

const ACTIVE_JOB_STATUSES = ENGINE_JOB_STATUSES.filter((x) => !isTerminal(x));

/**
 * The reads of the ports over any gateway: the handler's ports and the prefetch build them from this one function, so a
 * prefetched read and the handler's identical read are the same gateway call and share the request memo.
 */
function readersOver(gw: Gw) {
  const fieldsFor = (schema: string, extra: readonly string[] = []): string[] => [
    ...new Set([...(PROJECT_BIND_FIELDS[schema] ?? ["ItemId"]), ...extra]),
  ];
  let realRoles: Promise<RoleDef[]> | null = null;
  return {
    async query(schema: string, filter: Filter, opts?: QueryOpts): Promise<Row[]> {
      const { eqs, nes, empty } = splitFilter(filter);
      if (empty || eqs.length === 0) return [];
      const where = f.and(...eqs);
      const wanted = opts?.fields
        ? [...new Set(["ItemId", ...opts.fields, ...nes.map((n) => n.field)])]
        : fieldsFor(schema, nes.map((n) => n.field));
      const sort = opts?.sort;
      let rows: GwRow[];
      if (nes.length === 0 && opts?.limit !== undefined && opts.limit <= 100) {
        rows = (await gw.find(schema, { where, fields: wanted, ...(sort ? { sort } : {}), page: 1, pageSize: Math.max(1, opts.limit) })).items;
      } else {
        rows = await gw.findAll(schema, { where, fields: wanted, ...(sort ? { sort } : {}), max: 5000 });
        rows = rows.filter((r) => nes.every((n) => notEqual(r, n)));
        if (opts?.limit !== undefined) rows = rows.slice(0, opts.limit);
      }
      return rows as Row[];
    },
    async count(schema: string, filter: Filter): Promise<number> {
      const { eqs, nes, empty } = splitFilter(filter);
      if (empty || eqs.length === 0) return 0;
      const rows = await gw.findAll(schema, {
        where: f.and(...eqs),
        fields: ["ItemId", ...new Set(nes.map((n) => n.field))],
        max: 5000,
      });
      return rows.filter((r) => nes.every((n) => notEqual(r, n))).length;
    },
    async activeMembers(workspaceId: string): Promise<MembershipInfo[]> {
      const rows = await gw.findAll("Membership", {
        where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("Status", "active")),
        fields: PROJECT_BIND_FIELDS.Membership as string[],
        max: 5000,
      });
      return rows.map((r) => ({ userId: str(r.UserId), workspaceId, roleKey: str(r.RoleKey), status: "active" as const }));
    },
    customRoles(workspaceId: string): Promise<RoleDef[]> {
      realRoles ??= gw
        .findAll("WorkspaceRole", {
          where: f.eq("WorkspaceId", workspaceId),
          fields: ["ItemId", "Key", "Name", "Description", "Permissions", "IsBuiltIn"],
          max: 50,
        })
        .then((rows) =>
          rows.map((r) => ({
            key: str(r.Key),
            name: str(r.Name),
            description: str(r.Description),
            permissions: Array.isArray(r.Permissions) ? r.Permissions.filter((p): p is string => typeof p === "string") : [],
            isBuiltIn: r.IsBuiltIn === true,
          })),
        );
      return realRoles;
    },
    /** The project's non-terminal jobs (one page: a project has a handful of active jobs). */
    async activeJobs(projectId: string): Promise<Row[]> {
      const res = await gw.find("EngineJob", {
        where: f.and(f.eq("ProjectId", projectId), f.in("Status", [...ACTIVE_JOB_STATUSES])),
        fields: JOB_FIELDS,
        page: 1,
        pageSize: 100,
      });
      return res.items as Row[];
    },
  };
}

export function buildPorts(ctx: OpCtx, deps: OpDeps): Ports {
  const { gw } = deps;
  const callerId = ctx.caller.userId;
  const stamp = issuedStamp(ctx.now);
  // Rows seen in this request, so an update can answer with the whole changed record without another round.
  const seen = new Map<string, Record<string, unknown>>();
  const remember = (schema: string, row: Record<string, unknown>) => {
    const id = str(row.ItemId);
    if (id) seen.set(`${schema}:${id}`, { ...(seen.get(`${schema}:${id}`) ?? {}), ...row });
  };
  const reads = readersOver(gw);

  let customRoleCalls = 0;

  const ports: Ports = {
    automaticBlocksProvisioning: ctx.caller.identitySource === "iam",
    verifyRepository: ctx.caller.identitySource === "iam" ? async (repo) => {
      if (!deps.verifyRepository) throw new OpError("not_configured");
      try {
        await deps.verifyRepository(callerId, repo, `${ctx.fn}:${ctx.op}:${ctx.requestId}`);
      } catch (error) {
        // Host callbacks can cross Vite's bundled/SSR module boundary. Rebuild a
        // recognized host error with the function graph's own OpError class.
        if (error !== null && typeof error === 'object' && "code" in error && isOpFailureCode(error.code) && 'message' in error && error.message === error.code) {
          const messageKey = 'messageKey' in error && typeof error.messageKey === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(error.messageKey) ? error.messageKey : undefined;
          throw new OpError(error.code, messageKey);
        }
        throw error;
      }
    } : undefined,
    accounts: {
      async get(userId) {
        if (userId !== callerId) return null;
        // Blocks-host callers are authenticated directly by IAM; there is intentionally
        // no local Account mirror for them. Local mode continues to use its account row.
        if (ctx.caller.identitySource === "iam") return { userId, active: true, isSuperAdmin: ctx.caller.isSuperAdmin };
        if (!ctx.account) return null;
        return { userId, active: str(ctx.account.Status) === "active", isSuperAdmin: ctx.caller.isSuperAdmin };
      },
    },
    members: {
      async membership(workspaceId, userId): Promise<MembershipInfo | null> {
        const asInfo = (r: GwRow): MembershipInfo => ({
          userId: str(r.UserId) || userId,
          workspaceId,
          roleKey: str(r.RoleKey),
          status: (str(r.Status) || "active") as MembershipInfo["status"],
        });
        if (userId === callerId) {
          if (!ctx.membership || str(ctx.membership.WorkspaceId ?? workspaceId) !== workspaceId) return null;
          return asInfo(ctx.membership);
        }
        const rows = await gw.findAll("Membership", {
          where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("UserId", userId)),
          fields: PROJECT_BIND_FIELDS.Membership as string[],
          max: 1,
        });
        return rows[0] ? asInfo(rows[0]) : null;
      },
      async customRoles(workspaceId): Promise<RoleDef[]> {
        customRoleCalls += 1;
        // The skeleton's own permission check is the FIRST call and only happens for a caller with a custom role:
        // the router already resolved those permissions, so one synthetic role reproduces them with no round trip.
        if (customRoleCalls === 1 && ctx.membership) {
          const key = str(ctx.membership.RoleKey);
          if (key && !isWorkspaceRole(key)) return [{ key, name: "", description: "", permissions: [...ctx.permissions], isBuiltIn: false }];
        }
        return reads.customRoles(workspaceId);
      },
      activeMembers: (workspaceId) => reads.activeMembers(workspaceId),
      readerIds: () => deps.acl.readerIds(),
    },
    // The router owns idempotency and the Operation record.
    operations: { get: async () => null, begin: async () => undefined, finish: async () => undefined },
    db: {
      async query(schema, filter, opts?: QueryOpts) {
        // The router's round 1 already read the whole Project row: answer the skeleton's own read from ctx.
        const own = ctx.project;
        if (schema === "Project" && own && "Stage" in own && Object.keys(filter).length === 1 && filter.ItemId === own.ItemId) {
          const row: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(own)) if (v !== null && v !== undefined) row[k] = v;
          remember(schema, row);
          return [row as Row];
        }
        const rows = await reads.query(schema, filter, opts);
        for (const r of rows) remember(schema, r);
        return rows;
      },
      count: (schema, filter) => reads.count(schema, filter),
      async insert(schema, fields) {
        const requestKey = str(fields.RequestKey);
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (!STAMPS.includes(k) && v !== undefined && v !== null) rest[k] = v;
        const res = await gw.insert(schema, rest, { requestKey });
        if (!res.created || res.itemId === null) throw new DuplicateKeyError(schema, requestKey);
        // The answer carries the stamp this request issued; the next conflict check accepts it (isFreshStamp), no read-back.
        const row = { ...fields, ItemId: res.itemId, CreatedDate: stamp, LastUpdatedDate: stamp } as Row;
        remember(schema, row);
        return row;
      },
      async update(schema, itemId, patch) {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) if (!STAMPS.includes(k) && v !== undefined && v !== null) clean[k] = v;
        if (Object.keys(clean).length === 0) clean.UpdatedByUserId = callerId;
        await gw.update(schema, itemId, clean);
        const row = { ...(seen.get(`${schema}:${itemId}`) ?? {}), ...clean, ItemId: itemId, LastUpdatedDate: stamp } as Row;
        remember(schema, row);
        return row;
      },
      async remove(schema, itemId, opts) {
        await gw.remove(schema, itemId, opts);
        seen.delete(`${schema}:${itemId}`);
      },
    },
    files: {
      // The project directory is resolved inside presignUpload (deps.files owns it), so no extra Storage round here.
      projectDirectory: async (_workspaceId, projectId) => `project:${projectId}`,
      // FilesService has no project-directory delete: the empty directory stays (Library follow-up).
      removeProjectDirectory: async () => undefined,
      async presignUpload(req) {
        const projectId = ctx.project ? str(ctx.project.ItemId) : "";
        const res = await deps.files.presignUpload({
          projectId,
          fileName: req.fileName,
          mime: req.contentType,
          sizeBytes: req.sizeInBytes,
          maxBytes: FILE_MAX_BYTES,
          allowedMimes: [req.contentType],
          ...(req.checksum ? { sha256: req.checksum } : {}),
        });
        return { uploadUrl: res.uploadUrl, storageObjectId: res.fileId, requiredHeaders: res.requiredHeaders };
      },
      async info(id) {
        try {
          const i = await deps.files.info(id);
          return { sizeBytes: i.sizeBytes, ...(i.mime ? { contentType: i.mime } : {}) };
        } catch (e) {
          if (e instanceof OpError && e.code === "not_found") return null;
          throw e;
        }
      },
      head: (id, bytes) => deps.files.head(id, bytes),
      async downloadUrl(id, ttlSeconds) {
        const r = await deps.files.downloadUrl(id);
        return { url: r.url, expiresAt: r.expiresAt ?? new Date(ctx.now.getTime() + ttlSeconds * 1000).toISOString() };
      },
      async remove(id) {
        try {
          await deps.files.remove(id);
        } catch (e) {
          if (!(e instanceof OpError && e.code === "not_found")) throw e;
        }
      },
    },
    jobs: {
      async cancelActive(projectId) {
        // The rows come from one read (the prefetch warmed it) and are cancelled in one write round, with no reads.
        const rows = await reads.activeJobs(projectId);
        return (await deps.jobs.cancelRows(rows, { actor: "system" })).cancelled.length;
      },
      activeRows: (projectId) => reads.activeJobs(projectId),
      // The writes are issued before this returns its promise, so a caller can start other writes right after.
      cancelRows: (rows) => deps.jobs.cancelRows(rows, { actor: "system" }).then((r) => r.cancelled.length),
      create: (i) => deps.jobs.create(i).then((r) => ({ jobId: str(r.job.ItemId), existing: r.existing })),
    },
    audit: {
      async write(e) {
        // The router writes the one AuditEvent of a super admin acting outside their memberships.
        if (e.action.startsWith("superAdmin.")) return;
        deps.audit({ action: e.action, targetType: kebab(e.targetSchema), targetId: e.targetId, details: { ...(e.params ?? {}) } });
      },
    },
    notify: {
      async send(n) {
        // Audience notes carry no recipient: onBusinessHandedOver (the L10 hook) resolves the workspace's readers.
        const recipient = n.recipientUserId;
        if (!recipient) return;
        deps.notify({
          kind: n.kind,
          recipients: [recipient],
          projectId: n.projectId,
          params: catalogueParams(ctx, n),
          link: n.link,
          eventKey: n.eventKey,
        });
      },
    },
    clock: { now: () => ctx.now, monoMs: () => Date.now() },
    uuidv5: (name) => deps.ids.uuid5(name),
    oneRoundPerCall: true,
    after: (work) => deps.after(work),
    flush: () => deps.flush(),
    issuedStamp: stamp,
    isOwnWrite: (stored, callerUserId, values) => isOwnLandedWrite({ stored, callerUserId, values }),
  };
  return ports;
}

/**
 * L10 hook (L10 lands after LX): tells the workspace's other active members that Business was handed over.
 * It emits only when the router's catalogue already knows the kind; L10 owns the kind, its text and the email.
 */
export async function onBusinessHandedOver(ctx: OpCtx, deps: OpDeps, data: unknown): Promise<void> {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes("business.handed-over")) return;
  const projectId = str((data as { project?: { ItemId?: unknown } } | null)?.project?.ItemId) || str(ctx.project?.ItemId);
  if (!projectId) return;
  const readers = await deps.acl.readerIds();
  const recipients = readers.filter((id) => id !== ctx.caller.userId).slice(0, 200);
  if (recipients.length === 0) return;
  const name = str((data as { project?: { Name?: unknown } } | null)?.project?.Name);
  deps.notify({
    kind: "business.handed-over" as never,
    recipients,
    projectId,
    params: {
      projectId,
      projectName: name || "A project",
      actorName: str(ctx.account?.DisplayName) || ctx.caller.email || "A teammate",
      workspaceId: str(ctx.project?.WorkspaceId),
    },
    link: `/p/${projectId}/sanitization`,
    eventKey: `business.handed-over:${projectId}`,
  });
}

/** The prefetch's env: the same reads as the handler's ports, over the (read-only) gateway of round 1; writes are refused. */
function readEnvOf(gw: Gw, p: { projectId: string; workspaceId: string; callerUserId: string }): ReadEnv {
  const r = readersOver(gw);
  const refused = (): never => {
    throw new OpError("internal");
  };
  const ports = {
    accounts: { get: async () => null },
    members: {
      membership: async () => null,
      customRoles: r.customRoles,
      activeMembers: r.activeMembers,
      readerIds: async (ws: string) => (await r.activeMembers(ws)).map((m) => m.userId),
    },
    operations: { get: async () => null, begin: async () => undefined, finish: async () => undefined },
    db: { query: r.query, count: r.count, insert: refused, update: refused, remove: refused },
    files: new Proxy({}, { get: () => refused }),
    jobs: { cancelActive: refused, activeRows: r.activeJobs },
    audit: { write: async () => undefined },
    notify: { send: async () => undefined },
    clock: { now: () => new Date(), monoMs: () => Date.now() },
    uuidv5: refused,
  } as unknown as Ports;
  return {
    ports,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    userId: p.callerUserId,
    readerIds: () => ports.members.readerIds(p.workspaceId),
    warmRemove: (schema, itemId) => gw.get(schema, itemId, ["ItemId"]),
  };
}

function bind(def: OpDef<any, any>) {
  const prefetchDef = def.prefetch;
  const record = def.record ?? (def.storeAnswer === false && def.op !== "doc.file.url" ? () => false : undefined);
  return defineOp({
    op: def.op,
    scope: def.scope === "workspace" ? "workspace" : "project",
    kind: def.op === "doc.file.url" ? "view" : "command",
    permission: def.permission as WorkspacePermission,
    // The answer carries a fresh upload URL: a retry re-runs the op (its DocFile insert is RequestKey-idempotent).
    ...(record ? { record } : {}),
    ...(def.bookkeepingAfterAnswer ? { bookkeepingAfterAnswer: true } : {}),
    args(raw: unknown) {
      const parsed = def.parse(raw);
      if (!parsed.ok) throw new OpError("invalid_input", parsed.messageKey, parsed.params);
      return raw as Record<string, unknown>;
    },
    ...(prefetchDef
      ? {
          prefetch: (p: { args: unknown; projectId?: string | null; workspaceId?: string | null; callerUserId: string; gw?: Gw | null }) => {
            if (!p.gw || !p.projectId || !p.workspaceId) return undefined;
            const parsed = def.parse(p.args);
            if (!parsed.ok) return undefined;
            return prefetchDef(readEnvOf(p.gw, { projectId: p.projectId, workspaceId: p.workspaceId, callerUserId: p.callerUserId }), parsed.value);
          },
        }
      : {}),
    async handler(ctx, args, deps) {
      const ports = buildPorts(ctx, deps);
      // The recipients of the hand-over note are resolved beside the write, so the hook below waits for nothing.
      if (def.op === "business.handOver") deps.acl.readerIds().catch(() => undefined);
      const answer = await runOp(
        def,
        ports,
        { context: { isAuthenticated: true, userId: ctx.caller.userId } },
        { op: def.op, requestId: ctx.requestId, args },
      );
      if (!answer.ok) {
        const { code, messageKey, params } = answer.error;
        return deps.fail(code as FnErrorCode, messageKey, params);
      }
      if (def.op === "business.handOver") await onBusinessHandedOver(ctx, deps, answer.data);
      if (def.op === "project.delete") {
        try {
          wakeProjectPurge(String((args as { projectId: unknown }).projectId));
        } catch {
          // The wake is best effort: the worker's next tick finds the 'deleting' project anyway.
        }
      }
      return answer.data;
    },
  });
}

export const PROJECT_OPS = PROJECT_HANDLERS.map(bind);
export const DOC_OPS = DOC_HANDLERS.map(bind);

/**
 * The ONLY file of the scope ops that imports functions/_lib: it binds the ports of ./ports to L2b's _lib and
 * wraps every handler with defineOp. SCOPE_OPS is that defineOp-made table; L2's discovery registers nothing else.
 *
 * ARCHITECTURE (design 12.2 step 4 and 13.1, Appendix A, wave C):
 * - Every write of this lane is an op of the Logic Function `project` (mf-project). Under the F0 override it runs
 *   on Host A (POST /api/fn/project, the Vite middleware) or on Host B; both use the same router.
 * - The router already does the Appendix A guard (caller from ctx only, Account active, Operation replay, Project
 *   loaded as the service with WorkspaceId taken from it, membership and permissions with custom roles, the
 *   super-admin audit, the {ok, data, serverNow} answer). The handlers behind these ports do the validation and the
 *   cross-reference checks (else not_found) and the writes.
 * - The gateway assigns every ItemId (never sent); idempotency is the RequestKey natural key; no transactions.
 * - Files: Creator / Private / no inherited access, in mf/<WorkspaceId>/<ProjectId>/ (enforced by _lib's files
 *   service); bytes never pass through a function; never a local fetch(.
 */
import { SCOPE_OP_NAMES, SCOPE_OP_PERMISSION, SCOPE_VIEW_OPS } from "../../../../src/domain/scope";
import { OpError, defineOp, f, issuedStamp } from "../../../_lib";
import { capKey } from "../../../_lib/ids";
import { MAX_PAGE_SIZE, findNewest } from "../../../_lib/paging";
import type { OpCtx, OpDef, OpDeps, Row as LibRow } from "../../../_lib";
import { ATTACHMENT_HANDLERS } from "./attachments";
import { CHALLENGE_HANDLERS } from "./challenges";
import { FEEDBACK_HANDLERS } from "./feedback";
import { SCOPE_JOB_HANDLERS } from "./jobs";
import { LOCK_HANDLERS } from "./lock";
import { MILESTONE_HANDLERS } from "./milestones";
import { OPEN_HANDLERS } from "./open";
import {
  JobNotCancellableError,
  UniqueConflictError,
  type Filter,
  type PresignPortRequest,
  type QueryOpts,
  type Row,
  type ScopeEnv,
  type ScopeOpName,
} from "./ports";
import { FIELDS } from "./records";
import { SCOPE_SAVE_HANDLERS } from "./scope";
import { SCREEN_HANDLERS } from "./screens";
import { SUCCESS_HANDLERS } from "./success";
import type { ScopeOpDef } from "./shared";

const MAX_IN = 500;
const DEFAULT_QUERY_MAX = 1000;
const JOBS_MAX = 200;
const SYSTEM_READ = ["ItemId", "CreatedDate", "LastUpdatedDate"];

const fieldsFor = (schema: string, wanted: readonly string[] | undefined, extra: readonly string[] = []): string[] => {
  const base = wanted ?? (FIELDS as Record<string, readonly string[]>)[schema] ?? [];
  return [...new Set([...SYSTEM_READ, ...base, ...extra])];
};

const isIn = (v: Filter[string]): v is { in: readonly (string | number)[] } => typeof v === "object" && v !== null && "in" in v;
const isNe = (v: Filter[string]): v is { ne: string | number | boolean } => typeof v === "object" && v !== null && "ne" in v;

/** Maps the port's plain filter to f.eq / f.in (_lib has no f.ne: `ne` entries are applied to the rows read). */
function whereOf(filter: Filter): { where: ReturnType<typeof f.and>; ne: [string, string | number | boolean][] } {
  const parts: ReturnType<typeof f.eq>[] = [];
  const ne: [string, string | number | boolean][] = [];
  for (const [field, value] of Object.entries(filter)) {
    if (isNe(value)) ne.push([field, value.ne]);
    else if (isIn(value)) parts.push(f.in(field, value.in));
    else parts.push(f.eq(field, value));
  }
  if (parts.length === 0) throw new TypeError("A scope query needs at least one equality or in filter.");
  return { where: f.and(...parts), ne };
}

type Gw = OpDeps["gw"];

/** The reads of a scope env over any gateway: the handler env and the prefetch build them the same way, so the memo is shared. */
function readersOver(gw: Gw, projectId: string): { query: ScopeEnv["db"]["query"]; byIds: ScopeEnv["db"]["byIds"]; list: ScopeEnv["jobs"]["list"] } {
  const query: ScopeEnv["db"]["query"] = async (schema, filter, opts?: QueryOpts) => {
    const { where, ne } = whereOf(filter);
    const fields = fieldsFor(schema, opts?.fields, ne.map(([k]) => k));
    const sort = opts?.sort;
    let rows: LibRow[];
    if (opts?.limit !== undefined && ne.length === 0 && opts.limit <= MAX_PAGE_SIZE) {
      const res = await gw.find(schema, { where, fields, ...(sort ? { sort } : {}), page: 1, pageSize: opts.limit });
      rows = res.items;
    } else if (opts?.limit !== undefined && ne.length === 0 && sort) {
      rows = await findNewest(gw, schema, { where, fields, sort }, opts.limit);
    } else {
      rows = await gw.findAll(schema, { where, fields, ...(sort ? { sort } : {}), max: DEFAULT_QUERY_MAX });
    }
    if (ne.length > 0) rows = rows.filter((r) => ne.every(([k, v]) => r[k] !== v));
    if (opts?.limit !== undefined && rows.length > opts.limit) rows = rows.slice(0, opts.limit);
    return rows as Row[];
  };

  const byIds: ScopeEnv["db"]["byIds"] = async (schema, ids) => {
    const unique = [...new Set(ids)];
    const out: LibRow[] = [];
    for (let i = 0; i < unique.length; i += MAX_IN) {
      out.push(...(await gw.findAll(schema, { where: f.in("ItemId", unique.slice(i, i + MAX_IN)), fields: fieldsFor(schema, undefined), max: MAX_IN })));
    }
    return out as Row[];
  };

  const list: ScopeEnv["jobs"]["list"] = async (kinds) => {
    if (kinds.length === 0) return [];
    // The newest rows only, paged at the gateway's 100: findAll's max throws limit_reached once more rows exist.
    return (await findNewest(
      gw,
      "EngineJob",
      {
        where: f.and(f.eq("ProjectId", projectId), f.in("Kind", [...kinds])),
        fields: fieldsFor("EngineJob", undefined),
        sort: { field: "CreatedDate", dir: "desc" },
      },
      JOBS_MAX,
    )) as Row[];
  };
  return { query, byIds, list };
}

function envFrom(ctx: OpCtx, deps: OpDeps, op: ScopeOpName, project: Row): ScopeEnv {
  const workspaceId = String(project.WorkspaceId);
  const projectId = project.ItemId;
  const gw = deps.gw;
  const { query, byIds, list } = readersOver(gw, projectId);

  const db: ScopeEnv["db"] = {
    query,
    byIds,
    async insert(schema, fields, naturalKey) {
      const res = await gw.insert(schema, { ...fields }, { requestKey: capKey(naturalKey) });
      if (res.created) {
        if (!res.itemId) throw new OpError("internal");
        return { id: res.itemId, created: true };
      }
      // A duplicate: the same RequestKey (the stored row's id comes back) or another unique index (no id).
      if (res.itemId) return { id: res.itemId, created: false };
      throw new UniqueConflictError(schema);
    },
    // One round: the stored row (with the stamps Blocks wrote) is read back by the handler's own byIds, in one batch.
    async update(schema, id, patch) {
      await gw.update(schema, id, patch);
      return { ...patch, ItemId: id } as Row;
    },
    // Every id removed here came from a row read of this project in this request (the handlers check it against the rows they
    // read), so the gateway's ownership read before the delete would only cost a round.
    async remove(schema, id) {
      await gw.remove(schema, id, { rowRead: true });
    },
  };

  const jobs: ScopeEnv["jobs"] = {
    async create(i) {
      const res = await deps.jobs.create({
        kind: i.kind as never,
        projectId,
        input: i.input,
        targetType: i.targetType,
        targetId: i.targetId,
        ...(i.eventKey !== undefined ? { eventKey: i.eventKey } : {}),
        ...(i.requestedByUserId !== undefined ? { requestedByUserId: i.requestedByUserId } : {}),
      });
      return { job: res.job as Row, existing: res.existing };
    },
    async cancel(jobId, actor) {
      try {
        return (await deps.jobs.cancel(jobId, { actor })) as Row;
      } catch (e) {
        if (e instanceof OpError && e.code === "conflict" && e.messageKey === "job.notCancellable") throw new JobNotCancellableError();
        throw e;
      }
    },
    list,
    cancelRows: (rows, actor) => deps.jobs.cancelRows(rows as LibRow[], { actor }),
  };

  const missing = (e: unknown): boolean => e instanceof OpError && e.code === "not_found";
  const files: ScopeEnv["files"] = {
    async presign(r: PresignPortRequest) {
      // The literals are fixed by design 5; _lib's files service applies them and the project directory.
      if (r.objectAccessLevel !== "Creator" || r.accessModifier !== "Private" || r.inheritsParentAccess !== false) {
        throw new TypeError("Scope uploads are Creator / Private / no inherited access.");
      }
      const res = await deps.files.presignUpload({
        projectId,
        fileName: r.fileName,
        mime: r.mime,
        sizeBytes: r.sizeBytes,
        maxBytes: r.maxBytes,
        allowedMimes: r.allowedMimes,
      });
      // _lib's PresignResult carries no required upload headers yet (Library follow-up): none are forwarded.
      return { storageObjectId: res.fileId, uploadUrl: res.uploadUrl, storedName: res.storedName, requiredHeaders: {} };
    },
    async info(id) {
      try {
        const i = await deps.files.info(id);
        return { sizeBytes: i.sizeBytes, mime: i.mime };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    head: (id, bytes) => deps.files.head(id, bytes),
    downloadUrl: (id) => deps.files.downloadUrl(id),
    async remove(id) {
      try {
        await deps.files.remove(id);
      } catch (e) {
        if (!missing(e)) throw e;
      }
    },
  };

  return {
    op,
    requestId: ctx.requestId,
    attempt: ctx.attempt,
    userId: ctx.caller.userId,
    now: ctx.now,
    nowIso: ctx.now.toISOString(),
    workspaceId,
    projectId,
    project,
    permissions: ctx.permissions,
    isSuperAdmin: ctx.caller.isSuperAdmin,
    async isActiveMember(userId) {
      try {
        await deps.refs.activeMembers([userId]);
        return true;
      } catch (e) {
        if (e instanceof OpError && e.code === "invalid_input") return false;
        throw e;
      }
    },
    db,
    jobs,
    files,
    audit: (targetType, targetId, details) => deps.audit({ targetType, targetId, ...(details ? { details } : {}) }),
    uuid5: (name) => deps.ids.uuid5(name),
    after: (work) => deps.after(work),
    flush: () => deps.flush(),
    issuedStamp: issuedStamp(ctx.now),
  };
}

/** The router's round-1 Project row carries every column; the own read is only the fallback for a thinner ctx.project. */
async function loadProject(ctx: OpCtx, deps: OpDeps): Promise<Row> {
  const id = ctx.project?.ItemId;
  if (typeof id !== "string") return deps.fail("not_found");
  if (ctx.project && "Stage" in ctx.project) return ctx.project as Row;
  const row = await deps.gw.get("Project", id, fieldsFor("Project", undefined));
  if (!row || typeof row.WorkspaceId !== "string") return deps.fail("not_found");
  return { ...row, ItemId: id } as Row;
}

/** Wraps one handler with defineOp: scope "project", args parsed by the def, the answer unwrapped. */
export function bindScopeOp(def: ScopeOpDef): OpDef {
  return defineOp({
    op: def.op,
    kind: def.kind,
    scope: "project",
    permission: def.permission,
    args: (raw: unknown) => {
      const p = def.parse(raw);
      if (!p.ok) throw new OpError("invalid_input", p.messageKey, p.params);
      return p.value;
    },
    ...(def.prefetch
      ? {
          prefetch: (p: { args: unknown; projectId?: string | null; workspaceId?: string | null; callerUserId: string; gw?: Gw | null }) => {
            if (!p.projectId || !p.gw) return undefined;
            const r = readersOver(p.gw, p.projectId);
            return def.prefetch!(
              { projectId: p.projectId, workspaceId: p.workspaceId ?? "", userId: p.callerUserId, db: { query: r.query, byIds: r.byIds, warmRemove: (schema, ids) => Promise.all(ids.map((id) => p.gw!.get(schema, id, ["ItemId"]))) }, jobs: { list: r.list } },
              p.args as never,
            );
          },
        }
      : {}),
    ...(def.record ? { record: def.record } : {}),
    async handler(ctx, args, deps) {
      const project = await loadProject(ctx, deps);
      const out = await def.run(envFrom(ctx, deps, def.op, project), args);
      return out.ok ? out.data : deps.fail(out.code, out.messageKey, out.params);
    },
  });
}

const ALL_DEFS: readonly ScopeOpDef[] = [
  ...OPEN_HANDLERS,
  ...SCOPE_SAVE_HANDLERS,
  ...LOCK_HANDLERS,
  ...MILESTONE_HANDLERS,
  ...SCOPE_JOB_HANDLERS,
  ...CHALLENGE_HANDLERS,
  ...FEEDBACK_HANDLERS,
  ...ATTACHMENT_HANDLERS,
  ...SCREEN_HANDLERS,
  ...SUCCESS_HANDLERS,
];

function buildOps(): Readonly<Record<ScopeOpName, OpDef>> {
  const out = {} as Record<ScopeOpName, OpDef>;
  const views: readonly string[] = SCOPE_VIEW_OPS;
  for (const def of ALL_DEFS) {
    if (!(SCOPE_OP_NAMES as readonly string[]).includes(def.op)) throw new Error(`scope ops: unknown op ${def.op}.`);
    if (out[def.op]) throw new Error(`scope ops: ${def.op} is defined twice.`);
    if (def.permission !== SCOPE_OP_PERMISSION[def.op]) {
      throw new Error(`scope ops: ${def.op} permission ${def.permission} differs from SCOPE_OP_PERMISSION.`);
    }
    if (def.kind !== (views.includes(def.op) ? "view" : "command")) throw new Error(`scope ops: ${def.op} has the wrong kind.`);
    out[def.op] = bindScopeOp(def);
  }
  for (const name of SCOPE_OP_NAMES) if (!out[name]) throw new Error(`scope ops: ${name} is missing.`);
  return Object.freeze(out);
}

export const SCOPE_OPS: Readonly<Record<ScopeOpName, OpDef>> = buildOps();

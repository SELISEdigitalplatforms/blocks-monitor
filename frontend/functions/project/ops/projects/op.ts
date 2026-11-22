/**
 * The Appendix A skeleton, written once for every op of this lane (a candidate to move into functions/_lib).
 * Depends only on the ports and the pure domain modules.
 */
import { can, isWorkspaceRole, type WorkspacePermission } from "../../../../src/domain/rbac";
import { workspacePermissionsFor } from "../../../../src/domain/roles";
import type { Check } from "../../../../src/domain/projects";
import { DuplicateKeyError, type FnAnswer, type FnCtx, type FnErrorCode, type FnRequest, type Ports, type ReadEnv, type Row } from "./ports";
import { SCHEMA, projectRec, type ProjectRec } from "./records";

export type OpOutcome<D> =
  | { ok: true; data: D }
  | { ok: false; code: FnErrorCode; messageKey?: string; params?: Record<string, unknown> };

export const ok = <D>(data: D): OpOutcome<D> => ({ ok: true, data });
export const fail = (code: FnErrorCode, messageKey?: string, params?: Record<string, unknown>): OpOutcome<never> => ({
  ok: false,
  code,
  messageKey,
  params,
});

export interface FieldSpec {
  type: "string" | "int" | "boolean" | "string[]" | "string|null";
  optional?: boolean;
  max?: number;
  maxItems?: number;
}

/** Rejects anything that is not an object with exactly the listed keys and types. */
export function strictArgs(args: unknown, spec: Record<string, FieldSpec>): Check<Record<string, unknown>> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, messageKey: "input.wrongType", params: { key: "args" } };
  }
  const input = args as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) return { ok: false, messageKey: "input.unknownKey", params: { key } };
  }
  const out: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(spec)) {
    const v = input[key];
    if (v === undefined) {
      if (f.optional) continue;
      return { ok: false, messageKey: "input.wrongType", params: { key } };
    }
    const bad = { ok: false as const, messageKey: "input.wrongType", params: { key } };
    switch (f.type) {
      case "string":
        if (typeof v !== "string") return bad;
        if (f.max !== undefined && v.length > f.max) return { ok: false, messageKey: "input.tooLong", params: { key, max: f.max } };
        break;
      case "string|null":
        if (v !== null && typeof v !== "string") return bad;
        if (typeof v === "string" && f.max !== undefined && v.length > f.max) {
          return { ok: false, messageKey: "input.tooLong", params: { key, max: f.max } };
        }
        break;
      case "int":
        if (typeof v !== "number" || !Number.isSafeInteger(v)) return bad;
        break;
      case "boolean":
        if (typeof v !== "boolean") return bad;
        break;
      case "string[]":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return bad;
        if (f.maxItems !== undefined && v.length > f.maxItems) {
          return { ok: false, messageKey: "input.tooMany", params: { key, max: f.maxItems } };
        }
        if (f.max !== undefined && v.some((x: string) => x.length > f.max!)) {
          return { ok: false, messageKey: "input.tooLong", params: { key, max: f.max } };
        }
        break;
    }
    out[key] = v;
  }
  return { ok: true, value: out };
}

export interface OpEnv {
  ports: Ports;
  op: string;
  requestId: string;
  userId: string;
  now: Date;
  nowIso: string;
  workspaceId: string;
  /** null only for ops of scope "workspace". */
  project: ProjectRec | null;
  projectRow: Row | null;
  permissions: readonly WorkspacePermission[];
  isSuperAdmin: boolean;
  /** A super admin acting in a workspace they are not a member of. */
  outsideMembership: boolean;
  /** The workspace's active members, memoised. */
  readerIds(): Promise<string[]>;
  /** Server stamps for an insert; any stamp keys in the input are dropped. */
  stampInsert(fields: Record<string, unknown>, localKey: string): Promise<Record<string, unknown>>;
  stampUpdate(patch: Record<string, unknown>): Record<string, unknown>;
  /** Insert once per (requestId, op, localKey); a retry returns the row the first run wrote. */
  insertOnce(schema: string, fields: Record<string, unknown>, localKey: string): Promise<Row>;
  audit(action: string, targetSchema: string, targetId: string, params?: Record<string, unknown>): Promise<void>;
  /** Last writes of a command: the router runs them in its bookkeeping round (without a router, runOp runs them before it answers). */
  after(work: () => Promise<unknown>): void;
  /** Writes the queued audit events and notifications now, so the handler's last round carries them. */
  flush(): Promise<void>;
  /** The LastUpdatedDate stamp this request's writes carry; answers echo it instead of reading the row back. */
  issuedStamp: string;
  /** True when a version conflict is really the caller's own earlier save that landed after the client gave up. */
  isOwnWrite(stored: Record<string, unknown>, values: Record<string, unknown>): boolean;
}

export interface OpDef<A, D> {
  op: string;
  permission: WorkspacePermission;
  scope: "workspace" | "project";
  /** Lets the op run on a project whose Status is "deleting" (the delete cascade itself). */
  allowDeleting?: boolean;
  /** false for answers that carry URLs: they are never stored. Default true. */
  storeAnswer?: boolean;
  parse(args: unknown): Check<A>;
  run(env: OpEnv, args: A): Promise<OpOutcome<D>>;
  /** Read-only; started inside the router's round 1 so the identical reads of run cost no round. */
  prefetch?: (env: ReadEnv, args: A) => unknown;
  /** false = no Operation record after the handler (every write must then be keyed or idempotent). */
  record?: (data: D) => boolean;
  /** Every write is RequestKey-keyed (insertOnce) or a repeatable `after` patch: on Host A the router may answer before
   *  the AuditEvent and Operation record are written (see functions/_lib/types.ts OpSpec.bookkeepingAfterAnswer). */
  bookkeepingAfterAnswer?: boolean;
}

const STAMP_KEYS = [
  "ItemId",
  "WorkspaceId",
  "ReaderIds",
  "CreatedByUserId",
  "UpdatedByUserId",
  "RequestKey",
  "CreatedDate",
  "LastUpdatedDate",
] as const;

function stripStamps(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (!(STAMP_KEYS as readonly string[]).includes(k)) out[k] = v;
  return out;
}

const failAnswer = (code: FnErrorCode, messageKey?: string, params?: Record<string, unknown>): FnAnswer => ({
  ok: false,
  error: { code, ...(messageKey ? { messageKey } : {}), ...(params ? { params } : {}) },
});

export async function runOp<A, D>(def: OpDef<A, D>, ports: Ports, ctx: FnCtx, req: FnRequest): Promise<FnAnswer<D>> {
  const answer = (code: FnErrorCode, key?: string, params?: Record<string, unknown>) =>
    failAnswer(code, key, params) as FnAnswer<D>;

  // 1. The caller comes only from the platform context.
  const userId = ctx.context.userId;
  if (!ctx.context.isAuthenticated || typeof userId !== "string" || !userId) return answer("forbidden", "auth.required");

  const raw = req.args;
  let projectId = "";
  if (def.scope === "project") {
    const pid = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).projectId : undefined;
    if (typeof pid !== "string" || !pid) return answer("invalid_input", "input.wrongType", { key: "projectId" });
    projectId = pid;
  }

  // 2. Account, Operation and (project scope) the Project row, in parallel.
  const [account, operation, projectRows] = await Promise.all([
    ports.accounts.get(userId),
    ports.operations.get(req.requestId),
    def.scope === "project" ? ports.db.query(SCHEMA.project, { ItemId: projectId }, { limit: 1 }) : Promise.resolve([] as Row[]),
  ]);
  if (!account || !account.active) return answer("account_inactive");
  if (operation?.status === "done" && operation.answer && def.storeAnswer !== false) return operation.answer as FnAnswer<D>;

  // 3. The workspace comes from the stored Project, never from args.
  let workspaceId: string;
  let projectRow: Row | null = null;
  let project: ProjectRec | null = null;
  if (def.scope === "project") {
    projectRow = projectRows[0] ?? null;
    if (!projectRow) return answer("not_found");
    project = projectRec(projectRow);
    workspaceId = project.workspaceId;
    const claimed = (raw as Record<string, unknown>).workspaceId;
    if (typeof claimed === "string" && claimed !== workspaceId) return answer("not_found");
    if (project.status === "deleting" && !def.allowDeleting) return answer("not_found");
  } else {
    const ws = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).workspaceId : undefined;
    if (typeof ws !== "string" || !ws) return answer("invalid_input", "input.wrongType", { key: "workspaceId" });
    workspaceId = ws;
  }

  // 4. Membership and permissions (custom roles are read only when needed).
  const membership = await ports.members.membership(workspaceId, userId);
  const isMember = membership?.status === "active";
  if (!isMember && !account.isSuperAdmin) return answer("not_member");
  const roleKey = isMember ? membership!.roleKey : "";
  const customRoles = isMember && !isWorkspaceRole(roleKey) ? await ports.members.customRoles(workspaceId) : [];
  const permissions = workspacePermissionsFor({ roleKey, isSuperAdmin: account.isSuperAdmin, customRoles });
  const outsideMembership = account.isSuperAdmin && !isMember;

  // 5. The permission this op names.
  if (!can(permissions, def.permission)) return answer("forbidden", "permission.missing", { permission: def.permission });

  // 6. Strict input.
  const parsed = def.parse(raw);
  if (!parsed.ok) return answer("invalid_input", parsed.messageKey, parsed.params);

  // 7. Run.
  const now = ports.clock.now();
  const nowIso = now.toISOString();
  let readers: Promise<string[]> | null = null;
  const lateWork: Array<() => Promise<unknown>> = [];
  const requestKeyFor = (localKey: string) =>
    ports.uuidv5(localKey.startsWith("natural:") ? localKey : `${req.requestId}:${def.op}:${localKey}`);
  const env: OpEnv = {
    ports,
    op: def.op,
    requestId: req.requestId,
    userId,
    now,
    nowIso,
    workspaceId,
    project,
    projectRow,
    permissions,
    isSuperAdmin: account.isSuperAdmin,
    outsideMembership,
    readerIds: () => (readers ??= ports.members.readerIds(workspaceId)),
    async stampInsert(fields, localKey) {
      return {
        ...stripStamps(fields),
        WorkspaceId: workspaceId,
        ReaderIds: await env.readerIds(),
        CreatedByUserId: userId,
        UpdatedByUserId: userId,
        RequestKey: requestKeyFor(localKey),
      };
    },
    stampUpdate: (patch) => ({ ...stripStamps(patch), UpdatedByUserId: userId }),
    async insertOnce(schema, fields, localKey) {
      const stamped = await env.stampInsert(fields, localKey);
      try {
        return await ports.db.insert(schema, stamped);
      } catch (err) {
        if (!(err instanceof DuplicateKeyError)) throw err;
        // The same fields as the first answer (stamps included), so a replay answers exactly what the first call did.
        const fields = [...new Set(["ItemId", "CreatedDate", "LastUpdatedDate", ...Object.keys(stamped)])];
        const rows = await ports.db.query(schema, { RequestKey: String(stamped.RequestKey) }, { limit: 1, fields });
        if (!rows[0]) throw err;
        return rows[0];
      }
    },
    audit: (action, targetSchema, targetId, params) =>
      ports.audit.write({ workspaceId, actorUserId: userId, action, targetSchema, targetId, params }),
    after: (work) => (ports.after ? ports.after(work) : void lateWork.push(work)),
    flush: () => (ports.flush ? ports.flush() : Promise.resolve()),
    issuedStamp: ports.issuedStamp ?? nowIso,
    isOwnWrite: (stored, values) => ports.isOwnWrite?.(stored, userId, values) ?? false,
  };

  await ports.operations.begin(req.requestId, def.op, userId);
  const outcome = await def.run(env, parsed.value);
  if (lateWork.length > 0) await Promise.all(lateWork.map((work) => work()));

  // 8. A super admin outside their memberships leaves a trail.
  if (outcome.ok && outsideMembership) {
    await env.audit(`superAdmin.${def.op}`, project ? SCHEMA.project : "Workspace", project?.id ?? workspaceId);
  }

  // 9. Answer and store.
  const final: FnAnswer<D> = outcome.ok
    ? { ok: true, data: outcome.data, serverNow: nowIso }
    : (failAnswer(outcome.code, outcome.messageKey, outcome.params) as FnAnswer<D>);
  if (def.storeAnswer !== false) await ports.operations.finish(req.requestId, final);
  return final;
}

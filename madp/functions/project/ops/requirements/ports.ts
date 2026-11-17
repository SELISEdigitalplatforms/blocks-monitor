/**
 * Lane L6 server plumbing: the ONE adapter surface. Every handler of the
 * requirements/ and design/ areas depends only on the ports declared here;
 * bind.ts maps them onto L2's functions/_lib. No SDK, React, src/blocks or
 * fetch( in this file (L2's contract test).
 */
import { NumberingConflictError } from "../../../../src/domain/numbering";
import { can, type WorkspacePermission } from "../../../../src/domain/rbac";
import { workspacePermissionsFor, type RoleDef } from "../../../../src/domain/roles";
import { isRequirementsStepOpen } from "../../../../src/domain/requirements";
import type { FactoryNoteInput } from "../../../../src/domain/factoryNotes";
import { toProject, wire, type ProjectRecord } from "./records";

export type OpErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "too_large";

/** A refusal with a code from src/blocks/fn.ts FUNCTION_ERROR_MESSAGES; specifics travel in messageKey and params. */
export class OpError extends Error {
  readonly code: OpErrorCode;
  readonly messageKey: string;
  readonly params?: Record<string, unknown>;
  constructor(code: OpErrorCode, messageKey: string, params?: Record<string, unknown>) {
    super(`${code}: ${messageKey}`);
    this.name = "OpError";
    this.code = code;
    this.messageKey = messageKey;
    this.params = params;
  }
}

export type OpEnvelope =
  | { ok: true; data: unknown; serverNow: string }
  | { ok: false; error: { code: OpErrorCode; messageKey: string; params?: Record<string, unknown> } };

export type Row = { ItemId: string } & Record<string, unknown>;
export type WhereValue = string | number | boolean | null | { in: readonly (string | number)[] };
export type Where = Record<string, WhereValue>;
export interface FindOptions {
  fields?: readonly string[];
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  limit?: number;
}

/** The service identity: used only for the Project lookup. */
export interface ServiceGateway {
  find(schema: string, where: Where, opts?: FindOptions): Promise<Row[]>;
  isDuplicateKey(e: unknown): boolean;
}

/**
 * Workspace-scoped gateway. insert drops ItemId, WorkspaceId, ReaderIds,
 * CreatedByUserId and UpdatedByUserId from the input, stamps them itself and
 * never sends an ItemId (the hosted gateway assigns it). update drops the same
 * keys, stamps UpdatedByUserId and refuses a row of another workspace.
 */
export interface ScopedGateway {
  readonly workspaceId: string;
  readonly readerIds: readonly string[];
  find(schema: string, where: Where, opts?: FindOptions): Promise<Row[]>;
  insert(schema: string, row: Record<string, unknown>): Promise<Row>;
  update(schema: string, itemId: string, patch: Record<string, unknown>): Promise<Row>;
  remove(schema: string, itemId: string): Promise<void>;
  isDuplicateKey(e: unknown): boolean;
}

export interface PresignRequest {
  fileName: string;
  contentType: string;
  sizeInBytes: number;
  objectAccessLevel: "Creator";
  inheritsParentAccess: false;
  accessModifier: "Private";
  parentDirectoryId: string;
}

/** L2's deps.files. remove is permanent and resolves when the file is already gone. */
export interface FilesPort {
  projectDirectory(workspaceId: string, projectId: string): Promise<string>;
  presignUpload(req: PresignRequest): Promise<{ fileId: string; uploadUrl: string; requiredHeaders: Record<string, string>; storedName?: string }>;
  info(fileId: string): Promise<{ sizeInBytes: number; contentType: string | null } | null>;
  head(fileId: string, length: number): Promise<Uint8Array>;
  downloadUrl(fileId: string): Promise<{ url: string; expiresAt: string }>;
  remove(fileId: string): Promise<void>;
}

/** L2's deps.jobs.create: one active job per kind and targetKey, so a second call returns the open job (created:false). */
export interface JobsPort {
  create(req: {
    workspaceId: string;
    projectId: string;
    kind: "requirements.draft" | "design.generate";
    targetKey: string;
    input: Record<string, unknown>;
    actorUserId: string;
  }): Promise<{ job: Row; created: boolean }>;
}

export interface AccessPort {
  accountStatus(userId: string): Promise<string | null>;
  membership(workspaceId: string, userId: string): Promise<{ roleKey: string; status: string } | null>;
  customRoles(workspaceId: string): Promise<RoleDef[]>;
  audit(e: {
    workspaceId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
}

export interface OperationsPort {
  load(requestId: string): Promise<{ status: "pending" | "done" | "failed"; result: OpEnvelope | null } | null>;
  begin(rec: { requestId: string; op: string; workspaceId: string; projectId: string; actorUserId: string }): Promise<void>;
  finish(requestId: string, envelope: OpEnvelope): Promise<void>;
}

/** One AuditEvent a handler asks for: ids, counts and statuses only (no free text). */
export interface LaneAuditInput {
  action?: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

export interface LaneDeps {
  gateway: ServiceGateway;
  scoped(workspaceId: string, actorUserId: string): Promise<ScopedGateway>;
  files: FilesPort;
  jobs: JobsPort;
  access: AccessPort;
  operations: OperationsPort;
  /** L10 notification writer (deps.notify): queued now, flushed by the router after the handler. */
  notify(n: FactoryNoteInput): void;
  now(): Date;
  /** The last writes of a command: they run in the router's bookkeeping round (a failure marks the run failed, so a retry runs the handler again). */
  after(work: () => Promise<unknown>): void;
  /** Writes the queued audit events and notifications now (for an op that answers with record false). */
  flush(): Promise<void>;
  /** Queues one AuditEvent for the request (never awaited): the router's bookkeeping round, or handle() once the op has answered. */
  audit(e: LaneAuditInput): void;
}

/** Marks a LaneDeps.audit as a placeholder: handle() then queues the events itself and writes them through deps.access.audit (the in-memory deps). */
export const handleWritesAudit = (fn: (e: LaneAuditInput) => void): ((e: LaneAuditInput) => void) =>
  Object.assign(fn, { handleWritesAudit: true as const });

export interface CallerContext {
  isAuthenticated: boolean;
  userId: string | null;
  roles: readonly string[];
}

export interface OpCall {
  op: string;
  requestId: string;
  args: unknown;
  context: CallerContext;
}

export const SUPER_ADMIN_ROLE = "mf-super-admin";

export interface LaneOpContext {
  requestId: string;
  /** An Operation for this requestId was left pending: the op completes or repairs instead of starting over. */
  retry: boolean;
  /** The requirements step is closed; only an op with `closedStepChecked` runs then. */
  stepClosed?: boolean;
  actorUserId: string;
  isSuperAdmin: boolean;
  isMember: boolean;
  permissions: readonly WorkspacePermission[];
  project: ProjectRecord;
  workspaceId: string;
  db: ScopedGateway;
  deps: LaneDeps;
  now: Date;
}

/** What a prefetch reads with: the same loaders and field lists as the handler, so its reads fill the request memo. */
export interface LaneReadEnv {
  workspaceId: string;
  actorUserId: string;
  project: { id: string };
  db: ScopedGateway;
}

export interface LaneOpSpec<A extends { projectId: string }, R> {
  op: string;
  permission: WorkspacePermission;
  requireOpenStep: boolean;
  /** The op runs on a closed step too and checks `ctx.stepClosed` itself (a keyed create whose answer is not recorded must answer its repeat). */
  closedStepChecked?: boolean;
  /** true for an op that only reads (answers are then never stored in the Operation record). */
  readOnly?: boolean;
  parse(args: Record<string, unknown>): A;
  run(ctx: LaneOpContext, args: A): Promise<R>;
  /** Starts the run's first reads inside round 1 of the router (read only; the result is never used). */
  prefetch?(env: LaneReadEnv, args: A): unknown;
  /** false skips the Operation record for this answer (a retry then runs the op again). */
  record?(data: R): boolean;
}

export interface LaneOp {
  readonly op: string;
  readonly permission: WorkspacePermission;
  /** The op's spec; bind.ts turns it into a functions/_lib defineOp. */
  readonly spec: LaneOpSpec<any, any>;
  readonly prefetch?: LaneOpSpec<any, any>["prefetch"];
  readonly record?: LaneOpSpec<any, any>["record"];
  handle(deps: LaneDeps, call: OpCall): Promise<OpEnvelope>;
}

const BUILT_IN_ROLE_KEYS = ["owner", "member", "viewer"];

function failure(e: OpError): OpEnvelope {
  const error: { code: OpErrorCode; messageKey: string; params?: Record<string, unknown> } = {
    code: e.code,
    messageKey: e.messageKey,
  };
  if (e.params) error.params = e.params;
  return { ok: false, error };
}

/**
 * Builds a handler that follows the design's Appendix A skeleton, in this order:
 *  1. the actor comes ONLY from the caller's context (never from the input); unauthenticated → forbidden;
 *  2. a deactivated account is refused;
 *  3. the Operation for the requestId: done → answer the stored result with no other read or write;
 *     pending → this is a retry that completes or repairs;
 *  4. validate the shape of the input (projectId, then the op's own parse);
 *  5. load the project; 6. load the caller's membership of the project's workspace and resolve the
 *     permissions (custom roles included; the super admin holds all);
 *  7. check the permission; 8. check the step is still open;
 *  9. begin the Operation, take the scoped gateway (it stamps WorkspaceId, ReaderIds, CreatedByUserId and
 *     UpdatedByUserId and ignores such keys in the input) and run;
 * 10. the op's own AuditEvents (deps.audit) are written after run; a super admin outside their own memberships gets
 * viaPlatform folded into them, or one generic AuditEvent when the op wrote none; 11. answer and finish the Operation.
 * An unexpected error is rethrown WITHOUT finishing, so a retry of the same requestId repairs.
 */
export function defineLaneOp<A extends { projectId: string }, R>(spec: LaneOpSpec<A, R>): LaneOp {
  return {
    op: spec.op,
    permission: spec.permission,
    spec,
    prefetch: spec.prefetch,
    record: spec.record,
    async handle(depsIn, call) {
      // The hosted router runs `after` work in its bookkeeping round; here it runs once the op has answered.
      const afterWork: Array<() => Promise<unknown>> = [];
      const events: LaneAuditInput[] = [];
      const supplied = depsIn.audit && !(depsIn.audit as { handleWritesAudit?: boolean }).handleWritesAudit ? depsIn.audit : null;
      let audited = false;
      let viaPlatform = false;
      const deps: LaneDeps = {
        ...depsIn,
        after: (work) => void afterWork.push(work),
        audit: (e) => {
          audited = true;
          const ev = viaPlatform ? { ...e, details: { ...(e.details ?? {}), viaPlatform: true } } : e;
          if (supplied) supplied(ev);
          else events.push(ev);
        },
      };
      const ctxIn = call.context;
      const actor = ctxIn.userId;
      if (!ctxIn.isAuthenticated || !actor) return failure(new OpError("forbidden", "auth.required"));

      const status = await deps.access.accountStatus(actor);
      if (status !== null && status !== "active") return failure(new OpError("account_inactive", "account.inactive"));

      const prior = await deps.operations.load(call.requestId);
      let retry = false;
      if (prior) {
        if ((prior.status === "done" || prior.status === "failed") && prior.result) return prior.result;
        retry = true;
      }

      let workspaceId = "";
      let began = false;
      const finish = async (envelope: OpEnvelope): Promise<OpEnvelope> => {
        if (began || retry) await deps.operations.finish(call.requestId, envelope);
        return envelope;
      };

      try {
        const raw = call.args;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new OpError("invalid_input", "input.invalid", { field: "projectId", reason: "required" });
        }
        const o = raw as Record<string, unknown>;
        const projectId = o.projectId;
        if (typeof projectId !== "string" || projectId.length === 0 || projectId.length > 64) {
          throw new OpError("invalid_input", "input.invalid", { field: "projectId", reason: "required" });
        }
        const args = spec.parse(o);

        const found = await deps.gateway.find("Project", { ItemId: projectId }, { limit: 1 });
        if (found.length === 0) throw new OpError("not_found", "project.notFound");
        const project = toProject(found[0]);
        workspaceId = project.workspaceId;
        if (!workspaceId) throw new OpError("not_found", "project.notFound");

        const isSuperAdmin = ctxIn.roles.includes(SUPER_ADMIN_ROLE);
        const membership = await deps.access.membership(workspaceId, actor);
        const isMember = !!membership && membership.status === "active";
        if (!isMember && !isSuperAdmin) throw new OpError("not_member", "workspace.notMember");
        const roleKey = isMember ? membership!.roleKey : "";
        const customRoles =
          roleKey && !isSuperAdmin && !BUILT_IN_ROLE_KEYS.includes(roleKey) ? await deps.access.customRoles(workspaceId) : [];
        viaPlatform = isSuperAdmin && !isMember;
        const permissions = workspacePermissionsFor({ roleKey, isSuperAdmin, customRoles });

        if (!can(permissions, spec.permission)) {
          throw new OpError("forbidden", "permission.denied", { permission: spec.permission });
        }
        if (spec.requireOpenStep && !isRequirementsStepOpen(project.stage)) {
          throw new OpError("conflict", "requirements.closed");
        }

        if (!retry) {
          await deps.operations.begin({
            requestId: call.requestId,
            op: spec.op,
            workspaceId,
            projectId,
            actorUserId: actor,
          });
        }
        began = true;
        const db = await deps.scoped(workspaceId, actor);
        const now = deps.now();
        const data = await spec.run(
          { requestId: call.requestId, retry, actorUserId: actor, isSuperAdmin, isMember, permissions, project, workspaceId, db, deps, now },
          args,
        );
        await Promise.all(afterWork.map((work) => work()));
        await Promise.all(
          events.map((e) =>
            deps.access.audit({
              workspaceId,
              actorUserId: actor,
              action: e.action ?? spec.op,
              targetType: e.targetType,
              targetId: e.targetId,
              ...(e.details ? { detail: e.details } : {}),
            }),
          ),
        );
        if (viaPlatform && !audited) {
          await deps.access.audit({
            workspaceId,
            actorUserId: actor,
            action: spec.op,
            targetType: "project",
            targetId: projectId,
            detail: { op: spec.op },
          });
        }
        const envelope: OpEnvelope = { ok: true, data, serverNow: now.toISOString() };
        return await finish(envelope);
      } catch (e) {
        if (e instanceof OpError) return finish(failure(e));
        if (e instanceof NumberingConflictError) return finish(failure(new OpError("conflict", "numbering.busy")));
        throw e;
      }
    },
  };
}

// ---- input parse helpers (all throw OpError invalid_input / input.invalid {field, reason}) ----

function bad(field: string, reason: string, index?: number): OpError {
  const params: Record<string, unknown> = { field, reason };
  if (index !== undefined) params.index = index;
  return new OpError("invalid_input", "input.invalid", params);
}

const isMissing = (v: unknown) => v === undefined || v === null;

export function argString(o: Record<string, unknown>, key: string, opts: { max: number; optional: true; allowEmpty?: boolean }): string | undefined;
export function argString(o: Record<string, unknown>, key: string, opts?: { max: number; optional?: false; allowEmpty?: boolean }): string;
export function argString(o: Record<string, unknown>, key: string, optsIn?: { max: number; optional?: boolean; allowEmpty?: boolean }): string | undefined {
  const opts = optsIn ?? { max: 200 };
  const v = o[key];
  if (isMissing(v)) {
    if (opts.optional) return undefined;
    throw bad(key, "required");
  }
  if (typeof v !== "string") throw bad(key, "type");
  if (v.length === 0 && !opts.allowEmpty) throw bad(key, "required");
  if (v.length > opts.max) throw bad(key, "tooLong");
  return v;
}

export function argInt(o: Record<string, unknown>, key: string, opts: { min: number; optional: true }): number | undefined;
export function argInt(o: Record<string, unknown>, key: string, opts: { min: number; optional?: false }): number;
export function argInt(o: Record<string, unknown>, key: string, opts: { min: number; optional?: boolean }): number | undefined {
  const v = o[key];
  if (isMissing(v)) {
    if (opts.optional) return undefined;
    throw bad(key, "required");
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw bad(key, "type");
  if (v < opts.min) throw bad(key, "tooSmall");
  return v;
}

export function argBool(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (isMissing(v)) return false;
  if (typeof v !== "boolean") throw bad(key, "type");
  return v;
}

export function argStringArray(o: Record<string, unknown>, key: string, opts: { maxItems: number; maxLength: number; optional: true }): string[] | undefined;
export function argStringArray(o: Record<string, unknown>, key: string, opts: { maxItems: number; maxLength: number; optional?: false }): string[];
export function argStringArray(o: Record<string, unknown>, key: string, opts: { maxItems: number; maxLength: number; optional?: boolean }): string[] | undefined {
  const v = o[key];
  if (isMissing(v)) {
    if (opts.optional) return undefined;
    throw bad(key, "required");
  }
  if (!Array.isArray(v)) throw bad(key, "type");
  if (v.length > opts.maxItems) throw bad(key, "tooMany");
  v.forEach((x, i) => {
    if (typeof x !== "string") throw bad(key, "type", i);
    if (x.length > opts.maxLength) throw bad(key, "tooLong", i);
  });
  return v as string[];
}

export function argEnum<T extends string>(o: Record<string, unknown>, key: string, values: readonly T[], opts: { optional: true }): T | undefined;
export function argEnum<T extends string>(o: Record<string, unknown>, key: string, values: readonly T[], opts?: { optional?: false }): T;
export function argEnum<T extends string>(o: Record<string, unknown>, key: string, values: readonly T[], opts?: { optional?: boolean }): T | undefined {
  const v = o[key];
  if (isMissing(v)) {
    if (opts?.optional) return undefined;
    throw bad(key, "required");
  }
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) throw bad(key, "value");
  return v as T;
}

// ---- answers: the changed records, so the web can write them straight into its cache ----

export type ChangedSchema = "Requirement" | "Objective" | "ItemVersion" | "Suggestion" | "DesignBrief" | "Attachment" | "Project" | "EngineJob";
export type ChangedRows = Partial<Record<ChangedSchema, Row[]>>;
export type RemovedIds = Partial<Record<ChangedSchema, string[]>>;

/** Adds a row to the answer (replacing one with the same ItemId); ReaderIds never leaves the server. */
export function addChanged(changed: ChangedRows, schema: ChangedSchema, row: Row): void {
  const list = changed[schema] ?? (changed[schema] = []);
  const w = wire(row);
  const i = list.findIndex((r) => r.ItemId === w.ItemId);
  if (i >= 0) list[i] = w;
  else list.push(w);
}

/** The lane's message-key catalogue per error code; every op and the web's messages.ts share it. */
export const MESSAGE_KEYS = {
  forbidden: ["auth.required", "permission.denied"],
  account_inactive: ["account.inactive"],
  not_member: ["workspace.notMember"],
  not_found: ["project.notFound", "requirement.notFound", "objective.notFound", "suggestion.notFound", "attachment.notFound", "version.notFound"],
  conflict: [
    "requirements.closed",
    "version.stale",
    "requirement.removed",
    "suggestion.transition",
    "reorder.mismatch",
    "design.notSampleMode",
    "design.sampleOrder",
    "design.uploadMissing",
    "numbering.busy",
  ],
  invalid_input: ["input.invalid", "requirements.blockers", "design.type", "design.notConfirmable"],
  limit_reached: ["requirement.limit", "criteria.tooMany", "design.tooManySamples", "design.totalTooLarge"],
  too_large: ["design.fileTooLarge"],
} as const satisfies Record<OpErrorCode, readonly string[]>;

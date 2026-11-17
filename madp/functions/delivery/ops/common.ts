/**
 * ARCHITECTURE (restate where it matters; reviewers enforce it):
 * - Reads go browser -> Data Gateway under the row policies (UserId IN ReaderIds).
 *   Nothing the server must enforce is ever a client filter.
 * - EVERY write goes through an mf-delivery op, which runs through runOp below.
 * - The caller comes only from ctx.context (ports.caller()), never from args.
 * - WorkspaceId comes from the Project row loaded as the service, never from the client.
 * - WorkspaceId, ReaderIds, CreatedByUserId and UpdatedByUserId are stamped here (ctx.stamp / ctx.touch).
 * - Idempotency is by requestId (Operation record) plus RequestKey on every insert.
 * - Answers carry codes, messageKeys and scalar params only: never free text or stacks.
 * - F0: never send ItemId on insert; use the ItemId the gateway returns.
 * Target: at most 3 sequential gateway round trips per operation (batch with Promise.all).
 * Imports src/domain by relative path only, so the function bundle can include it.
 */
import { factoryNote } from "../../../src/domain/factoryNotes";
import { NumberingConflictError } from "../../../src/domain/numbering";
import type { Environment } from "../../../src/domain/promotion";
import { can, type WorkspacePermission } from "../../../src/domain/rbac";
import { workspacePermissionsFor } from "../../../src/domain/roles";
import type { RuleFail } from "../../../src/domain/delivery";
import type {
  ActiveMember,
  DeliveryErrorCode,
  DeliveryPorts,
  ErrorParams,
  NotificationKind,
  OpAnswer,
  ReadPorts,
  Row,
  Scalar,
} from "./ports";

export type DeliveryOpName =
  | "ticket.comment"
  | "ticket.move"
  | "build.start"
  | "build.retryAfterDeploy"
  | "cr.saveDraft"
  | "cr.startBuild"
  | "cr.submit"
  | "cr.answer"
  | "cr.decide"
  | "cr.fixChecks"
  | "cr.checksPolicy"
  | "cr.markKnown"
  | "cr.parallelStreams"
  | "cr.continueIncrements"
  | "approvalPolicy.save"
  | "approvalRequest.create"
  | "approvalRequest.decide"
  | "approvalRequest.cancel"
  | "release.promote"
  | "milestone.accept"
  | "milestone.feedback";

export class OpFailure extends Error {
  readonly code: DeliveryErrorCode;
  readonly messageKey: string;
  readonly params: ErrorParams;
  constructor(code: DeliveryErrorCode, messageKey: string, params: ErrorParams = {}) {
    super(messageKey);
    this.name = "OpFailure";
    this.code = code;
    this.messageKey = messageKey;
    this.params = params;
  }
}

export function fail(code: DeliveryErrorCode, messageKey: string, params: ErrorParams = {}): never {
  throw new OpFailure(code, messageKey, params);
}

/** Maps a pure-rule refusal (src/domain/delivery) to an OpFailure. */
export function failFromRule(r: RuleFail): never {
  return fail(r.code, r.messageKey, r.field !== undefined ? { field: r.field } : {});
}

export interface OpContext {
  ports: DeliveryPorts;
  op: DeliveryOpName;
  requestId: string;
  now: string;
  caller: {
    userId: string;
    isSuperAdmin: boolean;
    isMember: boolean;
    displayName: string;
    roleKey: string | null;
  };
  readonly permissions: readonly WorkspacePermission[];
  can(p: WorkspacePermission): boolean;
  project: Row;
  projectId: string;
  workspaceId: string;
  readonly members: readonly ActiveMember[];
  readonly activeMemberIds: readonly string[];
  /** Resolves once the caller's membership and permission are checked (rejects with the refusal). An `overlap` handler awaits it before any write, notification or audit, or before it reads members or permissions. */
  authorized(): Promise<void>;
  /** Adds WorkspaceId, ReaderIds, CreatedByUserId, UpdatedByUserId; overrides client copies; refuses ItemId. */
  stamp(row: Record<string, unknown>): Record<string, unknown>;
  /** A patch for update(): owner fields stripped, UpdatedByUserId set. */
  touch(patch: Record<string, unknown>): Record<string, unknown>;
  /** `${op}:${requestId}` or `${op}:${requestId}:${local}`. */
  requestKey(local?: string): string;
  /** Writes whose result is not in the answer: queued for the router's bookkeeping round, else run now. */
  after(work: () => Promise<unknown>): Promise<void>;
  notify(
    recipients: readonly string[],
    kind: NotificationKind,
    params: Record<string, Scalar>,
    environment: Environment,
  ): Promise<void>;
  /** Notes for the project's followers (assignee, else creator; optionally the caller), written by the router's notification writer. */
  notifyFollowers(n: {
    kind: "build.started";
    discriminator: string;
    params?: Record<string, string | number>;
    withActor: boolean;
  }): Promise<void>;
  audit(action: string, targetType: string, targetId: string, details: ErrorParams): Promise<void>;
  /** Writes the queued audit and notification rows now, so they share the round of the handler's own writes. */
  flush(): Promise<void>;
}

export interface OpDef<A extends { projectId: string }> {
  /** Any one of these permissions lets the caller in. */
  permission: WorkspacePermission | readonly WorkspacePermission[];
  validate(args: unknown): A;
  /** The handler starts while the membership check runs; it must await ctx.authorized() before it writes. */
  overlap?: boolean;
  handler(ctx: OpContext, args: A): Promise<unknown>;
  /**
   * The handler's first reads, started inside the router's round 1 (read-only, before the caller is authorised).
   * They must be the SAME calls the handler makes later (same schema, filter, sort, limit and fields) so the
   * per-request memo answers those for free. Only ports.query and ports.getById exist here.
   */
  prefetch?(ports: ReadPorts, args: A): unknown;
  /** false = no Operation record for this answer; only for ops whose every write is keyed or idempotent. */
  record?(data: unknown): boolean;
}

export function defineDeliveryOp<A extends { projectId: string }>(def: OpDef<A>): OpDef<A> {
  return def;
}

// ------------------------------------------------------------------ validators

const invalid = (field: string): never => fail("invalid_input", "delivery.args.invalid", { field });

export function strictArgs(args: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return invalid("args");
  const proto = Object.getPrototypeOf(args);
  if (proto !== Object.prototype && proto !== null) return invalid("args");
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if (!allowedKeys.includes(key)) return invalid(key);
    out[key] = (args as Record<string, unknown>)[key];
  }
  return out;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function idArg(v: unknown, field: string): string {
  return typeof v === "string" && ID_PATTERN.test(v) ? v : invalid(field);
}

export function optionalIdArg(v: unknown, field: string): string | undefined {
  return v === undefined || v === null ? undefined : idArg(v, field);
}

export function stringArg(v: unknown, field: string, max: number): string {
  return typeof v === "string" && v.length <= max ? v : invalid(field);
}

export function enumArg<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : invalid(field);
}

export function boolArg(v: unknown, field: string): boolean {
  return typeof v === "boolean" ? v : invalid(field);
}

export function intArg(v: unknown, field: string, min: number, max: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : invalid(field);
}

export function arrayArg(v: unknown, field: string, max: number): unknown[] {
  return Array.isArray(v) && v.length <= max ? [...v] : invalid(field);
}

// --------------------------------------------------------------- starting work

const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set(["queued", "claimed", "running"]);
/** How many finished jobs one start steps past (each under its own derived key) before it gives up. */
export const MAX_FINISHED_KEYS = 4;

/**
 * Starts an engine job and makes sure it really runs: every op that starts work goes through here, never through
 * ports.createEngineJob directly. A dedupe key that names a job which already FINISHED (succeeded, failed or cancelled:
 * a key that collides with an earlier build's, or a count read before that build was visible) would answer that
 * finished job, and the op would report a start, and mark its record building, while nothing works. So the job is
 * asked for again under a key derived from the finished one (`<key>~<finished job id>`): the op already decided that new
 * work is needed, and the same request replayed derives the same keys and gets the same new job. A job that is queued,
 * claimed or running is answered as it is (a double click, a replay). After MAX_FINISHED_KEYS finished jobs in a row
 * the start fails in plain words instead.
 *
 * `owner` (a build of one change request or milestone): an active job that answers the start must be work of that same
 * record. The hosted store keeps one active job per (project, ActiveKey), the ActiveKey being "<kind>:<target id>" or
 * "<kind>:project" without a target; a start whose key was shared answered ANOTHER record's running build (09.11.2026,
 * PrimaBook: CR-021's and CR-020's starts both answered CR-018's build, so the page said "requested" and nothing was
 * queued). The ops now give every build its own target, and an active answer that belongs to another record is refused
 * as "another build is running", never reported as this one's start.
 */
export async function startEngineJob(
  ports: DeliveryPorts,
  job: Parameters<DeliveryPorts["createEngineJob"]>[0],
  owner?: { field: "changeRequestId" | "milestoneId"; id: string },
): Promise<{ jobId: string; existing: boolean; status: string }> {
  let dedupeKey = job.dedupeKey;
  for (let i = 0; i <= MAX_FINISHED_KEYS; i++) {
    const res = await ports.createEngineJob({ ...job, dedupeKey });
    if (!res.existing) return res;
    if (ACTIVE_JOB_STATUSES.has(res.status)) {
      if (owner && !(await jobBelongsTo(ports, res.jobId, owner))) fail("conflict", "delivery.build.active");
      return res;
    }
    dedupeKey = `${job.dedupeKey}~${res.jobId}`;
  }
  return fail("conflict", "delivery.job.notStarted");
}

/** False when the stored job's input names another record than `owner` (another changeRequestId or milestoneId). A
 *  job written a moment ago that cannot be read yet is the one this start's own key wrote: it is taken as it is. */
async function jobBelongsTo(ports: DeliveryPorts, jobId: string, owner: { field: "changeRequestId" | "milestoneId"; id: string }): Promise<boolean> {
  const row = await ports.getById("EngineJob", jobId).catch(() => null);
  if (!row) return true;
  try {
    const input = JSON.parse(typeof row.InputJson === "string" ? row.InputJson : "") as Record<string, unknown> | null;
    return !!input && typeof input === "object" && input[owner.field] === owner.id;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------- runOp

export async function runOp<A extends { projectId: string }>(
  ports: DeliveryPorts,
  meta: { op: DeliveryOpName; requestId: string },
  def: OpDef<A>,
  args: unknown,
): Promise<OpAnswer> {
  const now = ports.now();
  const { op, requestId } = meta;
  const refuse = (code: DeliveryErrorCode, messageKey: string, params: ErrorParams = {}): OpAnswer => ({
    ok: false,
    error: { code, messageKey, params },
    serverNow: now,
  });

  // (1) the caller, from ctx.context only
  const who = ports.caller();
  if (!who.userId) return refuse("forbidden", "delivery.auth.unauthenticated");
  const userId = who.userId;

  // (2) account and replay in one round trip
  const [account, replay] = await Promise.all([ports.account(userId), ports.beginOperation(requestId, op)]);
  if (!account || account.status !== "active") return refuse("account_inactive", "delivery.auth.inactive");
  if (replay) return replay;

  let answer: OpAnswer;
  try {
    // (3) strict input
    const a = def.validate(args);

    // (4) the project, as the service; WorkspaceId is derived from it
    const project = await ports.getById("Project", a.projectId);
    const workspaceId = project?.WorkspaceId;
    if (!project || typeof workspaceId !== "string" || !workspaceId) {
      return await finish(refuse("not_found", "delivery.project.notFound"));
    }

    // (5) membership and permission. Started now; an `overlap` handler runs its first reads at the same
    // time and awaits ctx.authorized() before it writes, notifies or audits, so this costs no extra round.
    let permissions: readonly WorkspacePermission[] = [];
    let members: readonly ActiveMember[] = [];
    let activeMemberIds: readonly string[] = [];
    const ctx: OpContext = {
      ports,
      op,
      requestId,
      now,
      caller: { userId, isSuperAdmin: who.isSuperAdmin, isMember: false, displayName: "", roleKey: null },
      get permissions() {
        return permissions;
      },
      can: (p) => can(permissions, p),
      project,
      projectId: a.projectId,
      workspaceId,
      get members() {
        return members;
      },
      get activeMemberIds() {
        return activeMemberIds;
      },
      authorized: () => authP,
      stamp(row) {
        if ("ItemId" in row) throw new TypeError("stamp: rows never carry ItemId (F0)");
        return {
          ...row,
          WorkspaceId: workspaceId,
          ReaderIds: [...activeMemberIds],
          CreatedByUserId: userId,
          UpdatedByUserId: userId,
        };
      },
      touch(patch) {
        const { ItemId: _i, WorkspaceId: _w, ReaderIds: _r, CreatedByUserId: _c, ...rest } = patch;
        return { ...rest, UpdatedByUserId: userId };
      },
      requestKey: (local) => (local === undefined ? `${op}:${requestId}` : `${op}:${requestId}:${local}`),
      async after(work) {
        if (ports.after) ports.after(work);
        else await work();
      },
      async notify(recipients, kind, params, environment) {
        const unique = [...new Set(recipients)].filter((r) => !!r && activeMemberIds.includes(r));
        await Promise.all(
          unique.map((recipientUserId) =>
            ports.notify({
              workspaceId,
              projectId: a.projectId,
              recipientUserId,
              kind,
              params: { ...params, projectId: a.projectId, environment },
              link: `/p/${a.projectId}/delivered?env=${environment}`,
              dedupeKey: ports.uuid5(`${op}:${requestId}:${recipientUserId}`),
            }),
          ),
        );
      },
      async notifyFollowers(n) {
        const note = factoryNote(n.kind, {
          projectId: a.projectId,
          discriminator: n.discriminator,
          params: n.params,
          withActor: n.withActor,
        });
        await ports.notify({
          workspaceId,
          projectId: a.projectId,
          kind: n.kind,
          audience: note.audience,
          params: note.params ?? {},
          link: note.link,
          dedupeKey: note.eventKey,
        });
      },
      flush: async () => {
        if (ports.flush) await ports.flush();
      },
      audit: (action, targetType, targetId, details) =>
        ports.audit({
          workspaceId,
          projectId: a.projectId,
          actorUserId: userId,
          actorIsSuperAdmin: who.isSuperAdmin,
          action,
          targetType,
          targetId,
          details,
        }),
    };

    const authorize = async (): Promise<void> => {
      let me: ActiveMember | undefined;
      let granted: readonly WorkspacePermission[];
      if (ports.routed) {
        // The router has already loaded the membership, the roles and the member ids: no round trip here.
        const r = await ports.routed();
        me = r.me ?? undefined;
        if (!me && !who.isSuperAdmin) return fail("not_member", "delivery.auth.notMember");
        granted = r.permissions;
        members = r.memberIds.map((id) => (me && me.userId === id ? me : { userId: id, roleKey: "", displayName: "" }));
        activeMemberIds = [...r.memberIds];
      } else {
        const [loadedMembers, roles] = await Promise.all([ports.activeMembers(workspaceId), ports.customRoles(workspaceId)]);
        me = loadedMembers.find((m) => m.userId === userId);
        if (!me && !who.isSuperAdmin) return fail("not_member", "delivery.auth.notMember");
        granted = workspacePermissionsFor({ roleKey: me?.roleKey, isSuperAdmin: who.isSuperAdmin, customRoles: roles });
        members = loadedMembers;
        activeMemberIds = loadedMembers.map((m) => m.userId);
      }
      const wanted = Array.isArray(def.permission) ? def.permission : [def.permission as WorkspacePermission];
      if (!wanted.some((p) => can(granted, p))) {
        return fail("forbidden", "delivery.auth.forbidden", { permission: wanted.join(",") });
      }
      permissions = granted;
      ctx.caller = {
        userId,
        isSuperAdmin: who.isSuperAdmin,
        isMember: !!me,
        displayName: me?.displayName ?? "",
        roleKey: me?.roleKey ?? null,
      };
      // (6) a super admin acting outside their own membership is always audited
      if (!me && who.isSuperAdmin) await ctx.audit("superadmin.access", "Project", a.projectId, { op });
    };
    const authP = authorize();
    authP.catch(() => undefined); // observed here; the awaits below rethrow it

    // (7) the handler
    let data: unknown;
    if (def.overlap) {
      const [auth, h] = await Promise.allSettled([authP, Promise.resolve().then(() => def.handler(ctx, a))]);
      if (auth.status === "rejected") throw auth.reason;
      if (h.status === "rejected") throw h.reason;
      data = h.value;
    } else {
      await authP;
      data = await def.handler(ctx, a);
    }
    answer = { ok: true, data, serverNow: now };
  } catch (e) {
    if (e instanceof OpFailure) {
      answer = refuse(e.code, e.messageKey, e.params);
    } else if (e instanceof NumberingConflictError) {
      answer = refuse("conflict", "delivery.numbering.conflict");
    } else {
      // Anything else is rethrown untouched and never finished: the platform retry replays safely.
      throw e;
    }
  }
  return finish(answer);

  async function finish(a: OpAnswer): Promise<OpAnswer> {
    await ports.finishOperation(requestId, op, a);
    return a;
  }
}

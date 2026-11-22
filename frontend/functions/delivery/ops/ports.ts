/**
 * The ONLY dependency the mf-delivery handlers have: a narrow port interface.
 * The coordinator binds it to the hosted router (functions/_lib, L2) in bind.ts
 * after L2/L2b land; tests bind it to testing/fakePorts.ts.
 * Imports types from src/domain only, so nothing here pulls in React, the DOM or src/blocks.
 */
import type { EngineJobKind } from "../../../src/domain/engineJob";
import type { NotificationAudience } from "../../../src/domain/factoryNotes";
import type { WorkspacePermission } from "../../../src/domain/rbac";
import type { RoleDef } from "../../../src/domain/roles";

export type DeliverySchema =
  | "Project"
  | "Ticket"
  | "TicketEvent"
  | "Milestone"
  | "Preview"
  | "ChangeRequest"
  | "Release"
  | "ApprovalPolicy"
  | "ApprovalRequest"
  | "ApprovalStep"
  | "EngineJob"
  /** The files people send with a change request, its answers or feedback on a preview (src/domain/attachments.ts). */
  | "Attachment";

export type Scalar = string | number | boolean;

/** An AND of equality / membership tests. */
export type Filter = Readonly<Record<string, Scalar | { in: readonly Scalar[] }>>;

export type Row = { ItemId: string; [field: string]: unknown };

export type QueryOpts = {
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  limit?: number;
  fields?: readonly string[];
};

export type ActiveMember = { userId: string; roleKey: string; displayName: string };

/** Exactly the codes of src/blocks/fn.ts FUNCTION_ERROR_MESSAGES that functions send. */
export type DeliveryErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "approval_required"
  | "too_large";

export type ErrorParams = Record<string, Scalar | readonly Scalar[]>;

export type OpAnswer =
  | { ok: true; data: unknown; serverNow: string }
  | {
      ok: false;
      error: { code: DeliveryErrorCode; messageKey: string; params: ErrorParams };
      serverNow: string;
    };

export type NotificationKind =
  | "approval.requested"
  | "approval.decided"
  | "approval.cancelled"
  | "release.promoted"
  | "build.started";

/** The two reads a prefetch may use: the router runs them inside its round 1 and the handler's identical reads then cost no round. */
export type ReadPorts = Pick<DeliveryPorts, "getById" | "query">;

export interface DeliveryPorts {
  /** The caller, from ctx.context. Never from arguments. */
  caller(): { userId: string | null; isSuperAdmin: boolean };
  account(userId: string): Promise<{ status: string } | null>;
  /**
   * What the hosting router already resolved for this request (the caller's membership, the permissions it
   * granted and the active member ids), served from memory with no gateway round trip. Absent on the fakes,
   * which then use activeMembers and customRoles.
   */
  routed?(): Promise<{
    permissions: readonly WorkspacePermission[];
    memberIds: readonly string[];
    me: ActiveMember | null;
  }>;
  /**
   * Hands the router writes whose result is not in the answer: it runs them in its one bookkeeping round,
   * together with the audit, notification and Operation writes. Absent on the fakes (the work then runs at once).
   */
  after?(work: () => Promise<unknown>): void;
  /** Writes the queued audit and notification rows now (inside the handler's own write round). Absent on the fakes. */
  flush?(): Promise<void>;
  activeMembers(workspaceId: string): Promise<ActiveMember[]>;
  customRoles(workspaceId: string): Promise<RoleDef[]>;
  getById(schema: DeliverySchema, id: string): Promise<Row | null>;
  query(schema: DeliverySchema, filter: Filter, opts?: QueryOpts): Promise<Row[]>;
  /**
   * The row never contains ItemId (F0). A repeated requestKey returns the first
   * row's id with existing: true. Any other unique-index clash throws an error
   * that isDuplicateKey recognises.
   */
  insert(
    schema: DeliverySchema,
    row: Record<string, unknown>,
    opts: { requestKey: string },
  ): Promise<{ itemId: string; existing: boolean }>;
  update(schema: DeliverySchema, id: string, patch: Record<string, unknown>): Promise<void>;
  remove(schema: DeliverySchema, id: string): Promise<void>;
  isDuplicateKey(e: unknown): boolean;
  /** The stored answer to replay, or null. */
  beginOperation(requestId: string, op: string): Promise<OpAnswer | null>;
  finishOperation(requestId: string, op: string, answer: OpAnswer): Promise<void>;
  createEngineJob(job: {
    workspaceId: string;
    projectId: string;
    kind: EngineJobKind;
    input: Record<string, unknown>;
    dedupeKey: string;
    createdByUserId: string;
    /** The record the job works on; one active job per (kind, target). Without it: one per (kind, project). */
    target?: { type: string; id: string };
  }): Promise<{
    jobId: string;
    /** The key (or the one active job of the kind and target) named a job that was there already. */
    existing: boolean;
    /** That job's status as stored now ("queued" for a new one). An existing job that is no longer queued, claimed or
     *  running is NOT a started job: the ops start through common.ts startEngineJob, which never answers one. */
    status: string;
  }>;
  notify(n: {
    workspaceId: string;
    projectId: string;
    kind: NotificationKind;
    params: Record<string, Scalar>;
    link: string;
    dedupeKey: string;
  } & (
    | { recipientUserId: string; audience?: undefined }
    | { audience: NotificationAudience; recipientUserId?: undefined }
  )): Promise<void>;
  audit(a: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    actorIsSuperAdmin: boolean;
    action: string;
    targetType: string;
    targetId: string;
    details: ErrorParams;
  }): Promise<void>;
  /** Namespaced; used only for dedupe keys, never as an ItemId. */
  uuid5(name: string): string;
  /** ISO server time. */
  now(): string;
}

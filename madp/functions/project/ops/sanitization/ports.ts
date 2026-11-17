/**
 * Ports of the Product sanitization ops (lane L5). The handlers depend only on
 * these types, so they run unchanged behind L2's router, behind bind.ts, or
 * behind the in-memory test host. Types only: no runtime code.
 *
 * Division of labour: the router (L2, or the in-memory test host) runs design
 * Appendix A steps 1-3 and 7: the caller only from ctx.context; an active
 * Account; Operation(requestId) replay; Project -> workspace; membership and
 * permissions through workspacePermissionsFor, where the super admin holds
 * every permission and cross-workspace writes are audited; finally it marks the
 * Operation done and answers {ok, data, serverNow}. Handlers run steps 4-6.
 */
import type { FactoryNoteInput } from "../../../../src/domain/factoryNotes";

/** Only codes from FUNCTION_ERROR_MESSAGES in src/blocks/fn.ts. */
export type ErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "too_large";

export type OpError = { code: ErrorCode; messageKey: string; params?: Record<string, unknown> };

export type OpResult<T = unknown> = { ok: true; data: T } | { ok: false; error: OpError };

/** A stored record. Dates are ISO strings set by the platform. */
export type Row = {
  ItemId: string;
  CreatedDate?: string;
  LastUpdatedDate?: string;
  [field: string]: unknown;
};

/** An AND of equalities (or `in` lists), always evaluated inside the caller's workspace. */
export type Filter = Readonly<
  Record<string, string | number | boolean | { in: readonly (string | number)[] }>
>;

export type ListOptions = {
  fields?: readonly string[];
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  /** Fails (limit_reached) when more than `max` rows exist. For a bounded read of a whole set. */
  max?: number;
  /** At most the first N (1-100) rows in sort order; never fails because more rows exist. For "the top N" or "any one". */
  first?: number;
};

/**
 * The scoped data gateway of one request.
 *
 * - list/get see only the caller's workspace; get returns null when the row is
 *   missing or belongs to another workspace.
 * - insert never receives an ItemId (the hosted gateway rejects client ids,
 *   MF-B23). The port stamps WorkspaceId, ReaderIds (the active members),
 *   CreatedByUserId, UpdatedByUserId and RequestKey = requestId + ":" + localKey
 *   (lane S2's unique index), and returns the stored row. When that RequestKey
 *   already exists it returns the stored row with existing:true, which covers
 *   the platform's automatic retry. Any other unique-index clash throws an
 *   error for which isDuplicateKey(e) is true.
 * - findMine returns the row this request already inserted under localKey.
 * - update stamps UpdatedByUserId, ignores null values, clears a field with ""
 *   and returns the stored row.
 * - remove deletes one record.
 */
export interface Gateway {
  list(schema: string, filter: Filter, opts?: ListOptions): Promise<Row[]>;
  get(schema: string, itemId: string): Promise<Row | null>;
  findMine(schema: string, localKey: string): Promise<Row | null>;
  /** One insert; the stored row is built from the fields and the new id (no read-back) unless the key already existed. */
  insert(
    schema: string,
    fields: Record<string, unknown>,
    localKey: string,
  ): Promise<{ row: Row; existing: boolean }>;
  /** Many inserts in one call (1-100 rows, each with its own localKey). A row whose key already exists is left as it is. */
  insertMany(schema: string, rows: readonly { fields: Record<string, unknown>; localKey: string }[]): Promise<void>;
  /**
   * Returns the row this request read before (merged with the patch and the issued stamp) or, for a row it never
   * read, the stored row read back after the write.
   */
  update(schema: string, itemId: string, fields: Record<string, unknown>): Promise<Row>;
  /**
   * The existence check the scoped gateway makes before it removes a row. A delete's reads include it, so the request
   * memo answers the check inside remove() and the removal costs one round trip.
   */
  verify(schema: string, itemId: string): Promise<void>;
  /** An update without an answer row (the last writes of an op, run in the router's bookkeeping round). */
  patch(schema: string, itemId: string, fields: Record<string, unknown>): Promise<void>;
  remove(schema: string, itemId: string): Promise<void>;
  isDuplicateKey(e: unknown): boolean;
}

export type JobKind = "requirements.draft" | "sanitization.assist" | "feedback.apply";

/** The _lib engine-job helper. */
export interface JobsPort {
  create(input: {
    kind: JobKind;
    projectId: string;
    inputJson: Record<string, unknown>;
    /** The job's target (its ActiveKey: one active job per target); the project when absent. */
    target?: { type: string; id: string };
  }): Promise<{ jobId: string; existing: boolean }>;
}

/** What a prefetch may use: the same read implementations as the handler (identical reads hit the request memo). */
export interface ReadEnv {
  userId: string;
  workspaceId: string;
  /** Only the id is known before the router's round trip. */
  project: { ItemId: string };
  gateway: Gateway;
}

/** Everything a handler may use; built by the router after Appendix A steps 1-3. */
export interface OpContext extends Omit<ReadEnv, "project"> {
  requestId: string;
  isSuperAdmin: boolean;
  permissions: readonly string[];
  /** The Project named by args.projectId, already verified to be in workspaceId (Stage, ResumeTo, BusinessHandedOverAt...). */
  project: Row;
  /** The server clock, ISO. */
  now(): string;
  /** The LastUpdatedDate an answer carries for a row this request wrote (the client echoes it as expectedUpdatedAt). */
  issuedStamp(): string;
  jobs: JobsPort;
  /** The RequestKey this request gives the row it inserts under `localKey` (a deterministic, provisional reference to it). */
  requestKeyOf(localKey: string): string;
  /** The last writes of the op: run by the router in its bookkeeping round trip, after the handler returned. */
  after(work: () => Promise<unknown>): void;
  /** Writes the queued audit events and notifications now. */
  flush(): Promise<void>;
  /** The notification writer (deps.notify): queued during the op, flushed by the router after it succeeds. */
  notify(n: FactoryNoteInput): void;
  /** Queues one AuditEvent (deps.audit); the router writes it with the actor, workspace and project in its bookkeeping round. Ids, statuses, counts and field names only: never free text. */
  audit(e: { action?: string; targetType: string; targetId: string; details?: Record<string, unknown> }): void;
}

export type Handler = ((args: Record<string, unknown>, ctx: OpContext) => Promise<OpResult>) & {
  /** Starts the handler's reads in the router's first round trip (read-only; the result is never used). */
  prefetch?: (env: ReadEnv, args: Record<string, unknown>) => unknown;
  /** False skips the Operation record for this answer. */
  record?: (data: unknown) => boolean;
};

export type OpTable = Readonly<Record<string, Handler>>;

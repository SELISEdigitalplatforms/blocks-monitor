/**
 * The narrow port interface the scope handlers (scope.* and milestones.* ops of mf-project) depend on.
 * Types plus two error classes; NO import from functions/_lib. Only bind.ts maps these ports to _lib.
 * The handler helpers of shared.ts (ok, fail, parseArgs, the Outcome and ScopeOpDef types) are re-exported here so
 * the op files can take everything from one place.
 *
 * ARCHITECTURE (design 12.2 step 4 and 13.1, Appendix A, wave C):
 * - Every write of this lane is an op of the Logic Function `project` (mf-project). Under the F0 override it runs
 *   on Host A (POST /api/fn/project, the Vite middleware) or on Host B; both use the same router.
 * - L2b's router (functions/_lib/router.ts, access.ts) already does the Appendix A guard: the caller only from ctx,
 *   Account active, Operation replay, the Project loaded as the service with WorkspaceId taken from it, membership
 *   and permissions via workspacePermissionsFor (custom roles included), the super-admin audit, and the answer
 *   {ok, data, serverNow}.
 * - Handlers do step 5 (validation and cross-references, else not_found) and step 6 (writes) through ScopeEnv only.
 * - The gateway assigns every ItemId (never sent). Idempotency comes from RequestKey natural keys. There are no
 *   transactions (MF-B03): a fixed write order plus complete-or-repair on retry.
 */
import type { WorkspacePermission } from "../../../../src/domain/rbac";
import type { ScopeOpName } from "../../../../src/domain/scope";

export type { ScopeOpName };
export { ok, fail, parseArgs } from "./shared";
export type { Outcome, Parsed, ArgSpec, ScopeOpDef } from "./shared";

export type FnErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "too_large";

export type Row = Record<string, unknown> & { ItemId: string; CreatedDate?: string; LastUpdatedDate?: string };

export type Filter = Record<
  string,
  string | number | boolean | { in: readonly (string | number)[] } | { ne: string | number | boolean }
>;

export interface QueryOpts {
  fields?: readonly string[];
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
}

/** An insert hit a unique index other than RequestKey (for example Milestone ProjectId+ScopeVersion+Number). */
export class UniqueConflictError extends Error {
  readonly schema: string;
  constructor(schema: string) {
    super(`Unique index conflict in ${schema}`);
    this.name = "UniqueConflictError";
    this.schema = schema;
  }
}

/** The job state machine refuses a cancel (the job is terminal or running past the point of no return). */
export class JobNotCancellableError extends Error {
  constructor() {
    super("Job not cancellable");
    this.name = "JobNotCancellableError";
  }
}

export interface ScopeDb {
  /** Default fields are FIELDS[schema], always including ItemId, CreatedDate and LastUpdatedDate. */
  query(schema: string, filter: Filter, opts?: QueryOpts): Promise<Row[]>;
  /** One read; used at the end to answer with the stored rows. Missing ids are simply absent. */
  byIds(schema: string, ids: readonly string[]): Promise<Row[]>;
  /** naturalKey becomes the RequestKey; a repeat gives the stored row's id with created:false. */
  insert(schema: string, fields: Record<string, unknown>, naturalKey: string): Promise<{ id: string; created: boolean }>;
  /**
   * Never null or undefined values (MF-B14); clear text with ''. The gateway returns nothing for an update, so the
   * stored row is read back (one extra read); a handler that answers with byIds anyway can ignore the result.
   */
  update(schema: string, id: string, patch: Record<string, unknown>): Promise<Row>;
  remove(schema: string, id: string): Promise<void>;
}

export interface JobCreate {
  /** An EngineJobKind; the job service refuses an unknown kind. */
  kind: string;
  input: Record<string, unknown>;
  targetType: string;
  targetId: string;
  eventKey?: string;
  /** Server-derived only (for example the brief confirmer); the default is the caller. */
  requestedByUserId?: string;
}

export interface ScopeJobs {
  create(i: JobCreate): Promise<{ job: Row; existing: boolean }>;
  /** Throws JobNotCancellableError when the state machine refuses. */
  cancel(jobId: string, actor: "system" | "user"): Promise<Row>;
  /** This project's jobs of those kinds, newest first (Kind, Status, TargetType, TargetId, CreatedDate, RequestedByUserId). */
  list(kinds: readonly string[]): Promise<Row[]>;
  /**
   * Cancels already-read job rows in ONE update round, with no reads. A row the state machine refuses is `skipped`
   * (terminal or past the point of no return), never thrown. Rows need ItemId, Kind, Status, Progress, Attempts,
   * Message and TargetId (what jobs.list returns).
   */
  cancelRows(rows: Row[], actor: "system" | "user"): Promise<{ cancelled: string[]; skipped: string[] }>;
}

export interface PresignPortRequest {
  fileName: string;
  mime: string;
  sizeBytes: number;
  maxBytes: number;
  allowedMimes: readonly string[];
  objectAccessLevel: "Creator";
  accessModifier: "Private";
  inheritsParentAccess: false;
}

export interface ScopeFiles {
  presign(r: PresignPortRequest): Promise<{
    storageObjectId: string;
    uploadUrl: string;
    storedName: string;
    requiredHeaders: Record<string, string>;
  }>;
  info(id: string): Promise<{ sizeBytes: number; mime: string } | null>;
  head(id: string, bytes: number): Promise<Uint8Array>;
  downloadUrl(id: string): Promise<{ url: string; expiresAt: string | null }>;
  /** Permanent; a missing file is not an error. */
  remove(id: string): Promise<void>;
}

export interface ScopeEnv {
  op: ScopeOpName;
  requestId: string;
  /** The platform's delivery attempt (1 first, 2 the one automatic retry). */
  attempt: number;
  /** From ctx only, never from args. */
  userId: string;
  /** The server clock. */
  now: Date;
  nowIso: string;
  workspaceId: string;
  projectId: string;
  /** At least Stage, CurrentScopeVersion, ScopeLockedAt, Name, ClientName, Rev. */
  project: Row;
  permissions: readonly WorkspacePermission[];
  isSuperAdmin: boolean;
  isActiveMember(userId: string): Promise<boolean>;
  db: ScopeDb;
  jobs: ScopeJobs;
  files: ScopeFiles;
  /** Queued; the router flushes it after the handler. */
  audit(targetType: string, targetId: string, details?: Record<string, string | number | boolean>): void;
  uuid5(name: string): string;
  /** Last writes of a command: run by the router in the bookkeeping round, after the handler. */
  after(work: () => Promise<unknown>): void;
  /** Writes the queued audit events and notifications now (so the handler's last round carries them). */
  flush(): Promise<void>;
  /** The LastUpdatedDate stamp a write of this request carries (the answer can echo it without a read-back). */
  issuedStamp: string;
}

/** What a prefetch may read: the same query / byIds / list as the handler env, so the handler's reads hit the memo. */
export interface ScopeReadEnv {
  projectId: string;
  workspaceId: string;
  userId: string;
  db: Pick<ScopeDb, "query" | "byIds"> & {
    /** Reads the rows the handler is about to remove (an access-checked delete reads each first): the repeat is free. */
    warmRemove?(schema: string, ids: readonly string[]): Promise<unknown>;
  };
  jobs: Pick<ScopeJobs, "list">;
}

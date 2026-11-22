/**
 * The narrow port interface the project and doc handlers depend on. Only bind.ts maps these to functions/_lib.
 * Pure types (plus one error class): no imports from functions/_lib.
 */
import type { RoleDef } from "../../../../src/domain/roles";

export type FnErrorCode =
  | "forbidden"
  | "not_member"
  | "account_inactive"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "limit_reached"
  | "too_large";

export interface FnCtx {
  context: { isAuthenticated: boolean; userId?: string | null };
}

export interface FnRequest {
  op: string;
  requestId: string;
  args: unknown;
}

export type FnAnswer<T = unknown> =
  | { ok: true; data: T; serverNow: string }
  | { ok: false; error: { code: FnErrorCode; messageKey?: string; params?: Record<string, unknown> } };

export type Row = Record<string, unknown> & { ItemId: string; CreatedDate?: string; LastUpdatedDate?: string };

export type FilterValue =
  | string
  | number
  | boolean
  | { in: readonly (string | number)[] }
  | { ne: string | number | boolean };
export type Filter = Record<string, FilterValue>;

export interface QueryOpts {
  fields?: readonly string[];
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
}

/** An insert hit the unique RequestKey index: the same command already wrote this row. */
export class DuplicateKeyError extends Error {
  readonly schema: string;
  readonly requestKey: string;
  constructor(schema: string, requestKey: string) {
    super(`Duplicate RequestKey in ${schema}`);
    this.name = "DuplicateKeyError";
    this.schema = schema;
    this.requestKey = requestKey;
  }
}

export interface GatewayPort {
  query(schema: string, filter: Filter, opts?: QueryOpts): Promise<Row[]>;
  count(schema: string, filter: Filter): Promise<number>;
  /** Fields never contain ItemId; the stored row carries the gateway's. A duplicate RequestKey throws DuplicateKeyError. */
  insert(schema: string, fields: Record<string, unknown>): Promise<Row>;
  update(schema: string, itemId: string, patch: Record<string, unknown>): Promise<Row>;
  /** `rowRead`: the row came from a page read in this request, so no ownership read is made first. */
  remove(schema: string, itemId: string, opts?: { rowRead?: boolean }): Promise<void>;
}

export interface AccountInfo {
  userId: string;
  active: boolean;
  isSuperAdmin: boolean;
}

export interface MembershipInfo {
  userId: string;
  workspaceId: string;
  roleKey: string;
  status: "active" | "invited" | "removed";
}

export interface MembersPort {
  membership(workspaceId: string, userId: string): Promise<MembershipInfo | null>;
  customRoles(workspaceId: string): Promise<RoleDef[]>;
  activeMembers(workspaceId: string): Promise<MembershipInfo[]>;
  readerIds(workspaceId: string): Promise<string[]>;
}

export interface OperationsPort {
  get(requestId: string): Promise<{ status: "pending" | "done"; answer?: FnAnswer } | null>;
  begin(requestId: string, op: string, userId: string): Promise<void>;
  finish(requestId: string, answer: FnAnswer): Promise<void>;
}

/** The field names the CLI sends to data.files.presignedUploadUrl. */
export interface PresignRequest {
  fileName: string;
  contentType: string;
  sizeInBytes: number;
  parentDirectoryId: string;
  objectAccessLevel: "Creator";
  inheritsParentAccess: false;
  accessModifier: "Private";
  checksum?: string;
  checksumAlgorithm?: "SHA256";
}

export interface StoragePort {
  /** Find-or-create, race-safe. */
  projectDirectory(workspaceId: string, projectId: string): Promise<string>;
  /** A no-op when the directory is absent. */
  removeProjectDirectory(workspaceId: string, projectId: string): Promise<void>;
  presignUpload(req: PresignRequest): Promise<{ uploadUrl: string; storageObjectId: string; requiredHeaders: Record<string, string> }>;
  info(storageObjectId: string): Promise<{ sizeBytes: number; contentType?: string } | null>;
  /** A Range read of the first bytes. */
  head(storageObjectId: string, bytes: number): Promise<Uint8Array>;
  downloadUrl(storageObjectId: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }>;
  /** A missing object is not an error. */
  remove(storageObjectId: string, opts: { permanent: true }): Promise<void>;
}

export interface JobsPort {
  /** Cancels every non-terminal EngineJob of the project; returns how many. */
  cancelActive(projectId: string, actor: "system"): Promise<number>;
  /** The project's non-terminal EngineJob rows (a read; cancelActive reads the same rows). */
  activeRows?(projectId: string): Promise<Row[]>;
  /** Cancels the given rows (already read); the writes are issued synchronously. */
  cancelRows?(rows: readonly Row[]): Promise<number>;
  /** Queues an engine job: one active job per kind and target, and a retried request answers the job it queued. */
  create?(i: JobCreate): Promise<{ jobId: string; existing: boolean }>;
}

export interface JobCreate {
  kind: "sanitization.assist" | "setup.assist" | "requirements.draft" | "file.extract";
  projectId: string;
  input: Record<string, unknown>;
  targetType?: string;
  targetId?: string;
  /** Tells apart the jobs one request queues (part of the job's RequestKey). */
  eventKey: string;
}

/** What a prefetch gets: the ports with the reads real and every write refused; its reads warm the request memo. */
export interface ReadEnv {
  ports: Ports;
  workspaceId: string;
  projectId: string;
  userId: string;
  /** The workspace's active members, as the stamps of an insert need them. */
  readerIds?: () => Promise<string[]>;
  /** Warms the ownership read the scoped gateway makes before it removes a row (so a known id is removed in one round). */
  warmRemove?: (schema: string, itemId: string) => Promise<unknown>;
}

export interface AuditInput {
  workspaceId: string;
  actorUserId: string;
  action: string;
  targetSchema: string;
  targetId: string;
  params?: Record<string, unknown>;
}
export interface AuditPort {
  write(e: AuditInput): Promise<void>;
}

export type NotifyAudience = "project-followers" | "project-followers-and-actor";
export interface NotifyInput {
  workspaceId: string;
  /** Exactly one of recipientUserId and audience is set. */
  recipientUserId?: string;
  audience?: NotifyAudience;
  kind: "assigned" | "shared" | "business.handed-over" | "requirements.ready" | "scope.ready" | "build.started" | "release.created";
  projectId: string;
  link: string;
  params: Record<string, string | number>;
  eventKey: string;
}
export interface NotifyPort {
  send(n: NotifyInput): Promise<void>;
}

export interface ClockPort {
  now(): Date;
  monoMs(): number;
}

export interface Ports {
  verifyRepository?(repo: { owner: string; name: string; branch: string; kind: "existing" | "new"; visibility?: string; allowEmpty?: boolean }): Promise<void>;
  /** Verified IAM mode provisions a separate product tenant under the Factory operator account. */
  automaticBlocksProvisioning?: boolean;
  db: GatewayPort;
  members: MembersPort;
  accounts: { get(userId: string): Promise<AccountInfo | null> };
  operations: OperationsPort;
  files: StoragePort;
  jobs: JobsPort;
  audit: AuditPort;
  notify: NotifyPort;
  clock: ClockPort;
  uuidv5(name: string): string;
  /** Set by bind.ts: project.delete then runs one bounded write round per call (the caller loops with a new requestId). */
  oneRoundPerCall?: boolean;
  /** Last writes of a command: the router runs them in its bookkeeping round, after the handler. */
  after?(work: () => Promise<unknown>): void;
  /** Writes the queued audit events and notifications now, so the handler's last round carries them. */
  flush?(): Promise<void>;
  /** The LastUpdatedDate stamp a write of this request carries (answers echo it without a read-back). */
  issuedStamp?: string;
  /** True when a version conflict is the caller's own earlier save that already landed (same writer, same values). */
  isOwnWrite?(stored: Record<string, unknown>, callerUserId: string, values: Record<string, unknown>): boolean;
}

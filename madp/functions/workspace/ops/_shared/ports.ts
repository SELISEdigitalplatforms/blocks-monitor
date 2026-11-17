// The one adapter seam every mf-workspace and mf-admin handler codes against.
// L2's functions/_lib is bound to these ports by the coordinator; handlers never import _lib.
import type { PlatformPermission } from "../../../../src/domain/rbac";
// Type only (erased in the bundle): the roles source handle the router passes through.
import type { RbacHandle } from "../../../_lib/rbacSource";
import type { TenancyErrorCode } from "../../../../src/domain/tenancy";
import type { UtilitiesAccess } from "../../../../src/domain/blocksUtilities";

/** The caller as the platform reports it in ctx.context. Never read from args. */
export interface CallerContext {
  isAuthenticated?: boolean;
  userId?: string;
  email?: string;
  roles?: readonly string[];
  impersonated?: boolean;
  displayName?: string;
}

export interface OpCtx {
  context: CallerContext;
  requestId: string;
  op: string;
}

export type FilterValue =
  | string
  | number
  | boolean
  | { in: readonly (string | number | boolean)[] }
  | { ne: string | number | boolean }
  | { gte?: string; lte?: string };

/** Fields are AND-ed; {} matches every row. */
export type Filter = Readonly<Record<string, FilterValue>>;

export interface ListQuery {
  filter: Filter;
  fields: readonly string[];
  sort?: { field: string; dir: "asc" | "desc" };
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface Gateway {
  list<T>(schema: string, q: ListQuery): Promise<{ items: T[]; totalCount: number }>;
  listAll<T>(
    schema: string,
    q: { filter: Filter; fields: readonly string[]; sort?: ListQuery["sort"]; maxItems?: number },
  ): Promise<T[]>;
  /**
   * Inserts without sending ItemId. The same onceKey returns the existing row with created false;
   * a violation of any other unique index throws DuplicateError.
   */
  insertOnce<T>(
    schema: string,
    row: Record<string, unknown>,
    onceKey: string,
  ): Promise<{ item: T & { ItemId: string }; created: boolean }>;
  /** Blocks Update ignores null, so callers use ''. */
  update(schema: string, itemId: string, set: Record<string, unknown>): Promise<void>;
  updateMany(schema: string, filter: Filter, set: Record<string, unknown>): Promise<number>;
  remove(schema: string, itemId: string): Promise<void>;
}

export interface Acl {
  /** Sets the full ReaderIds array on every schema with WorkspaceId + ReaderIds, filtered by WorkspaceId, in one parallel round. */
  restamp(workspaceId: string, readerIds: readonly string[]): Promise<{ schemas: string[]; rows: number }>;
}

export interface Clock {
  now(): string;
  sleep(ms: number): Promise<void>;
}

export interface OpDeps {
  identitySource?: "iam";
  gateway: Gateway;
  acl: Acl;
  clock: Clock;
  access?: { platformHolders?(permission: PlatformPermission): Promise<string[]> };
  /** The router runs these last writes in the same round trip as the audit and Operation writes; without it the work runs inline. */
  after?(work: () => Promise<unknown>): void;
  /** Writes the queued audit and notification rows now (the router flushes only what is left); a no-op without the router. */
  flush?(): Promise<void>;
  /** Addresses the handler already holds (user id -> email) for the notifications it queues, so the router reads no Account for them. */
  knownEmails?(emails: Readonly<Record<string, string>>): void;
  /** IAM admin calls with the caller's own token; null or absent on Host B. */
  iam?: IamAdmin | null;
  /**
   * Where roles come from (PlatformSetting rbac.source, functions/_lib/rbacSource.ts): openOp asks its view; with source
   * "iam" every role or access change writes IAM first (rbac.iam, the service identity) and then calls changed().
   */
  rbac?: RbacHandle;
  /** Blocks OS IAM roles, permissions, organizations and grants (server/iam/iamAdmin.ts, the platform's service identity); absent where the host has none. */
  iamDirectory?: IamDirectory | null;
  /** Blocks Utilities (plans, discounts, subscriptions, payments): the catalogue on the service identity, one
   *  organization's subscription on a token issued for it; absent where the host has none. */
  utilities?: UtilitiesAccess | null;
}

/** What a prefetch reads with: the handler's own read implementations on a read-only gateway. */
export interface ReadEnv {
  gateway: Pick<Gateway, "list" | "listAll">;
  userId: string;
}

/** Starts a handler's reads in the router's round trip 1; only the per-request memo carries the result over. */
export type OpPrefetch = (env: ReadEnv, args: unknown) => unknown;

/** A refused or failed IAM call (same shape as functions/_lib/callerIam.ts). */
export interface IamFailure {
  ok: false;
  status: number | null;
  errors: Record<string, string>;
}
export interface IamUserRow {
  userId: string;
  email: string;
  roles: string[];
  active: boolean;
  firstName?: string;
  lastName?: string;
}
/** IAM administration with the CALLER'S OWN bearer token (null on Host B). Local copy: handlers never import _lib. */
export interface IamAdmin {
  exists(email: string): Promise<{ ok: true; userId: string | null } | IamFailure>;
  listUsers(q: { pageNo: number; pageSize: number; search?: string }): Promise<{ ok: true; users: IamUserRow[]; totalCount: number | null } | IamFailure>;
  createUser(u: { email: string; firstName: string; lastName: string; roles: string[]; password?: string }): Promise<{ ok: true; userId: string | null } | IamFailure>;
  activate(userId: string, reason?: string): Promise<{ ok: true } | IamFailure>;
  deactivate(userId: string): Promise<{ ok: true } | IamFailure>;
  updateAccess(userId: string, roles: string[]): Promise<{ ok: true } | IamFailure>;
  resendActivation(userId: string): Promise<{ ok: true } | IamFailure>;
}

/** Blocks OS IAM as the Factory's role and permission store (local copy of the server module's contract). */
export interface IamDirectoryRole { slug: string; name: string; description?: string; permissions: string[] }
export interface IamDirectoryGrant { roles?: string[]; permissions?: string[]; organizationId?: string }
export interface IamDirectoryAccess {
  platform: { roles: string[]; permissions: string[] };
  orgs: Record<string, { roles: string[]; permissions: string[] }>;
}
export interface IamDirectory {
  listPermissions(): Promise<{ name: string; resource?: string; description?: string }[]>;
  ensurePermissions(keys: string[]): Promise<unknown>;
  listRoles(): Promise<IamDirectoryRole[]>;
  getRole(slug: string): Promise<IamDirectoryRole | null>;
  upsertRole(role: { slug: string; name: string; description: string; permissions: string[] }): Promise<unknown>;
  deleteRole(slug: string): Promise<unknown>;
  listOrganizations(): Promise<{ id: string; name: string }[]>;
  ensureOrganization(o: { workspaceId: string; name: string }): Promise<string>;
  userAccess(userId: string): Promise<IamDirectoryAccess>;
  grant(userId: string, g: IamDirectoryGrant): Promise<unknown>;
  revoke(userId: string, g: IamDirectoryGrant): Promise<unknown>;
}

export class DuplicateError extends Error {
  readonly duplicate = true;
  constructor(message = "duplicate") {
    super(message);
    this.name = "DuplicateError";
  }
}

export function isDuplicate(e: unknown): boolean {
  return e instanceof DuplicateError || (typeof e === "object" && e !== null && (e as { duplicate?: unknown }).duplicate === true);
}

export type OpError = { code: TenancyErrorCode | "not_supported" | "unavailable"; messageKey?: string; params?: Record<string, unknown> };
export type OpAnswer<T> = { ok: true; data: T } | { ok: false; error: OpError };
export type OpHandler<T = unknown> = (ctx: OpCtx, args: unknown, deps: OpDeps) => Promise<OpAnswer<T>>;
export type OpTable = Readonly<Record<string, OpHandler>>;
/** A table entry that also declares its prefetch and when its answer is recorded (bindOp passes both on). */
export interface OpEntry<T = unknown> {
  handler: OpHandler<T>;
  prefetch?: OpPrefetch;
  record?: (data: T) => boolean;
}

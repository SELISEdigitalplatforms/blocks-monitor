import type { FnAnswer, FnFunctionName, OpFailureCode } from "../../src/domain/fnContract";
import type { PlatformPermission, WorkspacePermission } from "../../src/domain/rbac";
import type { AccessService } from "./access";
import type { AclService } from "./acl";
import type { Caller } from "./caller";
import type { BoundIds } from "./ids";
import type { AuditInput } from "./audit";
import type { NotifyInput } from "./outbox";
import type { JobsService } from "./jobs";
import type { RawGateway, Row } from "./gateway";
import type { Refs } from "./refs";
import type { SdkFactory } from "./sdk";
import type { TokenProvider, TokenStore } from "./serviceToken";
import type { GatewayStats } from "./stats";
import type { ScopedGateway } from "./scopedGateway";
import type { FilesService } from "./storage";
import type { Validator } from "./validate";
import type { FnEnv } from "./env";
import type { FactMemo } from "./factMemo";
import type { InflightRegistry } from "./inflight";
import type { IamAdminApi } from "./iamAdmin";
import type { UtilitiesCaller } from "./blocksUtilities";
import type { UtilitiesAccess } from "../../src/domain/blocksUtilities";
import type { RbacCaches, RbacHandle } from "./rbacSource";
import type { CallerIam } from "./callerIam";

export type { Row, RawGateway, ScopedGateway, Caller };

export type Kind = "command" | "view";
export type Scope = "self" | "workspace" | "project" | "platform" | "engine";

/** A workspace permission, "membership" (any active member), a platform permission, or "any of these". */
export type OpPermission =
  | WorkspacePermission
  | "membership"
  | PlatformPermission
  | readonly (WorkspacePermission | PlatformPermission)[];

declare const opBrand: unique symbol;

/** What the running host guarantees; the hosts fill it, ops only read it. Holds no env value and no id. */
export type HostDescriptor =
  | {
      kind: "local";
      tokenVerification: "iam" | "iam+signature";
      csp: "enforce" | "report-only";
      maxBodyBytes: number;
      perUserPerMinute: number;
      perUserInFlight: number;
      globalInFlight: number;
    }
  | { kind: "blocks" };

export interface OpCtx {
  fn: string;
  op: string;
  requestId: string;
  attempt: number;
  /** The server clock. */
  now: Date;
  caller: Caller;
  account: Row | null;
  workspace: Row | null;
  project: Row | null;
  membership: Row | null;
  permissions: readonly WorkspacePermission[];
  platformPermissions: readonly PlatformPermission[] | null;
  viaPlatform: boolean;
  /** The row `projectFrom` resolved the project through (for example the EngineJob). */
  anchor: Row | null;
  remainingMs(): number;
  readonly host: Readonly<HostDescriptor>;
}

export interface OpLog {
  info(event: string, data?: Record<string, string | number | boolean>): void;
  warn(event: string, data?: Record<string, string | number | boolean>): void;
}

export type RepositoryVerifier = (userId: string, repo: { owner: string; name: string; branch: string; kind: "existing" | "new"; visibility?: string; allowEmpty?: boolean }, requestKey?: string) => Promise<void>;

export interface OpDeps {
  verifyRepository?: RepositoryVerifier;
  identitySource?: "iam";
  gw: ScopedGateway;
  /** The unscoped gateway; self, platform and engine scope only. */
  svc: ScopedGateway | null;
  ids: BoundIds;
  acl: AclService;
  refs: Refs;
  access: AccessService;
  audit(e: AuditInput): void;
  /** Writes the request's AuditEvent now under a unique key (commands only): created:false plus the existing row when another request holds the key. */
  guard?(e: AuditInput, key: string): Promise<{ created: boolean; row: Row }>;
  notify(n: NotifyInput): void;
  jobs: JobsService;
  files: FilesService;
  fail(code: OpFailureCode, messageKey?: string, params?: Readonly<Record<string, unknown>>): never;
  log: OpLog;
  /** Hands the router the last writes of a command: it runs them in the same round trip as the audit, notification and Operation writes. A failure marks the run failed, so a retry runs the handler again. */
  after(work: () => Promise<unknown>): void;
  /** Writes the queued audit events (and, for commands, the notifications) now. The router then flushes only what is left. */
  flush(): Promise<void>;
  /** IAM with the caller's own token: set on explicitly enabled functions, null elsewhere. */
  callerIam?: CallerIam | null;
  /** Blocks IAM administration on the platform's service identity (roles, permissions, organizations, access). */
  iamAdmin?: IamAdminApi | null;
  /** Where roles come from (PlatformSetting rbac.source) and the cache drop every role or access change calls. */
  rbac?: RbacHandle;
  /** Blocks Utilities (plans, discounts, subscriptions, payments): the catalogue on the service identity, an
   *  organization's subscription on a token issued for it (functions/_lib/blocksUtilities.ts). */
  utilities?: UtilitiesAccess | null;
}

/** What an op's prefetch gets: read-only gateways (writes throw). Its reads warm the request memo; its result is never used. */
export interface PrefetchInput<A = unknown> {
  args: A;
  projectId: string | null;
  workspaceId: string | null;
  callerUserId: string;
  gw: ScopedGateway | null;
  svc: ScopedGateway | null;
  raw: RawGateway;
}

export interface OpSpec<A = unknown, R = unknown> {
  op: string;
  kind: Kind;
  scope: Scope;
  permission?: OpPermission;
  platformOverride?: PlatformPermission;
  allowInactiveAccount?: boolean;
  /** Project scope: resolve the project through another row (for example the EngineJob of `jobId`). */
  projectFrom?: { schema: string; arg: string };
  /** Self scope only: the handler starts with the first round trip and its writes wait until the account and replay checks pass. */
  early?: boolean;
  /** Commands: false skips the Operation record for this answer (a retry then runs the handler again). */
  record?: (data: R) => boolean;
  /**
   * Commands on Host A (a long-lived process): answer as soon as the handler and its `after` writes are done; the
   * AuditEvent, notifications and Operation record of that round finish right after the answer (failed parts retried).
   * Only for ops whose every write is RequestKey-keyed, so a rerun after a restart answers exactly the same. Host B
   * ignores it (a Logic Function may freeze once it has answered).
   */
  bookkeepingAfterAnswer?: boolean;
  args: Validator<A> | ((raw: unknown) => A);
  /** Starts the handler's reads inside round trip 1 of the router (a guess; only the memo carries anything over). */
  prefetch?: (p: PrefetchInput<A>) => unknown;
  handler(ctx: OpCtx, args: A, deps: OpDeps): Promise<R>;
}

export type OpDef<A = unknown, R = unknown> = Readonly<OpSpec<A, R>> & { readonly [opBrand]: true };

export interface PlatformCtx {
  /** Trusted BFF integration; never populated from request args or decoded token claims. */
  verifyRepository?: RepositoryVerifier;
  context: unknown;
  env: unknown;
  run?: { id?: string; attempt?: number };
  log?: { info?(s: string): void; warn?(s: string): void; error?(s: string): void };
  /** Host A only: counts this request's gateway calls. */
  stats?: GatewayStats;
  /** Host A only: the process-wide service token cache. */
  tokenStore?: TokenStore;
  /** Host A only: the hardening switches it runs with. Without it the router assumes Blocks. */
  host?: HostDescriptor;
  /** Host A's keep-alive fetch; every SDK client of this request uses it. Unset on Host B. */
  fetch?: typeof fetch;
  /** Host A only, admin function: the caller's own verified IAM token. Never logged, stored or answered. */
  callerToken?: string;
  /** Host A: Blocks OS IAM administration with the platform's service identity (server/iam/iamAdmin.ts); the router
   *  builds the same module on the function's own service credentials when the host passes none. */
  iamAdmin?: IamAdminApi;
  /** Host A only, billing: the caller's own verified IAM token and the organization it was issued for, so Blocks
   *  Utilities can be asked about that organization's subscription. Never logged, stored or answered. */
  utilitiesCaller?: UtilitiesCaller;
}

export interface FnHttpAnswer {
  statusCode: number;
  headers: Record<string, string>;
  body: FnAnswer<unknown>;
}

export interface HostAdapters {
  sdk?: SdkFactory;
  rawGateway?: (o: { env: FnEnv; tokens: TokenProvider; sdk: SdkFactory }) => RawGateway;
  files?: (o: { env: FnEnv; tokens: TokenProvider; sdk: SdkFactory; raw: RawGateway }) => FilesService;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  facts?: FactMemo;
  inflight?: InflightRegistry;
  /** Per-call gateway deadline and hedge delay. undefined: the defaults; null: the layer is off (tests that hold one call longer than the deadline). */
  gatewayDeadline?: { callMs?: number; hedgeMs?: number } | null;
  /** The IAM admin module (tests: a fake); default: the real one on the service identity. */
  iamAdmin?: (o: { env: FnEnv; tokens: TokenProvider; sdk: SdkFactory }) => IamAdminApi | null;
  /** The roles source caches; default: per process (per handler when the host injects its own gateway). */
  rbacCaches?: RbacCaches;
  /** Blocks Utilities for a request (tests: a client over a fake HTTP layer); default: the real one over the SDK. */
  utilities?: (o: { env: FnEnv; tokens: TokenProvider; sdk: SdkFactory; caller: UtilitiesCaller | null }) => UtilitiesAccess | null;
}

export interface FunctionMeta {
  name: FnFunctionName;
  slug: string;
  ops: Array<{
    op: string;
    kind: Kind;
    scope: Scope;
    permission: string | readonly string[] | null;
    platformOverride: string | null;
    allowInactiveAccount: boolean;
  }>;
  catalogue: { workspace: readonly string[]; platform: readonly string[] };
}

export type FunctionHandler = ((input: unknown, ctx: PlatformCtx) => Promise<FnHttpAnswer>) & {
  meta: FunctionMeta;
  dispatch(request: unknown, ctx: PlatformCtx): Promise<FnHttpAnswer>;
};

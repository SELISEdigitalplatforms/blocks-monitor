// Shared handler plumbing: argument reading, the caller guard (Appendix A steps 1-4), audit and notify.
// Plain functions only; no module state (warm sandboxes are shared across callers).
import type { PlatformPermission, WorkspacePermission } from "../../../../src/domain/rbac";
import { builtInWorkspaceRoles, type RoleDef } from "../../../../src/domain/roles";
import {
  IAM_SUPER_ADMIN_ROLE,
  granterPermissions,
  resolvePlatformAccess,
  resolveWorkspaceAccess,
  type TenancyCheck,
  type WorkspaceAccess,
} from "../../../../src/domain/tenancy";
import { notificationEventKey, validateNotification } from "../../../../src/domain/notifications";
import { WORKSPACE_PERMISSIONS } from "../../../../src/domain/rbac";
import { PLATFORM_MANAGER_WORKSPACE_PERMISSIONS } from "../../../../src/domain/tenancy";
import { isIamAdminError, type IamAdminApi, type IamErrorCode } from "../../../_lib/iamAdmin";
import type { IamWorkspaceAccess, RbacView } from "../../../_lib/rbacSource";
import type { Filter, Gateway, OpAnswer, OpCtx, OpDeps, OpError } from "./ports";
import {
  ACCOUNT_FIELDS,
  ACCOUNT_SUPER_ADMIN_FIELD,
  MEMBERSHIP_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  PLATFORM_ROLE_FIELDS,
  SCHEMA,
  WORKSPACE_FIELDS,
  WORKSPACE_ROLE_FIELDS,
  toRoleDef,
  type AccountRow,
  type MembershipRow,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
  type WorkspaceRoleRow,
  type WorkspaceRow,
} from "./records";

export const MAX_NOTIFICATION_RECIPIENTS = 50;
export const MAX_AUDIT_DETAILS = 4000;
export const MAX_TEAM_ROWS = 1000;

export function ok<T>(data: T): OpAnswer<T> {
  return { ok: true, data };
}

export function fail(code: OpError["code"], messageKey?: string, params?: Record<string, unknown>): OpAnswer<never> {
  const error: OpError = { code };
  if (messageKey) error.messageKey = messageKey;
  if (params) error.params = params;
  return { ok: false, error };
}

/** Turns a refused pure rule into an op answer. */
export function failCheck(c: TenancyCheck & { ok: false }): OpAnswer<never> {
  const x = c as unknown as { code: OpError["code"]; messageKey?: string; params?: Record<string, unknown> };
  return fail(x.code, x.messageKey, x.params);
}

// ---------------------------------------------------------------- args

const STAMPED_EXACT = [
  "ItemId", "WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "InvitedByUserId", "UserId",
  "ActorUserId", "AssignedByUserId", "ResolvedByUserId", "DeactivatedByUserId",
] as const;

/** Server-stamped keys: dropped silently from args. Every PascalCase *At key counts too. */
export const STAMPED_ARG_KEYS: readonly string[] = STAMPED_EXACT;

export function isStampedKey(key: string): boolean {
  return (STAMPED_ARG_KEYS as readonly string[]).includes(key) || /^[A-Z][A-Za-z0-9]*At$/.test(key);
}

export type ArgType = "string" | "string?" | "boolean" | "boolean?" | "number?" | "string[]" | "string[]?" | "object?";
export type ArgSpec = Readonly<Record<string, ArgType>>;

type ArgValue<T extends ArgType> = T extends "string"
  ? string
  : T extends "string?"
    ? string | undefined
    : T extends "boolean"
      ? boolean
      : T extends "boolean?"
        ? boolean | undefined
        : T extends "number?"
          ? number | undefined
          : T extends "string[]"
            ? string[]
            : T extends "string[]?"
              ? string[] | undefined
              : Record<string, unknown> | undefined;
export type ArgsOf<S extends ArgSpec> = { [K in keyof S]: ArgValue<S[K]> };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readArgs<S extends ArgSpec>(
  args: unknown,
  spec: S,
): { ok: true; value: ArgsOf<S> } | { ok: false; error: OpError } {
  const bad = (keys: string[]): { ok: false; error: OpError } => ({
    ok: false,
    error: { code: "invalid_input", messageKey: "tenancy.invalidArgs", params: { keys } },
  });
  const input = args === undefined || args === null ? {} : args;
  if (!isObject(input)) return bad([]);
  const unknownKeys = Object.keys(input).filter((k) => !(k in spec) && !isStampedKey(k));
  if (unknownKeys.length) return bad(unknownKeys.sort());
  const out: Record<string, unknown> = {};
  const wrong: string[] = [];
  for (const [key, type] of Object.entries(spec)) {
    const raw = input[key];
    const optional = type.endsWith("?");
    if (raw === undefined || raw === null) {
      if (!optional) wrong.push(key);
      continue;
    }
    const base = optional ? type.slice(0, -1) : type;
    const good =
      base === "string"
        ? typeof raw === "string"
        : base === "boolean"
          ? typeof raw === "boolean"
          : base === "number"
            ? typeof raw === "number" && Number.isFinite(raw)
            : base === "string[]"
              ? Array.isArray(raw) && raw.every((x) => typeof x === "string")
              : isObject(raw);
    if (!good) wrong.push(key);
    else out[key] = raw;
  }
  if (wrong.length) return bad(wrong.sort());
  return { ok: true, value: out as ArgsOf<S> };
}

// ---------------------------------------------------------------- caller

export interface Caller {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  impersonated: boolean;
  account: AccountRow | null;
  actorName: string;
  platform: { permissions: PlatformPermission[]; roleKeys: string[] };
  workspace: WorkspaceRow | null;
  membership: MembershipRow | null;
  team: MembershipRow[];
  customRoles: RoleDef[];
  access: WorkspaceAccess | null;
  granter: WorkspacePermission[];
  extra: Record<string, unknown>;
}

export interface OpenOptions {
  scope: "self" | "workspace" | "platform";
  workspaceId?: string;
  permission?: WorkspacePermission | null;
  platformPermission?: PlatformPermission | readonly PlatformPermission[];
  allowMissingAccount?: boolean;
  allowInactiveAccount?: boolean;
  loadTeam?: boolean;
  extra?: Record<string, () => Promise<unknown>>;
}

export async function findOne<T>(gateway: Gateway, schema: string, filter: Filter, fields: readonly string[]): Promise<T | null> {
  const res = await gateway.list<T>(schema, { filter, fields, page: 1, pageSize: 1 });
  return res.items[0] ?? null;
}

export function builtInOrCustomRole(key: string, customRoles: readonly RoleDef[]): RoleDef | null {
  return builtInWorkspaceRoles().find((r) => r.key === key) ?? customRoles.find((r) => !r.isBuiltIn && r.key === key) ?? null;
}

export async function openOp(
  ctx: OpCtx,
  deps: OpDeps,
  opts: OpenOptions,
): Promise<{ ok: true; caller: Caller } | { ok: false; error: OpError }> {
  const c = ctx.context;
  const cloudIam = deps.identitySource === "iam";
  if (!c.isAuthenticated || !c.userId) {
    return { ok: false, error: { code: "forbidden", messageKey: "tenancy.signInRequired" } };
  }
  const userId = c.userId;
  const email = (c.email ?? "").trim().toLowerCase();
  // The roles source (PlatformSetting rbac.source): "factory" reads the rows below, "iam" asks IAM. Started now, so it
  // shares the round trip of the reads below.
  const viewP = deps.rbac ? deps.rbac.view() : null;
  viewP?.catch(() => undefined);
  const { gateway } = deps;
  const wsId = opts.workspaceId;
  const inWorkspace = opts.scope === "workspace" && Boolean(wsId);
  const accountFields: readonly string[] = ACCOUNT_SUPER_ADMIN_FIELD ? [...ACCOUNT_FIELDS, ACCOUNT_SUPER_ADMIN_FIELD] : ACCOUNT_FIELDS;
  const extraKeys = Object.keys(opts.extra ?? {});

  let account: AccountRow | null = null;
  if (!cloudIam) {
    account = await findOne<AccountRow>(gateway, SCHEMA.account, { UserId: userId }, accountFields);
    if (account?.Status === "deactivated" && !opts.allowInactiveAccount) {
      return { ok: false, error: { code: "account_inactive" } };
    }
    if (!account && !opts.allowMissingAccount && opts.scope !== "self") {
      return { ok: false, error: { code: "account_inactive" } };
    }
  }
  // When cloudIam (blocks mode) the auth layer (per-request iam.me) already enforces active status,
  // so account reads and account_inactive checks are unnecessary and would always fail for new users.

  const [assignments, platformRoleRows, workspace, membership, roleRows, team, ...extras] = await Promise.all([
    gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
      filter: { UserId: userId, Status: "active" }, fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
    }),
    gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: PLATFORM_ROLE_FIELDS }),
    wsId ? findOne<WorkspaceRow>(gateway, SCHEMA.workspace, { ItemId: wsId }, WORKSPACE_FIELDS) : Promise.resolve(null),
    inWorkspace ? findOne<MembershipRow>(gateway, SCHEMA.membership, { WorkspaceId: wsId!, UserId: userId }, MEMBERSHIP_FIELDS) : Promise.resolve(null),
    inWorkspace ? gateway.listAll<WorkspaceRoleRow>(SCHEMA.workspaceRole, { filter: { WorkspaceId: wsId! }, fields: WORKSPACE_ROLE_FIELDS }) : Promise.resolve([] as WorkspaceRoleRow[]),
    inWorkspace && opts.loadTeam ? gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { WorkspaceId: wsId! }, fields: MEMBERSHIP_FIELDS, maxItems: MAX_TEAM_ROWS }) : Promise.resolve([] as MembershipRow[]),
    ...extraKeys.map((k) => opts.extra![k]()),
  ]);
  if (wsId && !workspace) return { ok: false, error: { code: "not_found" } };

  let view: RbacView | null = null;
  if (viewP) {
    try {
      view = await viewP;
    } catch (e) {
      return { ok: false, error: iamRefusal(e) };
    }
  }
  const fromIam = view?.source === "iam";
  const isSuperAdmin = fromIam ? view!.isSuperAdmin : (c.roles ?? []).includes(IAM_SUPER_ADMIN_ROLE);
  const platformRoles = platformRoleRows.map(toRoleDef);
  const platformAccess = fromIam
    ? view!.platform!
    : resolvePlatformAccess({
        isSuperAdmin,
        assignments: assignments.map((a) => ({ roleKey: a.RoleKey, status: a.Status })),
        platformRoles,
      });
  const platform = { permissions: [...platformAccess.permissions], roleKeys: [...platformAccess.roleKeys] };
  const customRoles = roleRows.filter((r) => !r.IsBuiltIn).map(toRoleDef);

  let access: WorkspaceAccess | null = null;
  let granter: WorkspacePermission[] = [];
  if (inWorkspace) {
    if (workspace!.Status !== "active") return { ok: false, error: { code: "forbidden", messageKey: "fn.workspaceInactive" } };
    let iamWs: IamWorkspaceAccess | null = null;
    if (fromIam) {
      try {
        iamWs = await view!.workspace(wsId!);
      } catch (e) {
        return { ok: false, error: iamRefusal(e) };
      }
    }
    access = iamWs
      ? iamWorkspaceAccess({ isSuperAdmin, iam: iamWs, membership, platformPermissions: platform.permissions })
      : resolveWorkspaceAccess({
          isSuperAdmin,
          membership: membership ? { roleKey: membership.RoleKey, status: membership.Status } : null,
          customRoles,
          platformPermissions: platform.permissions,
        });
    if (access.permissions.length === 0) return { ok: false, error: { code: "not_member" } };
    if (opts.permission && !access.permissions.includes(opts.permission)) {
      return { ok: false, error: { code: "forbidden", messageKey: "tenancy.notHeld", params: { permissions: [opts.permission] } } };
    }
    granter = [...granterPermissions({ ...access, isSuperAdmin })];
  }

  if (opts.platformPermission) {
    const wanted = typeof opts.platformPermission === "string" ? [opts.platformPermission] : [...opts.platformPermission];
    if (!wanted.some((p) => platform.permissions.includes(p))) {
      return { ok: false, error: { code: "forbidden", messageKey: "tenancy.notHeld", params: { permissions: wanted } } };
    }
  }

  const extra: Record<string, unknown> = {};
  extraKeys.forEach((k, i) => {
    extra[k] = extras[i];
  });

  return {
    ok: true,
    caller: {
      userId,
      email,
      isSuperAdmin,
      impersonated: Boolean(c.impersonated),
      account,
      actorName: account?.DisplayName || c.displayName || email,
      platform,
      workspace,
      membership,
      team,
      customRoles,
      access,
      granter,
      extra,
    },
  };
}

/**
 * What a person may do in a workspace when IAM decides (rbac.source "iam"): IAM's role and permissions in the
 * workspace's organization, and an active Membership row too (both are needed; either missing = not a member). The super
 * admin and platform workspace managers reach it as with the Factory rows.
 */
export function iamWorkspaceAccess(i: {
  isSuperAdmin: boolean;
  iam: IamWorkspaceAccess;
  membership: MembershipRow | null;
  platformPermissions: readonly string[];
}): WorkspaceAccess {
  const member = i.membership?.Status === "active" && i.iam.roleKey ? i.iam.roleKey : null;
  if (i.isSuperAdmin) return { permissions: [...WORKSPACE_PERMISSIONS], viaPlatform: !member, roleKey: member ?? "owner" };
  if (member) return { permissions: [...i.iam.permissions], viaPlatform: false, roleKey: member };
  if (i.platformPermissions.includes("platform.workspaces.manage")) {
    return { permissions: [...PLATFORM_MANAGER_WORKSPACE_PERMISSIONS], viaPlatform: true, roleKey: null };
  }
  return { permissions: [], viaPlatform: false, roleKey: null };
}

/** A failed roles-source read or IAM write as a plain refusal (messageKey iam.unavailable / iam.forbidden / iam.notFound). */
export function iamRefusal(e: unknown): OpError {
  const key = isIamAdminError(e)
    ? e.code
    : e && typeof e === "object" && typeof (e as { messageKey?: unknown }).messageKey === "string" && String((e as { messageKey: string }).messageKey).startsWith("iam.")
      ? ((e as { messageKey: string }).messageKey as IamErrorCode)
      : "iam.unavailable";
  const code: OpError["code"] =
    key === "iam.forbidden" ? "forbidden" : key === "iam.notFound" ? "not_found" : "unavailable";
  return { code, messageKey: key };
}

/**
 * The IAM-first step of a role or access change: runs `work` on the IAM admin module when rbac.source is "iam" (no-op
 * with "factory"). Answers a refusal when IAM failed; the op then returns it before writing any Factory row.
 */
export async function iamFirst(deps: OpDeps, work: (iam: IamAdminApi) => Promise<void>): Promise<OpAnswer<never> | null> {
  if (!deps.rbac) return null;
  let view: RbacView;
  try {
    view = await deps.rbac.view();
  } catch (e) {
    return { ok: false, error: iamRefusal(e) };
  }
  if (view.source !== "iam") return null;
  if (!deps.rbac.iam) return { ok: false, error: { code: "unavailable", messageKey: "iam.unavailable" } };
  try {
    await work(deps.rbac.iam);
    return null;
  } catch (e) {
    return { ok: false, error: iamRefusal(e) };
  }
}

/** After a role or access change: drop the cached access (of these people, or everyone). Never fails the op. */
export async function rbacChanged(deps: OpDeps, userIds?: readonly string[]): Promise<void> {
  try {
    await deps.rbac?.changed(userIds ? { userIds } : {});
  } catch {
    // the caches expire on their own within a minute
  }
}

// ---------------------------------------------------------------- audit and notify

export interface AuditEntry {
  action?: string;
  workspaceId?: string;
  projectId?: string;
  targetType: string;
  targetId: string;
  details?: unknown;
  viaPlatform?: boolean;
  /** A shared RequestKey instead of the request-derived one: the row doubles as a guard between concurrent requests. */
  onceKey?: string;
}

/**
 * The guard key of an owner-reducing change: racing requests read the same owner snapshot and get the same key, while
 * any later owner change (a new LastUpdatedDate stamp) gives a new one, so a recurring owner set is never refused forever.
 */
export function ownerGuardKey(workspaceId: string, owners: readonly { ItemId: string; LastUpdatedDate?: unknown }[]): string {
  const text = owners
    .map((o) => `${o.ItemId}@${String(o.LastUpdatedDate ?? "")}`)
    .sort()
    .join(",");
  return `owners:${workspaceId}:${fnv64(text)}`;
}

function fnv64(text: string): string {
  const MASK = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * The guard key of a super-admin-reducing change: racing requests read the same active super admins and the same epoch
 * (the latest people.setRole AuditEvent) and get the same key; a later change moves the epoch, so it is never refused forever.
 */
export function superAdminGuardKey(superAdminIds: readonly string[], epoch: string): string {
  return `superadmins:${fnv64(`${[...superAdminIds].sort().join(",")}|${epoch}`)}`;
}

export async function audit(
  deps: OpDeps,
  ctx: OpCtx,
  caller: Caller,
  e: AuditEntry,
  n = 0,
): Promise<{ created: boolean; row: Record<string, unknown> }> {
  const base = isObject(e.details) ? e.details : e.details === undefined ? {} : { value: e.details };
  let detailsJson = JSON.stringify({ ...base, viaPlatform: Boolean(e.viaPlatform) });
  if (detailsJson.length > MAX_AUDIT_DETAILS) detailsJson = JSON.stringify({ truncated: true });
  const res = await deps.gateway.insertOnce<Record<string, unknown>>(
    SCHEMA.auditEvent,
    {
      WorkspaceId: e.workspaceId ?? "",
      ProjectId: e.projectId ?? "",
      ActorUserId: caller.userId,
      ActorIsSuperAdmin: caller.isSuperAdmin,
      Impersonated: caller.impersonated,
      Action: e.action ?? ctx.op,
      TargetType: e.targetType,
      TargetId: e.targetId,
      DetailsJson: detailsJson,
      At: deps.clock.now(),
      CreatedByUserId: caller.userId,
      UpdatedByUserId: caller.userId,
    },
    e.onceKey ?? `audit:${ctx.requestId}:${n}`,
  );
  return { created: res.created, row: res.item };
}

/** A last write: handed to the router (same round trip as the audit and Operation writes), or run inline without one. */
export async function finishWith(deps: OpDeps, work: () => Promise<unknown>): Promise<void> {
  if (deps.after) deps.after(work);
  else await work();
}

export interface NotifyInput {
  kind: string;
  recipients: readonly string[];
  params: Record<string, unknown>;
  link: string | null;
  workspaceId?: string;
  projectId?: string;
  local: string;
  emailStatus?: "none" | "pending";
}

export async function notify(deps: OpDeps, ctx: OpCtx, caller: Caller, n: NotifyInput): Promise<{ written: number }> {
  const v = validateNotification(n.kind, n.params, n.link);
  if (!v.ok) throw new Error(`invalid notification ${n.kind}: ${v.reason}`);
  const recipients = [...new Set(n.recipients.filter(Boolean))].slice(0, MAX_NOTIFICATION_RECIPIENTS);
  const eventKey = notificationEventKey(ctx.op, ctx.requestId, n.local);
  const results = await Promise.all(
    recipients.map((to) => {
      const row: Record<string, unknown> = {
        RecipientUserId: to,
        WorkspaceId: n.workspaceId ?? "",
        ProjectId: n.projectId ?? "",
        EventKey: eventKey,
        Kind: n.kind,
        ParamsJson: v.paramsJson,
        IsRead: false,
        EmailStatus: n.emailStatus ?? "none",
        CreatedByUserId: caller.userId,
        UpdatedByUserId: caller.userId,
      };
      if (typeof v.link === "string" && v.link) row.Link = v.link;
      return deps.gateway.insertOnce(SCHEMA.notification, row, `${eventKey}:${to}`);
    }),
  );
  return { written: results.filter((r) => r.created).length };
}

/** User ids holding a platform permission through active assignments (super admins are added by the caller). */
export async function platformHolders(deps: OpDeps, permission: PlatformPermission): Promise<string[]> {
  if (deps.access?.platformHolders) return deps.access.platformHolders(permission);
  const [assignments, roleRows] = await Promise.all([
    deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
      filter: { Status: "active" },
      fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
    }),
    deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: PLATFORM_ROLE_FIELDS }),
  ]);
  return holdersOf(assignments, roleRows.map(toRoleDef), permission);
}

/** Pure part of the holder lookup, shared with restampPlatform. */
export function holdersOf(
  assignments: readonly PlatformRoleAssignmentRow[],
  roles: readonly RoleDef[],
  permission: PlatformPermission | null,
): string[] {
  const byUser = new Map<string, { roleKey: string; status: string }[]>();
  for (const a of assignments) {
    if (!a.UserId) continue;
    const list = byUser.get(a.UserId) ?? [];
    list.push({ roleKey: a.RoleKey, status: a.Status });
    byUser.set(a.UserId, list);
  }
  const out: string[] = [];
  for (const [userId, list] of byUser) {
    const access = resolvePlatformAccess({ isSuperAdmin: false, assignments: list, platformRoles: roles });
    if (permission ? access.permissions.includes(permission) : access.permissions.length > 0) out.push(userId);
  }
  return out.sort();
}

/**
 * Takes the owner guard for a change that reduces the active owner set: the guard audit row is written first, and a
 * second request on the same owner snapshot finds it and is refused. Returns null when this request may go on.
 */
export async function takeOwnerGuard(
  deps: OpDeps,
  ctx: OpCtx,
  caller: Caller,
  entry: AuditEntry,
  workspaceId: string,
): Promise<OpAnswer<never> | null> {
  const owners = caller.team.filter((m) => m.Status === "active" && m.RoleKey === "owner");
  return takeGuard(deps, ctx, caller, entry, ownerGuardKey(workspaceId, owners));
}

/** Writes the guard audit row under a unique key; another request holding the key is refused (conflict), this request's own row is not. */
export async function takeGuard(
  deps: OpDeps,
  ctx: OpCtx,
  caller: Caller,
  entry: AuditEntry,
  key: string,
): Promise<OpAnswer<never> | null> {
  const guard = await audit(deps, ctx, caller, {
    ...entry,
    details: { ...(isObject(entry.details) ? entry.details : {}), requestId: ctx.requestId },
    onceKey: key,
  });
  if (guard.created) return null;
  let own = guard.row.ActorUserId === caller.userId;
  if (own) {
    try {
      own = (JSON.parse(String(guard.row.DetailsJson ?? "{}")) as { requestId?: unknown }).requestId === ctx.requestId;
    } catch {
      own = false;
    }
  }
  return own ? null : fail("conflict");
}

/** True when the change takes an active owner out of the owner set. */
export function reducesOwners(target: { RoleKey: string; Status: string }, nextRoleKey: string | null): boolean {
  return target.Status === "active" && target.RoleKey === "owner" && nextRoleKey !== "owner";
}

// Admin data layer: platform and workspace role reads, the access hooks and the admin/workspace function writes.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useSession } from "./session";
import { adminMounted } from "./config";
import { blocksKeys } from "./data/keys";
import { useBlocksAll } from "./data/hooks";
import { BlocksDataError } from "./data/errors";
import { queryList, type Where } from "./data/gql";
import { FunctionError, callFunction, type FunctionMutationConfig } from "./fn";
import {
  MSG_COUNT_FAILED, countActiveSuperAdmins, deactivateGuard, peopleError, requireSuperAdmin, setActive,
  type AdminResult, type PersonRow,
} from "./people";
import { FunctionNotConfiguredError, FUNCTION_SLUG } from "./functions";
import {
  assignPlatformRole, deactivateAccount, deletePlatformRole, deleteWorkspaceRole, getAllowedEmailDomains, inspectWorkspace,
  listAccessRequests, listAudit, listPlatformRoles, listWorkspaces, saveAllowedEmailDomains, savePlatformRole, saveWorkspaceRole,
  reactivateAccount, setMemberRole, suspendWorkspace, unassignPlatformRole,
} from "./workspaces/ops";
import { meKeys } from "./workspaces/queries";
import { useWorkspaces } from "./workspaces/store";
import { refreshSessionAccess } from "./sessionFreshness";
import { fromS1SettingKey, type AssignResult, type AuditEventRow, type AuditListResult, type IamRoleChange, type OpOutcome } from "./workspaces/types";
import { PLATFORM_ADMIN_ROLE, platformPermissionsFor, workspacePermissionsFor, type RoleDef } from "@/domain/roles";
import type { AuditEntry, PlatformSettingKey } from "@/domain/platform";

export const SCHEMAS = {
  platformRole: "PlatformRole",
  platformRoleAssignment: "PlatformRoleAssignment",
  workspaceRole: "WorkspaceRole",
  membership: "Membership",
  platformSetting: "PlatformSetting",
  auditEvent: "AuditEvent",
  workspace: "Workspace",
} as const;

export type PlatformRoleRecord = {
  ItemId: string;
  Key: string;
  Name: string;
  Description?: string | null;
  Permissions: string[];
  IsBuiltIn?: boolean | null;
};

export type PlatformRoleAssignmentRecord = {
  ItemId: string;
  UserId: string;
  RoleKey: string;
  Status?: string | null;
};

/** An assignment with the person's name, which platformRole.list reads from Account / Membership. */
export type PlatformRoleAssignmentView = PlatformRoleAssignmentRecord & { Email: string; DisplayName?: string | null };

export type WorkspaceRoleRecord = {
  ItemId: string;
  WorkspaceId: string;
  Key: string;
  Name: string;
  Description?: string | null;
  Permissions: string[];
};

export type MembershipRecord = {
  ItemId: string;
  WorkspaceId: string;
  UserId: string;
  Email: string;
  DisplayName?: string | null;
  RoleKey: string;
  Status?: string | null;
};

export type WorkspaceRecord = {
  ItemId: string;
  Name: string;
  Status?: string | null;
};

export type PlatformSettingRecord = {
  ItemId: string;
  Key: string;
  Values: string[];
  ValueJson: string;
};

export type AuditEventRecord = {
  ItemId: string;
  CreatedDate: string;
  ActorEmail: string;
  ActorName?: string | null;
  Action: string;
  TargetType?: string | null;
  TargetLabel?: string | null;
  WorkspaceId?: string | null;
  WorkspaceName?: string | null;
  CrossWorkspace?: boolean | null;
};

export const PLATFORM_ROLE_FIELDS = ["ItemId", "Key", "Name", "Description", "Permissions", "IsBuiltIn"] as const;
export const PLATFORM_ROLE_ASSIGNMENT_FIELDS = ["ItemId", "UserId", "RoleKey", "Status"] as const;
export const WORKSPACE_ROLE_FIELDS = ["ItemId", "WorkspaceId", "Key", "Name", "Description", "Permissions"] as const;
export const MEMBERSHIP_FIELDS = ["ItemId", "WorkspaceId", "UserId", "Email", "DisplayName", "RoleKey", "Status"] as const;
export const WORKSPACE_FIELDS = ["ItemId", "Name", "Status"] as const;
export const PLATFORM_SETTING_FIELDS = ["ItemId", "Key", "Values", "ValueJson"] as const;
export const AUDIT_EVENT_FIELDS = [
  "ItemId",
  "CreatedDate",
  "At",
  "ActorUserId",
  "Action",
  "TargetType",
  "TargetId",
  "WorkspaceId",
  "DetailsJson",
  "Impersonated",
] as const;

export function toRoleDef(r: PlatformRoleRecord | WorkspaceRoleRecord): RoleDef {
  const isBuiltIn = "IsBuiltIn" in r && r.IsBuiltIn === true;
  return {
    key: r.Key,
    name: r.Name,
    description: r.Description ?? undefined,
    permissions: Array.isArray(r.Permissions) ? r.Permissions : [],
    isBuiltIn,
  };
}

export function toAuditEntry(r: AuditEventRecord): AuditEntry {
  return {
    id: r.ItemId,
    at: r.CreatedDate,
    actorEmail: r.ActorEmail,
    actorName: r.ActorName ?? null,
    action: r.Action,
    targetType: r.TargetType ?? null,
    targetLabel: r.TargetLabel ?? null,
    workspaceId: r.WorkspaceId ?? null,
    workspaceName: r.WorkspaceName ?? null,
    crossWorkspace: r.CrossWorkspace === true,
  } as AuditEntry;
}

/** An S1 AuditEvent row as A1's entry: the readable names travel in DetailsJson when the function stamped them. */
export function auditEntryFromRow(r: AuditEventRow): AuditEntry {
  let d: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(r.DetailsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) d = parsed as Record<string, unknown>;
  } catch { /* free text in DetailsJson: no names */ }
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  return {
    id: r.ItemId,
    at: r.At || r.CreatedDate,
    actorEmail: str(d.actorEmail) ?? r.ActorUserId,
    actorName: str(d.actorName),
    action: r.Action,
    targetType: r.TargetType || null,
    targetLabel: str(d.targetLabel) ?? (r.TargetId || null),
    workspaceId: r.WorkspaceId || null,
    workspaceName: str(d.workspaceName),
    crossWorkspace: d.crossWorkspace === true || r.Impersonated === true,
  } as AuditEntry;
}

// ---- reads ----

const signedInUserId = (): string | null => useSession.getState().profile?.userId ?? null;

type PlatformList = Awaited<ReturnType<typeof listPlatformRoles>>;
type PlatformListValue = Extract<PlatformList, { ok: true }>["value"];

/** Throws the plain error text of a failed op, so the query / mutation state carries it. */
export class AdminWriteError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AdminWriteError";
    this.code = code;
  }
}

function unwrap<T>(r: OpOutcome<T>): T {
  if (r.ok) return r.value;
  throw new AdminWriteError(r.error, r.code);
}

const platformListQuery = (uid: string | null, enabled: boolean) => ({
  queryKey: meKeys.admin(uid ?? "", "platformRole.list"),
  queryFn: async (): Promise<PlatformListValue> => unwrap(await listPlatformRoles()),
  enabled: enabled && Boolean(uid),
  staleTime: 30_000,
  retry: 0,
});

export function usePlatformRoles(enabled = true): UseQueryResult<PlatformRoleRecord[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    ...platformListQuery(uid, enabled),
    select: (v): PlatformRoleRecord[] =>
      v.roles.map((r) => ({
        ItemId: r.itemId ?? r.key, Key: r.key, Name: r.name, Description: r.description ?? null,
        Permissions: r.permissions, IsBuiltIn: r.isBuiltIn,
      })),
  });
}

export function usePlatformRoleAssignments(
  opts: { userId?: string | null; enabled?: boolean } = {},
): UseQueryResult<PlatformRoleAssignmentView[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    ...platformListQuery(uid, opts.enabled ?? true),
    select: (v): PlatformRoleAssignmentView[] =>
      v.assignments
        .filter((a) => a.status === "active" && (!opts.userId || a.userId === opts.userId))
        .map((a) => ({ ItemId: a.itemId, UserId: a.userId, RoleKey: a.roleKey, Status: a.status, Email: a.email, DisplayName: a.displayName })),
  });
}

// Platform views are audited: five minutes fresh, never refetched on focus.
const AUDITED_QUERY = { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 0 } as const;

export type WorkspaceDirectoryEntry = { workspaceId: string; name: string; status: string; memberCount: number; admins: string[] };

export function useWorkspacesDirectory(enabled = true): UseQueryResult<WorkspaceRecord[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "workspace.list", { page: 1 }),
    queryFn: async () => unwrap(await listWorkspaces(1)),
    enabled: enabled && Boolean(uid),
    ...AUDITED_QUERY,
    select: (v): WorkspaceRecord[] => v.items.map((w) => ({ ItemId: w.workspaceId, Name: w.name, Status: w.status })),
  });
}

/** Per-workspace member count and admin names, from the same audited workspace.list answer. */
export function useWorkspaceSummaries(enabled = true): UseQueryResult<WorkspaceDirectoryEntry[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "workspace.list", { page: 1 }),
    queryFn: async () => unwrap(await listWorkspaces(1)),
    enabled: enabled && Boolean(uid),
    ...AUDITED_QUERY,
    select: (v): WorkspaceDirectoryEntry[] =>
      v.items.map((w) => ({
        workspaceId: w.workspaceId, name: w.name, status: w.status, memberCount: w.memberCount,
        admins: w.admins.map((a) => a.displayName || a.email).filter(Boolean),
      })),
  });
}

/** Members of one workspace through workspace.inspect (audited). */
export function useAllMemberships(workspaceId?: string | null, enabled = true): UseQueryResult<MembershipRecord[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "workspace.inspect", { workspaceId: workspaceId ?? "" }),
    queryFn: async () => unwrap(await inspectWorkspace(workspaceId ?? "")),
    enabled: enabled && Boolean(uid) && Boolean(workspaceId),
    ...AUDITED_QUERY,
    select: (v): MembershipRecord[] => v.members as unknown as MembershipRecord[],
  });
}

export function useWorkspaceRoles(workspaceId: string | null | undefined): UseQueryResult<WorkspaceRoleRecord[], BlocksDataError> {
  return useBlocksAll<WorkspaceRoleRecord>(SCHEMAS.workspaceRole, {
    workspaceId,
    fields: WORKSPACE_ROLE_FIELDS,
    sort: [{ field: "Name", dir: "asc" }],
  });
}

export function useMemberships(workspaceId: string | null | undefined): UseQueryResult<MembershipRecord[], BlocksDataError> {
  return useBlocksAll<MembershipRecord>(SCHEMAS.membership, { workspaceId, fields: MEMBERSHIP_FIELDS });
}

/** The two allowed-email settings as A1 setting records (the platform default is returned as no rows). */
export function settingRecordsFrom(v: { domains: string[]; exceptions: string[]; isDefault: boolean }): PlatformSettingRecord[] {
  const row = (s1Key: string, values: string[]): PlatformSettingRecord | null => {
    const key = fromS1SettingKey(s1Key as never) as string | null;
    return key ? { ItemId: s1Key, Key: key, Values: values, ValueJson: JSON.stringify(values) } : null;
  };
  const rows = [
    v.isDefault ? null : row("allowed-email-domains", v.domains),
    v.exceptions.length ? row("allowed-email-exceptions", v.exceptions) : null,
  ];
  return rows.filter((r): r is PlatformSettingRecord => r !== null);
}

export function usePlatformSettings(enabled = true): UseQueryResult<PlatformSettingRecord[], Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "setting.get", { key: "AllowedEmailDomains" }),
    queryFn: async () => unwrap(await getAllowedEmailDomains()),
    enabled: enabled && Boolean(uid),
    staleTime: 30_000,
    retry: 0,
    select: settingRecordsFrom,
  });
}

export const AUDIT_PAGE_SIZE = 50;
/** Kept for the page footer; the audit trail is now paged by the server. */
export const AUDIT_MAX_ITEMS = 1000;

export type AuditQuery = {
  workspaceId?: string; actorUserId?: string; actor?: string; action?: string; targetType?: string; crossWorkspaceOnly?: boolean;
  from?: string; to?: string; page: number; pageSize?: number;
};
export type AuditPage = {
  entries: AuditEntry[]; totalCount: number; page: number; pageSize: number; hasMore: boolean; nextPage: number | null;
};

const MSG_AUDIT_ACTOR_TOO_BROAD = "Too many people match. Type more of the name or email.";

export function useAuditPage(args: AuditQuery, enabled = true): UseQueryResult<AuditPage, Error> {
  const uid = useSession((s) => s.profile?.userId ?? null);
  const { actor, crossWorkspaceOnly, ...rest } = args;
  const actorText = actor?.trim();
  const body = {
    ...rest, pageSize: Math.min(100, args.pageSize ?? AUDIT_PAGE_SIZE),
    ...(actorText ? { actor: actorText } : {}),
    ...(crossWorkspaceOnly === true ? { crossWorkspaceOnly: true } : {}),
  };
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "audit.list", body),
    queryFn: async (): Promise<AuditPage> => {
      const out = await listAudit(body);
      if (!out.ok) {
        const key = (out as { messageKey?: string }).messageKey;
        if (key === "audit.actorTooBroad" || out.code === "limit_reached") {
          throw new AdminWriteError(MSG_AUDIT_ACTOR_TOO_BROAD, out.code);
        }
      }
      const v = unwrap(out) as AuditListResult & { hasMore?: boolean; nextPage?: number | null };
      const more = typeof v.hasMore === "boolean" ? v.hasMore : v.page * v.pageSize < v.totalCount;
      return {
        entries: v.items.map(auditEntryFromRow),
        totalCount: v.totalCount, page: v.page, pageSize: v.pageSize,
        hasMore: more,
        nextPage: v.nextPage !== undefined ? v.nextPage : more ? v.page + 1 : null,
      };
    },
    enabled: enabled && Boolean(uid),
    ...AUDITED_QUERY,
    placeholderData: (prev) => prev,
  });
}

/** Look up a person's UserId by email in the Account mirror (readable by the super admin). */
export async function findAccountUserId(email: string): Promise<string | null> {
  const where = { op: "eq", field: "Email", value: email.trim().toLowerCase() } as unknown as Where<{ UserId: string; Email: string }>;
  const rows = await queryList<{ UserId: string; Email: string }>("Account", { fields: ["UserId", "Email"], where, maxItems: 1 });
  return rows[0]?.UserId ?? null;
}

// ---- access ----

export type PlatformAccess = {
  ready: boolean;
  isSuperAdmin: boolean;
  userId: string | null;
  email: string | null;
  roleKeys: string[];
  permissions: string[];
};

export function platformAccessFrom(i: {
  isSuperAdmin: boolean;
  userId: string | null;
  email: string | null;
  assignments: readonly PlatformRoleAssignmentRecord[] | undefined;
  roles: readonly PlatformRoleRecord[] | undefined;
  settled: boolean;
  /** Platform permissions me.bootstrap reported: the fallback when the role rows can't be read. */
  storePermissions?: readonly string[];
}): PlatformAccess {
  const roleKeys = (i.assignments ?? []).map((a) => a.RoleKey);
  const fromRoles: string[] = platformPermissionsFor({
    isSuperAdmin: i.isSuperAdmin,
    roleKeys,
    roles: [PLATFORM_ADMIN_ROLE, ...(i.roles ?? []).map(toRoleDef)],
  });
  const permissions = i.isSuperAdmin ? fromRoles : [...new Set([...fromRoles, ...(i.storePermissions ?? [])])];
  return {
    ready: i.isSuperAdmin || i.settled,
    isSuperAdmin: i.isSuperAdmin,
    userId: i.userId,
    email: i.email,
    roleKeys,
    permissions,
  };
}

export function usePlatformAccess(): PlatformAccess {
  const status = useSession((s) => s.status);
  const profile = useSession((s) => s.profile);
  const storePerms = useWorkspaces((s) => s.platformPermissions);
  const storeReady = useWorkspaces((s) => s.ready);
  const bootstrapError = useWorkspaces((s) => s.bootstrapError);
  const bootstrapPending = useWorkspaces((s) => s.bootstrapPending);
  const signedIn = status === "signed-in" && Boolean(profile);
  const userId = profile?.userId ?? null;
  const isSuperAdmin = profile?.isSuperAdmin === true;
  const hasStorePerms = (storePerms?.length ?? 0) > 0;
  // platformRole.list is itself an audited op: only people who can hold platform permissions ask for it.
  // Not asked at all where the admin function is not mounted (the Blocks host today).
  const listed = usePlatformList(adminMounted() && signedIn && Boolean(userId) && (isSuperAdmin || hasStorePerms));
  const mine = (listed.data?.assignments ?? []).filter((a) => a.status === "active" && a.userId === userId);

  let settled: boolean;
  if (status === "restoring") settled = false;
  else if (!signedIn) settled = true;
  else if (isSuperAdmin) settled = true;
  else if ((!storeReady || bootstrapPending) && !bootstrapError) settled = false;
  else if (!hasStorePerms) settled = true;
  else settled = true; // the store already holds the permissions; the role rows only refine them

  const roles: PlatformRoleRecord[] | undefined = listed.data?.roles.map((r) => ({
    ItemId: r.itemId ?? r.key, Key: r.key, Name: r.name, Description: r.description ?? null, Permissions: r.permissions, IsBuiltIn: r.isBuiltIn,
  }));
  return platformAccessFrom({
    isSuperAdmin,
    userId,
    email: profile?.email ?? null,
    assignments: listed.isError ? undefined : mine.map((a) => ({ ItemId: a.itemId, UserId: a.userId, RoleKey: a.roleKey, Status: a.status })),
    roles: listed.isError ? undefined : roles,
    settled,
    storePermissions: storePerms ?? [],
  });
}

function usePlatformList(enabled: boolean) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery(platformListQuery(uid, enabled));
}

export type WorkspaceAccess = {
  ready: boolean;
  roleKey: string | null;
  permissions: string[];
  customRoles: RoleDef[];
};

export function useWorkspaceAccess(workspaceId: string | null | undefined, fallbackRoleKey?: string | null): WorkspaceAccess {
  const profile = useSession((s) => s.profile);
  const memberships = useMemberships(workspaceId);
  const roles = useWorkspaceRoles(workspaceId);
  const rows = memberships.data;
  const roleRows = roles.data;

  return useMemo(() => {
    const email = profile?.email?.toLowerCase() ?? null;
    const mine =
      rows?.find((m) => profile && m.UserId === profile.userId) ??
      rows?.find((m) => email !== null && m.Email.toLowerCase() === email);
    const roleKey = mine?.RoleKey ?? fallbackRoleKey ?? null;
    const customRoles = (roleRows ?? []).map(toRoleDef);
    const permissions: string[] = workspacePermissionsFor({
      roleKey,
      isSuperAdmin: profile?.isSuperAdmin === true,
      customRoles,
    });
    const settled = (memberships.isSuccess || memberships.isError) && (roles.isSuccess || roles.isError);
    return { ready: Boolean(workspaceId) && settled, roleKey, permissions, customRoles };
  }, [rows, roleRows, profile, fallbackRoleKey, workspaceId, memberships.isSuccess, memberships.isError, roles.isSuccess, roles.isError]);
}

// ---- writes ----

export type PlatformRoleSaveArgs = { itemId?: string; key: string; name: string; description: string; permissions: string[] };
export type PlatformRoleDeleteArgs = { itemId: string; key: string };
export type PlatformRoleAssignArgs = { userId: string; roleKey: string };
export type PlatformRoleUnassignArgs = { assignmentId?: string; userId: string; roleKey: string };
export type SettingSaveArgs = { key: PlatformSettingKey; values: string[] };
export type WorkspaceRoleSaveArgs = {
  workspaceId: string;
  itemId?: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  crossWorkspace: boolean;
};
export type WorkspaceRoleDeleteArgs = {
  workspaceId: string;
  itemId: string;
  key: string;
  reassignTo: string | null;
  crossWorkspace: boolean;
};
export type MemberSetRoleArgs = {
  workspaceId: string;
  membershipId: string;
  userId: string;
  roleKey: string;
  crossWorkspace: boolean;
};

const audit = () => blocksKeys.platformSchema(SCHEMAS.auditEvent);
const workspaceInvalidate = (_data: unknown, args: { workspaceId: string }) => [
  blocksKeys.schema(args.workspaceId, SCHEMAS.workspaceRole),
  blocksKeys.schema(args.workspaceId, SCHEMAS.membership),
  blocksKeys.platformSchema(SCHEMAS.membership),
  audit(),
];

/** Which function and op each admin write calls (the call itself goes through the typed wrappers below). */
export const ADMIN_WRITES = {
  platformRoleSave: { fn: "admin", op: "platformRole.save" } as FunctionMutationConfig<PlatformRoleSaveArgs, unknown>,
  platformRoleDelete: { fn: "admin", op: "platformRole.delete" } as FunctionMutationConfig<PlatformRoleDeleteArgs, unknown>,
  platformRoleAssign: { fn: "admin", op: "platformRole.assign" } as FunctionMutationConfig<PlatformRoleAssignArgs, unknown>,
  platformRoleUnassign: { fn: "admin", op: "platformRole.unassign" } as FunctionMutationConfig<PlatformRoleUnassignArgs, unknown>,
  settingSave: { fn: "admin", op: "setting.save" } as FunctionMutationConfig<SettingSaveArgs, unknown>,
  workspaceRoleSave: { fn: "admin", op: "workspaceRole.save", invalidate: workspaceInvalidate } as FunctionMutationConfig<WorkspaceRoleSaveArgs, unknown>,
  workspaceRoleDelete: { fn: "admin", op: "workspaceRole.delete", invalidate: workspaceInvalidate } as FunctionMutationConfig<WorkspaceRoleDeleteArgs, unknown>,
  memberSetRole: { fn: "workspace", op: "member.setRole", invalidate: workspaceInvalidate } as FunctionMutationConfig<MemberSetRoleArgs, unknown>,
};

export type { AssignResult, IamRoleChange } from "./workspaces/types";

/** One admin write: calls the wrapper, throws the plain error on failure, then refreshes the touched reads. A write that can
 *  change platform access (`access`) also reads the signed-in person's own profile and permissions again at once. */
function useAdminMutation<TArgs, TData>(
  call: (args: TArgs) => Promise<OpOutcome<TData>>,
  refresh: (data: TData, args: TArgs, uid: string) => readonly (readonly unknown[])[],
  o: { access?: boolean } = {},
): UseMutationResult<TData, Error, TArgs> {
  const client = useQueryClient();
  return useMutation<TData, Error, TArgs>({
    mutationFn: async (args) => unwrap(await call(args)),
    retry: 0,
    onSuccess: async (data, args) => {
      const uid = signedInUserId() ?? "";
      if (o.access) void refreshSessionAccess();
      for (const queryKey of refresh(data, args, uid)) await client.invalidateQueries({ queryKey });
    },
  });
}

const ACCESS = { access: true } as const;

const adminOp = (uid: string, ...ops: string[]) => ops.map((op) => meKeys.admin(uid, op) as readonly unknown[]);

// A platform role's permissions or holders changed: the signed-in person may hold it (ACCESS).
export const useSavePlatformRole = () =>
  useAdminMutation<PlatformRoleSaveArgs, unknown>(
    (a) => savePlatformRole({ key: a.key, name: a.name, description: a.description, permissions: a.permissions }),
    (_d, _a, uid) => [...adminOp(uid, "platformRole.list", "audit.list")],
    ACCESS,
  );
export const useDeletePlatformRole = () =>
  useAdminMutation<PlatformRoleDeleteArgs, unknown>(
    (a) => deletePlatformRole(a.key),
    (_d, _a, uid) => [...adminOp(uid, "platformRole.list", "audit.list")],
    ACCESS,
  );
export const useAssignPlatformRole = () =>
  useAdminMutation<PlatformRoleAssignArgs, AssignResult>(
    (a) => assignPlatformRole({ userId: a.userId, roleKey: a.roleKey }) as Promise<OpOutcome<AssignResult>>,
    (_d, _a, uid) => [...adminOp(uid, "platformRole.list", "audit.list")],
    ACCESS,
  );
export const useUnassignPlatformRole = () =>
  useAdminMutation<PlatformRoleUnassignArgs, AssignResult>(
    (a) => unassignPlatformRole({ userId: a.userId, roleKey: a.roleKey }) as Promise<OpOutcome<AssignResult>>,
    (_d, _a, uid) => [...adminOp(uid, "platformRole.list", "audit.list")],
    ACCESS,
  );

export const useSaveSetting = () =>
  useAdminMutation<SettingSaveArgs, unknown>(
    async (a) => {
      // setting.save writes both lists together: fill the list this card did not change from the saved setting.
      const current = await getAllowedEmailDomains();
      if (!current.ok) return current;
      const v = current.value;
      return saveAllowedEmailDomains(
        a.key === toSettingKey("domains")
          ? { domains: a.values, exceptions: v.exceptions }
          : { domains: v.domains, exceptions: a.values },
      );
    },
    (_d, _a, uid) => [...adminOp(uid, "setting.get", "audit.list")],
  );

/** A1's key for each list; the S1 key mapping lives in workspaces/types. */
function toSettingKey(which: "domains" | "exceptions"): PlatformSettingKey {
  const k = fromS1SettingKey((which === "domains" ? "allowed-email-domains" : "allowed-email-exceptions") as never) as PlatformSettingKey | null;
  return (k ?? (which === "domains" ? "allowedEmailDomains" : "qaExceptions")) as PlatformSettingKey;
}

export const useSaveWorkspaceRole = () =>
  useAdminMutation<WorkspaceRoleSaveArgs, unknown>(
    // itemId and crossWorkspace are dropped: the function refuses unknown keys.
    (a) => saveWorkspaceRole({ workspaceId: a.workspaceId, key: a.key, name: a.name, description: a.description, permissions: a.permissions }),
    (_d, a, uid) => [...workspaceInvalidate(null, a), ...adminOp(uid, "audit.list", "workspace.inspect")],
  );
export const useDeleteWorkspaceRole = () =>
  useAdminMutation<WorkspaceRoleDeleteArgs, unknown>(
    (a) => deleteWorkspaceRole({ workspaceId: a.workspaceId, key: a.key, ...(a.reassignTo ? { reassignTo: a.reassignTo } : {}) }),
    (_d, a, uid) => [...workspaceInvalidate(null, a), ...adminOp(uid, "audit.list", "workspace.inspect")],
  );
export const useSetMemberRole = () =>
  useAdminMutation<MemberSetRoleArgs, unknown>(
    // userId and crossWorkspace are dropped: the function stamps the person from the membership.
    (a) => setMemberRole({ workspaceId: a.workspaceId, membershipId: a.membershipId, roleKey: a.roleKey }),
    (_d, a, uid) => [...workspaceInvalidate(null, a), ...adminOp(uid, "audit.list", "workspace.inspect", "workspace.list")],
  );

export type SuspendWorkspaceArgs = { workspaceId: string; suspended: boolean; reason?: string };
export const useSuspendWorkspace = () =>
  useAdminMutation<SuspendWorkspaceArgs, unknown>(
    (a) => suspendWorkspace({ workspaceId: a.workspaceId, suspended: a.suspended, ...(a.reason ? { reason: a.reason } : {}) }),
    (_d, a, uid) => [...adminOp(uid, "workspace.list", "workspace.inspect", "audit.list"), blocksKeys.schema(a.workspaceId, SCHEMAS.membership)],
  );

export function useAccessRequests(page = 1, enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "accessRequest.list", { page }),
    queryFn: async () => unwrap(await listAccessRequests(page)),
    enabled: enabled && Boolean(uid),
    ...AUDITED_QUERY,
  });
}

export function adminErrorMessage(e: unknown): string {
  if (e instanceof AdminWriteError) return e.message;
  if (e instanceof FunctionNotConfiguredError) {
    return `This change can't be saved yet: the ${FUNCTION_SLUG[e.fn]} function is not available yet.`;
  }
  if (e instanceof FunctionError || e instanceof BlocksDataError) return e.message;
  return "Something went wrong. Please try again.";
}

export type WriteOutcome = { ok: true } | { ok: false; error: string };

export async function settleWrite(p: Promise<unknown>): Promise<WriteOutcome> {
  try {
    await p;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: adminErrorMessage(e) };
  }
}

export const MSG_ASK_SUPER_ADMIN = "Ask the super admin to grant you user-management access.";

/**
 * Applies the IAM role change an assign / unassign answered with, using the super admin's own token
 * (the admin people.setRole op, which calls IAM with the caller's own token). Anyone else is told to ask the super admin.
 */
export async function applyIamRoleChange(change: IamRoleChange, _email: string): Promise<WriteOutcome> {
  if (requireSuperAdmin()) return { ok: false, error: MSG_ASK_SUPER_ADMIN };
  try {
    await callFunction("admin", "people.setRole", { userId: change.userId, role: change.role, grant: change.grant });
    void refreshSessionAccess();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: peopleError(err) };
  }
}

export type PersonChange = AdminResult & { warning?: string };

const ownerlessName = (w: unknown): string =>
  typeof w === "string" ? w : String((w as { name?: string; workspaceName?: string; workspaceId?: string } | null)?.name
    ?? (w as { workspaceName?: string } | null)?.workspaceName ?? (w as { workspaceId?: string } | null)?.workspaceId ?? "");

/**
 * Deactivate a person: the data side first (cuts workspace access at once), then the IAM sign-in.
 * Both results are reported; a refusal on the data side changes nothing.
 */
export async function deactivatePerson(row: PersonRow): Promise<PersonChange> {
  const denied = requireSuperAdmin();
  if (denied) return { ok: false, error: denied };
  const me = useSession.getState().profile;
  const count = row.superAdmin ? await countActiveSuperAdmins() : 0;
  if (count === null) return { ok: false, error: MSG_COUNT_FAILED };
  const blocked = deactivateGuard({ me, target: row, superAdminCount: count });
  if (blocked) return { ok: false, error: blocked };
  const data = await deactivateAccount({ userId: row.userId });
  if (!data.ok) return { ok: false, error: data.error };
  const names = (data.value.ownerlessWorkspaces ?? []).map(ownerlessName).filter(Boolean);
  const warning = names.length ? `Left without an owner: ${names.join(", ")}.` : undefined;
  const iam = await setActive(row, false);
  if (!iam.ok) {
    return { ok: false, error: `Workspace access was removed, but ${row.displayName} could still sign in: ${iam.error}`, warning };
  }
  return { ok: true, message: `${row.displayName} is deactivated and has lost access to every workspace.`, warning };
}

/** Reactivate a person: the IAM sign-in first, then their workspace memberships. Both results are reported. */
export async function reactivatePerson(row: PersonRow): Promise<PersonChange> {
  const iam = await setActive(row, true);
  if (!iam.ok) return iam;
  const data = await reactivateAccount(row.userId);
  if (!data.ok) {
    return { ok: false, error: `${row.displayName} can sign in again, but their workspace access was not restored: ${data.error}` };
  }
  return { ok: true, message: `${row.displayName} is active again with their workspace access restored.` };
}

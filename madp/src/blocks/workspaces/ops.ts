// Typed wrappers over the mf-workspace and mf-admin operations. They never throw; each call is one user action and
// carries exactly one requestId, and each invalidates only the keys it touched.
import type { QueryKey } from "@tanstack/react-query";
import { FunctionError, callFunction, functionErrorMessage, newRequestId } from "../fn";
import { FunctionNotConfiguredError, type FunctionName } from "../functions";
import { blocksKeys } from "../data/keys";
import { queryClient } from "../queryClient";
import { useSession } from "../session";
import { tenancyMessage } from "./messages";
import { useWorkspaces } from "./store";
import { applyWorkspaceName, meKeys } from "./queries";
import type {
  AccessRequestListResult,
  AllowedDomainsResult,
  AssignResult,
  AuditListArgs,
  AuditListResult,
  BootstrapResult,
  CreateWorkspaceResult,
  DeactivateResult,
  InviteResult,
  MarkAllReadResult,
  MarkReadResult,
  MyAccessResult,
  OpOutcome,
  PlatformRoleListResult,
  ReactivateResult,
  RenameWorkspaceResult,
  RestampResult,
  SuspendResult,
  WorkspaceInspectResult,
  WorkspaceListResult,
  WorkspaceRoleDeleteResult,
  WorkspaceRoleSaveResult,
} from "./types";

export const NOT_CONFIGURED_MESSAGE = {
  workspace: "Workspaces aren't available yet (the workspace function isn't configured).",
  admin: "Workspaces aren't available yet (the admin function isn't configured).",
} as const;

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function outcomeError(e: unknown, fn: "workspace" | "admin"): { error: string; code?: string } {
  if (e instanceof FunctionNotConfiguredError) return { error: NOT_CONFIGURED_MESSAGE[fn] };
  if (e instanceof FunctionError) {
    return { error: tenancyMessage(e.messageKey, e.params) ?? functionErrorMessage(e.code), code: e.code };
  }
  return { error: GENERIC_MESSAGE };
}

function uidNow(): string | undefined {
  return useSession.getState().profile?.userId || undefined;
}

async function run<T>(
  fn: Extract<FunctionName, "workspace" | "admin">,
  op: string,
  args: Record<string, unknown>,
  keys: (uid: string | undefined, data: T) => readonly QueryKey[] = () => [],
  /** Writes the saved answer into the cache first (shown at once), before the invalidated keys refetch. */
  apply?: (uid: string | undefined, data: T) => void,
): Promise<OpOutcome<T>> {
  try {
    const res = await callFunction<T>(fn, op, args, { requestId: newRequestId() });
    try {
      apply?.(uidNow(), res.data);
      for (const queryKey of keys(uidNow(), res.data)) await queryClient.invalidateQueries({ queryKey });
    } catch {
      /* a refresh failure never turns a saved write into an error */
    }
    return { ok: true, value: res.data };
  } catch (e) {
    return { ok: false, ...outcomeError(e, fn) };
  }
}

const memberKeys = (ws: string): QueryKey[] => [blocksKeys.schema(ws, "Membership"), blocksKeys.schema(ws, "Invitation")];
const meOnly = (uid: string | undefined, ...mk: ((u: string) => QueryKey)[]): QueryKey[] => (uid ? mk.map((f) => f(uid)) : []);

// ---- mf-workspace ----

export function createWorkspace(name: string): Promise<OpOutcome<CreateWorkspaceResult>> {
  return run<CreateWorkspaceResult>("workspace", "workspace.create", { name }, (uid) =>
    meOnly(uid, (u) => meKeys.memberships(u), (u) => meKeys.workspaces(u)),
  );
}

/**
 * Renames a workspace (Workspace admins). `expectedName` is the name the admin saw: when someone else renamed it in the
 * meantime the server answers a conflict and the lists are refetched, so the form shows the current name.
 */
export async function renameWorkspace(a: { workspaceId: string; name: string; expectedName: string }): Promise<OpOutcome<RenameWorkspaceResult>> {
  const r = await run<RenameWorkspaceResult>(
    "workspace",
    "workspace.rename",
    { workspaceId: a.workspaceId, name: a.name, expectedName: a.expectedName },
    (uid) => meOnly(uid, (u) => meKeys.workspaces(u), (u) => meKeys.admin(u)),
    (uid, data) => { if (uid) applyWorkspaceName(queryClient, uid, data.workspace.id, data.workspace.name); },
  );
  if (!r.ok && r.code === "conflict") {
    const uid = uidNow();
    if (uid) await queryClient.invalidateQueries({ queryKey: meKeys.workspaces(uid) }).catch(() => undefined);
  }
  return r;
}

export function inviteMember(a: { workspaceId: string; email: string; roleKey: string; displayName?: string }): Promise<OpOutcome<InviteResult>> {
  const args: Record<string, unknown> = { workspaceId: a.workspaceId, email: a.email, roleKey: a.roleKey };
  if (a.displayName !== undefined) args.displayName = a.displayName;
  return run<InviteResult>("workspace", "member.invite", args, () => memberKeys(a.workspaceId));
}

export function setMemberRole(a: { workspaceId: string; membershipId: string; roleKey: string }): Promise<OpOutcome<{ membership: unknown }>> {
  return run("workspace", "member.setRole", { workspaceId: a.workspaceId, membershipId: a.membershipId, roleKey: a.roleKey }, () =>
    memberKeys(a.workspaceId),
  );
}

export function removeMember(a: { workspaceId: string; membershipId: string }): Promise<OpOutcome<{ membership: unknown; readerCount: number }>> {
  return run("workspace", "member.remove", { workspaceId: a.workspaceId, membershipId: a.membershipId }, () => memberKeys(a.workspaceId));
}

/** "Leave workspace": member.remove on my own membership. */
export function leaveWorkspace(workspaceId: string): Promise<OpOutcome<{ membership: unknown; readerCount: number }>> {
  const s = useWorkspaces.getState() as unknown as {
    userId?: string | null;
    me?: { workspaceId?: string; membershipId?: string } | null;
    team?: { workspaceId?: string; userId?: string; membershipId?: string }[];
  };
  const mine =
    s.me && s.me.workspaceId === workspaceId && s.me.membershipId
      ? s.me.membershipId
      : s.team?.find((m) => m.workspaceId === workspaceId && m.userId && m.userId === s.userId)?.membershipId;
  if (!mine) return Promise.resolve({ ok: false, error: functionErrorMessage("not_member"), code: "not_member" });
  return run("workspace", "member.remove", { workspaceId, membershipId: mine }, (uid) => [
    ...memberKeys(workspaceId),
    ...meOnly(uid, (u) => meKeys.memberships(u), (u) => meKeys.workspaces(u)),
  ]);
}

export function bootstrapMe(a: { displayName?: string } = {}): Promise<OpOutcome<BootstrapResult>> {
  const args: Record<string, unknown> = {};
  if (a.displayName !== undefined) args.displayName = a.displayName;
  return run<BootstrapResult>("workspace", "me.bootstrap", args);
}

/** The person's own platform access, as every op sees it (me.access: a read, nothing written, no invitation accepted). */
export function readMyAccess(): Promise<OpOutcome<MyAccessResult>> {
  return run<MyAccessResult>("workspace", "me.access", {});
}

export function markNotificationsRead(ids: string[]): Promise<OpOutcome<MarkReadResult>> {
  return run<MarkReadResult>("workspace", "notification.markRead", { ids }, (uid) => meOnly(uid, (u) => meKeys.bell(u)));
}

export function markAllNotificationsRead(): Promise<OpOutcome<MarkAllReadResult>> {
  return run<MarkAllReadResult>("workspace", "notification.markAllRead", {}, (uid) => meOnly(uid, (u) => meKeys.bell(u)));
}

export function restampWorkspace(workspaceId: string): Promise<OpOutcome<RestampResult>> {
  return run<RestampResult>("workspace", "acl.restamp", { workspaceId }, () => [blocksKeys.workspace(workspaceId)]);
}

// ---- mf-admin ----

const platformRoleList = (uid: string | undefined) => meOnly(uid, (u) => meKeys.admin(u, "platformRole.list"));

export function listPlatformRoles(): Promise<OpOutcome<PlatformRoleListResult>> {
  return run<PlatformRoleListResult>("admin", "platformRole.list", {});
}

export function savePlatformRole(a: { key: string; name: string; description: string; permissions: string[] }): Promise<OpOutcome<unknown>> {
  return run("admin", "platformRole.save", { key: a.key, name: a.name, description: a.description, permissions: a.permissions }, platformRoleList);
}

export function deletePlatformRole(key: string): Promise<OpOutcome<unknown>> {
  return run("admin", "platformRole.delete", { key }, platformRoleList);
}

export function assignPlatformRole(a: { userId: string; roleKey: string }): Promise<OpOutcome<AssignResult>> {
  return run<AssignResult>("admin", "platformRole.assign", { userId: a.userId, roleKey: a.roleKey }, platformRoleList);
}

export function unassignPlatformRole(a: { userId: string; roleKey: string }): Promise<OpOutcome<AssignResult>> {
  return run<AssignResult>("admin", "platformRole.unassign", { userId: a.userId, roleKey: a.roleKey }, platformRoleList);
}

const roleKeys = (ws: string) => (uid: string | undefined): QueryKey[] => [
  blocksKeys.schema(ws, "WorkspaceRole"),
  blocksKeys.schema(ws, "Membership"),
  ...meOnly(uid, (u) => meKeys.admin(u, "workspace.inspect")),
];

export function saveWorkspaceRole(a: {
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
}): Promise<OpOutcome<WorkspaceRoleSaveResult>> {
  return run<WorkspaceRoleSaveResult>(
    "admin",
    "workspaceRole.save",
    { workspaceId: a.workspaceId, key: a.key, name: a.name, description: a.description, permissions: a.permissions },
    roleKeys(a.workspaceId),
  );
}

export function deleteWorkspaceRole(a: { workspaceId: string; key: string; reassignTo?: string }): Promise<OpOutcome<WorkspaceRoleDeleteResult>> {
  const args: Record<string, unknown> = { workspaceId: a.workspaceId, key: a.key };
  if (a.reassignTo !== undefined) args.reassignTo = a.reassignTo;
  return run<WorkspaceRoleDeleteResult>("admin", "workspaceRole.delete", args, roleKeys(a.workspaceId));
}

export function getAllowedEmailDomains(): Promise<OpOutcome<AllowedDomainsResult>> {
  return run<AllowedDomainsResult>("admin", "setting.get", { key: "AllowedEmailDomains" });
}

export function saveAllowedEmailDomains(a: { domains: string[]; exceptions: string[] }): Promise<OpOutcome<unknown>> {
  return run("admin", "setting.save", { key: "AllowedEmailDomains", value: { domains: a.domains, exceptions: a.exceptions } }, (uid) =>
    meOnly(uid, (u) => meKeys.admin(u, "setting.get")),
  );
}

export function listAudit(a: AuditListArgs): Promise<OpOutcome<AuditListResult>> {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined) args[k] = v;
  return run<AuditListResult>("admin", "audit.list", args);
}

/** What a person's (de)activation changes: their memberships in every workspace (the active workspace's team, its
 *  pickers) and the admin views (people, organizations, audit). Other workspaces' caches are dropped on a switch. */
const accountKeys = (uid: string | undefined): QueryKey[] => {
  const ws = useWorkspaces.getState().workspaceId;
  return [...meOnly(uid, (u) => meKeys.admin(u), (u) => meKeys.memberships(u)), ...(ws ? memberKeys(ws) : [])];
};

export function deactivateAccount(a: { userId: string; reason?: string }): Promise<OpOutcome<DeactivateResult>> {
  const args: Record<string, unknown> = { userId: a.userId };
  if (a.reason !== undefined) args.reason = a.reason;
  return run<DeactivateResult>("admin", "account.deactivate", args, accountKeys);
}

export function reactivateAccount(userId: string): Promise<OpOutcome<ReactivateResult>> {
  return run<ReactivateResult>("admin", "account.reactivate", { userId }, accountKeys);
}

export function suspendWorkspace(a: { workspaceId: string; suspended: boolean; reason?: string }): Promise<OpOutcome<SuspendResult>> {
  const args: Record<string, unknown> = { workspaceId: a.workspaceId, suspended: a.suspended };
  if (a.reason !== undefined) args.reason = a.reason;
  return run<SuspendResult>("admin", "workspace.suspend", args, (uid) =>
    meOnly(uid, (u) => meKeys.admin(u), (u) => meKeys.workspaces(u)),
  );
}

export function listWorkspaces(page: number): Promise<OpOutcome<WorkspaceListResult>> {
  return run<WorkspaceListResult>("admin", "workspace.list", { page });
}

export function inspectWorkspace(workspaceId: string): Promise<OpOutcome<WorkspaceInspectResult>> {
  return run<WorkspaceInspectResult>("admin", "workspace.inspect", { workspaceId });
}

export function listAccessRequests(page: number): Promise<OpOutcome<AccessRequestListResult>> {
  return run<AccessRequestListResult>("admin", "accessRequest.list", { page });
}

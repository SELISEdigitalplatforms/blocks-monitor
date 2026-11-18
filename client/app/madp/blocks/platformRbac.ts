// Roles & permissions for the Platform management sections: organization role templates, copying a template into an
// organization, and one person's access across the platform. Every check happens in the admin function; these hooks
// only call it and refresh what changed.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callFunction, newRequestId } from "./fn";
import { useSession } from "./session";
import { adminMounted } from "./config";
import { adminErrorMessage } from "./admin";
import { meKeys } from "./workspaces/queries";
import { blocksKeys } from "./data/keys";

export interface RoleTemplate {
  itemId: string | null;
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface PlatformRolesView {
  roles: (RoleTemplate & { isBuiltIn: boolean })[];
  templates: RoleTemplate[];
  assignments: { itemId: string; userId: string; roleKey: string; status: string; email: string; displayName: string }[];
}

export interface PersonAccess {
  userId: string;
  platformRoles: { roleKey: string; assignedAt: string }[];
  memberships: { membershipId: string; workspaceId: string; workspaceName: string; workspaceStatus: string; roleKey: string; status: string }[];
}

const uidNow = () => useSession.getState().profile?.userId ?? "";

/** platformRole.list with the templates (same cache entry as the platform roles tab). */
export function usePlatformRolesView(enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "platformRole.list"),
    queryFn: async () => (await callFunction<PlatformRolesView>("admin", "platformRole.list", {})).data,
    enabled: enabled && adminMounted() && Boolean(uid),
    staleTime: 30_000,
    retry: 0,
    select: (v: PlatformRolesView): PlatformRolesView => ({ roles: v.roles ?? [], templates: v.templates ?? [], assignments: v.assignments ?? [] }),
  });
}

function useAdminWrite<TArgs extends Record<string, unknown>>(op: string, refresh: (args: TArgs) => readonly (readonly unknown[])[]) {
  const client = useQueryClient();
  return useMutation<unknown, Error, TArgs>({
    mutationFn: async (args) => {
      try {
        return (await callFunction("admin", op, args, { requestId: newRequestId() })).data;
      } catch (e) {
        throw new Error(adminErrorMessage(e));
      }
    },
    retry: 0,
    onSuccess: async (_d, args) => {
      for (const queryKey of refresh(args)) await client.invalidateQueries({ queryKey });
    },
  });
}

const listAndAudit = () => [meKeys.admin(uidNow(), "platformRole.list"), meKeys.admin(uidNow(), "audit.list")];

export type TemplateSaveArgs = { key: string; name: string; description: string; permissions: string[] };
/** Create or change an organization role template (platform.roles.manage). */
export const useSaveRoleTemplate = () =>
  useAdminWrite<TemplateSaveArgs & { scope: "organization" }>("platformRole.save", listAndAudit);
/** Delete an organization role template; copies already made in organizations stay. */
export const useDeleteRoleTemplate = () => useAdminWrite<{ key: string }>("platformRole.delete", listAndAudit);

/** Copy a template into one organization as its custom role (roles.manage there, or the platform route). */
export const useApplyRoleTemplate = () =>
  useAdminWrite<{ workspaceId: string; templateKey: string }>("workspaceRole.applyTemplate", (a) => [
    blocksKeys.schema(a.workspaceId, "WorkspaceRole"),
    meKeys.admin(uidNow(), "workspace.inspect"),
    meKeys.admin(uidNow(), "audit.list"),
  ]);

export interface OrganizationRow {
  workspaceId: string;
  name: string;
  status: string;
  memberCount: number;
  admins: { userId: string; email: string; displayName: string }[];
  planKey?: string | null;
}
export interface OrganizationPage { items: OrganizationRow[]; totalCount: number; page: number; pageSize: number }

/** One page of every organization (workspace.list, audited; same cache entry as the workspaces tab). */
export function useOrganizations(page: number, enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "workspace.list", { page }),
    queryFn: async () => (await callFunction<OrganizationPage>("admin", "workspace.list", { page })).data,
    enabled: enabled && adminMounted() && Boolean(uid),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/** One person's platform roles and organization memberships (audited). */
export function usePersonAccess(userId: string | null) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: meKeys.admin(uid ?? "", "people.access", { userId: userId ?? "" }),
    queryFn: async () => (await callFunction<PersonAccess>("admin", "people.access", { userId })).data,
    enabled: adminMounted() && Boolean(uid) && Boolean(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : adminErrorMessage(e);
}

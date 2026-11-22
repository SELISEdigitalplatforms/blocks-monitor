// Query keys and options for the tenancy reads. Cross-workspace "me" reads are keyed ["me", userId, ...], never under ["ws", ...].
import { keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { blocksAllOptions } from "../data/hooks";
import { queryList, queryPage, whereOf, type Page } from "../data/gql";
import {
  MEMBERSHIP_FIELDS, NOTIFICATION_FIELDS, WORKSPACE_FIELDS, WORKSPACE_ROLE_FIELDS,
  type MembershipRow, type NotificationRow, type WorkspaceRoleRow, type WorkspaceRow,
} from "./types";

export const meKeys = {
  root: (uid: string) => ["me", uid] as const,
  memberships: (uid: string) => ["me", uid, "memberships"] as const,
  workspaces: (uid: string) => ["me", uid, "workspaces"] as const,
  bell: (uid: string) => ["me", uid, "bell"] as const,
  bellUnread: (uid: string) => ["me", uid, "bell", "unread"] as const,
  admin: (uid: string, op?: string, args?: unknown) =>
    (op === undefined ? ["me", uid, "admin"] : args === undefined ? ["me", uid, "admin", op] : ["me", uid, "admin", op, args]) as readonly unknown[],
};

export const BELL_PAGE_SIZE = 30;
const MAX_WORKSPACES = 1000;

const wsW = whereOf<WorkspaceRow>();
const memW = whereOf<MembershipRow>();
const noteW = whereOf<NotificationRow>();

/** My active memberships across workspaces. */
export function myMembershipsOptions(uid: string) {
  return {
    queryKey: meKeys.memberships(uid),
    queryFn: (): Promise<MembershipRow[]> =>
      queryList<MembershipRow>("Membership", {
        fields: MEMBERSHIP_FIELDS,
        where: memW.and(memW.eq("UserId", uid), memW.eq("Status", "active")),
        pageSize: 100,
        maxItems: MAX_WORKSPACES,
      }),
    enabled: Boolean(uid),
  };
}

/** The Workspace rows behind my memberships. */
export function myWorkspacesOptions(uid: string, ids: readonly string[]) {
  const sorted = [...new Set(ids)].sort();
  return {
    queryKey: [...meKeys.workspaces(uid), sorted] as const,
    queryFn: (): Promise<WorkspaceRow[]> =>
      queryList<WorkspaceRow>("Workspace", {
        fields: WORKSPACE_FIELDS,
        where: wsW.in("ItemId", sorted),
        pageSize: 100,
        maxItems: MAX_WORKSPACES,
      }),
    enabled: Boolean(uid) && sorted.length > 0,
  };
}

/** Every Workspace (the super admin's row policy allows it). */
export function allWorkspacesOptions(uid: string) {
  return {
    queryKey: [...meKeys.workspaces(uid), "all"] as const,
    queryFn: (): Promise<WorkspaceRow[]> =>
      queryList<WorkspaceRow>("Workspace", { fields: WORKSPACE_FIELDS, pageSize: 100, maxItems: MAX_WORKSPACES }),
    enabled: Boolean(uid),
  };
}

/**
 * Writes a saved workspace name into every cached Workspace list of this person (mine and the super admin's "all"), so
 * the sync observers rebuild the store at once: the switcher and every name on screen change without a reload or refetch.
 */
export function applyWorkspaceName(client: QueryClient, uid: string, workspaceId: string, name: string): void {
  client.setQueriesData<WorkspaceRow[]>({ queryKey: meKeys.workspaces(uid) }, (rows) =>
    Array.isArray(rows) && rows.some((r) => r.ItemId === workspaceId && r.Name !== name)
      ? rows.map((r) => (r.ItemId === workspaceId ? { ...r, Name: name } : r))
      : rows,
  );
}

/** The active workspace's team: active, invited and pending-account rows. Keys sit under ["ws", id, "Membership"]. */
export function teamOptions(workspaceId: string | null) {
  return blocksAllOptions<MembershipRow>("Membership", {
    workspaceId,
    fields: MEMBERSHIP_FIELDS,
    where: memW.in("Status", ["active", "invited", "pending-account"]),
    sort: [{ field: "Email", dir: "asc" }],
    maxItems: 1000,
  });
}

/** The active workspace's custom roles. */
export function rolesOptions(workspaceId: string | null) {
  return blocksAllOptions<WorkspaceRoleRow>("WorkspaceRole", {
    workspaceId,
    fields: WORKSPACE_ROLE_FIELDS,
    sort: [{ field: "Key", dir: "asc" }],
    maxItems: 200,
  });
}

/** My notifications, newest first. */
export function bellListOptions(uid: string, page = 1) {
  return {
    queryKey: [...meKeys.bell(uid), "list", { page, pageSize: BELL_PAGE_SIZE }] as const,
    queryFn: (): Promise<Page<NotificationRow>> =>
      queryPage<NotificationRow>("Notification", {
        fields: NOTIFICATION_FIELDS,
        where: noteW.eq("RecipientUserId", uid),
        sort: [{ field: "CreatedDate", dir: "desc" }],
        page,
        pageSize: BELL_PAGE_SIZE,
      }),
    enabled: Boolean(uid),
    placeholderData: keepPreviousData,
  };
}

/** The unread count: a pageSize-1 query whose totalCount is the answer. */
export function bellUnreadOptions(uid: string) {
  return {
    queryKey: meKeys.bellUnread(uid),
    queryFn: (): Promise<Page<NotificationRow>> =>
      queryPage<NotificationRow>("Notification", {
        fields: ["IsRead"],
        where: noteW.and(noteW.eq("RecipientUserId", uid), noteW.eq("IsRead", false)),
        page: 1,
        pageSize: 1,
      }),
    enabled: Boolean(uid),
  };
}

/** The bell in one fetch: the newest page and the unread count, both reads in the same tick (one /api/data request). */
export function bellOptions(uid: string) {
  return {
    queryKey: [...meKeys.bell(uid), "page", { page: 1, pageSize: BELL_PAGE_SIZE }] as const,
    queryFn: async (): Promise<{ items: NotificationRow[]; unreadCount: number }> => {
      const [list, unread] = await Promise.all([bellListOptions(uid, 1).queryFn(), bellUnreadOptions(uid).queryFn()]);
      return { items: list.items, unreadCount: unread.totalCount };
    },
    enabled: Boolean(uid),
    placeholderData: keepPreviousData,
  };
}

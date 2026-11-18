// The notification bell: my Notification rows (newest first), polled, with the unread count from totalCount.
// A notification of a project being deleted is not shown (the purge removes it with the project's other rows).
import { useQuery } from "@tanstack/react-query";
import { isSafeInternalLink } from "@/madp/domain/notifications";
import { isDeletingProject } from "@/madp/domain/projects";
import { byNewest } from "@/madp/lib/newest";
import { useBlocksContext } from "../context";
import { projectListOptions } from "../projects/reads";
import { useDoorbellState } from "../realtime/state";
import { queryClient } from "../queryClient";
import { useSession } from "../session";
import { markAllNotificationsRead, markNotificationsRead } from "./ops";
import { bellOptions, meKeys } from "./queries";
import { notificationText, parseNotificationParams } from "./notificationText";
import type { OpOutcome } from "./types";

export const BELL_PAGE_SIZE = 30;
export const BELL_REFETCH_MS = 60_000;
/** While the doorbell is live the poll is only a safety net for missed rings. */
export const BELL_REFETCH_LIVE_MS = 300_000;

export type BellItem = {
  id: string;
  kind: string;
  params: Record<string, string>;
  text: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  workspaceId: string | null;
  /** The project the notification is about, if any. */
  projectId: string | null;
};

interface NotificationRow {
  ItemId?: string;
  ProjectId?: string;
  Kind?: string;
  ParamsJson?: string;
  Link?: string;
  IsRead?: boolean;
  CreatedDate?: string;
  WorkspaceId?: string;
}

const BELL_ERROR = "Notifications couldn't be loaded. They will refresh in a moment.";

export function bellItemOf(row: NotificationRow): BellItem {
  const params = parseNotificationParams(row.ParamsJson);
  const kind = row.Kind ?? "";
  const link = typeof row.Link === "string" && isSafeInternalLink(row.Link) ? row.Link : null;
  return {
    id: row.ItemId ?? "",
    kind,
    params,
    text: notificationText(kind, params),
    link,
    read: row.IsRead === true,
    createdAt: row.CreatedDate ?? "",
    workspaceId: row.WorkspaceId ? row.WorkspaceId : null,
    projectId: row.ProjectId ? row.ProjectId : null,
  };
}

/** The bell without the notifications of projects being deleted; the unread number leaves out the unread ones hidden,
 *  so the badge and the list always agree. */
export function liveBell(items: readonly BellItem[], unreadTotal: number | null, deletingProjectIds: ReadonlySet<string>): { items: BellItem[]; unreadCount: number } {
  const shown = items.filter((i) => !(i.projectId && deletingProjectIds.has(i.projectId)));
  const hiddenUnread = items.filter((i) => !i.read).length - shown.filter((i) => !i.read).length;
  const unreadCount = typeof unreadTotal === "number" ? Math.max(0, unreadTotal - hiddenUnread) : shown.filter((i) => !i.read).length;
  return { items: shown, unreadCount };
}

const NONE: ReadonlySet<string> = new Set();
const deletingIdsOf = (rows: readonly Record<string, unknown>[]): ReadonlySet<string> => {
  const ids = rows.filter((r) => isDeletingProject(r)).map((r) => String(r.ItemId ?? ""));
  return ids.length ? new Set(ids) : NONE;
};

/** The active workspace's projects being deleted (the shared project list read; a pending local delete included). */
function useDeletingProjectIds(): ReadonlySet<string> {
  const { workspaceId } = useBlocksContext();
  const q = useQuery({ ...projectListOptions(workspaceId), select: deletingIdsOf });
  return q.data ?? NONE;
}

export function useBell(): { items: BellItem[]; unreadCount: number; isLoading: boolean; error: string | null } {
  const { status, profile } = useSession();
  const uid = profile?.userId ?? "";
  const enabled = status === "signed-in" && uid !== "";
  const live = useDoorbellState() === "live";
  const q = useQuery({
    ...bellOptions(uid),
    enabled,
    refetchInterval: live ? BELL_REFETCH_LIVE_MS : BELL_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
  const deleting = useDeletingProjectIds();
  const rows = ((q.data as { items?: NotificationRow[] } | undefined)?.items ?? []) as NotificationRow[];
  const total = (q.data as { unreadCount?: number } | undefined)?.unreadCount;
  // newest first, as read (CreatedDate descending), whatever order the cached page holds; then without projects being deleted
  const newest = byNewest(rows.map(bellItemOf).filter((i) => i.id !== ""), (i) => i.createdAt);
  const { items, unreadCount } = liveBell(newest, typeof total === "number" ? total : null, deleting);
  return {
    items,
    unreadCount,
    isLoading: enabled && q.isLoading,
    error: q.error ? BELL_ERROR : null,
  };
}

/** Refresh the bell now (the L10 doorbell calls this). */
export async function invalidateBell(): Promise<void> {
  const uid = useSession.getState().profile?.userId;
  if (!uid) return;
  await queryClient.invalidateQueries({ queryKey: meKeys.bell(uid) });
}

export async function markBellRead(id: string): Promise<OpOutcome<unknown>> {
  const out = await markNotificationsRead([id]);
  await invalidateBell();
  return out;
}

/** Calls of notification.markAllRead per "Mark all as read" (each marks up to 500 rows). */
export const MARK_ALL_MAX_CALLS = 10;

/** "Mark all as read": the op marks one page of unread rows per call, so it is called again while rows remain (at most
 *  MARK_ALL_MAX_CALLS times); the bell is read again once at the end. */
export async function markAllBellRead(
  mark: () => Promise<OpOutcome<unknown>> = markAllNotificationsRead,
  refresh: () => Promise<void> = invalidateBell,
): Promise<OpOutcome<{ remaining: number }>> {
  let remaining = 0;
  try {
    for (let i = 0; i < MARK_ALL_MAX_CALLS; i++) {
      const out = await mark();
      if (!out.ok) return out;
      const left = (out.value as { remaining?: number } | undefined)?.remaining;
      remaining = typeof left === "number" && left > 0 ? left : 0;
      if (remaining === 0) break;
    }
  } finally {
    await refresh();
  }
  return { ok: true, value: { remaining } };
}

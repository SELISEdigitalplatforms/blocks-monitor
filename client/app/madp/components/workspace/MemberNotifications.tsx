/** The signed-in member's notifications (assigned, shared, invited and more), inside the bell's panel. */
import { useState } from "react";
import {
  BadgeCheck,
  Bell,
  Briefcase,
  CircleAlert,
  FileText,
  KeyRound,
  ListChecks,
  Rocket,
  Share2,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { markAllBellRead, markBellRead, useBell } from "@/madp/blocks/workspaces/bell";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { rebootstrap, switchWorkspace } from "@/madp/blocks/workspaces/sync";
import { isSafeInternalLink, type NotificationKind } from "@/madp/domain/notifications";
import { whenLabel } from "@/madp/state/workspaces";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

const ITEM = "flex w-full items-start gap-3 rounded-block px-3 py-2.5 text-left text-[14px] text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:bg-surface2 focus-visible:text-ink";

export const NOTIFICATION_ICONS: Record<NotificationKind, LucideIcon> = {
  invited: UserPlus,
  "access-requested": KeyRound,
  assigned: UserCheck,
  shared: Share2,
  "business.handed-over": Briefcase,
  "requirements.ready": ListChecks,
  "scope.ready": FileText,
  "build.started": Workflow,
  "job.succeeded": BadgeCheck,
  "job.failed": CircleAlert,
  "preview.ready": Rocket,
  "approval.requested": ShieldCheck,
  "approval.decided": BadgeCheck,
  "release.created": Rocket,
  "release.promoted": Rocket,
  "change.released": Rocket,
};

/** The icon of a notification kind; an unknown kind gets the bell. */
export function notificationIconFor(kind: string): LucideIcon {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_ICONS, kind) ? NOTIFICATION_ICONS[kind as NotificationKind] : Bell;
}

export function MemberNotificationList({ onOpen }: { onOpen: (link: string) => void }) {
  const t = useT();
  const { items, unreadCount, error: loadError } = useBell();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const [error, setError] = useState("");
  if (!items.length && !loadError) return null;
  const markAll = async () => {
    setError("");
    const r = await markAllBellRead();
    if (r && !r.ok) setError(r.error);
  };
  const open = async (n: (typeof items)[number]) => {
    setError("");
    const r = await markBellRead(n.id);
    if (r && !r.ok) setError(r.error);
    const target = typeof n.params?.workspaceId === "string" ? n.params.workspaceId : "";
    if (n.kind === "invited" && !n.read && target && !workspaces.some((w) => w.id === target)) {
      const b = await rebootstrap();
      if (!b.ok) setError(b.error);
      else {
        const s = await switchWorkspace(target);
        if (!s.ok) setError(s.error);
      }
    }
    if (n.link && isSafeInternalLink(n.link)) onOpen(n.link);
  };
  const shown = error || (loadError ? String((loadError as { message?: unknown }).message ?? loadError) : "");
  return (
    <div>
      {shown && <p role="alert" className="px-3 pb-2 text-[13px] text-[rgb(var(--c-danger-text))]">{shown}</p>}
      <div className="flex justify-end px-3 pb-2 pt-1">
        {unreadCount > 0 && (
          <button type="button" onClick={() => void markAll()} className="rounded-full text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40">
            {t("shell.notifications.markAllRead", "Mark all as read")}
          </button>
        )}
      </div>
      <ul>
        {items.map((n) => {
          const Icon = notificationIconFor(n.kind);
          return (
            <li key={n.id}>
              <button type="button" onClick={() => void open(n)} className={ITEM}>
                <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", n.read ? "bg-surface2 text-ink2" : "bg-accent-soft text-accent")}>
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[14px]", n.read ? "text-ink2" : "font-medium text-ink")}>{n.text}</span>
                  <span className="block text-[12px] text-ink3">{whenLabel(n.createdAt)}</span>
                </span>
                {!n.read && <span className="sr-only">{t("shell.notifications.unreadSuffix", ", unread")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

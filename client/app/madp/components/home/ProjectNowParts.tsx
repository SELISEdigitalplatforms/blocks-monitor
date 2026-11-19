/** Where a project stands and what waits for you, shown the same way on Home, the Dashboard and Projects. The looks are
 *  the step frame's (StepFrame.tsx): "working" = the accent pill with the spinner, "waiting for you" = the attention chip
 *  (dashed amber), "with the team" = the quiet clock. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CircleCheck, Clock, Inbox, LoaderCircle, PauseCircle, CircleSlash } from "lucide-react";
import { useBlocksContext } from "@/madp/blocks/context";
import { useDashboardData } from "@/madp/blocks/dashboard/hooks";
import { projectsNow, waitingCount, waitingForYou, type NowTeam, type ProjectNow, type WaitingItem } from "@/madp/domain/projectNow";
import { latestActivity } from "@/madp/domain/dashboard";
import { Card } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { rewritePath } from "@/madp/lib/pathPrefix";
import { useT } from "@/madp/i18n";

/** The workspace's active members, as the change request page reads them (useDeliveryContext): who may approve a
 *  change when no policy names approvers. */
export function useNowTeam(): NowTeam {
  const members = useBlocksContext().members;
  return useMemo(() => ({ activeMemberIds: members.filter((m) => m.status === "active" && m.id).map((m) => m.id) }), [members]);
}

/** Every project's plain status and the list of what waits for the signed-in person (one read wave, shared cache). */
export function useProjectsNow() {
  const ctx = useBlocksContext();
  const data = useDashboardData();
  const team = useNowTeam();
  const me = ctx.userId ?? "";
  const permissions = ctx.permissions;
  const now = useMemo(() => projectsNow(data.records, me, permissions, team), [data.records, me, permissions, team]);
  const waiting = useMemo(() => waitingForYou(now), [now]);
  // each project's latest activity: the project lists put the newest on top by it (projectsByActivity)
  const activity = useMemo(() => latestActivity(data.records), [data.records]);
  return { now, waiting, isLoading: data.isLoading, error: data.error, records: data.records, activity };
}

/** "Business analyst is working on it" (spinner), "With the development team" (clock), "Paused at …", "Released". */
export function WorkingLine({ now, className }: { now: ProjectNow; className?: string }) {
  const icon = now.stopped ? <CircleSlash size={14} aria-hidden />
    : now.paused ? <PauseCircle size={14} aria-hidden />
    : now.working ? <LoaderCircle size={14} aria-hidden className="animate-spin text-[rgb(var(--c-accent-text))] motion-reduce:animate-none" />
    : now.step === "release" ? <CircleCheck size={14} aria-hidden className="text-[rgb(var(--c-success-text))]" />
    : <Clock size={14} aria-hidden />;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink2", now.working && "text-ink", className)}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{now.workingText}</span>
    </span>
  );
}

/** One thing waiting for you, as the step frame's attention chip; it opens the place where you act. */
export function WaitingChip({ item, className }: { item: WaitingItem; className?: string }) {
  return (
    <Link to={item.to} title={`${item.project}: ${item.text}`}
      className={cn("inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-dashed border-warning/60 bg-warning-soft/50 px-3 py-1 text-[13px] text-ink transition hover:bg-warning-soft",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent/60", className)}>
      <AlertCircle size={15} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />
      <span className="min-w-0 truncate">{item.text}</span>
    </Link>
  );
}

/** The waiting chips of one project: the first one, then "+2 more" (all of them in the tooltip). */
export function WaitingChips({ now, className }: { now: ProjectNow; className?: string }) {
  const t = useT();
  const [first, ...rest] = now.waiting;
  if (!first) return <span className={cn("text-[12px] text-ink3", className)}>{t("shell.home.nothingForYou", "Nothing for you right now")}</span>;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <WaitingChip item={first} />
      {rest.length > 0 && (
        <span className="text-[12px] text-ink2" title={rest.map((r) => r.text).join(" · ")}>{t("shell.home.plusMore", "+{count} more", { count: rest.length })}</span>
      )}
    </span>
  );
}

/** Home and Dashboard: what is waiting for you, one row per thing, each with its one button. */
export function WaitingForYouCard({ items, isLoading, className, bodyClassName, max = 6, emptyText }: {
  items: readonly WaitingItem[]; isLoading?: boolean; className?: string; bodyClassName?: string; max?: number; emptyText?: string;
}) {
  // the number counts things to do, as the Team panel does ("2 questions" are 2), the same as the Dashboard's tile
  const t = useT();
  const count = waitingCount(items);
  return (
    <Card title={t("shell.home.waitingForYou", "Waiting for you")} icon={<Inbox size={18} strokeWidth={1.75} />} className={className} bodyClassName={bodyClassName}
      action={items.length > 0 ? <span className="num rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-medium text-[rgb(var(--c-warning-text))]" title={count === 1 ? t("shell.home.waitingCountOne", "1 thing waiting for you") : t("shell.home.waitingCountMany", "{count} things waiting for you", { count })}>{count}</span> : undefined}>
      {isLoading ? (
        <div role="status" aria-label={t("shell.home.loadingWaiting", "Loading what is waiting for you")} className="space-y-2">
          <div aria-hidden className="h-12 animate-pulse rounded-block bg-surface2 motion-reduce:animate-none" />
          <div aria-hidden className="h-12 animate-pulse rounded-block bg-surface2 motion-reduce:animate-none" />
        </div>
      ) : items.length === 0 ? (
        // in the middle of the card when the card is taller than its line (the Dashboard's row of equal cards)
        <p className="m-auto flex max-w-[18rem] flex-col items-center gap-2 text-center text-[14px] text-ink2">
          <CircleCheck size={16} aria-hidden className="shrink-0 text-[rgb(var(--c-success-text))]" />
          {emptyText ?? t("shell.home.waitingEmpty", "Nothing is waiting for you. Your team lets you know when it needs you.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, max).map((it) => (
            <li key={it.id}>
              <Link to={it.to}
                className="group flex min-w-0 items-center gap-3 rounded-block border border-dashed border-warning/50 bg-warning-soft/30 px-3.5 py-2.5 transition hover:bg-warning-soft/60 outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <AlertCircle size={16} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug text-ink [overflow-wrap:anywhere]">{it.text}</span>
                  <span className="block truncate text-[12px] text-ink3">{it.project}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[rgb(var(--c-accent-text))]">
                  {it.action}<ArrowRight size={14} aria-hidden className="transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
          {items.length > max && (
            <li className="pt-1 text-[13px] text-ink2">{t("shell.home.andMoreOn", "and {count} more on", { count: items.length - max })} <Link to={rewritePath("/projects")} className="font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("shell.nav.projects", "Projects")}</Link></li>
          )}
        </ul>
      )}
    </Card>
  );
}

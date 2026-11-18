/** A project's quick actions on a grid card's footer: Docs, Tests, Watch the build — the ones that fit where it stands
 *  (projectCards.ts quickActions). Small links of one size and icon style; "Watch the build" is accented, with a live
 *  dot, while a build runs. Their clicks never reach the card under them. (The list view has them in the ⋯ menu.) */
import { Link } from "react-router-dom";
import { FileText, FlaskConical, MonitorPlay } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import type { QuickAction, QuickActionId } from "./projectCards";
import { useT } from "@/madp/i18n";

/** One icon per quick action, the same on the card and in the ⋯ menu. */
export const QUICK_ICON: Record<QuickActionId, typeof FileText> = { docs: FileText, tests: FlaskConical, watch: MonitorPlay };
const ICON = QUICK_ICON;

const LINK = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50";

export function QuickActions({ actions, project, className }: { actions: readonly QuickAction[]; project: string; className?: string }) {
  const t = useT();
  if (actions.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)} onClick={(e) => e.stopPropagation()}>
      {actions.map((a) => {
        const Icon = ICON[a.id];
        return (
          <Link key={a.id} to={a.to} title={a.title} aria-label={`${a.label} · ${project}${a.highlight ? ` · ${t("shell.projects.quick.buildRunning", "build running")}` : ""}`}
            data-quick-action={a.id}
            className={cn(LINK, a.highlight
              ? "bg-accent-soft text-[rgb(var(--c-accent-text))] ring-1 ring-inset ring-accent/30 hover:bg-accent hover:text-white"
              : "bg-surface2 text-ink2 hover:bg-line hover:text-ink")}>
            {a.highlight
              ? <span aria-hidden className="relative grid h-3.5 w-3.5 place-items-center"><span className="h-2 w-2 animate-pulse-dot rounded-full bg-current motion-reduce:animate-none" /></span>
              : <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />}
            {a.label}
          </Link>
        );
      })}
    </span>
  );
}

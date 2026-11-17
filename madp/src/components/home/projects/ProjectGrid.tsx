/** The Projects page as a grid of cards: one card per project with its type, where it stands in the four steps (step
 *  n of 4 and a slim bar), who is working on it, what waits for you, its newest release, when it changed, the quick
 *  actions and the ⋯ menu. The whole card opens the project where it stands: its name is the link, stretched over
 *  the card; the menu, the quick actions and the waiting line sit above it and keep their own clicks. */
import { Link } from "react-router-dom";
import { AlertCircle, Rocket } from "lucide-react";
import type { ProjectRecord } from "@/blocks/projects";
import { Bar, Chip } from "@/ui/kit";
import { TypeChip } from "@/components/project/TypeChip";
import { cn } from "@/lib/cn";
import { projectActivityAt } from "@/domain/dashboard";
import { WorkingLine } from "../ProjectNowParts";
import { journeyAt, quickActions, relativeTime, versionText } from "./projectCards";
import { ProjectActionsMenu, type ProjectActions } from "./ProjectActionsMenu";
import { QuickActions } from "./QuickActions";
import { useT } from "@/i18n";
import { phaseNameOf } from "@/components/project/stepNames";

/** 1 column on a phone, 2 on a tablet, 3 on a desktop, 4 on a very wide screen. */
const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

const where = (p: ProjectRecord) => [p.clientName, p.clientRegion].filter(Boolean).join(" · ");

export function ProjectGrid({ items, ...act }: ProjectActions & { items: ProjectRecord[] }) {
  const t = useT();
  return (
    <ul className={GRID} aria-label={t("shell.dashboard.yourProjects", "Your projects")}>
      {items.map((p) => <li key={p.id} className="min-w-0"><ProjectCard project={p} {...act} /></li>)}
    </ul>
  );
}

export function ProjectCard({ project, ...act }: ProjectActions & { project: ProjectRecord }) {
  const t = useT();
  const isDeleting = project.status === "deleting";
  const now = act.now?.get(project.id);
  const at = journeyAt(project.step);
  const release = act.releases?.get(project.id);
  const building = act.building?.has(project.id) ?? false;
  const [first, ...more] = now?.waiting ?? [];
  // the time the list is sorted by: the project's last activity
  const updated = relativeTime(projectActivityAt(project, act.activity));
  const warm = isDeleting ? undefined : () => act.onWarm?.(project);
  return (
    <article onPointerEnter={warm} onFocus={warm} aria-busy={isDeleting || undefined}
      className={cn("group relative flex h-full min-w-0 flex-col rounded-card bg-surface p-5 shadow-card transition dark:ring-1 dark:ring-line",
        isDeleting ? "opacity-70" : "hover:shadow-float hover:ring-1 hover:ring-accent/30")}>
      <div className="flex min-h-8 items-center gap-2">
        {isDeleting ? <Chip tone="warning">{t("shell.projects.deleting", "Deleting…")}</Chip> : <TypeChip type={project.type} />}
        {updated && <span className="ml-auto whitespace-nowrap text-[12px] text-ink3" title={t("shell.projects.lastActivityAt", "Last activity {when}", { when: updated })}><span className="sr-only">{t("shell.projects.lastActivityPrefix", "Last activity")} </span>{updated}</span>}
        <ProjectActionsMenu project={project} {...act} className={cn("relative z-10 -mr-1.5", !updated && "ml-auto")} />
      </div>

      <h3 className="mt-3 break-words text-[17px] font-medium leading-snug tracking-tight">
        {isDeleting ? project.name : (
          <Link to={`/p/${project.id}`}
            className="rounded-md outline-none transition-colors after:absolute after:inset-0 after:rounded-card group-hover:text-[rgb(var(--c-accent-text))] focus-visible:after:ring-2 focus-visible:after:ring-accent/50">
            {project.name}
          </Link>
        )}
      </h3>
      {where(project) && <p className="mt-0.5 truncate text-[13px] text-ink3">{where(project)}</p>}

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-medium text-ink">{phaseNameOf(now?.step ?? project.step)}</span>
          <span className="num shrink-0 text-[12px] text-ink3">{t("shell.projects.stepOf", "Step {step} of {total}", { step: at.n, total: at.total })}</span>
        </div>
        {/* one of the four steps: the bar fills a quarter per step */}
        <Bar value={at.pct} hatchRest={false} className="mt-2 h-1" />
        {!isDeleting && now && <WorkingLine now={now} className="mt-2 flex" />}
      </div>

      {!isDeleting && first && (
        <Link to={first.to} title={[first, ...more].map((w) => w.text).join(" · ")}
          className="relative z-10 mt-4 flex min-w-0 items-center gap-2 rounded-block border border-dashed border-warning/60 bg-warning-soft/50 px-3 py-2 text-[13px] text-ink outline-none transition hover:bg-warning-soft focus-visible:ring-2 focus-visible:ring-accent/60">
          <AlertCircle size={15} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />
          <span className="line-clamp-2 min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{first.text}</span>
          {more.length > 0 && <span className="num shrink-0 text-[12px] text-ink2">{t("shell.home.plusMore", "+{count} more", { count: more.length })}</span>}
        </Link>
      )}

      {release && (
        <div className="mt-3">
          <Chip tone="success" icon={<Rocket size={12} strokeWidth={1.75} aria-hidden />} title={t("shell.projects.releasedAt", "Released {when}", { when: relativeTime(release.releasedAt) })}>
            {t("shell.projects.versionOn", "{version} on {env}", { version: versionText(release.version), env: release.envLabel })}
          </Chip>
        </div>
      )}

      {!isDeleting && (
        <div className="mt-auto pt-4">
          <QuickActions actions={quickActions(project, building)} project={project.name} className="relative z-10 border-t border-line pt-3" />
        </div>
      )}
    </article>
  );
}

/** The grid while the projects load: cards of the same shape, pulsing. */
export function ProjectGridSkeleton({ count = 6 }: { count?: number }) {
  const t = useT();
  return (
    <div role="status" aria-label={t("shell.projects.loading", "Loading your projects")} className={GRID}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="flex h-[232px] flex-col rounded-card bg-surface p-5 shadow-card dark:ring-1 dark:ring-line">
          <div className="h-6 w-28 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
          <div className="mt-4 h-5 w-3/4 animate-pulse rounded-md bg-surface2 motion-reduce:animate-none" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded-md bg-surface2 motion-reduce:animate-none" />
          <div className="mt-5 h-1 w-full animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
          <div className="mt-auto flex gap-1.5 border-t border-line pt-3">
            <div className="h-7 w-16 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
            <div className="h-7 w-16 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

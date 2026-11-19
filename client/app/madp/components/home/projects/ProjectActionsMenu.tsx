/** A project's ⋯ menu on the Projects page (grid card and list row): Open, Wiki, Rename, Delete. Rename and Delete open
 *  the page's own dialogs and need the same rights as before (project.edit, project.delete). In the list view the quick
 *  actions (Docs, Tests, Watch the build) come first, then a divider (owner 08.11.2026: no buttons on the list rows). */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Ellipsis, PenLine, Trash2 } from "lucide-react";
import { useProjectsContext, type ProjectRecord } from "@/madp/blocks/projects";
import { can } from "@/madp/domain/rbac";
import type { ProjectNow } from "@/madp/domain/projectNow";
import { IconButton, MENU_ITEM, MENU_PANEL } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { cn } from "@/madp/lib/cn";
import { prefixPath } from "@/madp/lib/pathPrefix";
import type { LatestRelease, QuickAction } from "./projectCards";
import { QUICK_ICON } from "./QuickActions";
import { useT } from "@/madp/i18n";

export function useCanDo(action: "project.create" | "project.edit" | "project.delete"): boolean {
  const ctx = useProjectsContext();
  return ctx.isSuperAdmin || can(ctx.permissions, action);
}

/** What a project row or card can do, and what the page knows about each project. */
export interface ProjectActions {
  onOpen: (p: ProjectRecord) => void;
  /** Pointer or focus on a project: warm its step (optional). */
  onWarm?: (p: ProjectRecord) => void;
  onRename: (p: ProjectRecord) => void;
  onDelete: (p: ProjectRecord) => void;
  /** Where each project stands (step · who is working · what waits for you), by project id. */
  now?: Map<string, ProjectNow>;
  /** The projects with a build running (their "Watch the build" is highlighted). */
  building?: Set<string>;
  /** Each project's newest release. */
  releases?: Map<string, LatestRelease>;
  /** Each project's latest activity (latestActivity): the list is sorted by it and shows it as the last activity. */
  activity?: ReadonlyMap<string, number>;
}

const PANEL = `w-60 ${MENU_PANEL}`;
const ITEM = `${MENU_ITEM} items-center`;

/** The menu: the quick actions when given (projectCards.ts quickActions, "running" beside Watch the build while a build
 *  runs) and a divider, then Open, Wiki, Rename, Delete (none for a project being deleted). Closes on a click outside,
 *  Escape and Tab; the arrow keys move through it. Its clicks never reach the row or card under it. */
export function ProjectActionsMenu({ project, onOpen, onRename, onDelete, quick = [], className }: ProjectActions & {
  project: ProjectRecord; quick?: readonly QuickAction[]; className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const canEdit = useCanDo("project.edit");
  const canDelete = useCanDo("project.delete");
  const isDeleting = project.status === "deleting";
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The popover is placed in its own layout effect (it runs first), so the first item can take focus right here.
  useLayoutEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { const t = e.target as Node; if (box.current && !box.current.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [open]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  const pick = (fn: (p: ProjectRecord) => void) => () => { setOpen(false); fn(project); };
  if (isDeleting) return null; // the server finishes the delete on its own
  return (
    // the popover is portalled, but React still bubbles its clicks through here: they stop before the row or card
    <div ref={box} className={cn("relative", className)} onClick={(e) => e.stopPropagation()}>
      <IconButton ref={trigger} label={t("shell.projects.actionsFor", "Actions for {name}", { name: project.name })} icon={<Ellipsis size={18} strokeWidth={1.75} />}
        aria-haspopup="menu" aria-expanded={open} className="h-8 w-8" onClick={() => setOpen(!open)} />
      {open && (
        <Popover anchorRef={trigger} panelRef={menu} placement="bottom-end" onClose={() => setOpen(false)} role="menu" aria-label={t("shell.projects.actionsFor", "Actions for {name}", { name: project.name })} onKeyDown={onKeyDown} className={PANEL}>
          {quick.map((a) => {
            const Icon = QUICK_ICON[a.id];
            return (
              <button key={a.id} type="button" role="menuitem" title={a.title} data-quick-action={a.id} onClick={pick(() => navigate(a.to))} className={ITEM}>
                <Icon size={16} strokeWidth={1.75} aria-hidden /> <span className="whitespace-nowrap">{a.label}</span>
                {a.highlight && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[rgb(var(--c-accent-text))]">
                    <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current motion-reduce:animate-none" />{t("shell.projects.quick.running", "running")}
                  </span>
                )}
              </button>
            );
          })}
          {quick.length > 0 && <div role="separator" className="mx-2 my-1.5 h-px bg-line" />}
          <button type="button" role="menuitem" onClick={pick(onOpen)} className={ITEM}><ArrowRight size={16} strokeWidth={1.75} /> {t("common.actions.open", "Open")}</button>
          <button type="button" role="menuitem" onClick={pick((p) => navigate(prefixPath(`/p/${p.id}/wiki`)))} className={ITEM}><BookOpen size={16} strokeWidth={1.75} /> {t("shell.nav.wiki", "Wiki")}</button>
          {canEdit && <button type="button" role="menuitem" onClick={pick(onRename)} className={ITEM}><PenLine size={16} strokeWidth={1.75} /> {t("shell.projects.rename", "Rename")}</button>}
          {canDelete && (
            <button type="button" role="menuitem" onClick={pick(onDelete)} className={cn(ITEM, "text-danger hover:text-danger focus-visible:text-danger")}>
              <Trash2 size={16} strokeWidth={1.75} /> {t("common.actions.delete", "Delete")}
            </button>
          )}
        </Popover>
      )}
    </div>
  );
}

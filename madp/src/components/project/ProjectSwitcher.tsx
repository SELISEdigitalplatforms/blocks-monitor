/** The top bar's first control. On a project page (/p/:id/*) it is the PROJECT SWITCHER: the project's name with the
 *  workspace's name small under it. Its menu finds a project of the workspace (the open one pinned first and checked),
 *  each with its type, the step it stands at ("Business Analysis · Step 2 of 4") and a dot when something waits for you
 *  there (projectNow), then "All projects" and "Switch workspace" (the account menu's own workspace list, folded).
 *  Picking another project opens it where it stands (/p/:id, as the Projects page does); when something is unfinished
 *  here, LeaveProjectDialog asks first. Everywhere else it is the workspace switcher. */
import { t, useT } from "@/i18n";
import { phaseName } from "@/components/project/stepNames";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, FolderKanban, LayoutGrid, Search } from "lucide-react";
import { useProjectList, type ProjectRecord } from "@/blocks/projects";
import { useRouteProject } from "@/blocks/projects/reads";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { PHASE_COUNT, phaseNumber, phaseOf } from "@/domain/phases";
import { projectsByActivity } from "@/domain/dashboard";
import { initialsOf } from "@/state/workspaces";
import { cn } from "@/lib/cn";
import { MENU_ITEM, MENU_PANEL } from "@/ui/kit";
import { FOCUS_ITEMS, Popover } from "@/ui/popover";
import { useProjectsNow } from "@/components/home/ProjectNowParts";
import { AccountWorkspacesFold, CreateWorkspaceDialog, WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { TypeChip } from "./TypeChip";
import { LeaveGuardHost } from "./LeaveGuardHost";
import { confirmLeave, useLeaveGuardWarm } from "./leaveGuardStore";

const ITEM = `${MENU_ITEM} items-center`;
/** Rows drawn at most; a longer list is narrowed with the search field. */
export const SHOWN_MAX = 50;

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The switcher's list (pure): the workspace's active projects whose name or client holds every word of the query
 *  (case and accents ignored), the open one pinned first, the rest in the list's own order (as on Projects). */
export function switcherProjects<T extends Pick<ProjectRecord, "id" | "name" | "clientName" | "status">>(projects: readonly T[], currentId: string, query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hit = (p: T) => !words.length || words.every((w) => fold(`${p.name} ${p.clientName}`).includes(w));
  const active = projects.filter((p) => p.status === "active" && hit(p));
  const current = active.find((p) => p.id === currentId);
  return current ? [current, ...active.filter((p) => p !== current)] : active;
}

/** "Business Analysis · Step 2 of 4" */
export function stepLine(step: ProjectRecord["step"]): string {
  return `${phaseName(phaseOf(step))} · ${t("project.nav.stepOf", "Step {at} of {total}", { at: phaseNumber(step), total: PHASE_COUNT })}`;
}

/** The project switcher on a project page; the workspace switcher everywhere else. */
export function TopBarSwitcher() {
  const route = useRouteProject();
  if (route.id && route.isBlocks) return <ProjectSwitcher projectId={route.id} name={route.project?.name ?? (route.isLoading ? null : "")} />;
  return <WorkspaceSwitcher />;
}

function ProjectSwitcher({ projectId, name }: { projectId: string; name: string | null }) {
  const t = useT();
  const workspace = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.workspaceId) ?? null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLeaveGuardWarm(open);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { const t = e.target as Node; if (box.current && !box.current.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [open]);

  /** Another project: ask first when something is unfinished here, then open it where it stands. */
  const choose = async (id: string) => {
    if (id === projectId) { close(true); return; }
    const go = await confirmLeave(() => close(true));
    if (go) navigate(`/p/${id}`);
  };

  const loading = name === null;
  const label = name || t("project.switcher.project", "Project");
  const where = workspace?.name ?? "";
  return (
    <div className="shrink-0 sm:relative" ref={box}>
      <button ref={trigger} type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-busy={loading || undefined}
        aria-label={loading ? t("project.switcher.loadingAria", "Project: loading. Switch project") : where ? t("project.switcher.triggerAriaIn", "Project: {name}, in {workspace}. Switch project", { name: label, workspace: where }) : t("project.switcher.triggerAria", "Project: {name}. Switch project", { name: label })}
        className="flex h-12 shrink-0 items-center gap-3 rounded-full bg-surface p-[5px] text-left transition hover:bg-line md:pr-4 dark:ring-1 dark:ring-line">
        <span aria-hidden="true" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]"><FolderKanban size={18} /></span>
        <span className="hidden min-w-0 leading-tight md:block md:max-w-[120px] lg:max-w-[160px] xl:max-w-[220px]">
          {loading
            ? <span aria-hidden="true" className="block h-3 w-24 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
            : <span title={label} className="block truncate text-[14px] font-medium text-ink">{label}</span>}
          {where && <span title={where} className="mt-0.5 block truncate text-[12px] text-ink3">{where}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="hidden shrink-0 text-ink3 md:block" />
      </button>
      {open && (
        <Popover anchorRef={trigger} panelRef={menu} mobileSheet onClose={() => setOpen(false)} role="menu" aria-label={t("project.switcher.switchProject", "Switch project")}
          className={cn(MENU_PANEL, "scroll-thin sm:w-[23rem]")}>
          <SwitcherMenu currentId={projectId} workspaceName={where} menu={menu} onChoose={(id) => void choose(id)} close={close}
            onCreate={() => { setOpen(false); setCreating(true); }} />
        </Popover>
      )}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} returnFocus={trigger} />
      <LeaveGuardHost projectId={projectId} projectName={name ?? ""} />
    </div>
  );
}

/** The menu's body, mounted while it is open (its reads start with it: the project list is the top bar's search's, the
 *  "waiting for you" dots the Dashboard's). Keys: Up / Down move through the search field and the rows, Home / End
 *  jump (outside the field), Enter in the field opens the first match, Escape first empties the field, Tab leaves. */
function SwitcherMenu({ currentId, workspaceName, menu, onChoose, close, onCreate }: {
  currentId: string; workspaceName: string; menu: RefObject<HTMLDivElement>;
  onChoose: (id: string) => void; close: (refocus: boolean) => void; onCreate: () => void;
}) {
  const t = useT();
  const list = useProjectList();
  const { now, activity } = useProjectsNow();
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const groupId = useId();
  // the open one pinned first, the rest newest first (by latest activity, as on Projects)
  const all = useMemo(() => switcherProjects(projectsByActivity(list.data ?? [], activity), currentId, query), [list.data, activity, currentId, query]);
  const shown = all.slice(0, SHOWN_MAX);
  // the search field takes focus as the menu opens (the panel is fixed, so nothing scrolls while the Popover places it)
  useLayoutEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const root = menu.current;
    if (!root) return;
    if (e.key === "Tab") { close(false); return; }
    const items = [...root.querySelectorAll<HTMLElement>(`[data-menu-field],${FOCUS_ITEMS}`)].filter((el) => el.getClientRects().length > 0);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const inField = at >= 0 && items[at]!.hasAttribute("data-menu-field");
    let to = -1;
    if (e.key === "ArrowDown") to = (at + 1) % items.length;
    else if (e.key === "ArrowUp") to = at <= 0 ? items.length - 1 : at - 1;
    else if (!inField && e.key === "Home") to = 0;
    else if (!inField && e.key === "End") to = items.length - 1;
    if (to < 0 || !items.length) return;
    e.preventDefault();
    items[to]?.focus();
  };
  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
    else if (e.key === "Enter" && query.trim() && shown[0]) { e.preventDefault(); onChoose(shown[0].id); }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-2">
        <span id={groupId} className="min-w-0 truncate text-[12px] font-medium uppercase tracking-wider text-ink3">
          {workspaceName ? t("project.switcher.projectsIn", "Projects in {workspace}", { workspace: workspaceName }) : t("project.switcher.projects", "Projects")}
        </span>
        {all.length > 1 && <span className="num shrink-0 text-[12px] text-ink3">{all.length}</span>}
      </div>
      <label className="mx-1 mb-1.5 flex h-9 items-center gap-2 rounded-full bg-surface2 px-3 text-ink3 ring-1 ring-inset ring-line transition focus-within:ring-2 focus-within:ring-accent/40">
        <Search size={14} aria-hidden="true" className="shrink-0" />
        <input ref={field} data-menu-field="" type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onFieldKey}
          aria-label={t("project.switcher.findAria", "Find a project")} placeholder={t("project.switcher.findPlaceholder", "Find a project…")} autoComplete="off" spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3" />
      </label>
      {/* a long list scrolls on its own, so the links below stay in reach */}
      <div role="group" aria-labelledby={groupId} className="scroll-thin max-h-[min(360px,45dvh)] space-y-0.5 overflow-y-auto overscroll-contain">
        {shown.map((p) => {
          const current = p.id === currentId;
          const waiting = now.get(p.id)?.waiting ?? [];
          return (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={current} onClick={() => onChoose(p.id)}
              className={cn(ITEM, "py-2", current && "bg-surface2 text-ink")}>
              <span aria-hidden="true" className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[12px] font-semibold tracking-wide",
                current ? "bg-accent text-white" : "bg-surface2 text-ink2 ring-1 ring-inset ring-line")}>
                {initialsOf(p.name || t("project.switcher.untitled", "Untitled project"))}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("truncate", current && "font-medium")}>{p.name || t("project.switcher.untitled", "Untitled project")}</span>
                  {waiting.length > 0 && (
                    <span title={waiting.map((w) => w.text).join(" · ")} className="grid h-4 w-4 shrink-0 place-items-center">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
                      <span className="sr-only">{`, ${t("project.switcher.waitingForYou", "waiting for you")}`}</span>
                    </span>
                  )}
                </span>
                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="num truncate text-[12px] text-ink3">{stepLine(p.step)}</span>
                  <TypeChip type={p.type} className="px-2 py-0.5 text-[11px]" />
                </span>
              </span>
              {current ? <Check size={16} aria-hidden="true" className="shrink-0 text-accent" /> : <span aria-hidden="true" className="w-4 shrink-0" />}
            </button>
          );
        })}
        {list.isPending && (
          <div role="status" className="flex items-center gap-3 px-3 py-2">
            <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-pulse rounded-[10px] bg-surface2 motion-reduce:animate-none" />
            <span aria-hidden="true" className="h-3 w-32 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
            <span className="sr-only">{t("project.switcher.loading", "Loading projects…")}</span>
          </div>
        )}
        {list.isError && !shown.length && <p role="status" className="px-3 py-2 text-[13px] text-ink2">{t("project.switcher.loadFailed", "The projects could not be loaded just now. Try again in a moment.")}</p>}
        {!list.isPending && !list.isError && !shown.length && (
          <p role="status" className="px-3 py-2 text-[13px] text-ink3">{query.trim() ? t("project.switcher.noMatch", "No project matches “{query}”", { query: query.trim() }) : t("project.switcher.none", "No projects yet")}</p>
        )}
        {all.length > shown.length && <p className="px-3 py-2 text-[12px] text-ink3">{t("project.switcher.showingOf", "Showing {shown} of {all}. Type to narrow the list.", { shown: shown.length, all: all.length })}</p>}
      </div>
      <div className="mt-1 border-t border-line pt-1">
        <Link to="/projects" role="menuitem" className={ITEM} onClick={() => close(false)}><LayoutGrid size={16} aria-hidden="true" /> {t("project.switcher.allProjects", "All projects")}</Link>
        <AccountWorkspacesFold close={close} onCreate={onCreate} />
      </div>
    </div>
  );
}

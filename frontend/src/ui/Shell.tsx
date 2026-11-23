/** The one shell every screen lives in: left icon rail (V_DTOR) + top bar (Sphere UI) + content.
 *  Below md the rail folds into a menu button in the top bar. */
import { Component, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { create } from "zustand";
import {
  Bell, BookOpen, Building2, Check, ChevronDown, CircleAlert, Download, FolderKanban, Hammer, LayoutDashboard, KeyRound, LogOut, LucideProvider,
  Menu, Moon, MonitorX, Plus, Search, Settings, ShieldCheck, Sun,
} from "lucide-react";
import { PRODUCT } from "@/data/facts";
import { useRouteProject } from "@/blocks/projects/reads";
import { exportWorkspaceToFile } from "@/blocks/export";
import { useProjectList } from "@/blocks/projects";
import { pageFromSlug, type JourneyStep } from "@/domain/journey";
import { phaseOfPage, stepPath } from "@/domain/phases";
import { phaseName, stepName } from "@/components/project/stepNames";
import { useDemo, usePersona } from "@/state/store";
import { usePlatformAccess } from "@/blocks/admin";
import { adminMounted } from "@/blocks/config";
import { guardRedirect, hasPlatformAccess, signInRedirect } from "@/blocks/guard";
import { accountRoleLine } from "@/components/roles/permissionText";
import { setNotice, signOut, signOutEverywhere, useSession } from "@/blocks/session";
import { NoWorkspace } from "@/components/workspace/NoWorkspace";
import { cn } from "@/lib/cn";
import { MemberNotificationList } from "@/components/workspace/MemberNotifications";
import { AccountWorkspaces, AccountWorkspacesFold, CreateWorkspaceDialog } from "@/components/workspace/WorkspaceSwitcher";
import { TopBarSwitcher } from "@/components/project/ProjectSwitcher";
import { useLeaveGuardWarm } from "@/components/project/leaveGuardStore";
import { useCan, useCurrentWorkspace, useMe, useWorkspaces } from "@/state/workspaces";
import { useBell } from "@/blocks/workspaces/bell";
import { useDoorbell } from "@/blocks/realtime/doorbell";
import { useBellArrivals } from "@/blocks/realtime/refresh";
import { AssistantLauncher, applyScrollPaddingBottom, floatingReservePx } from "@/components/assistant/AssistantLauncher";
import { FOCUS_ITEMS, Popover, pageThroughItems } from "./popover";
import { RefreshingHint } from "./RefreshingHint";
import { SlowSavingHint } from "./SlowSavingHint";
import { ToastHost } from "./Toast";
import { Avatar, Banner, Button, Chip, EmptyState, IconButton, MENU_ITEM, MENU_PANEL } from "./kit";
import { openGuidedStart } from "@/components/guided/store";
import { CreditMenuLine } from "@/components/billing/CreditMenuLine";
import { CreditPill } from "@/components/billing/CreditPill";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { t, useCulture, useT } from "@/i18n";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
// analysis is the Business Analysis page; understanding, sanitization, requirements and scope only redirect to its sections
const PROJECT_PAGE = /^\/p\/[^/]+\/(business|brief|analysis|understanding|sanitization|requirements|objective|scope|board|build|delivered|produced|wiki)$/;

/** A paused project stands where it will resume. */

/** The rail. Every project page lights its section: Software Engineering (the build) under Build, the other steps, what
 *  MADP produced and the live app under Projects, the wiki under Wiki. */
export const NAV = [
  { to: "/dashboard", label: "Dashboard", text: () => t("shell.nav.dashboard", "Dashboard"), icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  // New is the empty form only: a project that already exists lights Projects on every step before the build
  { to: "/new", label: "New", text: () => t("shell.nav.new", "New"), icon: Plus, match: (p: string) => p === "/new" },
  { to: "/projects", label: "Projects", text: () => t("shell.nav.projects", "Projects"), icon: FolderKanban, match: (p: string) => p === "/projects" || /^\/p\/[^/]+(\/(business|analysis|understanding|sanitization|brief|requirements|objective|scope|delivered|produced))?$/.test(p) },
  { to: "/projects", label: "Build", text: () => t("shell.nav.build", "Build"), icon: Hammer, match: (p: string) => /^\/p\/[^/]+\/(build|board)$/.test(p) },
  { to: "/wiki", label: "Wiki", text: () => t("shell.nav.wiki", "Wiki"), icon: BookOpen, match: (p: string) => p === "/wiki" || /^\/p\/[^/]+\/wiki$/.test(p) },
];

/** Where the rail's Build goes: the route's project, else the most recently updated one, else the project list. */
export function buildTarget(routeProjectId: string | null | undefined, latestProjectId: string | null | undefined): string {
  const id = routeProjectId || latestProjectId;
  return id ? `/p/${id}/build` : "/projects";
}

/** The Build step opens once the scope is locked (stage board, build or release); before that the project's build page
 *  only sends the user back through "lock the scope first", so the rail does not offer it. */
export function canOpenBuild(step: JourneyStep | null | undefined): boolean {
  return step === "board" || step === "build" || step === "release";
}

/** The rail's New opens the guided project start over the page (a plain click; a new tab still opens the /new form). */
function startGuided(e: ReactMouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openGuidedStart();
}

/** The nav items with their state on this page. New is always open: the workspace holds many projects. Build opens the
 *  active project's build (or the first project's). */
function useNav() {
  const { pathname } = useLocation();
  const route = useRouteProject().project;
  const routeId = route && canOpenBuild(route.step) ? route.id : null;
  // the list is read most recently updated first
  const latestId = useProjectList().data?.find((r) => r.status === "active" && canOpenBuild(r.step))?.id;
  const access = usePlatformAccess();
  // the Admin entry only where the admin function is mounted (not on the Blocks host yet)
  const admin = adminMounted() && hasPlatformAccess(access);
  const items = NAV.map((n) => ({ ...n, to: n.label === "Build" ? buildTarget(routeId, latestId) : n.to, active: n.match(pathname) }));
  return admin ? [...items, { to: "/admin", label: "Platform", text: () => t("shell.nav.platform", "Platform"), icon: ShieldCheck, active: /^\/admin(\/|$)/.test(pathname) }] : items;
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-[14px] bg-accent text-white">
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20V9l5 3V9l5 3V6l8 4v10z" />
        <path d="M7 20v-3M12 20v-3M17 20v-3" />
      </svg>
    </span>
  );
}

function ThemeIcon({ theme }: { theme: "light" | "dark" }) {
  return theme === "light" ? <Moon size={18} /> : <Sun size={18} />;
}

function Rail() {
  const t = useT();
  const theme = useDemo((s) => s.theme);
  const toggleTheme = useDemo((s) => s.toggleTheme);
  const items = useNav();
  return (
    // pt-6: the logo's centre lines up with the top bar's controls
    <aside className="sticky top-0 hidden h-screen w-[84px] shrink-0 flex-col items-center gap-1 pb-5 pt-6 md:flex">
      <Link to="/dashboard" aria-label={t("shell.nav.home", "MADP Factory home")} className="mb-5"><Logo /></Link>
      <nav aria-label={t("shell.nav.main", "Main")} className="flex flex-col gap-1">
        {items.map(({ to, label, text, icon: Icon, active }) => {
          const cls = "flex w-[68px] flex-col items-center gap-1 rounded-block py-2.5 text-[11px] font-medium transition";
          return (
            <Link key={label} to={to} aria-current={active ? "page" : undefined} onClick={label === "New" ? startGuided : undefined}
              className={cn(cls, active ? "bg-surface text-ink shadow-card dark:ring-1 dark:ring-line" : "text-ink3 hover:text-ink")}>
              <Icon size={20} strokeWidth={1.75} className={active ? "text-accent" : ""} />
              {text()}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <IconButton label={theme === "light" ? t("shell.theme.dark", "Dark mode") : t("shell.theme.light", "Light mode")} onClick={toggleTheme} icon={<ThemeIcon theme={theme} />} />
      </div>
    </aside>
  );
}

/** A popover under a top-bar button: it closes on a click outside, on Escape (focus goes back to the button) and when
 *  the page changes. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** a menu rendered in a portal (not inside box): a click in it is a click inside */
  const panel = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { const t = e.target as Node; if (box.current && !box.current.contains(t) && !panel.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [open]);
  return { open, setOpen, box, trigger, panel };
}

/** The top bar's own panels hang from the sticky bar (pt-5 + h-12 + mt-2 = 76 px down), so the page scrolling never
 *  brings their end into view: a long one is held to the screen and scrolls on its own, the page behind staying put. */
const PANEL = `absolute z-40 mt-2 max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain scroll-thin ${MENU_PANEL}`;
/** On a phone the search results and the notifications span the top bar, under its controls (pt-5 + h-12): the bar is
 *  their box there, so they stay readable and on screen. */
const SHEET = "max-sm:inset-x-0 max-sm:top-[68px]";
const ITEM = `${MENU_ITEM} items-center`;

/** A focusable row of a menu: the column it sits in (-1 in a menu without columns) and whether it is the checked radio. */
export type MenuSpot = { column: number; checked?: boolean };

const MENU_MOVES = ["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"];

/** Where a key moves focus in a menu, as an index into its rows, or -1 when it does not move it. Up / Down step (wrapping)
 *  and Home / End jump within the focused row's column; Left / Right go to the column beside it: to the row last focused
 *  there, else its checked row, else its first. With nothing focused, the keys work over the whole menu. */
export function menuKeyTarget(key: string, spots: readonly MenuSpot[], at: number, lastIn: ReadonlyMap<number, number> = new Map()): number {
  if (!spots.length) return -1;
  const column = at >= 0 && at < spots.length ? spots[at].column : null;
  const inColumn = (c: number) => spots.flatMap((s, i) => (s.column === c ? [i] : []));
  const rows = column === null ? spots.map((_, i) => i) : inColumn(column);
  const j = rows.indexOf(at);
  switch (key) {
    case "ArrowDown": return rows[(j + 1) % rows.length];
    case "ArrowUp": return rows[j < 0 ? rows.length - 1 : (j - 1 + rows.length) % rows.length];
    case "Home": return rows[0];
    case "End": return rows[rows.length - 1];
    case "ArrowLeft":
    case "ArrowRight": {
      if (column === null || column < 0) return -1;
      const columns = [...new Set(spots.map((s) => s.column))].filter((c) => c >= 0).sort((a, b) => a - b);
      const next = columns[columns.indexOf(column) + (key === "ArrowRight" ? 1 : -1)];
      if (next === undefined) return -1;
      const there = inColumn(next);
      const last = lastIn.get(next);
      if (last !== undefined && there.includes(last)) return last;
      return there.find((i) => spots[i].checked) ?? there[0];
    }
    default: return -1;
  }
}

/** A menu's keyboard: focus starts on the first item; the arrow keys move through the items (plain and radio rows),
 *  within a column when the menu has columns ([data-menu-column]) and across them with Left / Right; Tab leaves and
 *  closes it. A text field in the menu ([data-menu-field]) is a stop for Up / Down; in it the other keys edit the text. */
function useMenuKeys(open: boolean, close: () => void, panel?: RefObject<HTMLDivElement>) {
  const own = useRef<HTMLDivElement>(null);
  const menu = panel ?? own;
  /** the row last focused in each column, so Left / Right come back to it */
  const last = useRef(new Map<number, HTMLElement>());
  // a Popover is placed in its own layout effect (it runs first), so the first item can take focus right here
  useLayoutEffect(() => { if (open) menu.current?.querySelector<HTMLElement>(FOCUS_ITEMS)?.focus(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const root = menu.current;
    if (!root) return;
    if (e.key === "Tab") { close(); return; }
    const items = [...root.querySelectorAll<HTMLElement>(`${FOCUS_ITEMS},[data-menu-field]`)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const columnOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-menu-column]");
    const inField = at >= 0 && items[at].hasAttribute("data-menu-field");
    if (inField && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (MENU_MOVES.includes(e.key)) {
      const columns = [...root.querySelectorAll<HTMLElement>("[data-menu-column]")];
      const spots = items.map((el) => { const c = columnOf(el); return { column: c ? columns.indexOf(c) : -1, checked: el.getAttribute("aria-checked") === "true" }; });
      const lastIn = new Map([...last.current].map(([c, el]) => [c, items.indexOf(el)] as const));
      const to = menuKeyTarget(e.key, spots, at, lastIn);
      if (to < 0) return;
      e.preventDefault();
      if (at >= 0) last.current.set(spots[at].column, items[at]);
      items[to]?.focus();
      return;
    }
    // PageDown / PageUp page through the focused row's column
    pageThroughItems(e, (at >= 0 && columnOf(items[at])) || root);
  };
  return { menu, onKeyDown };
}

/** The rail as a menu, below md (the theme toggle comes with it). */
function MobileNav() {
  const t = useT();
  const { open, setOpen, box, trigger } = usePopover();
  const { menu, onKeyDown } = useMenuKeys(open, () => setOpen(false));
  const theme = useDemo((s) => s.theme);
  const toggleTheme = useDemo((s) => s.toggleTheme);
  const items = useNav();
  return (
    <div className="relative md:hidden" ref={box}>
      <IconButton ref={trigger} label={t("shell.nav.menu", "Menu")} icon={<Menu size={18} />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="h-12 w-12" />
      {open && (
        <div ref={menu} role="menu" aria-label={t("shell.nav.main", "Main")} onKeyDown={onKeyDown} className={cn(PANEL, "left-0 w-64")}>
          {items.map(({ to, label, text, icon: Icon, active }) => (
            <Link key={label} to={to} role="menuitem" aria-current={active ? "page" : undefined} className={cn(ITEM, active && "font-medium text-ink")}
              onClick={label === "New" ? (e) => { setOpen(false); startGuided(e); } : undefined}>
              <Icon size={18} className={active ? "text-accent" : ""} />{text()}
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={toggleTheme} className={ITEM}>
            <ThemeIcon theme={theme} /> {theme === "light" ? t("shell.theme.dark", "Dark mode") : t("shell.theme.light", "Light mode")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Whether a media query matches, kept current as the window changes. */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Search the workspace: its active projects and their organisations, read from SELISE Blocks. Every hit opens the
 *  project where it stands. Ctrl+K (⌘K on a Mac) jumps here from anywhere. */
function WorkspaceSearch() {
  const t = useT();
  const navigate = useNavigate();
  const projects = useProjectList();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const phone = useMedia("(max-width: 639px)");

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const term = q.trim().toLowerCase();
  const all = (projects.data ?? []).filter((r) => r.status === "active").flatMap((r) => {
    const project = r.name || t("shell.search.untitledProject", "Untitled project");
    const to = stepPath(r.id, r.step);
    return [
      { id: `${r.id}-project`, to, label: project, meta: t("shell.search.project", "Project"), terms: project, icon: <FolderKanban size={16} /> },
      r.clientName ? { id: `${r.id}-org`, to, label: r.clientName, meta: [t("shell.search.organisation", "Organisation"), r.clientRegion, project].filter(Boolean).join(" · "), terms: [r.clientName, r.clientRegion].join(" "), icon: <Building2 size={16} /> } : null,
    ];
  });
  const hits = term ? all.filter((h): h is NonNullable<typeof h> => Boolean(h && h.terms.toLowerCase().includes(term))).slice(0, 8) : [];
  const open = focused && term.length > 0;
  const at = Math.min(active, Math.max(0, hits.length - 1));
  // a short screen scrolls the results: the arrow keys' row stays in view
  useEffect(() => { if (open) document.getElementById(`${listId}-${at}`)?.scrollIntoView?.({ block: "nearest" }); }, [open, at, listId]);

  const choose = (hit = hits[at]) => {
    if (!hit) return;
    setQ("");
    input.current?.blur();
    navigate(hit.to);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { setQ(""); }
  };

  return (
    // it fills what the controls after it in TopBar leave, so the bar's gap is the only space before the credit pill
    <div className="min-w-0 flex-[1_1_0%] sm:relative">
      <label className="flex h-12 items-center gap-3 rounded-full bg-surface px-4 text-ink3 transition focus-within:ring-2 focus-within:ring-accent/40 sm:px-5 dark:ring-1 dark:ring-line">
        <Search size={18} className="shrink-0" />
        <input ref={input} value={q} role="combobox" aria-label={t("shell.search.label", "Search the workspace")} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && hits.length ? `${listId}-${at}` : undefined}
          onChange={(e) => { setQ(e.target.value); setActive(0); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKeyDown}
          placeholder={phone ? t("shell.search.placeholderShort", "Search…") : t("shell.search.placeholder", "Search projects and clients…")}
          className="min-w-0 flex-1 text-ellipsis bg-transparent text-[14px] text-ink outline-none placeholder:text-ink3" />
        <kbd className="hidden shrink-0 rounded-md bg-surface2 px-2 py-0.5 font-sans text-[11px] text-ink3 md:block">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </label>
      {open && (
        // mousedown would blur the field before the click lands
        <div onMouseDown={(e) => e.preventDefault()} className={cn(PANEL, SHEET, "sm:inset-x-0 sm:top-full")}>
          <div id={listId} role="listbox" aria-label={t("shell.search.results", "Search results")}>
            {hits.map((h, i) => (
              <div key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === at} onMouseEnter={() => setActive(i)} onClick={() => choose(h)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-block px-3 py-2.5", i === at && "bg-surface2")}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface2 text-ink2">{h.icon}</span>
                <span className="min-w-0">
                  {/* a long file name wraps to a second line rather than losing its end */}
                  <span className="line-clamp-2 text-[14px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{h.label}</span>
                  <span className="block truncate text-[12px] text-ink3">{h.meta}</span>
                </span>
              </div>
            ))}
          </div>
          {projects.isPending && <p role="status" className="px-3 py-3 text-[14px] text-ink2">{t("shell.search.searching", "Searching…")}</p>}
          {projects.isError && !hits.length && <p role="status" className="px-3 py-3 text-[14px] text-ink2">{t("shell.search.unavailable", "Search is unavailable right now. Try again in a moment.")}</p>}
          {!projects.isPending && !projects.isError && !hits.length && <p role="status" className="px-3 py-3 text-[14px] text-ink2">{t("shell.search.noMatches", "No matching projects or clients")}</p>}
        </div>
      )}
    </div>
  );
}

/** The bell panel body: Notification rows only. */
export function NotificationsPanel({ bell, onOpen }: { bell: ReturnType<typeof useBell>; onOpen: (link: string) => void }) {
  const t = useT();
  const empty = bell.items.length === 0;
  return (
    <>
      <div className="px-3 pb-2 pt-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("shell.notifications.title", "Notifications")}</div>
      <MemberNotificationList onOpen={onOpen} />
      {bell.isLoading && empty && (
        <div className="flex items-start gap-3 px-3 py-2">
          <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface2" />
          <span aria-hidden="true" className="min-w-0 flex-1 space-y-2 pt-1">
            <span className="block h-3 w-3/4 animate-pulse rounded-full bg-surface2" />
            <span className="block h-3 w-1/2 animate-pulse rounded-full bg-surface2" />
          </span>
          <span className="sr-only">{t("shell.notifications.loading", "Loading notifications")}</span>
        </div>
      )}
      {!bell.isLoading && empty && !bell.error && (
        <EmptyState title={t("shell.notifications.emptyTitle", "Nothing new")} text={t("shell.notifications.emptyText", "When your team needs you or finishes something, you hear it here.")} />
      )}
    </>
  );
}

/** Older builds kept a "seen" stamp for the browser-made notes; the bell reads real rows now. */
export function forgetLegacyNotificationStamp(): void {
  try { localStorage.removeItem("madp-notifications-seen"); } catch { /* storage blocked: nothing to forget */ }
}

function Notifications() {
  const t = useT();
  const { open, setOpen, box, trigger } = usePopover();
  const navigate = useNavigate();
  const bell = useBell();
  useDoorbell();
  useBellArrivals();
  useEffect(() => { forgetLegacyNotificationStamp(); }, []);
  const unread = bell.unreadCount;
  return (
    <div className="sm:relative" ref={box}>
      <IconButton ref={trigger} label={unread > 0 ? t("shell.notifications.unread", "Notifications, {count} unread", { count: unread }) : t("shell.notifications.title", "Notifications")} badge={unread > 0} icon={<Bell size={18} />}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} className="h-12 w-12" />
      {open && (
        <div role="dialog" aria-label={t("shell.notifications.title", "Notifications")} className={cn(PANEL, SHEET, "sm:right-0 sm:w-[416px] sm:max-w-[calc(100vw-32px)]")}>
          <NotificationsPanel bell={bell} onOpen={(link) => { setOpen(false); navigate(link); }} />
        </div>
      )}
    </div>
  );
}

/** The banner for a browser that cannot keep its display preferences. */
export function StorageFailedBanner() {
  const t = useT();
  return <Banner tone="warning" className="mb-6" title={t("shell.storageFailed", "This browser is not saving your display preferences.")} />;
}

export type ExportStatus = { kind: "idle" } | { kind: "running"; done: number; total: number } | { kind: "done" } | { kind: "failed"; message: string };

export function exportStatusText(s: ExportStatus): string {
  switch (s.kind) {
    case "running": return t("shell.export.running", "Exporting… {done} of {total} record types", { done: s.done, total: s.total });
    case "done": return t("shell.export.done", "Workspace exported");
    case "failed": return s.message.endsWith("Try again.") ? s.message : t("shell.export.failed", "{message} Try again.", { message: s.message });
    default: return t("shell.export.idle", "Export workspace");
  }
}

/** The export's state lives outside the menu: closing the account menu neither stops a running export nor loses its
 *  progress (the file still downloads), and opening the menu again shows where it is. */
export const useWorkspaceExport = create<{ status: ExportStatus }>(() => ({ status: { kind: "idle" } }));

/** Starts the export of a workspace unless one is running; its progress and answer go to useWorkspaceExport. */
export function startWorkspaceExport(workspace: { id: string; name: string }, run: typeof exportWorkspaceToFile = exportWorkspaceToFile): Promise<void> {
  if (useWorkspaceExport.getState().status.kind === "running") return Promise.resolve();
  const set = (status: ExportStatus) => useWorkspaceExport.setState({ status });
  set({ kind: "running", done: 0, total: 0 });
  return run({
    workspaceId: workspace.id, workspaceName: workspace.name,
    onProgress: (p: { done: number; total: number }) => set({ kind: "running", done: p.done, total: p.total }),
  }).then(
    (r) => set(r.ok ? { kind: "done" } : r.aborted ? { kind: "idle" } : { kind: "failed", message: r.message }),
    () => set({ kind: "failed", message: t("shell.export.couldNotExport", "The workspace could not be exported.") }),
  );
}

/** The account menu's "Export workspace": the server op (owner permission) pages the records into one JSON file. */
export function ExportWorkspaceItem() {
  useT();
  const canManage = useCan("workspace.manage");
  const workspace = useCurrentWorkspace();
  const status = useWorkspaceExport((s) => s.status);
  useEffect(() => {
    if (status.kind !== "done") return;
    const t = window.setTimeout(() => useWorkspaceExport.setState({ status: { kind: "idle" } }), 2000);
    return () => window.clearTimeout(t);
  }, [status.kind]);
  if (!canManage || !workspace) return null;
  const running = status.kind === "running";
  const run = () => { if (!running) void startWorkspaceExport(workspace); };
  return (
    <button type="button" role="menuitem" className={ITEM} disabled={running} onClick={run}>
      {status.kind === "done" ? <Check size={16} className="text-success" /> : status.kind === "failed" ? <CircleAlert size={16} className="text-danger" /> : <Download size={16} />}
      <span role="status">{exportStatusText(status)}</span>
    </button>
  );
}

/** The account menu's theme item: it names the theme it switches to (the only switch reachable at 390 px). */
export function themeMenuItem(theme: "light" | "dark") {
  return theme === "dark" ? { label: t("shell.theme.light", "Light mode"), Icon: Sun } : { label: t("shell.theme.dark", "Dark mode"), Icon: Moon };
}

/** The account button's second line: the person's role (Super admin, else their role in the open workspace; the
 *  workspace's own name is in the switcher at the top left); a placeholder while the workspaces load; nothing without a
 *  workspace. */
export function AccountRoleLine({ role, loading }: { role: string | null; loading: boolean }) {
  const t = useT();
  // ink2 on the hover fill keeps the line at AA
  if (role) return <span title={role} className="block truncate text-[12px] text-ink3 group-hover:text-ink2">{role}</span>;
  if (!loading) return null;
  return <><span aria-hidden="true" className="mt-1 block h-3 w-24 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" /><span className="sr-only">{t("shell.account.loadingRole", "Loading your role")}</span></>;
}

/** The account menu's head: who is signed in, their e-mail, and their role (Super admin, else the workspace role) as a
 *  small chip beside the name (under it when the name is long). */
export function AccountHeader({ name, initials, email, role }: { name: string; initials: string; email: string | null; role: string | null }) {
  return (
    <div className="flex items-center gap-3 px-3 pb-3 pt-2.5">
      <Avatar initials={initials} size={40} tone="accent" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full truncate text-[14px] font-medium text-ink">{name}</span>
          {role && <Chip className="px-2 py-0.5 text-[11px]">{role}</Chip>}
        </div>
        {email && <div className="mt-1 truncate text-[12px] text-ink3">{email}</div>}
      </div>
    </div>
  );
}

/** The person's button at the top right (avatar, name, their role) and its menu. From sm it has two columns: who
 *  they are and their account's items on the left, their workspaces to switch between on the right (as tall as the left
 *  column, its list scrolling inside). On a phone it is one column, the workspaces folded into a "Switch workspace" row. */
export function AccountMenu() {
  const t = useT();
  const persona = usePersona();
  const theme = useDemo((s) => s.theme);
  const toggleTheme = useDemo((s) => s.toggleTheme);
  const themeItem = themeMenuItem(theme);
  const me = useMe();
  const workspace = useCurrentWorkspace();
  const ready = useWorkspaces((s) => s.ready);
  const customRoles = useWorkspaces((s) => s.customRoles);
  const isSuperAdmin = useSession((s) => s.profile?.isSuperAdmin ?? false);
  const platformAccess = usePlatformAccess();
  const platformAdmin = adminMounted() && hasPlatformAccess(platformAccess);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const phone = useMedia("(max-width: 639px)");
  const navigate = useNavigate();
  const { open, setOpen, box, trigger, panel } = usePopover();
  const { menu, onKeyDown } = useMenuKeys(open, () => setOpen(false), panel);
  // switching workspace from a project page leaves the project: the guard reads what is open there meanwhile
  useLeaveGuardWarm(open);
  if (!persona) return null;
  // the role my permissions in the open workspace come from: my own row there (me), else my membership in the list
  const roleKey = workspace ? (me?.workspaceId === workspace.id ? me.roleKey : workspace.roleKey) : null;
  const roleLine = accountRoleLine({ isSuperAdmin, ready, roleKey, customRoles });
  const roleLoading = !ready && !roleLine;
  const signOutAll = async () => {
    setSigningOutAll(true);
    const r = await signOutEverywhere();
    if (!r.ok) setNotice(t("shell.account.signOutAllFailed", "Signed out on this device. Your other sessions could not be ended: {error}", { error: r.error }));
    navigate("/sign-in", { replace: true });
  };
  const closeMenu = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const startCreate = () => { setOpen(false); setCreating(true); };
  const header = <AccountHeader name={persona.name} initials={persona.initials} email={persona.email || null} role={roleLine} />;
  const accountItems = (
    <>
      {/* from sm the credit pill in the top bar says it; on a phone the pill is hidden and the menu keeps the line */}
      {phone && <CreditMenuLine className={ITEM} onSelect={() => setOpen(false)} />}
      <Link to="/settings" role="menuitem" className={ITEM} onClick={() => setOpen(false)}><Settings size={16} /> {t("shell.account.settings", "Settings")}</Link>
      {platformAdmin && <Link to="/admin" role="menuitem" className={ITEM} onClick={() => setOpen(false)}><ShieldCheck size={16} /> {t("shell.account.platformManagement", "Platform management")}</Link>}
      <Link to="/settings#security" role="menuitem" className={ITEM} onClick={() => setOpen(false)}><KeyRound size={16} /> {t("shell.account.changePassword", "Change password")}</Link>
      <ExportWorkspaceItem />
      <div className="my-1 h-px bg-line" />
      <button type="button" role="menuitem" onClick={toggleTheme} className={ITEM}><themeItem.Icon size={16} strokeWidth={1.75} aria-hidden="true" /> {themeItem.label}</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); void signOut().finally(() => navigate("/sign-in", { replace: true })); }} className={ITEM}><LogOut size={16} /> {t("common.actions.signOut", "Sign out")}</button>
      <button type="button" role="menuitem" disabled={signingOutAll} onClick={() => void signOutAll()} className={ITEM}><MonitorX size={16} /> {t("shell.account.signOutEverywhere", "Sign out everywhere")}</button>
    </>
  );

  return (
    <div className="relative" ref={box}>
      <button ref={trigger} type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-busy={roleLoading || undefined}
        aria-label={[persona.name, roleLine, t("shell.account.menuLabel", "account menu")].filter(Boolean).join(", ")}
        className="group flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-full bg-surface p-[5px] text-left transition hover:bg-line lg:pr-4 dark:ring-1 dark:ring-line">
        <Avatar initials={persona.initials} size={38} tone="accent" />
        {/* the name from lg: below it the search keeps the room for its full placeholder */}
        <span className="hidden min-w-0 max-w-[11rem] leading-tight lg:block">
          <span className="block truncate text-[14px] font-medium">{persona.name}</span>
          <AccountRoleLine role={roleLine} loading={roleLoading} />
        </span>
        <ChevronDown size={16} className="hidden shrink-0 text-ink3 lg:block" />
      </button>
      {open && (
        <Popover anchorRef={trigger} panelRef={menu} placement="bottom-end" mobileSheet onClose={() => setOpen(false)} role="menu" aria-label={t("shell.account.title", "Account")} onKeyDown={onKeyDown}
          className={cn(MENU_PANEL, "scroll-thin", phone ? "w-80" : "w-[600px] max-w-[calc(100vw-16px)]")}>
          {phone ? (
            <>
              {header}
              <div className="my-1 h-px bg-line" />
              <AccountWorkspacesFold close={closeMenu} onCreate={startCreate} />
              <div className="my-1 h-px bg-line" />
              {accountItems}
            </>
          ) : (
            <div className="grid grid-cols-[17rem_minmax(0,1fr)]">
              <div data-menu-column="">
                {header}
                <div className="my-1 h-px bg-line" />
                {accountItems}
              </div>
              {/* the side column takes the left column's height: its content is laid over it, the list scrolling inside */}
              <div data-menu-column="" className="relative ml-2 border-l border-line">
                <div className="absolute inset-0 pl-2">
                  <AccountWorkspaces variant="panel" close={closeMenu} onCreate={startCreate} />
                </div>
              </div>
            </div>
          )}
        </Popover>
      )}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} returnFocus={trigger} />
    </div>
  );
}

/** The top bar stays in view while the page scrolls: an invisible full-width container (the page background, no divider)
 *  so content slides under it cleanly. Its height is published as --topbar-h for the page's own sticky parts. */
function TopBar() {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--topbar-h"); };
  }, []);
  return (
    <div ref={bar} className="sticky top-0 z-30 -mx-4 flex items-center gap-2 bg-canvas px-4 pb-6 pt-5 sm:gap-4 md:-ml-2 md:-mr-6 md:pl-2 md:pr-6 lg:-ml-4 lg:-mr-8 lg:pl-4 lg:pr-8">
      <MobileNav />
      {/* the project switcher on a project page, the workspace switcher elsewhere */}
      <TopBarSwitcher />
      {/* the search takes only the room the right-hand group leaves: no spacer, no empty band before the pill */}
      <WorkspaceSearch />
      <SlowSavingHint />
      <RefreshingHint />
      <CreditPill />
      {/* beside the bell; on a phone the language is chosen in Settings → You */}
      <LanguageSwitcher tone="bar" className="hidden sm:inline-flex" />
      <Notifications />
      <AccountMenu />
    </div>
  );
}

/** The tab titles of the pages outside a project, made when the title is set (in the chosen language). */
const TITLES: [RegExp, () => string][] = [
  [/^\/sign-in$/, () => t("shell.titles.signIn", "Sign in")], [/^\/sign-up$/, () => t("shell.titles.signUp", "Get access")],
  [/^\/activate$/, () => t("shell.titles.activate", "Activate your account")], [/^\/resetpassword$/, () => t("shell.titles.resetPassword", "Set a new password")],
  [/^\/dashboard$/, () => t("shell.titles.dashboard", "Dashboard")], [/^\/home$/, () => t("shell.titles.home", "Home")],
  [/^\/new$/, () => t("shell.titles.newProject", "New project")], [/^\/projects$/, () => t("shell.titles.projects", "Projects")],
  [/^\/wiki$/, () => t("shell.titles.wiki", "Wiki")],
  [/^\/settings$/, () => t("shell.titles.settings", "Settings")], [/^\/admin(\/[^/]+)?$/, () => t("shell.titles.platformManagement", "Platform management")],
];

/** A project page's name: the step it belongs to, one of the four (the old analysis step pages say "Business
 *  Analysis" too), the Wiki, or what MADP produced. */
export function projectPageTitle(pathname: string): string | undefined {
  const slug = PROJECT_PAGE.exec(pathname)?.[1];
  if (!slug) return undefined;
  if (slug === "produced") return t("shell.titles.produced", "What MADP produced");
  const page = slug === "analysis" ? "analysis" : pageFromSlug(slug);
  const phase = phaseOfPage(page);
  if (phase) return phaseName(phase);
  return page && page !== "analysis" ? stepName(page) : undefined;
}

/** Each page names itself in the browser tab ("Business Analysis · <project name> – MADP Factory"). */
function usePageTitle(pathname: string) {
  const name = useRouteProject().project?.name ?? "";
  const culture = useCulture();
  useEffect(() => {
    const page = projectPageTitle(pathname) ?? TITLES.find(([re]) => re.test(pathname))?.[1]();
    document.title = page ? `${page}${PROJECT_PAGE.test(pathname) && name ? ` · ${name}` : ""} – ${PRODUCT}` : PRODUCT;
  }, [pathname, name, culture]);
}

/** Factory UI draws every Lucide icon at stroke 1.75; an icon drawn with a deliberate other weight keeps its own. */
function FactoryIcons({ children }: { children: ReactNode }) {
  return <LucideProvider strokeWidth={1.75}>{children}</LucideProvider>;
}

/** A new page opens at its top (going back and forward keeps the browser's own scroll position). */
function useScrollTop(key: string) {
  const type = useNavigationType();
  useLayoutEffect(() => { if (type !== "POP") window.scrollTo(0, 0); }, [key, type]);
}

/** A page that fails to load or render shows a way back instead of blanking the app. `bare` is the full-screen variant
 *  for pages outside the shell; inside the shell, key it by route so moving on resets it. */
export class RouteBoundary extends Component<{ children: ReactNode; bare?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const fallback = (
      <EmptyState title={t("shell.boundary.title", "Something went wrong on this page")}
        text={t("shell.boundary.text", "Nothing you did is lost. Reload to continue where you left off.")}
        action={<Button variant="primary" onClick={() => window.location.reload()}>{t("shell.boundary.reload", "Reload the page")}</Button>} />
    );
    return this.props.bare ? <div className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">{fallback}</div> : <div className="py-6">{fallback}</div>;
  }
}

export function Shell() {
  const t = useT();
  const theme = useDemo((s) => s.theme);
  const storageFailed = useDemo((s) => s.storageFailed);
  const persona = usePersona();
  const status = useSession((s) => s.status);
  const mustChange = useSession((s) => s.status === "signed-in" && s.profile?.mustChangePassword === true);
  const noWorkspace = useWorkspaces((s) => s.ready && s.workspaces.length === 0);
  const { pathname, search } = useLocation();
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useScrollTop(pathname + search);
  usePageTitle(pathname);
  const reserve = floatingReservePx({ launcherShown: true });
  // focus and scrollIntoView stop above the floating assistant button
  useEffect(() => applyScrollPaddingBottom(document.documentElement, reserve), [reserve]);
  // OIDC session: bypass all auth guards — the user authenticated via Blocks IAM
  const hasOidcSession = (() => { try { const r = globalThis.sessionStorage?.getItem("madp-oidc-session-v1"); return r !== null && r !== undefined; } catch { return false; } })();
  if (!hasOidcSession) {
    if (mustChange) return <Navigate to={signInRedirect(pathname, search)} replace />;
    if (status === "restoring" || (status === "signed-in" && !persona)) return <div className="min-h-screen bg-canvas" aria-busy="true" />;
    const to = guardRedirect(pathname, search, status);
    if (to || !persona) return <Navigate to={to ?? "/sign-in"} replace />;
  }
  return (
    <FactoryIcons>
      <div className="flex min-h-screen bg-canvas">
        <a href="#content" onClick={(e) => { e.preventDefault(); document.getElementById("content")?.focus(); }}
          className="sr-only z-50 rounded-full bg-surface px-4 py-2 text-[14px] font-medium text-ink shadow-float focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          {t("shell.skipToContent", "Skip to content")}
        </a>
        <Rail />
        <main id="content" tabIndex={-1} style={{ "--shell-pb": `${Math.max(112, reserve)}px` } as CSSProperties} className="min-w-0 flex-1 px-4 pb-[var(--shell-pb)] outline-none md:pl-2 md:pr-6 lg:pl-4 lg:pr-8">
          <TopBar />
          {storageFailed && <StorageFailedBanner />}
          {noWorkspace && !hasOidcSession && pathname !== "/settings" && !/^\/admin(\/|$)/.test(pathname) ? <NoWorkspace /> : <RouteBoundary key={pathname}><Outlet /></RouteBoundary>}
        </main>
        <AssistantLauncher />
        <ToastHost />
      </div>
    </FactoryIcons>
  );
}

/** Pages outside the app shell (landing, sign-in). `theme` sets the page's own theme (the landing's, dark by default);
 *  `appIcons` draws the icons like the app (the sign-in and sign-up are the app's first pages). */
export function BareShell({ children, theme: forced, appIcons = false }: { children: ReactNode; theme?: "light" | "dark"; appIcons?: boolean }) {
  const theme = useDemo((s) => s.theme);
  const shown = forced ?? theme;
  const { pathname } = useLocation();
  // before the first paint, so a dark page never flashes light
  useLayoutEffect(() => { document.documentElement.dataset.theme = shown; }, [shown]);
  useScrollTop(pathname);
  usePageTitle(pathname);
  const page = <div className="min-h-screen bg-canvas">{children}</div>;
  // the sign-in and sign-up are the app's first pages, so they draw their icons like the app; the landing keeps its own
  return appIcons ? <FactoryIcons>{page}</FactoryIcons> : page;
}

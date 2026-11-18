/** The workspace switcher in the top bar: the current workspace, my workspaces, create a workspace, workspace settings.
 *  Its rules (opening a workspace, creating one) are shared with the account menu's workspace list (AccountWorkspaces). */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftRight, Building2, Check, ChevronDown, Plus, Search, Settings, ShieldCheck } from "lucide-react";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import type { MyWorkspace } from "@/madp/blocks/workspaces/store";
import { switchWorkspace } from "@/madp/blocks/workspaces/sync";
import { NOT_CONFIGURED_MESSAGE } from "@/madp/blocks/workspaces/ops";
import { AFTER_CREATE_PATH, createAndOpenWorkspace, type CreatedWorkspace } from "./createAndOpen";
import { checkWorkspaceName } from "@/madp/domain/tenancy";
import { initialsOf } from "@/madp/state/workspaces";
import { cn } from "@/madp/lib/cn";
import { byNewest } from "@/madp/lib/newest";
import { Button, Chip, Input, Label, MENU_ITEM, MENU_PANEL, Modal } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { showToast } from "@/madp/ui/Toast";
import { confirmLeave } from "@/madp/components/project/leaveGuardStore";
import { useT } from "@/madp/i18n";
import { workspaceRoleLabel } from "@/madp/components/roles/permissionText";

const PANEL = `${MENU_PANEL} sm:w-72`;
const ITEM = `${MENU_ITEM} items-center`;
const ITEMS = '[role="menuitem"],[role="menuitemradio"]';

/** Opening a workspace from a menu, one rule for every switcher: the workspace already open only closes the menu (the
 *  page the user is on stays, focus back on the menu's button); one switch at a time; after a switch, its dashboard.
 *  `close(refocus)` closes the menu. */
export function useOpenWorkspace(close: (refocus: boolean) => void) {
  const activeId = useWorkspaces((s) => s.workspaceId);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const switching = useRef(false);
  const choose = async (id: string) => {
    // the workspace already open: nothing to switch, and the page the user is on stays
    if (id === activeId) { close(true); return; }
    if (switching.current) return;
    switching.current = true;
    // leaving a project page with something unfinished there asks first (LeaveProjectDialog closes the menu); off a
    // project page it goes on at once
    let asked = false;
    const go = await confirmLeave(() => { asked = true; close(true); });
    if (!go) { switching.current = false; return; }
    const r = await switchWorkspace(id).finally(() => { switching.current = false; });
    if (r.ok) { close(false); navigate("/dashboard"); } else if (asked) showToast(r.error); else setError(r.error);
  };
  return { choose, error, setError };
}

/** "Create workspace": a name, then the new workspace opens on its dashboard. Cancel puts focus back on `returnFocus`. */
export function CreateWorkspaceDialog({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus: RefObject<HTMLElement> }) {
  const t = useT();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const creatingNow = useRef(false);
  const created = useRef<CreatedWorkspace>(null);
  const cancel = () => { if (saving) return; onClose(); setName(""); setCreateError(null); created.current = null; returnFocus.current?.focus(); };
  const create = async () => {
    const value = name.trim();
    const check = checkWorkspaceName(value) as unknown as { ok: boolean; error?: string; message?: string };
    if (!check.ok) { setCreateError(check.error ?? check.message ?? t("shell.workspace.nameProblem", "Give the workspace a name of up to 60 characters.")); return; }
    if (creatingNow.current) return;
    creatingNow.current = true;
    setSaving(true);
    setCreateError(null);
    try {
      const r = await createAndOpenWorkspace(value, created);
      if (!r.ok) { setCreateError(r.error); return; }
      onClose(); setName(""); navigate(AFTER_CREATE_PATH);
    } finally {
      creatingNow.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={cancel} title={t("shell.workspace.createTitle", "Create workspace")}
      footer={<>
        <Button variant="ghost" onClick={cancel} disabled={saving}>{t("common.actions.cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={() => void create()} disabled={saving}>{t("shell.workspace.createTitle", "Create workspace")}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (!saving) void create(); }}>
        <Label>{t("shell.workspace.name", "Name")}</Label>
        <Input value={name} maxLength={60} autoFocus aria-label={t("shell.workspace.name", "Name")} onChange={(e) => setName(e.target.value)} disabled={saving} />
        {createError && <p role="alert" className="mt-3 text-[13px] text-danger">{createError}</p>}
      </form>
    </Modal>
  );
}

/** The workspaces with my role in each named in the current language (workspaceRoleLabel), for the workspace lists. */
export function labelWorkspaces(workspaces: readonly MyWorkspace[], c: Parameters<typeof workspaceRoleLabel>[1]): MyWorkspace[] {
  return workspaces.map((w) => ({ ...w, roleName: workspaceRoleLabel(w, c) }));
}

/** My workspaces from the store, labelled by labelWorkspaces. */
export function useLabelledWorkspaces(): MyWorkspace[] {
  useT(); // a language switch names the roles again
  const workspaces = useWorkspaces((s) => s.workspaces);
  const isSuperAdmin = useWorkspaces((s) => s.isSuperAdmin);
  const customRoles = useWorkspaces((s) => s.customRoles);
  return labelWorkspaces(workspaces, { isSuperAdmin, customRoles });
}

/** The workspaces as radio rows of the account menu: a monogram tile, the name, the person's role there; the open one
 *  highlighted and checked. Props only, so it renders the same in a test. */
export function WorkspaceRadioRows({ workspaces, currentId, onChoose }: { workspaces: readonly MyWorkspace[]; currentId: string | null; onChoose: (id: string) => void }) {
  const t = useT();
  return (
    <>
      {workspaces.map((w) => {
        const current = w.id === currentId;
        return (
          <button key={w.id} type="button" role="menuitemradio" aria-checked={current} onClick={() => onChoose(w.id)}
            className={cn(ITEM, "py-2", current && "bg-surface2 text-ink")}>
            <span aria-hidden="true" className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[12px] font-semibold tracking-wide",
              current ? "bg-accent text-white" : "bg-surface2 text-ink2 ring-1 ring-inset ring-line")}>
              {initialsOf(w.name)}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("truncate", current && "font-medium")}>{w.name}</span>
                {/* platform access as a small badge after the name, so the role line keeps its width */}
                {w.viaPlatform && (
                  <span title={t("shell.workspace.platformAccess", "Platform access")} className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]">
                    <ShieldCheck size={11} strokeWidth={2} aria-hidden="true" /><span className="sr-only">{t("shell.workspace.platformAccess", "Platform access")}</span>
                  </span>
                )}
              </span>
              {w.roleName && <span className="mt-0.5 block truncate text-[12px] text-ink3">{w.roleName}</span>}
            </span>
            {current ? <Check size={16} aria-hidden="true" className="shrink-0 text-accent" /> : <span aria-hidden="true" className="w-4 shrink-0" />}
          </button>
        );
      })}
    </>
  );
}

const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Newest first: by when each workspace was created; workspaces created at the same time (or with no date) by name. */
export function newestWorkspacesFirst<T extends { name: string; createdAt?: string | null }>(workspaces: readonly T[]): T[] {
  return byNewest([...workspaces].sort((a, b) => byName.compare(a.name, b.name)), (w) => w.createdAt);
}

/** The account menu's order: the open workspace pinned first, then the rest newest first (newestWorkspacesFirst). */
export function accountWorkspaceOrder<T extends { id: string; name: string; createdAt?: string | null }>(workspaces: readonly T[], currentId: string | null): T[] {
  const current = workspaces.find((w) => w.id === currentId);
  const rest = newestWorkspacesFirst(workspaces.filter((w) => w !== current));
  return current ? [current, ...rest] : rest;
}

/** From this many workspaces the list has a field to find one. */
export const FIND_FROM = 7;

const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The workspaces whose name or my role there holds every word of the query (case and accents ignored), in order. */
export function findWorkspaces<T extends { name: string; roleName?: string }>(workspaces: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...workspaces];
  return workspaces.filter((w) => { const text = fold(`${w.name} ${w.roleName ?? ""}`); return words.every((x) => text.includes(x)); });
}

/** The account menu's workspace switcher: my workspaces (switched with the top bar switcher's own rule), then create a
 *  workspace and the workspace's settings. `close(refocus)` closes the menu; `onCreate` opens the create dialog.
 *  "panel" fills the menu's side column (titled; the list scrolls in the room left above the actions); "inline" sits
 *  under the phone menu's "Switch workspace" row (the list capped at a short height). */
export function AccountWorkspaces({ close, onCreate, variant = "panel" }: { close: (refocus: boolean) => void; onCreate: () => void; variant?: "panel" | "inline" }) {
  const t = useT();
  const workspaces = useLabelledWorkspaces();
  const activeId = useWorkspaces((s) => s.workspaceId);
  const bootstrapError = useWorkspaces((s) => s.bootstrapError);
  const ready = useWorkspaces((s) => s.ready);
  const bootstrapPending = useWorkspaces((s) => s.bootstrapPending);
  // mounted with its menu, so a switch error and a query from an earlier opening are gone
  const { choose, error } = useOpenWorkspace(close);
  const [query, setQuery] = useState("");
  const currentId = workspaces.some((w) => w.id === activeId) ? activeId : null;
  const listLoading = !ready || (bootstrapPending && workspaces.length === 0);
  const panel = variant === "panel";
  const findable = workspaces.length >= FIND_FROM;
  const shown = findWorkspaces(accountWorkspaceOrder(workspaces, currentId), findable ? query : "");
  const onFindKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Escape first empties the field (the menu stays open); Enter opens the first match
    if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
    else if (e.key === "Enter" && shown[0]) { e.preventDefault(); void choose(shown[0].id); }
  };
  return (
    <div role="group" aria-label={t("shell.workspace.workspaces", "Workspaces")} className={cn(panel && "flex h-full min-h-0 flex-col")}>
      {panel && (
        <div className="flex shrink-0 items-baseline justify-between px-3 pb-1.5 pt-2.5">
          <span className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("shell.workspace.workspaces", "Workspaces")}</span>
          {workspaces.length > 1 && <span className="text-[12px] text-ink3">{workspaces.length}</span>}
        </div>
      )}
      {listLoading && (
        <div role="status" className="flex shrink-0 items-center gap-3 px-3 py-2">
          <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-pulse rounded-[10px] bg-surface2 motion-reduce:animate-none" />
          <span aria-hidden="true" className="h-3 w-28 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
          <span className="sr-only">{t("shell.workspace.loadingWorkspaces", "Loading workspaces…")}</span>
        </div>
      )}
      {findable && (
        <label className="mx-1 mb-1 flex h-9 shrink-0 items-center gap-2 rounded-full bg-surface2 px-3 text-ink3 ring-1 ring-inset ring-line transition focus-within:ring-2 focus-within:ring-accent/40">
          <Search size={14} aria-hidden="true" className="shrink-0" />
          <input data-menu-field="" type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onFindKey}
            aria-label={t("shell.workspace.find", "Find a workspace")} placeholder={t("shell.workspace.findPlaceholder", "Find a workspace…")} autoComplete="off" spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3" />
        </label>
      )}
      {/* a long list scrolls on its own, so the menu keeps its height and the actions stay in reach */}
      <div className={cn("scroll-thin space-y-0.5 overflow-y-auto overscroll-contain", panel ? "min-h-0 flex-1" : "max-h-[min(264px,40dvh)]")}>
        <WorkspaceRadioRows workspaces={shown} currentId={currentId} onChoose={(id) => void choose(id)} />
        {findable && query.trim() && !shown.length && <p role="status" className="px-3 py-2 text-[13px] text-ink3">{t("shell.workspace.noMatch", "No workspace matches “{query}”", { query: query.trim() })}</p>}
      </div>
      {bootstrapError === NOT_CONFIGURED_MESSAGE.workspace && <p role="alert" className="shrink-0 px-3 py-2 text-[13px] text-danger">{bootstrapError}</p>}
      {error && <p role="alert" className="shrink-0 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className={cn("shrink-0", panel ? "mt-1 border-t border-line pt-1" : "mt-0.5")}>
        <button type="button" role="menuitem" onClick={onCreate} className={ITEM}><Plus size={16} /> {t("shell.workspace.createTitle", "Create workspace")}</button>
        {currentId && <Link to="/settings#workspace" role="menuitem" className={ITEM} onClick={() => close(false)}><Building2 size={16} /> {t("shell.workspace.settings", "Workspace settings")}</Link>}
      </div>
    </div>
  );
}

/** The phone menu's workspace switcher: one "Switch workspace" row naming the open workspace, which unfolds the list in
 *  place, so the menu stays short. Folded each time the menu opens. */
export function AccountWorkspacesFold({ close, onCreate }: { close: (refocus: boolean) => void; onCreate: () => void }) {
  const t = useT();
  const current = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.workspaceId) ?? null);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" role="menuitem" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className={ITEM}>
        <ArrowLeftRight size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block">{t("shell.workspace.switch", "Switch workspace")}</span>
          {current && <span className="mt-0.5 block truncate text-[12px] text-ink3">{current.name}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-ink3 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div id={id} className="ml-5 border-l border-line pl-1.5">
          <AccountWorkspaces variant="inline" close={close} onCreate={onCreate} />
        </div>
      )}
    </>
  );
}

export function WorkspaceSwitcher() {
  const t = useT();
  const workspaces = useLabelledWorkspaces();
  const activeId = useWorkspaces((s) => s.workspaceId);
  const bootstrapError = useWorkspaces((s) => s.bootstrapError);
  const ready = useWorkspaces((s) => s.ready);
  const bootstrapPending = useWorkspaces((s) => s.bootstrapPending);
  const workspace = workspaces.find((w) => w.id === activeId) ?? null;
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { choose, error, setError } = useOpenWorkspace((refocus) => { setOpen(false); if (refocus) trigger.current?.focus(); });

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const click = (e: MouseEvent) => { const t = e.target as Node; if (box.current && !box.current.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // The popover is placed in its own layout effect (it runs first), so the first item can take focus right here.
  useLayoutEffect(() => { if (open) menu.current?.querySelector<HTMLElement>(ITEMS)?.focus(); }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  const label = workspace?.name ?? t("shell.workspace.workspace", "Workspace");
  const loading = !ready && !workspace;
  const listLoading = !ready || (bootstrapPending && workspaces.length === 0);
  return (
    <div className="sm:relative" ref={box}>
      <button ref={trigger} type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={loading ? t("shell.workspace.triggerLoading", "Workspace: loading") : t("shell.workspace.trigger", "Workspace: {name}", { name: label })} aria-busy={loading || undefined}
        className="flex h-12 shrink-0 items-center gap-3 rounded-full bg-surface p-[5px] text-left transition hover:bg-line xl:pr-4 dark:ring-1 dark:ring-line">
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-surface2 text-ink2"><Building2 size={18} /></span>
        {loading
          ? <span aria-hidden className="hidden h-3 w-24 animate-pulse rounded-full bg-line motion-reduce:animate-none xl:block" />
          : <span className="hidden max-w-[160px] truncate text-[14px] font-medium xl:block">{label}</span>}
        <ChevronDown size={16} className="hidden text-ink3 xl:block" />
      </button>
      {open && (
        <Popover anchorRef={trigger} panelRef={menu} mobileSheet onClose={() => setOpen(false)} role="menu" aria-label={t("shell.workspace.workspaces", "Workspaces")} onKeyDown={onKeyDown} className={PANEL}>
          <div className="px-3 pb-2 pt-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("shell.workspace.workspaces", "Workspaces")}</div>
          {listLoading && (
            <div role="status" className="flex items-center gap-3 px-3 py-2.5 text-[14px] text-ink3">
              <span aria-hidden className="h-3 w-20 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
              {t("shell.workspace.loadingWorkspaces", "Loading workspaces…")}
            </div>
          )}
          {newestWorkspacesFirst(workspaces).map((w) => {
            const current = w.id === workspace?.id;
            return (
              <button key={w.id} type="button" role="menuitemradio" aria-checked={current} onClick={() => void choose(w.id)} className={ITEM}>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", current && "font-medium text-ink")}>{w.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink3">
                    {w.roleName}
                    {w.viaPlatform && <Chip tone="accent">{t("shell.workspace.platformAccess", "Platform access")}</Chip>}
                  </span>
                </span>
                {current && <Check size={16} className="shrink-0 text-accent" />}
              </button>
            );
          })}
          {bootstrapError === NOT_CONFIGURED_MESSAGE.workspace && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{bootstrapError}</p>}
          {error && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setCreating(true); }} className={ITEM}><Plus size={16} /> {t("shell.workspace.createTitle", "Create workspace")}</button>
          <Link to="/settings" role="menuitem" className={ITEM} onClick={() => setOpen(false)}><Settings size={16} /> {t("shell.account.settings", "Settings")}</Link>
        </Popover>
      )}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} returnFocus={trigger} />
    </div>
  );
}

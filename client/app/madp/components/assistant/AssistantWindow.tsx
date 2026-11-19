import { openGuidedStart } from "@/madp/components/guided/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, Maximize2, Minimize2, Minus, Plus, X } from "lucide-react";
import { Button, EmptyState, IconButton, Segmented, Select } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";
import { VIEWER_TIP } from "@/madp/domain/rbac";
import { useOverviewUi } from "@/madp/components/overview/overviewUi";
import { useProjectList } from "@/madp/blocks/projects/reads";
import { useAssistantEnvironments } from "@/madp/blocks/collab/assistant";
import { isBlocksProjectId, useCan } from "@/madp/blocks/collab/context";
import { AssistantChat } from "./AssistantChat";
import { AssistantComposer } from "./AssistantComposer";
import {
  ASSISTANT_COMPOSER_ID, ASSISTANT_LAUNCHER_ID, ASSISTANT_WINDOW_ID,
  defaultAssistantTarget, envLabel, escapeClosesWindow, overviewEnvOf, routeProjectId, useAssistantWindow,
} from "./assistantWindowState";
import { prefixPath } from "@/madp/lib/pathPrefix";

export const localProjectText = (): string =>
  t("assistant.window.localProject", "The assistant answers about projects saved in your workspace. Open one from your projects list.");

export function LocalProjectNote() {
  useT();
  return (
    <div className="p-4">
      <p role="status" className="text-[14px] text-ink2">{localProjectText()}</p>
    </div>
  );
}

/** The project the assistant talks about: the route's Blocks project, else the one picked in the window, else the most
 *  recently updated Blocks project. Local project ids are never a target. */
export function useAssistantTarget() {
  const { pathname } = useLocation();
  const chosen = useAssistantWindow((s) => s.chosenProjectId);
  const q = useProjectList();
  const projects = useMemo(
    () => (q.data ?? []).filter((p) => p.status !== "deleting" && isBlocksProjectId(p.id)),
    [q.data],
  );
  const routeId = routeProjectId(pathname);
  const onBlocksRoute = routeId !== null && isBlocksProjectId(routeId);
  const picked = chosen !== null && projects.some((p) => p.id === chosen) ? chosen : null;
  const projectId = onBlocksRoute ? routeId : picked ?? projects[0]?.id ?? null;
  return { projectId, projects, localRoute: routeId !== null && !onBlocksRoute, ready: !q.isPending };
}

const focusLauncher = () => requestAnimationFrame(() => document.getElementById(ASSISTANT_LAUNCHER_ID)?.focus());
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function AssistantWindow() {
  const t = useT();
  const { view, expanded, environment, needsDefaults, session, minimise, close, toggleExpanded, setEnvironment, applyDefaults } = useAssistantWindow();
  const open = view === "open";
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const { projectId, projects: list, localRoute, ready } = useAssistantTarget();
  const activeId = projectId ?? "";
  const environments = useAssistantEnvironments(projectId);
  const canCreate = useCan("project.create");
  const onProjectPage = routeProjectId(pathname) !== null;

  // follow `open` one frame later, so the first paint is the closed look and the transition runs
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const f = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(f);
  }, [open]);

  useEffect(() => { root.current?.toggleAttribute("inert", !open); }, [open]);

  useEffect(() => {
    if (!shown || root.current?.contains(document.activeElement)) return;
    const el = document.getElementById(ASSISTANT_COMPOSER_ID) ?? root.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus({ preventScroll: true });
  }, [shown, activeId, localRoute, ready]);

  // defaults on open
  useEffect(() => {
    if (!open || !ready) return;
    if (needsDefaults) {
      const target = defaultAssistantTarget({
        routeProjectId: routeProjectId(pathname), projects: list,
        overviewEnv: overviewEnvOf(pathname, search, useOverviewUi.getState().envFor),
      });
      applyDefaults({ environment: target.environment });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsDefaults, ready]);

  // below sm, a link followed inside the window must reveal its page. Compared with the last path (not a first-run
  // flag): React's dev double effect run would otherwise minimise the window the moment it first opens on a phone.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open && window.matchMedia("(max-width: 639px)").matches) minimise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // an environment without a release (yet) falls back to dev
  useEffect(() => {
    if (open && !environments.includes(environment)) setEnvironment("dev");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, environments, environment]);

  const choose = (id: string) => {
    if (id === activeId) return;
    if (onProjectPage) { navigate(prefixPath(`/p/${id}`)); return; }
    useAssistantWindow.getState().chooseProject(id);
  };

  const options = list.map((p) => ({ value: p.id, label: p.name || t("assistant.window.untitledProject", "Untitled project") }));

  // Escape closes the window while focus is inside it or on its launcher; an open menu or popover closes first
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!escapeClosesWindow({
        key: e.key, defaultPrevented: e.defaultPrevented,
        focusInWindow: !!el && !!root.current?.contains(el), focusOnLauncher: el?.id === ASSISTANT_LAUNCHER_ID,
        overlayOpen: !!document.querySelector("[role='listbox'], [role='menu']"),
      })) return;
      e.preventDefault();
      minimise();
      focusLauncher();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const empty = ready && list.length === 0 && !activeId;

  return createPortal(
    <div ref={root} id={ASSISTANT_WINDOW_ID} role="dialog" aria-modal="false" aria-label={t("assistant.window.title", "MADP assistant")}
      className={cn(
        "fixed z-[49] flex flex-col overflow-hidden bg-surface ring-1 ring-line shadow-float origin-bottom-right motion-safe:transition-[opacity,transform,visibility] motion-safe:duration-200 motion-safe:ease-out",
        "max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-full max-sm:rounded-none",
        "sm:bottom-[92px] sm:right-6 sm:rounded-card",
        expanded ? "sm:w-[min(760px,calc(100vw-48px))] sm:h-[min(880px,calc(100dvh-120px))]" : "sm:w-[min(480px,calc(100vw-48px))] sm:h-[min(720px,calc(100dvh-120px))]",
        shown ? "visible opacity-100 scale-100 translate-y-0" : "invisible pointer-events-none opacity-0 scale-95 translate-y-2")}>
      <header className="grid shrink-0 gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]">
            <Bot size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium leading-tight">{t("assistant.window.title", "MADP assistant")}</h2>
            <p className="text-[12px] text-ink3">{t("assistant.window.subtitle", "Your project manager")}</p>
          </div>
          <IconButton className="h-9 w-9 max-sm:hidden" aria-pressed={expanded} onClick={toggleExpanded}
            label={expanded ? t("assistant.window.shrink", "Make the assistant smaller") : t("assistant.window.expand", "Expand the assistant")}
            icon={expanded ? <Minimize2 size={16} strokeWidth={1.75} /> : <Maximize2 size={16} strokeWidth={1.75} />} />
          <IconButton className="h-9 w-9" label={t("assistant.window.minimise", "Minimise the assistant")} icon={<Minus size={16} strokeWidth={1.75} />}
            onClick={() => { minimise(); focusLauncher(); }} />
          <IconButton className="h-9 w-9" label={t("assistant.window.close", "Close the assistant")} icon={<X size={16} strokeWidth={1.75} />}
            onClick={() => { close(); focusLauncher(); }} />
        </div>
        {!localRoute && list.length > 0 && (
          <div className="flex items-center gap-2">
            <Select label={t("assistant.window.project", "Project")} size="sm" className="min-w-0 flex-1" value={activeId} options={options} onChange={choose} />
            <Segmented label={t("assistant.window.environment", "Environment")} value={environment} onChange={setEnvironment}
              options={environments.map((e) => ({ value: e, label: envLabel(e) }))} />
          </div>
        )}
      </header>
      {localRoute ? (
        <LocalProjectNote />
      ) : empty ? (
        <div className="p-4">
          <EmptyState icon={<Bot size={28} strokeWidth={1.75} />} title={t("assistant.window.emptyTitle", "No projects yet")}
            text={t("assistant.window.emptyText", "Start a project. The assistant then answers questions about it and looks into any problem a customer reports.")}
            action={<Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} disabled={!canCreate} title={canCreate ? undefined : VIEWER_TIP}
              onClick={() => { minimise(); openGuidedStart(); }}>{t("assistant.window.startProject", "Start a project")}</Button>} />
        </div>
      ) : activeId ? (
        <>
          <AssistantChat projectId={activeId} environment={environment} />
          <AssistantComposer key={session} projectId={activeId} environment={environment} />
        </>
      ) : null}
    </div>,
    document.body,
  );
}

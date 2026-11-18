import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Check, ChevronDown, FolderOpen, Lock, UserRound } from "lucide-react";
import { STATUS_TEXT, journeyOf, viewFromPath, type Journey, type JourneyItem } from "@/madp/components/project/projectSteps";
import { inProgressPercent, isReady, usePhaseProgressStore, type PhaseProgress } from "@/madp/components/project/phaseProgress";
import { useProject } from "@/madp/blocks/projects/reads";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { attachedLive } from "@/madp/components/analysis-next/model";
import { livePastAnalysis } from "@/madp/components/analysis/pm/pmModel";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { Popover } from "@/madp/ui/popover";
import { Drawer } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";

/** The one project navigation, drawn once by the project layout: the journey bar (people are managed in the workspace,
 *  not here, so the bar takes the full width). */
export function ProjectNav({ projectId }: { projectId: string }) {
  return isBlocksProjectId(projectId) ? <BlocksProjectNav projectId={projectId} /> : null;
}

/** A Blocks project: the journey comes from the Project's journey step. */
function BlocksProjectNav({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  const project = useProject(projectId).data;
  const view = viewFromPath(pathname);
  // a live product (attached as it is, past the analysis) works through change requests: its step guides say so
  const live = livePastAnalysis(attachedLive(project ?? null), project?.step ?? null);
  const journey = journeyOf({ step: project?.step ?? null, viewing: view, type: project?.type, live });
  return <JourneyBar projectId={projectId} journey={journey} wikiOpen={view === "wiki"} />;
}

const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const PHONE = "(max-width: 639px)";

/** The window scrolls (no shell ancestor clips the page), so the bar sticks to it, right below the shell's sticky top
 *  bar (--topbar-h): above the page (z-20), below the top bar and its menus (z-30), dialogs (z-50) and popovers (z-70).
 *  Its band reaches out to the shell's page gutters (main: px-4 md:pl-2 md:pr-6 lg:pl-4 lg:pr-8), like the top bar,
 *  so a stuck bar's backdrop spans the page; pb-3 + mb-3 keep the bar's 24 px from the page below (pb-2 + mb-4 on a
 *  phone, for a compact stuck bar). */
const BAND = "sticky top-[var(--topbar-h,0px)] z-20 mb-3 -mx-4 px-4 pb-3 max-sm:mb-4 max-sm:pb-2 md:-ml-2 md:-mr-6 md:pl-2 md:pr-6 lg:-ml-4 lg:-mr-8 lg:pl-4 lg:pr-8 transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none";
/** Once stuck: the page scrolling under the bar stays readable behind a soft backdrop and shadow. */
const STUCK = "bg-canvas/85 shadow-[0_14px_22px_-18px_rgb(10_12_20/0.35)] backdrop-blur-md dark:shadow-[0_14px_22px_-16px_rgb(0_0_0/0.7)]";
/** Where the stuck bar ends, from the top of the window (the top bar included), for a page's own sticky columns:
 *  top: calc(var(--project-nav-h, 0px) + 16px). Absent (0) outside a project. */
export const PROJECT_NAV_VAR = "--project-nav-h";

/** The CSS value of --project-nav-h: the top bar's height and the bar's own band, so it follows the top bar's changes. */
export function projectNavOffset(bandHeight: number): string {
  return `calc(var(--topbar-h, 0px) + ${Math.round(bandHeight)}px)`;
}

/** The bar is stuck once the page has scrolled and the band rests on its sticky line (at the very top it only sits there). */
export function isStuck(scrollY: number, bandTop: number, stickyTop: number): boolean {
  return scrollY > 0 && bandTop <= stickyTop + 0.5;
}

/** Keeps --project-nav-h on the document root (from the band's size) and says whether the bar is stuck (from the scroll). */
function useStickyBar(band: RefObject<HTMLElement>): boolean {
  const [stuck, setStuck] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    let height = -1;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = band.current;
      if (!el) return;
      if (el.offsetHeight !== height) { height = el.offsetHeight; root.style.setProperty(PROJECT_NAV_VAR, projectNavOffset(height)); }
      setStuck(isStuck(window.scrollY, el.getBoundingClientRect().top, parseFloat(getComputedStyle(el).top) || 0));
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    if (band.current) ro?.observe(band.current);
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      root.style.removeProperty(PROJECT_NAV_VAR);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return stuck;
}

function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/** One slim row: where the project stands ("● Business Analysis · Step 2 of 4"), its progress, all the steps on demand, the Wiki.
 *  It looks the same on every page of the project (owner 09.11.2026: no "Viewing <step>" chip coming and going): the
 *  step on screen shows only through its own segment's highlight, and the phone row always names the current step. */
function JourneyBar({ projectId, journey, wikiOpen }: { projectId: string; journey: Journey; wikiOpen: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const phone = usePhone();
  const t = useT();
  useEffect(() => setOpen(false), [pathname]);
  const producedOpen = /^\/p\/[^/]+\/produced\/?$/.test(pathname);

  const shown = journey.now ?? journey.viewing;
  const at = journey.at ?? shown?.n ?? 0;
  const label = shown?.label ?? "";
  // the phone row is narrow: the compact name ("Goals") fits beside "Step 3 of 6" and All steps
  const shortLabel = shown?.short || label;
  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) trigger.current?.focus(); };
  const band = useRef<HTMLDivElement>(null);
  const stuck = useStickyBar(band);
  // the current step's own progress, when its page publishes it (Business Analysis: parts ready out of all parts)
  const published = usePhaseProgressStore((s) => (s.progress?.projectId === projectId ? s.progress : null));
  const nowProgress = progressOfNow(published, journey);

  // the bar stays in view while the page scrolls (see BAND)
  return (
    <div ref={band} data-stuck={stuck || undefined} className={cn(BAND, "min-w-0", stuck && STUCK)}>
      <nav aria-label={t("project.nav.journeyAria", "Project journey")} className={cn(CARD, "flex min-h-16 min-w-0 flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 md:flex-nowrap md:px-5")}>
        <p className="flex min-w-0 items-center gap-2 text-[14px] max-md:flex-1 md:hidden">
          <span aria-hidden className="relative grid h-2.5 w-2.5 shrink-0 place-items-center">
            {journey.now && <span className="absolute inset-0 rounded-full bg-accent/30 animate-ping motion-reduce:hidden" />}
            <span className="h-2 w-2 rounded-full bg-accent" />
          </span>
          {journey.now ? (
            <Link to={`/p/${projectId}/${journey.now.slug}`} title={t("project.nav.goTo", "Go to {step}", { step: journey.now.label })} aria-label={t("project.nav.whereNowAria", "{step}, where the project is now", { step: journey.now.label })}
              className={cn("min-w-0 truncate rounded font-medium text-ink underline-offset-4 hover:underline", FOCUS)}>{shortLabel}</Link>
          ) : (
            <span className="min-w-0 truncate font-medium text-ink" title={label}>{shortLabel}</span>
          )}
          {at > 0 && <span className="num shrink-0 whitespace-nowrap text-ink3">{`· ${t("project.nav.stepOf", "Step {at} of {total}", { at, total: journey.total })}${nowProgress ? ` · ${progressText(nowProgress)}` : ""}`}</span>}
          {nowProgress && <NeedsYou count={nowProgress.needsYou} />}
        </p>
        {at > 0 && (
          <ShimmerProgress step={at} total={journey.total} size="sm" active={!!journey.now} label={t("project.nav.progressLabel", "Project progress")}
            valueText={t("project.nav.stepOfNamed", "Step {at} of {total}: {step}", { at, total: journey.total, step: label })}
            className="order-last basis-full md:hidden" />
        )}
        <StepSegments projectId={projectId} journey={journey} progress={nowProgress} />
        <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors", FOCUS,
            open ? "bg-accent-soft text-accent" : "bg-surface2 text-ink hover:bg-line")}>
          {t("project.nav.allSteps", "All steps")}
          <ChevronDown aria-hidden size={14} strokeWidth={2} className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <Link to={`/p/${projectId}/wiki`} aria-current={wikiOpen ? "page" : undefined} title={t("project.nav.wiki", "Wiki")}
          className={cn("inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors lg:px-3", FOCUS,
            wikiOpen ? "bg-accent-soft text-accent" : "text-ink2 hover:bg-surface2 hover:text-ink")}>
          <BookOpen aria-hidden size={16} strokeWidth={1.75} />
          <span className="max-lg:sr-only">{t("project.nav.wiki", "Wiki")}</span>
        </Link>
        <Link to={`/p/${projectId}/produced`} aria-current={producedOpen ? "page" : undefined} title={t("project.nav.produced", "What MADP produced")} aria-label={t("project.nav.produced", "What MADP produced")}
          className={cn("inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors lg:px-3", FOCUS,
            producedOpen ? "bg-accent-soft text-accent" : "text-ink2 hover:bg-surface2 hover:text-ink")}>
          <FolderOpen aria-hidden size={16} strokeWidth={1.75} />
          <span className="max-xl:sr-only">{t("project.nav.producedShort", "Produced")}</span>
        </Link>
      </nav>
      {open && (phone ? (
        <Drawer open side="bottom" onClose={() => close()} title={t("project.nav.allSteps", "All steps")}>
          <StepList projectId={projectId} journey={journey} onPick={() => close(false)} />
        </Drawer>
      ) : (
        <StepsPopover anchor={trigger} id={panelId} onClose={close}>
          <StepList projectId={projectId} journey={journey} onPick={() => close(false)} heading />
        </StepsPopover>
      ))}
    </div>
  );
}

/** The published progress the bar may show: only the step the project is on now shows it. An earlier step is done,
 *  whatever its page published (owner 08.11.2026: Business Analysis read "100%" in blue at the Release step); a later
 *  one is locked; while the project loads no step is current, so none shows it. */
export function progressOfNow(progress: PhaseProgress | null, journey: Pick<Journey, "now">): PhaseProgress | null {
  return progress && journey.now && progress.phase === journey.now.id ? progress : null;
}

/** What the bar says of the current step's progress: "22%", or "Ready" once every part is (never "100%"). */
export function progressText(p: Pick<PhaseProgress, "done" | "total">): string {
  return isReady(p) ? t("project.nav.ready", "Ready") : `${inProgressPercent(p)}%`;
}

/** "2 need you": a small amber dot (the words from 2xl, and always for a screen reader); nothing when nobody is waited on. */
function NeedsYou({ count }: { count: number }) {
  const t = useT();
  if (!(count > 0)) return null;
  const text = count === 1 ? t("project.nav.needsYouOne", "{count} needs you", { count }) : t("project.nav.needsYouMany", "{count} need you", { count });
  return (
    <span title={text} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] font-medium text-warning">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
      <span className="max-2xl:sr-only">{text}</span>
    </span>
  );
}

/** From md: the four steps as labelled segments, each in its own status style whichever page is viewed: a done step
 *  green with a check (never a percentage), the current step in the accent with the shimmer, later ones muted and
 *  locked (they say why). Only the current step shows its page's published progress (`progress`, see progressOfNow):
 *  the bar filled that far, the percentage and who it waits on; once every part is ready, a full green bar, a check and
 *  "Ready to lock" instead of "100%". Done and current steps are links. Arrow keys move between them. */
function StepSegments({ projectId, journey, progress }: { projectId: string; journey: Journey; progress: PhaseProgress | null }) {
  const t = useT();
  const list = useRef<HTMLOListElement>(null);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-seg]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length || i < 0) return;
    e.preventDefault();
    const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[to]?.focus();
  };
  return (
    <ol ref={list} aria-label={t("project.nav.stepsAria", "Project steps")} onKeyDown={onKeyDown} className="hidden min-w-0 flex-1 gap-1.5 md:flex">
      {journey.items.map((s) => {
        const here = s.viewing;
        const own = s.status === "now" && progress?.phase === s.id ? progress : null;
        const ready = !!own && isReady(own);
        const pct = own && !ready ? inProgressPercent(own) : 0;
        const bar = ready
          ? <span role="progressbar" aria-label={t("project.nav.stepProgress", "{step} progress", { step: s.label })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={100} aria-valuetext={t("project.nav.readyToLock", "Ready to lock")} className="block h-1.5 w-full rounded-full bg-success" />
          : own
          ? <ShimmerProgress step={own.done} total={own.total} size="sm" active label={t("project.nav.stepProgress", "{step} progress", { step: s.label })} valueText={t("project.nav.percentDone", "{pct}% done", { pct })} ticks={false} className="pointer-events-none" />
          : s.status === "now"
          ? <ShimmerProgress step={1} total={1} size="sm" active label={t("project.nav.stepInProgress", "{step} in progress", { step: s.label })} ticks={false} className="pointer-events-none" />
          : <span aria-hidden className={cn("block h-1.5 w-full rounded-full", s.status === "done" ? "bg-success" : "bg-surface2 dark:bg-ink/[0.08]")} />;
        const body = (
          <>
            {bar}
            <span className={cn("flex min-w-0 items-center gap-1 text-[12px] leading-4", here ? "font-semibold text-ink" : s.open ? "font-medium text-ink2" : "text-ink3")}>
              {s.status === "done" || ready ? <Check aria-hidden size={11} strokeWidth={2.5} className="shrink-0 text-success" /> : !s.open ? <Lock aria-hidden size={10} strokeWidth={2} className="shrink-0" /> : null}
              <span className="sr-only">{`${t("project.nav.stepN", "Step {n}:", { n: s.n })} `}</span>
              <span className="truncate max-lg:hidden">{s.label}</span>
              <span className="truncate lg:hidden" aria-hidden>{s.short}</span>
              {own && !ready && <span className="num shrink-0 font-medium text-ink2">{`${pct}%`}<span className="sr-only">{` ${t("project.nav.done", "done")}`}</span></span>}
              {ready && <span className="shrink-0 whitespace-nowrap font-medium text-success">{t("project.nav.ready", "Ready")}<span className="max-2xl:sr-only">{` ${t("project.nav.toLock", "to lock")}`}</span></span>}
              {own && <NeedsYou count={own.needsYou} />}
            </span>
          </>
        );
        const cell = "flex min-w-0 flex-1 flex-col gap-1.5 rounded-block px-1 py-1";
        return (
          <li key={s.id} className="flex min-w-0 flex-1">
            {s.open ? (
              <Link data-seg to={`/p/${projectId}/${s.slug}`} aria-current={here ? "page" : undefined} title={s.what}
                className={cn(cell, "transition-colors hover:bg-surface2", FOCUS, here && "bg-surface2/60")}>{body}</Link>
            ) : (
              <span data-seg role="link" tabIndex={0} aria-disabled="true" title={s.reason ?? t("project.nav.notAvailableYet", "Not available yet")} className={cn(cell, "cursor-not-allowed", FOCUS)}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const ITEMS = "a[href]";

/** The desktop panel under "All steps": Escape and a click outside close it, the arrow keys move between the open steps. */
function StepsPopover({ anchor, id, onClose, children }: { anchor: RefObject<HTMLButtonElement>; id: string; onClose: (focusTrigger?: boolean) => void; children: ReactNode }) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const click = (e: MouseEvent) => { const t = e.target as Node; if (!anchor.current?.contains(t) && !panel.current?.contains(t)) closeRef.current(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeRef.current(true); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [anchor]);
  // The panel is placed in its own layout effect (it runs first), so the step being viewed can take focus here.
  useLayoutEffect(() => {
    const el = panel.current;
    (el?.querySelector<HTMLElement>('[aria-current="page"]') ?? el?.querySelector<HTMLElement>(ITEMS))?.focus();
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1]?.focus(); }
    else if (e.key === "Tab" && ((e.shiftKey && i <= 0) || (!e.shiftKey && i === items.length - 1))) { onClose(e.shiftKey); if (!e.shiftKey) e.preventDefault(); }
  };
  return (
    <Popover anchorRef={anchor} panelRef={panel} placement="bottom-end" onClose={() => onClose(false)} id={id} role="dialog" aria-label={t("project.nav.allSteps", "All steps")} onKeyDown={onKeyDown}
      className="scroll-thin w-[440px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-card bg-surface p-2 shadow-float ring-1 ring-line animate-rise">
      {children}
    </Popover>
  );
}

/** Every step: its status, what happens there and who works on it. Done and current steps open their page. */
function StepList({ projectId, journey, onPick, heading }: { projectId: string; journey: Journey; onPick: () => void; heading?: boolean }) {
  const t = useT();
  const nowLine = journey.now ? t("project.nav.stepOfNow", "Step {at} of {total} · {step}", { at: journey.at ?? 0, total: journey.total, step: journey.now.label }) : "";
  return (
    <div>
      {heading && (
        <div className="px-3 pb-2 pt-2">
          <p className="text-[15px] font-medium text-ink">{t("project.nav.journeyHeading", "Your project's journey")}</p>
          <p className="num mt-0.5 text-[13px] text-ink2">
            {journey.now ? nowLine : t("project.nav.stepsFromSetup", "{total} steps, from setup to release", { total: journey.total })}
          </p>
        </div>
      )}
      {!heading && journey.now && <p className="num mb-3 text-[13px] text-ink2">{nowLine}</p>}
      <ol className="flex flex-col gap-0.5">
        {journey.items.map((s) => <StepRow key={s.id} projectId={projectId} step={s} onPick={onPick} />)}
      </ol>
      <div className="mt-1 border-t border-line pt-1">
        <Link to={`/p/${projectId}/wiki`} onClick={onPick}
          className={cn("flex items-center gap-3 rounded-block px-3 py-2.5 text-[13px] text-ink2 transition-colors hover:bg-surface2 hover:text-ink", FOCUS)}>
          <BookOpen aria-hidden size={16} strokeWidth={1.75} className="shrink-0" />
          <span><span className="font-medium text-ink">{t("project.nav.wiki", "Wiki")}</span>{` · ${t("project.nav.wikiHint", "everything about the project, open at every step")}`}</span>
        </Link>
        <Link to={`/p/${projectId}/produced`} onClick={onPick}
          className={cn("flex items-center gap-3 rounded-block px-3 py-2.5 text-[13px] text-ink2 transition-colors hover:bg-surface2 hover:text-ink", FOCUS)}>
          <FolderOpen aria-hidden size={16} strokeWidth={1.75} className="shrink-0" />
          <span><span className="font-medium text-ink">{t("project.nav.produced", "What MADP produced")}</span>{` · ${t("project.nav.producedHint", "every file the agents saved, to open or download")}`}</span>
        </Link>
      </div>
    </div>
  );
}

function StepMark({ step }: { step: JourneyItem }) {
  return (
    <span aria-hidden className={cn("num grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium",
      step.status === "done" && "bg-success text-white dark:text-canvas",
      step.status === "now" && "bg-accent text-white ring-4 ring-accent/15",
      step.status === "next" && "bg-surface text-ink2 ring-1 ring-line",
      step.status === "locked" && "bg-surface2 text-ink3")}>
      {step.status === "done" ? <Check size={14} strokeWidth={2.5} /> : step.status === "locked" ? <Lock size={12} strokeWidth={2} /> : step.n}
    </span>
  );
}

const CHIP: Record<JourneyItem["status"], string> = {
  done: "bg-success-soft text-success",
  now: "bg-accent-soft text-accent",
  next: "bg-surface2 text-ink2",
  locked: "bg-surface2 text-ink3",
};

function StepRow({ projectId, step, onPick }: { projectId: string; step: JourneyItem; onPick: () => void }) {
  const t = useT();
  const body = (
    <>
      <StepMark step={step} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-[14px] font-medium", step.open ? "text-ink" : "text-ink2")}><span className="sr-only">{`${t("project.nav.stepN", "Step {n}:", { n: step.n })} `}</span>{step.label}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CHIP[step.status])}>{STATUS_TEXT[step.status]}</span>
          {step.viewing && <span className="text-[11px] font-medium text-ink3">{t("project.nav.youreHere", "You're here")}</span>}
        </span>
        <span className="text-[13px] leading-5 text-ink2">{step.what}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-ink3">
          <UserRound aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          {step.who}
        </span>
        {step.reason && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink3">
            <Lock aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
            {step.reason}
          </span>
        )}
      </span>
    </>
  );
  const row = "flex w-full items-start gap-3 rounded-block px-3 py-3 text-left";
  return (
    <li>
      {step.open ? (
        <Link to={`/p/${projectId}/${step.slug}`} onClick={onPick} aria-current={step.viewing ? "page" : undefined}
          className={cn(row, "transition-colors hover:bg-surface2 focus-visible:bg-surface2", FOCUS, step.viewing && "bg-surface2/60")}>
          {body}
        </Link>
      ) : (
        <div aria-disabled="true" className={cn(row, "cursor-default")}>{body}</div>
      )}
    </li>
  );
}

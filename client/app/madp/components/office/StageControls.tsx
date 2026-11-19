/** On-screen controls for the stage: zoom, reset view, a labels toggle and the role legend in the
 *  top-right corner, plus a first-visit hint that fades after the first interaction. Ported from MADP
 *  Studio; the legend lists the Factory's pipeline agents (with SecOps and Docs). */

import { RotateCcw, Tags, Users, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HUMAN_ROLE } from "./chat/persona";
import { balancedWidth } from "./dock";
import { NAME_IS_ROLE, legend } from "./roles";
import { VIEWS, viewLabel, type ViewId } from "./views";
import { useT } from "@/madp/i18n";

const HINT_KEY = "madp-factory:stage-hint-seen";
type HintState = "shown" | "leaving" | "hidden";

export function useStageHint(): { state: HintState; dismiss: () => void } {
  const [state, setState] = useState<HintState>(() => {
    try { return localStorage.getItem(HINT_KEY) === "1" ? "hidden" : "shown"; } catch { return "shown"; }
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = useCallback(() => {
    if (state !== "shown") return;
    setState("leaving");
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* blocked */ }
    timer.current = setTimeout(() => setState("hidden"), 500);
  }, [state]);
  return { state, dismiss };
}

const BTN = "inline-flex size-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-4";

/** a touch screen: the hint names touch gestures (read once; the pointer type does not change while the page is open) */
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

const Btn = forwardRef<HTMLButtonElement, { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; on?: boolean; expanded?: boolean; controls?: string }>(
  function Btn({ label, onClick, children, pressed, on, expanded, controls }, ref) {
    return (
      <button ref={ref} type="button" aria-label={label} title={label} aria-pressed={pressed} aria-expanded={expanded} aria-controls={controls} onClick={onClick} className={`${BTN} ${on ? "bg-white/30" : ""}`}>
        {children}
      </button>
    );
  },
);

export function StageControls({ onZoomIn, onZoomOut, onReset, labels, onToggleLabels, hint, view, onView, right = 0 }: {
  onZoomIn: () => void; onZoomOut: () => void; onReset: () => void; labels: boolean; onToggleLabels: () => void; hint: HintState;
  /** the camera preset in use (null once the person moved the camera) and the picker; keys 1-5 pick them too */
  view?: ViewId | null; onView?: (id: ViewId) => void;
  /** px a panel docked on the stage's right takes: the controls sit left of it (the camera views wrap if need be) */
  right?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const popId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const r = barRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  // the camera views that do not fit on one line beside a docked panel wrap into balanced lines, the group no wider than
  // its widest line (no empty glass beside a short last line); measured again when the space or a button's size changes
  const [viewsW, setViewsW] = useState<number | null>(null);
  const hasViews = Boolean(onView);
  useLayoutEffect(() => {
    const box = rootRef.current, group = viewsRef.current;
    if (!box || !group) return;
    const fit = () => {
      const cs = getComputedStyle(group);
      const ws = Array.from(group.children, (el) => el.getBoundingClientRect().width);
      setViewsW(balancedWidth(ws, parseFloat(cs.columnGap) || 0, parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), box.clientWidth));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    for (const el of Array.from(group.children)) ro.observe(el);
    return () => ro.disconnect();
  }, [hasViews]);

  const onEscape = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== "Escape") return;
    e.preventDefault();
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div ref={rootRef} data-stage-controls style={right > 0 ? { right } : undefined} className="pointer-events-none absolute left-5 right-5 top-5 z-30 flex flex-col items-end gap-2">
      <div ref={barRef} role="toolbar" aria-label={t("studio.office.controls.toolbar", "Office view")} onKeyDown={(e) => { if (open && e.key === "Escape") onEscape(e); }} className="glass-card pointer-events-auto flex items-center gap-1 rounded-full p-1">
        <Btn label={t("studio.office.controls.zoomIn", "Zoom in (+)")} onClick={onZoomIn}><ZoomIn aria-hidden strokeWidth={1.75} /></Btn>
        <Btn label={t("studio.office.controls.zoomOut", "Zoom out (-)")} onClick={onZoomOut}><ZoomOut aria-hidden strokeWidth={1.75} /></Btn>
        <Btn label={t("studio.office.controls.resetView", "Reset view (0)")} onClick={onReset}><RotateCcw aria-hidden strokeWidth={1.75} /></Btn>
        <Btn label={labels ? t("studio.office.controls.hideLabels", "Hide labels") : t("studio.office.controls.showLabels", "Show labels")} onClick={onToggleLabels} pressed={labels} on={labels}><Tags aria-hidden strokeWidth={1.75} /></Btn>
        <Btn ref={btnRef} label={t("studio.office.controls.roleLegend", "Role legend")} onClick={() => setOpen((v) => !v)} expanded={open} controls={open ? popId : undefined} on={open}><Users aria-hidden strokeWidth={1.75} /></Btn>
      </div>
      {onView && (
        <div ref={viewsRef} role="group" aria-label={t("studio.office.controls.cameraViews", "Camera views")} style={viewsW ? { width: viewsW } : undefined}
          className="glass-card pointer-events-auto hidden max-w-full flex-wrap items-center justify-center gap-0.5 rounded-[1.125rem] p-1 md:flex">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => onView(v.id)} aria-pressed={view === v.id} aria-keyshortcuts={v.key} title={`${viewLabel(v.id)} (${v.key})`}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${view === v.id ? "bg-white/30 text-white" : ""}`}>
              {viewLabel(v.id)}
            </button>
          ))}
        </div>
      )}
      {hint !== "hidden" && (
        <div role="status" className={`glass-card pointer-events-none hidden whitespace-nowrap rounded-block px-3 py-1.5 text-[12px] font-medium text-white/90 transition-opacity duration-500 sm:block ${hint === "leaving" ? "opacity-0" : ""}`}>
          {coarse ? t("studio.office.controls.hintTouch", "Drag to orbit · pinch to zoom")
            : t("studio.office.controls.hintPointer", "Drag to orbit · scroll to zoom · right-drag to pan · 1-5 views")}
        </div>
      )}
      {open && createPortal(
        <div className="factory-office">
          <div
            ref={popRef} id={popId} role="dialog" aria-label={t("studio.office.controls.roleLegend", "Role legend")}
            onPointerDown={(e) => e.stopPropagation()} onKeyDown={onEscape}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="glass-card z-50 w-[18rem] rounded-block bg-[rgb(14_15_19/0.72)] p-3 text-white"
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">{t("studio.office.legend.title", "MADP agents")}</h3>
            <ul className="mt-2 space-y-2">
              {legend().map((l) => (
                <li key={l.role} className="flex items-start gap-2">
                  <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: `rgb(var(--role-${l.role}))` }} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-[1.125rem]">{l.name}{!NAME_IS_ROLE.has(l.role) && <span className="font-normal text-white/70"> · {HUMAN_ROLE[l.role]}</span>}</span>
                    <span className="block text-[12px] text-white/75">{l.look} · {l.station}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-white/70">{t("studio.office.legend.explain", "The chest badge shows the role colour. Bubbles show what each agent is doing right now; a green sign marks a verified stage.")}</p>
            <p className="mt-2 text-[11px] text-white/70">{t("studio.office.legend.credit", "3D people: Quaternius (CC0)")}</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

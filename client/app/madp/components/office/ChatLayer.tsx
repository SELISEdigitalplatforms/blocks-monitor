/** ChatLayer: the chat of the selected agent, docked as a side panel on the stage's right (a bottom sheet on phones).
 *  The panel is as tall as its conversation, up to the stage's height (then the log scrolls), so a short talk leaves no
 *  empty band. The stage keeps its controls, labels and camera in the part left of the panel (dock.ts); the panel's tail
 *  points at the agent's head, measured in one rAF loop while open and written straight to style. */

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { StageState } from "@/madp/data/pipeline";
import { AgentChat } from "./chat/AgentChat";
import { DOCK_INSET, DOCK_W, useSheet } from "./dock";
import type { AgentView } from "./model";
import { useOfficeStage } from "./officeStore";

const TAIL = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function ChatLayer({ officeId, agents, stages, stage, compact = false, projectId }: {
  officeId: string; agents: AgentView[]; stages: StageState[]; stage: RefObject<HTMLElement>; compact?: boolean; projectId?: string | null;
}) {
  const sel = useOfficeStage((s) => s.selected);
  const agent = sel && sel.office === officeId ? agents.find((a) => a.id === sel.agent) : undefined;
  if (!agent) return null;
  return <ChatFrame key={agent.id} officeId={officeId} agent={agent} stages={stages} stage={stage} compact={compact} projectId={projectId} />;
}

function ChatFrame({ officeId, agent, stages, stage, compact, projectId }: { officeId: string; agent: AgentView; stages: StageState[]; stage: RefObject<HTMLElement>; compact: boolean; projectId?: string | null }) {
  const titleId = useId();
  const sheet = useSheet();
  const anchorEl = useOfficeStage((s) => (s.anchor && s.anchor.office === officeId ? s.anchor.el : null));
  const frameRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = () => useOfficeStage.getState().select(null);

  // remember the Team strip button that opened the chat: read while rendering, before the chat takes the focus;
  // give focus back on close
  const [from] = useState(() => {
    const active = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    return active && active.closest("[data-team-strip]") ? active : null;
  });
  useLayoutEffect(() => {
    opener.current = from;
    const strip = opener.current?.closest<HTMLElement>("[data-team-strip]") ?? null;
    return () => {
      const s = useOfficeStage.getState().selected;
      if (s && s.office === officeId) return; // switching to another agent
      const root = stage.current;
      let back: HTMLElement | null = opener.current && opener.current.isConnected ? opener.current : null;
      if (!back && strip) back = strip.isConnected ? strip.querySelector<HTMLElement>("button") : null;
      if (!back) back = root?.querySelector<HTMLElement>("[role=region]") ?? root;
      back?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the tail points at the agent's head while the head is beside the panel
  useEffect(() => {
    if (sheet || !anchorEl) return;
    let raf = 0;
    let last = NaN;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = frameRef.current, tail = tailRef.current;
      if (!f || !tail) return;
      const a = anchorEl.getBoundingClientRect();
      const r = f.getBoundingClientRect();
      const hy = a.top - r.top;
      const on = hy >= 0 && hy <= r.height && a.left < r.left;
      const top = on ? clamp(hy, 20, Math.max(20, r.height - 20)) - TAIL / 2 : -1;
      if (top === last) return;
      last = top;
      tail.style.display = on ? "" : "none";
      if (on) tail.style.top = `${top}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchorEl, sheet]);

  // the height the docked panel may grow to: the quick prompts lay out by it (not by the panel's own height)
  const [room, setRoom] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = stage.current;
    if (sheet || !el) { setRoom(undefined); return; }
    const on = () => setRoom(Math.max(0, el.clientHeight - 2 * DOCK_INSET));
    on();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet, stage]);

  // the docked panel tells its stage (the Team strip steps aside)
  useEffect(() => {
    if (sheet) return;
    useOfficeStage.getState().setDocked(officeId, true);
    return () => useOfficeStage.getState().setDocked(officeId, false);
  }, [sheet, officeId]);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  // no DOM event from the chat reaches the 3D scene (a keyboard click would count as a click on the empty floor)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const dialog = {
    role: "dialog", "aria-modal": false, "aria-labelledby": titleId, onKeyDown,
    onPointerDown: stop, onPointerUp: stop, onClick: stop, onDoubleClick: stop, onContextMenu: stop, onWheel: stop,
  } as const;

  // the sheet is portaled out of the stage: factory-office brings the role colours and the typing animation along
  if (sheet) {
    return createPortal(
      <div ref={frameRef} {...dialog}
        className="factory-office pointer-events-auto fixed inset-x-0 bottom-0 z-[90] flex max-h-[75dvh] flex-col overflow-hidden rounded-t-card bg-surface text-ink shadow-float ring-1 ring-line">
        <AgentChat officeId={officeId} agent={agent} stages={stages} titleId={titleId} onClose={close} layout="sheet" projectId={projectId} />
      </div>,
      document.body,
    );
  }

  // data-stage-obstacle: the stage's labels and signs keep clear of the panel (glass.ts)
  return (
    <div ref={frameRef} {...dialog} data-stage-obstacle=""
      style={{ top: DOCK_INSET, right: DOCK_INSET, maxHeight: `calc(100% - ${2 * DOCK_INSET}px)`, width: DOCK_W[compact ? "compact" : "full"], maxWidth: `calc(100% - ${2 * DOCK_INSET}px)` }}
      className="pointer-events-auto absolute z-30 flex flex-col text-ink">
      {anchorEl && (
        <span ref={tailRef} aria-hidden="true" style={{ display: "none" }}
          className="pointer-events-none absolute -left-1.5 h-3 w-3 rotate-45 bg-surface shadow-card dark:ring-1 dark:ring-line" />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-float dark:ring-1 dark:ring-line">
        <AgentChat officeId={officeId} agent={agent} stages={stages} titleId={titleId} onClose={close} layout="docked" projectId={projectId} room={room} />
      </div>
    </div>
  );
}

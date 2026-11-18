import { useLayoutEffect, useRef, type RefObject } from "react";
import { reducedMotion } from "@/madp/components/intake/IntakeShared";

/** FLIP for the ticket cards: when a ticket's stored column changed since the last read, glide it from its old
 *  place to the new one and flash an accent ring. Filter changes (the visible set changes) are not animated. */
export function useFlip(container: RefObject<HTMLElement>, columns: Record<string, string>, filterKey: string) {
  const rects = useRef(new Map<string, DOMRect>());
  const prevCols = useRef<Record<string, string>>({});
  const prevFilter = useRef(filterKey);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-ticket-id]"));
    const next = new Map<string, DOMRect>();
    const filtered = prevFilter.current !== filterKey;
    for (const el of els) {
      const id = el.dataset.ticketId as string;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const old = rects.current.get(id);
      if (filtered || reducedMotion() || !old || prevCols.current[id] === undefined || prevCols.current[id] === columns[id]) continue;
      const dx = old.left - rect.left, dy = old.top - rect.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" });
      el.animate([{ boxShadow: "0 0 0 2px rgb(var(--c-accent))" }, { boxShadow: "0 0 0 2px rgb(var(--c-accent) / 0)" }], { duration: 1200, easing: "ease-out" });
    }
    rects.current = next;
    prevCols.current = { ...columns };
    prevFilter.current = filterKey;
  });
}

import { useLayoutEffect, useRef, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "bottom-start" | "bottom-end";
type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

const MARGIN = 8;

/** Where a panel goes: under the anchor, flipped above it when there is no room below, shifted (or its alignment
 *  switched) when it would leave the viewport sideways, with a max-height of the room that is left. All in viewport px. */
export function computePlacement(
  anchor: Rect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  { placement = "bottom-start", offset = 8, margin = MARGIN }: { placement?: PopoverPlacement; offset?: number; margin?: number } = {},
) {
  const below = viewport.height - margin - anchor.bottom - offset;
  const above = anchor.top - offset - margin;
  const up = panel.height > below && above > below;
  const maxHeight = Math.max(0, up ? above : below);
  const height = Math.min(panel.height, maxHeight);
  const top = up ? anchor.top - offset - height : anchor.bottom + offset;

  const fits = (l: number) => l >= margin && l + panel.width <= viewport.width - margin;
  const start = anchor.left, end = anchor.right - panel.width;
  let align: "start" | "end" = placement === "bottom-end" ? "end" : "start";
  let left = align === "end" ? end : start;
  if (!fits(left) && fits(align === "end" ? start : end)) { align = align === "end" ? "start" : "end"; left = align === "end" ? end : start; }
  left = Math.max(margin, Math.min(left, viewport.width - margin - panel.width));
  return { top, left, maxHeight, up, align };
}

/** The inline max-height: the panel's own CSS cap (Infinity for none), or the room there is when that is smaller. */
export function resolveMaxHeight(cap: number, space: number) {
  return Math.min(cap, space);
}

function parseCap(css: string) {
  const n = parseFloat(css);
  return css.endsWith("px") && Number.isFinite(n) ? n : Infinity;
}

/** False once the anchor is fully outside the viewport or outside a scrolling / overflow-hidden ancestor. */
export function anchorVisible(anchor: HTMLElement) {
  let r = anchor.getBoundingClientRect();
  let { top, left, right, bottom } = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = anchor.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    r = p.getBoundingClientRect();
    top = Math.max(top, r.top); left = Math.max(left, r.left); right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom);
  }
  r = anchor.getBoundingClientRect();
  return r.bottom > top && r.top < bottom && r.right > left && r.left < right;
}

/* ── the panel's own scroll ───────────────────────────────────────────────── */

/** True when a scroll can have moved the anchor: the page scrolled, or a container that holds the anchor did. A scroll
 *  inside the panel itself (a wheel, a trackpad, a swipe, PageDown, focus moving down a long list) or in a container
 *  beside the anchor leaves the anchor where it is, so the panel stays as it is. */
export function scrollMovesAnchor(target: EventTarget | null, anchor: Node): boolean {
  const node = target as Partial<Node> | null;
  return typeof node?.contains === "function" ? node.contains(anchor) : true;
}

type View = Pick<Window, "innerWidth" | "innerHeight" | "getComputedStyle">;
type PlaceOptions = { placement?: PopoverPlacement; offset?: number; mobileSheet?: boolean };

/** Places a fixed panel at its anchor, straight on its style. It measures the panel at its natural height (no inline
 *  max-height), which clamps a scrolled panel's scrollTop to 0 in that layout: where the user had scrolled to is put back
 *  once the max-height is set again. */
export function placePanel(el: HTMLElement, anchor: HTMLElement, { placement, offset, mobileSheet }: PlaceOptions = {}, view: View = window) {
  const scrolled = el.scrollTop;
  const sheet = mobileSheet && view.innerWidth < 640;
  el.style.maxHeight = "";
  el.style.width = sheet ? `${view.innerWidth - 2 * MARGIN * 2}px` : "";
  const css = view.getComputedStyle(el);
  const cap = parseCap(css.maxHeight);
  if (css.overflowY === "visible") el.style.overflowY = "auto";
  const r = anchor.getBoundingClientRect();
  const p = computePlacement(r, { width: el.offsetWidth, height: el.offsetHeight }, { width: view.innerWidth, height: view.innerHeight }, { placement, offset });
  el.style.top = `${p.top}px`;
  el.style.left = sheet ? `${MARGIN * 2}px` : `${p.left}px`;
  el.style.maxHeight = `${resolveMaxHeight(cap, p.maxHeight)}px`;
  if (el.scrollTop !== scrolled) el.scrollTop = scrolled;
}

type Events = Pick<Window, "addEventListener" | "removeEventListener">;

/** Keeps a placed panel with its anchor: placed again when the window resizes or a scroll moves the anchor, and closed
 *  once the anchor is out of view. Scrolls inside the panel are its own (see scrollMovesAnchor). Returns the cleanup. */
export function followAnchor(anchor: () => HTMLElement | null, place: () => void, close: () => void,
  { events = window as Events, visible = anchorVisible }: { events?: Events; visible?: (a: HTMLElement) => boolean } = {}) {
  const again = (e: Event) => {
    const a = anchor();
    if (a && e.type === "scroll" && !scrollMovesAnchor(e.target, a)) return;
    if (a && !visible(a)) { close(); return; }
    place();
  };
  events.addEventListener("scroll", again, true);
  events.addEventListener("resize", again);
  return () => { events.removeEventListener("scroll", again, true); events.removeEventListener("resize", again); };
}

/* ── the keyboard in a long panel ─────────────────────────────────────────── */

/** The rows that take focus in a menu panel. */
export const FOCUS_ITEMS = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/** How many rows PageDown / PageUp move: a panel's height of them, less one so the last row stays in sight (10 before
 *  the panel has a layout). */
export function itemsPerView(view: { clientHeight: number }, item?: { offsetHeight: number } | null, fallback = 10) {
  const h = item?.offsetHeight ?? 0;
  return h > 0 && view.clientHeight > 0 ? Math.max(1, Math.floor(view.clientHeight / h) - 1) : fallback;
}

/** The row a page away from `i` in direction `dir`, held at the first and the last row. */
export function pageIndex(i: number, count: number, dir: 1 | -1, perPage: number) {
  return Math.max(0, Math.min(count - 1, i + dir * Math.max(1, perPage)));
}

const usable = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";

/** PageDown / PageUp on a focused menu row move focus a page of rows down / up (the row is then scrolled into view).
 *  True when it handled the key; anything else (focus in a field, no rows) keeps the browser's own PageDown. */
export function pageThroughItems(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault">,
  panel: Pick<HTMLElement, "querySelectorAll" | "clientHeight">, active: Element | null = document.activeElement): boolean {
  if ((e.key !== "PageDown" && e.key !== "PageUp") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUS_ITEMS)].filter(usable);
  const i = items.indexOf(active as HTMLElement);
  if (i < 0) return false;
  e.preventDefault();
  items[pageIndex(i, items.length, e.key === "PageDown" ? 1 : -1, itemsPerView(panel, items[i]))].focus();
  return true;
}

type Box = { top: number; bottom: number };

/** The scrollTop that shows `item` whole inside `view` (its padding kept clear, so a focus ring is not cut), moving as
 *  little as possible; a row taller than the view is shown from its top. */
export function revealTop(scrollTop: number, view: Box, item: Box, pad = 0) {
  const top = view.top + pad, bottom = view.bottom - pad;
  if (item.top < top || item.bottom - item.top > bottom - top) return scrollTop + item.top - top;
  if (item.bottom > bottom) return scrollTop + item.bottom - bottom;
  return scrollTop;
}

/** Scrolls a scrolling panel just enough to show its focused row whole. */
export function revealItem(panel: HTMLElement, item: HTMLElement, view: Pick<Window, "getComputedStyle"> = window) {
  if (item === panel || !panel.contains(item) || panel.scrollHeight <= panel.clientHeight) return;
  const pad = parseFloat(view.getComputedStyle(panel).paddingTop) || 0;
  const next = revealTop(panel.scrollTop, panel.getBoundingClientRect(), item.getBoundingClientRect(), pad);
  if (next !== panel.scrollTop) panel.scrollTop = next;
}

/* ── the panel ────────────────────────────────────────────────────────────── */

type PanelProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  placement?: PopoverPlacement;
  offset?: number;
  /** below sm the panel spans the viewport with 16 px gutters */
  mobileSheet?: boolean;
  /** called when the anchor scrolls fully out of view */
  onClose?: () => void;
  children?: ReactNode;
};

/** The panel itself. It is placed in a layout effect, straight on its style, in the commit that mounts it: it is never
 *  hidden, so a consumer can focus an item in its own layout effect. A panel taller than the room scrolls on its own
 *  (wheel, trackpad, touch, PageDown / PageUp, focus) without the page behind it scrolling along. */
export function PopoverPanel({ anchorRef, panelRef, placement, offset, mobileSheet, onClose, style, children, onKeyDown, onFocus, ...rest }: PanelProps) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? own;
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current, a = anchorRef.current;
      if (el && a) placePanel(el, a, { placement, offset, mobileSheet });
    };
    place();
    return followAnchor(() => anchorRef.current, place, () => close.current?.());
  }, [anchorRef, ref, placement, offset, mobileSheet]);

  // the consumer's own keys first (arrows, Home / End, Escape); PageDown / PageUp page through the rows unless it took them
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (!e.defaultPrevented && ref.current) pageThroughItems(e, ref.current);
  };
  const focus = (e: FocusEvent<HTMLDivElement>) => {
    onFocus?.(e);
    if (ref.current && e.target instanceof HTMLElement) revealItem(ref.current, e.target);
  };

  return (
    <div ref={ref} style={{ position: "fixed", zIndex: 70, overscrollBehavior: "contain", ...style }} onKeyDown={keyDown} onFocus={focus} {...rest}>
      {children}
    </div>
  );
}

/** A menu / list panel rendered in a portal on document.body with position: fixed, so no container can clip it. */
export function Popover(props: PanelProps) {
  return createPortal(<PopoverPanel {...props} />, document.body);
}

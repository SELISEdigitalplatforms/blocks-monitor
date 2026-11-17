/** Motion for the landing page, without a library: one shared IntersectionObserver for every reveal, a
 *  reduced-motion hook, an in-view hook (to pause animation off screen) and a count-up for the real numbers. */
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";

const REDUCED = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED).matches;
}

/** true when the person prefers reduced motion; follows changes */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* Every reveal on the page shares one observer, and nothing is ever left hidden:
   - the observer's root reaches far above the viewport, so whatever is already above the fold counts as seen: a section
     scrolled past, jumped over (the End key, a link with reduced motion, a dragged scroll bar) or above a restored scroll
     position. What is revealed out of sight appears at once, with no animation nobody would see;
   - a slow sweep backs the observer up and reveals anything in or above the viewport that it has not reported;
   - without IntersectionObserver everything is visible from the first paint. */
const hasObserver = () => typeof window !== "undefined" && typeof IntersectionObserver !== "undefined";
/* below the fold, an element reveals once it is this far up the viewport (the observer's -4%): late enough that the
   motion is seen, early enough that the bottom of the window never holds a band of not-yet-shown content */
const TRIGGER = 0.96;
let shared: IntersectionObserver | null = null;
const pending = new Map<Element, (instant: boolean) => void>();
let sweepTimer = 0;

function reveal(el: Element, instant: boolean) {
  const done = pending.get(el);
  if (!done) return;
  pending.delete(el);
  shared?.unobserve(el);
  done(instant);
}

function sweep() {
  if (document.visibilityState !== "hidden") {
    const line = window.innerHeight * TRIGGER;
    for (const el of [...pending.keys()]) {
      const r = el.getBoundingClientRect();
      if (r.top < line) reveal(el, r.bottom <= 0);
    }
  }
  if (!pending.size) { window.clearInterval(sweepTimer); sweepTimer = 0; }
}

function revealObserver(): IntersectionObserver | null {
  if (shared || !hasObserver()) return shared;
  shared = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) reveal(e.target, e.boundingClientRect.bottom <= 0);
  }, { rootMargin: "100000px 0px -4% 0px", threshold: 0.08 });
  return shared;
}

/** becomes true (once) when the element first scrolls into view, or is found already above it. The second flag says it
 *  was revealed out of sight, so it should simply be there rather than animate in. */
export function useRevealed<T extends Element>(): [RefObject<T>, boolean, boolean] {
  const ref = useRef<T>(null);
  const [state, setState] = useState<"hidden" | "shown" | "instant">(() => (hasObserver() ? "hidden" : "instant"));
  useEffect(() => {
    const el = ref.current;
    const io = revealObserver();
    if (!el || !io) { setState((s) => (s === "hidden" ? "instant" : s)); return; }
    pending.set(el, (instant) => setState(instant ? "instant" : "shown"));
    io.observe(el);
    if (!sweepTimer) sweepTimer = window.setInterval(sweep, 800);
    return () => { pending.delete(el); io.unobserve(el); };
  }, []);
  return [ref, state !== "hidden", state === "instant"];
}

/** fades and lifts its children in when they scroll into view; `delay` staggers siblings (ms) */
export function Reveal({ as, delay = 0, className, style, children, id }: {
  as?: ElementType; delay?: number; className?: string; style?: CSSProperties; children?: ReactNode; id?: string;
}) {
  const Tag = (as ?? "div") as ElementType;
  const [ref, shown, instant] = useRevealed<HTMLElement>();
  return (
    <Tag ref={ref} id={id} data-shown={shown} data-instant={instant || undefined} className={cn("lp-reveal", className)}
      style={{ ...style, ["--lp-d" as string]: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** true while the element is on screen (with a margin); used to pause animation loops */
export function useInView<T extends Element>(rootMargin = "120px 0px"): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView];
}

/** true while the tab is visible */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** a number that counts up once when it scrolls into view. The final value reserves the width (no layout
 *  shift) and is what screen readers hear. */
export function CountUp({ value, decimals = 0, duration = 1500, className }: { value: number; decimals?: number; duration?: number; className?: string }) {
  const [wrap, shown, instant] = useRevealed<HTMLSpanElement>();
  const out = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => n.toFixed(decimals);
  useEffect(() => {
    const el = out.current;
    if (!shown || !el) return;
    if (instant || prefersReducedMotion()) { el.textContent = fmt(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      el.textContent = fmt(value * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, instant, value, decimals, duration]);
  return (
    <span ref={wrap} className={cn("num relative inline-block", className)}>
      <span className="invisible" aria-hidden>{fmt(value)}</span>
      <span ref={out} className="absolute inset-0 text-right" aria-hidden>{fmt(0)}</span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  );
}

/** smooth-scroll to a section (instant when the person prefers reduced motion) */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/** back to the top of the page, with keyboard focus too, so the next Tab starts from the top again */
export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  document.getElementById("top")?.focus({ preventScroll: true });
}

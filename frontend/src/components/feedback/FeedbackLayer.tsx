import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Drawer } from '@/ui/kit';
import { FeedbackCard } from '@/components/feedback/FeedbackCard';
import { closeFeedback, feedbackButtonSelector, feedbackItemSelector, useFeedbackUi } from '@/components/feedback/feedbackUi';
import { targetKey } from '@/data/feedback';

const QUERY = '(min-width: 1280px)';
/** The card's distance to the window's edges. */
const EDGE = 12;

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** The one open feedback card: floating beside the item on wide screens, a bottom sheet on narrow ones. */
export function FeedbackLayer({ width = 360 }: { width?: number }) {
  const open = useFeedbackUi((s) => s.open);
  const wide = useWide();
  const titleId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [caret, setCaret] = useState<number | null>(null);
  const key = open ? targetKey(open.type, open.id) : null;
  const floating = !!open && wide;

  useEffect(() => () => closeFeedback({ refocus: false }), []);

  useLayoutEffect(() => {
    if (!floating || !key) return;
    // The layer covers the viewport (fixed): the card sits beside its item and always stays fully on screen, so its
    // text box is never cut off, however far down the page the item is; it follows the item while the page scrolls.
    const place = () => {
      const c = card.current;
      const anchor = document.querySelector(feedbackItemSelector(key));
      if (!c) return;
      if (!anchor || anchor.getClientRects().length === 0) { closeFeedback({ refocus: false }); return; }
      const a = anchor.getBoundingClientRect();
      const max = Math.max(EDGE, window.innerHeight - c.getBoundingClientRect().height - EDGE);
      const next = Math.min(Math.max(EDGE, a.top - 4), max);
      setTop(next);
      const b = anchor.querySelector(feedbackButtonSelector(key));
      const mid = b && b.getClientRects().length > 0 ? b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2 - next - 6 : null;
      // the caret points at the item's button while the button is beside the card
      setCaret(mid !== null && mid >= 8 && mid <= c.getBoundingClientRect().height - 20 ? Math.min(Math.max(14, mid), 40) : null);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true, capture: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) {
      if (layer.current) ro.observe(layer.current);
      if (card.current) ro.observe(card.current);
      const a = document.querySelector(feedbackItemSelector(key));
      if (a) ro.observe(a);
    }
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, { capture: true }); ro?.disconnect(); };
  }, [floating, key]);

  useEffect(() => {
    if (!floating || !key) return;
    card.current?.querySelector<HTMLElement>('[data-feedback-composer]')?.focus({ preventScroll: true });
  }, [floating, key]);

  useEffect(() => {
    if (!floating) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || card.current?.contains(t) || t.closest('[data-feedback-button]')) return;
      closeFeedback({ refocus: false });
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [floating]);

  if (!open) return null;

  if (!wide) {
    return (
      <Drawer side="bottom" open onClose={() => closeFeedback()} title={<span className="line-clamp-2">{open.title}</span>}>
        <FeedbackCard variant="sheet" target={open} titleId={titleId} onClose={() => closeFeedback()} />
      </Drawer>
    );
  }

  return (
    <div ref={layer} className="pointer-events-none fixed inset-0 z-30">
      <div ref={card} role="dialog" aria-modal="false" aria-labelledby={titleId} style={{ top, width }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || card.current?.querySelector("[role='menu']")) return;
          e.stopPropagation();
          closeFeedback();
        }}
        className="pointer-events-auto absolute right-4 max-w-[calc(100%-32px)] rounded-card bg-surface shadow-[0_24px_60px_-16px_rgb(10_12_20/0.4),0_18px_48px_-12px_rgb(var(--c-accent)/0.35)] ring-1 ring-accent/40 animate-rise transition-[top] duration-200 motion-reduce:animate-none motion-reduce:transition-none dark:ring-accent/60">
        {caret !== null && <span aria-hidden="true" className="absolute -left-1.5 h-3 w-3 rotate-45 rounded-[2px] bg-accent" style={{ top: caret }} />}
        <FeedbackCard variant="float" target={open} titleId={titleId} onClose={() => closeFeedback()} />
      </div>
    </div>
  );
}

/** The frame of the small guided windows the Project setup page opens (sharing material and document review):
 *  the same look as the guided project start, one question per step, the shimmer
 *  progress bar, Back / Continue at the bottom and Enter to continue. The window owns focus
 *  while open (Tab stays inside, Escape closes, focus returns to the opener) and the page behind does not scroll. */
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CornerDownLeft, X } from "lucide-react";
import { Button, useBackdropDismiss } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { KBD } from "@/madp/components/intake/IntakeShared";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SetupWindowProps {
  /** The window's name in the status line ("Share what you already have"). */
  name: string;
  /** The step titles, in order; the bar has one segment per step. */
  steps: readonly string[];
  /** The current step, 0-based. */
  step: number;
  /** 1 = moving forward, -1 = going back (the transition's direction). */
  dir?: 1 | -1;
  headingId: string;
  /** The form element (Enter in it continues). */
  formRef: RefObject<HTMLFormElement | null>;
  onClose: () => void;
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  busy?: boolean;
  /** Shown left in the footer on the first step (instead of Back). */
  footerNote?: ReactNode;
  /** A secondary action next to the primary one ("Skip for now"). */
  secondary?: ReactNode;
  /** A layer over the window (a "Leave?" question); the window behind is out of reach while it shows. */
  overlay?: ReactNode;
  children: ReactNode;
}

/** After a failed Continue: the first field with an error; otherwise the step's first field, else its heading. */
export function focusStep(root: HTMLElement | null, headingId: string, invalidOnly = false) {
  if (!root) return;
  const target = invalidOnly
    ? root.querySelector<HTMLElement>('[aria-invalid="true"]')
    : root.querySelector<HTMLElement>("[data-step-focus]")
      ?? root.querySelector<HTMLElement>('[role="radiogroup"] input:checked');
  (target ?? document.getElementById(headingId))?.focus({ preventScroll: !invalidOnly });
}

export function SetupWindow({
  name, steps, step, dir = 1, headingId, formRef, onClose, onBack, onNext, nextLabel, nextDisabled, busy, footerNote, secondary, overlay, children,
}: SetupWindowProps) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const total = steps.length;
  const title = steps[step] ?? "";
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const nextRef = useRef(onNext);
  nextRef.current = onNext;

  // focus inside, Tab stays inside, no page scroll, focus back to the opener
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const body = document.body.style;
    const before = { overflow: body.overflow, paddingRight: body.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (gutter > 0) body.paddingRight = `${gutter}px`;
    const onKey = (e: KeyboardEvent) => {
      const box = panel.current;
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      body.overflow = before.overflow;
      body.paddingRight = before.paddingRight;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => { content.current?.toggleAttribute("inert", Boolean(overlay)); }, [overlay]);

  // each step starts at its top with its first question focused
  useLayoutEffect(() => {
    formRef.current?.scrollTo({ top: 0 });
    focusStep(formRef.current, headingId);
  }, [step, headingId, formRef]);

  // Enter continues (Shift+Enter: a new line); buttons, menus and list inputs keep their own Enter
  const onKeyDown = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing || e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute("role") === "combobox") return;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "file")) return;
    if (el.closest("[data-enter-own]")) return;
    e.preventDefault();
    if (!nextDisabled && !busy) nextRef.current();
  };

  const scrim = useBackdropDismiss(onClose);
  const valueText = t("shell.home.stepOfNamed", "Step {step} of {total}: {name}", { step: step + 1, total, name: title });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgb(var(--c-scrim)/0.32)] backdrop-blur-[3px] sm:items-center sm:p-6 dark:bg-[rgb(var(--c-scrim)/0.62)]" {...scrim}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={statusId} onClick={(e) => e.stopPropagation()}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-float animate-rise sm:h-[min(720px,calc(100dvh-48px))] sm:max-w-[880px] sm:rounded-card dark:ring-1 dark:ring-line">
        <div ref={content} className="flex min-h-0 flex-1 flex-col">
          <ShimmerProgress step={step + 1} total={total} label={t("shell.setup.window.progress", "{name} progress", { name })} valueText={valueText} className="rounded-none" />
          <header className="flex items-center gap-3 px-5 pt-4 sm:px-8 sm:pt-5">
            <p id={statusId} aria-live="polite" className="min-w-0 flex-1 truncate text-[13px] text-ink3">
              <span className="font-medium text-ink">{name}</span>
              {total > 1 && <> · {t("shell.progress.stepOf", "Step {step} of {total}", { step: step + 1, total })}<span className="hidden sm:inline"> · {title}</span></>}
            </p>
            <button type="button" aria-label={t("common.actions.close", "Close")} onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 transition hover:bg-line hover:text-ink"><X size={16} /></button>
          </header>
          <form ref={formRef} noValidate aria-labelledby={headingId} onSubmit={(e) => { e.preventDefault(); if (!nextDisabled && !busy) onNext(); }} onKeyDown={onKeyDown}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-10 sm:pt-8">
            <div key={step} className={dir === 1 ? "guided-in-forward" : "guided-in-back"}>{children}</div>
          </form>
          <footer className="flex items-center gap-3 border-t border-line bg-surface px-5 py-4 sm:px-8">
            {step > 0 && onBack
              ? <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden />} onClick={onBack} disabled={busy}>{t("common.actions.back", "Back")}</Button>
              : footerNote ? <span className="text-[13px] text-ink3 max-sm:hidden">{footerNote}</span> : null}
            <p className="ml-auto hidden items-center gap-1.5 text-[13px] text-ink3 md:flex" aria-hidden>
              {t("shell.guided.press", "Press")} <kbd className={KBD}>{t("shell.guided.enterKey", "Enter")} <CornerDownLeft size={11} className="inline" /></kbd>
            </p>
            {secondary}
            <Button variant="primary" size="lg" className="min-w-[160px] max-md:ml-auto" onClick={onNext}
              disabled={nextDisabled || busy} aria-busy={busy || undefined}
              iconRight={busy ? undefined : <ArrowRight size={16} strokeWidth={2} aria-hidden />}>
              {nextLabel}
            </Button>
          </footer>
        </div>
        {overlay}
      </div>
    </div>,
    document.body,
  );
}

/** A soft tile with a large icon and a small badge icon (the guided start's illustration). */
export function Illustration({ icon, badge, tone = "accent" }: { icon: ReactNode; badge?: ReactNode; tone?: "accent" | "success" | "warning" }) {
  const tile = tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent";
  return (
    <span aria-hidden className={cn("relative grid h-16 w-16 shrink-0 place-items-center rounded-[20px]", tile)}>
      {icon}
      {badge && <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full bg-surface text-ink shadow-card ring-4 ring-surface">{badge}</span>}
    </span>
  );
}

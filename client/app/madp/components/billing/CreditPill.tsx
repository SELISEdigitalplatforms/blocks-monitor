/** The top bar's credit pill, in the account button's shape: what is left of the workspace's credit ("USD 37.60 left")
 *  over one meta line (the plan and when it renews, or "Low credit" / "Out of credit"). Hover (after a short intent
 *  delay) or focus opens the details; a click pins them open; Escape, a click outside or leaving with Tab closes them.
 *  The details grow out of the pill: the panel starts clipped to the pill's own shape and its surface pours down into
 *  the full card (a clip-path morph with a soft spring), the content fading in once the shape is there; closing runs it
 *  back into the pill. With reduced motion it simply fades. Nothing shows without a workspace or when billing is not
 *  available; below sm the account menu carries the credit line instead. */
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type ReactNode, type Ref } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ChevronDown, Wallet } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { cn } from "@/madp/lib/cn";
import { getCulture, t, useT } from "@/madp/i18n";
import { Bar, Dot } from "@/madp/ui/kit";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { usePlatformAccess } from "@/madp/blocks/admin";
import { adminMounted } from "@/madp/blocks/config";
import { hasPlatformAccess } from "@/madp/blocks/guard";
import { useBillingSummary } from "./billingData";
import { ChangePlanDialog } from "./PlanCards";
import type { BillingSummary } from "./types";
import {
  agentsText, assistedText, creditNotice, jobsText, creditState, leftUsd, pendingText, planName, renewsText, streamsText, tokensText, usd, usedOf, usedShare,
  type CreditState,
} from "./usageText";

/* ── what the pill says ──────────────────────────────────────────────────── */

/** "1 Dec" (UTC, like the renewal date everywhere else), or null. */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return getCulture() === "de-CH"
    ? d.toLocaleDateString("de-CH", { day: "numeric", month: "short", timeZone: "UTC" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The pill's two lines and its spoken label. */
export function creditPillView(s: BillingSummary): { state: CreditState; figure: string; meta: string; label: string } {
  const state = creditState(s);
  const figure = state === "out" ? t("billing.creditPill.outOfCredit", "Out of credit") : t("billing.creditPill.left", "{amount} left", { amount: usd(leftUsd(s)) });
  const resets = shortDate(s.renewsAt);
  const meta = state === "out" ? t("billing.creditPill.addCredit", "Add credit to continue")
    : state === "low" ? t("billing.creditPill.lowCredit", "Low credit")
    : !s.plan ? t("billing.creditPill.noPlan", "No plan yet")
    : resets ? t("billing.creditPill.planResets", "{plan} · resets {date}", { plan: s.plan.name, date: resets }) : planName(s.plan.name);
  return { state, figure, meta, label: t("billing.creditPill.label", "Credit: {figure}, {meta}. Show credit details", { figure, meta }) };
}

/** When the next credit comes: the subscription's renewal date, else that the plan does not renew. */
export function renewalLine(s: BillingSummary): string {
  return renewsText(s.renewsAt) ?? t("billing.creditPill.noRenewal", "{plan} · no renewal", { plan: s.plan ? planName(s.plan.name) : t("billing.creditPill.noPlan", "No plan yet") });
}

/** What the pill shows for the summary read: nothing without a workspace or when billing fails or is missing (never an
 *  error in the top bar), a placeholder while it loads, else the pill. */
export function creditPillMode(hasWorkspace: boolean, q: Pick<UseQueryResult<BillingSummary>, "data" | "isError" | "isPending">): "hidden" | "loading" | "ready" {
  if (!hasWorkspace) return "hidden";
  if (q.data) return "ready";
  if (q.isError) return "hidden";
  return q.isPending ? "loading" : "hidden";
}

/* ── open, pinned, closed ────────────────────────────────────────────────── */

export type PanelState = { open: boolean; pinned: boolean };
/** hover: the pointer rested on the pill; leave: it left pill and panel; focus: the pill took focus; click: the pill was
 *  pressed; escape / outside / blur (focus left with Tab) / away (the page changed): close. */
export type PanelEvent = "hover" | "leave" | "focus" | "click" | "escape" | "outside" | "blur" | "away";
export const CLOSED: PanelState = { open: false, pinned: false };

/** Hover and focus open the details; a click pins them (a second click closes them); leaving closes them unless they
 *  are pinned; Escape, a click outside, Tab away or another page always close them. */
export function creditPanelReducer(s: PanelState, e: PanelEvent): PanelState {
  switch (e) {
    case "hover":
    case "focus": return s.open ? s : { open: true, pinned: false };
    case "leave": return s.pinned ? s : CLOSED;
    case "click": return s.open && s.pinned ? CLOSED : { open: true, pinned: true };
    default: return s.open ? CLOSED : s;
  }
}

/** The pointer rests this long on the pill before the details open, and may leave this long before they close. */
export const HOVER_OPEN_MS = 140;
export const HOVER_CLOSE_MS = 220;
/** The closing shape's length (index.css: credit-liquid-out), the unmount fallback when no animationend comes. */
export const CLOSE_MS = 240;

/** The classes of the panel's surface and content for a phase: the liquid morph, or a plain fade with reduced motion. */
export function panelMotion(phase: "in" | "out", reduced: boolean): { surface: string; content: string } {
  if (reduced) return { surface: phase === "in" ? "credit-fade-in" : "credit-fade-out", content: "" };
  return phase === "in"
    ? { surface: "credit-liquid-in", content: "credit-content-in" }
    : { surface: "credit-liquid-out", content: "credit-content-out" };
}

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ── the pill ────────────────────────────────────────────────────────────── */

const PILL = "relative z-[41] flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-full bg-surface p-[5px] text-left transition sm:pr-4 dark:ring-1 dark:ring-line";

const ICON_TONE: Record<CreditState, string> = {
  ok: "bg-surface2 text-ink2",
  low: "bg-warning-soft text-[rgb(var(--c-warning-text))]",
  out: "bg-danger-soft text-[rgb(var(--c-danger-text))]",
};

/** The placeholder while the summary loads: the pill's shape, nothing invented. */
export function CreditPillSkeleton() {
  const t = useT();
  return (
    <div className={cn(PILL, "pointer-events-none")} aria-busy="true">
      <span aria-hidden="true" className="h-[38px] w-[38px] shrink-0 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
      <span aria-hidden="true" className="hidden w-24 space-y-1.5 sm:block">
        <span className="block h-3 w-20 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
        <span className="hidden h-2.5 w-24 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none lg:block" />
      </span>
      <span className="sr-only">{t("billing.creditPill.loading", "Loading your credit")}</span>
    </div>
  );
}

export function CreditPillButton({ summary, open = false, panelId, buttonRef, onClick, onFocus }: {
  summary: BillingSummary; open?: boolean; panelId?: string; buttonRef?: Ref<HTMLButtonElement>; onClick?: () => void; onFocus?: () => void;
}) {
  useT();
  const v = creditPillView(summary);
  return (
    <button ref={buttonRef} type="button" onClick={onClick} onFocus={onFocus} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      aria-label={v.label} data-credit={v.state}
      className={cn(PILL, "group outline-none focus-visible:ring-2 focus-visible:ring-accent/50", open ? "dark:ring-transparent" : "hover:bg-line")}>
      <span aria-hidden="true" className={cn("grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full", ICON_TONE[v.state])}>
        <Wallet size={18} strokeWidth={1.75} />
      </span>
      <span className="hidden min-w-0 leading-tight sm:block">
        <span className={cn("num block whitespace-nowrap text-[14px] font-medium", v.state === "out" ? "text-[rgb(var(--c-danger-text))]" : "text-ink")}>{v.figure}</span>
        <span className={cn("hidden whitespace-nowrap text-[12px] lg:block",
          v.state === "low" ? "font-medium text-[rgb(var(--c-warning-text))]" : "text-ink3 group-hover:text-ink2")}>{v.meta}</span>
      </span>
      <ChevronDown size={16} aria-hidden="true" className={cn("hidden shrink-0 text-ink3 transition-transform duration-200 lg:block", open && "rotate-180")} />
    </button>
  );
}

/* ── the details ─────────────────────────────────────────────────────────── */

/** A future limit window (five hours, seven days): the share used and when it resets. */
export interface UsageLimit {
  label: string;
  /** 0-100 */
  usedShare: number;
  resetsAt: string | null;
}

/** The slot for the usage limits: nothing at all until the billing summary carries them. */
export function UsageLimitsSlot({ limits }: { limits?: UsageLimit[] | null }) {
  const t = useT();
  if (!limits || limits.length === 0) return null;
  return (
    <section aria-label={t("billing.creditPill.limits", "Usage limits")} className="mt-4 border-t border-line pt-4">
      <h3 className="text-[13px] font-medium text-ink">{t("billing.creditPill.limits", "Usage limits")}</h3>
      <ul className="mt-2 space-y-3">
        {limits.map((l) => (
          <li key={l.label}>
            <div className="num flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-ink2">{l.label}</span>
              <span className="text-ink3">{shortDate(l.resetsAt)
                ? t("billing.creditPill.limitUsedResets", "{share}% used · resets {date}", { share: Math.round(l.usedShare), date: shortDate(l.resetsAt) ?? "" })
                : t("billing.creditPill.limitUsed", "{share}% used", { share: Math.round(l.usedShare) })}</span>
            </div>
            <Bar value={l.usedShare} className="mt-1.5 h-1.5" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-ink2">{label}</dt>
      <dd className="num min-w-0 text-right text-[14px] font-medium text-ink">
        {value}
        {sub && <span className="block text-[12px] font-normal text-ink3">{sub}</span>}
      </dd>
    </div>
  );
}

const LINK = "inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-[rgb(var(--c-accent-text))] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50";

/** The panel's content: credit left (the one figure), the period bar, used this month, plan, renewal, agents, the top
 *  projects, the future limits slot and the links. Real figures only. */
export function CreditDetails({ summary, admin = false, limits, onNavigate, onChangePlan }: {
  summary: BillingSummary; admin?: boolean; limits?: UsageLimit[] | null; onNavigate?: () => void; onChangePlan?: () => void;
}) {
  const t = useT();
  const state = creditState(summary);
  const notice = creditNotice(summary);
  const used = usedOf(summary);
  const pending = pendingText(summary);
  const top = summary.perProject.filter((p) => p.costUsd > 0).slice(0, 3);
  const share = usedShare(summary);
  return (
    <div className="px-5 pb-5">
      <div className="text-[13px] text-ink3">{t("billing.creditPill.creditLeft", "Credit left")}</div>
      <div className={cn("num mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.02em]",
        state === "out" ? "text-[rgb(var(--c-danger-text))]" : state === "low" ? "text-[rgb(var(--c-warning-text))]" : "text-ink")}>
        {usd(leftUsd(summary))}
      </div>
      {summary.grantedUsd > 0 && (
        <div className="mt-3">
          <Bar value={share} tone={state === "out" ? "danger" : state === "low" ? "warning" : "accent"} className="h-2" />
          <div className="num mt-1.5 flex justify-between text-[12px] text-ink3">
            <span>{t("billing.creditPill.shareUsed", "{share}% used", { share: Math.round(share) })}</span>
            <span>{t("billing.creditPill.shareLeftOf", "{share}% left of {amount}", { share: Math.round(100 - share), amount: usd(summary.grantedUsd) })}</span>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className={cn("mt-3 rounded-block px-3 py-2.5 text-[13px] text-ink", state === "out" ? "bg-danger-soft" : "bg-warning-soft")}>
          <span className="font-medium">{notice.title}.</span> {notice.text}
        </p>
      )}
      {pending && <p className="mt-3 text-[13px] text-ink2">{pending}</p>}
      <dl className="mt-3 divide-y divide-line border-t border-line">
        <Fact label={used.label} value={usd(used.usd)} sub={tokensText(used.tokens)} />
        <Fact label={t("billing.creditPill.plan", "Plan")} value={summary.plan?.name ?? t("billing.creditPill.noPlan", "No plan yet")}
          sub={summary.plan ? `${assistedText(summary.plan.assisted)} · ${streamsText(summary.plan.maxParallelStreams)}` : t("billing.creditPill.chooseOne", "Choose one with Change plan.")} />
        <Fact label={t("billing.creditPill.renews", "Renews")} value={renewalLine(summary)} />
        <Fact label={t("billing.creditPill.agentsNow", "Agents working now")} value={
          <span className="inline-flex items-center gap-2">{summary.activeAgents > 0 && <Dot tone="accent" pulse />}{agentsText(summary.activeAgents)}</span>
        } sub={summary.runningJobs > 0 ? jobsText(summary.runningJobs) : undefined} />
      </dl>
      {top.length > 0 && (
        <div className="mt-2 border-t border-line pt-3">
          <h3 className="text-[13px] text-ink2">{t("billing.creditPill.topProjects", "Top projects by cost")}</h3>
          <ul className="mt-1.5 space-y-1.5">
            {top.map((p) => (
              <li key={p.projectId} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="min-w-0 break-words text-ink">{p.name}</span>
                <span className="num shrink-0 font-medium text-ink">{usd(p.costUsd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <UsageLimitsSlot limits={limits} />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4">
        <Link to="/settings#plan" onClick={onNavigate} className={LINK}>{t("billing.creditPill.planAndUsage", "Plan and usage")}<ArrowRight size={14} aria-hidden="true" /></Link>
        {onChangePlan
          ? <button type="button" onClick={onChangePlan} className={LINK}>{t("billing.creditPill.changePlan", "Change plan")}</button>
          : <Link to="/settings#plan" onClick={onNavigate} className={LINK}>{t("billing.creditPill.changePlan", "Change plan")}</Link>}
        {admin && <Link to="/admin/usage" onClick={onNavigate} className={LINK}>{t("billing.creditPill.usageCosts", "Usage & costs")}</Link>}
      </div>
    </div>
  );
}

/* ── the pill with its details ───────────────────────────────────────────── */

export function CreditPill() {
  const t = useT();
  const workspace = useCurrentWorkspace();
  const summary = useBillingSummary(workspace?.id);
  const access = usePlatformAccess();
  const admin = adminMounted() && hasPlatformAccess(access);
  const mode = creditPillMode(Boolean(workspace), summary);
  const [panel, dispatch] = useReducer(creditPanelReducer, CLOSED);
  // mounted while open and while the closing shape runs
  const [shown, setShown] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Escape gives focus back to the pill without opening it again */
  const skipFocus = useRef(false);
  const id = useId();
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  const { pathname } = useLocation();

  useEffect(() => { dispatch("away"); }, [pathname]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (panel.open) { setShown(true); return; }
    if (!shown) return;
    const done = window.setTimeout(() => setShown(false), reduced ? 160 : CLOSE_MS);
    return () => window.clearTimeout(done);
  }, [panel.open, shown, reduced]);
  // the panel starts as the pill's own shape: its width, measured when it opens
  useLayoutEffect(() => {
    if (panel.open && shell.current && trigger.current) shell.current.style.setProperty("--credit-pill-w", `${trigger.current.offsetWidth}px`);
  }, [panel.open, shown]);
  useEffect(() => {
    if (!panel.open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) dispatch("outside"); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dispatch("escape");
      skipFocus.current = true;
      trigger.current?.focus();
      skipFocus.current = false;
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [panel.open]);

  if (mode === "hidden" || !summary.data) {
    return mode === "loading" ? <div className="hidden shrink-0 sm:block"><CreditPillSkeleton /></div> : null;
  }
  const later = (e: PanelEvent, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => dispatch(e), ms); };
  const close = () => dispatch("outside");
  const motion = panelMotion(panel.open ? "in" : "out", reduced);
  return (
    <div ref={box} className="relative hidden shrink-0 sm:block"
      onPointerEnter={(e) => { if (e.pointerType === "mouse" && !choosing) later("hover", HOVER_OPEN_MS); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse" && !choosing) later("leave", HOVER_CLOSE_MS); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dispatch("blur"); }}>
      <CreditPillButton summary={summary.data} open={panel.open} panelId={panelId} buttonRef={trigger}
        onClick={() => { window.clearTimeout(timer.current); dispatch("click"); }}
        onFocus={() => { if (!skipFocus.current) dispatch("focus"); }} />
      {shown && (
        <div ref={shell} className="credit-shell absolute right-0 top-0 z-40 w-[23rem] max-w-[calc(100vw-32px)]">
          <div id={panelId} role="dialog" aria-labelledby={titleId} data-motion={reduced ? "reduced" : "liquid"}
            onAnimationEnd={(e) => { if (!panel.open && e.target === e.currentTarget) setShown(false); }}
            className={cn("credit-surface max-h-[calc(100dvh-28px)] overflow-y-auto overscroll-contain scroll-thin border border-transparent bg-surface text-ink dark:border-line", motion.surface)}>
            {/* the pill sits over the panel's first 48 px: its title shows beside it */}
            <h2 id={titleId} className="flex h-[58px] items-center px-5 text-[13px] font-medium text-ink2">{t("billing.creditPill.title", "Credit and usage")}</h2>
            <div className={motion.content}>
              <CreditDetails summary={summary.data} admin={admin} onNavigate={close}
                onChangePlan={() => { close(); setChoosing(true); }} />
            </div>
          </div>
        </div>
      )}
      <ChangePlanDialog open={choosing} onClose={() => setChoosing(false)} workspaceId={workspace?.id ?? null}
        workspaceName={workspace?.name ?? null} currentKey={summary.data.plan?.key ?? null} pending={pendingText(summary.data)} />
    </div>
  );
}

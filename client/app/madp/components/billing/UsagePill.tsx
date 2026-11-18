/** The usage pill: "USD 12.40 used · 37.60 left · 4 agents working", in the Software Engineering step's header and on
 *  the 3D office (Studio). A click opens the breakdown: this project, this build (so far while it runs), the plan and
 *  the credit, with a link to Settings → Plan and usage. Every figure follows the work live (src/blocks/billing/usage.ts). Nothing shows while the summary loads or when billing is not available: the header
 *  stays calm, and the Plan and usage card is where that is said. */
import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Wallet } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { Dot } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { useBillingSummary } from "./billingData";
import type { BillingSummary, BuildUsage } from "./types";
import {
  agentsText, assistedText, creditNotice, jobsText, creditState, leftUsd, money, pendingText, pillText, streamsText, tokensText, usd, usedOf, type CreditState,
} from "./usageText";

export type PillVariant = "bar" | "hud";

const TONE: Record<CreditState, "neutral" | "warning" | "danger"> = { ok: "neutral", low: "warning", out: "danger" };

/** The pill itself (a button). Below sm it keeps to what is left and the agents at work. */
export const UsagePillButton = forwardRef<HTMLButtonElement, {
  summary: BillingSummary; variant?: PillVariant; open?: boolean; onClick?: () => void; className?: string;
}>(function UsagePillButton({ summary, variant = "bar", open = false, onClick, className }, ref) {
  const t = useT();
  const state = creditState(summary);
  const hud = variant === "hud";
  const working = summary.activeAgents > 0;
  return (
    <button ref={ref} type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={open} data-credit={state}
      aria-label={t("billing.usagePill.label", "Usage: {text}. Show the breakdown", { text: pillText(summary) })}
      className={cn("num inline-flex h-9 max-w-full items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium outline-none transition focus-visible:ring-2",
        hud
          ? "bg-[rgb(34_36_44/0.72)] text-white backdrop-blur-xl backdrop-saturate-150 hover:bg-[rgb(34_36_44/0.86)] focus-visible:ring-white"
          : "bg-surface text-ink ring-1 ring-inset ring-line hover:bg-surface2 focus-visible:ring-accent/50",
        !hud && state === "low" && "bg-warning-soft ring-transparent text-[rgb(var(--c-warning-text))]",
        !hud && state === "out" && "bg-danger-soft ring-transparent text-[rgb(var(--c-danger-text))]",
        className)}>
      {state === "ok"
        ? <Wallet size={14} strokeWidth={1.75} aria-hidden className={hud ? "text-white/80" : "text-ink3"} />
        : <Dot tone={TONE[state]} />}
      <span className="hidden sm:inline">{t("billing.usagePill.used", "{amount} used", { amount: usd(usedOf(summary).usd) })}</span>
      <span aria-hidden className={cn("hidden sm:inline", hud ? "text-white/50" : "opacity-50")}>·</span>
      <span>{state === "out" ? t("billing.usagePill.noCreditLeft", "No credit left")
        : <><span className="sm:hidden">USD </span>{t("billing.usagePill.left", "{amount} left", { amount: money(leftUsd(summary)) })}</>}</span>
      <span aria-hidden className={hud ? "text-white/50" : "opacity-50"}>·</span>
      <span className="inline-flex items-center gap-1.5">
        {working && <Dot tone={hud ? "success" : "accent"} pulse />}
        <span className="hidden md:inline">{agentsText(summary.activeAgents)}</span>
        <span className="md:hidden">{t("billing.usagePill.working", "{n} working", { n: summary.activeAgents })}</span>
      </span>
    </button>
  );
});

function Row({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[13px] text-ink2">{label}</dt>
      <dd className="num min-w-0 text-right text-[14px] font-medium text-ink">
        {value}
        {sub && <span className="block text-[12px] font-normal text-ink3">{sub}</span>}
      </dd>
    </div>
  );
}

/** The breakdown under the pill: credit left (the one figure that matters), then this project, this build, the plan. */
export function UsageBreakdown({ summary, projectId, build, onNavigate }: {
  summary: BillingSummary; projectId?: string | null; build?: BuildUsage | null; onNavigate?: () => void;
}) {
  const t = useT();
  const state = creditState(summary);
  const notice = creditNotice(summary);
  const project = projectId ? summary.perProject.find((p) => p.projectId === projectId) ?? null : null;
  const used = usedOf(summary);
  const pending = pendingText(summary);
  return (
    <div className="w-[min(22rem,calc(100vw-32px))] p-4">
      <div className="text-[12px] text-ink3">{t("billing.usagePill.creditLeft", "Credit left")}</div>
      <div className={cn("num mt-0.5 text-[28px] font-medium leading-tight tracking-[-0.02em]",
        state === "out" ? "text-[rgb(var(--c-danger-text))]" : state === "low" ? "text-[rgb(var(--c-warning-text))]" : "text-ink")}>
        {usd(leftUsd(summary))}
      </div>
      <div className="num mt-1 text-[13px] text-ink2">
        {typeof summary.monthUsedUsd === "number"
          ? t("billing.usagePill.usedThisMonth", "{amount} used this month · {tokens}", { amount: usd(used.usd), tokens: tokensText(used.tokens) })
          : t("billing.usagePill.usedSoFar", "{amount} used so far · {tokens}", { amount: usd(used.usd), tokens: tokensText(used.tokens) })}
      </div>
      {notice && (
        <p role="status" className={cn("mt-3 rounded-block px-3 py-2.5 text-[13px] text-ink", state === "out" ? "bg-danger-soft" : "bg-warning-soft")}>
          <span className="font-medium">{notice.title}.</span> {notice.text}
        </p>
      )}
      {pending && <p className="mt-3 text-[13px] text-ink2">{pending}</p>}
      <dl className="mt-3 divide-y divide-line border-t border-line">
        {projectId !== undefined && (
          <Row label={t("billing.usagePill.thisProject", "This project")} value={project ? usd(project.costUsd) : usd(0)}
            sub={project ? tokensText(project.tokens) : t("billing.usagePill.nothingUsed", "Nothing used yet")} />
        )}
        {build && (
          <Row label={t("billing.usagePill.thisBuild", "This build")}
            value={build.costUsd !== null
              ? build.running ? t("billing.usagePill.soFar", "{amount} so far", { amount: usd(build.costUsd) }) : usd(build.costUsd)
              : build.running ? t("billing.usagePill.countedWhenDone", "Counted when it finishes") : t("billing.usagePill.notCounted", "Not counted")}
            sub={build.tokens !== null ? tokensText(build.tokens) : undefined} />
        )}
        <Row label={t("billing.usagePill.agentsNow", "Agents working now")} value={agentsText(summary.activeAgents)}
          sub={summary.runningJobs > 0 ? jobsText(summary.runningJobs) : undefined} />
        <Row label={t("billing.usagePill.plan", "Plan")} value={summary.plan?.name ?? t("billing.usagePill.noPlan", "No plan yet")}
          sub={summary.plan ? `${assistedText(summary.plan.assisted)} · ${streamsText(summary.plan.maxParallelStreams)}` : undefined} />
      </dl>
      <Link to="/settings#plan" onClick={onNavigate}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-[rgb(var(--c-accent-text))] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
        {t("billing.usagePill.planAndUsage", "Plan and usage")}<ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

/** The pill with its breakdown, for the open workspace. `projectId` adds "This project"; `build` adds "This build". */
export function UsagePill({ projectId, build, variant = "bar", className }: {
  projectId?: string | null; build?: BuildUsage | null; variant?: PillVariant; className?: string;
}) {
  const t = useT();
  const workspace = useCurrentWorkspace();
  const summary = useBillingSummary(workspace?.id);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // the breakdown takes focus when it opens (Escape or a click outside closes it)
  useLayoutEffect(() => { if (open) panel.current?.focus(); }, [open]);
  if (!summary.data) return null;
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  return (
    <>
      <UsagePillButton ref={trigger} summary={summary.data} variant={variant} open={open} onClick={() => setOpen((v) => !v)} className={className} />
      {open && (
        <>
          {/* a click outside closes it */}
          <div aria-hidden className="fixed inset-0 z-[69]" onPointerDown={() => close()} />
          <Popover anchorRef={trigger} panelRef={panel} placement="bottom-end" onClose={() => close()} role="dialog" aria-label={t("billing.usagePill.dialogLabel", "Usage")} tabIndex={-1}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(true); } }}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== trigger.current) close(); }}
            className="rounded-card bg-surface text-ink shadow-float outline-none ring-1 ring-line animate-rise">
            <UsageBreakdown summary={summary.data} projectId={projectId} build={build} onNavigate={() => close()} />
          </Popover>
        </>
      )}
    </>
  );
}

/** Where you are, with the app's own names: the three phases on top (Project Setup → Business Analysis → Software
 *  Engineering), and beside the person the current phase's checklist (Project setup's About, Code, Material and Start
 *  project analysis; the business analyst's five items), each done, now, still open or later, with "Next for you" as
 *  the analysis page says it. An analysis item that is done or open can be opened, as on the page. */
import { Check } from "lucide-react";
import { useT } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import type { AnalystItem } from "@/madp/components/analysis-next/model";
import type { ItemState, OfficePhase } from "./flow";
import type { StageLayout } from "./layout";
import { useSetupItemLabels } from "./SetupConversation";
import { useVisit } from "./store";

export function usePhaseLabels(): Record<OfficePhase, string> {
  const t = useT();
  return {
    setup: t("studio.office.visit.phase.setup", "Project Setup"),
    analysis: t("studio.office.visit.phase.analysis", "Business Analysis"),
    engineering: t("studio.office.visit.phase.engineering", "Software Engineering"),
  };
}

/** The analyst's checklist labels, as the analysis page shows them. */
export function useAnalystLabels(): Record<AnalystItem, string> {
  const t = useT();
  return {
    brief: t("studio.office.visit.items.brief", "Objective and the people who will use it"),
    understood: t("studio.office.visit.items.understood", "Check what I understood"),
    questions: t("studio.office.visit.items.questions", "A few questions"),
    requirements: t("studio.office.visit.items.requirements", "Approve the requirements"),
    scope: t("studio.office.visit.items.scope", "Agree and lock the scope"),
  };
}

function Mark({ state, n }: { state: ItemState; n: number }) {
  return (
    <span aria-hidden className={cn("num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium",
      state === "done" && "bg-success-soft text-success",
      state === "now" && "bg-accent text-white ring-4 ring-accent/15",
      state === "open" && "bg-white text-ink2 ring-1 ring-ink/15",
      state === "later" && "bg-white/70 text-ink3 ring-1 ring-ink/10",
      state === "skipped" && "border border-dashed border-ink/25 text-ink3")}>
      {state === "done" ? <Check size={13} strokeWidth={2.75} /> : state === "skipped" ? "–" : n}
    </span>
  );
}

export function StepList({ layout }: { layout: StageLayout }) {
  const t = useT();
  const ind = useVisit((s) => s.indicator);
  const pick = useVisit((s) => s.pick);
  const phases = usePhaseLabels();
  const setupLabels = useSetupItemLabels();
  const analystLabels = useAnalystLabels();
  if (!ind) return null;
  const label = (id: string) => (ind.phase === "setup" ? setupLabels[id as keyof typeof setupLabels] : analystLabels[id as AnalystItem]) ?? id;
  const stateText: Record<ItemState, string> = {
    done: t("studio.office.visit.steps.done", "Done"),
    now: t("studio.office.visit.steps.now", "Now"),
    open: t("studio.office.visit.steps.open", "Still open"),
    later: t("studio.office.visit.steps.later", "Later"),
    skipped: t("studio.office.visit.steps.skipped", "Skipped"),
  };
  const at = ind.items.findIndex((i) => i.state === "now");

  if (!layout.steps.shown) {
    // folded: one line under the top bar
    const now = ind.items[at];
    return (
      <p className="pointer-events-auto absolute left-1/2 top-[64px] w-max max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-[16px] bg-white/90 px-4 py-1.5 text-center text-[13px] leading-5 text-ink2 shadow-[0_10px_30px_-16px_rgb(16_24_48/0.4)]">
        <span className="font-medium text-ink">{phases[ind.phase]}</span>
        {now && <> · {t("studio.office.visit.steps.of", "{n} of {total}", { n: at + 1, total: ind.items.length })} · {label(now.id)}</>}
      </p>
    );
  }

  return (
    <nav aria-label={t("studio.office.visit.steps.label", "Steps")} className="visit-steps pointer-events-auto absolute flex flex-col gap-3 p-4"
      style={{ left: layout.steps.left, top: layout.steps.top, width: layout.steps.width }}>
      <p className="px-1 text-[12px] font-medium uppercase tracking-[0.12em] text-ink3">{phases[ind.phase]}</p>
      <ol className="flex flex-col gap-0.5">
        {ind.items.map((it, i) => {
          const canOpen = ind.phase === "analysis" && (it.state === "done" || it.state === "open" || it.state === "now");
          const body = (
            <>
              <Mark state={it.state} n={i + 1} />
              <span className={cn("min-w-0 flex-1 text-[14px] leading-5", it.state === "later" || it.state === "skipped" ? "text-ink3" : "text-ink", it.state === "now" && "font-medium")}>{label(it.id)}</span>
              {it.state === "skipped" ? <span className="shrink-0 text-[12px] text-ink3">{stateText.skipped}</span> : <span className="sr-only">{stateText[it.state]}</span>}
            </>
          );
          return (
            <li key={it.id}>
              {canOpen ? (
                <button type="button" aria-current={it.state === "now" ? "step" : undefined} onClick={() => pick(it.id as AnalystItem)}
                  className="flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left outline-none transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-accent/50">
                  {body}
                </button>
              ) : (
                <div aria-current={it.state === "now" ? "step" : undefined} className="flex items-center gap-3 px-2 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {ind.next && (
        <div className="rounded-[14px] bg-accent-soft/70 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-accent">{t("studio.office.visit.steps.next", "Next for you")}</p>
          <p className="mt-0.5 text-[14px] font-medium leading-5 text-ink">{ind.next.title}</p>
          {ind.next.detail && <p className="mt-0.5 text-[13px] leading-5 text-ink2">{ind.next.detail}</p>}
        </div>
      )}
    </nav>
  );
}

/** The three phases, the current one marked, the passed ones ticked. */
export function PhaseBar({ phase }: { phase: OfficePhase }) {
  const t = useT();
  const labels = usePhaseLabels();
  const order: OfficePhase[] = ["setup", "analysis", "engineering"];
  const at = order.indexOf(phase);
  return (
    <nav aria-label={t("studio.office.visit.phase.label", "The journey")} className="cine-pill pointer-events-auto hidden px-1.5 py-1.5 md:block">
      <ol className="flex items-center">
        {order.map((p, i) => (
          <li key={p} className="flex items-center">
            {i > 0 && <span aria-hidden className={cn("mx-1 h-px w-5", i <= at ? "bg-ink/35" : "bg-ink/10")} />}
            <span aria-current={i === at ? "step" : undefined}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium", i === at ? "bg-ink text-white" : i < at ? "text-ink" : "text-ink3")}>
              {i < at && <Check size={12} strokeWidth={3} className="text-success" aria-hidden />}
              {labels[p]}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

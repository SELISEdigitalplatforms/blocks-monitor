/** The left column of Business Analysis (next design): working with your business analyst. From the top: who you work
 *  with and one warm line; "Next for you" (the one thing that moves the project on); a compact checklist of the
 *  analysis (done / now / later, and "open" for an earlier item still to do while the questions run; a click opens
 *  that item here and its part in the analysis); and the conversation for the open item, one thing at a time. Every
 *  answer and sign-off calls the op today's panel calls (analysis/pm/ProductManagerPanel.tsx), with the same
 *  permissions. No height of its own: the page's column is sticky and scrolls on lg+; full width on phones. Front end
 *  only.
 *  An existing product attached to the Factory as it is live, past the analysis (it never went through one): an item
 *  shows done only when its record says it happened, else "Not used" (muted, no tick), and the conversation says once
 *  that there was no analysis, with the way to request a change (./LiveProduct.tsx). */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, NotebookPen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/madp/blocks/projects/reads";
import { clarificationsOptions } from "@/madp/blocks/sanitization/hooks";
import { stepIndex } from "@/madp/domain/journey";
import { BriefRequestError, fetchBrief, type Brief } from "@/madp/components/understanding/briefApi";
import { fileCounts } from "@/madp/components/understanding/model";
import { briefRefetchInterval } from "@/madp/components/analysis/doc/briefQuery";
import { ChangeRequestLayer } from "@/madp/components/changes/ChangeRequestLayer";
import { cn } from "@/madp/lib/cn";
import { ANALYST_ITEMS, ANALYST_ITEM_LABEL, attachedLive, type AnalysisCtx, type AnalystItem, type DocPart, type NextAction } from "../model";
import {
  LATER_TEXT, analystChecklistStates, briefAnswers, briefKey, checklistNote, checklistStates, currentItem, followCurrent, itemPart, livePastAnalysis,
  type ChecklistState, type LiveFacts,
} from "./analystModel";
import { LiveProductSays, useLiveRecords } from "./LiveProduct";
import type { LiveDoc } from "../live/useLiveDoc";
import { NextCard, prefersReducedMotion } from "./NextCard";
import { BriefStep } from "./BriefStep";
import { UnderstoodStep } from "./UnderstoodStep";
import { QuestionsStep } from "./QuestionsStep";
import { RequirementsStep } from "./RequirementsStep";
import { ScopeStep } from "./ScopeStep";
import { AnalystSays } from "./Talk";
import { useT } from "@/madp/i18n";

const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-12px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";

export type AnalystColumnProps = AnalysisCtx & {
  next: NextAction;
  /** The item whose conversation is open; null: the one in progress. */
  open: AnalystItem | null;
  onOpen: (item: AnalystItem) => void;
  onPart: (part: DocPart) => void;
  /** Changes when the sticky bar asks for the "Next for you" card. */
  focusSignal?: number;
  /** A live product's documentation (useLiveDoc, read once by the page); null for every other project. */
  liveDoc?: LiveDoc | null;
};

export function AnalystColumn(props: AnalystColumnProps) {
  const { projectId, workspaceId, step, next, open, onOpen, onPart, focusSignal, liveDoc = null } = props;
  const t = useT();
  const project = useProject(projectId).data ?? null;
  const reached = Boolean(step && step !== "business");

  // what the analyst read (the same query as Project understanding and today's panel: one read for all)
  const briefQ = useQuery<Brief, BriefRequestError>({
    queryKey: briefKey(projectId),
    queryFn: ({ signal }) => fetchBrief(projectId, signal),
    enabled: Boolean(projectId) && Boolean(project) && reached,
    refetchInterval: briefRefetchInterval,
    retry: (count, e) => !(e instanceof BriefRequestError && e.status < 500) && count < 2,
  });
  const brief = briefQ.data ?? null;
  const asked = useQuery({ ...clarificationsOptions({ workspaceId: workspaceId ?? "", projectId }), enabled: Boolean(workspaceId && reached) });
  const askedRows = (asked.data ?? []) as { Question: string; Answer?: string | null; Status: string }[];
  // the objective and the users as every agent reads them (projectBrief briefFacts): the project's own fields, else the
  // answers to my own questions. What the reading or the business agent only found is not an answer.
  const answers = briefAnswers({ name: project?.name ?? "", goal: project?.goal ?? "", users: project?.targetUsers ?? "", asked: askedRows });
  const questionCounts = {
    open: askedRows.filter((r) => r.Status === "open").length,
    answered: askedRows.filter((r) => r.Status === "answered").length,
    deferred: askedRows.filter((r) => r.Status === "deferred").length,
  };
  // a live product past the analysis: what the records say really happened (null for every other project)
  const live = livePastAnalysis(attachedLive(project), step);
  const records = useLiveRecords(projectId, live);
  const liveFacts: LiveFacts | null = live ? {
    understoodConfirmed: Boolean(brief?.confirmedAt),
    filesRead: fileCounts(brief?.attachmentStatus ?? []).read,
    questionsHandled: questionCounts.answered + questionCounts.deferred,
    ...records,
  } : null;
  const states = analystChecklistStates(step, { briefReady: answers.missing.length === 0, understoodConfirmed: Boolean(brief?.confirmedAt) }, liveFacts);
  const current = currentItem(checklistStates(step, answers.missing.length === 0));
  // a live product opens on the analyst's one message (null), not on an item
  const shown: AnalystItem | null = open ?? (live ? null : current);
  const shownState = shown ? states[shown] : null;

  // when the item in progress moves on (a sign-off), the conversation follows it
  const prevCurrent = useRef<AnalystItem | null>(null);
  useEffect(() => {
    const to = followCurrent(prevCurrent.current, current, open);
    prevCurrent.current = current;
    if (to) onOpen(to);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Next for you" opens its item and brings the focus to the item's action (once it is drawn)
  const talkRef = useRef<HTMLElement>(null);
  const [focusAsk, setFocusAsk] = useState(0);
  useEffect(() => {
    if (!focusAsk) return;
    let frame = 0;
    let tries = 0;
    const tick = () => {
      const root = talkRef.current;
      const target = root?.querySelector<HTMLElement>("[data-analyst-action]:not(:disabled)");
      if (target || tries++ > 90) {
        const el = target ?? root;
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [focusAsk]);

  const go = () => {
    if (next.action === "document") { liveDoc?.start(); return; }
    if (!next.item) return;
    onOpen(next.item);
    setFocusAsk((n) => n + 1);
  };
  const pick = (item: AnalystItem) => {
    onOpen(item);
    onPart(itemPart(item));
  };

  return (
    // the page's own column (an aside named "Your business analyst") is sticky and scrolls on lg+; the padding keeps
    // focus rings and shadows inside its scroll box
    <div className="flex min-w-0 flex-col gap-4 p-1">
      <header className="flex items-center gap-3 px-1 pt-1">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]">
          <NotebookPen size={19} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[17px] font-semibold leading-6 text-ink">{t("analysis.workspace.analystAria", "Your business analyst")}</h2>
          <p className="text-[14px] leading-5 text-ink2">{t("analysis.analyst.tagline", "I'll take you through this one step at a time.")}</p>
        </div>
      </header>

      <NextCard next={next} onGo={go} focusSignal={focusSignal} />

      <nav aria-label={t("analysis.workspace.checklistAria", "Analysis checklist")} className={cn(CARD, "px-3 py-3")}>
        <ol className="flex flex-col gap-0.5">
          {ANALYST_ITEMS.map((item, i) => {
            const s = states[item];
            const on = item === shown;
            return (
              <li key={item}>
                <button type="button" onClick={() => pick(item)} aria-current={on ? "step" : undefined}
                  className={cn("flex w-full min-w-0 items-center gap-3 rounded-block px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none",
                    on && "bg-surface2")}>
                  <ItemMark state={s} n={i + 1} />
                  <span className={cn("min-w-0 flex-1 break-words text-[14px] leading-5", s === "later" || s === "skipped" ? "text-ink3" : "text-ink", s === "now" && "font-medium")}>
                    {ANALYST_ITEM_LABEL[item]}
                  </span>
                  <span className={cn("shrink-0 text-[12px]", s === "done" ? "text-[rgb(var(--c-success-text))]" : s === "now" ? "font-medium text-[rgb(var(--c-accent-text))]" : s === "open" ? "text-ink2" : "text-ink3")}>
                    {checklistNote(item, s, item === "questions" ? questionCounts : undefined, liveFacts)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section ref={talkRef} tabIndex={-1} aria-labelledby="analyst-talk-title" className={cn(CARD, "flex min-w-0 flex-col gap-4 px-5 py-5 outline-none")}>
        <h3 id="analyst-talk-title" className="text-[13px] font-medium text-ink3">{shown ? ANALYST_ITEM_LABEL[shown] : t("analysis.analyst.aboutProduct", "About this product")}</h3>
        {shown === null || shownState === null || shownState === "skipped" ? (
          <LiveProductSays projectId={projectId} doc={liveDoc} />
        ) : (
          <Conversation item={shown} state={shownState} live={live} ctx={props} project={project} brief={brief} briefError={briefQ.isError}
            waitingForBrief={briefQ.isFetching && !brief} answers={answers} onPart={onPart} />
        )}
        {!live && shown !== null && shown !== current && (
          <button type="button" onClick={() => onOpen(current)}
            className="inline-flex w-fit items-center gap-1.5 rounded text-[14px] font-medium text-[rgb(var(--c-accent-text))] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
            {t("analysis.analyst.backTo", "Back to “{item}”", { item: ANALYST_ITEM_LABEL[current] })}<ArrowRight size={14} aria-hidden />
          </button>
        )}
      </section>
      {/* the change request drawer (the one Software Engineering and Release open), here only for a live product */}
      {live && <ChangeRequestLayer />}
    </div>
  );
}

function ItemMark({ state, n }: { state: ChecklistState; n: number }) {
  return (
    <span aria-hidden className={cn("num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium",
      state === "done" && "bg-success-soft text-success",
      state === "now" && "bg-accent text-white ring-4 ring-accent/15",
      state === "later" && "bg-surface text-ink3 ring-1 ring-line",
      state === "open" && "bg-surface text-ink2 ring-1 ring-line",
      state === "skipped" && "border border-dashed border-line text-ink3 opacity-70")}>
      {state === "done" ? <Check size={13} strokeWidth={2.75} /> : n}
    </span>
  );
}

function Conversation({ item, state, live, ctx, project, brief, briefError, waitingForBrief, answers, onPart }: {
  item: AnalystItem; state: Exclude<ChecklistState, "skipped">; live: boolean; ctx: AnalysisCtx; project: ReturnType<typeof useProject>["data"] | null; brief: Brief | null;
  briefError: boolean; waitingForBrief: boolean; answers: ReturnType<typeof briefAnswers>; onPart: (part: DocPart) => void;
}) {
  const t = useT();
  if (!project) return <AnalystSays className="text-ink2">{t("analysis.workspace.openingProject", "Opening your project…")}</AnalystSays>;
  if (state === "later") return <AnalystSays className="text-ink2">{LATER_TEXT[item]}</AnalystSays>;
  const step = ctx.step;
  switch (item) {
    case "brief":
      return <BriefStep project={project} workspaceId={ctx.workspaceId} goal={answers.goal} users={answers.users} missing={answers.missing} done={state === "done"} />;
    case "understood":
      return <UnderstoodStep project={project} workspaceId={ctx.workspaceId} brief={brief} briefError={briefError} waitingForBrief={waitingForBrief} live={live} onPart={onPart} />;
    case "questions":
      if (!ctx.workspaceId) return <AnalystSays className="text-ink2">{t("analysis.workspace.openingQuestions", "Opening your questions…")}</AnalystSays>;
      return <QuestionsStep projectId={ctx.projectId} workspaceId={ctx.workspaceId} projectName={project.name} existing={ctx.type === "brownfield"} onPart={onPart} />;
    case "requirements":
      return step && stepIndex(step) >= stepIndex("requirements")
        ? <RequirementsStep projectId={ctx.projectId} workspaceId={ctx.workspaceId} onPart={onPart} />
        : <AnalystSays>{t("analysis.analyst.approvedRequirements", "You approved the requirements.")}</AnalystSays>;
    case "scope":
      return step && stepIndex(step) >= stepIndex("scope") ? <ScopeStep projectId={ctx.projectId} onPart={onPart} /> : <AnalystSays className="text-ink2">{LATER_TEXT.scope}</AnalystSays>;
  }
}

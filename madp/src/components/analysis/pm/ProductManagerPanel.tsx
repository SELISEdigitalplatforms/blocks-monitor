/** The left column of Business Analysis: the business analyst's panel. A header ("Your business analyst"), the checklist
 *  of the analysis marked one by one (done / now / later), and the conversation for the item in focus: the product
 *  manager asks one thing at a time and every answer or sign-off calls the op the former step called. Clicking an
 *  item opens it here and its part of the document on the right (onSelect). Sticky with its own scroll on desktop;
 *  full width on phones. Front end only. */
import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/blocks/projects/reads";
import { clarificationsOptions } from "@/blocks/sanitization/hooks";
import { stepIndex } from "@/domain/journey";
import { BriefRequestError, fetchBrief, type Brief } from "@/components/understanding/briefApi";
import { briefRefetchInterval } from "@/components/analysis/doc/briefQuery";
import { useSetupAgent } from "@/components/setup/agent/data";
import { cn } from "@/lib/cn";
import { PM_ITEMS, PM_ITEM_LABEL, PM_ITEM_PART, type AnalysisCtx, type DocPart, type ItemState, type PmItem } from "../model";
import { DONE_TEXT, LATER_TEXT, briefAnswers, checklistStates, currentItem } from "./pmModel";
import { BriefTalk } from "./BriefTalk";
import { briefKey, UnderstoodTalk } from "./UnderstoodTalk";
import { QuestionsTalk } from "./QuestionsTalk";
import { RequirementsTalk } from "./RequirementsTalk";
import { ScopeTalk } from "./ScopeTalk";
import { PmSays } from "./Talk";
import { t, useT } from "@/i18n";

const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";
const STATE_TEXT: Record<ItemState, string> = {
  get done() { return t("analysis.workspace.state.done", "Done"); },
  get now() { return t("analysis.workspace.state.now", "Now"); },
  get later() { return t("analysis.workspace.state.later", "Later"); },
};

export function ProductManagerPanel(props: AnalysisCtx & { selected: DocPart | null; onSelect: (part: DocPart) => void }) {
  const { projectId, workspaceId, step, selected, onSelect } = props;
  const t = useT();
  const project = useProject(projectId).data ?? null;
  const reached = Boolean(step && step !== "business");

  // what the business analyst read (the same query as Project understanding: one read for both)
  const briefQ = useQuery<Brief, BriefRequestError>({
    queryKey: briefKey(projectId),
    queryFn: ({ signal }) => fetchBrief(projectId, signal),
    enabled: Boolean(projectId) && Boolean(project) && reached,
    refetchInterval: briefRefetchInterval,
    retry: (count, e) => !(e instanceof BriefRequestError && e.status < 500) && count < 2,
  });
  const brief = briefQ.data ?? null;
  const agent = useSetupAgent(projectId, { live: false });
  const asked = useQuery({ ...clarificationsOptions({ workspaceId: workspaceId ?? "", projectId }), enabled: Boolean(workspaceId && reached) });
  const found = (kind: "goal" | "users") => agent.suggestions.find((x) => x.kind === kind && x.status !== "ignored")?.text ?? "";
  // the project's fields first; the brief and the business agent's findings fill a gap (as Project understanding does)
  const answers = briefAnswers({
    name: project?.name ?? "",
    goal: project?.goal.trim() || brief?.project.problem || found("goal"),
    users: project?.targetUsers.trim() || (brief?.targetUsers ?? []).map((u) => u.description).join(" ") || found("users"),
    asked: (asked.data ?? []) as { Question: string; Answer?: string | null; Status: string }[],
  });
  const states = checklistStates(step, answers.missing.length === 0);
  const current = currentItem(states);
  const [focus, setFocus] = useState<PmItem | null>(null);
  const shown = focus ?? current;

  // the right column's selection brings its checklist item into focus (only when it is the item's own part)
  useEffect(() => {
    if (!selected) return;
    const item = PM_ITEMS.find((i) => PM_ITEM_PART[i] === selected && i === shown) ?? PM_ITEMS.find((i) => PM_ITEM_PART[i] === selected && states[i] !== "later");
    if (item && item !== shown) setFocus(item);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // when the current item moves on (a sign-off), the conversation follows it
  useEffect(() => { setFocus(null); }, [current]);

  const pick = (item: PmItem) => {
    setFocus(item);
    onSelect(PM_ITEM_PART[item]);
  };

  return (
    <aside aria-label={t("analysis.workspace.analystAria", "Your business analyst")}
      className={cn(CARD, "flex min-w-0 flex-col lg:sticky lg:top-[calc(var(--project-nav-h,var(--topbar-h,0px))_+_16px)] lg:max-h-[calc(100vh_-_var(--project-nav-h,var(--topbar-h,0px))_-_2rem)] lg:overflow-hidden")}>
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white">BA</span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[16px] font-semibold leading-6 text-ink">{t("analysis.workspace.analystAria", "Your business analyst")}</h2>
          <p className="text-[13px] leading-5 text-ink2">{t("analysis.workspace.analystTagline", "asks, clarifies and writes the analysis with you")}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 px-5 py-4 lg:overflow-y-auto">
        <nav aria-label={t("analysis.workspace.checklistAria", "Analysis checklist")}>
          <ol className="flex flex-col gap-1">
            {PM_ITEMS.map((item, i) => {
              const s = states[item];
              const on = item === shown;
              return (
                <li key={item}>
                  <button type="button" onClick={() => pick(item)} aria-current={on ? "step" : undefined}
                    className={cn("flex w-full min-w-0 items-center gap-3 rounded-block px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50",
                      on && "bg-surface2")}>
                    <ItemMark state={s} n={i + 1} />
                    <span className={cn("min-w-0 flex-1 truncate text-[14px]", s === "later" ? "text-ink3" : "text-ink", s === "now" && "font-medium")}>{PM_ITEM_LABEL[item]}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      s === "done" && "bg-success-soft text-success", s === "now" && "bg-accent-soft text-accent", s === "later" && "text-ink3")}>{STATE_TEXT[s]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-label={PM_ITEM_LABEL[shown]} aria-live="polite" className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-medium uppercase tracking-wide text-ink3">{PM_ITEM_LABEL[shown]}</h3>
          <Conversation item={shown} state={states[shown]} ctx={props} project={project} brief={brief} briefError={briefQ.isError}
            waitingForBrief={briefQ.isFetching && !brief} answers={answers} />
        </section>
      </div>
    </aside>
  );
}

function ItemMark({ state, n }: { state: ItemState; n: number }) {
  return (
    <span aria-hidden className={cn("num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium",
      state === "done" && "bg-success text-white dark:text-canvas",
      state === "now" && "bg-accent text-white ring-4 ring-accent/15",
      state === "later" && "bg-surface text-ink3 ring-1 ring-line")}>
      {state === "done" ? <Check size={13} strokeWidth={2.5} /> : state === "later" ? <Circle size={6} fill="currentColor" strokeWidth={0} /> : n}
    </span>
  );
}

function Conversation({ item, state, ctx, project, brief, briefError, waitingForBrief, answers }: {
  item: PmItem; state: ItemState; ctx: AnalysisCtx; project: ReturnType<typeof useProject>["data"] | null; brief: Brief | null;
  briefError: boolean; waitingForBrief: boolean; answers: ReturnType<typeof briefAnswers>;
}) {
  const t = useT();
  if (!project) return <PmSays>{t("analysis.workspace.openingProject", "Opening your project…")}</PmSays>;
  if (state === "later") return <PmSays>{LATER_TEXT[item]}</PmSays>;
  const step = ctx.step;
  switch (item) {
    case "brief":
      return <BriefTalk project={project} workspaceId={ctx.workspaceId} goal={answers.goal} users={answers.users} missing={answers.missing} done={state === "done"} />;
    case "understood":
      return <UnderstoodTalk project={project} workspaceId={ctx.workspaceId} brief={brief} briefError={briefError} waitingForBrief={waitingForBrief} />;
    case "questions":
      if (!ctx.workspaceId) return <PmSays>{t("analysis.workspace.openingQuestions", "Opening your questions…")}</PmSays>;
      return <QuestionsTalk projectId={ctx.projectId} workspaceId={ctx.workspaceId} projectName={project.name} existing={ctx.type === "brownfield"} />;
    case "requirements":
      return step && stepIndex(step) >= stepIndex("requirements")
        ? <RequirementsTalk projectId={ctx.projectId} workspaceId={ctx.workspaceId} />
        : <PmSays>{DONE_TEXT.requirements}</PmSays>;
    case "scope":
      return step && stepIndex(step) >= stepIndex("scope") ? <ScopeTalk projectId={ctx.projectId} /> : <PmSays>{LATER_TEXT.scope}</PmSays>;
  }
}

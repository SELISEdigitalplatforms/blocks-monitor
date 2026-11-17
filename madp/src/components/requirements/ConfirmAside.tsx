/** "At a glance" of the Requirements & objective page: counts, the confirm checklist and the ONE primary action.
 *  ConfirmAsideView is presentational; ConfirmAside reads real records and confirms through the project function
 *  (requirements.confirm), which re-checks every blocker on the server. */
import { useT } from "@/i18n";
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CircleCheck, ClipboardCheck, Circle } from "lucide-react";
import { VIEWER_TIP } from "@/domain/rbac";
import { confirmBlockers } from "@/domain/requirements";
import { FunctionError } from "@/blocks/fn";
import { useDesignBrief, useObjective, useOpenClarifications, useRequirements, useSuggestions } from "@/blocks/requirements/hooks";
import { useConfirmRequirements } from "@/blocks/requirements/mutations";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { Button, Card } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { IntakeRefusal, LABEL } from "../intake/IntakeShared";
import { blockerText, checklistItems, suggestionsSummary, type ChecklistItem, type ConfirmBlocker } from "./glance";
import { requirementsErrorMessage } from "./messages";
import type { ReqTab } from "./requirementsTab";

export interface GlanceCounts {
  requirements: number;
  criteria: number;
  questionsOpen: number;
  suggestionsOpen: number;
  suggestionsAccepted: number;
  suggestionsDismissed: number;
  byPriority: { must: number; nice: number; later: number };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
      <dt className="shrink-0 text-[13px] text-ink3">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium leading-snug">{children}</dd>
    </div>
  );
}

export function ConfirmAsideView({ name, clientName, objective, counts, items, open, canConfirm, viewOnly, editing, busy, refusal, onConfirm, onOpenTab, withAction = true }: {
  name: string; clientName: string; objective: string; counts: GlanceCounts; items: ChecklistItem[];
  open: boolean; canConfirm: boolean; viewOnly: boolean; editing: boolean; busy: boolean; refusal: string | null;
  onConfirm: () => void; onOpenTab: (tab: ReqTab) => void;
  /** false when the page's "What to do now" card holds the one primary action. */
  withAction?: boolean;
}) {
  const t = useT();
  const uid = useId();
  const reasonsId = `${uid}-reasons`;
  const noteId = `${uid}-view-only`;
  const sug = suggestionsSummary({ accepted: counts.suggestionsAccepted, dismissed: counts.suggestionsDismissed, open: counts.suggestionsOpen });
  const todo = items.filter((i) => !i.done);
  const disabled = viewOnly || !canConfirm || editing || busy;
  return (
    <Card title={t("analysis.requirements.atAGlance", "At a glance")} icon={<ClipboardCheck size={18} strokeWidth={1.75} />}>
      <div className="min-w-0">
        <p className="text-[15px] font-medium [overflow-wrap:anywhere]">{name.trim() || t("analysis.requirements.untitledProject", "Untitled project")}</p>
        {clientName.trim() && <p className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{clientName}</p>}
      </div>

      <dl className="mt-4 divide-y divide-line">
        <Row label={t("analysis.requirements.checkRequirements", "Requirements")}>
          <span className="num">{counts.requirements}</span>
          <span className="block text-[12px] font-normal text-ink3">
            {t("analysis.requirements.priorityCounts", "{must} must · {should} should · {could} could", { must: counts.byPriority.must, should: counts.byPriority.nice, could: counts.byPriority.later })}
          </span>
        </Row>
        <Row label={t("analysis.requirements.formCriteria", "Acceptance criteria")}><span className="num">{counts.criteria}</span></Row>
        <Row label={t("analysis.requirements.sumQuestions", "Questions, open or deferred")}><span className="num">{counts.questionsOpen}</span></Row>
        <Row label={t("analysis.requirements.tabSuggestions", "Suggestions")}>
          <span className="num whitespace-nowrap">{sug.value}</span>
          <span className="block text-[12px] font-normal text-ink3">{sug.detail}</span>
        </Row>
      </dl>

      <div className="mt-4 min-w-0">
        <div className={LABEL}>{t("analysis.requirements.tabObjective", "Objective")}</div>
        {objective.trim()
          ? <p className="mt-1 truncate text-[14px]" title={objective}>{objective}</p>
          : <p className="mt-1 text-[13px] text-ink3">{t("analysis.requirements.noObjectiveYet", "No objective yet.")}</p>}
      </div>

      <div className="mt-4 min-w-0">
        <div className={LABEL}>{t("analysis.requirements.beforeContinue", "Before you continue")}</div>
        <ul className="mt-2 space-y-1">
          {items.map((i) => (
            <li key={i.key}>
              <button type="button" onClick={() => onOpenTab(i.tab)}
                className="flex w-full min-w-0 items-start gap-2 rounded-block px-1 py-1.5 text-left text-[13px] outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50">
                {i.done
                  ? <CircleCheck size={16} strokeWidth={1.75} className="mt-px shrink-0 text-success" aria-hidden />
                  : <Circle size={16} strokeWidth={1.75} className="mt-px shrink-0 text-ink3" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block", i.done ? "text-ink2" : "font-medium text-ink")}>{i.label}</span>
                  {i.detail && !i.done && <span className="block text-[12px] text-ink3">{i.detail}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-ink3">{i.done ? t("analysis.requirements.done", "Done") : t("analysis.requirements.toDo", "To do")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open && withAction && (
        <>
          {refusal && <IntakeRefusal title={t("analysis.requirements.notConfirmed", "Not confirmed.")} text={refusal} />}
          <Button variant="primary" size="lg" className="mt-5 w-full" iconRight={<ArrowRight size={18} strokeWidth={1.75} />}
            disabled={disabled} title={viewOnly ? VIEWER_TIP : undefined}
            aria-describedby={viewOnly ? noteId : reasonsId} onClick={onConfirm}>
            {t("analysis.requirements.confirmContinue", "Confirm and continue to scope")}
          </Button>
          {viewOnly && <ViewOnlyNote id={noteId} className="mt-2.5" />}
          <div id={reasonsId} className="mt-2.5 text-center text-[12px] leading-snug text-ink3">
            {editing ? <p>{t("analysis.requirements.saveOrCancelFirst", "Save or cancel your edit first.")}</p>
              : todo.length > 0 ? (
                <ul>{todo.map((i) => <li key={i.key}>{i.detail ? `${i.label}: ${i.detail}` : i.label}</li>)}</ul>
              ) : <p>{t("analysis.requirements.nextScope", "Next, the factory writes the scope from the approved requirements, the goal and the look & feel.")}</p>}
          </div>
        </>
      )}
      <p role="status" className="sr-only">{busy ? t("analysis.requirements.confirming", "Confirming…") : refusal ?? ""}</p>
    </Card>
  );
}

/** Wires the real records and the confirm mutation; on success it opens the scope. */
export function ConfirmAside({ projectId, editing, onOpenTab, withAction = true }: { projectId: string; editing: boolean; onOpenTab: (tab: ReqTab) => void; withAction?: boolean }) {
  const navigate = useNavigate();
  const ctx = useRequirementsContext(projectId);
  const reqs = useRequirements(projectId);
  const objective = useObjective(projectId);
  const brief = useDesignBrief(projectId);
  const questions = useOpenClarifications(projectId);
  const suggestions = useSuggestions(projectId);
  const confirm = useConfirmRequirements(projectId);
  const [refusal, setRefusal] = useState<string | null>(null);

  const requirements = reqs.data ?? [];
  const obj = objective.data ?? null;
  const blockers = confirmBlockers({ requirements, objective: obj, designBrief: brief.data ?? null } as never) as unknown as ConfirmBlocker[];
  const items = checklistItems(blockers);
  const list = suggestions.data ?? [];
  const byPriority = { must: 0, nice: 0, later: 0 };
  let criteria = obj?.criteria?.length ?? 0;
  for (const r of requirements) {
    if (r.priority in byPriority) byPriority[r.priority as keyof typeof byPriority] += 1;
    criteria += r.criteria?.length ?? 0;
  }
  const count = (s: string) => list.filter((x) => x.status === s).length;
  const viewOnly = !ctx.canEditRequirements;

  const onConfirm = () => {
    setRefusal(null);
    confirm.mutate({}, {
      onSuccess: () => navigate(`/p/${projectId}/scope`),
      onError: (e) => {
        const missing = e instanceof FunctionError && Array.isArray(e.params?.missing) ? (e.params.missing as ConfirmBlocker[]) : null;
        setRefusal(missing && missing.length > 0 ? missing.map(blockerText).join(" ") : requirementsErrorMessage(e));
      },
    });
  };

  return (
    <ConfirmAsideView name={ctx.project?.name ?? ""} clientName={ctx.project?.clientName ?? ""} objective={obj?.text ?? ""}
      counts={{
        requirements: requirements.length, criteria, questionsOpen: questions.data?.length ?? 0,
        suggestionsOpen: count("open"), suggestionsAccepted: count("accepted"), suggestionsDismissed: count("dismissed"), byPriority,
      }}
      items={items} open={ctx.open} canConfirm={blockers.length === 0} viewOnly={viewOnly} editing={editing}
      busy={confirm.isPending} refusal={refusal} onConfirm={onConfirm} onOpenTab={onOpenTab} withAction={withAction} />
  );
}

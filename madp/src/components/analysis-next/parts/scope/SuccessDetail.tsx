/** "Success metrics", opened in its row: today's analysis part (analysis/doc/scope/SuccessPart) without its card and
 *  heading. The scope's success & performance targets shown straight away as a table (metric, target, how it is
 *  checked, where it stands). A target marked "Not sure yet" shows its question and the analyst's answer. "Edit
 *  targets" opens the Scope & success page's own window (SuccessWindow) and saves through the same op
 *  (scope.success.save); a newly unsure value is sent on for an answer as it is there (scope.success). */
import { setAgreementName, successShortName } from "@/components/requirements/domainLabels";
import { t, useT } from "@/i18n";
import { useState } from "react";
import { Gauge, PencilLine } from "lucide-react";
import { useSuccessAsk, useSuccessSave } from "@/blocks/scope/mutations";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import {
  SUCCESS_KEYS, emptyKeys, emptyTargets, isBlank, openQuestionKeys, setAgreement, targetState,
  type SuccessKey, type SuccessTarget, type SuccessTargets, type TargetState,
} from "@/domain/successTargets";
import { SuccessWindow } from "@/components/scope/blocks/SuccessSection";
import { ScopeFeedbackButton } from "@/components/scope/blocks/ScopeFeedback";
import { FeedbackItem } from "@/components/feedback/FeedbackItem";
import { PartError, PartPlaceholder, PartSkeleton, useScopeDoc, versionChip } from "@/components/analysis/doc/scope/shared";
import { partOpen, type AnalysisCtx } from "@/components/analysis/model";
import { Button, Chip } from "@/ui/kit";
import type { ChipTone } from "@/data/types";
import { successIssues } from "./summaryModel";

const NO_TARGETS = emptyTargets();

/** How the team checks each kind of target (the same for every project; the target itself is the project's). */
function howChecked(k: SuccessKey): string {
  switch (k) {
    case "outcome": return t("analysis.scopeSummary.checkedOutcome", "Compared with your numbers after launch");
    case "users": return t("analysis.scopeSummary.checkedUsers", "Tested with this many people at the same time before release");
    case "responseTime": return t("analysis.scopeSummary.checkedResponseTime", "Timed on the main pages and searches before release");
    case "dataVolume": return t("analysis.scopeSummary.checkedDataVolume", "Tested with this much data before release");
    case "availability": return t("analysis.scopeSummary.checkedAvailability", "Planned around for releases and maintenance");
  }
}

/** where one target stands */
function stateOf(st: TargetState): { tone: ChipTone; text: string } {
  switch (st) {
    case "set": return { tone: "success", text: t("analysis.scopeSummary.stateAgreed", "Agreed") };
    case "missing": return { tone: "neutral", text: t("analysis.scopeSummary.stateNotSet", "Not set") };
    case "open": return { tone: "warning", text: t("analysis.scopeSummary.stateQuestionOpen", "Question open") };
    case "proposed": return { tone: "ai", text: t("analysis.scopeSummary.stateAnswerToReview", "Answer to review") };
    case "accepted": return { tone: "neutral", text: t("analysis.scopeSummary.stateNoFixedValue", "No fixed value yet") };
  }
}

/** A set value is "Agreed" only when someone agreed it: the business analyst's untouched proposal is "Proposed" until the
 *  scope is locked, then "Agreed with the scope" (setAgreement). */
function stateChip(target: SuccessTarget, st: TargetState, locked: boolean): { tone: ChipTone; text: string } {
  if (st !== "set") return stateOf(st);
  const a = setAgreement(target, locked);
  return { tone: a === "proposed" ? "ai" : "success", text: setAgreementName(a) };
}

export function SuccessDetail(ctx: AnalysisCtx) {
  useT();
  if (!partOpen("success", ctx.step)) {
    return <PartPlaceholder icon={<Gauge size={16} strokeWidth={1.75} />}
      text={t("analysis.scopeSummary.successPlaceholder", "Your business analyst proposes how success is measured here once the requirements are approved: the outcome that proves the project paid off, expected users, how fast it should feel and how much data it holds. You agree the targets before the scope is locked.")} />;
  }
  return <Success projectId={ctx.projectId} />;
}

function Success({ projectId }: { projectId: string }) {
  useT();
  const doc = useScopeDoc(projectId);
  const save = useSuccessSave(doc.ctx);
  const ask = useSuccessAsk(doc.ctx);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = doc.version;
  const targets = version?.successTargets ?? NO_TARGETS;
  const editable = doc.page.canEditFeatures && version !== null;
  const blank = isBlank(targets);
  const locked = doc.page.phase === "locked" || doc.page.phase === "buildStarted" || doc.page.phase === "released";

  const askAnalyst = (mode: "propose" | "answer", keys: SuccessKey[]) => {
    if (!version) return;
    ask.mutate({ projectId, scopeVersionId: version.id, mode, ...(keys.length ? { keys } : {}) },
      { onError: (e: unknown) => setError(scopeErrorMessage(e)) });
  };
  const write = (next: SuccessTargets, then: () => void) => {
    if (!version) return;
    setError(null);
    save.mutate({ projectId, scopeVersionId: version.id, targets: next }, {
      onSuccess: then,
      onError: (e: unknown) => setError(scopeErrorMessage(e)),
    });
  };

  let body;
  if (doc.error) body = <PartError text={doc.error} onRetry={doc.retry} />;
  else if (doc.loading) body = <PartSkeleton rows={4} />;
  else if (!version || blank) body = <PartPlaceholder working={doc.drafting} text={doc.drafting
    ? t("analysis.scopeSummary.successDrafting", "Your business analyst is drafting the scope, success targets included. They appear here when the draft is ready.")
    : t("analysis.scopeSummary.successNone", "No targets yet. Your business analyst proposes them from the project's goal and users while drafting the scope.")} />;
  else {
    const open = doc.page.phase === "draft" ? successIssues(targets) : [];
    body = (
      <div className="flex flex-col gap-3">
        {open.length > 0 && <p className="text-[13px] text-ink2">{open.join(" · ")}</p>}
        <div className="overflow-hidden rounded-block ring-1 ring-line">
          <div aria-hidden className="hidden grid-cols-[10rem_1fr_minmax(10rem,15rem)_auto] gap-4 bg-surface2/60 px-4 py-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink3 md:grid">
            <span>{t("analysis.scopeSummary.colMetric", "Metric")}</span><span>{t("analysis.scopeSummary.colTarget", "Target")}</span><span>{t("analysis.scopeSummary.colHowChecked", "How it is checked")}</span><span className="w-[7rem]">{t("analysis.scopeSummary.colState", "State")}</span>
          </div>
          <dl className="divide-y divide-line">
            {SUCCESS_KEYS.map((k) => {
              const tg = targets[k];
              const st = targetState(tg);
              const q = tg.question;
              return (
                <FeedbackItem key={k} type="success" id={k}
                  className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[10rem_1fr_minmax(10rem,15rem)_auto] md:items-start">
                  <dt className="text-[13px] font-medium text-ink3 md:pt-px">
                    {successShortName(k)}{k === "availability" && <span className="ml-1 font-normal">· {t("analysis.scopeSummary.optional", "optional")}</span>}
                  </dt>
                  <dd className="min-w-0 text-[14px] text-ink">
                    {st === "set" ? tg.value
                      : st === "missing" ? <span className="text-ink3">{k === "availability" ? t("analysis.scopeSummary.notGiven", "Not given") : t("analysis.scopeSummary.notSetYet", "Not set yet")}</span>
                      : <span className="text-ink2">{q?.text ?? t("analysis.scopeSummary.notSureYet", "Not sure yet")}</span>}
                    {st === "set" && tg.suggested && <span className="ml-2 text-[12px] text-[rgb(var(--c-ai-text))]">{t("analysis.scopeSummary.proposedByAnalyst", "proposed by your business analyst")}</span>}
                    {st !== "set" && q?.answer && (
                      <span className="mt-1 block rounded-block bg-ai-soft px-2.5 py-1.5 text-[13px] text-[rgb(var(--c-ai-text))]">
                        {t("analysis.scopeSummary.analystAnswer", "Your business analyst: {answer}", { answer: q.answer })}
                      </span>
                    )}
                  </dd>
                  <dd className="text-[12.5px] text-ink2 md:pt-px"><span className="text-ink3 md:hidden">{t("analysis.scopeSummary.howCheckedPrefix", "How it is checked: ")}</span>{howChecked(k)}</dd>
                  <dd className="flex items-center gap-1.5 md:min-w-[7rem] md:justify-end">
                    {st === "missing" && k === "availability" ? null : <Chip tone={stateChip(tg, st, locked).tone}>{stateChip(tg, st, locked).text}</Chip>}
                    <ScopeFeedbackButton target={{ type: "success", id: k }} className="-my-1"
                      label={`${successShortName(k)}${st === "set" ? `: ${tg.value.trim()}` : ""}`} />
                  </dd>
                </FeedbackItem>
              );
            })}
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(version || editable) && (
        <div className="flex flex-wrap items-center gap-2">
          {version && versionChip(doc)}
          {editable && (
            <Button size="sm" variant="ghost" className="ml-auto" icon={<PencilLine size={14} aria-hidden />} onClick={() => setEditing(true)}>
              {blank ? t("analysis.scopeSummary.setTargets", "Set targets") : t("analysis.scopeSummary.editTargets", "Edit targets")}
            </Button>
          )}
        </div>
      )}
      {body}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {editable && version && (
        <SuccessWindow open={editing} onClose={() => setEditing(false)} targets={targets} projectName={doc.ctx.project?.name ?? ""} focusKey={null}
          saving={save.isPending} error={error}
          onSave={(next) => write(next, () => {
            setEditing(false);
            // a newly ticked "Not sure yet" is sent on straight away, as on the Scope & success page
            const open = openQuestionKeys(next);
            if (open.some((k) => targetState(targets[k]) !== "open")) askAnalyst("answer", open);
          })}
          onSaveAndPropose={(next) => write(next, () => { setEditing(false); askAnalyst("propose", emptyKeys(next)); })} />
      )}
    </div>
  );
}

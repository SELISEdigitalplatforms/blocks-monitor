/** Success & performance on the Scope & success page: what outcome makes the project a success, expected users, how
 *  fast it should feel, data volume and (optional) peak times. A value can be marked "Not sure yet — ask the business
 *  analyst": it becomes a question for your business analyst, who answers it when asked (a scope.success engine job); the team uses
 *  the answer, changes it, or goes ahead without a fixed value. Open questions stop the lock (the op checks again).
 *  Editing happens in one window; the section shows the agreed values and the questions. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, HelpCircle, Lightbulb, Loader, MessageSquareReply, Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ScopeContext } from "@/blocks/scope/context";
import { useScopeJobs } from "@/blocks/scope/hooks";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import { useSuccessAsk, useSuccessSave } from "@/blocks/scope/mutations";
import { blocksKeys } from "@/blocks/data/keys";
import {
  DATA_CHOICES, RESPONSE_TIME_CHOICES, SUCCESS_KEYS, USER_CHOICES,
  acceptOpen, emptyKeys, isBlank, markUnsure, openQuestionKeys, reopen, setAgreement, setValue, successSummary, targetState, takeAnswer,
  type Choice, type SuccessKey, type SuccessTarget, type SuccessTargets, type TargetState,
} from "@/domain/successTargets";
import {
  setAgreementName, successChoiceName, successHint, successPlaceholder, successQuestionName, successShortName,
} from "@/components/requirements/domainLabels";
import { Button, Card, Chip, Input, Modal, Textarea } from "@/ui/kit";
import { FeedbackItem } from "@/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./ScopeFeedback";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";

export const SUCCESS_SECTION_ID = "scope-success";

const CHOICES: Partial<Record<SuccessKey, readonly Choice[]>> = { users: USER_CHOICES, responseTime: RESPONSE_TIME_CHOICES, dataVolume: DATA_CHOICES };
const ACTIVE = new Set(["queued", "claimed", "running"]);
const now = () => new Date().toISOString();

const STATE_CHIP: Record<TargetState, { tone: "success" | "warning" | "ai" | "neutral" | "accent"; text: string }> = {
  set: { tone: "success", get text() { return t("analysis.scope.success.stateSet", "Agreed"); } },
  missing: { tone: "neutral", get text() { return t("analysis.scope.success.stateMissing", "Not set"); } },
  open: { tone: "warning", get text() { return t("analysis.scope.success.stateOpen", "Question for your business analyst"); } },
  proposed: { tone: "ai", get text() { return t("analysis.scope.success.stateProposed", "Your business analyst answered"); } },
  accepted: { tone: "neutral", get text() { return t("analysis.scope.success.stateAccepted", "Going ahead without a fixed value"); } },
};

/* ── the window ─────────────────────────────────────────────────────────────────────────────────────────────── */

function TargetField({ k, tg, onChange, onUnsure }: {
  k: SuccessKey; tg: SuccessTarget; onChange: (value: string, choice?: string) => void; onUnsure: (unsure: boolean) => void;
}) {
  const t = useT();
  const id = `success-${k}`;
  const choices = CHOICES[k];
  const unsure = tg.unsure;
  return (
    <div className={cn("rounded-block p-4 ring-1", unsure ? "bg-surface2 ring-transparent" : "bg-surface ring-line")}>
      <label htmlFor={id} className="block text-[14px] font-medium text-ink">
        {successQuestionName(k)}{k === "availability" && <span className="ml-1.5 text-[12px] font-normal text-ink3">{t("analysis.scope.success.optional", "optional")}</span>}
      </label>
      <p className="mt-0.5 text-[12.5px] text-ink3">{successHint(k)}</p>
      {choices && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={t("analysis.scope.success.choices", "{name} choices", { name: successShortName(k) })}>
          {choices.map((c) => {
            const on = !unsure && (tg.choice === c.id || tg.value === c.value);
            return (
              <button key={c.id} type="button" disabled={unsure} aria-pressed={on} onClick={() => onChange(c.value, k === "responseTime" ? c.id : "")}
                title={c.value}
                className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium outline-none ring-1 transition focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45",
                  on ? "bg-accent text-white ring-accent" : "bg-surface text-ink ring-line hover:bg-surface2")}>
                {successChoiceName(k, c)}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2.5">
        {k === "outcome" ? (
          <Textarea id={id} rows={2} className="min-h-[64px]" value={tg.value} disabled={unsure} maxLength={300}
            placeholder={successPlaceholder(k)} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input id={id} value={tg.value} disabled={unsure} maxLength={300}
            placeholder={choices ? t("analysis.scope.success.exactValue", "Exact value, {example}", { example: successPlaceholder(k) }) : successPlaceholder(k)} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
      <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[13px] text-ink2">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-accent))]" checked={unsure} onChange={(e) => onUnsure(e.target.checked)} />
        <span>
          {t("analysis.scope.success.notSure", "Not sure yet — ask the business analyst")}
          {unsure && <span className="mt-0.5 block text-[12.5px] text-ink3">{t("analysis.scope.success.getsQuestion", "Your business analyst gets the question: “{question}”", { question: tg.question?.text || "" })}</span>}
        </span>
      </label>
      {tg.suggested && !unsure && <p className="mt-1.5 text-[12px] text-[rgb(var(--c-ai-text))]">{t("analysis.scope.success.proposedChange", "Proposed by your business analyst. Change it if it doesn't fit.")}</p>}
    </div>
  );
}

export function SuccessWindow({ open, onClose, targets, projectName, focusKey, saving, error, onSave, onSaveAndPropose }: {
  open: boolean; onClose: () => void; targets: SuccessTargets; projectName: string; focusKey: SuccessKey | null;
  saving: boolean; error: string | null; onSave: (tg: SuccessTargets) => void; onSaveAndPropose: (tg: SuccessTargets) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<SuccessTargets>(targets);
  const opened = useRef(false);
  useEffect(() => {
    if (open && !opened.current) setDraft(targets);
    opened.current = open;
  }, [open, targets]);
  useEffect(() => {
    if (!open || !focusKey) return;
    const timer = setTimeout(() => document.getElementById(`success-${focusKey}`)?.scrollIntoView({ block: "center" }), 60);
    return () => clearTimeout(timer);
  }, [open, focusKey]);

  const change = (k: SuccessKey, fn: (tg: SuccessTarget) => SuccessTarget) => setDraft((d) => ({ ...d, [k]: fn(d[k]) }));
  const anyEmpty = emptyKeys(draft).length > 0;

  return (
    <Modal open={open} onClose={onClose} width={680} title={t("analysis.scope.success.title", "Success & performance")}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t("analysis.scope.cancel", "Cancel")}</Button>
        {anyEmpty && (
          <Button variant="ai" icon={<Lightbulb size={15} aria-hidden />} disabled={saving} onClick={() => onSaveAndPropose(draft)}>{t("analysis.scope.success.askSuggest", "Ask your business analyst to suggest targets")}</Button>
        )}
        <Button variant="primary" disabled={saving} onClick={() => onSave(draft)}>{saving ? t("analysis.scope.saving", "Saving…") : t("analysis.scope.save", "Save")}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-ink2">
          {t("analysis.scope.success.windowIntro", "How will we know it worked, and how should it perform? Choose an answer or type the exact value. If you don't know yet, tick “Not sure yet” and your business analyst gets the question.")}
        </p>
        {SUCCESS_KEYS.map((k) => (
          <TargetField key={k} k={k} tg={draft[k]}
            onChange={(value, choice) => change(k, (tg) => setValue(tg, value, "", now(), choice ?? (k === "responseTime" ? "" : tg.choice)))}
            onUnsure={(u) => change(k, (tg) => (u ? markUnsure(tg, k, "", now(), projectName) : { ...tg, unsure: false, question: tg.question && tg.question.status === "answered" ? tg.question : null }))} />
        ))}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ── the section ────────────────────────────────────────────────────────────────────────────────────────────── */

export function SuccessSection({ ctx, versionId, targets, editable, projectName, windowOpen, focusKey, onWindow, locked = false }: {
  ctx: ScopeContext; versionId: string | null; targets: SuccessTargets; editable: boolean; projectName: string;
  windowOpen: boolean; focusKey: SuccessKey | null; onWindow: (open: boolean, k?: SuccessKey | null) => void;
  /** the scope is locked (or built): the business analyst's untouched proposals were agreed with it */
  locked?: boolean;
}) {
  const t = useT();
  const client = useQueryClient();
  const save = useSuccessSave(ctx);
  const ask = useSuccessAsk(ctx);
  const job = useScopeJobs(ctx).success;
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(job && ACTIVE.has(job.status));
  const blank = isBlank(targets);
  const sum = successSummary(targets);
  const questions = useMemo(() => SUCCESS_KEYS.filter((k) => targets[k].unsure && targets[k].question), [targets]);

  // the engine wrote the version: read it again as soon as the job is done (not on the next poll)
  const lastStatus = useRef(job?.status);
  useEffect(() => {
    if (lastStatus.current && ACTIVE.has(lastStatus.current) && job && !ACTIVE.has(job.status) && ctx.workspaceId) {
      void client.invalidateQueries({ queryKey: [...blocksKeys.schema(ctx.workspaceId, "ScopeVersion")] });
    }
    lastStatus.current = job?.status;
  }, [job, job?.status, client, ctx.workspaceId]);

  const write = (next: SuccessTargets, then?: () => void) => {
    if (!versionId) return;
    setError(null);
    save.mutate({ projectId: ctx.projectId, scopeVersionId: versionId, targets: next }, {
      onSuccess: () => then?.(),
      onError: (e: unknown) => setError(scopeErrorMessage(e)),
    });
  };
  const askAnalyst = (mode: "propose" | "answer", keys?: SuccessKey[]) => {
    if (!versionId) return;
    setError(null);
    ask.mutate({ projectId: ctx.projectId, scopeVersionId: versionId, mode, ...(keys?.length ? { keys } : {}) },
      { onError: (e: unknown) => setError(scopeErrorMessage(e)) });
  };
  const update = (k: SuccessKey, fn: (tg: SuccessTarget) => SuccessTarget) => write({ ...targets, [k]: fn(targets[k]) });
  const openQs = openQuestionKeys(targets);

  return (
    <section id={SUCCESS_SECTION_ID} tabIndex={-1} aria-labelledby="scope-success-heading" className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
      <Card title={<span id="scope-success-heading" className="inline-flex items-center gap-2"><Gauge size={18} strokeWidth={1.75} aria-hidden />{t("analysis.scope.success.title", "Success & performance")}</span>}
        action={editable && !blank ? <Button size="sm" variant="ghost" onClick={() => onWindow(true, null)}>{t("analysis.scope.edit", "Edit")}</Button> : undefined}>
        <p className="max-w-[70ch] text-[14px] text-ink2">
          {t("analysis.scope.success.intro", "What success looks like and how the product should perform. Your team plans, builds and tests against these targets.")}
        </p>

        {busy && job && (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-block bg-ai-soft px-3.5 py-2.5 text-[13px] text-[rgb(var(--c-ai-text))]">
            <Loader size={15} aria-hidden className="shrink-0 animate-pulse" />
            {job.message ? t("analysis.scope.success.workingOnItMessage", "Your business analyst is working on it: {message}", { message: job.message }) : t("analysis.scope.success.workingOnIt", "Your business analyst is working on it…")}
          </p>
        )}

        {blank ? (
          <div className="mt-4 rounded-block bg-surface2 px-4 py-4">
            <p className="text-[14px] text-ink">{t("analysis.scope.success.notSetYetDot", "Not set yet.")}</p>
            <p className="mt-0.5 text-[13px] text-ink2">{t("analysis.scope.success.blankHint", "Set the outcome, expected users, response time and data volume, or let your business analyst propose them from the project's goal and users.")}</p>
            {editable && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onWindow(true, null)}>{t("analysis.scope.success.setTargets", "Set targets")}</Button>
                <Button variant="ai" size="sm" icon={<Lightbulb size={14} aria-hidden />} disabled={busy || ask.isPending} onClick={() => askAnalyst("propose")}>
                  {t("analysis.scope.success.askPropose", "Ask your business analyst to propose")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <dl className="mt-4 divide-y divide-line overflow-hidden rounded-block ring-1 ring-line">
            {SUCCESS_KEYS.map((k) => {
              const tg = targets[k];
              const st = targetState(tg);
              // a set value is "Agreed" only when someone agreed it: an untouched proposal is "Proposed" until the lock
              const agreement = st === "set" ? setAgreement(tg, locked) : null;
              const chip = agreement ? { tone: agreement === "proposed" ? "ai" as const : "success" as const, text: setAgreementName(agreement) } : STATE_CHIP[st];
              return (
                <FeedbackItem key={k} type="success" id={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-center sm:gap-4">
                  <dt className="text-[13px] font-medium text-ink3">{successShortName(k)}{k === "availability" && <span className="ml-1 font-normal">· {t("analysis.scope.success.optional", "optional")}</span>}</dt>
                  <dd className="min-w-0 text-[14px] text-ink">
                    {tg.value.trim() && st === "set" ? tg.value
                      : st === "missing" ? <span className="text-ink3">{k === "availability" ? t("analysis.scope.success.notGiven", "Not given") : t("analysis.scope.success.notSetYet", "Not set yet")}</span>
                      : <span className="text-ink2">{tg.question?.text}</span>}
                    {tg.suggested && st === "set" && <span className="ml-2 text-[12px] text-[rgb(var(--c-ai-text))]">{t("analysis.scope.success.proposedByBa", "proposed by your business analyst")}</span>}
                  </dd>
                  <dd className="flex items-center gap-1.5 sm:justify-self-end">
                    {st === "missing" && k === "availability" ? null : <Chip tone={chip.tone}>{chip.text}</Chip>}
                    <ScopeFeedbackButton target={{ type: "success", id: k }} className="-my-1"
                      label={`${successShortName(k)}${tg.value.trim() && st === "set" ? `: ${tg.value.trim()}` : ""}`} />
                  </dd>
                </FeedbackItem>
              );
            })}
          </dl>
        )}

        {questions.length > 0 && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-medium">
                <HelpCircle size={16} strokeWidth={1.75} aria-hidden />{t("analysis.scope.success.questions", "Questions for the business analyst")}
                <span className="num text-ink3">{sum.openQuestions + sum.waitingForTeam}</span>
              </h3>
              {editable && openQs.length > 0 && (
                <Button variant="ai" size="sm" icon={<MessageSquareReply size={14} aria-hidden />} disabled={busy || ask.isPending} onClick={() => askAnalyst("answer", openQs)}>
                  {busy ? t("analysis.scope.success.answering", "Your business analyst is answering…") : openQs.length > 1 ? t("analysis.scope.success.askAnswerN", "Ask your business analyst to answer ({count})", { count: openQs.length }) : t("analysis.scope.success.askAnswer", "Ask your business analyst to answer")}
                </Button>
              )}
            </div>
            <p className="mt-1 text-[13px] text-ink3">{t("analysis.scope.success.eachOne", "Each one must be answered or accepted before the scope can be locked.")}</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {questions.map((k) => {
                const tg = targets[k];
                const q = tg.question!;
                const st = targetState(tg);
                return (
                  <li key={k} className="rounded-block bg-surface2 px-4 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-ink3">{successShortName(k)}</p>
                        <p className="text-[14px] font-medium text-ink">{q.text}</p>
                      </div>
                      <Chip tone={STATE_CHIP[st].tone}>{st === "open" ? (busy ? t("analysis.scope.success.answeringChip", "Your business analyst is answering") : t("analysis.scope.success.notAnswered", "Not answered yet")) : st === "proposed" ? t("analysis.scope.success.answerToReview", "Answer to review") : STATE_CHIP[st].text}</Chip>
                    </div>
                    {q.answer && (
                      <div className="mt-2.5 rounded-block bg-surface px-3.5 py-2.5 ring-1 ring-line">
                        <p className="text-[12px] font-medium text-[rgb(var(--c-ai-text))]">{t("analysis.scope.success.yourBa", "Your business analyst")}</p>
                        <p className="mt-0.5 text-[14px] text-ink">{q.answer}</p>
                        {q.reason && <p className="mt-1 text-[12.5px] text-ink2">{q.reason}</p>}
                      </div>
                    )}
                    {editable && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {st === "proposed" && <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => update(k, (x) => takeAnswer(x, "", now()))}>{t("analysis.scope.success.useAnswer", "Use this answer")}</Button>}
                        {(st === "open" || st === "proposed") && <Button size="sm" variant="ghost" onClick={() => onWindow(true, k)}>{t("analysis.scope.success.answerMyself", "Answer it myself")}</Button>}
                        {(st === "open" || st === "proposed") && (
                          <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => update(k, (x) => acceptOpen(x, "", now()))}
                            title={q.answer ? t("analysis.scope.success.assumption", "Your business analyst's answer stays as the working assumption") : t("analysis.scope.success.duringBuild", "The build goes ahead and your business analyst proposes a value during the build")}>
                            {t("analysis.scope.success.goAhead", "Go ahead without a fixed value")}
                          </Button>
                        )}
                        {st === "accepted" && (
                          <Button size="sm" variant="ghost" icon={<Undo2 size={14} aria-hidden />} disabled={save.isPending} onClick={() => update(k, reopen)}>{t("analysis.scope.success.reopen", "Reopen")}</Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      </Card>
      <SuccessWindow open={windowOpen} onClose={() => onWindow(false)} targets={targets} projectName={projectName} focusKey={focusKey}
        saving={save.isPending} error={error}
        onSave={(tg) => write(tg, () => {
          onWindow(false);
          // a newly ticked "Not sure yet" goes to your business analyst straight away: answered behind the scenes, you review
          const open = openQuestionKeys(tg);
          if (open.some((k) => targetState(targets[k]) !== "open")) askAnalyst("answer", open);
        })}
        onSaveAndPropose={(tg) => write(tg, () => { onWindow(false); askAnalyst("propose", emptyKeys(tg)); })} />
    </section>
  );
}

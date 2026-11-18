/** The parts of a change request's light SDLC (CHANGE-PROCESS-31.10): the lifecycle bar, the business analyst's line,
 *  the analysis card, the questions and the approval. Presentational: the change request page passes real rows and the
 *  delivery ops (cr.answer, cr.decide); nothing here reads a store or invents a value. */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, CircleSlash, ListChecks, Loader, Pencil, X } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Button, Card, Chip, Input, Label, Textarea } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { EasedJobBar } from "@/madp/components/engine/EasedJobBar";
import { CHANGE_ANALYSIS_LIMITS, type ChangeAnalysis, type ChangeAnalysisQuestion } from "@/madp/domain/changeAnalysis";
import { LIMITS } from "@/madp/domain/delivery";
import { KIND_WORD, buildCount, partsText, ticketCount, type ChangeDecision, type IncrementState, type LifecycleStep } from "./changeFlow";
import { incrementsOf } from "@/madp/domain/changeAnalysis";
import type { ChangeDecideRight } from "./changeDecide";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import type { FeedbackAttachmentRecord } from "@/madp/blocks/collab/records";
import type { TalkFile } from "@/madp/blocks/collab/talkUpload";
import { t, useT } from "@/madp/i18n";

/** The files sent with an answer: the ready uploads and their draft key. */
type SentWith = { attachmentIds: string[]; draftKey: string };

// ---------------------------------------------------------------- lifecycle bar

/** Requested → Analysis → Questions → Approval → Build → Development → Staging → Production, as the journey stepper. */
export function ChangeLifecycleBar({ steps, className }: { steps: readonly LifecycleStep[]; className?: string }) {
  const t = useT();
  return (
    <ol aria-label={t("changes.lifecycle.steps", "Change request steps")} className={cn("grid min-w-0 grid-cols-4 gap-x-1.5 gap-y-3 sm:grid-cols-8", className)}>
      {steps.map((s, i) => {
        const bar = s.state === "now"
          ? <ShimmerProgress step={1} total={1} size="sm" active label={t("changes.lifecycle.inProgress", "{step} in progress", { step: s.label })} ticks={false} className="pointer-events-none" />
          : <span aria-hidden className={cn("block h-1.5 w-full rounded-full",
            s.state === "done" ? "bg-success" : s.state === "skipped" ? "bg-success/40" : s.state === "failed" || s.state === "rejected" ? "bg-danger" : "bg-surface2 dark:bg-ink/[0.08]")} />;
        const icon = s.state === "done" ? <Check aria-hidden size={11} strokeWidth={2.5} className="shrink-0 text-success" />
          : s.state === "rejected" ? <CircleSlash aria-hidden size={11} strokeWidth={2.25} className="shrink-0" />
          : s.state === "failed" ? <AlertTriangle aria-hidden size={11} strokeWidth={2.25} className="shrink-0" />
          : null;
        return (
          <li key={s.id} title={s.title} aria-current={s.state === "now" || s.state === "failed" || s.state === "rejected" ? "step" : undefined}
            data-state={s.state} className="flex min-w-0 flex-col gap-1.5 px-1 py-1">
            {bar}
            <span className={cn("flex min-w-0 items-center gap-1 text-[12px] leading-4",
              s.state === "now" ? "font-semibold text-ink" : s.state === "failed" || s.state === "rejected" ? "font-semibold text-[rgb(var(--c-danger-text))]"
                : s.state === "done" ? "font-medium text-ink2" : "text-ink3")}>
              {icon}
              <span className="sr-only">{`Step ${i + 1}: `}</span>
              <span className="truncate">{s.label}</span>
              <span className="sr-only">{`, ${s.title}`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- the business analyst's line

/** "The business analyst is analysing your change…" with the job's real progress (eased), or a working bar. */
export function ChangeAgentLine({ text, progress, working = true, resetKey = "" }: { text: string; progress: number | null; working?: boolean; resetKey?: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-[rgb(var(--c-ai-text))]">
        <Loader size={15} aria-hidden className="shrink-0 animate-pulse motion-reduce:animate-none" />{text}…
      </p>
      <EasedJobBar progress={progress} working={working} resetKey={resetKey} ticks={false} active label={text} size="sm" />
    </div>
  );
}

// ---------------------------------------------------------------- analysis card

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-[12px] font-medium uppercase tracking-wider text-ink3">{title}</h4>
      {children}
    </section>
  );
}

function Bullets({ items, tone }: { items: readonly string[]; tone?: "warning" }) {
  return (
    <ul className="flex min-w-0 flex-col gap-1.5">
      {items.map((t) => (
        <li key={t} className="flex min-w-0 gap-2 text-[14px] leading-relaxed text-ink2">
          {tone === "warning"
            ? <AlertTriangle size={14} strokeWidth={1.75} aria-hidden className="mt-[4px] shrink-0 text-[rgb(var(--c-warning-text))]" />
            : <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink3" />}
          <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
        </li>
      ))}
    </ul>
  );
}

const IMPACT: readonly { key: keyof ChangeAnalysis["impact"]; label: string }[] = [
  { key: "features", get label() { return t("changes.analysis.impact.features", "Features"); } },
  { key: "stories", get label() { return t("changes.analysis.impact.stories", "Stories"); } },
  { key: "screens", get label() { return t("changes.analysis.impact.screens", "Screens"); } },
  { key: "milestones", get label() { return t("changes.analysis.impact.milestones", "Milestones"); } },
];

function TicketList({ analysis, indexes }: { analysis: ChangeAnalysis; indexes: readonly number[] }) {
  return (
    <ol className="flex min-w-0 flex-col gap-2">
      {indexes.map((k) => {
        const t = analysis.tickets[k]!;
        return (
          <li key={`${k}-${t.title}`} className="flex min-w-0 gap-3 rounded-block bg-surface2 px-3.5 py-2.5">
            <span className="num shrink-0 text-[13px] font-medium text-ink3">{k + 1}</span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{t.title}</p>
              {t.description && <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{t.description}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A new feature on an existing product: its builds (increments) in order, each with its goal and tickets, and how far
 *  the board is (`progress`, once the tickets are on the board). */
function FeaturePlanSection({ analysis, progress }: { analysis: ChangeAnalysis; progress?: readonly IncrementState[] | null }) {
  const t = useT();
  const incs = incrementsOf(analysis);
  const nextN = progress?.find((i) => !i.built)?.n ?? null;
  return (
    <Section title={t("changes.analysis.plan", "The plan · {builds} · {tickets}", { builds: buildCount(incs.length), tickets: ticketCount(analysis.tickets.length) })}>
      <p className="max-w-[75ch] text-[13px] leading-relaxed text-ink2">
        {incs.length === 1
          ? t("changes.analysis.planOne", "Built on the existing product in one build, deployed to development for you to try.")
          : t("changes.analysis.planMany", "Built on the existing product one increment at a time: each build goes to development for you to try before the next one starts, so no build is one big risky change.")}
      </p>
      <ol className="flex min-w-0 flex-col gap-4">
        {incs.map((inc) => {
          const p = progress?.find((x) => x.n === inc.n);
          const state = !p ? null : p.built ? t("changes.analysis.incOnDev", "On development") : p.n === nextN ? (p.done > 0 ? t("build.step.chip.nOfDone", "{n} of {of} done", { n: p.done, of: p.tickets.length }) : t("changes.analysis.incNext", "Next to build")) : t("changes.analysis.incLater", "Later");
          return (
            <li key={inc.n} className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 text-[14px] font-medium text-ink [overflow-wrap:anywhere]">
                  {incs.length > 1 ? t("changes.analysis.incTitle", "Increment {n}: {title}", { n: inc.n, title: inc.title }) : inc.title}
                </p>
                {state && <Chip tone={p?.built ? "success" : p?.n === nextN ? "accent" : "neutral"}>{state}</Chip>}
              </div>
              {inc.goal && <p className="max-w-[75ch] text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{inc.goal}</p>}
              <TicketList analysis={analysis} indexes={inc.tickets} />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** What the business analyst found: kind, summary, what it touches, conflicts, risks, acceptance criteria, planned tickets.
 *  A new feature on an existing product shows its plan instead: the parts and code it changes and its builds. */
export function ChangeAnalysisCard({ analysis, refreshing, progress }: { analysis: ChangeAnalysis; refreshing?: boolean; progress?: readonly IncrementState[] | null }) {
  const t = useT();
  const touched = IMPACT.filter((g) => analysis.impact[g.key].length > 0);
  const feature = analysis.route === "feature" ? analysis.feature ?? null : null;
  const parts = feature ? partsText(feature.parts) : "";
  return (
    <Card title={t("changes.analysis.title", "The business analyst's analysis")} icon={<ListChecks size={18} strokeWidth={1.75} aria-hidden />}>
      <div className={cn("flex min-w-0 flex-col gap-5", refreshing && "opacity-70")}>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={analysis.kind === "feature" ? "warning" : analysis.kind === "fix" ? "accent" : "ai"}>{KIND_WORD[analysis.kind]}</Chip>
            <Chip>{t("changes.analysis.estimate", "Estimate: {tickets}", { tickets: ticketCount(analysis.estimate.tickets) })}</Chip>
            {analysis.route === "scope" && <Chip tone="warning">{t("changes.analysis.viaScope", "Goes through Scope & success")}</Chip>}
            {feature && <Chip tone="accent">{t("changes.analysis.onProduct", "Builds on the existing product")}</Chip>}
            {feature && feature.increments.length > 1 && <Chip>{t("changes.analysis.inBuilds", "In {builds}", { builds: buildCount(feature.increments.length) })}</Chip>}
          </div>
          {analysis.summary
            ? <p className="max-w-[75ch] text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">{analysis.summary}</p>
            : <p className="text-[14px] text-ink3">{t("changes.analysis.noSummary", "No summary was written.")}</p>}
        </div>

        {feature ? (
          <Section title={t("changes.analysis.changes", "What it changes")}>
            <p className="text-[14px] leading-relaxed text-ink2">{parts ? t("changes.analysis.parts", "The product's {parts}.", { parts }) : t("changes.analysis.noParts", "No part of the product was named.")}</p>
            {analysis.codeAreas?.length ? (
              <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t("changes.analysis.codeAreas", "Where it lands in the code")}>
                {analysis.codeAreas.map((c) => <li key={c}><Chip className="max-w-full whitespace-normal font-mono text-[12px] [overflow-wrap:anywhere]">{c}</Chip></li>)}
              </ul>
            ) : null}
          </Section>
        ) : (
        <Section title={t("changes.analysis.touches", "What it touches")}>
          {touched.length === 0 ? <p className="text-[14px] text-ink3">{t("changes.analysis.touchesNone", "Nothing else in the scope is touched.")}</p> : (
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
              {touched.map((g) => (
                <div key={g.key} className="min-w-0">
                  <dt className="text-[12px] font-medium text-ink2">{g.label}</dt>
                  <dd className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                    {analysis.impact[g.key].map((n) => <Chip key={n} className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{n}</Chip>)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
        )}

        <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <Section title={t("changes.analysis.conflicts", "Conflicts")}>
            {analysis.conflicts.length ? <Bullets items={analysis.conflicts} tone="warning" />
              : <p className="text-[14px] text-ink3">{feature ? t("changes.analysis.noConflictsProduct", "No conflicts with what the product does today.") : t("changes.analysis.noConflicts", "No conflicts with the locked scope.")}</p>}
          </Section>
          <Section title={t("changes.analysis.risks", "Risks")}>
            {analysis.risks.length ? <Bullets items={analysis.risks} tone="warning" /> : <p className="text-[14px] text-ink3">{t("changes.analysis.noRisks", "No risks named.")}</p>}
          </Section>
        </div>

        <Section title={t("changes.analysis.criteria", "Acceptance criteria")}>
          {analysis.acceptanceCriteria.length ? (
            <ul className="flex min-w-0 flex-col gap-1.5">
              {analysis.acceptanceCriteria.map((c) => (
                <li key={c} className="flex min-w-0 gap-2 text-[14px] leading-relaxed text-ink2">
                  <Check size={14} strokeWidth={2} aria-hidden className="mt-[4px] shrink-0 text-success" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-ink3">{t("changes.analysis.noCriteria", "No acceptance criteria yet.")}</p>}
        </Section>

        {feature ? <FeaturePlanSection analysis={analysis} progress={progress} /> : (
          <Section title={t("changes.analysis.planned", "Planned tickets · {tickets}", { tickets: ticketCount(analysis.estimate.tickets) })}>
            {analysis.tickets.length ? <TicketList analysis={analysis} indexes={analysis.tickets.map((_t, k) => k)} />
              : <p className="text-[14px] text-ink3">{t("build.step.work.none", "No tickets planned yet")}.</p>}
          </Section>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- questions

/** One question: one-click options plus "Other…" (free text). Each answer is saved at once. */
function QuestionRow({ q, n, disabled, saving, onAnswer, nameOf, attach, sent, viewProjectId }: {
  q: ChangeAnalysisQuestion; n: number; disabled: boolean; saving: boolean;
  onAnswer: (answer: string, files?: SentWith) => Promise<boolean>; nameOf: (id: string | null) => string;
  /** Files may go with the answer (a design, a document): the change request they are uploaded for. */
  attach?: { projectId: string; changeRequestId: string } | null;
  /** The files already sent with this answer (opened in this project). */
  sent?: readonly FeedbackAttachmentRecord[];
  viewProjectId?: string;
}) {
  const t = useT();
  const custom = q.answer !== null && !q.options.includes(q.answer);
  const [other, setOther] = useState(false);
  const [text, setText] = useState(custom ? q.answer ?? "" : "");
  const fieldId = `cr-other-${q.id}`;
  const files = useAttachDraft({ projectId: attach?.projectId ?? "", owner: { ownerType: "change-request", forId: attach?.changeRequestId ?? null }, disabled: disabled || !attach });
  const hold = attachHold(files);
  const pick = async (a: string) => {
    if (hold) return;
    const with_ = files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : undefined;
    if (await onAnswer(a, with_)) { setOther(false); files.reset(); }
  };
  return (
    <li className="min-w-0 rounded-block bg-surface2 p-4">
      <p className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]"><span className="sr-only">{t("changes.questions.number", "Question {n}: ", { n })}</span>{q.text}</p>
      <div role="group" aria-label={q.text} className="mt-3 flex min-w-0 flex-wrap gap-2">
        {q.options.map((o) => {
          const on = q.answer === o;
          return (
            <button key={o} type="button" aria-pressed={on} disabled={disabled || !!hold} onClick={() => void pick(o)}
              className={cn("inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3.5 py-1.5 text-left text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-70 [overflow-wrap:anywhere]",
                "outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                on ? "bg-accent text-white" : "bg-surface text-ink ring-1 ring-line hover:bg-line")}>
              {on && <Check size={13} strokeWidth={2.5} aria-hidden className="shrink-0" />}{o}
            </button>
          );
        })}
        <button type="button" aria-pressed={custom || other} aria-expanded={other} aria-controls={fieldId} disabled={disabled}
          onClick={() => setOther((v) => !v)}
          className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-70",
            "outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
            custom ? "bg-accent text-white" : "bg-surface text-ink ring-1 ring-line hover:bg-line")}>
          {custom ? <Check size={13} strokeWidth={2.5} aria-hidden /> : <Pencil size={13} strokeWidth={1.75} aria-hidden />}{t("changes.questions.other", "Other…")}
        </button>
      </div>
      {other && (
        <form className="mt-3 flex min-w-0 flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void pick(text.trim()); }}>
          <label htmlFor={fieldId} className="sr-only">{t("changes.questions.yourAnswer", "Your answer")}</label>
          <Input id={fieldId} autoFocus value={text} maxLength={CHANGE_ANALYSIS_LIMITS.answer} disabled={disabled} placeholder={t("changes.questions.yourAnswer", "Your answer")}
            className="min-w-0 flex-1 basis-56" onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" disabled={disabled || !text.trim() || !!hold}>{t("changes.questions.save", "Save answer")}</Button>
        </form>
      )}
      {attach && (
        <AttachZone draft={files} className="mt-2">
          <AttachChipList draft={files} disabled={disabled} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AttachButton draft={files} disabled={disabled} label={t("changes.questions.attach", "Attach files to the answer to question {n}", { n })} className="!h-8 !w-8" />
            <span className="text-[12px] text-ink3">{hold || (files.ids.length ? t("changes.questions.filesGo", "The files go with the answer you pick or save.") : t("changes.questions.filesHint", "Add a design, a screenshot or a document if it helps."))}</span>
          </div>
        </AttachZone>
      )}
      {viewProjectId && <SentFiles projectId={viewProjectId} files={sent} />}
      <p className="mt-2 text-[12px] text-ink3 empty:mt-0" aria-live="polite">
        {saving ? t("changes.questions.saving", "Saving…")
          : q.answer === null ? ""
            : custom ? (q.answeredBy ? t("changes.questions.answeredOwnBy", "Answered: “{answer}” by {name}", { answer: q.answer, name: nameOf(q.answeredBy) }) : t("changes.questions.answeredOwn", "Answered: “{answer}”", { answer: q.answer }))
              : q.answeredBy ? t("changes.questions.answeredBy", "Answered by {name}", { name: nameOf(q.answeredBy) }) : t("changes.questions.answered", "Answered")}
      </p>
    </li>
  );
}

export function ChangeQuestionsCard({ questions, canAnswer, refining, savingId, error, onAnswer, nameOf, attach, files }: {
  questions: readonly ChangeAnalysisQuestion[];
  canAnswer: boolean;
  /** every question is answered and the analysis is being refined: the answers are read-only meanwhile */
  refining: boolean;
  savingId: string | null;
  error: string | null;
  onAnswer: (id: string, answer: string, files?: SentWith) => Promise<boolean>;
  nameOf: (id: string | null) => string;
  /** Files may go with an answer (the change request they are uploaded for); absent: answers are words only. */
  attach?: { projectId: string; changeRequestId: string } | null;
  /** The files sent with the change request and its answers. */
  files?: readonly TalkFile[];
}) {
  const t = useT();
  const left = questions.filter((q) => q.answer === null).length;
  return (
    <Card title={t("changes.questions.title", "Questions from the business analyst")}>
      <p className="text-[13px] leading-relaxed text-ink2">
        {refining ? t("changes.questions.refining", "Thanks. Every question is answered; the analysis is being refined with your answers.")
          : left === 0 ? t("changes.questions.allAnswered", "Every question is answered; the analysis above uses these answers.")
          : !canAnswer ? t("changes.questions.teamAnswers", "The project team answers these questions.")
          : left === questions.length ? t("changes.questions.pick", "Pick an answer, or write your own with “Other…”. Each answer is saved at once.")
          : t("changes.questions.left", "{left} of {total} still open. Each answer is saved at once.", { left, total: questions.length })}
      </p>
      <ol className="mt-4 flex min-w-0 flex-col gap-3">
        {questions.map((q, i) => (
          <QuestionRow key={q.id} q={q} n={i + 1} nameOf={nameOf} saving={savingId === q.id}
            disabled={!canAnswer || refining || savingId !== null} onAnswer={(a, f) => onAnswer(q.id, a, f)}
            attach={attach && canAnswer ? attach : null} sent={files?.filter((x) => x.questionId === q.id)} viewProjectId={attach?.projectId} />
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- approval

function when(at: string | null): string {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** Who decided and how: "Approved by Ana · 31 Oct 2026, 11:02 · self-approved as the only approver", and the note. */
export function ChangeDecisionLine({ decision, approved, nameOf }: { decision: ChangeDecision; approved: boolean; nameOf: (id: string | null) => string }) {
  const t = useT();
  if (!decision.decidedAt && !decision.decidedByUserId) return null;
  const by = decision.decidedByUserId ? nameOf(decision.decidedByUserId) : "";
  const verdict = approved
    ? (by ? t("changes.decision.approvedBy", "Approved by {name}", { name: by }) : t("changes.decision.approved", "Approved"))
    : (by ? t("changes.decision.rejectedBy", "Rejected by {name}", { name: by }) : t("changes.decision.rejected", "Rejected"));
  const parts = [verdict, when(decision.decidedAt),
    decision.selfApproved ? (approved ? t("changes.decision.selfApproved", "self-approved as the only approver") : t("changes.decision.onlyApprover", "as the only approver")) : ""].filter(Boolean);
  return (
    <div className="text-[13px] text-ink2">
      <p>{parts.join(" · ")}</p>
      {decision.decisionNote && <p className="mt-1 [overflow-wrap:anywhere]">“{decision.decisionNote}”</p>}
    </div>
  );
}

/** "Approve change" and "Reject" with an optional note; the same approver rule and wording as the release approvals.
 *  A change the analysis sends through Scope & success gets its two real ways forward instead of a plain approval:
 *  build it now as a change to what is there (route "fast"), or keep it for a new scope version. */
export function ChangeApprovalCard({ right, busy, error, onDecide, nameOf, scopeRoute = false, isFeature = false, featurePlan = null }: {
  right: ChangeDecideRight;
  busy: boolean;
  error: string | null;
  onDecide: (decision: "approve" | "reject", note: string, route?: "fast") => Promise<boolean>;
  nameOf: (id: string | null) => string;
  /** the analysis routes the change through Scope & success */
  scopeRoute?: boolean;
  /** the analysis judged it a new feature (not a clash with a detail of the locked scope) */
  isFeature?: boolean;
  /** a new feature on an existing product (route "feature"): its builds and tickets */
  featurePlan?: { builds: number; tickets: number } | null;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "fast" | "reject" | null>(null);
  const fieldId = "cr-decision-note";
  const go = async (d: "approve" | "reject", route?: "fast") => {
    setPending(route ?? d);
    try { if (await onDecide(d, note.trim(), route)) setNote(""); } finally { setPending(null); }
  };
  const others = right.ok ? [] : right.others.map((u) => nameOf(u)).filter(Boolean);
  const anyOf = others.join(t("changes.approval.or", " or "));
  return (
    <Card title={t("changes.step.approval", "Approval")}>
      {right.ok ? (
        <div className="flex min-w-0 flex-col gap-3">
          {scopeRoute ? (
            <p className="text-[13px] leading-relaxed text-ink2">
              {isFeature ? t("changes.approval.newWork", "The business analyst sees this as new work beyond the locked scope.") : t("changes.approval.differs", "The business analyst found that this differs from the locked scope.")}{" "}
              {t("changes.approval.scopeWays", "Build it now as a change to what is there (its planned tickets go on the board), keep it for a new scope version on the Scope & success page, or reject it.")}
            </p>
          ) : featurePlan ? (
            <p className="text-[13px] leading-relaxed text-ink2">
              {featurePlan.builds > 1
                ? t("changes.approval.featureMany", "Approve the feature to put its {tickets} on the board, or reject it. It is built on the existing product in {builds}: each one goes to development for you to try, and the next build starts only when you start it.", { tickets: ticketCount(featurePlan.tickets), builds: buildCount(featurePlan.builds) })
                : t("changes.approval.featureOne", "Approve the feature to put its {tickets} on the board, or reject it. It is built on the existing product in one build, deployed to development for you to try.", { tickets: ticketCount(featurePlan.tickets) })}
            </p>
          ) : <p className="text-[13px] leading-relaxed text-ink2">{t("changes.approval.plain", "Approve the change to put its planned tickets on the board, or reject it.")}</p>}
          {right.self && <p className="text-[13px] text-ink2">{t("changes.approval.self", "You're the only approver, so you can approve this yourself.")}</p>}
          <div className="min-w-0">
            <label htmlFor={fieldId}><Label>{t("changes.approval.note", "A note (optional)")}</Label></label>
            <Textarea id={fieldId} value={note} maxLength={LIMITS.approvalComment} disabled={busy} className="min-h-[72px]"
              placeholder={t("changes.approval.notePlaceholder", "Why you approve or reject it")} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {scopeRoute ? (<>
              <Button variant="primary" size="sm" disabled={busy} icon={<Check size={14} strokeWidth={2} aria-hidden />} onClick={() => void go("approve", "fast")}>
                {pending === "fast" ? t("changes.page.primary.approving", "Approving…") : t("changes.page.primary.asChange", "Build it as a change")}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void go("approve")}>
                {pending === "approve" ? t("changes.questions.saving", "Saving…") : t("changes.approval.keep", "Keep it for Scope & success")}
              </Button>
            </>) : (
              <Button variant="primary" size="sm" disabled={busy} icon={<Check size={14} strokeWidth={2} aria-hidden />} onClick={() => void go("approve")}>
                {pending === "approve" ? t("changes.page.primary.approving", "Approving…") : featurePlan ? t("changes.approval.approveFeature", "Approve feature") : t("changes.approval.approveChange", "Approve change")}
              </Button>
            )}
            <Button variant="danger" size="sm" disabled={busy} icon={<X size={14} strokeWidth={2} aria-hidden />} onClick={() => void go("reject")}>
              {pending === "reject" ? t("changes.approval.rejecting", "Rejecting…") : t("changes.approval.reject", "Reject")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink2">
          {right.reason === "ownRequest" && others.length > 0 ? t("changes.approval.ownRequest", "You asked for this change, so {names} must approve it.", { names: anyOf })
            : others.length > 0 ? t("changes.approval.waitingFor", "Waiting for {names} to approve it.", { names: anyOf })
            : t("changes.approval.waiting", "Waiting for an approver.")}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- the scope route

/**
 * An approved change kept for Scope & success. It is listed on the Scope & success page; the locked scope of a built app
 * takes no new version from there yet, so the way forward that works now is to build it as a change to what is there
 * (cr.decide, route "fast"), which an approver can choose here at any time.
 */
export function ScopeRouteNotice({ scopeHref, canBuildAsChange = false, approvers = [], busy = false, error = null, onBuildAsChange }: {
  scopeHref: string;
  canBuildAsChange?: boolean;
  /** who can decide it when you can't (names) */
  approvers?: readonly string[];
  busy?: boolean;
  error?: string | null;
  onBuildAsChange?: () => void;
}) {
  const t = useT();
  return (
    <Card tone="soft">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-[14px] font-medium text-ink">{t("changes.scopeRoute.title", "Kept for Scope & success")}</p>
        <p className="text-[13px] leading-relaxed text-ink2">
          {t("changes.scopeRoute.text", "It's listed on the Scope & success page with its description, waiting for a new scope version. The locked scope of an app that is already built can't be reopened, so to get it now, build it as a change to what is there: its planned tickets go on the board and the build can start.")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {canBuildAsChange && onBuildAsChange && (
            <Button variant="primary" size="sm" disabled={busy} icon={<Check size={14} strokeWidth={2} aria-hidden />} onClick={onBuildAsChange}>
              {busy ? t("changes.page.primary.approving", "Approving…") : t("changes.page.primary.asChange", "Build it as a change")}
            </Button>
          )}
          <Link to={scopeHref} className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">{t("changes.page.primary.openScope", "Open Scope & success")}</Link>
        </div>
        {!canBuildAsChange && (
          <p className="text-[13px] text-ink2">{approvers.length ? t("changes.scopeRoute.namesCan", "{names} can build it as a change.", { names: approvers.join(t("changes.approval.or", " or ")) }) : t("changes.scopeRoute.anyCan", "An approver can build it as a change.")}</p>
        )}
        {error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
      </div>
    </Card>
  );
}

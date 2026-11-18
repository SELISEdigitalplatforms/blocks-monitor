/** The one thing a team message lets the person do, inline in the thread, through the existing ops and their permission
 *  checks: cr.answer, cr.decide, cr.submit, cr.startBuild (src/components/changes/blocksChanges.ts), job.cancel and
 *  job.retry (src/blocks/engine/actions.ts) and build.start (src/blocks/delivery/actions.ts). The server decides again. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Pause, Pencil, Play, RotateCcw, Send, X } from "lucide-react";
import { Button, Input, Textarea } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import { useBuildStart } from "@/madp/blocks/delivery/actions";
import { useDeliveryJobs } from "@/madp/blocks/delivery/hooks";
import { cancelEngineJob, engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import {
  blocksChangeMessage, useAnswerBlocksChange, useDecideBlocksChange, useStartChangeBuild, useSubmitBlocksChange,
} from "@/madp/components/changes/blocksChanges";
import { analysisOf, buildCount, ticketCount } from "@/madp/components/changes/changeFlow";
import type { DeliveryChangeRequest } from "@/madp/blocks/delivery/types";
import { CHANGE_ANALYSIS_LIMITS } from "@/madp/domain/changeAnalysis";
import { LIMITS } from "@/madp/domain/delivery";
import type { TeamAction } from "./teamMessages";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {done && <p role="status" className="text-[12px] text-[rgb(var(--c-success-text))]">{done}</p>}
      {error && <p role="alert" className="text-[12px] text-danger [overflow-wrap:anywhere]">{error}</p>}
    </>
  );
}

export function TeamActionView({ action, ctx, changes, onNavigate }: {
  action: TeamAction;
  ctx: DeliveryContext;
  changes: readonly DeliveryChangeRequest[];
  /** a link inside the panel was followed: the panel closes */
  onNavigate: () => void;
}) {
  switch (action.kind) {
    case "question": return <QuestionAnswer ctx={ctx} changes={changes} changeRequestId={action.changeRequestId} questionId={action.questionId} />;
    case "decide": return <Decide ctx={ctx} action={action} />;
    case "submit": return <Submit ctx={ctx} action={action} />;
    case "pause": return <PauseBuild action={action} />;
    case "resume": return <Resume ctx={ctx} action={action} />;
    case "startChange": return <StartChange ctx={ctx} action={action} />;
    case "open":
      return (
        <Link to={action.href} onClick={onNavigate}
          className="inline-flex text-[13px] font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50 rounded">
          {action.label}
        </Link>
      );
  }
}

// ------------------------------------------------------------------------------------------- questions (cr.answer)

function QuestionAnswer({ ctx, changes, changeRequestId, questionId }: { ctx: DeliveryContext; changes: readonly DeliveryChangeRequest[]; changeRequestId: string; questionId: string }) {
  const t = useT();
  const answer = useAnswerBlocksChange(ctx.workspaceId, ctx.projectId);
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cr = changes.find((c) => c.id === changeRequestId);
  const q = cr ? analysisOf(cr)?.questions.find((x) => x.id === questionId) ?? null : null;
  const canAnswer = ctx.can("build.run") && cr?.status === "questions";
  if (!q || !canAnswer) return null;
  const fieldId = `team-q-${changeRequestId}-${questionId}`;
  const pick = async (a: string) => {
    if (busy || !a.trim()) return;
    setBusy(true); setError(null);
    try { await answer.answer(changeRequestId, [{ id: questionId, answer: a.trim() }]); setOther(false); setText(""); }
    catch (e) { setError(blocksChangeMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label={q.text} className="flex min-w-0 flex-wrap gap-1.5">
        {q.options.map((o) => (
          <button key={o} type="button" disabled={busy} onClick={() => void pick(o)}
            className="inline-flex min-h-8 max-w-full items-center rounded-full bg-surface px-3 py-1 text-left text-[13px] font-medium text-ink ring-1 ring-line transition outline-none hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-70 [overflow-wrap:anywhere]">
            {o}
          </button>
        ))}
        <button type="button" aria-expanded={other} aria-controls={fieldId} disabled={busy} onClick={() => setOther((v) => !v)}
          className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-70",
            other ? "bg-accent-soft text-accent" : "bg-surface text-ink ring-1 ring-line hover:bg-line")}>
          <Pencil {...ICON} />{t("team.actions.other", "Other…")}
        </button>
      </div>
      {other && (
        <form className="flex min-w-0 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void pick(text); }}>
          <label htmlFor={fieldId} className="sr-only">{t("team.actions.yourAnswer", "Your answer")}</label>
          <Input id={fieldId} autoFocus value={text} maxLength={CHANGE_ANALYSIS_LIMITS.answer} disabled={busy} placeholder={t("team.actions.yourAnswer", "Your answer")}
            className="min-w-0 flex-1" onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !text.trim()}>{busy ? t("team.actions.saving", "Saving…") : t("team.actions.answer", "Answer")}</Button>
        </form>
      )}
      {busy && !other && <p role="status" className="text-[12px] text-ink3">{t("team.actions.savingAnswer", "Saving your answer…")}</p>}
      <Feedback error={error} done={null} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- approval (cr.decide)

function Decide({ ctx, action }: { ctx: DeliveryContext; action: Extract<TeamAction, { kind: "decide" }> }) {
  const t = useT();
  const decide = useDecideBlocksChange(ctx.workspaceId, ctx.projectId);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "fast" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fieldId = `team-note-${action.changeRequestId}`;
  const go = async (d: "approve" | "reject", route?: "fast") => {
    if (pending) return;
    setPending(route ?? d); setError(null); setDone(null);
    try {
      await decide.decide(action.changeRequestId, d, note, route);
      setNote("");
      setDone(d === "reject" ? t("team.actions.declined", "Declined.") : route === "fast" ? t("team.actions.approvedAsChange", "Approved as a change.")
        : action.scopeRoute ? t("team.actions.keptForScope", "Kept for Scope & success.") : t("team.actions.approved", "Approved."));
    } catch (e) { setError(blocksChangeMessage(e)); } finally { setPending(null); }
  };
  const busy = pending !== null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {action.feature && (
        <p className="text-[12px] leading-snug text-ink2">
          {action.feature.builds > 1
            ? t("team.actions.approvingPutsBuilds", "Approving puts its {tickets} on the board; it's built in {builds}, each one tried on development before the next.", { tickets: ticketCount(action.feature.tickets), builds: buildCount(action.feature.builds) })
            : t("team.actions.approvingPuts", "Approving puts its {tickets} on the board.", { tickets: ticketCount(action.feature.tickets) })}
        </p>
      )}
      <label htmlFor={fieldId} className="sr-only">{t("team.actions.noteLabel", "A note (optional)")}</label>
      <Textarea id={fieldId} value={note} maxLength={LIMITS.approvalComment} disabled={busy} className="min-h-[56px] !text-[13px]"
        placeholder={t("team.actions.notePlaceholder", "A note for the team (optional)")} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {action.scopeRoute ? (<>
          <Button size="sm" variant="primary" disabled={busy} icon={<Check {...ICON} />} onClick={() => void go("approve", "fast")}>{pending === "fast" ? t("team.actions.approving", "Approving…") : t("team.actions.buildAsChange", "Build it as a change")}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void go("approve")}>{pending === "approve" ? t("team.actions.saving", "Saving…") : t("team.actions.keepForScope", "Keep it for Scope & success")}</Button>
        </>) : (
          <Button size="sm" variant="primary" disabled={busy} icon={<Check {...ICON} />} onClick={() => void go("approve")}>{pending === "approve" ? t("team.actions.approving", "Approving…") : t("team.actions.approve", "Approve")}</Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} icon={<X {...ICON} />} onClick={() => void go("reject")}>{pending === "reject" ? t("team.actions.declining", "Declining…") : t("team.actions.decline", "Decline")}</Button>
      </div>
      <Feedback error={error} done={done} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- send for analysis (cr.submit)

function Submit({ ctx, action }: { ctx: DeliveryContext; action: Extract<TeamAction, { kind: "submit" }> }) {
  const t = useT();
  const submit = useSubmitBlocksChange(ctx.workspaceId, ctx.projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy || action.disabledReason) return;
    setBusy(true); setError(null);
    try { await submit.submit(action.changeRequestId); } catch (e) { setError(blocksChangeMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !!action.disabledReason} icon={<Send {...ICON} />} onClick={() => void run()}>
          {busy ? t("team.actions.sending", "Sending…") : action.label}
        </Button>
      </div>
      {action.disabledReason && <p className="text-[12px] text-ink3">{action.disabledReason}</p>}
      <Feedback error={error} done={null} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- pause (job.cancel)

function PauseBuild({ action }: { action: Extract<TeamAction, { kind: "pause" }> }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pause = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await cancelEngineJob(action.jobId); setAsking(false); } catch (e) { setError(engineErrorMessage(e)); } finally { setBusy(false); }
  };
  if (!asking) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<Pause {...ICON} />} onClick={() => setAsking(true)}>{t("team.actions.pauseDevelopment", "Pause development")}</Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={t("team.actions.pauseDevelopment", "Pause development")} className="flex min-w-0 flex-col gap-2 rounded-block bg-surface p-3 ring-1 ring-line">
      <p className="text-[13px] leading-snug text-ink">{t("team.actions.pausingStops", "Pausing stops {name} now.", { name: action.name })}</p>
      <p className="text-[12px] leading-snug text-ink2">
        {t("team.actions.pauseExplain", "Its tickets stay on the board. Resume whenever you're ready: the build then starts again.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} icon={<Pause {...ICON} />} onClick={() => void pause()}>{busy ? t("team.actions.pausing", "Pausing…") : t("team.actions.pauseBuild", "Pause the build")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>{t("team.actions.keepBuilding", "Keep building")}</Button>
      </div>
      <Feedback error={error} done={null} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- resume (job.retry, build.start, cr.startBuild)

function Resume({ ctx, action }: { ctx: DeliveryContext; action: Extract<TeamAction, { kind: "resume" }> }) {
  const t = useT();
  const buildStart = useBuildStart(ctx);
  const changeStart = useStartChangeBuild(ctx.workspaceId, ctx.projectId);
  const { jobs } = useDeliveryJobs(ctx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (action.how === "retry") await retryEngineJob(action.jobId);
      else if (action.how === "change") await changeStart.start(action.targetId, jobs);
      else await buildStart.run({ milestoneId: action.targetId });
    } catch (e) {
      setError(action.how === "change" ? blocksChangeMessage(e) : engineErrorMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy || buildStart.pending} icon={action.how === "retry" ? <RotateCcw {...ICON} /> : <Play {...ICON} />} onClick={() => void run()}>
          {busy || buildStart.pending ? t("team.actions.resuming", "Resuming…") : t("team.actions.resume", "Resume")}
        </Button>
      </div>
      <Feedback error={error ?? (action.how === "milestone" ? buildStart.error : null)} done={action.how === "milestone" ? buildStart.success : null} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- start an approved change (cr.startBuild)

function StartChange({ ctx, action }: { ctx: DeliveryContext; action: Extract<TeamAction, { kind: "startChange" }> }) {
  const t = useT();
  const start = useStartChangeBuild(ctx.workspaceId, ctx.projectId);
  const { jobs } = useDeliveryJobs(ctx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await start.start(action.changeRequestId, jobs); } catch (e) { setError(blocksChangeMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} icon={<Play {...ICON} />} onClick={() => void run()}>{busy ? t("team.actions.starting", "Starting…") : action.label}</Button>
      </div>
      <Feedback error={error} done={null} />
    </div>
  );
}

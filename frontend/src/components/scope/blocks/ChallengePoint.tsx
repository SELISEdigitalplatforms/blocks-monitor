/** One point of the second opinion: what was asked, why, the suggested fix, and the person's decision on it. */
import { useId, useState } from "react";
import { Check, CircleAlert, CircleCheck, LoaderCircle, Undo2 } from "lucide-react";
import { Button, Chip, Input, Label, Textarea } from "@/ui/kit";
import type { ChallengeRecord } from "../../../blocks/scope/records";
import { scopeErrorMessage } from "../../../blocks/scope/messages";
import { formatDateTime } from "@/lib/dates";
import type { ApplyRequest } from "./applyRequest";
import type { AcceptedState } from "./challengeState";
import { t, useT } from "@/i18n";

export type Decision = "accepted" | "answered" | "dismissed";

/** English source texts (decisionInputError returns them in the current language). */
export const REASON_REQUIRED_TEXT = "Say why you are dismissing this point.";
export const ANSWER_REQUIRED_TEXT = "Write your answer first.";
const reasonRequiredText = () => t("analysis.scope.challenge.reasonRequired", "Say why you are dismissing this point.");

/** The rule before anything is sent: dismissing needs a reason, answering needs an answer. */
export function decisionInputError(decision: Decision, text: string): string | null {
  if (decision === "dismissed" && text.trim() === "") return reasonRequiredText();
  if (decision === "answered" && text.trim() === "") return t("analysis.scope.challenge.answerRequired", "Write your answer first.");
  return null;
}

/** Read at render time: the labels are looked up in the current language when they are read. */
const SEVERITY: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  high: { get label() { return t("analysis.scope.challenge.high", "High"); }, tone: "danger" },
  medium: { get label() { return t("analysis.scope.challenge.medium", "Medium"); }, tone: "warning" },
  low: { get label() { return t("analysis.scope.challenge.low", "Low"); }, tone: "neutral" },
};

const DONE_TEXT: Record<Decision | "undone", string> = {
  get accepted() { return t("analysis.scope.challenge.doneAccepted", "Point accepted."); },
  get answered() { return t("analysis.scope.challenge.doneAnswered", "Answer saved."); },
  get dismissed() { return t("analysis.scope.challenge.doneDismissed", "Point dismissed."); },
  get undone() { return t("analysis.scope.challenge.doneUndone", "Decision undone. The point is open again."); },
};

export { formatDateTime };

/** The accepted point's real state in words (never an offer to apply what is already applied). */
function AcceptedLine({ state }: { state: AcceptedState }) {
  const t = useT();
  const at = "at" in state && state.at ? ` · ${formatDateTime(state.at)}` : "";
  const [icon, tone, text] =
    state.kind === "replanning" ? [<LoaderCircle key="i" size={14} aria-hidden className="mt-px shrink-0 animate-spin" />, "text-ink2", t("analysis.scope.challenge.replanning", "Your business analyst is moving the work between the milestones the way this point says…")]
    : state.kind === "replanned" ? [<CircleCheck key="i" size={14} aria-hidden className="mt-px shrink-0" />, "text-[rgb(var(--c-success-text))]", t("analysis.scope.challenge.replanned", "Done: the milestones were updated{at}. See Milestones.", { at })]
    : state.kind === "replan-failed" ? [<CircleAlert key="i" size={14} aria-hidden className="mt-px shrink-0" />, "text-[rgb(var(--c-warning-text))]", t("analysis.scope.challenge.replanFailed", "The milestones could not be updated for this point. Change them with Edit milestones.")]
    : state.kind === "edit-milestones" ? [<CircleAlert key="i" size={14} aria-hidden className="mt-px shrink-0" />, "text-ink2", t("analysis.scope.challenge.editMilestones", "Not in the milestones yet. Change them with Edit milestones.")]
    : state.kind === "in-scope" ? [<CircleCheck key="i" size={14} aria-hidden className="mt-px shrink-0" />, "text-[rgb(var(--c-success-text))]", t("analysis.scope.challenge.inScope", "In the scope{at}.", { at })]
    : [<CircleAlert key="i" size={14} aria-hidden className="mt-px shrink-0" />, "text-ink2", t("analysis.scope.challenge.notYet", "Not in the scope yet.")];
  return <p data-accepted-state={state.kind} className={`mt-2 flex items-start gap-1.5 text-[13px] font-medium ${tone}`}>{icon}<span className="min-w-0">{text}</span></p>;
}

export function ChallengePoint({ challenge, accepted = null, canDecide, memberName, onDecide, onUndo, onApply }: {
  challenge: ChallengeRecord;
  /** For an accepted point: what really happened to it (re-plan running / done, or in the scope or not yet). */
  accepted?: AcceptedState | null;
  canDecide: boolean;
  memberName: (userId: string) => string;
  onDecide: (decision: Decision, text: string) => Promise<void>;
  onUndo: () => Promise<void>;
  onApply: (request: ApplyRequest) => void;
}) {
  const t = useT();
  const uid = useId();
  const [mode, setMode] = useState<"answered" | "dismissed" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sev = SEVERITY[challenge.severity] ?? SEVERITY.low;
  const open = challenge.status === "open";

  const run = async (done: keyof typeof DONE_TEXT, call: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await call();
      setNotice(DONE_TEXT[done]); setMode(null); setText("");
    } catch (e) {
      setError(scopeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const decide = (decision: Decision, body: string) => {
    const problem = decisionInputError(decision, body);
    if (problem) { setError(problem); return; }
    void run(decision, () => onDecide(decision, body.trim()));
  };

  const target = challenge.target;
  const decidedText = challenge.status === "accepted" ? challenge.finalText || challenge.suggestedFix
    : challenge.status === "answered" ? challenge.answerText
    : challenge.status === "dismissed" ? challenge.dismissReason : null;
  const who = challenge.decidedByUserId ? memberName(challenge.decidedByUserId) : "";

  return (
    <li className="rounded-block bg-surface2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={sev.tone}>{sev.label}</Chip>
        {!open && <Chip tone={challenge.status === "dismissed" ? "neutral" : "success"}>{challenge.status === "accepted" ? t("analysis.scope.challenge.accepted", "Accepted") : challenge.status === "answered" ? t("analysis.scope.challenge.answered", "Answered") : t("analysis.scope.challenge.dismissed", "Dismissed")}</Chip>}
      </div>
      <p className="mt-2 text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{challenge.question}</p>
      {challenge.why && <p className="mt-1 text-[13px] text-ink2 [overflow-wrap:anywhere]"><span className="font-medium">{t("analysis.scope.challenge.why", "Why:")}</span> {challenge.why}</p>}
      {challenge.suggestedFix && <p className="mt-1 text-[13px] text-ink2 [overflow-wrap:anywhere]"><span className="font-medium">{t("analysis.scope.challenge.suggestedFix", "Suggested fix:")}</span> {challenge.suggestedFix}</p>}

      {!open && (
        <div className="mt-2 text-[13px] text-ink2">
          {decidedText && <p className="[overflow-wrap:anywhere]">{decidedText}</p>}
          <p className="text-ink3">{[who, formatDateTime(challenge.decidedAt)].filter(Boolean).join(" · ")}</p>
        </div>
      )}
      {accepted && <AcceptedLine state={accepted} />}

      {canDecide && open && mode === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy} icon={<Check size={14} strokeWidth={1.75} aria-hidden />} onClick={() => decide("accepted", "")}>{t("analysis.scope.challenge.accept", "Accept")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode("answered"); setError(null); }}>{t("analysis.scope.challenge.answer", "Answer")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode("dismissed"); setError(null); }}>{t("analysis.scope.challenge.dismiss", "Dismiss")}</Button>
        </div>
      )}
      {canDecide && open && mode !== null && (
        <div className="mt-3">
          <label htmlFor={`${uid}-text`}><Label>{mode === "answered" ? t("analysis.scope.challenge.yourAnswer", "Your answer") : t("analysis.scope.challenge.reason", "Reason for dismissing")}</Label></label>
          {mode === "answered"
            ? <Textarea id={`${uid}-text`} value={text} rows={3} maxLength={2000} onChange={(e) => setText(e.target.value)} />
            : <Input id={`${uid}-text`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-invalid={error === reasonRequiredText()} />}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(mode, text)}>{mode === "answered" ? t("analysis.scope.challenge.saveAnswer", "Save answer") : t("analysis.scope.challenge.dismissPoint", "Dismiss point")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode(null); setError(null); }}>{t("analysis.scope.cancel", "Cancel")}</Button>
          </div>
        </div>
      )}
      {canDecide && !open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* offered only while the accepted fix is really not in the scope yet (a milestone fix is applied on accept) */}
          {challenge.status === "accepted" && accepted?.kind === "not-yet" && (
            <Button size="sm" variant="ghost" onClick={() => onApply({ challengeId: challenge.id, target, text: challenge.finalText || challenge.suggestedFix })}>{t("analysis.scope.challenge.putInScope", "Put it in the scope")}</Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} icon={<Undo2 size={14} strokeWidth={1.75} aria-hidden />} onClick={() => void run("undone", onUndo)}>{t("analysis.scope.challenge.undo", "Undo")}</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-[rgb(var(--c-danger-text))]">{error}</p>}
      {notice && <p role="status" className="mt-2 text-[13px] text-[rgb(var(--c-success-text))]">{notice}</p>}
    </li>
  );
}

/** "MADP suggestions": the real Suggestion rows of any source, decided with Accept, Dismiss and Undo. A review is
 *  requested only through this lane's `requirements.review` op (the server builds the job input from record ids);
 *  its job shows with the engine status. No example suggestions exist anywhere. */
import { t, useT } from "@/i18n";
import { useState } from "react";
import { Check, Lightbulb, Undo2, X } from "lucide-react";
import { Button, Card, Chip } from "@/ui/kit";
import { VIEWER_TIP } from "@/domain/rbac";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { latestEngineJob, type EngineJob } from "@/blocks/engine/types";
import { retryEngineJob } from "@/blocks/engine/actions";
import { useSuggestions } from "@/blocks/requirements/hooks";
import { useDecideSuggestion, useRequestReview } from "@/blocks/requirements/mutations";
import type { SuggestionRecord } from "@/blocks/requirements/records";
import { requirementsErrorMessage } from "./messages";
import type { ReqTab } from "./requirementsTab";

export interface SuggestionsTabProps {
  projectId: string;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  onOpenTab: (tab: ReqTab) => void;
  onEditingChange?: (editing: boolean) => void;
}

export interface SuggestionsViewProps {
  suggestions: SuggestionRecord[];
  loading?: boolean;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  job: EngineJob | null;
  /** The id being decided right now. */
  busyId: string | null;
  reviewBusy: boolean;
  /** Spoken to assistive technology after each decision. */
  announcement: string;
  error: string | null;
  requestError: string | null;
  retrying?: boolean;
  onDecide: (s: SuggestionRecord, decision: "accepted" | "dismissed" | "open") => void;
  onReview: () => void;
  onRetry: () => void;
}

function stateLabel(s: SuggestionRecord["status"]): string {
  return s === "accepted" ? t("analysis.requirements.accepted", "Accepted") : s === "dismissed" ? t("analysis.requirements.dismissed", "Dismissed") : t("analysis.requirements.open", "Open");
}

function SuggestionItem({ s, editable, busy, onDecide }: {
  s: SuggestionRecord; editable: boolean; busy: boolean;
  onDecide: SuggestionsViewProps["onDecide"];
}) {
  useT();
  const open = s.status === "open";
  return (
    <li className="flex gap-3 px-2 py-3" data-suggestion={s.id}>
      <span className="mt-0.5 shrink-0 text-ink3"><Lightbulb size={18} strokeWidth={1.75} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px] leading-snug">{s.title}</div>
        {s.text && <div className="mt-0.5 text-pretty break-words text-[13px] leading-snug text-ink2">{s.text}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip tone={s.status === "accepted" ? "success" : "neutral"}>{stateLabel(s.status)}</Chip>
          {s.kind && <Chip>{s.kind}</Chip>}
        </div>
      </div>
      {editable && (
        <span className="flex shrink-0 flex-wrap items-start justify-end gap-1.5 self-start">
          {open ? (
            <>
              <Button variant="primary" size="sm" icon={<Check size={14} strokeWidth={1.75} />} disabled={busy}
                aria-label={t("analysis.requirements.acceptItem", "Accept: {title}", { title: s.title })} onClick={() => onDecide(s, "accepted")}>{t("analysis.requirements.accept", "Accept")}</Button>
              <Button variant="ghost" size="sm" icon={<X size={14} strokeWidth={1.75} />} disabled={busy}
                aria-label={t("analysis.requirements.dismissItem", "Dismiss: {title}", { title: s.title })} onClick={() => onDecide(s, "dismissed")}>{t("analysis.requirements.dismiss", "Dismiss")}</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" icon={<Undo2 size={14} strokeWidth={1.75} />} disabled={busy}
              aria-label={t("analysis.requirements.undoItem", "Undo: {title}", { title: s.title })} onClick={() => onDecide(s, "open")}>{t("analysis.requirements.undo", "Undo")}</Button>
          )}
        </span>
      )}
    </li>
  );
}

export function SuggestionsView(p: SuggestionsViewProps) {
  useT();
  const open = p.suggestions.filter((s) => s.status === "open");
  const decided = p.suggestions.filter((s) => s.status !== "open");
  const ordered = [...open, ...decided];
  const empty = !p.loading && ordered.length === 0;
  return (
    <Card title={t("analysis.requirements.suggestionsTitle", "Suggestions from your business analyst")} icon={<Lightbulb size={18} strokeWidth={1.75} />}
      action={<Chip>{t("analysis.requirements.suggestionsOpen", "{count} open", { count: open.length })}</Chip>}>
      {p.readOnlyReason === "permission" && <ViewOnlyNote id="suggestions-view-only" text={VIEWER_TIP} className="mb-3" />}
      <div role="status" aria-live="polite" className="text-[13px] text-ink2 empty:hidden">{p.announcement}</div>
      {p.error && <p role="alert" className="mb-3 text-[13px] text-[rgb(var(--c-danger-text))]">{p.error}</p>}
      {p.loading && <p className="text-[14px] text-ink2">{t("analysis.requirements.loadingSuggestions", "Loading the suggestions…")}</p>}
      {empty && <p className="text-[15px]">{t("analysis.requirements.noSuggestions", "No suggestions yet.")}</p>}
      {ordered.length > 0 && (
        <ul className="divide-y divide-line">
          {ordered.map((s) => (
            <SuggestionItem key={s.id} s={s} editable={p.editable} busy={p.busyId === s.id} onDecide={p.onDecide} />
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        {p.editable && (
          <Button variant="primary" size="sm" disabled={p.reviewBusy} onClick={p.onReview}>
            {t("analysis.requirements.askSecondLook", "Ask your business analyst for a second look")}
          </Button>
        )}
        <EngineJobStatus job={p.job} variant="full" canRetry={p.editable} onRetry={p.onRetry} retrying={p.retrying}
          requestError={p.requestError} />
      </div>
    </Card>
  );
}

export function SuggestionsTab({ projectId, editable, readOnlyReason }: SuggestionsTabProps) {
  useT();
  const sugg = useSuggestions(projectId);
  const jobs = useEngineJobs(projectId, ["requirements.draft"]);
  const decide = useDecideSuggestion(projectId);
  const review = useRequestReview(projectId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const job = latestEngineJob(jobs.data ?? []);

  const onDecide: SuggestionsViewProps["onDecide"] = async (s, decision) => {
    setBusyId(s.id); setError(null);
    try {
      const r = await decide.mutateAsync({ suggestionId: s.id, decision });
      if (decision === "open") {
        setAnnouncement(r.keptEdited ? t("analysis.requirements.keptEdited", "Kept: it was edited after you accepted it") : t("analysis.requirements.undone", "Undone: {title}", { title: s.title }));
      } else {
        setAnnouncement(decision === "accepted" ? t("analysis.requirements.acceptedItem", "Accepted: {title}", { title: s.title }) : t("analysis.requirements.dismissedItem", "Dismissed: {title}", { title: s.title }));
      }
    } catch (e) {
      setError(requirementsErrorMessage(e));
    } finally { setBusyId(null); }
  };

  const onReview = async () => {
    setRequestError(null);
    try { await review.mutateAsync({}); } catch (e) { setRequestError(requirementsErrorMessage(e)); }
  };

  const onRetry = async () => {
    if (!job) return;
    setRetrying(true); setRequestError(null);
    try {
      await retryEngineJob(job.id);
    } catch (e) { setRequestError(requirementsErrorMessage(e)); } finally { setRetrying(false); }
  };

  return (
    <SuggestionsView suggestions={sugg.data ?? []} loading={sugg.isLoading} editable={editable} readOnlyReason={readOnlyReason}
      job={job} busyId={busyId} reviewBusy={review.isPending} announcement={announcement} error={error}
      requestError={requestError} retrying={retrying} onDecide={onDecide} onReview={onReview} onRetry={onRetry} />
  );
}

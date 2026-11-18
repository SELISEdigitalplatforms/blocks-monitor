/** "Master features", opened in its row: the suggested additions still waiting on the person ("Confirm" adds one to the
 *  requirements, "Set aside" leaves it out: the Goals & requirements step's own op, suggestion.decide), then the
 *  requirements as compact rows grouped by priority, each with one ⋯ menu (CompactRequirementList: the same reads and
 *  writes as MustTab: edit, priority, checks, order, delete with undo, comments). Editable while the requirements are
 *  open and the person may edit them. */
import { useT } from "@/madp/i18n";
import { useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { useRequirementsContext } from "@/madp/blocks/requirements/context";
import { useRequirements, useSuggestions } from "@/madp/blocks/requirements/hooks";
import { useDecideSuggestion } from "@/madp/blocks/requirements/mutations";
import type { SuggestionRecord } from "@/madp/blocks/requirements/records";
import { requirementsErrorMessage } from "@/madp/components/requirements/messages";
import { PartPlaceholder } from "@/madp/components/analysis/doc/PartCard";
import { Button, Chip } from "@/madp/ui/kit";
import { partOpen } from "@/madp/components/analysis/model";
import type { AnalysisCtx } from "../../model";
import { CompactRequirementList } from "./CompactRequirementList";


function Suggestions({ projectId, items, editable }: { projectId: string; items: readonly SuggestionRecord[]; editable: boolean }) {
  const t = useT();
  const decide = useDecideSuggestion(projectId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (s: SuggestionRecord, decision: "accepted" | "dismissed") => {
    setBusyId(s.id); setError(null);
    try { await decide.mutateAsync({ suggestionId: s.id, decision }); }
    catch (e) { setError(requirementsErrorMessage(e)); }
    finally { setBusyId(null); }
  };
  return (
    <section aria-label={t("analysis.brief.suggestedAdditions", "Suggested additions")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-medium text-ink2">{t("analysis.brief.suggestedAdditions", "Suggested additions")}</h4>
        <Chip tone="accent">{t("analysis.brief.toConfirmCount", "{count} to confirm", { count: items.length })}</Chip>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-block bg-accent-soft/40 px-4 py-3 ring-1 ring-inset ring-accent/20">
            <Lightbulb size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-accent-text))]" />
            <div className="min-w-0 flex-1 basis-56">
              <p className="break-words text-[15px] font-medium leading-snug text-ink">{s.title}</p>
              {s.text.trim() && <p className="mt-0.5 break-words text-[13px] leading-snug text-ink2">{s.text}</p>}
            </div>
            {editable && (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="secondary" icon={<Check size={14} aria-hidden />} disabled={busyId !== null}
                  onClick={() => void run(s, "accepted")} aria-label={t("analysis.brief.confirmItem", "Confirm: {title}", { title: s.title })}>{t("analysis.brief.confirm", "Confirm")}</Button>
                <Button size="sm" variant="ghost" disabled={busyId !== null}
                  onClick={() => void run(s, "dismissed")} aria-label={t("analysis.brief.setAsideItem", "Set aside: {title}", { title: s.title })}>{t("analysis.brief.setAside", "Set aside")}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="text-[13px] text-danger empty:hidden">{error ? t("analysis.brief.notSaved", "Not saved: {error}", { error }) : null}</p>
    </section>
  );
}

export function FeaturesDetail({ projectId, step }: AnalysisCtx) {
  const t = useT();
  const open = partOpen("features", step);
  const ctx = useRequirementsContext(projectId);
  const reqs = useRequirements(projectId);
  const suggestions = useSuggestions(projectId);
  const canReq = Boolean(ctx.canEditRequirements);
  const editable = ctx.open && canReq;
  const readOnlyReason = !ctx.open ? "closed" as const : canReq ? null : "permission" as const;
  const empty = !reqs.isLoading && !reqs.isError && (reqs.data ?? []).length === 0;
  const waiting = ctx.open ? (suggestions.data ?? []).filter((s) => s.status === "open") : [];

  if (!open) {
    return <PartPlaceholder what={t("analysis.brief.featuresPlaceholder", "Your business analyst lists the master features here: what the product must do, each with its priority (must, should or could) and how we'll know it works.")} when={t("analysis.brief.whenAfterQuestions", "Written after you answer the open questions.")} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {waiting.length > 0 && <Suggestions projectId={projectId} items={waiting} editable={editable} />}
      {empty
        ? <PartPlaceholder what={t("analysis.brief.featuresEmpty", "No master features yet. Your business analyst writes them from your answers.")} when={t("analysis.brief.featuresEmptyWhen", "They appear here as they are written.")} />
        : <CompactRequirementList projectId={projectId} editable={editable} readOnlyReason={readOnlyReason} stepOpen={ctx.open} />}
    </div>
  );
}

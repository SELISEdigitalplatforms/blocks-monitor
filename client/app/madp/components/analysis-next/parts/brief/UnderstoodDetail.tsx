/** "What we understood", opened in its row: today's UnderstoodPart content without its card (the row already shows the
 *  title), plus what still waits on the person before the understanding is confirmed: the points where the sources
 *  disagree ("Let your business analyst settle it") and the items found in the material ("Confirm" / "Set aside").
 *  Both use the Understanding step's own call (saveDecision, POST /api/brief/:id/decision) and write the answer into
 *  the shared brief cache. Read only once the understanding is confirmed. */
import { t, useT } from "@/madp/i18n";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Lightbulb, PencilLine, TriangleAlert } from "lucide-react";
import { useCan } from "@/madp/blocks/projects/context";
import { stepPath } from "@/madp/domain/phases";
import { BriefRequestError, saveDecision, type Decision } from "@/madp/components/understanding/briefApi";
import { requirementSource } from "@/madp/components/understanding/model";
import { briefKey } from "@/madp/components/analysis/doc/briefQuery";
import { PartLoading, PartPlaceholder } from "@/madp/components/analysis/doc/PartCard";
import { Button, Chip } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { ANALYST_ITEM_LABEL, type AnalysisCtx } from "../../model";
import { understandingSigned, useUnderstoodLines } from "./summaryHooks";

interface Line { key: string; label: string; text: string; missing?: boolean }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "A, B and C" (and "+ 2 more"). */
function listLine(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.length > 1
    ? t("analysis.brief.listAnd", "{items} and {last}", { items: shown.slice(0, -1).join(", "), last: shown[shown.length - 1] })
    : shown[0] ?? "";
  return rest > 0 ? t("analysis.brief.listMore", "{list} (and {count} more)", { list: joined, count: rest }) : joined;
}

function errorText(e: unknown): string {
  if (e instanceof BriefRequestError && e.status === 401) return t("analysis.brief.sessionEnded", "Your session has ended. Sign in again to continue.");
  if (e instanceof BriefRequestError && (e.status === 403 || e.status === 404)) return t("analysis.brief.noAccess", "You don't have access to this project.");
  return t("analysis.brief.saveFailed", "We couldn't save that just now. Try again.");
}

export function UnderstoodDetail(ctx: AnalysisCtx) {
  const { projectId, step } = ctx;
  useT();
  const u = useUnderstoodLines(ctx);
  const canEdit = useCan("business.edit");
  const qc = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setupHref = stepPath(projectId, "business");

  if (!u.open) {
    return <PartPlaceholder what={t("analysis.brief.understoodPlaceholder", "Your business analyst sums up your project here: what it is, its objective and who it is for.")} when={t("analysis.brief.whenAnalysisStarts", "Written once the project analysis starts in Project setup.")} />;
  }
  if (u.loading) return <PartLoading />;

  const brief = u.brief;
  const signed = understandingSigned(brief, step);
  const actions = canEdit && !signed;
  const lines: Line[] = [];
  if (u.about) lines.push({ key: "about", label: u.existing ? t("analysis.brief.whatItDoesToday", "What it does today") : t("analysis.brief.inShort", "In short"), text: clip(u.about, 360) });
  if (u.changes.length) lines.push({ key: "changes", label: t("analysis.brief.whatShouldChangeLabel", "What should change"), text: clip(listLine(u.changes), 260) });
  const objectiveLabel = t("analysis.brief.objective", "Objective");
  const forLabel = t("analysis.brief.for", "For");
  const notAnswered = t("analysis.brief.notAnsweredYet", "Not answered yet");
  lines.push(u.objective ? { key: "objective", label: objectiveLabel, text: clip(u.objective, 300) } : { key: "objective", label: objectiveLabel, text: notAnswered, missing: true });
  lines.push(u.users ? { key: "users", label: forLabel, text: clip(u.users, 240) } : { key: "users", label: forLabel, text: notAnswered, missing: true });

  const conflicts = brief?.conflicts ?? [];
  const proposed = brief?.features.flatMap((f) => f.proposedRequirements) ?? [];
  const confirmed = brief?.features.reduce((n, f) => n + f.confirmedRequirements.length, 0) ?? 0;

  const decide = async (key: string, decision: Decision) => {
    if (pendingKey) return;
    setPendingKey(key);
    setError(null);
    try { qc.setQueryData(briefKey(projectId), await saveDecision(projectId, decision)); }
    catch (e) { setError(errorText(e)); }
    finally { setPendingKey(null); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <dl className="flex flex-col gap-3">
        {lines.map((l) => (
          <div key={l.key} className="grid min-w-0 gap-0.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-[13px] font-medium text-ink3">{l.label}</dt>
            <dd className={cn("min-w-0 whitespace-pre-line break-words text-[15px] leading-snug", l.missing ? "italic text-ink3" : "text-ink")}>
              {l.text}
              {/* Project setup no longer asks for the objective or the users: the business analyst asks for them */}
              {l.missing && actions && <span className="ml-2 not-italic text-ink3">{t("analysis.brief.answerItIn", "· answer it in “{item}”", { item: ANALYST_ITEM_LABEL.brief })}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {canEdit && (
        <div>
          <Link to={setupHref} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink2 outline-none ring-1 ring-line transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
            <PencilLine size={14} aria-hidden />{t("analysis.brief.editInSetup", "Edit in Project setup")}
          </Link>
        </div>
      )}

      {conflicts.length > 0 && (
        <section aria-label={t("analysis.brief.disagreements", "Things that don't agree")} className="flex flex-col gap-2 border-t border-line pt-4">
          <h4 className="flex items-center gap-2 text-[13px] font-medium text-ink2">
            <TriangleAlert size={14} aria-hidden className="text-[rgb(var(--c-warning-text))]" />{t("analysis.brief.disagreements", "Things that don't agree")}
          </h4>
          <ul className="flex flex-col gap-2">
            {conflicts.map((c) => (
              <li key={c.key} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-block bg-surface2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words text-[15px] leading-snug text-ink">{c.description}</p>
                  {c.sources.length > 0 && <p className="mt-0.5 text-[12px] text-ink3">{t("analysis.brief.foundIn", "Found in {sources}", { sources: c.sources.join(", ") })}</p>}
                  {c.resolution && <p className="mt-1.5 text-[13px] text-[rgb(var(--c-success-text))]">{c.resolution}</p>}
                </div>
                {actions && (c.resolution
                  ? <Button size="sm" variant="ghost" disabled={pendingKey !== null} onClick={() => void decide(c.key, { kind: "conflict", key: c.key, value: null })}>{t("analysis.brief.undo", "Undo")}</Button>
                  : <Button size="sm" variant="secondary" disabled={pendingKey !== null} onClick={() => void decide(c.key, { kind: "conflict", key: c.key, value: "product_manager" })}>{t("analysis.brief.letAnalystSettle", "Let your business analyst settle it")}</Button>)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(proposed.length > 0 || confirmed > 0) && (
        <section aria-label={t("analysis.brief.foundShouldDo", "What we found it should do")} className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] font-medium text-ink2">{t("analysis.brief.foundShouldDo", "What we found it should do")}</h4>
            {proposed.length > 0 && <Chip tone="accent">{t("analysis.brief.toCheckCount", "{count} to check", { count: proposed.length })}</Chip>}
            {confirmed > 0 && <Chip tone="success">{t("analysis.brief.confirmedCount", "{count} confirmed", { count: confirmed })}</Chip>}
          </div>
          {proposed.length > 0 && (
            <ul className="flex flex-col gap-2">
              {proposed.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-block bg-accent-soft/40 px-4 py-3 ring-1 ring-inset ring-accent/20">
                  <Lightbulb size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-accent-text))]" />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words text-[15px] leading-snug text-ink">{r.description}</p>
                    <p className="mt-0.5 text-[12px] text-ink3">{requirementSource(r)}</p>
                  </div>
                  {actions && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="secondary" icon={<Check size={14} aria-hidden />} disabled={pendingKey !== null}
                        onClick={() => void decide(r.id, { kind: "requirement", key: r.id, value: "confirmed" })} aria-label={t("analysis.brief.confirmItem", "Confirm: {title}", { title: r.description })}>{t("analysis.brief.confirm", "Confirm")}</Button>
                      <Button size="sm" variant="ghost" disabled={pendingKey !== null}
                        onClick={() => void decide(r.id, { kind: "requirement", key: r.id, value: "rejected" })} aria-label={t("analysis.brief.setAsideItem", "Set aside: {title}", { title: r.description })}>{t("analysis.brief.setAside", "Set aside")}</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p role="status" aria-live="polite" className="text-[13px] text-danger empty:hidden">{error}</p>
    </div>
  );
}

/** "Features & user stories", opened in its row: today's analysis part (analysis/doc/scope/ScopeFeaturesPart) without
 *  its card and heading (the row shows the title). The scope plan's features grouped by Must / Should / Could, each a
 *  compact row (name, how many stories, its milestone) that opens to its description, its user stories in plain
 *  sentences and each story's acceptance checks. Read-only; the feedback buttons work under the page's
 *  ScopeFeedbackProvider. Same reads as the row summary (useScopeDoc). */
import { useT } from "@/madp/i18n";
import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import type { FeatureRecord, StoryRecord } from "@/madp/blocks/scope/records";
import { PRIORITY_LABEL } from "@/madp/components/scope/blocks/FeatureEditor";
import { storySentence } from "@/madp/components/scope/blocks/FeaturesPlan";
import { ScopeFeedbackButton } from "@/madp/components/scope/blocks/ScopeFeedback";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { PartError, PartPlaceholder, PartSkeleton, useScopeDoc, versionChip } from "@/madp/components/analysis/doc/scope/shared";
import { partOpen, type AnalysisCtx } from "@/madp/components/analysis/model";
import { Button, Chip } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";

const GROUPS = ["must", "nice", "later"] as const;


export function ScopeDetail(ctx: AnalysisCtx) {
  const t = useT();
  if (!partOpen("scope", ctx.step)) {
    return <PartPlaceholder text={t("analysis.scopeSummary.featuresPlaceholder", "Your business analyst writes the features and their user stories here once you approve the requirements. Each feature gets the stories that describe it and the checks that prove each story works.")} icon={<ListChecks size={16} strokeWidth={1.75} />} />;
  }
  return <Features projectId={ctx.projectId} />;
}

function Features({ projectId }: { projectId: string }) {
  const t = useT();
  const doc = useScopeDoc(projectId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  if (doc.error) return <PartError text={doc.error} onRetry={doc.retry} />;
  if (doc.loading) return <PartSkeleton rows={4} />;
  const ordered = [...doc.features].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return <PartPlaceholder working={doc.drafting} text={doc.drafting
    ? t("analysis.scopeSummary.featuresDrafting", "Your business analyst is turning the approved requirements into features and user stories. They appear here as soon as the first draft is ready.")
    : t("analysis.scopeSummary.featuresNone", "No features yet. Your business analyst drafts them from the approved requirements.")} />;

  const out = ordered.filter((f) => f.priority === "excluded");
  const included = ordered.filter((f) => f.priority !== "excluded");
  const storiesOf = (f: FeatureRecord) => doc.stories.filter((s) => s.featureId === f.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const storyCount = included.reduce((n, f) => n + storiesOf(f).length, 0);
  const milestoneOf = (f: FeatureRecord) => doc.milestones.find((m) => m.featureRefs.includes(f.ref)) ?? null;
  const allOpen = included.length > 0 && included.every((f) => expanded.has(f.id));
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink2">
        <span className="num">{[
          included.length === 1 ? t("analysis.scopeSummary.featuresOne", "1 feature") : t("analysis.scopeSummary.featuresMany", "{count} features", { count: included.length }),
          storyCount === 1 ? t("analysis.scopeSummary.storiesOne", "1 user story") : t("analysis.scopeSummary.storiesMany", "{count} user stories", { count: storyCount }),
        ].join(" · ")}</span>
        {versionChip(doc)}
        <Button size="sm" variant="ghost" className="ml-auto" aria-pressed={allOpen}
          onClick={() => setExpanded(allOpen ? new Set() : new Set(included.map((f) => f.id)))}>
          {allOpen ? t("analysis.scopeSummary.collapseAll", "Collapse all") : t("analysis.scopeSummary.expandAll", "Expand all")}
        </Button>
      </div>
      {GROUPS.map((p) => {
        const items = included.filter((f) => f.priority === p);
        if (!items.length) return null;
        return (
          <section key={p} aria-label={PRIORITY_LABEL[p]}>
            <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink3">{PRIORITY_LABEL[p]} · {items.length}</h3>
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-block ring-1 ring-line">
              {items.map((f) => {
                const m = milestoneOf(f);
                return (
                  <FeatureRow key={f.id} feature={f} stories={storiesOf(f)} milestone={m ? t("analysis.scopeSummary.milestoneNumber", "Milestone {number}", { number: m.number }) : null}
                    open={expanded.has(f.id)} onToggle={() => toggle(f.id)} />
                );
              })}
            </ul>
          </section>
        );
      })}
      {out.length > 0 && (
        <section aria-label={t("analysis.scopeSummary.notIncluded", "Not included")}>
          <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink3">{t("analysis.scopeSummary.notIncluded", "Not included")} · {out.length}</h3>
          <p className="mt-1 text-[13.5px] text-ink2">{out.map((f) => f.name).join(" · ")}</p>
        </section>
      )}
    </div>
  );
}

function FeatureRow({ feature: f, stories, milestone, open, onToggle }: {
  feature: FeatureRecord; stories: readonly StoryRecord[]; milestone: string | null; open: boolean; onToggle: () => void;
}) {
  const t = useT();
  const bodyId = `next-feature-${f.id}`;
  const checks = stories.reduce((n, s) => n + s.acceptanceCriteria.length, 0);
  return (
    <li>
      <FeedbackItem type="feature" id={f.id} className="flex items-center gap-2 pr-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
          <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-ink3 transition-transform", !open && "-rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-medium text-ink">{f.name}</span>
            {!open && f.description && <span className="block truncate text-[13px] text-ink3">{f.description}</span>}
          </span>
          <span className={cn("num shrink-0 text-[12.5px]", stories.length ? "text-ink3" : "text-[rgb(var(--c-warning-text))]")}>
            {stories.length === 0 ? t("analysis.scopeSummary.noStoriesYet", "No stories yet")
              : stories.length === 1 ? t("analysis.scopeSummary.storyOne", "1 story") : t("analysis.scopeSummary.storyMany", "{count} stories", { count: stories.length })}
          </span>
        </button>
        {milestone ? <Chip className="hidden shrink-0 sm:inline-flex">{milestone}</Chip> : <Chip tone="warning" className="hidden shrink-0 sm:inline-flex">{t("analysis.scopeSummary.noMilestone", "No milestone")}</Chip>}
        <ScopeFeedbackButton target={{ type: "feature", id: f.id }} label={f.name || t("analysis.scopeSummary.thisFeature", "this feature")} className="-my-1" />
      </FeedbackItem>
      <div id={bodyId} hidden={!open} className="px-3 pb-3 pl-[2.375rem]">
        {open && (
          <>
            {f.description && <p className="text-[13.5px] text-ink2">{f.description}</p>}
            {stories.length > 0 ? (
              <ol className="mt-2 flex flex-col gap-2" aria-label={t("analysis.scopeSummary.userStoriesOf", "User stories of {name}", { name: f.name })}>
                {stories.map((s) => (
                  <FeedbackItem as="li" key={s.id} type="story" id={s.id} className="rounded-block bg-surface2/60 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[13.5px] text-ink">{storySentence(s.actor, s.text)}</p>
                      <ScopeFeedbackButton target={{ type: "story", id: s.id }} label={storySentence(s.actor, s.text)} className="-my-1.5" />
                    </div>
                    {s.acceptanceCriteria.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink2" aria-label={t("analysis.scopeSummary.acceptanceChecks", "Acceptance checks")}>
                        {s.acceptanceCriteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                            <span className="min-w-0">{c}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 text-[12.5px] text-[rgb(var(--c-warning-text))]">{t("analysis.scopeSummary.noAcceptanceCheckYet", "No acceptance check yet")}</p>}
                  </FeedbackItem>
                ))}
              </ol>
            ) : <p className="mt-1 text-[13px] text-[rgb(var(--c-warning-text))]">{t("analysis.scopeSummary.noUserStoriesYet", "No user stories yet")}</p>}
            {checks > 0 && <p className="num mt-2 text-[12px] text-ink3">{checks === 1 ? t("analysis.scopeSummary.acceptanceCheckOne", "1 acceptance check") : t("analysis.scopeSummary.acceptanceCheckMany", "{count} acceptance checks", { count: checks })}</p>}
            {milestone && <p className="mt-1 text-[12px] text-ink3 sm:hidden">{milestone}</p>}
          </>
        )}
      </div>
    </li>
  );
}

/** "Milestones", opened in its row: today's analysis part (analysis/doc/scope/MilestonesPart) without its card and
 *  heading, kept compact for ten milestones or more: a timeline strip (one segment per milestone, as wide as its share
 *  of the user stories, coloured by where it stands) over a dense table (number, name, what it delivers, size, state).
 *  A table row opens to the goal and the features with their stories. Read-only; the delivery order, the status words
 *  and the unplaced features are the scope page's own (milestonePlan). Size is counted from the plan, never estimated. */
import { useT } from "@/madp/i18n";
import { useState } from "react";
import { ChevronDown, Flag } from "lucide-react";
import type { FeatureRecord, MilestoneRecord, StoryRecord } from "@/madp/blocks/scope/records";
import { milestonePlan, type MilestonePlanRow } from "@/madp/components/scope/blocks/MilestonesPlan";
import { storySentence } from "@/madp/components/scope/blocks/FeaturesPlan";
import { ScopeFeedbackButton } from "@/madp/components/scope/blocks/ScopeFeedback";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { PartError, PartPlaceholder, PartSkeleton, useScopeDoc, versionChip } from "@/madp/components/analysis/doc/scope/shared";
import { partOpen, type AnalysisCtx } from "@/madp/components/analysis/model";
import { Chip } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";


/** a segment's colour in the strip, from the milestone's status word */
const SEGMENT: Record<MilestonePlanRow["status"]["tone"], string> = {
  neutral: "bg-surface2 text-ink2 ring-1 ring-inset ring-line",
  accent: "bg-accent-soft text-[rgb(var(--c-accent-text))]",
  ai: "bg-ai-soft text-[rgb(var(--c-ai-text))]",
  success: "bg-success-soft text-success",
};

interface Row extends MilestonePlanRow { featureList: { id: string; name: string; stories: StoryRecord[] }[]; storyCount: number }

function rowsOf(milestones: readonly MilestoneRecord[], features: readonly FeatureRecord[], stories: readonly StoryRecord[]) {
  const plan = milestonePlan(milestones, features);
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const rows: Row[] = plan.rows.map((r) => {
    const refs = byId.get(r.id)?.featureRefs ?? [];
    const featureList = refs.flatMap((ref) => {
      const f = features.find((x) => x.ref === ref);
      if (!f) return [];
      return [{ id: f.id, name: f.name, stories: stories.filter((s) => s.featureId === f.id).sort((a, b) => a.sortOrder - b.sortOrder) }];
    });
    return { ...r, featureList, storyCount: featureList.reduce((n, f) => n + f.stories.length, 0) };
  });
  return { rows, unplaced: plan.unplaced };
}

export function MilestonesDetail(ctx: AnalysisCtx) {
  const t = useT();
  if (!partOpen("milestones", ctx.step)) {
    return <PartPlaceholder icon={<Flag size={16} strokeWidth={1.75} />}
      text={t("analysis.scopeSummary.milestonesPlaceholder", "Your business analyst and solution architect split the agreed features into milestones here, in the order they are built, once the requirements are approved. Each milestone is something you can see working.")} />;
  }
  return <Milestones projectId={ctx.projectId} />;
}

function Milestones({ projectId }: { projectId: string }) {
  const t = useT();
  const doc = useScopeDoc(projectId);
  const [openId, setOpenId] = useState<string | null>(null);
  if (doc.error) return <PartError text={doc.error} onRetry={doc.retry} />;
  if (doc.loading) return <PartSkeleton rows={3} />;
  const { rows, unplaced } = rowsOf(doc.milestones, doc.features, doc.stories);
  if (rows.length === 0) return <PartPlaceholder working={doc.drafting} text={doc.drafting
    ? t("analysis.scopeSummary.milestonesDrafting", "Your business analyst is planning the milestones from the features. They appear here as soon as the first draft is ready.")
    : t("analysis.scopeSummary.milestonesNone", "No milestones planned yet. They are planned together with the features.")} />;

  const done = rows.filter((r) => r.status.tone === "success").length;
  const show = (id: string) => {
    setOpenId(id);
    requestAnimationFrame(() => document.getElementById(`next-milestone-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink2">
        <span className="num">{[
          rows.length === 1 ? t("analysis.scopeSummary.milestonesOne", "1 milestone") : t("analysis.scopeSummary.milestonesMany", "{count} milestones", { count: rows.length }),
          ...(done > 0 ? [t("analysis.scopeSummary.milestonesDone", "{count} done", { count: done })] : []),
        ].join(" · ")}</span>
        {versionChip(doc)}
      </div>

      {/* the timeline: delivery order left to right, each segment as wide as its share of the stories */}
      <ol aria-label={t("analysis.scopeSummary.milestonesTimeline", "Milestones timeline")} className="flex h-8 w-full gap-1">
        {rows.map((r) => (
          <li key={r.id} className="min-w-[1.75rem]" style={{ flexGrow: Math.max(1, r.storyCount), flexBasis: 0 }}>
            <button type="button" onClick={() => (openId === r.id ? setOpenId(null) : show(r.id))}
              title={[`${r.number}. ${r.name}`, r.status.text, ...(r.storyCount
                ? [r.storyCount === 1 ? t("analysis.scopeSummary.storyOne", "1 story") : t("analysis.scopeSummary.storyMany", "{count} stories", { count: r.storyCount })]
                : [])].join(" · ")}
              aria-label={t("analysis.scopeSummary.milestoneSegment", "Milestone {number}: {name}, {status}", { number: r.number, name: r.name, status: r.status.text })} aria-pressed={openId === r.id}
              className={cn("num grid h-full w-full place-items-center rounded-[8px] text-[12.5px] font-medium outline-none transition",
                SEGMENT[r.status.tone], openId === r.id && "ring-2 ring-accent", "hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent/60")}>
              {r.number}
            </button>
          </li>
        ))}
      </ol>

      {/* the table: one line per milestone */}
      <div className="overflow-hidden rounded-block ring-1 ring-line">
        <div aria-hidden className="hidden grid-cols-[2rem_minmax(8rem,14rem)_1fr_8.5rem_7.5rem_1.25rem] gap-3 bg-surface2/60 px-3 py-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink3 md:grid">
          <span>{t("analysis.scopeSummary.colNumber", "No.")}</span><span>{t("analysis.scopeSummary.colMilestone", "Milestone")}</span><span>{t("analysis.scopeSummary.colDelivers", "Delivers")}</span><span>{t("analysis.scopeSummary.colSize", "Size")}</span><span>{t("analysis.scopeSummary.colState", "State")}</span><span />
        </div>
        <ol className="divide-y divide-line" aria-label={t("analysis.scopeSummary.milestonesInOrder", "Milestones in delivery order")}>
          {rows.map((r) => <MilestoneRow key={r.id} row={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />)}
        </ol>
      </div>

      {unplaced.length > 0 && (
        <p className="rounded-block bg-warning-soft px-3.5 py-2.5 text-[13px] text-[rgb(var(--c-warning-text))]">
          {t("analysis.scopeSummary.notInMilestone", "Not in a milestone yet: {features}", { features: unplaced.join(" · ") })}
        </p>
      )}
    </div>
  );
}

function MilestoneRow({ row: r, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  const t = useT();
  const bodyId = `next-milestone-body-${r.id}`;
  const delivers = r.goal || r.features.join(" · ");
  const noFeatures = t("analysis.scopeSummary.noFeaturesYetShort", "No features yet");
  const size = r.featureList.length
    ? [
      r.featureList.length === 1 ? t("analysis.scopeSummary.featuresOne", "1 feature") : t("analysis.scopeSummary.featuresMany", "{count} features", { count: r.featureList.length }),
      r.storyCount === 1 ? t("analysis.scopeSummary.storyOne", "1 story") : t("analysis.scopeSummary.storyMany", "{count} stories", { count: r.storyCount }),
    ].join(" · ")
    : noFeatures;
  return (
    <FeedbackItem as="li" type="milestone" id={r.id} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <div id={`next-milestone-${r.id}`} className="flex items-center">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}
          className="grid min-w-0 flex-1 grid-cols-[2rem_1fr_1.25rem] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left outline-none transition-colors hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 md:grid-cols-[2rem_minmax(8rem,14rem)_1fr_8.5rem_7.5rem_1.25rem]">
          <span aria-hidden className="num grid h-7 w-7 place-items-center rounded-full bg-surface2 text-[13px] font-medium text-ink">{r.number}</span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
            <span className="block truncate text-[12.5px] text-ink3 md:hidden">{size} · {r.status.text}</span>
          </span>
          <span className="hidden min-w-0 truncate text-[13px] text-ink2 md:block" title={delivers}>
            {delivers || <span className="text-[rgb(var(--c-warning-text))]">{noFeatures}</span>}
          </span>
          <span className={cn("num hidden truncate text-[12.5px] md:block", r.featureList.length ? "text-ink2" : "text-[rgb(var(--c-warning-text))]")}>{size}</span>
          <span className="hidden md:block"><Chip tone={r.status.tone}>{r.status.text}</Chip></span>
          <ChevronDown size={16} aria-hidden className={cn("justify-self-end text-ink3 transition-transform", !open && "-rotate-90")} />
        </button>
        <ScopeFeedbackButton target={{ type: "milestone", id: r.id }} label={r.name || t("analysis.scopeSummary.milestoneNumber", "Milestone {number}", { number: r.number })} className="mr-2" />
      </div>
      <div id={bodyId} hidden={!open} className="border-t border-line bg-surface2/40 px-3 py-3 md:pl-[3.75rem]">
        {open && (
          <>
            <p className="text-[12.5px] text-ink3">{r.order}</p>
            {r.goal && <p className="mt-1 max-w-[72ch] text-[13.5px] text-ink">{r.goal}</p>}
            {r.featureList.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-2">
                {r.featureList.map((f) => (
                  <li key={f.id}>
                    <p className="text-[13.5px] font-medium text-ink">{f.name}</p>
                    {f.stories.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5 text-[13px] text-ink2">
                        {f.stories.map((s) => (
                          <li key={s.id} className="flex items-start gap-2">
                            <span aria-hidden className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                            <span className="min-w-0">{storySentence(s.actor, s.text)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[12.5px] text-[rgb(var(--c-warning-text))]">{t("analysis.scopeSummary.noUserStoriesYet", "No user stories yet")}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[13px] text-[rgb(var(--c-warning-text))]">{t("analysis.scopeSummary.noFeaturesInMilestone", "No features in this milestone yet")}</p>}
          </>
        )}
      </div>
    </FeedbackItem>
  );
}

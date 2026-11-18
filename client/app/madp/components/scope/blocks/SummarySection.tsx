/** Real counts only, and the objective sentence from the Objective record (read only). Missing data reads "—". */
import { PRIORITY_WORD } from "@/madp/components/requirements/priority";
import { Card } from "../../../ui/kit";
import { useT } from "@/madp/i18n";

export interface SummaryCounts { must: number; nice: number; later: number; excluded: number; stories: number; screens: number; milestones: number }

export function countSummary(
  features: readonly { priority: string }[], stories: number, screens: number, milestones: number,
): SummaryCounts {
  const n = (p: string) => features.filter((f) => f.priority === p).length;
  return { must: n("must"), nice: n("nice"), later: n("later"), excluded: n("excluded"), stories, screens, milestones };
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <dd className="num text-[22px] font-medium tracking-[-0.02em]">{value ?? "—"}</dd>
      <dt className="text-[12px] text-ink3">{label}</dt>
    </div>
  );
}

export function SummarySection({ objective, counts }: { objective: string | null; counts: SummaryCounts | null }) {
  const t = useT();
  const c = counts;
  return (
    <section aria-label={t("analysis.scope.summary.title", "Summary")}>
      <Card title={t("analysis.scope.summary.title", "Summary")}>
        <p className="max-w-[70ch] text-[16px] leading-snug text-ink">{objective?.trim() ? objective : t("analysis.scope.summary.noObjective", "No objective confirmed yet.")}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 2xl:grid-cols-7">
          <Stat label={PRIORITY_WORD.must} value={c ? c.must : null} />
          <Stat label={PRIORITY_WORD.nice} value={c ? c.nice : null} />
          <Stat label={PRIORITY_WORD.later} value={c ? c.later : null} />
          <Stat label={t("analysis.scope.notIncluded", "Not included")} value={c ? c.excluded : null} />
          <Stat label={t("analysis.scope.summary.userStories", "User stories")} value={c ? c.stories : null} />
          <Stat label={t("analysis.scope.summary.screens", "Screens")} value={c ? c.screens : null} />
          <Stat label={t("analysis.scope.milestones", "Milestones")} value={c ? c.milestones : null} />
        </dl>
      </Card>
    </section>
  );
}

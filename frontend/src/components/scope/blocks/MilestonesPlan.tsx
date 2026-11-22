/** The milestones of the Scope & delivery plan, readable like a document: in delivery order, each with its goal, the
 *  features it delivers and where it stands; features not yet placed are named. "Edit milestones" opens today's editor
 *  (MilestonesSection), which the page keeps mounted so its autosave is never cut off. */
import { PencilLine } from "lucide-react";
import type { FeatureRecord, MilestoneRecord } from "@/blocks/scope/records";
import { Button, Card, Chip } from "@/ui/kit";
import { FeedbackItem } from "@/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./ScopeFeedback";
import { t, useT } from "@/i18n";

type Tone = "neutral" | "accent" | "success" | "ai";

/** A milestone's stored status in plain words. */
export function milestoneStatusWord(status: string): { text: string; tone: Tone } {
  switch (status) {
    case "building": return { text: t("analysis.scope.milestone.building", "Being built"), tone: "accent" };
    case "preview-ready": return { text: t("analysis.scope.milestone.previewReady", "Preview ready"), tone: "ai" };
    case "done": return { text: t("analysis.scope.milestone.done", "Done"), tone: "success" };
    default: return { text: t("analysis.scope.milestone.planned", "Planned"), tone: "neutral" };
  }
}

export interface MilestonePlanRow { id: string; number: number; order: string; name: string; goal: string; features: string[]; status: { text: string; tone: Tone } }

/** "First" … "Eighth", then "No. 9" (read at call time, in the current language). */
function ordinal(i: number): string {
  switch (i) {
    case 0: return t("analysis.scope.milestone.first", "First");
    case 1: return t("analysis.scope.milestone.second", "Second");
    case 2: return t("analysis.scope.milestone.third", "Third");
    case 3: return t("analysis.scope.milestone.fourth", "Fourth");
    case 4: return t("analysis.scope.milestone.fifth", "Fifth");
    case 5: return t("analysis.scope.milestone.sixth", "Sixth");
    case 6: return t("analysis.scope.milestone.seventh", "Seventh");
    case 7: return t("analysis.scope.milestone.eighth", "Eighth");
    default: return t("analysis.scope.milestone.numberN", "No. {n}", { n: i + 1 });
  }
}

/** The plan's rows in delivery order, and the included features no milestone holds yet. Pure. */
export function milestonePlan(milestones: readonly MilestoneRecord[], features: readonly Pick<FeatureRecord, "ref" | "name" | "priority">[]): {
  rows: MilestonePlanRow[]; unplaced: string[];
} {
  const ordered = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const nameOf = (ref: string) => features.find((f) => f.ref === ref)?.name ?? null;
  const rows = ordered.map((m, i) => ({
    id: m.id, number: m.number, name: m.name, goal: m.goal,
    order: ordered.length > 1 ? t("analysis.scope.milestone.orderOf", "{order} of {total}", { order: ordinal(i), total: ordered.length }) : ordinal(i),
    features: m.featureRefs.map(nameOf).filter((n): n is string => n !== null),
    status: milestoneStatusWord(m.status),
  }));
  const placed = new Set(ordered.flatMap((m) => m.featureRefs));
  const unplaced = features.filter((f) => f.priority !== "excluded" && !placed.has(f.ref)).map((f) => f.name);
  return { rows, unplaced };
}

export function MilestonesPlan({ milestones, features, canEdit, onEdit }: {
  milestones: readonly MilestoneRecord[]; features: readonly FeatureRecord[]; canEdit: boolean; onEdit: () => void;
}) {
  const t = useT();
  const { rows, unplaced } = milestonePlan(milestones, features);
  return (
    <Card title={<>{t("analysis.scope.milestones", "Milestones")} <span className="num text-ink3">{rows.length}</span></>}
      action={canEdit ? <Button size="sm" variant="ghost" icon={<PencilLine size={14} aria-hidden />} onClick={onEdit}>{t("analysis.scope.milestone.edit", "Edit milestones")}</Button> : undefined}>
      {rows.length === 0 && <p className="text-[14px] text-ink2">{t("analysis.scope.milestone.none", "No milestones planned yet.")}</p>}
      {rows.length > 0 && (
        <ol className="divide-y divide-line overflow-hidden rounded-block ring-1 ring-line" aria-label={t("analysis.scope.milestone.inOrder", "Milestones in delivery order")}>
          {rows.map((m) => (
            <FeedbackItem as="li" key={m.id} type="milestone" id={m.id} className="grid gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[2.25rem_1fr_auto]">
              <span aria-hidden className="num grid h-8 w-8 place-items-center rounded-full bg-surface2 text-[14px] font-medium text-ink">{m.number}</span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{m.name}<span className="ml-2 text-[12.5px] font-normal text-ink3">{m.order}</span></p>
                {m.goal && <p className="mt-0.5 text-[13.5px] text-ink2">{m.goal}</p>}
                <p className="mt-1.5 text-[13px] text-ink">
                  {m.features.length ? m.features.join(" · ") : <span className="text-[rgb(var(--c-warning-text))]">{t("analysis.scope.noFeaturesYet", "No features yet")}</span>}
                </p>
              </div>
              <div className="flex items-start gap-1.5 sm:justify-self-end">
                <Chip tone={m.status.tone}>{m.status.text}</Chip>
                <ScopeFeedbackButton target={{ type: "milestone", id: m.id }} label={m.name || t("analysis.scope.milestoneN", "Milestone {n}", { n: m.number })} className="-my-1" />
              </div>
            </FeedbackItem>
          ))}
        </ol>
      )}
      {unplaced.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-block bg-warning-soft px-3.5 py-2.5 text-[13px] text-[rgb(var(--c-warning-text))]">
          <p className="min-w-0 flex-1">{t("analysis.scope.milestone.unplaced", "Not in a milestone yet: {list}", { list: unplaced.join(" · ") })}</p>
          {canEdit && <Button size="sm" variant="secondary" onClick={onEdit}>{t("analysis.scope.milestone.place", "Place in a milestone")}</Button>}
        </div>
      )}
    </Card>
  );
}

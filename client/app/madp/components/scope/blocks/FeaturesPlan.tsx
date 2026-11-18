/** The features of the Scope & delivery plan, readable like a document: grouped by Must / Should / Could, each with its
 *  user stories in plain sentences, the milestone it is planned in and its feedback. "Edit features" opens today's editor
 *  (FeaturesSection), which the page keeps mounted so its autosave is never cut off. */
import { PencilLine } from "lucide-react";
import type { FeatureRecord, MilestoneRecord, StoryRecord } from "@/madp/blocks/scope/records";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { PRIORITY_LABEL } from "./FeatureEditor";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./ScopeFeedback";
import { t, useT } from "@/madp/i18n";

const GROUPS = ["must", "nice", "later"] as const;

/** A story as one sentence: kept as written when it already reads "As …", else "As <who>, I can <what>". */
export function storySentence(actor: string, text: string): string {
  const body = text.trim();
  if (/^as\s/i.test(body)) return body;
  const who = actor.trim();
  return who
    ? t("analysis.scope.storySentence", "As {who}, I can {what}", { who: who.replace(/^(a|an|the)\s+/i, (m) => m.toLowerCase()), what: body.replace(/^./, (c) => c.toLowerCase()) })
    : body;
}

export function FeaturesPlan({ features, stories, milestones, canEdit, onEdit, onPlace }: {
  features: readonly FeatureRecord[]; stories: readonly StoryRecord[]; milestones: readonly MilestoneRecord[];
  canEdit: boolean; onEdit: () => void;
  /** Opens the milestones editor for a feature no milestone holds yet (when the person may arrange milestones). */
  onPlace?: () => void;
}) {
  const ordered = [...features].sort((a, b) => a.sortOrder - b.sortOrder);
  const out = ordered.filter((f) => f.priority === "excluded");
  const milestoneOf = (f: FeatureRecord) => milestones.find((m) => m.featureRefs.includes(f.ref)) ?? null;
  const included = ordered.length - out.length;
  const t = useT();
  return (
    <Card title={<>{t("analysis.scope.features", "Features")} <span className="num text-ink3">{included}</span></>}
      action={canEdit ? <Button size="sm" variant="ghost" icon={<PencilLine size={14} aria-hidden />} onClick={onEdit}>{t("analysis.scope.editFeatures", "Edit features")}</Button> : undefined}>
      {ordered.length === 0 && <p className="text-[14px] text-ink2">{t("analysis.scope.noFeaturesYetDot", "No features yet.")}</p>}
      <div className="flex flex-col gap-5">
        {GROUPS.map((p) => {
          const list = ordered.filter((f) => f.priority === p);
          if (!list.length) return null;
          return (
            <section key={p} aria-label={PRIORITY_LABEL[p]}>
              <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink3">{PRIORITY_LABEL[p]} · {list.length}</h3>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-block ring-1 ring-line">
                {list.map((f) => {
                  const mine = stories.filter((s) => s.featureId === f.id).sort((a, b) => a.sortOrder - b.sortOrder);
                  const m = milestoneOf(f);
                  return (
                    <li key={f.id} className="px-2 py-1.5">
                      <FeedbackItem type="feature" id={f.id} className="flex flex-wrap items-start justify-between gap-2 px-2 py-2">
                        <div className="min-w-[min(100%,16rem)] flex-1">
                          <p className="text-[15px] font-medium text-ink">{f.name}</p>
                          {f.description && <p className="mt-0.5 text-[13.5px] text-ink2">{f.description}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {m ? <Chip>{t("analysis.scope.milestoneN", "Milestone {n}", { n: m.number })}</Chip> : onPlace ? (
                            <button type="button" onClick={onPlace} title={t("analysis.scope.placeIt", "Place it in a milestone")}
                              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                              <Chip tone="warning">{t("analysis.scope.notInMilestonePlace", "Not in a milestone · place it")}</Chip>
                            </button>
                          ) : <Chip tone="warning">{t("analysis.scope.notInMilestone", "Not in a milestone")}</Chip>}
                          <ScopeFeedbackButton target={{ type: "feature", id: f.id }} label={f.name || t("analysis.scope.thisFeature", "this feature")} className="-my-1" />
                        </div>
                      </FeedbackItem>
                      {mine.length > 0 ? (
                        <ul className="space-y-0.5 text-[13.5px] text-ink">
                          {mine.map((s) => (
                            <FeedbackItem as="li" key={s.id} type="story" id={s.id} className="flex items-start gap-2 px-2 py-0.5">
                              <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                              <span className="min-w-0 flex-1">
                                {storySentence(s.actor, s.text)}
                                {s.acceptanceCriteria.length > 0 && (
                                  <span className="text-ink3" title={s.acceptanceCriteria.join("\n")}>
                                    {" "}· {s.acceptanceCriteria.length === 1 ? t("analysis.scope.checkOne", "1 check") : t("analysis.scope.checks", "{count} checks", { count: s.acceptanceCriteria.length })}
                                  </span>
                                )}
                              </span>
                              <ScopeFeedbackButton target={{ type: "story", id: s.id }} label={storySentence(s.actor, s.text)} className="-my-1.5" />
                            </FeedbackItem>
                          ))}
                        </ul>
                      ) : <p className="px-2 pb-1 text-[13px] text-[rgb(var(--c-warning-text))]">{t("analysis.scope.noUserStoriesYet", "No user stories yet")}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {out.length > 0 && (
          <section aria-label={t("analysis.scope.notIncluded", "Not included")}>
            <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink3">{t("analysis.scope.notIncluded", "Not included")} · {out.length}</h3>
            <ul className="mt-1 flex flex-wrap items-center gap-x-1 text-[13.5px] text-ink2">
              {out.map((f, i) => (
                <FeedbackItem as="li" key={f.id} type="feature" id={f.id} className="inline-flex items-center gap-0.5 rounded-full pl-1">
                  {i > 0 && <span aria-hidden className="pr-1 text-ink3">·</span>}{f.name}
                  <ScopeFeedbackButton target={{ type: "feature", id: f.id }} label={f.name || t("analysis.scope.thisFeature", "this feature")} />
                </FeedbackItem>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}

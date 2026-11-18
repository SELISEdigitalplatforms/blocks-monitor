/** The Milestones section of the scope page: the tray, the cards, native drag, Move menus, keyboard drag mode and
 *  autosave through milestones.save. Milestones come only from Milestone rows or the person's own edits. */
import { useMemo, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button, EmptyState } from "@/madp/ui/kit";
import { EngineJobStatus } from "../engine/EngineJobStatus";
import { jobWorthShowing } from "../scope/blocks/nowChecklist";
import { milestoneKey } from "../../domain/milestones";
import type { ScopeContext } from "@/madp/blocks/scope/context";
import type { FeatureRecord, MilestoneRecord, ScopeVersionRecord } from "@/madp/blocks/scope/records";
import { useFeatures, useMilestones, useScopeJobs } from "@/madp/blocks/scope/hooks";
import { saveStatusText, useMilestonesAutosave } from "@/madp/blocks/scope/autosave";
import { useMilestonesSuggest } from "@/madp/blocks/scope/mutations";
import { scopeErrorMessage, staleRowText } from "@/madp/blocks/scope/messages";
import { FeatureTray } from "./FeatureTray";
import { MilestoneCard } from "./MilestoneCard";
import { MilestoneFeatureRow } from "./MilestoneFeatureRow";
import { useMilestoneArrange, isExcluded, type ArrangeFeature } from "./useMilestoneArrange";
import { useT } from "@/madp/i18n";

const NO_MILESTONES: MilestoneRecord[] = [];
const NO_FEATURES: FeatureRecord[] = [];

export function MilestonesSection({ ctx, version, editable, locked = false }: { ctx: ScopeContext; version: ScopeVersionRecord | null; editable: boolean; locked?: boolean }) {
  const t = useT();
  const storedQ = useMilestones(ctx, version);
  const featuresQ = useFeatures(ctx, version);
  const jobs = useScopeJobs(ctx);
  const suggest = useMilestonesSuggest(ctx);
  // depend on the data, not on the query result: the result is a new object on every render
  const storedData = storedQ.data;
  const featuresData = featuresQ.data;
  const stored = useMemo(() => storedData?.items ?? NO_MILESTONES, [storedData]);
  const features = useMemo<ArrangeFeature[]>(
    () => (featuresData?.items ?? NO_FEATURES).map((f) => ({ ref: f.ref, name: f.name, priority: f.priority })),
    [featuresData],
  );
  const includedRefs = useMemo(() => features.filter((f) => !isExcluded(f)).map((f) => f.ref), [features]);
  const autosave = useMilestonesAutosave(ctx, version, stored, includedRefs);
  const canEdit = editable && ctx.can("milestones.edit") && !!version && version.status !== "locked";
  const arrange = useMilestoneArrange({ stored, features, autosave, editable: canEdit });
  const [confirming, setConfirming] = useState(false);

  const included = arrange.included;
  const canSuggest = canEdit && included.length > 0;
  const statusText = saveStatusText(autosave.status);
  // a frozen scope no longer waits for the engine: a stale queued suggestion does not apply
  const frozen = locked || version?.status === "locked";
  // a suggestion shows while it runs, when it failed, or just after it finished (not an old one from days ago)
  const job = frozen ? undefined : jobWorthShowing(jobs.suggest) ?? undefined;
  const heldItem = arrange.held;

  const runSuggest = () => {
    setConfirming(false);
    if (version) suggest.mutate({ projectId: ctx.projectId, scopeVersionId: version.id });
  };
  const startSuggest = () => (arrange.plan.length ? setConfirming(true) : runSuggest());

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-[20px] font-semibold text-ink">{t("build.page.milestones", "Milestones")}</h2>
      <span className="text-[13px] text-ink2">{arrange.plan.length}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} aria-hidden />} onClick={arrange.add}>{t("build.milestones.add", "Add milestone")}</Button>
        )}
        {canSuggest && (
          <Button size="sm" variant="ghost" icon={<Lightbulb size={14} strokeWidth={1.75} aria-hidden />} onClick={startSuggest} disabled={confirming || suggest.isPending}>{t("build.milestones.suggest", "Suggest milestones")}</Button>
        )}
      </div>
    </div>
  );

  if (!version || (!features.length && !stored.length)) {
    return (
      <section aria-label={t("build.page.milestones", "Milestones")} className="grid gap-4">
        {header}
        <EmptyState title={t("build.milestones.addFeatureFirst", "Add a feature first to arrange milestones.")} />
      </section>
    );
  }

  const number = (i: number) => arrange.plan[i]?.number ?? i + 1;
  const trayRows = arrange.unassigned.map((ref, i) => (
    <MilestoneFeatureRow
      key={ref}
      featureRef={ref}
      name={arrange.nameOf(ref)}
      index={i}
      count={arrange.unassigned.length}
      targets={arrange.plan.map((m, n) => ({ key: milestoneKey(m), number: number(n) }))}
      inMilestone={false}
      editable={canEdit}
      picked={heldItem?.type === "feature" && heldItem.ref === ref}
      onMoveUp={() => undefined}
      onMoveDown={() => undefined}
      onMoveTo={(to) => arrange.move(ref, to, Number.MAX_SAFE_INTEGER)}
      onUnassign={() => undefined}
      onHandleKey={arrange.handleKey({ type: "feature", ref }, `f:${ref}`)}
      onDropBefore={() => undefined}
    />
  ));

  return (
    <section aria-label={t("build.page.milestones", "Milestones")} className="grid gap-4">
      {header}

      {confirming && (
        <div role="group" aria-label={t("build.milestones.confirmLabel", "Confirm the suggestion")} className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink">
          <span>{t("build.milestones.confirmText", "The suggestion replaces the current arrangement when it arrives.")}</span>
          <Button size="sm" variant="ghost" onClick={runSuggest}>{t("build.milestones.confirm", "Confirm")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("changes.checks.card.cancel", "Cancel")}</Button>
        </div>
      )}
      {suggest.isError && <p role="alert" className="text-[13px] text-danger">{scopeErrorMessage(suggest.error)}</p>}
      {job && <EngineJobStatus job={job} variant="compact" />}

      <div role="status" className="flex flex-wrap items-center gap-3 text-[13px] text-ink2">
        <span>{statusText}</span>
        {canEdit && autosave.status.state === "error" && (
          <Button size="sm" variant="ghost" onClick={() => autosave.retry()}>{t("build.milestones.retry", "Retry")}</Button>
        )}
        {autosave.stale && (
          <>
            <span>{staleRowText()}</span>
            <Button size="sm" variant="ghost" onClick={() => { arrange.resetToStored(); autosave.reload(); }}>{t("build.milestones.reload", "Reload")}</Button>
          </>
        )}
      </div>
      <div aria-live="polite" role="log" className="sr-only">{arrange.announcement}</div>

      <div ref={arrange.container} className="grid gap-4">
        <FeatureTray
          editable={canEdit}
          empty={arrange.unassigned.length === 0}
          onDropFeature={(d) => arrange.dropFeature(d, { milestoneKey: null })}
        >
          {trayRows}
        </FeatureTray>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {arrange.plan.map((m, i) => {
            const key = milestoneKey(m);
            return (
              <MilestoneCard
                key={key}
                milestone={m}
                index={i}
                count={arrange.plan.length}
                displayNumber={number(i)}
                others={arrange.plan.map((o, n) => ({ key: milestoneKey(o), number: number(n) })).filter((o) => o.key !== key)}
                featureName={arrange.nameOf}
                issues={arrange.issues[key]}
                editable={canEdit}
                heldRef={heldItem?.type === "feature" ? heldItem.ref : null}
                heldSelf={heldItem?.type === "milestone" && heldItem.key === key}
                onRename={(v) => arrange.rename(key, v)}
                onGoal={(v) => arrange.goal(key, v)}
                onRemove={() => arrange.remove(key)}
                focusName={!!arrange.nameFocus && m.clientKey === arrange.nameFocus}
                onNameFocused={arrange.clearNameFocus}
                onMoveMilestone={(to) => arrange.reorder(i, to)}
                onMoveFeature={arrange.move}
                onUnassign={arrange.unassign}
                onDropFeature={(d, idx) => arrange.dropFeature(d, { milestoneKey: key, index: idx })}
                onDropMilestone={(d) => arrange.dropMilestone(d, i)}
                onFeatureKey={(ref) => arrange.handleKey({ type: "feature", ref }, `f:${ref}`)}
                onCardKey={arrange.handleKey({ type: "milestone", key }, `m:${key}`)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}


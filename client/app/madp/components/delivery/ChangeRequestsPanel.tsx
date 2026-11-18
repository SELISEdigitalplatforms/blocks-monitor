/** Changes and fixes after the first release to development (Blocks path; the local pages keep ChangeRequestLayer). Drafts are
 *  saved and sent for analysis through Blocks Logic Functions (cr.saveDraft, cr.submit); the questions, the approval and
 *  the build follow on the change request's page. A change request saved before the analysis existed shows as before. */
import { useMemo, useRef, useState } from "react";
import { byNewestNumber } from "@/madp/lib/newest";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import { useTalkAttachments } from "@/madp/blocks/collab/talkUpload";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import type { DeliveryChangeRequest, DeliveryMilestone, DeliveryRelease } from "@/madp/blocks/delivery/types";
import { useCrSaveDraft } from "@/madp/blocks/delivery/actions";
import { latestJobFor, useFeatureNames } from "@/madp/blocks/delivery/hooks";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { Button, Card, Chip, Input, Label, Select, Textarea } from "@/madp/ui/kit";
import { changeCode, type ChangeLane } from "@/madp/domain/delivery";
import { crStatusLabel } from "./releaseUi";
import { ChangeLifecycleBar } from "@/madp/components/changes/ChangeLifecycle";
import { analysisOf, changeStage, decisionOf, lifecycleSteps, type ChangeStage } from "@/madp/components/changes/changeFlow";
import { blocksChangeMessage, useSubmitBlocksChange } from "@/madp/components/changes/blocksChanges";
import { changeStopped } from "@/madp/components/changes/changeStopped";
import { useBuildClock } from "@/madp/components/changes/buildClock";
import { checksSettled } from "@/madp/domain/changeChecks";
import { openAfterDeploy } from "@/madp/components/build/afterDeployUi";
import { t, useT } from "@/madp/i18n";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 10_000;
// the same words as the change request window (BLOCKS_LANE_META); a fix can also be raised here
const lanes = () => [
  { value: "change", label: t("build.release.changes.laneChange", "Change feature") },
  { value: "enhance", label: t("build.release.changes.laneEnhance", "Enhance feature") },
  { value: "add", label: t("build.release.changes.laneAdd", "Add feature") },
  { value: "fix", label: t("build.release.changes.laneFix", "Fix a problem") },
];

const TONE = {
  draft: "neutral", analysing: "ai", questions: "warning", review: "warning", approved: "success", rejected: "danger", failed: "danger", building: "accent",
} as const;

/** The link of a change request row: what you do next on its page. */
function nextAction(stage: ChangeStage): string | null {
  switch (stage) {
    case "analysing": case "refining": return t("build.release.changes.nextFollowAnalysis", "Follow the analysis");
    case "questions": return t("build.release.changes.nextAnswer", "Answer the questions");
    case "review": return t("build.release.changes.nextReview", "Review and approve");
    case "approved": return t("build.release.changes.nextStart", "Start the build");
    case "buildFailed": case "buildLost": return t("build.release.changes.nextStartAgain", "Start the build again");
    case "analysisFailed": return t("build.release.changes.nextAnalysisAgain", "Try the analysis again");
    case "building": return t("build.release.changes.nextFollowBuild", "Follow the build");
    default: return null;
  }
}

/** A feature picker label: the feature's name and its milestone; never the ref ("A feature" while the name is not read yet). */
export function featureOptionLabel(ref: string, names: ReadonlyMap<string, string>, m: { number: number; name: string }): string {
  return t("build.release.changes.featureOption", "{feature} · Milestone {number}: {milestone}",
    { feature: names.get(ref) ?? t("build.release.changes.aFeature", "A feature"), number: m.number, milestone: m.name });
}

export function ChangeRequestsPanel({ ctx, changeRequests, milestones, releases, jobs }: {
  ctx: DeliveryContext;
  changeRequests: readonly DeliveryChangeRequest[];
  milestones: readonly DeliveryMilestone[];
  releases: readonly DeliveryRelease[];
  /** the project's delivery jobs: a change still "building" whose change.build job stopped offers the build again */
  jobs: readonly EngineJob[];
}) {
  const t = useT();
  const save = useCrSaveDraft(ctx);
  const clock = useBuildClock(changeRequests.some((c) => c.status === "building"));
  // failing checks that pass since on a later version (from any change's run) are not a change's any more
  const settled = useMemo(() => checksSettled(changeRequests), [changeRequests]);
  const submitApi = useSubmitBlocksChange(ctx.workspaceId, ctx.projectId);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const featureNames = useFeatureNames(ctx);
  const form = useRef<HTMLFormElement>(null);
  // "Edit draft" while the form holds unsaved text asks before replacing it
  const [replacing, setReplacing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lane, setLane] = useState("change");
  const [featureRef, setFeatureRef] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // files sent with the request (a design, a screenshot, a document): they stay with the change request
  const files = useAttachDraft({ projectId: ctx.projectId, owner: { ownerType: "change-request", forId: editingId }, disabled: !ctx.can("build.run") || save.pending });
  const hold = attachHold(files);
  const sentFiles = useTalkAttachments(ctx.projectId, "change-request", changeRequests.map((c) => c.id)).data;
  // newest first: the latest change request on top
  const listed = byNewestNumber(changeRequests, (c) => c.number);

  const hasDev = releases.some((r) => r.environment === "dev");
  if (!hasDev) {
    return (
      <Card title={t("build.release.changes.title", "Changes and fixes")}>
        <p className="text-[13px] text-ink2">{t("build.release.changes.beforeFirst", "Change requests open after the first release to the development environment.")}</p>
        {changeRequests.length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {listed.map((c) => (
              <li key={c.id} className="min-w-0 rounded-block bg-surface2 p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="num font-mono text-[13px] font-medium">{changeCode(c)}</span>
                  <span className="min-w-0 break-words text-[14px]">{c.title || t("build.release.changes.untitled", "Untitled")}</span>
                  <Chip tone="neutral">{crStatusLabel(c.status)}</Chip>
                </div>
                <p className="mt-2 text-[12px] text-ink2">{t("build.release.changes.savedWaits", "It is saved. It can be built once the first release is on the development environment.")}</p>
                <Link to={`/p/${ctx.projectId}/build?cr=${c.number}`} className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
                  {t("build.release.changes.open", "Open the change request")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const mayEdit = ctx.can("build.run");
  const features = milestones.flatMap((m) => m.featureRefs.map((f) => ({ value: f, label: featureOptionLabel(f, featureNames, m) })));
  // a product without a Factory scope (an existing product attached as it is live): changes are about the product as a
  // whole, and a new feature is built on it in small builds (no Scope & success)
  const scoped = features.length > 0;
  const needsFeature = lane !== "add" && scoped;
  const canSave = mayEdit && !save.pending && !hold && (title.trim() !== "" || description.trim() !== "") && (!needsFeature || featureRef !== "");
  const reset = () => { setEditingId(null); setLane("change"); setFeatureRef(""); setTitle(""); setDescription(""); };
  const loadedDraft = editingId ? changeRequests.find((c) => c.id === editingId) ?? null : null;
  const formDirty = loadedDraft
    ? title !== loadedDraft.title || description !== loadedDraft.description
    : title.trim() !== "" || description.trim() !== "";
  const edit = (c: DeliveryChangeRequest) => {
    setReplacing(null);
    setEditingId(c.id); setLane(c.lane); setFeatureRef(c.featureRef); setTitle(c.title); setDescription(c.description);
    // the form is at the bottom of the card: bring it into view with the title ready to type
    requestAnimationFrame(() => {
      form.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      form.current?.querySelector<HTMLInputElement>('input[data-field="title"]')?.focus({ preventScroll: true });
    });
  };
  const askEdit = (c: DeliveryChangeRequest) => (formDirty && editingId !== c.id ? setReplacing(c.id) : edit(c));
  const submit = async () => {
    const ok = await save.run({
      changeRequestId: editingId ?? undefined, lane: lane as ChangeLane, featureRef: scoped ? featureRef : "", title: title.trim(), description: description.trim(),
      ...(files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : {}),
    });
    if (ok) { files.reset(); reset(); }
  };
  const saveError = save.error;
  const send = async (c: DeliveryChangeRequest) => {
    if (submitting) return;
    setSubmitting(c.id); setSubmitError(null); setSubmitted(null);
    try { await submitApi.submit(c.id); setSubmitted(t("build.release.changes.sent", "{code} was sent. The business analyst starts the analysis in a moment.", { code: changeCode(c) })); }
    catch (e) { setSubmitError(blocksChangeMessage(e)); }
    finally { setSubmitting(null); }
  };

  return (
    <Card title={t("build.release.changes.title", "Changes and fixes")}>
      {changeRequests.length === 0 ? (
        <p className="text-[13px] text-ink2">{t("build.release.changes.none", "No change requests yet.")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {listed.map((c) => {
            const sendReason = !c.title.trim() || !c.description.trim() ? t("build.release.changes.needsText", "Add a title and a description first.") : null;
            const analysis = analysisOf(c);
            const decision = decisionOf(c);
            const newestBuild = latestJobFor(jobs, "change.build", { changeRequestId: c.id });
            const stage = changeStage(c.status, analysis, decision, newestBuild, null, { updatedAt: c.updatedAt ?? null, now: clock });
            // its start never queued a build of its own: never "being built"
            const lost = stage === "buildLost";
            // the one rule for a stopped build (src/components/changes/changeStopped.ts): "Stopped", as everywhere
            const stopped = changeStopped(c, newestBuild);
            // nothing builds (a start that queued no job): the next increment waits, never "being built"
            const shown = stopped ? "failed" : stage === "approved" && c.status === "building" ? "approved" : c.status;
            // released (or an increment on development), but the steps after its deploy are not all finished, or its own
            // checks failed there: then it is NOT usable, never shown as delivered (its change request's page has the line)
            const open = stage === "released" || stage === "approved" ? openAfterDeploy(jobs, { kind: "change.build", id: c.id, checks: c.checks, settled }) : null;
            const broken = !!open?.attention.broken;
            return (
              <li key={c.id} className="min-w-0 rounded-block bg-surface2 p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="num whitespace-nowrap font-mono text-[13px] font-medium">{changeCode(c)}</span>
                  <span className="min-w-0 break-words text-[14px]">{c.title || t("build.release.changes.untitled", "Untitled")}</span>
                  <Chip tone={stopped || lost || open?.attention.security ? "danger" : open ? "warning" : TONE[shown as keyof typeof TONE] ?? "success"}>
                    {broken ? t("build.release.changes.notUsable", "On development · not usable yet") : lost ? t("build.release.changes.buildNotStarted", "Build not started")
                      : open ? t("build.release.changes.statusNotFinished", "{status} · not finished", { status: crStatusLabel(shown) }) : crStatusLabel(shown)}
                  </Chip>
                  {c.version && <span className="num font-mono text-[12px] text-ink2">v{c.version}</span>}
                </div>
                {stage !== "legacy" && (
                  <ChangeLifecycleBar className="mt-3" steps={lifecycleSteps(c.status, stage, analysis, decision.decidedAt, broken ? "broken" : !!open)} />
                )}
                <Link to={`/p/${ctx.projectId}/build?cr=${c.number}`} className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
                  {stage === "legacy"
                    ? (c.status === "building" ? t("build.release.changes.nextFollowBuild", "Follow the build") : t("build.release.changes.open", "Open the change request"))
                    : broken ? t("build.release.changes.seeNotWorking", "See what does not work yet")
                      : open ? t("build.release.changes.seeNotFinished", "See what is not finished")
                        : nextAction(stage) ?? t("build.release.changes.open", "Open the change request")}
                </Link>
                {c.status === "draft" && mayEdit && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={replacing === c.id} onClick={() => askEdit(c)}>{t("build.release.changes.editDraft", "Edit draft")}</Button>
                    <Button size="sm" variant="secondary" disabled={Boolean(sendReason) || submitting !== null}
                      onClick={() => void send(c)}>{submitting === c.id ? t("build.release.page.sending", "Sending…") : t("build.release.changes.sendForAnalysis", "Send for analysis")}</Button>
                    {sendReason && <span className="text-[12px] text-ink2">{sendReason}</span>}
                  </div>
                )}
                {replacing === c.id && (
                  <div role="group" aria-label={t("build.release.changes.replaceGroup", "Replace the unsaved draft")} className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    {t("build.release.changes.replaceQuestion", "The form below has unsaved text. Replace it with {code}?", { code: changeCode(c) })}
                    <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>{t("build.release.changes.keepText", "Keep my text")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => edit(c)}>{t("build.release.changes.replace", "Replace")}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {submitError && <p role="alert" className="mt-3 text-[13px] text-danger">{submitError}</p>}
      {submitted && !submitError && <p role="status" className="mt-3 text-[13px] text-success">{submitted}</p>}

      <form ref={form} className="mt-6 flex min-w-0 flex-col gap-4 border-t border-line pt-5"
        onSubmit={(e) => { e.preventDefault(); if (canSave) void submit(); }} aria-label={t("build.release.changes.formLabel", "Change request draft")}>
        <h4 className="text-[15px] font-medium">{editingId ? t("build.release.changes.editTitle", "Edit the draft") : t("build.release.changes.newTitle", "New change request")}</h4>
        {!mayEdit && <p className="text-[13px] text-ink2">{t("build.release.changes.readOnly", "You can read the change requests here. Your team creates and builds them.")}</p>}
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <Label>{t("build.release.changes.kind", "What kind of change")}</Label>
            <Select label={t("build.release.changes.kind", "What kind of change")} value={lane} onChange={setLane} options={lanes()} disabled={!mayEdit} />
          </div>
          {scoped && (
            <div className="min-w-0">
              <Label>{t("build.release.changes.feature", "Feature")}</Label>
              <Select label={t("build.release.changes.feature", "Feature")} value={featureRef} onChange={setFeatureRef} options={features} disabled={!mayEdit}
                placeholder={needsFeature ? t("build.release.changes.chooseFeature", "Choose a feature") : t("build.release.changes.featureOptional", "Optional for a new feature")} />
            </div>
          )}
        </div>
        {!scoped && (
          <p className="text-[13px] leading-relaxed text-ink2">
            {lane === "add"
              ? t("build.release.changes.addHint", "A new feature is built on the existing product: the business analyst plans it in small builds, you approve the plan, and each build goes to development for you to try before the next.")
              : t("build.release.changes.noScopeHint", "This product has no locked scope, so a change is about the product as a whole.")}
          </p>
        )}
        <div className="min-w-0">
          <Label>{t("build.release.changes.titleLabel", "Title")}</Label>
          <Input value={title} maxLength={TITLE_MAX} aria-label={t("build.release.changes.titleLabel", "Title")} data-field="title" disabled={!mayEdit} onChange={(e) => setTitle(e.target.value)} />
          <div className="num mt-1 text-right text-[12px] text-ink3">{title.length}/{TITLE_MAX}</div>
        </div>
        <div className="min-w-0">
          <Label>{t("build.release.changes.descriptionLabel", "Description")}</Label>
          <AttachZone draft={files}>
            <Textarea value={description} maxLength={DESCRIPTION_MAX} aria-label={t("build.release.changes.descriptionLabel", "Description")} disabled={!mayEdit} onChange={(e) => setDescription(e.target.value)} />
          </AttachZone>
          {editingId && <SentFiles projectId={ctx.projectId} files={sentFiles?.get(editingId)} />}
          <AttachChipList draft={files} disabled={!mayEdit} />
          {mayEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AttachButton draft={files} label={t("build.release.changes.attach", "Attach a design, screenshot or document")} />
              <span className="text-[12px] text-ink3">{hold || t("build.release.changes.attachHint", "Add a design, a screenshot or a document if it helps.")}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" disabled={!canSave} icon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
            {editingId ? t("build.release.changes.saveDraft", "Save the draft") : t("build.release.changes.saveAsDraft", "Save as draft")}
          </Button>
          {editingId && <Button type="button" variant="ghost" onClick={reset}>{t("build.release.changes.cancelEdit", "Cancel editing")}</Button>}
        </div>
        {saveError && <p role="alert" className="text-[13px] text-danger">{saveError}</p>}
        {save.success && <p role="status" className="text-[13px] text-success">{save.success}</p>}
      </form>
    </Card>
  );
}

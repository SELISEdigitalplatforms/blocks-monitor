import { useCallback, useEffect, useRef, useState } from "react";
import { useDesignBrief, useRequirements } from "@/madp/blocks/requirements/hooks";
import { useConfirmDesignBrief, useGenerateDesign } from "@/madp/blocks/requirements/mutations";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { automaticDesignDirection, designSource } from "@/madp/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "@/madp/domain/factoryDesign";
import { useDesignContext } from "@/madp/blocks/requirements/designContext";
import { Button, Modal } from "@/madp/ui/kit";
import { DesignViewer } from './DesignViewer';
import { requirementsErrorMessage } from "@/madp/components/requirements/messages";
import { designJobFailureMessage, designJobInput, designRequestSending, makeDesignState, startsFirstDesign, type SentDesignRequest } from "./makeDesignState";
import { designActions, designStatus } from "./designActions";
import { useDesignProgress } from "./DesignProgressLine";
import { MakeDesignView } from "./MakeDesignView";
import { callFunction, FunctionError } from "@/madp/blocks/fn";
import { useT } from "@/madp/i18n";

const FRESH_DESIGN = 'Create a fresh visual design from the current goals and requirements in a new Figma Design file. Choose a new coherent professional visual direction. Preserve the previous Figma file and saved previews; do not modify them or expand the agreed scope.';

/** Users review the product here. Provider identity, billing and recovery are owner-engine responsibilities.
 *  Reads and writes only; MakeDesignView draws the section. */
export function MakeDesignPanel({ projectId, editable }: { projectId: string; editable: boolean }) {
  const t = useT();
  const briefQuery = useDesignBrief(projectId);
  const brief = briefQuery.data;
  const requirements = useRequirements(projectId);
  const intent = useDesignContext(projectId);
  const jobs = useEngineJobs(projectId, ["design.generate"]);
  const generate = useGenerateDesign(projectId);
  const approve = useConfirmDesignBrief(projectId);
  const [feedback, setFeedback] = useState("");
  const [mobile, setMobile] = useState(false);
  const [viewer, setViewer] = useState<{ nodeId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const [sent, setSent] = useState<SentDesignRequest | null>(null);
  const started = useRef(new Set<string>());
  const prototype = parseProductPrototype(brief?.prototypeJson);
  const incomplete = prototype?.provider === 'figma-design' && prototype.reviewComplete === false;
  const hasDesign = !!prototype;
  const designRequirements = (requirements.data ?? []).map((r) => ({ key: r.key || r.id, title: r.title, text: r.detail, criteria: r.criteria }));
  const factory = prototype?.provider === "factory" || prototype?.provider === 'figma-design' || !prototype || (jobs.data ?? []).some((j) => ['factory', 'screens'].includes(String(designJobInput(j).workflow)));
  const source = factory || !prototype ? intent.data?.source ?? "" : designSource(automaticDesignDirection(designRequirements), designRequirements);
  // the job that made the design on screen is never a new design (makeDesignState)
  const { active, finishing, makerUnread, attempt, screenshotResult, failures, history } = makeDesignState(jobs.data ?? [], brief?.id, source,
    prototype ? { jobId: prototype.jobId, complete: !incomplete } : null);
  // this page's request counts until it is answered or its job shows up, never as a new design over a saved one by itself
  const sending = generate.isPending && designRequestSending(sent, jobs.data ?? [], hasDesign);
  const busy = sending || !!active;
  const current = brief?.mode === "figma" && !requirements.isLoading && !requirements.isError && designSourceCurrent(prototype?.source, factory || !prototype ? intent.data : { source });
  const readsFailed = briefQuery.isError || requirements.isError || jobs.isError;
  const readsUnavailable = briefQuery.isLoading || briefQuery.isError || requirements.isLoading || requirements.isError || jobs.isLoading || jobs.isError || ((factory || !prototype) && (intent.isLoading || intent.isError || !intent.data));
  const canGenerate = !busy && !readsUnavailable && !!requirements.data?.length;
  const failed = attempt?.status === "failed" || attempt?.status === "cancelled";
  const missingResult = attempt?.status === "succeeded" && !prototype && !briefQuery.isFetching;
  const jobUnavailable = !busy && (failed || missingResult);
  const unavailable = jobUnavailable || (!busy && !!error);
  // The newest recorded failed attempt explains itself; older failures never impersonate the situation.
  const lastFailure = failures[0];
  const legacyActive = !!active && typeof designJobInput(active).source !== "string";
  // an older worker's own step text is not this design's progress
  const progress = useDesignProgress(active ? (legacyActive ? { ...active, message: null } : active) : null, legacyActive
    ? t("analysis.design.panel.preparedAfter", "Your interactive design is prepared right after it.")
    : t("analysis.design.panel.preparing", "Preparing the journeys and screens. The design appears here when it is ready."));
  const mutate = generate.mutateAsync;
  const refetch = briefQuery.refetch;
  const refetchJobs = jobs.refetch;
  // the design jobs known when a request is sent: a job not among them is that request's answer
  const jobIds = useRef<string[]>([]);
  useEffect(() => { jobIds.current = (jobs.data ?? []).map((j) => j.id); }, [jobs.data]);
  const start = useCallback(async (change: string, automatic = false): Promise<boolean> => {
    setError(null);
    setSent({ automatic, knownJobIds: jobIds.current });
    try { await mutate({ feedback: change, workflow: "screens" }); setFeedback(""); return true; }
    catch (e) {
      // the page's own first-design request, refused because a design has been saved meanwhile: nobody asked for
      // anything that failed, the design is read again instead
      if (automatic && e instanceof FunctionError && e.messageKey === "design.feedbackRequired") void refetch();
      else setError(requirementsErrorMessage(e));
      return false;
    }
  }, [mutate, refetch]);
  useEffect(() => {
    if (attempt && ["succeeded", "failed", "cancelled"].includes(attempt.status)) void refetch();
  }, [attempt?.id, attempt?.status, refetch]);
  // A new design record arrives a moment before its job is read as finished: read the jobs at once (once per
  // revision), so the job that made it is not left marked running until the next poll.
  const jobsReadFor = useRef<string | null>(null);
  const designKey = prototype ? `${prototype.jobId}:${prototype.revision}` : null;
  useEffect(() => {
    if (!designKey || !makerUnread || !jobs.data || jobsReadFor.current === designKey) return;
    jobsReadFor.current = designKey;
    void refetchJobs({ cancelRefetch: false });
  }, [designKey, makerUnread, jobs.data, refetchJobs]);
  const rereading = briefQuery.isFetching || jobs.isFetching;
  useEffect(() => {
    const key = `${projectId}:${source}`;
    if (!startsFirstDesign({ editable, canGenerate, hasDesign, hasAttempt: !!attempt, rereading, startedBefore: started.current.has(key) })) return;
    started.current.add(key);
    void start("", true);
  }, [projectId, source, editable, canGenerate, hasDesign, attempt, rereading, start]);

  const facts = {
    editable, hasPrototype: hasDesign, busy, finishing, readsUnavailable, readsFailed, incomplete, current: !!current,
    hasPreview: !!prototype?.previewUrl, approving: approve.isPending, confirmed: brief?.status === "confirmed",
    canGenerate, hasRequirements: !!requirements.data?.length, unavailable,
  };
  // An error of this person's own request is shown on its own; the job's failure explains the job.
  const failure = !jobUnavailable ? null : missingResult && screenshotResult
    ? t("analysis.design.panel.outdatedWorker", "An outdated design worker returned legacy screen images without the Figma design reference and review revision. Update the assigned design worker before retrying.")
    : missingResult
    ? t("analysis.design.panel.noRevision", "The design task finished without a saved screen-design revision. Your team needs to check the result.")
    : attempt?.status === "cancelled" ? t("analysis.design.panel.stopped", "Design stopped. Existing designs and saved previews were kept. Changes already submitted to Figma may remain.")
    : lastFailure && attempt && lastFailure.id === attempt.id
    ? designJobFailureMessage(lastFailure, { hasDesign: !!prototype, canRetry: editable })
    : t("analysis.design.failure.default", "Your screen designs could not be completed. Your team needs to check the design service before trying again.");

  return <>
    <MakeDesignView
      editable={editable}
      status={designStatus(facts)}
      actions={designActions(facts)}
      onApprove={async () => {
        setError(null);
        try { await approve.mutateAsync({}); } catch (e) { setError(requirementsErrorMessage(e)); }
      }}
      busy={busy}
      stopping={stopPending || active?.errorCode === "design.stopRequested"}
      onStop={editable && active ? async () => {
        if (stopPending || active.errorCode === "design.stopRequested") return;
        setStopPending(true); setError(null);
        try { await callFunction("project", "job.cancel", { jobId: active.id }); await jobs.refetch(); }
        catch (e) { setError(requirementsErrorMessage(e)); }
        finally { setStopPending(false); }
      } : undefined}
      progress={progress}
      legacyActive={legacyActive}
      finishing={finishing}
      failure={failure}
      prototype={prototype}
      incomplete={incomplete}
      current={!!current}
      feedback={feedback}
      onFeedback={setFeedback}
      onRequestChange={() => start(feedback)}
      onFresh={() => void start(FRESH_DESIGN)}
      onRetry={() => void start("")}
      history={history.map((j) => {
        const input = designJobInput(j);
        return { id: j.id, revision: String(input.previousRevision ?? ""), status: j.status, feedback: String(input.feedback ?? "") };
      })}
      error={error}
      reads={!readsUnavailable ? "ready" : readsFailed ? "failed" : "loading"}
      onView={(nodeId) => setViewer({ nodeId: nodeId ?? null })}
    />
    {prototype?.previewUrl && (prototype.provider === 'figma-design'
      ? <DesignViewer open={!!viewer} onClose={() => setViewer(null)} previewUrl={prototype.previewUrl} incomplete={incomplete} initialNodeId={viewer?.nodeId} requirements={designRequirements} />
      : <Modal open={!!viewer} onClose={() => setViewer(null)} title={t("analysis.design.viewer.title", "Product design")} width={1200}>
        <div className="mb-3 flex gap-2">
          <Button size="sm" variant={mobile ? "ghost" : "secondary"} onClick={() => setMobile(false)} aria-pressed={!mobile}>{t("analysis.design.device.desktop", "Desktop")}</Button>
          <Button size="sm" variant={mobile ? "secondary" : "ghost"} onClick={() => setMobile(true)} aria-pressed={mobile}>{t("analysis.design.panel.phone", "Phone")}</Button>
        </div>
        <div className="overflow-auto rounded-block border border-line bg-white">
          <iframe key={`${prototype.revision}:${mobile}`} title={t("analysis.design.panel.iframeTitle", "Figma Make interactive product design")} src={prototype.previewUrl}
            className="mx-auto block h-[640px] max-w-full border-0" style={{ width: mobile ? 390 : "100%" }}
            sandbox={prototype.provider === "factory" ? "allow-scripts allow-forms" : "allow-scripts allow-same-origin allow-forms"} referrerPolicy="no-referrer" loading="lazy" />
        </div>
      </Modal>)}
  </>;
}

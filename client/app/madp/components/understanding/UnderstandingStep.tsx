/** "Project understanding", the first section of step 2 "Business Analysis" (/p/:id/analysis#understanding), on the
 *  shared step frame (STEP-STANDARD.md), the same frame, cards and tokens as "Understanding your project". The business analyst shows what was read from your project setup and your files:
 *  what we understood, each file's reading, what it should do (confirm or set aside), what disagrees, and the
 *  questions still open. Sign-off: "Confirm understanding" → the next section, Understanding your project. The brief comes from
 *  /api/brief/:id, which reads the project as the signed-in person; the project's name and answers are never
 *  replaced by its id. */
import { t, useT } from "@/madp/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useRouteProject } from "@/madp/blocks/projects/reads";
import { useCan, useMemberName, useProjectsContext } from "@/madp/blocks/projects/context";
import { callProjectOp } from "@/madp/blocks/projects/mutations";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { latestAssistJob } from "@/madp/blocks/sanitization/hooks";
import { useAskMadp } from "@/madp/blocks/sanitization/ops";
import { stepIndex } from "@/madp/domain/journey";
import { stepPath } from "@/madp/domain/phases";
import { phaseName, stepName } from "@/madp/components/project/stepNames";
import { StepFrame, signOffText } from "@/madp/components/step/StepFrame";
import { useSetupDetails } from "@/madp/components/setup/data";
import { useSetupAgent } from "@/madp/components/setup/agent/data";
import { Banner, Button, Card, EmptyState } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { useEasedProgress } from "@/madp/components/engine/progressEase";
import { formatDateTime } from "@/madp/lib/dates";
import { BriefRequestError, confirmBrief, fetchBrief, rebuildBrief, saveDecision, type Brief, type Decision } from "./briefApi";
import { briefRefetchInterval } from "@/madp/components/analysis/doc/briefQuery";
import { ROLE_LINE, fileCounts, fileState, openQuestions, requirementCounts, setupFindings, understandingNow, understoodLines, type NowState } from "./model";
import { retryAttachmentExtraction } from "./retryExtraction";
import { UnderstoodCard } from "./UnderstoodCard";
import { FilesCard } from "./FilesCard";
import { RequirementsCard, SetAsideList, type RequirementDecision } from "./RequirementsCard";
import { ConflictsCard } from "./ConflictsCard";
import { QuestionsCard } from "./QuestionsCard";
import { rewritePath } from "@/madp/lib/pathPrefix";

const briefKey = (projectId: string) => ["understanding-brief", projectId] as const;

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="hatched h-40 rounded-card bg-surface/60" />
      <div className="hatched h-56 rounded-card bg-surface/60" />
    </div>
  );
}

/** "Your business analyst · Reading your files · 1 of 3 read ▓▓▒░" */
function AgentLine({ agent }: { agent: NowState["agent"] }) {
  // the reading's recorded progress (files read), never ahead of it; never 100 % before the reading is done
  useT();
  const eased = useEasedProgress(agent.progress, { active: agent.working && agent.progress !== null });
  return (
    <div role="status" className="flex min-w-0 flex-col gap-2 rounded-block bg-surface px-4 py-3 shadow-card dark:ring-1 dark:ring-line">
      <p className="min-w-0 text-[13px] text-ink2"><span className="font-medium text-ink">{t("analysis.understanding.yourAnalyst", "Your business analyst")}</span> · {agent.text}</p>
      {agent.working && (
        <ShimmerProgress step={agent.progress !== null ? eased : 30} total={100} ticks={false} active label={agent.text}
          valueText={agent.progress !== null ? `${eased}%` : t("analysis.understanding.working", "Working")} size="sm" />
      )}
    </div>
  );
}

const errorText = (e: unknown): string =>
  e instanceof BriefRequestError && e.status === 401 ? t("analysis.understanding.sessionEnded", "Your session has ended. Sign in again to continue.")
    : e instanceof BriefRequestError && (e.status === 403 || e.status === 404) ? t("analysis.understanding.noAccess", "You don't have access to this project.")
    : t("analysis.understanding.saveFailed", "We couldn't save that just now. Try again.");

export function UnderstandingStep({ projectId, workspaceId }: { projectId: string; workspaceId: string | null }) {
  useT();
  const route = useRouteProject();
  const project = route.project;
  const canEdit = useCan("business.edit");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState(0);
  const reading = useRef<AbortController | null>(null);
  useEffect(() => () => reading.current?.abort(), []);

  const notOpen = project?.step === "business";
  const briefQ = useQuery<Brief, BriefRequestError>({
    queryKey: briefKey(projectId),
    queryFn: ({ signal }) => fetchBrief(projectId, signal),
    enabled: Boolean(projectId) && Boolean(project) && !notOpen,
    // While files are being read the status refreshes every few seconds; otherwise now and then.
    refetchInterval: briefRefetchInterval,
    retry: (count, e) => !(e instanceof BriefRequestError && e.status < 500) && count < 2,
  });
  const brief = briefQ.data ?? null;
  // what the project setup found: its must-haves, and the users / goal / must-haves the business agent read in the material
  const setupDetails = useSetupDetails(projectId).details;
  const setupAgent = useSetupAgent(projectId, { live: false });

  // The business analyst's own work is the engine job the hand-over queued; confirming makes sure it exists.
  const jobs = useEngineJobs(projectId, ["sanitization.assist"]).data ?? [];
  const ask = useAskMadp({ workspaceId: workspaceId ?? "", projectId });
  const me = useProjectsContext().userId;
  const memberName = useMemberName(brief?.confirmedByUserId ?? "");
  const confirmedBy = brief?.confirmedByUserId && brief.confirmedByUserId === me ? "you" : memberName;

  const setBrief = useCallback((next: Brief) => qc.setQueryData(briefKey(projectId), next), [qc, projectId]);

  const readFiles = useCallback(async (fileIds: string[]) => {
    if (!brief || reading.current || fileIds.length === 0) return;
    const controller = new AbortController();
    reading.current = controller;
    setActionError(null);
    let failed = 0;
    try {
      // One file after the other: a failed file never stops the rest.
      for (const fileId of fileIds) {
        const file = brief.attachmentStatus.find((f) => f.fileId === fileId);
        if (!file) continue;
        setBusyIds(new Set([fileId]));
        try {
          await retryAttachmentExtraction(projectId, { fileId, name: file.name }, { callOp: callProjectOp }, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          failed += 1;
        }
        await qc.invalidateQueries({ queryKey: briefKey(projectId) });
      }
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        setBusyIds(new Set());
        setReadErrors(failed);
      }
    }
  }, [brief, projectId, qc]);

  const decide = useCallback(async (key: string, decision: Decision) => {
    if (pendingKey) return;
    setPendingKey(key);
    setActionError(null);
    try { setBrief(await saveDecision(projectId, decision)); }
    catch (e) { setActionError(errorText(e)); }
    finally { setPendingKey(null); }
  }, [pendingKey, projectId, setBrief]);

  const existing = project?.type === "brownfield";
  const nextLabel = stepName("sanitization", existing ? "brownfield" : "greenfield");
  // the next section of the Business Analysis page (an anchor on the same page: no reload) and step 1, Project Setup
  const nextHref = stepPath(projectId, "sanitization");
  const setupHref = stepPath(projectId, "business");
  const title = stepName("understanding");

  if (route.isLoading || (!project && !route.error)) {
    return <StepFrame title={title}><Skeleton /></StepFrame>;
  }
  if (!project) {
    return (
      <StepFrame title={title}>
        <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={t("analysis.understanding.recordUnavailable", "This project's record isn't available.")}
          action={<Link to={rewritePath("/projects")} className="font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("analysis.understanding.backToProjects", "Back to projects")}</Link>} />
      </StepFrame>
    );
  }
  const subject = project.name || undefined;
  const deliverable = t("analysis.understanding.delivers", "delivers {what}", { what: ROLE_LINE.delivers });
  if (notOpen) {
    return (
      <StepFrame title={title} subject={subject} status={t("analysis.understanding.notStartedYet", "Not started yet")} statusTone="waiting"
        role={ROLE_LINE.who} deliverable={deliverable}
        primary={{ label: t("analysis.understanding.openStep", "Open {step}", { step: phaseName("setup") }), href: setupHref }}>
        <Card title={t("analysis.understanding.analysisNotStarted", "The project analysis hasn't started yet")} icon={<FileText size={18} strokeWidth={1.75} />}>
          <p className="text-[14px] text-ink2">{t("analysis.understanding.opensOnceStarted", "This part opens once the project analysis is started in {step}.", { step: phaseName("setup") })}</p>
        </Card>
      </StepFrame>
    );
  }
  if (!brief) {
    return (
      <StepFrame title={title} subject={subject} status={briefQ.isError ? t("analysis.understanding.couldntLoad", "Couldn't load") : t("analysis.understanding.fileReading", "Reading…")} statusTone={briefQ.isError ? "attention" : "progress"}
        role={ROLE_LINE.who} deliverable={deliverable}>
        {briefQ.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink2">
            <span>{briefQ.error instanceof BriefRequestError && briefQ.error.status === 401 ? t("analysis.understanding.sessionEnded", "Your session has ended. Sign in again to continue.") : t("analysis.understanding.loadFailed", "We couldn't load what we read from your project.")}</span>
            <Button size="sm" variant="ghost" onClick={() => void briefQ.refetch()}>{t("analysis.understanding.retry", "Retry")}</Button>
          </div>
        ) : <Skeleton />}
      </StepFrame>
    );
  }

  // Done once confirmed here, or once the project has moved past Understanding your project (the journey shows it done
  // then): the same layout, read only, with the link to the next step instead of "Confirm understanding".
  const movedOn = stepIndex(project.step) > stepIndex("sanitization");
  const signed = Boolean(brief.confirmedAt) || movedOn;
  const actions = canEdit && !signed;
  const found = (kind: "goal" | "users" | "mustHave") => setupAgent.suggestions.filter((x) => x.kind === kind && x.status !== "ignored");
  // The project record (read through the app's data layer), the brief and the business agent's findings carry the same
  // answers; any of them fills a gap.
  const goal = project.goal.trim() || brief.project.problem || (found("goal")[0]?.text ?? "");
  const users = project.targetUsers.trim() || brief.targetUsers.map((u) => u.description).join(" ") || (found("users")[0]?.text ?? "");
  const lines = understoodLines({ existing, about: brief.project.desiredOutcome, goal, users, outOfScope: brief.outOfScope ?? [] });
  const files = fileCounts(brief.attachmentStatus);
  const reqs = requirementCounts(brief);
  const questions = openQuestions(brief.openQuestions);
  const fromSetup = setupFindings({
    mustHaves: setupDetails.mustHaves,
    found: found("mustHave"),
    inBrief: brief.features.flatMap((f) => [...f.confirmedRequirements, ...f.proposedRequirements].map((r) => r.description)),
  });
  const conflictsOpen = brief.conflicts.filter((c) => !c.resolution).length;
  const now = understandingNow({
    canEdit, confirmed: signed, goal: Boolean(goal.trim()), users: Boolean(users.trim()), files, retrying: busyIds.size > 0,
    proposed: reqs.proposed, confirmedRequirements: reqs.confirmed, conflictsOpen, conflicts: brief.conflicts.length, questions: questions.length,
    fromSetup: fromSetup.length,
  });

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toRead = brief.attachmentStatus.filter((f) => ["not_read", "failed"].includes(fileState(f.status))).map((f) => f.fileId);

  const confirm = async () => {
    if (confirming || now.primary.disabled) return;
    setConfirming(true);
    setActionError(null);
    try {
      setBrief(await confirmBrief(projectId));
      // The business analyst's reading and questions (queued at the hand-over): start them if they never ran.
      const job = latestAssistJob(jobs, "clarifications");
      if (workspaceId && (!job || !(isActiveEngineJob(job) || job.status === "succeeded"))) {
        await ask.mutateAsync({ projectId, focus: "clarifications" }).catch(() => undefined);
      }
      navigate(nextHref);
    } catch (e) {
      setActionError(e instanceof BriefRequestError && e.code === "conflicts_open" ? t("analysis.understanding.settleFirst", "Settle the disagreements first.") : errorText(e));
    } finally {
      setConfirming(false);
    }
  };

  const chipAction: Record<string, (() => void) | undefined> = {
    basics: canEdit ? () => navigate(setupHref) : undefined,
    files: toRead.length && actions ? () => scrollTo("understanding-files") : undefined,
    review: reqs.proposed && actions ? () => scrollTo("understanding-requirements") : undefined,
    conflicts: conflictsOpen && actions ? () => scrollTo("understanding-conflicts") : undefined,
  };
  const setAside = brief.rejectedRequirements ?? [];
  const emptyText = brief.attachmentStatus.length
    ? files.reading ? t("analysis.understanding.emptyReading", "Requirements show up here as your files are read.")
      : t("analysis.understanding.emptyNoneNamed", "Your files didn't name requirements. Your business analyst works them out with you next.")
    : t("analysis.understanding.emptyShare", "Share documents in {step}, or let your business analyst work them out with you next.", { step: phaseName("setup") });

  return (
    <StepFrame
      title={title}
      subject={subject}
      status={now.status}
      statusTone={now.tone}
      role={ROLE_LINE.who}
      deliverable={deliverable}
      yourPart={canEdit ? ROLE_LINE.you : t("analysis.understanding.readAlong", "read along; the project team confirms this step")}
      primary={{ label: now.primary.label, onClick: () => void confirm(), disabled: now.primary.disabled || confirming, pending: confirming, pendingLabel: t("analysis.understanding.confirming", "Confirming…"), reason: now.primary.reason }}
      chips={now.chips.map((c) => ({ id: c.key, label: c.label, value: c.value, state: c.state, todoLabel: c.todoLabel, onClick: chipAction[c.key] }))}
      chipsLabel={t("analysis.understanding.checklist", "Understanding checklist")}
      agentLine={<AgentLine agent={now.agent} />}
      signedOff={signed ? {
        text: brief.confirmedAt
          ? signOffText({ verb: t("analysis.understanding.statusConfirmed", "Confirmed"), by: brief.confirmedByUserId ? confirmedBy : null, at: brief.confirmedAt })
          : t("analysis.understanding.doneMovedOn", "Done · your project has moved on"),
        next: { label: t("analysis.understanding.openStep", "Open {step}", { step: nextLabel }), href: nextHref },
      } : null}
      notices={<>
        {!canEdit && (
          <p className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">{t("analysis.understanding.readOnlyNote", "You can read what the business analyst understood. The project team confirms this step.")}</p>
        )}
        {project.stage === "paused" && <Banner tone="warning" title={t("analysis.understanding.paused", "This project is paused.")} />}
        {readErrors > 0 && busyIds.size === 0 && (
          <p role="status" className="text-[13px] text-[rgb(var(--c-warning-text))]">{readErrors === 1 ? t("analysis.understanding.readFailedOne", "One file couldn't be read. See the reason next to it.")
            : t("analysis.understanding.readFailedMany", "{count} files couldn't be read. See the reason next to it.", { count: readErrors })}</p>
        )}
        {actionError && <p role="alert" className="break-words text-[13px] text-danger">{actionError}</p>}
      </>}
      details={(
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-[15px] font-medium">{t("analysis.understanding.setAside", "Set aside")}</h3>
            <SetAsideList items={setAside} actions={actions} pendingKey={pendingKey}
              onBringBack={(key) => void decide(key, { kind: "requirement", key, value: null })} />
          </section>
          <section className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink3">
            <span>{t("analysis.understanding.lastUpdated", "Last updated {when}", { when: formatDateTime(brief.generatedAt) })}</span>
            {actions && (
              <Button size="sm" variant="ghost" onClick={() => { void rebuildBrief(projectId).then(() => qc.invalidateQueries({ queryKey: briefKey(projectId) })).catch(() => setActionError(t("analysis.understanding.refreshFailed", "We couldn't refresh it just now. Try again."))); }}>{t("analysis.understanding.refresh", "Refresh")}</Button>
            )}
          </section>
        </div>
      )}
      detailsLabel={t("analysis.understanding.detailsLabel", "Details · {count} set aside", { count: setAside.length })}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <UnderstoodCard lines={lines} setupHref={setupHref} canEdit={canEdit && !signed} />
        <FilesCard files={brief.attachmentStatus} busyIds={busyIds} canEdit={canEdit} readOnly={signed} setupHref={setupHref}
          onRead={(fileId) => void readFiles([fileId])} onReadAll={() => void readFiles(toRead)} />
        <ConflictsCard conflicts={brief.conflicts} actions={actions} pendingKey={pendingKey}
          onSettle={(key, pm) => void decide(key, { kind: "conflict", key, value: pm ? "product_manager" : null })} />
        <RequirementsCard features={brief.features} actions={actions} pendingKey={pendingKey} emptyText={emptyText} fromSetup={fromSetup}
          onDecide={(key, value: RequirementDecision) => void decide(key, { kind: "requirement", key, value })} />
        <QuestionsCard questions={questions} nextLabel={nextLabel} />
      </div>
    </StepFrame>
  );
}

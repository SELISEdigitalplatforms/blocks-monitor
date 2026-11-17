/** "Understanding your project" (step 2) on the shared step frame (STEP-STANDARD.md): the business analyst delivers
 *  "What we understood" and your answers; you answer the questions one at a time; sign-off: Continue to Goals &
 *  requirements. The first requirements are prepared behind the scenes (they show up in Goals & requirements).
 *  Decisions, technical notes, the discussion and the material sit in one collapsed Details area. */
import type { ProjectRow } from "@/blocks/sanitization/types";
import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  clarificationsOptions, latestAssistJob, useBusinessRefs, useDecisions, useRequirementsV1, useSanitizationDiscussion, useSanitizationProject,
  useStepAccess, useTechDecisions, useV1Versions, useWorkspaceMembers, v1CompletedInfo,
} from "@/blocks/sanitization/hooks";
import { useAskMadp, useCompleteSanitization, useDraftInitial } from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "@/blocks/engine/types";
import { sanitizationPhase } from "@/domain/sanitization";
import { Banner, Card, EmptyState } from "@/ui/kit";
import { StepFrame, signOffText } from "@/components/step/StepFrame";
import { ShimmerProgress } from "@/ui/ShimmerProgress";
import { useEasedProgress } from "@/components/engine/progressEase";
import { BusinessInputCard } from "./BusinessInputCard";
import { ClarificationsSection } from "./ClarificationsSection";
import { DecisionsSection } from "./DecisionsSection";
import { DiscussionSection } from "./DiscussionSection";
import { TechnicalSection } from "./TechnicalSection";
import { UnderstoodSection } from "./UnderstoodSection";
import { useLandingAddOn } from "./LandingPageAddOn";
import { isLandingJob } from "@/domain/landingPage";
import { roleLine, understandingNow, type JobView, type NowState } from "./understandingModel";
import { useT } from "@/i18n";
import { LoadError, ReadOnlyNote, type SectionProps } from "./shared";

/** The main area while the project loads (inside the step frame, so the header never jumps). */
function Skeleton() {
  const t = useT();
  return (
    <div aria-busy="true" aria-label={t("settings.sanitization.step.loadingAria", "Loading")} className="flex flex-col gap-5">
      <div className="hatched h-40 rounded-card bg-surface/60" />
      <div className="hatched h-56 rounded-card bg-surface/60" />
    </div>
  );
}

export function jobView(job: EngineJob | null): JobView {
  if (!job) return { state: "none", progress: 0, message: null };
  if (isActiveEngineJob(job)) return { state: "active", progress: job.progress, message: job.message };
  return {
    state: job.status === "succeeded" ? "succeeded" : job.status === "failed" ? "failed" : "cancelled", progress: job.progress, message: job.message,
    ...(job.status === "failed" && job.errorCode ? { errorCode: job.errorCode } : {}),
  };
}

/** "Your business analyst · Reading your material… ▓▓▒░" */
function AgentLine({ agent }: { agent: NowState["agent"] }) {
  // the job's recorded progress, never ahead of it; never 100 % before the job is done
  const t = useT();
  const eased = useEasedProgress(agent.progress, { active: agent.working && Boolean(agent.progress) });
  return (
    <div role="status" className="flex min-w-0 flex-col gap-2 rounded-block bg-surface px-4 py-3 shadow-card dark:ring-1 dark:ring-line">
      <p className="min-w-0 text-[13px] text-ink2"><span className="font-medium text-ink">{t("settings.sanitization.step.agentName", "Your business analyst")}</span> · {agent.text}</p>
      {agent.working && (
        <ShimmerProgress step={agent.progress ? eased : 30} total={100} ticks={false} active label={agent.text}
          valueText={agent.progress ? `${eased}%` : t("settings.sanitization.step.working", "Working")} size="sm" />
      )}
    </div>
  );
}

/** The secondary parts, one under the other, in the collapsed Details area. */
function DetailsArea({ props, project }: { props: SectionProps; project: ProjectRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DecisionsSection {...props} />
      <TechnicalSection {...props} />
      <DiscussionSection {...props} />
      <BusinessInputCard workspaceId={props.workspaceId} projectId={props.projectId} handedOverAt={project.BusinessHandedOverAt ?? null} />
    </div>
  );
}

export function SanitizationStep({ projectId, workspaceId, title }: { projectId: string; workspaceId: string | null; title: (project: ProjectRow | null) => ReactNode }) {
  const t = useT();
  const ctx = { workspaceId: workspaceId ?? "", projectId };
  const projectQ = useSanitizationProject(ctx);
  const access = useStepAccess(ctx);
  const membersQ = useWorkspaceMembers(ctx);
  const jobs = useEngineJobs(projectId, ["sanitization.assist", "requirements.draft"]).data ?? [];
  const questionsJob = latestAssistJob(jobs, "clarifications");
  const reading = !!questionsJob && isActiveEngineJob(questionsJob);
  const clarificationsQ = useQuery({ ...clarificationsOptions(ctx), refetchInterval: reading ? 3000 : false });
  const decisionsQ = useDecisions(ctx);
  const techQ = useTechDecisions(ctx);
  const discussion = useSanitizationDiscussion(ctx);
  const v1 = useRequirementsV1(ctx);
  const versions = useV1Versions(ctx);
  const business = useBusinessRefs(ctx);
  const ask = useAskMadp(ctx);
  const draftOp = useDraftInitial(ctx);
  const complete = useCompleteSanitization(ctx);
  const navigate = useNavigate();
  const [detailsOpen] = useState(false);
  // the Landing page chip always opens its window (editable, or read only with the reason): src/domain/landingPage.ts landingAccess
  const landing = useLandingAddOn({ workspaceId: workspaceId ?? "", project: projectQ.data ?? { ItemId: projectId } });

  if (!workspaceId || projectQ.isLoading) {
    return <StepFrame title={title(null)} status={t("settings.sanitization.step.loading", "Loading…")} statusTone="progress"><Skeleton /></StepFrame>;
  }
  if (projectQ.isError) {
    return (
      <StepFrame title={title(null)} status={t("settings.sanitization.step.loadFailed", "Couldn't load")} statusTone="attention">
        <LoadError onRetry={() => void projectQ.refetch()} />
      </StepFrame>
    );
  }

  const project = projectQ.data ?? null;
  if (!project) {
    return (
      <StepFrame title={title(null)}>
        <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={t("settings.sanitization.step.noRecord", "This project's record isn't available.")}
          action={<Link to="/projects" className="font-medium text-accent hover:underline">{t("settings.sanitization.step.backToProjects", "Back to projects")}</Link>} />
      </StepFrame>
    );
  }
  const phase = sanitizationPhase({ stage: project.Stage, resumeTo: project.ResumeTo ?? undefined });
  if (phase === "unavailable") {
    return (
      <StepFrame title={title(project)} subject={project.Name}>
        <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title={t("settings.sanitization.step.closed", "This project is closed, so this step isn't available.")} />
      </StepFrame>
    );
  }
  if (phase === "notOpen") {
    return (
      <StepFrame title={title(project)} subject={project.Name} status={t("settings.sanitization.step.notStarted", "Not started yet")} statusTone="waiting"
        primary={{ label: t("settings.sanitization.step.openSetup", "Open Project setup"), href: `/p/${projectId}/business` }}>
        <Card title={t("settings.sanitization.step.notStartedTitle", "The project analysis hasn't started yet")} icon={<FileText size={18} strokeWidth={1.75} />}>
          <p className="text-[14px] text-ink2">{t("settings.sanitization.step.notStartedText", "This step opens once the project analysis is started in Project setup.")}</p>
        </Card>
      </StepFrame>
    );
  }

  const existing = project.RepoMode === "existing";
  const completed = phase === "completed";
  const clars = (clarificationsQ.data ?? []) as { Status: string }[];
  const reqs = v1.requirements ?? [];
  const refs = business.refs;
  const notes = refs.filter((r) => r.type === "note").length;
  const files = refs.filter((r) => r.type === "file").length;
  const draftJob = latestEngineJob(jobs.filter((j) => !isLandingJob(j)), "requirements.draft");
  const now = understandingNow({
    existing, completed, canEdit: access.canEdit, notes, files,
    questions: {
      open: clars.filter((c) => c.Status === "open").length,
      answered: clars.filter((c) => c.Status === "answered").length,
      deferred: clars.filter((c) => c.Status === "deferred").length,
    },
    requirements: reqs.length,
    hasObjective: !!v1.objective?.Statement?.trim(),
    questionsJob: jobView(questionsJob),
    draftJob: jobView(draftJob),
  });

  const goalsHref = `/p/${projectId}/requirements`;
  const focusAnswer = () => {
    const el = document.querySelector<HTMLElement>("[data-open-answer]");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el?.focus({ preventScroll: true }), 350);
  };
  const onPrimary = () => {
    switch (now.primary.kind) {
      case "answer": focusAnswer(); return;
      case "start": ask.mutate({ projectId, focus: "clarifications" }); return;
      case "prepare": draftOp.mutate({ projectId }); return;
      case "confirm": void complete.mutateAsync({ projectId }).then(() => navigate(goalsHref), () => undefined); return;
      case "continue": navigate(goalsHref); return;
      default: return;
    }
  };
  const pending = ask.isPending || draftOp.isPending || complete.isPending;
  const requestError = complete.error ?? ask.error ?? draftOp.error;

  const decisions = ((decisionsQ.data ?? []) as { Status: string }[]).filter((d) => d.Status !== "rejected").length;
  const tech = ((techQ.data ?? []) as unknown[]).length;
  const comments = discussion.comments.length;
  const items = notes + files;
  const detailsLabel = t("settings.sanitization.step.details.label", "Details · {parts}", { parts: [
    decisions === 1 ? t("settings.sanitization.step.details.oneDecision", "1 decision") : t("settings.sanitization.step.details.decisions", "{count} decisions", { count: decisions }),
    tech === 1 ? t("settings.sanitization.step.details.oneTechNote", "1 technical note") : t("settings.sanitization.step.details.techNotes", "{count} technical notes", { count: tech }),
    comments === 1 ? t("settings.sanitization.step.details.oneComment", "1 comment") : t("settings.sanitization.step.details.comments", "{count} comments", { count: comments }),
    items === 1 ? t("settings.sanitization.step.details.oneItem", "1 item of material") : t("settings.sanitization.step.details.items", "{count} items of material", { count: items }),
  ].join(" · ") });

  const signed = completed ? v1CompletedInfo(versions.data ?? []) : null;
  const props: SectionProps = { workspaceId, projectId, phase: completed ? "completed" : "open", access, members: membersQ.directory, existing };
  const goals = existing ? t("settings.sanitization.now.goalsExisting", "Goals for the change") : t("settings.sanitization.now.goalsNew", "Goals & requirements");
  const role = roleLine();

  return (
    <StepFrame
      title={title(project)}
      subject={project.Name}
      status={now.status}
      statusTone={now.tone}
      role={role.who}
      deliverable={t("settings.sanitization.step.delivers", "delivers {what}", { what: role.delivers })}
      yourPart={access.canEdit ? role.you : t("settings.sanitization.step.readAlong", "read along and answer the questions addressed to you")}
      primary={{
        label: now.primary.label, onClick: onPrimary, disabled: now.primary.disabled || pending, pending,
        reason: now.primary.kind === "preparing" ? t("settings.sanitization.step.reasonPreparing", "The first requirements are being prepared.") : now.primary.kind === "wait" ? t("settings.sanitization.step.reasonWriting", "The questions are being written.") : undefined,
      }}
      chips={[...now.chips.map((c) => ({
        id: c.key, label: c.label, value: c.value, state: c.done ? "done" as const : c.busy ? "info" as const : "todo" as const,
        onClick: c.key === "questions" && !completed ? focusAnswer : undefined, todoLabel: c.key === "questions" ? t("settings.sanitization.step.todoAnswer", "answer") : undefined,
      })), landing.chip]}
      chipsLabel={t("settings.sanitization.step.checklist", "Understanding checklist")}
      agentLine={<AgentLine agent={now.agent} />}
      signedOff={completed ? {
        text: signOffText({ verb: t("settings.sanitization.step.confirmed", "Confirmed"), by: signed?.byUserId ? membersQ.directory.nameOf(signed.byUserId) : null, at: signed?.at ?? null }),
        next: { label: t("settings.sanitization.now.openGoals", "Open {goals}", { goals }), href: goalsHref },
      } : null}
      notices={<>
        <ReadOnlyNote access={access} />
        {project.Stage === "paused" && <Banner tone="warning" title={t("settings.sanitization.step.paused", "This project is paused.")} />}
        {requestError != null && <p role="alert" className="break-words text-[13px] text-danger">{sanitizationErrorText(requestError)}</p>}
      </>}
      details={<DetailsArea props={props} project={project} />}
      detailsLabel={detailsLabel}
      detailsOpen={detailsOpen}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <UnderstoodSection workspaceId={workspaceId} projectId={projectId} project={project}
          objective={v1.objective?.Statement?.trim() || null} canEdit={access.canEdit} />
        <ClarificationsSection {...props} />
      </div>
      {landing.dialog}
    </StepFrame>
  );
}

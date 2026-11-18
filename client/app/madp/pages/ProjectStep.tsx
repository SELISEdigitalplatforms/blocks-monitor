import { Navigate, useParams } from "react-router-dom";
import { useProject } from "@/madp/blocks/projects/reads";
import { missingNotice } from "@/madp/components/project/ProjectRoute";
import { StepIntake } from "@/madp/components/intake/StepIntake";
import { StepUnderstood } from "@/madp/components/intake/StepUnderstood";
import { JOURNEY_SLUG, isStepReachable, type JourneyPage } from "@/madp/domain/journey";
import { stepName } from "@/madp/components/project/stepNames";
import { useT } from "@/madp/i18n";
import { effectiveStep, isBlocksProjectId } from "@/madp/domain/projects";
import { Banner, Button } from "@/madp/ui/kit";
import { StepFrame } from "@/madp/components/step/StepFrame";

const PAGE_OF_STEP: Record<1 | 2, JourneyPage> = { 1: "business", 2: "requirements" };

/** Where a Blocks project sends a step opened before its time: the page of the step it is at, or null when the step is open. */
export function blocksStepRedirect(project: { Stage: string; ResumeTo?: string }, step: 1 | 2, id: string): string | null {
  const current = effectiveStep(project.Stage, project.ResumeTo);
  if (isStepReachable({ step: current, scopeLocked: false }, PAGE_OF_STEP[step])) return null;
  return `/p/${id}/${JOURNEY_SLUG[current]}`;
}

/** The front of a project: 1 Business, 2 Product sanitization (its own page), 3 Requirements & objective (tabs), then the scope on /p/:id/scope.
 *  A step opened before its time sends the user to the step the project is at. */
export default function ProjectStep({ step }: { step: 1 | 2 }) {
  const { id = "" } = useParams();
  return isBlocksProjectId(id) ? <BlocksProjectStep id={id} step={step} /> : <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
}

/** A Blocks project is gated by its Project record (Stage, ResumeTo). */
function BlocksProjectStep({ id, step }: { id: string; step: 1 | 2 }) {
  const query = useProject(id);
  const t = useT();
  // loading and errors stay inside the step frame, so the header never jumps (STEP-STANDARD.md)
  const title = stepName(PAGE_OF_STEP[step]);
  if (query.error) {
    return (
      <StepFrame title={title} status={t("project.route.couldntLoad", "Couldn't load")} statusTone="attention">
        <Banner tone="danger" title={t("project.route.loadFailed", "This project could not be loaded.")} action={<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>{t("project.route.retry", "Retry")}</Button>} />
      </StepFrame>
    );
  }
  if (query.data === undefined) return <StepFrame title={title} status={t("project.route.loading", "Loading…")} statusTone="progress"><Skeleton /></StepFrame>;
  if (query.data === null || query.data.status === "deleting") return <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
  // the record already resolves a paused project to its ResumeTo step (effectiveStep)
  const to = blocksStepRedirect({ Stage: query.data.step, ResumeTo: undefined }, step, id);
  if (to) return <Navigate to={to} replace />;
  return step === 2 ? <StepUnderstood key={id} /> : <StepIntake key={id} />;
}

/** The main area while the project loads. */
function Skeleton() {
  const t = useT();
  return (
    <div aria-busy="true" aria-label={t("project.route.loadingAria", "Loading")} className="flex flex-col gap-5">
      <div className="hatched h-40 rounded-card bg-surface/60" />
      <div className="hatched h-56 rounded-card bg-surface/60" />
    </div>
  );
}

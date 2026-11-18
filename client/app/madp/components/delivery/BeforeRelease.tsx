/** Before the release: the journey has not reached Release, so the page names the one step to take, from the project's
 *  real step: the build in progress, or the step the project stands on before it. Same empty state as the scope and the
 *  build. Approvals can be set up meanwhile (the policy editor follows on the page). */
import { useNavigate } from "react-router-dom";
import { ArrowRight, Hammer, Rocket } from "lucide-react";
import type { JourneyStep } from "@/madp/domain/journey";
import { phaseName, stepName } from "@/madp/components/project/stepNames";
import { isAnalysisStep, phaseOf, stepPath } from "@/madp/domain/phases";
import { Button, Card, EmptyState } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

/** The step to go to by name: a Business Analysis section keeps its own name (Scope & success), any other step is
 *  named by its phase (Project Setup, Software Engineering). */
const targetName = (step: JourneyStep): string => (isAnalysisStep(step) ? stepName(step) : phaseName(phaseOf(step)));

export function BeforeRelease({ projectId, step, title }: { projectId: string; step: JourneyStep | null | undefined; title: string }) {
  const t = useT();
  const navigate = useNavigate();
  const building = step === "board" || step === "build";
  const target: JourneyStep = step && !building ? step : "build";
  const Icon = building ? Hammer : Rocket;
  const promotions = t("build.release.before.promotions", "Promotions open when the build is finished. Each promotion needs a complete approval policy, and you can set it up now. Scope lock and the build don't wait for approvals.");
  const text = building
    ? `${t("build.release.before.building", "Build in progress: MADP agents are building, testing and securing the app. When every quality gate passes, it is released to the dev environment on SELISE Blocks.")} ${promotions}`
    : `${t("build.release.before.nothing", "Nothing is live yet. Once the scope is confirmed, MADP agents build and verify the app, and it is released to the dev environment on SELISE Blocks.")} ${promotions}`;
  return (
    <Card>
      <EmptyState icon={<Icon size={28} strokeWidth={1.75} aria-hidden />} title={title} text={text}
        action={
          <Button variant="secondary" iconRight={<ArrowRight size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => navigate(stepPath(projectId, target))}>{t("build.release.before.goTo", "Go to {step}", { step: targetName(target) })}</Button>
        } />
    </Card>
  );
}

/** The optional second opinion on the scope: a cross-check job of the MADP engine and its points. It never blocks the lock.
 *  Everything shown is a job state or a stored point; nothing is invented while the engine has not answered. */
import { useState } from "react";
import { Card, Button } from "@/madp/ui/kit";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { jobWorthShowing } from "./nowChecklist";
import { engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import type { ScopeContext } from "../../../blocks/scope/context";
import type { ScopeVersionRecord } from "../../../blocks/scope/records";
import { useChallenges, useFeatures, useLatestSecondOpinion, useScopeJobs, useStories } from "../../../blocks/scope/hooks";
import { useChallengeDecide, useChallengeUndo, useScopeGrill } from "../../../blocks/scope/mutations";
import { scopeErrorMessage } from "../../../blocks/scope/messages";
import type { ApplyRequest } from "./applyRequest";
import { ChallengePoint } from "./ChallengePoint";
import { acceptedState } from "./challengeState";
import { useT } from "@/madp/i18n";

const EMPTY: never[] = [];

export function SecondOpinionAside({ ctx, version, canDecide, onApply }: {
  ctx: ScopeContext;
  version: ScopeVersionRecord | null;
  canDecide: boolean;
  onApply: (request: ApplyRequest) => void;
}) {
  const t = useT();
  const scopeJobs = useScopeJobs(ctx);
  const grillJob = scopeJobs.grill ?? null;
  const features = useFeatures(ctx, version).data?.items ?? EMPTY;
  const stories = useStories(ctx, version).data?.items ?? EMPTY;
  const opinion = useLatestSecondOpinion(ctx).data ?? null;
  const challenges = useChallenges(ctx, opinion?.id ?? null).data?.items ?? EMPTY;
  const grill = useScopeGrill(ctx);
  const decide = useChallengeDecide(ctx);
  const undo = useChallengeUndo(ctx);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const mayAsk = ctx.can("requirements.edit") && version !== null && version.status !== "locked";
  const active = grillJob !== null && (grillJob.status === "queued" || grillJob.status === "claimed" || grillJob.status === "running");
  const requestError = retryError ?? (grill.error ? scopeErrorMessage(grill.error) : null);

  const retry = async () => {
    if (!grillJob) return;
    setRetrying(true); setRetryError(null);
    try { await retryEngineJob(grillJob.id); } catch (e) { setRetryError(engineErrorMessage(e)); } finally { setRetrying(false); }
  };

  return (
    <Card title={t("analysis.scope.opinion.title", "Second opinion")}>
      <p className="text-[14px] text-ink2">{t("analysis.scope.opinion.intro", "An optional cross-check of the scope. It never blocks the lock.")}</p>
      {mayAsk && (
        <div className="mt-3">
          <Button size="sm" variant="secondary" disabled={grill.isPending || active}
            onClick={() => version && void grill.mutateAsync({ projectId: ctx.projectId, scopeVersionId: version.id }).catch(() => undefined)}>
            {t("analysis.scope.opinion.get", "Get a second opinion")}
          </Button>
        </div>
      )}
      <EngineJobStatus className="mt-3" job={jobWorthShowing(grillJob)} variant="full" requestError={requestError}
        canRetry={ctx.can("requirements.edit")} onRetry={() => void retry()} retrying={retrying} />
      {challenges.length > 0 && (
        <ul aria-label={t("analysis.scope.opinion.points", "Second opinion points")} className="mt-4 space-y-3">
          {challenges.map((c) => (
            <ChallengePoint key={c.id} challenge={c} accepted={acceptedState(c, scopeJobs.jobs, features, stories)} canDecide={canDecide} memberName={ctx.memberName} onApply={onApply}
              onDecide={async (decision, text) => { await decide.mutateAsync({ projectId: ctx.projectId, challengeId: c.id, decision, text: text || undefined }); }}
              onUndo={async () => { await undo.mutateAsync({ projectId: ctx.projectId, challengeId: c.id }); }} />
          ))}
        </ul>
      )}
    </Card>
  );
}

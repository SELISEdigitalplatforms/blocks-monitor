/** What the Build step and a change request's page say about a build whose code is live but whose steps after the deploy
 *  did not all finish (src/domain/afterDeploy.ts). Pure: read from the engine jobs (and, for a change, its checks
 *  record: a build whose every failing check a person marked "known before this change" is not "not usable"). */
import type { EngineJob } from "@/madp/blocks/engine/types";
import { attentionOf, deliveryTargetOf, isAfterDeployRetry, newestDelivered, openAttention, type AfterDeployAttention } from "@/madp/domain/afterDeploy";
import { checksCleared } from "@/madp/domain/changeChecks";
import { t } from "@/madp/i18n";

/** What is still open after the deploy of a milestone's or a change request's builds, and the build it is about (the
 *  newest delivered one of that milestone or change request: build.retryAfterDeploy takes its id). */
export interface OpenAfterDeploy {
  attention: AfterDeployAttention;
  job: EngineJob;
  /** A retry of these steps runs now. */
  finishing: boolean;
}

/** The open steps after the deploy of a milestone (build.run) or a change request (change.build); null when everything
 *  after its deploy finished (or a later build of the project finished it) (pure). */
export function openAfterDeploy(jobs: readonly EngineJob[], target: { kind: "build.run" | "change.build"; id: string; checks?: string | null; settled?: (changeId: string, jobId: string) => boolean }): OpenAfterDeploy | null {
  const mine = (j: EngineJob) => j.kind === target.kind && deliveryTargetOf(j) === target.id;
  const own = newestDelivered(jobs, mine);
  const attention = own ? withoutClearedChecks(openAttention(own, newestDelivered(jobs)), own, target.checks, target.settled?.(target.id, own.id)) : null;
  if (!own || !attention) return null;
  const finishing = jobs.some((j) => mine(j) && isAfterDeployRetry(j) && (j.status === "queued" || j.status === "claimed" || j.status === "running"));
  return { attention, job: own, finishing };
}

/** A build's attention without its own checks when every check that failed there is marked "known before this change"
 *  on the change (its checks record), or (`settled`: changeChecks.ts checksSettled) each one passes since on a later
 *  version: what is left is the rest (data tables, texts), or nothing (pure). */
export function withoutClearedChecks(a: AfterDeployAttention | null, job: Pick<EngineJob, "id" | "kind">, checks: string | null | undefined, settled = false): AfterDeployAttention | null {
  if (!a?.broken || !(settled || checksCleared(checks ?? null, job.id))) return a;
  return attentionOf(a.issues.filter((i) => !i.startsWith("accept-")), a.details, job.kind);
}

/** The status line's ending for it: "but a new data table may be open" first, then "but not usable yet" (its own
 *  checks failed: it is never shown as delivered), else "but not finished" (pure). */
export function unfinishedWords(a: AfterDeployAttention): string {
  return a.security ? t("build.afterDeploy.tableOpen", "but a new data table may be open") : a.broken ? t("build.afterDeploy.notUsable", "but not usable yet") : t("build.afterDeploy.notFinished", "but not finished");
}

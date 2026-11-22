import { PLATFORM_FEEDBACK_KIND, isEngineJobKind, isHostMaintenance, type EngineJobKind } from "../../../src/domain/engineJob";
import type { Row } from "../../../functions/_lib/gateway";

export interface WorkerJobScope { projectIds: string[]; kinds: EngineJobKind[]; excludedKinds?: EngineJobKind[]; designWorkflow?: "factory" | "screens" }

/** Operator-only limits. Invalid configuration fails closed instead of expanding to the tenant's whole queue. */
export function workerJobScope(env: Record<string, string | undefined>): WorkerJobScope {
  const list = (value: string | undefined) => [...new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  const projectIds = list(env.MF_ENGINE_PROJECT_IDS);
  const kinds = list(env.MF_ENGINE_JOB_KINDS);
  const excludedKinds = list(env.MF_ENGINE_EXCLUDED_JOB_KINDS);
  if (excludedKinds.some((kind) => !isEngineJobKind(kind))) throw new Error("Invalid excluded worker job-kind scope");
  if ((env.MF_ENGINE_PROJECT_IDS?.trim() && !projectIds.length) || projectIds.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error("Invalid worker project scope");
  if ((env.MF_ENGINE_JOB_KINDS?.trim() && !kinds.length) || kinds.some((kind) => !isEngineJobKind(kind))) throw new Error("Invalid worker job-kind scope");
  if (env.MF_ENGINE_DESIGN_WORKFLOW && !['factory', 'screens'].includes(env.MF_ENGINE_DESIGN_WORKFLOW)) throw new Error("Invalid worker design workflow scope");
  return { projectIds, kinds: kinds as EngineJobKind[], ...(excludedKinds.length ? { excludedKinds: excludedKinds as EngineJobKind[] } : {}), ...(env.MF_ENGINE_DESIGN_WORKFLOW ? { designWorkflow: env.MF_ENGINE_DESIGN_WORKFLOW as 'factory' | 'screens' } : {}) };
}

/** Whether this worker may take one job. `maintenanceReady` (default true) says the host can carry the daily Blocks
 *  skills sync (`engine.skills-sync`): it has the official engine home. A host that cannot must never claim the job —
 *  it would claim it and immediately fail it, every day. That kind belongs to no project, so the operator's project,
 *  kind and design-workflow scopes never restrict it; an excluded kind still does.
 *
 *  `feedbackReady` (default true) says the host has the GitHub sign-in of the team's feedback board (platform.feedback:
 *  kinds/platformFeedback/config.ts feedbackHostReady). That job belongs to no project either (ProjectId "system"), but
 *  unlike the sync the operator's scopes do restrict it: a project- or kind-scoped worker (the dev planners) never takes
 *  it, and they also exclude it outright (local.mjs, screens.mjs). The production engine host, unscoped and signed in,
 *  claims it. */
export function acceptsWorkerJob(scope: WorkerJobScope, job: Row, maintenanceReady = true, feedbackReady = true): boolean {
  const kind = typeof job.Kind === "string" ? job.Kind : "";
  if (scope.excludedKinds?.includes(kind as EngineJobKind)) return false;
  if (isHostMaintenance(kind)) return maintenanceReady;
  if (kind === PLATFORM_FEEDBACK_KIND && !feedbackReady) return false;
  if (scope.designWorkflow && kind === "design.generate") {
    try { const input = JSON.parse(String(job.InputJson ?? "{}")); if (input.workflow !== scope.designWorkflow) return false; }
    catch { return false; }
  }
  return (!scope.projectIds.length || scope.projectIds.includes(String(job.ProjectId))) &&
    (!scope.kinds.length || scope.kinds.includes(kind as EngineJobKind));
}

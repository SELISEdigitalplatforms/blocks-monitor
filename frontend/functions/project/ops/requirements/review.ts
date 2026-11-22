// requirements.review: asks the MADP engine to review the requirements.
// The job input is built here from record ids only; client-built input is never trusted.
// Docs/ENGINE-CONTRACT.md lists {projectId, sanitizationVersion} for requirements.draft; the
// ids and purpose below are an addition for the suggestions purpose (see the lane report).
import { isActiveRequirementStatus } from "../../../../src/domain/requirements";
import { defineLaneOp, addChanged, argString, type ChangedRows } from "./ports";
import { loadRequirements, loadObjective } from "./loaders";
import { wire } from "./records";

type Row = Record<string, any>;

export const requestReview = defineLaneOp({
  op: "requirements.review",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse: (input: Record<string, unknown>) => ({ projectId: argString(input, "projectId") }),
  prefetch: (env: any) => Promise.all([loadRequirements(env), loadObjective(env)]),
  async run(ctx: any) {
    const [requirements, objective] = (await Promise.all([loadRequirements(ctx), loadObjective(ctx)])) as [
      Row[],
      Row | null,
    ];
    const requirementIds = requirements
      .filter((r) => isActiveRequirementStatus(String(r.Status)))
      .sort((a, b) => Number(a.SortOrder ?? 0) - Number(b.SortOrder ?? 0))
      .map((r) => String(r.ItemId));
    const input = {
      projectId: ctx.project.id,
      requirementIds,
      objectiveId: objective ? String(objective.ItemId) : null,
      purpose: "suggestions",
    };
    const { job, created } = await ctx.deps.jobs.create({
      workspaceId: ctx.workspaceId,
      projectId: ctx.project.id,
      kind: "requirements.draft",
      targetKey: `${ctx.project.id}:suggestions`,
      input,
      actorUserId: ctx.actorUserId,
    });
    const changed: ChangedRows = {};
    addChanged(changed, "EngineJob", wire(job));
    ctx.deps.audit({ targetType: "engine-job", targetId: String(job.ItemId), details: { kind: "requirements.review", existing: !created } });
    return { jobId: String(job.ItemId), created, changed };
  },
});

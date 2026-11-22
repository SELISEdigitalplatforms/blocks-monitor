// docs.generate: runs Agent 06-docs on demand (outside the pipeline). The engine writes documentation files;
// nothing here writes content — it only queues the job.
import { defineOp, f } from "../../../_lib";
import { activeKeyOf } from "../../../_lib/jobs";
import { projectArgs } from "../common/args";
import { liveProject, topOf } from "../common/loaders";
import { SCHEMA } from "../common/records";
import { loaderDeps, warm } from "../wiki/savePath";

const JOB_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId",
  "Progress", "Message", "Attempts", "FinishedAt", "RequestedByUserId",
];

export const DOCS_GENERATE_OPS = [
  defineOp({
    op: "docs.generate",
    kind: "command",
    scope: "project",
    permission: "membership",
    args: projectArgs({}),
    prefetch: (p) => warm(activeJob(loaderDeps(p), p.args.projectId)),
    async handler(ctx, args, deps) {
      const [, active] = await Promise.all([liveProject(ctx, deps), activeJob(deps, args.projectId)]);
      if (active[0]) return { jobId: String(active[0].ItemId), existing: true, job: active[0] };
      const made = await deps.jobs.create({ kind: "docs.generate", projectId: args.projectId, input: { projectId: args.projectId } });
      if (!made.existing) deps.audit({ targetType: "engine-job", targetId: String(made.job.ItemId), details: {} });
      return { jobId: String(made.job.ItemId), existing: made.existing, job: made.job };
    },
  }),
];

function activeJob(deps: Parameters<typeof topOf>[0], projectId: string) {
  return topOf(deps, SCHEMA.engineJob, f.and(f.eq("ProjectId", projectId), f.eq("ActiveKey", activeKeyOf("docs.generate"))), JOB_FIELDS, 1);
}

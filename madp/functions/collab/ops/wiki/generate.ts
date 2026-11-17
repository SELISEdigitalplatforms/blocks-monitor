// wiki.generate: the only way wiki content comes from MADP. The engine writes the pages; nothing here writes Origin factory.
import { wikiJobInput } from "../../../../src/domain/wiki";
import { defineOp, f } from "../../../_lib";
import { activeKeyOf } from "../../../_lib/jobs";
import { projectArgs } from "../common/args";
import { liveProject, topOf } from "../common/loaders";
import { SCHEMA } from "../common/records";
import { loaderDeps, warm } from "./savePath";

const JOB_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId",
  "Progress", "Message", "Attempts", "FinishedAt", "RequestedByUserId",
];

export const WIKI_GENERATE_OPS = [
  defineOp({
    op: "wiki.generate",
    kind: "command",
    scope: "project",
    permission: "wiki.edit",
    args: projectArgs({}),
    prefetch: (p) => warm(activeJob(loaderDeps(p), p.args.projectId)),
    async handler(ctx, args, deps) {
      // The queued or running job of this project is known from round 1: a repeat answers with it and writes nothing.
      const [, active] = await Promise.all([liveProject(ctx, deps), activeJob(deps, args.projectId)]);
      if (active[0]) return { jobId: String(active[0].ItemId), existing: true, job: active[0] };
      const made = await deps.jobs.create({ kind: "wiki.generate", projectId: args.projectId, input: wikiJobInput(args.projectId) });
      if (!made.existing) deps.audit({ targetType: "engine-job", targetId: String(made.job.ItemId), details: {} });
      return { jobId: String(made.job.ItemId), existing: made.existing, job: made.job };
    },
  }),
];

function activeJob(deps: Parameters<typeof topOf>[0], projectId: string) {
  return topOf(deps, SCHEMA.engineJob, f.and(f.eq("ProjectId", projectId), f.eq("ActiveKey", activeKeyOf("wiki.generate"))), JOB_FIELDS, 1);
}

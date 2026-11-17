/**
 * build.retryAfterDeploy: "Finish the steps after the deploy". A build (build.run or change.build) whose code is live
 * but whose steps after the deploy did not all finish (its ErrorCode, src/domain/afterDeploy.ts) gets a job of its own
 * kind and target with { afterDeploy: true, afterJobId }: the engine runs only the data tables' and the texts' syncs
 * again (kinds/delivery.ts finishAfterDeploy), no lane, no ticket move, no status change.
 *
 * Only while it is still open (the project's newest delivered build still has it in the same area) and running the
 * steps again can finish it (an engineer's refusal or held-back texts wait for a person); one delivery job at a time,
 * as for every build. The answer names the job and whether it already ran (`existing`, `jobStatus`).
 */
import { defineDeliveryOp, fail, idArg, startEngineJob, strictArgs } from "../common";
import type { ReadPorts, Row } from "../ports";
import {
  AFTER_DEPLOY_KINDS, afterDeployRetryInput, deliveryTargetOf, isAfterDeployRetry, newestDelivered, openAttention, type AfterDeployJob,
} from "../../../../src/domain/afterDeploy";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { mayQueueBuild } from "../../../../src/domain/parallelStreams";
import { readStreams, streamsLimit } from "../changes/crStreams";

const ACTIVE = new Set(["queued", "claimed", "running"]);

const readJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "change.build", "preview.deploy"] } });

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const view = (j: Row): AfterDeployJob & { inputJson: string } => ({
  id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode), finishedAt: s(j.FinishedAt), inputJson: s(j.InputJson),
});

export const buildRetryAfterDeployOp = defineDeliveryOp({
  permission: "build.run",
  overlap: true,
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "jobId"]);
    return { projectId: idArg(a.projectId, "projectId"), jobId: idArg(a.jobId, "jobId") };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; jobId: string }) => Promise.all([readJobs(ports, args.projectId), readStreams(ports, args.projectId)]),
  async handler(ctx, args: { projectId: string; jobId: string }) {
    const { ports, projectId, workspaceId } = ctx;
    const [rows, streams] = (await Promise.all([readJobs(ports, projectId), readStreams(ports, projectId)])) as [Row[], Row | null];
    await ctx.authorized(); // the membership check ran alongside the read
    const jobs = rows.map(view);
    const job = jobs.find((j) => j.id === args.jobId);
    if (!job || !AFTER_DEPLOY_KINDS.includes(job.kind) || !deliveryTargetOf(job)) fail("not_found", "delivery.afterDeploy.notFound");
    const target = deliveryTargetOf(job);

    // a retry of this build's steps already on its way: answer it (a double click, a replay)
    const sameTarget = (j: typeof job) => j.kind === job.kind && deliveryTargetOf(j) === target;
    const running = jobs.find((j) => ACTIVE.has(j.status) && sameTarget(j) && isAfterDeployRetry(j));
    if (running) return { jobId: running.id, existing: true, kind: job.kind, jobStatus: running.status };
    // a change's steps after its deploy: queued beside other changes' builds with parallel streams (the engine runs
    // them in the merge turn); a milestone's, and everything with one stream: alone, as before
    const room = job.kind === "change.build" ? mayQueueBuild({ jobs, limit: streamsLimit(streams), targetId: target }) : { ok: !jobs.some((j) => ACTIVE.has(j.status)) };
    if (!room.ok || jobs.some((j) => j.kind === "preview.deploy" && ACTIVE.has(j.status))) fail("conflict", "delivery.build.active");

    // still open: the target's newest delivered build (the named job, or a later one of the same milestone or change
    // request) left it, and the project's newest delivered build still has it in that area
    const own = newestDelivered(jobs, sameTarget);
    const open = own ? openAttention(own, newestDelivered(jobs)) : null;
    if (!own || !open) return fail("invalid_input", "delivery.afterDeploy.nothingOpen");
    if (!open.retry) fail("invalid_input", "delivery.afterDeploy.needsPerson", { issue: open.top });

    const earlier = jobs.filter((j) => sameTarget(j) && isAfterDeployRetry(j)).length;
    const started = await startEngineJob(ports, {
      workspaceId,
      projectId,
      kind: own.kind as EngineJobKind,
      // the new notes go on the tickets of that build (its OutputRefs)
      input: afterDeployRetryInput(own, projectId),
      dedupeKey: `${own.kind}:afterDeploy:${target}:${earlier + 1}`,
      createdByUserId: ctx.caller.userId,
      // one active follow-up per build it follows (as the engine queues its own), never one per project: a key shared
      // with another change's running build answered that build as this retry
      target: { type: "EngineJob", id: own.id },
    }, { field: own.kind === "build.run" ? "milestoneId" : "changeRequestId", id: target });
    if (!started.existing) {
      await ctx.after(() => ctx.audit("build.retryAfterDeploy", "EngineJob", started.jobId, { afterJobId: own.id, issues: open.issues.join(",") }));
    }
    return { jobId: started.jobId, existing: started.existing, kind: job.kind, jobStatus: started.status };
  },
});

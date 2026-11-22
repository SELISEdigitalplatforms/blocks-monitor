/**
 * cr.startBuild: queues the change.build EngineJob, then marks the change request building. Only an approved change
 * on the fast route builds (CHANGE-PROCESS-31.10); a change whose build failed (status failed after its approval, or
 * still building with its change.build job failed) builds again with the same approved analysis.
 */
import { defineDeliveryOp, fail, failFromRule, idArg, startEngineJob, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { parseJobInput, readReleases } from "../rows";
import { changeVersionAtStart, checkChangeForBuild, takenVersions } from "../../../../src/domain/delivery";
import { parseChangeAnalysis } from "../../../../src/domain/changeAnalysis";
import { changesNotUsable } from "../../../../src/domain/afterDeploy";
import { checksSettled } from "../../../../src/domain/changeChecks";
import { mayQueueBuild } from "../../../../src/domain/parallelStreams";
import { readStreams, streamsLimit } from "./crStreams";

const ACTIVE = new Set(["queued", "claimed", "running"]);

const readJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "change.build"] } });
/** The project's change requests: the versions their builds hold. */
const readChanges = (ports: ReadPorts, projectId: string) => ports.query("ChangeRequest", { ProjectId: projectId });

export const crStartBuildOp = defineDeliveryOp({
  permission: "build.run",
  overlap: true,
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "changeRequestId"]);
    return { projectId: idArg(a.projectId, "projectId"), changeRequestId: idArg(a.changeRequestId, "changeRequestId") };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; changeRequestId: string }) =>
    Promise.all([ports.getById("ChangeRequest", args.changeRequestId), readReleases(ports, args.projectId), readJobs(ports, args.projectId), readChanges(ports, args.projectId), readStreams(ports, args.projectId)]),
  async handler(ctx: any, args: { projectId: string; changeRequestId: string }) {
    const { ports, projectId, workspaceId } = ctx;
    const { changeRequestId } = args;
    const [cr, allReleases, jobs, changes, streams] = (await Promise.all([
      ports.getById("ChangeRequest", changeRequestId),
      readReleases(ports, projectId),
      readJobs(ports, projectId),
      readChanges(ports, projectId),
      readStreams(ports, projectId),
    ])) as [any, any[], any[], any[], any];
    const devReleases = allReleases.filter((r) => r.Environment === "dev");
    await ctx.authorized(); // the membership check ran alongside the reads
    if (!cr || cr.ProjectId !== projectId || (cr.WorkspaceId && cr.WorkspaceId !== workspaceId)) {
      fail("not_found", "delivery.cr.notFound");
    }

    const mine = jobs.filter((j) => j.Kind === "change.build" && parseJobInput(j)?.changeRequestId === changeRequestId);
    const running = mine.find((j) => ACTIVE.has(j.Status));
    // A replay or double click: the job exists already, so answer with it.
    const announce = (jobId: string, withActor: boolean) =>
      ctx.notifyFollowers({
        kind: "build.started",
        discriminator: jobId,
        params: { changeNumber: Number(cr.Number) },
        withActor,
      });
    if (running) {
      await announce(running.ItemId as string, false);
      return { jobId: running.ItemId as string, existing: true, version: (cr.Version ?? "") as string, jobStatus: String(running.Status) };
    }

    const route = parseChangeAnalysis(cr.Analysis)?.route ?? null;
    // the newest of them by when it ended (none runs: answered above); the job read has FinishedAt, not CreatedDate
    const latest = [...mine].sort((a, b) => String(b.FinishedAt ?? "").localeCompare(String(a.FinishedAt ?? "")))[0];
    const rule = checkChangeForBuild(
      {
        status: cr.Status,
        title: typeof cr.Title === "string" ? cr.Title : "",
        description: typeof cr.Description === "string" ? cr.Description : "",
        route,
        decidedAt: typeof cr.DecidedAt === "string" && cr.DecidedAt ? cr.DecidedAt : null,
        // the engine leaves a failed or cancelled build at "building": no active job (checked above) and a stopped one
        // is a retry (the change request's page offers "Start the build again" then, changeFlow.ts buildStopped).
        // A change still at "building" whose newest build succeeded has nothing running either: a start that queued no
        // job (its key answered that finished job) left it there. A feature delivery's next increment may start, and
        // any other change builds again (the engine marks a built change released-dev, so its build never got there).
        // A change at "building" without any build of its own: its start never queued one (09.11.2026, CR-021: the
        // start answered another change's build), so it builds again too.
        lastBuildFailed:
          mine.some((j) => j.Status === "failed" || j.Status === "cancelled") || latest?.Status === "succeeded" || mine.length === 0,
      },
      devReleases.length,
    );
    if (!rule.ok) failFromRule(rule);
    // one stream: one build at a time; more (parallel streams): queued, the engine starts it when a stream is free and
    // nothing running touches what its analysis touches (never beside a milestone build or another build of this change)
    const room = mayQueueBuild({ jobs: jobs.map((j) => ({ kind: String(j.Kind), status: String(j.Status), inputJson: typeof j.InputJson === "string" ? j.InputJson : null })), limit: streamsLimit(streams), targetId: changeRequestId });
    if (!room.ok) fail("conflict", room.messageKey);
    // its newest delivered build left its own checks failing on dev: the next increment never builds on a broken one
    // (fix what they found, or put development back first: cr.fixChecks)
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const views = jobs.map((j) => ({ id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode), finishedAt: s(j.FinishedAt), inputJson: s(j.InputJson) }));
    // (failing checks marked known before this change, or each passing since on a later version, are not its)
    const settled = checksSettled(changes.map((c) => ({ id: String(c.ItemId), checks: c.ItemId === changeRequestId ? cr.Checks : c.Checks })));
    if (changesNotUsable(views, (id, jobId) => id === changeRequestId && settled(id, jobId)).has(changeRequestId)) fail("conflict", "delivery.checks.notUsable");

    // every build gets a version of its own: above every release (any environment), every version a change request
    // holds and every version a build was started with, so a build that never finished still holds its version and two
    // builds never share one
    const taken = takenVersions({ releases: allReleases.map((r) => r.Version), changes: changes.map((c) => c.Version), jobs: jobs.map((j) => ({ inputJson: j.InputJson })) });
    const version = changeVersionAtStart(cr.Lane, taken);
    if (version === null) fail("invalid_input", "delivery.cr.noDevRelease");

    const job = await startEngineJob(ports, {
      workspaceId,
      projectId,
      kind: "change.build",
      // docs/ENGINE-CONTRACT.md change.build: {projectId, changeRequestId, version}; the job carries its own version (the
      // engine reads it from here, never from a ChangeRequest row it may read before the update below), and the engine
      // writes the version it really deployed back to the ChangeRequest
      input: { projectId, changeRequestId, version },
      // one key per build of this change (any outcome): a retry after a failure and the next increment of a feature
      // delivery each get a new job; a replay or double click while one runs is answered above. A key that still names
      // a finished job (a count read before it was visible) never answers it: startEngineJob queues a new one.
      dedupeKey: `change.build:${changeRequestId}:${mine.length + 1}`,
      createdByUserId: ctx.caller.userId,
      // one active build per change request, never per project: with parallel streams another change's build is
      // running, and a project-wide key answered THAT build as this one's (09.11.2026, CR-020 and CR-021 got CR-018's)
      target: { type: "ChangeRequest", id: changeRequestId },
    }, { field: "changeRequestId", id: changeRequestId });
    // Job first, then the change request, so a failure in between leaves an approved change that can retry.
    await ctx.after(() =>
      Promise.all([
        ports.update("ChangeRequest", changeRequestId, ctx.touch({ Status: "building", Version: version })),
        ...(job.existing ? [] : [ctx.audit("cr.startBuild", "ChangeRequest", changeRequestId, { jobId: job.jobId })]),
      ]),
    );
    await announce(job.jobId, !job.existing);
    return { jobId: job.jobId, version: version as string, existing: job.existing, jobStatus: job.status };
  },
});

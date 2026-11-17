/**
 * build.start: queues a build.run EngineJob for the next milestone.
 * Writes only the EngineJob and (once) the Project journey step; milestone
 * status and tickets are written by the engine, never here.
 *
 * A milestone whose newest build SUCCEEDED but which is still not built (its preview never came online: the preview
 * failed or was cancelled, or the build came from the Factory's removed template builder and no preview followed)
 * gets a new preview (preview.deploy) instead: the build's code is on dev already, and the preview deploys or checks
 * it. The answer names what was queued (`kind`) and whether it was a job that already runs (`existing`), so the page
 * never says it requested something it did not.
 */
import { defineDeliveryOp, fail, idArg, startEngineJob, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { lockedMilestones, parseJobInput, readMilestones } from "../rows";
import { journeyStep } from "../../../../src/domain/journey";
import { nextMilestoneToBuild } from "../../../../src/domain/delivery";

const ACTIVE = new Set(["queued", "claimed", "running"]);

const readTickets = (ports: ReadPorts, projectId: string) =>
  ports.query("Ticket", { ProjectId: projectId }, { fields: ["ItemId", "MilestoneId"] });
const readJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "change.build", "preview.deploy"] } });

const VERSION = /^\d+\.\d+\.\d+$/;
/** The newest job of a list (CreatedAt; on a tie, the later one read). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const newestOf = (rows: any[]): any | null =>
  rows.reduce((best, r) => (!best || String(r.CreatedAt ?? "") >= String(best.CreatedAt ?? "") ? r : best), null);

export const buildStartOp = defineDeliveryOp({
  permission: "build.run",
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "milestoneId"]);
    return { projectId: idArg(a.projectId, "projectId"), milestoneId: idArg(a.milestoneId, "milestoneId") };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; milestoneId: string }) =>
    Promise.all([
      ports.getById("Milestone", args.milestoneId),
      readMilestones(ports, args.projectId),
      readTickets(ports, args.projectId),
      readJobs(ports, args.projectId),
    ]),
  async handler(ctx: any, args: { projectId: string; milestoneId: string }) {
    const { ports, project, projectId, workspaceId } = ctx;
    const { milestoneId } = args;
    const lockedAt = project.ScopeLockedAt;
    if (!lockedAt || !Number.isInteger(project.CurrentScopeVersion)) {
      fail("invalid_input", "delivery.build.scopeNotLocked");
    }
    const [milestone, milestones, tickets, jobs] = await Promise.all([
      ports.getById("Milestone", milestoneId),
      lockedMilestones(ctx),
      readTickets(ports, projectId),
      readJobs(ports, projectId),
    ]);
    if (!milestone || milestone.ProjectId !== projectId || (milestone.WorkspaceId && milestone.WorkspaceId !== workspaceId)) {
      fail("not_found", "delivery.milestone.notFound");
    }
    if (milestone.ScopeVersion !== project.CurrentScopeVersion) {
      fail("invalid_input", "delivery.build.otherScopeVersion");
    }

    const counts: Record<string, number> = {};
    for (const t of tickets as any[]) {
      if (typeof t.MilestoneId === "string" && t.MilestoneId) counts[t.MilestoneId] = (counts[t.MilestoneId] ?? 0) + 1;
    }
    const next = nextMilestoneToBuild(
      (milestones as any[]).map((m) => ({
        id: m.ItemId,
        number: m.Number,
        name: m.Name,
        sortOrder: m.SortOrder,
        status: m.Status,
      })),
      counts,
    );
    if (next.milestone?.id !== milestoneId) {
      fail("invalid_input", next.milestone === null && next.messageKey ? next.messageKey : "delivery.build.notNext");
    }
    if (next.messageKey === "delivery.build.noTickets") fail("invalid_input", next.messageKey);

    const input = (j: any) => parseJobInput(j) ?? {};
    const mine = (jobs as any[]).filter((j) => j.Kind === "build.run" && input(j).milestoneId === milestoneId);
    // the milestone's builds; a job that only finished the steps after an earlier deploy (build.retryAfterDeploy) built
    // nothing, so it never decides between a new build and a new preview
    const builds = mine.filter((j) => input(j).afterDeploy !== true);
    // the milestone's previews (a release or a promotion is a preview.deploy too, with release / environment)
    const previews = (jobs as any[]).filter(
      (j) => j.Kind === "preview.deploy" && input(j).milestoneId === milestoneId && !input(j).release && !input(j).environment,
    );
    const running = builds.find((j) => ACTIVE.has(j.Status));
    const previewing = previews.find((j) => ACTIVE.has(j.Status));
    const milestoneName = String(milestone.Name ?? "");
    const announce = (jobId: string, withActor: boolean) =>
      ctx.notifyFollowers({
        kind: "build.started",
        discriminator: jobId,
        params: { milestoneName },
        withActor,
      });
    if (running) {
      await announce(running.ItemId as string, false);
      return { jobId: running.ItemId as string, existing: true, kind: "build.run", jobStatus: String(running.Status) };
    }
    if (previewing) return { jobId: previewing.ItemId as string, existing: true, kind: "preview.deploy", jobStatus: String(previewing.Status) };
    if ((jobs as any[]).some((j) => j.Kind !== "preview.deploy" && ACTIVE.has(j.Status))) fail("conflict", "delivery.build.active");

    // Built, but not online: the newest build succeeded and the milestone has no ready preview. A new preview, never a
    // second build of work that is done (and never the old job: its key would answer it again, queueing nothing).
    if (newestOf(builds)?.Status === "succeeded") {
      // the version the last preview was for (the engine's own default otherwise)
      const lastVersion = String(input(newestOf(previews) ?? {}).version ?? "");
      const version = VERSION.test(lastVersion) ? lastVersion : "";
      const preview = await startEngineJob(ports, {
        workspaceId,
        projectId,
        kind: "preview.deploy",
        input: { projectId, milestoneId, ...(version ? { version } : {}) },
        // concurrent starts see the same count and yield one job; a failed or cancelled preview can start again
        dedupeKey: `preview.deploy:milestone:${projectId}:${milestoneId}:${previews.length + 1}`,
        createdByUserId: ctx.caller.userId,
        target: { type: "milestone", id: milestoneId },
      });
      if (!preview.existing) {
        await ctx.after(() => ctx.audit("build.start", "EngineJob", preview.jobId, { milestoneId, preview: true }));
      }
      return { jobId: preview.jobId, existing: preview.existing, kind: "preview.deploy", jobStatus: preview.status };
    }

    // F0 rejects client ItemIds, so this dedupeKey (RequestKey) replaces the brief's uuid5 ItemId.
    // Concurrent starts see the same n and yield one job. n counts every finished build of the milestone (none runs
    // here), so the key never names an earlier job: a failed, cancelled or exhausted build can start again. Should it
    // still name one (a read that did not see that build yet), startEngineJob queues a new job instead of answering it.
    const n = mine.length;
    const job = await startEngineJob(ports, {
      workspaceId,
      projectId,
      kind: "build.run",
      // docs/ENGINE-CONTRACT.md build.run: {projectId, milestoneId, ticketIds?}; built on the server only.
      input: { projectId, milestoneId },
      dedupeKey: `build.run:${projectId}:${milestoneId}:${n + 1}`,
      createdByUserId: ctx.caller.userId,
      // milestones build one at a time (one active build.run per project); an active one of ANOTHER milestone that
      // answers this start (a build that began after the reads above) is "another build is running", never this start
    }, { field: "milestoneId", id: milestoneId });

    // The job id is known only now: the audit rides in the router's bookkeeping round (nothing new on a replay).
    if (!job.existing) {
      await ctx.after(() => ctx.audit("build.start", "EngineJob", job.jobId, { milestoneId }));
    }
    if (project.Stage === "board") {
      const r = journeyStep({ step: "board", scopeLocked: true }, "build.start", {
        kind: "user",
        permissions: ctx.permissions,
      });
      // The answer needs no result of it: it runs in the router's bookkeeping round, after the job exists.
      if (r.ok) await ctx.after(() => ports.update("Project", projectId, ctx.touch({ Stage: r.state.step })));
    }
    await announce(job.jobId, !job.existing);
    return { jobId: job.jobId, existing: job.existing, kind: "build.run", jobStatus: job.status };
  },
});

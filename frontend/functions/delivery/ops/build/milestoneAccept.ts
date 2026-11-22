/**
 * milestone.accept: the client accepts a milestone whose preview is ready (the Build step's sign-off, STEP-STANDARD
 * row 5): Status preview-ready -> done, with AcceptedAt and AcceptedByUserId. Idempotent: an accepted milestone answers
 * { existing: true } and writes nothing. Refused while its feedback is still open or while it is being rebuilt.
 * When the LAST milestone of the locked scope is accepted, the release to dev (1.0.0) is queued: a preview.deploy job
 * with { release: "1.0.0" } that deploys the accepted build to dev and hands the project on to Release (engine).
 * Milestone status and the release itself are written by the engine and this op only; tickets never here.
 */
import { defineDeliveryOp, fail, idArg, startEngineJob, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { lockedMilestones, parseJobInput, readMilestones } from "../rows";

const ACTIVE = new Set(["queued", "claimed", "running"]);
export const FIRST_RELEASE = "1.0.0";

const readPreviews = (ports: ReadPorts, projectId: string, milestoneId: string) =>
  ports.query("Preview", { ProjectId: projectId, MilestoneId: milestoneId });
const readTickets = (ports: ReadPorts, projectId: string, milestoneId: string) =>
  ports.query("Ticket", { ProjectId: projectId, MilestoneId: milestoneId }, { fields: ["ItemId", "Column", "Source"] });
const readJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "preview.deploy"] } });
const readDevReleases = (ports: ReadPorts, projectId: string) =>
  ports.query("Release", { ProjectId: projectId, Environment: "dev" }, { fields: ["ItemId", "Version"] });

/** The newest ready preview's version (by version number), or null. */
export function readyPreviewVersion(previews: readonly Record<string, unknown>[]): string | null {
  const ready = previews.filter((p) => p.Status === "ready" && typeof p.Version === "string" && /^\d+\.\d+\.\d+$/.test(p.Version as string));
  ready.sort((a, b) => {
    const x = String(a.Version).split(".").map(Number);
    const y = String(b.Version).split(".").map(Number);
    return (y[0]! - x[0]!) || (y[1]! - x[1]!) || (y[2]! - x[2]!);
  });
  return (ready[0]?.Version as string | undefined) ?? null;
}

export const milestoneAcceptOp = defineDeliveryOp({
  permission: "build.run",
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "milestoneId"]);
    return { projectId: idArg(a.projectId, "projectId"), milestoneId: idArg(a.milestoneId, "milestoneId") };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; milestoneId: string }) =>
    Promise.all([
      ports.getById("Milestone", args.milestoneId),
      readMilestones(ports, args.projectId),
      readPreviews(ports, args.projectId, args.milestoneId),
      readTickets(ports, args.projectId, args.milestoneId),
      readJobs(ports, args.projectId),
      readDevReleases(ports, args.projectId),
    ]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handler(ctx: any, args: { projectId: string; milestoneId: string }) {
    const { ports, project, projectId, workspaceId } = ctx;
    const { milestoneId } = args;
    if (!project.ScopeLockedAt || !Number.isInteger(project.CurrentScopeVersion)) fail("invalid_input", "delivery.build.scopeNotLocked");
    const [milestone, milestones, previews, tickets, jobs, devReleases] = await Promise.all([
      ports.getById("Milestone", milestoneId),
      lockedMilestones(ctx),
      readPreviews(ports, projectId, milestoneId),
      readTickets(ports, projectId, milestoneId),
      readJobs(ports, projectId),
      readDevReleases(ports, projectId),
    ]);
    if (!milestone || milestone.ProjectId !== projectId || (milestone.WorkspaceId && milestone.WorkspaceId !== workspaceId)) {
      fail("not_found", "delivery.milestone.notFound");
    }
    if (milestone.ScopeVersion !== project.CurrentScopeVersion) fail("invalid_input", "delivery.build.otherScopeVersion");

    // already accepted (or delivered with the release): nothing to do
    if (milestone.Status === "done") {
      return { milestoneId, existing: true, acceptedAt: milestone.AcceptedAt ?? null, releaseJobId: null };
    }
    if (milestone.Status !== "preview-ready") fail("invalid_input", "delivery.milestone.notReady");
    const version = readyPreviewVersion(previews);
    if (!version) fail("invalid_input", "delivery.milestone.noPreview");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = (j: any) => parseJobInput(j)?.milestoneId === milestoneId && ACTIVE.has(j.Status);
    if ((jobs as Record<string, unknown>[]).some(mine)) fail("conflict", "delivery.milestone.building");
    const openFeedback = (tickets as Record<string, unknown>[]).filter((t) => t.Source === "feedback" && t.Column !== "done").length;
    if (openFeedback > 0) fail("conflict", "delivery.milestone.openFeedback", { open: openFeedback });

    const acceptedAt = ctx.now as string;
    await ports.update("Milestone", milestoneId, ctx.touch({ Status: "done", AcceptedAt: acceptedAt, AcceptedByUserId: ctx.caller.userId }));

    // the last milestone accepted: queue the first release to dev (the engine deploys the accepted build)
    let releaseJobId: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = milestones as any[];
    const everyAccepted = all.length > 0 && all.every((m) => m.ItemId === milestoneId || m.Status === "done");
    if (everyAccepted && (devReleases as unknown[]).length === 0) {
      const job = await startEngineJob(ports, {
        workspaceId,
        projectId,
        kind: "preview.deploy",
        input: { projectId, milestoneId, version, release: FIRST_RELEASE },
        dedupeKey: `preview.deploy:release:${projectId}:${FIRST_RELEASE}`,
        createdByUserId: ctx.caller.userId,
      });
      releaseJobId = job.jobId;
    }
    await ctx.after(() => ctx.audit("milestone.accept", "Milestone", milestoneId, { version, ...(releaseJobId ? { releaseJobId } : {}) }));
    return { milestoneId, existing: false, acceptedAt, releaseJobId };
  },
});

/** Shared reads and checks of the change request ops (cr.submit, cr.answer, cr.decide, cr.startBuild). */
import { fail, startEngineJob } from "../common";
import type { OpContext } from "../common";
import type { ReadPorts, Row } from "../ports";
import { parseJobInput } from "../rows";

export const ACTIVE_JOB = new Set(["queued", "claimed", "running"]);

/** The project's change.analyse jobs (one read; the same call in prefetch and handler). */
export const readAnalyseJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: "change.analyse" });

/** The jobs of one change request, from already-read rows. */
export const jobsOfChange = (jobs: readonly Row[], changeRequestId: string): Row[] =>
  jobs.filter((j) => parseJobInput(j)?.changeRequestId === changeRequestId);

/** The change request of this project and workspace, or not_found. */
export function ownChange(ctx: OpContext, cr: Row | null): Row {
  if (!cr || cr.ProjectId !== ctx.projectId || (cr.WorkspaceId && cr.WorkspaceId !== ctx.workspaceId)) {
    return fail("not_found", "delivery.cr.notFound");
  }
  return cr;
}

export const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Queues change.analyse for one change request; attempt n+1 of its earlier jobs, so a retry is a new job. */
export function queueAnalysis(ctx: OpContext, changeRequestId: string, earlierJobs: number, refine: boolean) {
  return startEngineJob(ctx.ports, {
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: "change.analyse",
    // docs/ENGINE-CONTRACT.md change.analyse: {projectId, changeRequestId, refine?}
    input: refine
      ? { projectId: ctx.projectId, changeRequestId, refine: true }
      : { projectId: ctx.projectId, changeRequestId },
    dedupeKey: `change.analyse:${changeRequestId}:${earlierJobs + 1}`,
    createdByUserId: ctx.caller.userId,
    // one active analysis per change request, not per project
    target: { type: "ChangeRequest", id: changeRequestId },
  });
}

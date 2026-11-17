/**
 * cr.submit: sends a draft change request to analysis. draft -> analysing, and the change.analyse EngineJob is queued
 * with {projectId, changeRequestId}. A change whose analysis failed (failed, never decided) may be sent again; when
 * all its questions were already answered the new job refines that analysis ({refine: true}).
 */
import { defineDeliveryOp, failFromRule, idArg, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { readReleases } from "../rows";
import { checkChangeForSubmit } from "../../../../src/domain/delivery";
import { allQuestionsAnswered, parseChangeAnalysis } from "../../../../src/domain/changeAnalysis";
import { ACTIVE_JOB, jobsOfChange, ownChange, queueAnalysis, readAnalyseJobs, text } from "./crShared";

type Args = { projectId: string; changeRequestId: string };

export const crSubmitOp = defineDeliveryOp({
  permission: "build.run",
  overlap: true,
  validate(raw: unknown): Args {
    const a = strictArgs(raw, ["projectId", "changeRequestId"]);
    return { projectId: idArg(a.projectId, "projectId"), changeRequestId: idArg(a.changeRequestId, "changeRequestId") };
  },
  prefetch: (ports: ReadPorts, args: Args) =>
    Promise.all([ports.getById("ChangeRequest", args.changeRequestId), readReleases(ports, args.projectId), readAnalyseJobs(ports, args.projectId)]),
  async handler(ctx, args: Args) {
    const { changeRequestId } = args;
    const [row, releases, jobs] = await Promise.all([
      ctx.ports.getById("ChangeRequest", changeRequestId),
      readReleases(ctx.ports, ctx.projectId),
      readAnalyseJobs(ctx.ports, ctx.projectId),
    ]);
    await ctx.authorized(); // the membership check ran alongside the reads
    const cr = ownChange(ctx, row);
    const mine = jobsOfChange(jobs, changeRequestId);
    const running = mine.find((j) => ACTIVE_JOB.has(text(j.Status)));
    // A replay or double click: the analysis is already queued.
    if (running && cr.Status === "analysing") {
      return { changeRequestId, jobId: text(running.ItemId), status: "analysing", existing: true };
    }
    // the analysis the system stopped (its time limit or last attempt) with nothing running: the change may be sent again
    // (the newest of its jobs by when it ended; the job read has FinishedAt, not CreatedDate)
    const newest = [...mine].sort((a, b) => text(b.FinishedAt).localeCompare(text(a.FinishedAt)))[0];
    const analysisStopped = !running && !!newest && (text(newest.Status) === "failed" || text(newest.Status) === "cancelled");
    const rule = checkChangeForSubmit(
      { status: text(cr.Status), title: text(cr.Title), description: text(cr.Description), decidedAt: text(cr.DecidedAt) || null, analysisStopped },
      releases.filter((r) => r.Environment === "dev").length,
    );
    if (!rule.ok) return failFromRule(rule);

    const earlier = parseChangeAnalysis(cr.Analysis);
    const refine = (cr.Status === "failed" || cr.Status === "questions") && !!earlier && earlier.questions.length > 0 && allQuestionsAnswered(earlier);
    const job = await queueAnalysis(ctx, changeRequestId, mine.length, refine);
    // Job first, then the status, so a failure in between leaves a draft that can be sent again.
    await ctx.after(() =>
      Promise.all([
        ctx.ports.update("ChangeRequest", changeRequestId, ctx.touch({ Status: "analysing" })),
        ...(job.existing
          ? []
          : [ctx.audit("cr.submit", "ChangeRequest", changeRequestId, { jobId: job.jobId, from: text(cr.Status), refine })]),
      ]),
    );
    return { changeRequestId, jobId: job.jobId, status: "analysing", existing: job.existing };
  },
});

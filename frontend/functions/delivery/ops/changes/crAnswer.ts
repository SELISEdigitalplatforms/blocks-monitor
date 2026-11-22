/**
 * cr.answer: saves answers into Analysis.questions while the change waits for them (status questions). An answer is
 * one of the question's options or free text; answering again replaces it. When every question is answered,
 * change.analyse is queued again with {refine: true}; the status stays questions until that job finishes.
 */
import { arrayArg, defineDeliveryOp, fail, failFromRule, idArg, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { checkChangeForAnswer } from "../../../../src/domain/delivery";
import {
  CHANGE_ANALYSIS_LIMITS,
  allQuestionsAnswered,
  applyChangeAnswers,
  parseChangeAnalysis,
  serializeChangeAnalysis,
} from "../../../../src/domain/changeAnalysis";
import { ACTIVE_JOB, jobsOfChange, ownChange, queueAnalysis, readAnalyseJobs, text } from "./crShared";
import { answerMeta } from "../../../../src/domain/attachments";
import { claimFiles, filesArgs, readFiles, type FilesArgs } from "../files";

/** `files`: the files sent with the answer (a design, a document); with one answer they belong to that question. */
type Args = { projectId: string; changeRequestId: string; answers: unknown[] } & FilesArgs;

export const crAnswerOp = defineDeliveryOp({
  permission: "build.run",
  overlap: true,
  validate(raw: unknown): Args {
    const a = strictArgs(raw, ["projectId", "changeRequestId", "answers", "attachmentIds", "draftKey"]);
    return {
      projectId: idArg(a.projectId, "projectId"),
      changeRequestId: idArg(a.changeRequestId, "changeRequestId"),
      answers: arrayArg(a.answers, "answers", CHANGE_ANALYSIS_LIMITS.questions),
      ...filesArgs(a),
    };
  },
  prefetch: (ports: ReadPorts, args: Args) =>
    Promise.all([ports.getById("ChangeRequest", args.changeRequestId), readAnalyseJobs(ports, args.projectId), readFiles(ports, args.projectId, args)]),
  async handler(ctx, args: Args) {
    const { changeRequestId } = args;
    const [row, jobs, fileRows] = await Promise.all([
      ctx.ports.getById("ChangeRequest", changeRequestId),
      readAnalyseJobs(ctx.ports, ctx.projectId),
      readFiles(ctx.ports, ctx.projectId, args),
    ]);
    await ctx.authorized();
    const cr = ownChange(ctx, row);
    const status = checkChangeForAnswer({ status: text(cr.Status) });
    if (!status.ok) return failFromRule(status);
    const analysis = parseChangeAnalysis(cr.Analysis);
    if (!analysis) return fail("conflict", "delivery.cr.noAnalysis");
    const mine = jobsOfChange(jobs, changeRequestId);
    // The refinement is already running on the earlier answers.
    if (mine.some((j) => ACTIVE_JOB.has(text(j.Status)))) return fail("conflict", "delivery.cr.analysing");

    const applied = applyChangeAnswers(analysis, args.answers, ctx.caller.userId, ctx.now);
    if (!applied.ok) return failFromRule(applied);
    const next = applied.value;
    const stored = serializeChangeAnalysis(next);
    if (stored.length > CHANGE_ANALYSIS_LIMITS.json) return fail("too_large", "delivery.cr.answerTooLong");
    const complete = allQuestionsAnswered(next);
    const answeredIds = [...new Set((args.answers as { id: string }[]).map((x) => x.id))];
    const answered = answeredIds.length;
    // The files: the caller's own ready drafts (or, on a retry, already this change request's), checked before any write.
    const files = claimFiles(ctx, fileRows, args, "change-request", changeRequestId);

    // The answers and their files first: the refining job reads them from the change request.
    await Promise.all([
      ctx.ports.update("ChangeRequest", changeRequestId, ctx.touch({ Analysis: stored })),
      files.attach(changeRequestId, answered === 1 ? answerMeta(answeredIds[0]) : ""),
    ]);
    const job = complete ? await queueAnalysis(ctx, changeRequestId, mine.length, true) : null;
    await ctx.audit("cr.answer", "ChangeRequest", changeRequestId, {
      answered,
      complete,
      ...(job ? { jobId: job.jobId } : {}),
      ...(files.count ? { files: files.count, attachmentIds: files.ids } : {}),
    });
    return {
      changeRequestId,
      status: "questions",
      answered,
      complete,
      jobId: job ? job.jobId : null,
      questions: next.questions.map((q) => ({ id: q.id, answer: q.answer })),
    };
  },
});

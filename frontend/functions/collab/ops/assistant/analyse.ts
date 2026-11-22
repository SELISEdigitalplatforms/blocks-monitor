// assistant.analyse: ask MADP to analyse a saved bug report (a fix.analyse engine job). Repeating returns the existing job.
import { defineOp, f, v } from "../../../_lib";
import { classifyMessage, parseAttachmentNotes } from "../../../../src/domain/assistant";
import { isTerminal } from "../../../../src/domain/engineJob";
import type { EngineJobStatus } from "../../../../src/domain/engineJob";
import { projectArgs } from "../common/args";
import { childOf, liveProject, topOf } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, pick, str } from "../common/records";
import { loaderDeps, prefetchChild, warm } from "../wiki/savePath";

const JOB_FIELDS = ["ItemId", "Kind", "Status", "Progress", "TargetType", "TargetId", "ActiveKey", "RequestedByUserId"];

const jobsOf = (deps: Parameters<typeof topOf>[0], projectId: string, messageId: string) =>
  topOf(deps, SCHEMA.engineJob, f.and(f.eq("ProjectId", projectId), f.eq("Kind", "fix.analyse"), f.eq("TargetId", messageId)), JOB_FIELDS, 20);

export const ASSISTANT_ANALYSE_OPS = [
  defineOp({
    op: "assistant.analyse",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ messageId: v.id() }),
    prefetch: (p) =>
      warm(
        prefetchChild(p, SCHEMA.assistant, p.args.messageId, "ProjectId", p.args.projectId, FIELDS.assistant),
        jobsOf(loaderDeps(p), p.args.projectId, p.args.messageId),
      ),
    async handler(ctx, args, deps) {
      const [, message, jobs] = await Promise.all([
        liveProject(ctx, deps),
        childOf(deps, SCHEMA.assistant, args.messageId, args.projectId, FIELDS.assistant),
        jobsOf(deps, args.projectId, args.messageId),
      ]);
      const notes = parseAttachmentNotes(str(message, "AttachmentsJson"));
      if (str(message, "Role") !== "user" || classifyMessage(str(message, "Text"), notes) !== "bug") {
        return deps.fail("invalid_input", MSG.assistantNotBugReport);
      }
      const live = jobs.find((j) => {
        const s = str(j, "Status") as EngineJobStatus;
        return s === "succeeded" || !isTerminal(s);
      });
      let job = live;
      const existing = !!live;
      if (!job) {
        job = (
          await deps.jobs.create({
            kind: "fix.analyse",
            projectId: args.projectId,
            input: { projectId: args.projectId, assistantMessageId: args.messageId, environment: str(message, "Environment") },
            targetType: "assistant-message",
            targetId: args.messageId,
          })
        ).job;
      }
      const jobId = String(job.ItemId);
      // The link needs the job id, so it shares the router's closing round instead of a round of its own.
      if (str(message, "EngineJobId") !== jobId) deps.after(() => deps.gw.update(SCHEMA.assistant, args.messageId, { EngineJobId: jobId }));
      if (!existing) deps.audit({ targetType: "assistant-message", targetId: args.messageId, details: { jobId } });
      return { message: pick({ ...message, EngineJobId: jobId }, FIELDS.assistant), job, existing };
    },
  }),
];

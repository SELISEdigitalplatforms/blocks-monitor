/**
 * milestone.feedback: feedback on a milestone's preview (the Build step, STEP-STANDARD row 5: try the preview, give
 * feedback). It becomes a fix ticket of that milestone in Planned (Source "feedback", the words as its description and
 * acceptance) with its "created" event by the person. The development team picks it up: when no build runs, a build.run
 * of the milestone is queued now (the engine works the open tickets and refreshes the preview); otherwise the engine
 * picks the open feedback up after the running build (server/local/engine/kinds/delivery.ts).
 * Only while the preview is ready and the milestone is not accepted yet.
 */
import { checkComment } from "../../../../src/domain/delivery";
import { plannedRoleOf } from "../../../../src/domain/ticketRole";
import { defineDeliveryOp, fail, failFromRule, idArg, startEngineJob, stringArg, strictArgs } from "../common";
import type { ReadPorts } from "../ports";
import { activeDeliveryJobs } from "../rows";
import { claimFiles, filesArgs, precheckFiles, readFiles, type FilesArgs } from "../files";

type Args = { projectId: string; milestoneId: string; text: string } & FilesArgs;

const readTickets = (ports: ReadPorts, projectId: string) =>
  ports.query("Ticket", { ProjectId: projectId }, { fields: ["ItemId", "Number", "MilestoneId", "Source", "PlanRef"] });

/** "The export button does nothing. It should …" -> "The export button does nothing" (at most 100 characters, cut at a whole word). */
export function feedbackTitle(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s+|\n+/)[0]!.trim().replace(/[.!?]+$/, "");
  if (first.length <= 100) return first;
  // cut at the last whole word (a long word without spaces is cut hard)
  const cut = first.slice(0, 97);
  const space = cut.lastIndexOf(" ");
  return `${(space >= 60 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

export const milestoneFeedbackOp = defineDeliveryOp({
  permission: ["comment", "build.run"],
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "milestoneId", "text", "attachmentIds", "draftKey"]);
    return {
      projectId: idArg(a.projectId, "projectId"),
      milestoneId: idArg(a.milestoneId, "milestoneId"),
      // the real cap is applied by checkComment
      text: stringArg(a.text, "text", 20000),
      // the files sent with the feedback (a screenshot, a design): they go onto the ticket the development team works
      ...filesArgs(a),
    };
  },
  prefetch: (ports: ReadPorts, args: Args) =>
    Promise.all([ports.getById("Milestone", args.milestoneId), readTickets(ports, args.projectId), readFiles(ports, args.projectId, args)]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handler(ctx: any, args: Args) {
    const { ports, project, projectId, workspaceId } = ctx;
    const { milestoneId } = args;
    const [milestone, tickets, fileRows] = await Promise.all([
      ports.getById("Milestone", milestoneId),
      readTickets(ports, projectId),
      readFiles(ports, projectId, args),
    ]);
    if (!milestone || milestone.ProjectId !== projectId || (milestone.WorkspaceId && milestone.WorkspaceId !== workspaceId)) {
      fail("not_found", "delivery.milestone.notFound");
    }
    if (milestone.ScopeVersion !== project.CurrentScopeVersion) fail("invalid_input", "delivery.build.otherScopeVersion");
    if (milestone.Status === "done") fail("invalid_input", "delivery.milestone.accepted");
    if (milestone.Status !== "preview-ready") fail("invalid_input", "delivery.milestone.notReady");
    const r = checkComment(args.text);
    if (!r.ok) failFromRule(r);
    const text = r.value as string;
    // every file is one of the caller's own ready uploads of preview feedback (before the ticket is written)
    precheckFiles(ctx, fileRows, args, "ticket");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = tickets as any[];
    const number = rows.reduce((mx, t) => Math.max(mx, Number.isInteger(t.Number) ? t.Number : 0), 0) + 1;
    const nth = rows.filter((t) => t.MilestoneId === milestoneId && t.Source === "feedback").length + 1;
    const title = feedbackTitle(text) || "Feedback on the preview";
    const { itemId: ticketId, existing } = await ports.insert(
      "Ticket",
      ctx.stamp({
        ProjectId: projectId,
        MilestoneId: milestoneId,
        Number: number,
        PlanRef: `fb:${milestoneId}:${ctx.requestId}`,
        Title: title,
        TicketType: "fix",
        FeatureRef: "",
        StoryRef: "",
        AgentRole: plannedRoleOf({ type: "fix" }),
        Column: "planned",
        // no EstimateHours: the screens show the real estimate (src/domain/engineEstimate.ts), never a guessed figure
        Acceptance: [`The preview does what this feedback asks: “${title}”.`, "Nothing else in the milestone changes."],
        SortOrder: 1000 + nth,
        Description: text,
        IsDone: false,
        Source: "feedback",
        // a fix of the preview waits for nothing new: the milestone's work is built already
        DependsOn: [],
      }),
      { requestKey: ctx.requestKey("ticket") },
    );
    // the files go onto the ticket before any build can pick it up (a retry finds them there already)
    if (args.attachmentIds.length > 0) {
      let files;
      try {
        files = claimFiles(ctx, fileRows, args, "ticket", ticketId);
      } catch (e) {
        if (!existing) await ports.remove("Ticket", ticketId).catch(() => undefined);
        throw e;
      }
      await files.attach(ticketId);
    }
    if (!existing) {
      await ports.insert(
        "TicketEvent",
        ctx.stamp({
          ProjectId: projectId, TicketId: ticketId, Kind: "move", FromColumn: "", ToColumn: "planned",
          AuthorUserId: ctx.caller.userId, AuthorLabel: "", Text: `Feedback on the preview: ${text}`, At: ctx.now, IsAuto: false,
        }),
        { requestKey: ctx.requestKey("event") },
      );
    }

    // the development team picks it up now, unless a build runs (then the engine takes it after that build)
    let jobId: string | null = null;
    const active = await activeDeliveryJobs(ctx);
    if (active.length === 0) {
      const job = await startEngineJob(ports, {
        workspaceId,
        projectId,
        kind: "build.run",
        input: { projectId, milestoneId, feedback: true },
        dedupeKey: `build.run:${projectId}:${milestoneId}:feedback:${ticketId}`,
        createdByUserId: ctx.caller.userId,
      });
      jobId = job.jobId;
    }
    const fileCount = args.attachmentIds.length;
    await ctx.after(() => ctx.audit("milestone.feedback", "Ticket", ticketId, { milestoneId, ...(jobId ? { jobId } : {}), ...(fileCount ? { files: fileCount, attachmentIds: args.attachmentIds } : {}) }));
    return { ticketId, jobId };
  },
});

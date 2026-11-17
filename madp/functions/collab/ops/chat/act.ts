// The actions an agent's chat answer offers (src/domain/chatActions.ts), run as the person who taps them:
//   agentChat.act           the "change-request" offer: the change request is created with the conversation written in
//                           (the offer's title and details, the person's messages of the thread, the item named, copies
//                           of the files they attached). The browser then sends it for analysis (delivery cr.submit).
//   agentChat.recordAction  after the action's own op ran (cr.submit, milestone.feedback or scope.feedback.add, each with
//                           the person's permission), checks that what it made exists and is theirs, marks the offer as
//                           taken (TaskId / TaskCode) and confirms it in the thread with a "task-created" message.
// Both are audited; the ledger reads the offer and its confirmation (server/engine-context/userEvents.ts).
import { defineOp, f, v } from "../../../_lib";
import type { OpDeps, Row } from "../../../_lib";
import { CHAT_ROLES, ticketCode, type ChatRole } from "../../../../src/domain/agentChat";
import { ACTION_RESULT, actionDoneLine, continueActionMade, offerKindOf, streamsActionMade, type ChatActionKind } from "../../../../src/domain/chatActions";
import { parseContinueSetting } from "../../../../src/domain/continueIncrements";
import { parseStreamsChoice } from "../../../../src/domain/parallelStreams";
import { changeCode } from "../../../../src/domain/delivery";
import { projectArgs } from "../common/args";
import { childOf, liveProject, loadFacts, prefetchFacts, topOf, type FactsNeed } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, num, pick, str } from "../common/records";
import { chatFiles, conversationOf, descriptionOf, threadRows } from "./conversation";
import { chatTaskState } from "./route";
import { createTask, linkFor } from "./task";

const TASK_FACTS: FactsNeed = { scope: true, milestones: true, tickets: true, changeRequests: true, releases: true };
const confirmationOf = (projectId: string, resultId: string) =>
  f.and(f.eq("ProjectId", projectId), f.eq("Kind", "task-created"), f.eq("TaskId", resultId));

/** The offer message: an agent message of this thread whose TaskTarget names an action. */
function offerOf(deps: OpDeps, row: Row, role: ChatRole): { kind: ChatActionKind; row: Row } {
  const kind = offerKindOf(row.TaskTarget);
  if (!kind || str(row, "Role") !== "agent" || str(row, "Kind") !== "text" || str(row, "AgentRole") !== role) return deps.fail("not_found");
  return { kind, row };
}

/** The person's message the offer answers (the same engine job), or null. */
const questionOf = (thread: readonly Row[], offer: Row): Row | null =>
  thread.find((m) => str(m, "Role") === "user" && str(m, "EngineJobId") && str(m, "EngineJobId") === str(offer, "EngineJobId")) ?? null;

const CR_FIELDS = ["ItemId", "ProjectId", "Number", "Lane", "Title", "Status", "RequestedByUserId", "CreatedByUserId"];
const TICKET_FIELDS = ["ItemId", "ProjectId", "Number", "Title", "MilestoneId", "Source", "CreatedByUserId"];
const COMMENT_FIELDS = ["ItemId", "ProjectId", "ThreadId", "AuthorUserId", "Text"];
const THREAD_FIELDS = ["ItemId", "ProjectId", "TargetType", "TargetId"];

export const CHAT_ACTION_OPS = [
  defineOp({
    op: "agentChat.act",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ agentRole: v.enumOf(CHAT_ROLES), offerId: v.id() }),
    prefetch: (p) => {
      if (!p.gw || !p.projectId) return null;
      return Promise.all([prefetchFacts(p.gw, p.projectId, TASK_FACTS), threadRows(p.gw, p.projectId, p.args.agentRole)]);
    },
    async handler(ctx, args, deps) {
      const role: ChatRole = args.agentRole;
      const { projectId } = args;
      const [, offerRow, facts, thread] = await Promise.all([
        liveProject(ctx, deps),
        childOf(deps, SCHEMA.agentChat, args.offerId, projectId, FIELDS.agentChat),
        loadFacts(ctx, deps, TASK_FACTS),
        threadRows(deps.gw, projectId, role),
      ]);
      const { kind, row: offer } = offerOf(deps, offerRow, role);
      if (kind !== "change-request") return deps.fail("invalid_input", MSG.chatOfferGone);
      // Taken already (a second tap, another tab): the change request it made is the answer.
      const takenId = str(offer, "TaskId");
      if (takenId) {
        const made = facts.changeRequests.find((r) => str(r, "ItemId") === takenId);
        if (made) {
          return { changeRequestId: takenId, code: changeCode({ lane: str(made, "Lane"), number: num(made, "Number") }), title: str(made, "Title"), status: str(made, "Status"), existing: true };
        }
      }
      if (!chatTaskState(facts).released) return deps.fail("conflict", MSG.chatOfferNotYet);

      // The conversation behind the offer: the person's messages up to the question it answers, and their files.
      const question = questionOf(thread, offer);
      const upToId = question ? str(question, "ItemId") : "";
      const asker = question ? str(question, "AuthorUserId") : ctx.caller.userId;
      const said = conversationOf(thread, { upToId, authorUserId: asker });
      const files = await chatFiles(deps.gw, projectId, said.map((m) => m.id));
      const description = descriptionOf({ role, summary: str(offer, "Text"), messages: said, files });
      const task = await createTask(deps, {
        route: "change-request", projectId, userId: ctx.caller.userId, text: str(offer, "Text"), facts,
        conversation: { role, messages: said, files }, title: str(offer, "TaskTitle"), description,
      });
      // The offer is taken now (the confirmation follows once the change request is sent for analysis).
      await Promise.all([
        deps.gw.update(SCHEMA.agentChat, args.offerId, { TaskId: task.id, TaskCode: task.code }),
        deps.flush(),
      ]);
      deps.audit({ targetType: "agent-chat-message", targetId: args.offerId, details: { action: kind, changeRequestId: task.id, code: task.code, files: files.length } });
      return { changeRequestId: task.id, code: task.code, title: task.title, status: "draft", existing: false, link: task.link };
    },
  }),

  defineOp({
    op: "agentChat.recordAction",
    kind: "command",
    scope: "project",
    permission: "comment",
    args: projectArgs({ agentRole: v.enumOf(CHAT_ROLES), offerId: v.id(), resultId: v.id() }),
    async handler(ctx, args, deps) {
      const role: ChatRole = args.agentRole;
      const { projectId, resultId } = args;
      const caller = ctx.caller.userId;
      const [, offerRow, existing] = await Promise.all([
        liveProject(ctx, deps),
        childOf(deps, SCHEMA.agentChat, args.offerId, projectId, FIELDS.agentChat),
        topOf(deps, SCHEMA.agentChat, confirmationOf(projectId, resultId), FIELDS.agentChat, 5),
      ]);
      const { kind, row: offer } = offerOf(deps, offerRow, role);
      const found = existing.find((m) => str(m, "AgentRole") === role);
      if (found) return { message: pick(found, FIELDS.agentChat), existing: true };
      if (str(offer, "TaskId") && str(offer, "TaskId") !== resultId) return deps.fail("conflict", MSG.chatOfferGone);

      // What the action made must exist, belong to this project and come from this person (or this offer).
      const target = str(offer, "TaskFeatureRef");
      let code = "";
      let title = str(offer, "TaskTitle");
      let submitted = false;
      let where = "";
      if (kind === "change-request") {
        const cr = await childOf(deps, SCHEMA.changeRequest, resultId, projectId, CR_FIELDS);
        if (str(cr, "RequestedByUserId") !== caller && str(offer, "TaskId") !== resultId) return deps.fail("forbidden");
        code = changeCode({ lane: str(cr, "Lane"), number: num(cr, "Number") });
        title = str(cr, "Title") || title;
        submitted = str(cr, "Status") !== "draft";
      } else if (kind === "preview-fix") {
        const t = await childOf(deps, SCHEMA.ticket, resultId, projectId, TICKET_FIELDS);
        if (str(t, "Source") !== "feedback" || str(t, "MilestoneId") !== target || str(t, "CreatedByUserId") !== caller) {
          return deps.fail("invalid_input", MSG.chatTaskMismatch);
        }
        code = ticketCode(num(t, "Number"));
        title = str(t, "Title") || title;
      } else if (kind === "continue-increments") {
        // the setting cr.continueIncrements stored: this person's, the offered one, the result id it answered
        const p = await deps.gw.get("Project", projectId, ["ItemId", "ContinueIncrements"]);
        const c = parseContinueSetting(p?.ContinueIncrements ?? null);
        if (!c || !continueActionMade(c, { caller, target, resultId })) return deps.fail("invalid_input", MSG.chatTaskMismatch);
        code = c.on ? "On" : "Off";
        where = c.on ? "on" : "off";
      } else if (kind === "parallel-streams") {
        // the choice cr.parallelStreams stored: this person's, the offered number, the result id it answered
        const p = await deps.gw.get("Project", projectId, ["ItemId", "ParallelStreams"]);
        const c = parseStreamsChoice(p?.ParallelStreams ?? null);
        if (!c || !streamsActionMade(c, { caller, target, resultId })) return deps.fail("invalid_input", MSG.chatTaskMismatch);
        code = c.chosen === 1 ? "1 stream" : `${c.chosen} streams`;
        where = String(c.chosen);
      } else {
        const c = await childOf(deps, SCHEMA.comment, resultId, projectId, COMMENT_FIELDS);
        if (str(c, "AuthorUserId") !== caller) return deps.fail("forbidden");
        const th = await childOf(deps, SCHEMA.thread, str(c, "ThreadId"), projectId, THREAD_FIELDS);
        if (str(th, "TargetId") !== target) return deps.fail("invalid_input", MSG.chatTaskMismatch);
        code = "Comment";
        where = await targetName(deps, str(th, "TargetType"), target, projectId);
      }

      const row: Row = {
        ProjectId: projectId,
        AgentRole: role,
        Role: "agent",
        Kind: "task-created",
        TaskTarget: ACTION_RESULT[kind],
        TaskId: resultId,
        TaskCode: code,
        TaskTitle: title,
        TaskLane: kind === "change-request" ? "" : str(offer, "TaskLane"),
        TaskFeatureRef: target,
        EngineJobId: str(offer, "EngineJobId"),
        At: ctx.now.toISOString(),
        Text: actionDoneLine(kind, { code, title, submitted, where }),
      };
      const [res] = await Promise.all([
        deps.gw.insert(SCHEMA.agentChat, row, { key: "done" }),
        str(offer, "TaskId") === resultId ? null : deps.gw.update(SCHEMA.agentChat, args.offerId, { TaskId: resultId, TaskCode: code }),
      ]);
      if (!res.itemId) return deps.fail("conflict");
      deps.audit({ targetType: "agent-chat-message", targetId: args.offerId, details: { action: kind, resultId, code, confirmationId: res.itemId } });
      return { message: pick({ ...row, ItemId: res.itemId }, FIELDS.agentChat), existing: false, link: kind === "change-request" ? linkFor(projectId, "change-request", { Number: Number(code.replace(/\D/g, "")) || 0 }) : "" };
    },
  }),
];

/** The name of the screen or scope item a comment went on (for the confirmation line), or "". */
async function targetName(deps: OpDeps, type: string, id: string, projectId: string): Promise<string> {
  const schema = type === "screen" ? "DesignScreen" : type === "feature" ? SCHEMA.feature : type === "story" ? SCHEMA.story : type === "milestone" ? SCHEMA.milestone : "";
  if (!schema) return "";
  try {
    const r = await childOf(deps, schema, id, projectId, ["ItemId", "ProjectId", "Name", "Title"]);
    return str(r, "Name") || str(r, "Title");
  } catch {
    return "";
  }
}

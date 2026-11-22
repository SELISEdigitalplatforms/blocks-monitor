import { defineOp, f, v } from "../../../_lib";
import { createRefs } from "../../../_lib/refs";
import type { Row } from "../../../_lib";
import { CHAT_ROLES, createdLine } from "../../../../src/domain/agentChat";
import { changeCode } from "../../../../src/domain/delivery";
import { projectArgs } from "../common/args";
import { childOf, liveProject, topOf, topVia } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, num, pick, str } from "../common/records";

// The offered chat actions (./act.ts) are listed here too, so a host that loaded this file before act.ts existed serves them.
export { CHAT_ACTION_OPS } from "./act";

const LANES = ["change", "enhance", "add"];
const STATUSES = ["draft", "building"];
const CR_FIELDS = ["ItemId", "Number", "Lane", "FeatureRef", "Title", "Status", "RequestedByUserId"];
const taskOf = (projectId: string, changeRequestId: string) =>
  f.and(f.eq("ProjectId", projectId), f.eq("Kind", "task-created"), f.eq("TaskId", changeRequestId));

export const RECORD_TASK_OPS = [
  defineOp({
    op: "agentChat.recordTask",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ agentRole: v.enumOf(CHAT_ROLES), userMessageId: v.id(), changeRequestId: v.id() }),
    // Round 1 starts the handler's reads (same queries), so the handler needs no round of its own for them.
    prefetch: (p) => {
      if (!p.gw || !p.workspaceId) return null;
      const a = p.args;
      const refs = createRefs({ raw: p.raw, workspaceId: p.workspaceId });
      return Promise.all([
        refs.child(SCHEMA.agentChat, a.userMessageId, "ProjectId", a.projectId, FIELDS.agentChat).catch(() => null),
        refs.child(SCHEMA.changeRequest, a.changeRequestId, "ProjectId", a.projectId, CR_FIELDS).catch(() => null),
        topVia(p.gw, SCHEMA.agentChat, taskOf(a.projectId, a.changeRequestId), FIELDS.agentChat, 5),
      ]);
    },
    async handler(ctx, args, deps) {
      const caller = ctx.caller.userId;
      const [, message, cr, existing] = await Promise.all([
        liveProject(ctx, deps),
        childOf(deps, SCHEMA.agentChat, args.userMessageId, args.projectId, FIELDS.agentChat),
        childOf(deps, SCHEMA.changeRequest, args.changeRequestId, args.projectId, CR_FIELDS),
        topOf(deps, SCHEMA.agentChat, taskOf(args.projectId, args.changeRequestId), FIELDS.agentChat, 5),
      ]);
      if (str(message, "Role") !== "user" || str(message, "AuthorUserId") !== caller || str(message, "AgentRole") !== args.agentRole) {
        return deps.fail("not_found");
      }
      if (str(cr, "RequestedByUserId") !== caller) return deps.fail("forbidden");
      if (!LANES.includes(str(cr, "Lane")) || !STATUSES.includes(str(cr, "Status"))) {
        return deps.fail("invalid_input", MSG.chatTaskMismatch);
      }
      const found = existing.find((m) => str(m, "AgentRole") === args.agentRole) ?? existing[0];
      if (found) return { message: pick(found, FIELDS.agentChat), existing: true };

      const row: Row = {
        ProjectId: args.projectId,
        AgentRole: args.agentRole,
        Role: "agent",
        Kind: "task-created",
        TaskTarget: "change-request",
        TaskId: args.changeRequestId,
        TaskCode: changeCode({ lane: str(cr, "Lane"), number: num(cr, "Number") }),
        TaskTitle: str(cr, "Title"),
        TaskLane: str(cr, "Lane"),
        TaskFeatureRef: str(cr, "FeatureRef"),
        At: ctx.now.toISOString(),
      };
      row.Text = createdLine({ code: str(row, "TaskCode"), title: str(row, "TaskTitle") });
      // No read-back: the insert answers the id, also for a repeat of this command.
      const res = await deps.gw.insert(SCHEMA.agentChat, row, { key: "task" });
      if (!res.itemId) return deps.fail("conflict");
      deps.audit({ targetType: "agent-chat-message", targetId: res.itemId, details: { taskId: args.changeRequestId } });
      return { message: pick({ ...row, ItemId: res.itemId }, FIELDS.agentChat), existing: false };
    },
  }),
];

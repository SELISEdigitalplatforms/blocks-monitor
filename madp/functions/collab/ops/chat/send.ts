import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row, ScopedGateway } from "../../../_lib";
import {
  CHAT_ROLES,
  MAX_OPEN_REPLY_JOBS,
  MAX_TEXT,
  NO_TASK_PERMISSION_REPLY,
  classifyIntent,
  handoffReply,
  smallTalkReply,
  topicOf,
  type ChatRole,
} from "../../../../src/domain/agentChat";
import { projectArgs } from "../common/args";
import { activeReplyJobCountVia, liveProject, loadFacts, prefetchFacts, type FactsNeed } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, isoPlus, pick, str } from "../common/records";
import { CHAT_TASK_PERMISSION, chatTaskState, routeChatTask } from "./route";
import { createTask, insertKeyed, taskMessageRow } from "./task";
import { chatFiles, conversationOf, threadRows } from "./conversation";
import { attachSendFiles, fileIdsOf, precheckSendFiles, readSendFiles, sendFileArgs } from "./sendFiles";

type Route = "reply" | "job" | "no-permission" | "suggestion" | "ticket" | "change-request";

/**
 * What a message needs, decided from the text alone so the prefetch (round 1) and the handler agree:
 * - a task ("Add a wishlist") goes where the project stands (suggestion, ticket or change request);
 * - pure small talk ("Hi", "Thanks", "I have a task for you") is answered at once;
 * - every other message is a real question: the engine's chat.reply job answers it (Claude, as the agent, with the
 *   whole project context). Nothing else is answered from a fixed status line.
 */
function planOf(text: string, withFiles = false) {
  const intent = classifyIntent(text);
  // a message with files is never small talk: the agent looks at the files and answers (chat.reply)
  const topic = intent === "conversation" && !withFiles ? topicOf(text) : null;
  const openQuestion = intent === "conversation" && topic === null;
  return { intent, topic, openQuestion };
}

const mineOf = (projectId: string, role: string) => f.and(f.eq("ProjectId", projectId), f.eq("AgentRole", role), f.eq("Role", "agent"));

const TASK_FACTS: FactsNeed = { scope: true, milestones: true, tickets: true, changeRequests: true, releases: true };

/** The reads of one message: round 1 starts them (prefetch), the handler repeats them for free from the memo. */
function reads(gw: ScopedGateway, projectId: string, role: string, userId: string, text: string, attempt: number, fileIds: readonly string[] = []) {
  const p = planOf(text, fileIds.length > 0);
  return Promise.all([
    p.intent === "task" ? prefetchFacts(gw, projectId, TASK_FACTS) : Promise.resolve(0),
    // a task carries the conversation behind it (the person's recent messages of this thread)
    p.intent === "task" ? threadRows(gw, projectId, role) : Promise.resolve(null),
    p.openQuestion && attempt <= 1 ? activeReplyJobCountVia(gw, projectId, userId) : Promise.resolve(0),
    p.topic !== null ? gw.find(SCHEMA.agentChat, { where: mineOf(projectId, role), fields: ["ItemId"], pageSize: 1 }) : Promise.resolve(null),
    // the files sent with the message
    readSendFiles(gw, projectId, fileIds),
  ]);
}

const byTime = (a: Row, b: Row): number => {
  const x = str(a, "At");
  const y = str(b, "At");
  return x === y ? str(a, "ItemId").localeCompare(str(b, "ItemId")) : x < y ? -1 : 1;
};

export const SEND_OPS = [
  defineOp({
    op: "agentChat.send",
    kind: "command",
    scope: "project",
    permission: "comment",
    args: projectArgs({
      agentRole: v.enumOf(CHAT_ROLES),
      text: v.string({ min: 1, max: MAX_TEXT, trim: true }),
      ...sendFileArgs,
    }),
    // The open-question and task paths end in their own last round (no Operation record), so a retry runs again from the keyed inserts.
    record: (data) => (data as { route?: string }).route === "reply" || (data as { route?: string }).route === "no-permission",
    prefetch: (p) => {
      if (!p.gw || !p.projectId) return null;
      return reads(p.gw, p.projectId, p.args.agentRole, p.callerUserId, p.args.text, 1, fileIdsOf(p.args));
    },
    async handler(ctx, args, deps) {
      const { projectId, text } = args;
      const role: ChatRole = args.agentRole;
      // The files sent with the message: checked before anything is written, moved onto the message once it is stored.
      const fileIds = fileIdsOf(args);
      const { topic, openQuestion } = planOf(text, fileIds.length > 0);
      const fileRows = await readSendFiles(deps.gw, projectId, fileIds);
      const fileCheck = { ids: fileIds, draftKey: args.draftKey, userId: ctx.caller.userId, projectId };
      precheckSendFiles(deps, fileRows, fileCheck);
      const attach = (messageId: string) => attachSendFiles(deps, fileRows, { ...fileCheck, messageId });

      const now = ctx.now;
      const base = { ProjectId: projectId, AgentRole: role };
      const userRow: Row = { ...base, Role: "user", Kind: "text", Text: text, AuthorUserId: ctx.caller.userId, At: now.toISOString() };
      const agent = (extra: Row, ms: number): Row => ({ ...base, Role: "agent", Kind: "text", At: isoPlus(now, ms), ...extra });
      const finish = (route: Route, user: Row, rows: Row[], extra: Record<string, unknown> = {}) => ({
        messages: [user, ...rows].map((m) => pick(m, FIELDS.agentChat)).sort(byTime),
        route,
        userMessageId: str(user, "ItemId"),
        ...extra,
      });

      // Round 1 was the router's (with the prefetch): these reads come from the memo.
      if (openQuestion) {
        const [, openJobs] = await Promise.all([liveProject(ctx, deps), activeReplyJobCountVia(deps.gw, projectId, ctx.caller.userId)]);
        if (ctx.attempt <= 1 && openJobs >= MAX_OPEN_REPLY_JOBS) {
          return deps.fail("limit_reached", MSG.chatTooManyOpen, { max: MAX_OPEN_REPLY_JOBS });
        }
        return openReply(ctx, deps, { role, text, userRow, attach });
      }

      // Small talk: answered at once in the agent's voice (round 2: both messages together).
      if (topic !== null) {
        const [project, agentPage] = await Promise.all([
          liveProject(ctx, deps),
          deps.gw.find(SCHEMA.agentChat, { where: mineOf(projectId, role), fields: ["ItemId"], pageSize: 1 }),
        ]);
        const n = agentPage?.totalCount ?? agentPage?.items.length ?? 0;
        const reply = smallTalkReply(topic, { role, projectName: str(project, "Name"), n });
        const [user, answer] = await Promise.all([
          insertKeyed(deps, SCHEMA.agentChat, userRow, "user"),
          insertKeyed(deps, SCHEMA.agentChat, agent({ Text: reply }, 1), "reply"),
        ]);
        return finish("reply", user, [answer]);
      }

      const [facts, thread] = await Promise.all([loadFacts(ctx, deps, TASK_FACTS), threadRows(deps.gw, projectId, role)]);
      // The conversation behind the task: this message and the person's recent messages before it, with their files.
      const current = { id: "current", role: "user" as const, kind: "text", text, at: now.toISOString(), authorUserId: ctx.caller.userId };
      const said = conversationOf(thread, { upToId: current.id, authorUserId: ctx.caller.userId, current });
      const earlier = said.filter((m) => m.id !== current.id).map((m) => m.id);

      // A task goes where the project really stands (design 8).
      const route = routeChatTask(chatTaskState(facts));
      if (!ctx.permissions.includes(CHAT_TASK_PERMISSION[route])) {
        const [user, answer] = await Promise.all([
          insertKeyed(deps, SCHEMA.agentChat, userRow, "user"),
          insertKeyed(deps, SCHEMA.agentChat, agent({ Text: NO_TASK_PERMISSION_REPLY }, 1), "reply"),
        ]);
        await attach(str(user, "ItemId"));
        return finish("no-permission", user, [answer]);
      }
      // Round 2: the user message, the handoff and the created item. Round 3: the task message and the bookkeeping.
      const [user, handoff, task] = await Promise.all([
        insertKeyed(deps, SCHEMA.agentChat, userRow, "user"),
        insertKeyed(deps, SCHEMA.agentChat, agent({ Text: handoffReply(role) }, 1), "handoff"),
        chatFiles(deps.gw, projectId, earlier).then((files) =>
          createTask(deps, { route, projectId, userId: ctx.caller.userId, text, facts, conversation: { role, messages: said, files: [...files, ...fileRows] } })),
      ]);
      deps.audit({ targetType: "agent-chat-message", targetId: str(user, "ItemId"), details: { route } });
      const [message] = await Promise.all([
        insertKeyed(deps, SCHEMA.agentChat, taskMessageRow(base, isoPlus(now, 2), task), "task"),
        attach(str(user, "ItemId")),
        deps.flush(),
      ]);
      const link = { target: task.target, id: task.id, code: task.code, title: task.title, link: task.link };
      const key = route === "change-request" ? "changeRequest" : route;
      return finish(route, user, [handoff, message], { task: link, [key]: task.item });
    },
  }),
];

/** An open question: the only path that queues an engine job. Round 2 writes the message and the job (provisional target), round 3 links them. */
async function openReply(ctx: OpCtx, deps: OpDeps, o: { role: ChatRole; text: string; userRow: Row; attach: (messageId: string) => Promise<unknown> }) {
  const projectId = str(ctx.project, "ItemId");
  const input = { projectId, thread: "agent", threadId: o.role, messageId: "" };
  const [user, { job }] = await Promise.all([
    insertKeyed(deps, SCHEMA.agentChat, o.userRow, "user"),
    deps.jobs.create({ kind: "chat.reply", projectId, input, targetType: "agent-chat", targetId: deps.ids.local("reply-target") }),
  ]);
  const userMessageId = str(user, "ItemId");
  const jobId = str(job, "ItemId");
  deps.audit({ targetType: "agent-chat-message", targetId: userMessageId, details: { route: "job", jobId } });
  // the files go onto the message in the same round as the job learns which message it answers
  const [linked] = await Promise.all([
    deps.jobs.relink(job, { targetId: userMessageId, input: { ...input, messageId: userMessageId } }),
    deps.gw.update(SCHEMA.agentChat, userMessageId, { EngineJobId: jobId }),
    o.attach(userMessageId),
    deps.flush(),
  ]);
  return {
    messages: [pick({ ...user, EngineJobId: jobId }, FIELDS.agentChat)],
    route: "job" as const,
    userMessageId,
    job: pick(linked, ["Kind", "Status", "Progress", "TargetType", "TargetId"]),
  };
}

// assistant.send: the user's message, then a deterministic answer from real records, or an engine job.
import { defineOp, f, v } from "../../../_lib";
import type { Row, ScopedGateway } from "../../../_lib";
import {
  ASSISTANT_ENVIRONMENTS,
  ATTACHMENTS_JSON_MAX,
  BUG_NOTE_TEXT,
  EXCERPT_CHARS,
  MAX_FILES,
  MAX_FILE_BYTES,
  TEXT_MAX,
  answerQuestion,
  answerTopic,
  classifyMessage,
  normaliseNotes,
} from "../../../../src/domain/assistant";
import { MAX_OPEN_REPLY_JOBS, factsFrom } from "../../../../src/domain/agentChat";
import { projectArgs } from "../common/args";
import { activeReplyJobCountVia, liveProject, loadFacts, prefetchFacts, topVia, type FactsNeed } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, isoPlus, pick, str } from "../common/records";
import { toChatRecords } from "../chat/facts";
import { factualReply, factualTopicOf } from "../chat/factual";
import { assistantRow, insertOnce, toAssistantRecords } from "./facts";

type Args = { projectId: string; text: string; attachments: { name: string; mime: string; size: number; excerpt: string }[] };

/** ONE topic set (QA4-14): the assistant's own topics first, then the agent chat's factual topics. Only a message with neither is an open question. */
function planOf(a: Args) {
  const notes = normaliseNotes(a.attachments);
  const cls = classifyMessage(a.text, notes);
  const topic = cls === "question" ? answerTopic(a.text) : null;
  const factual = cls === "question" && topic === null ? factualTopicOf(a.text) : null;
  return { notes, cls, topic, factual, open: cls === "question" && topic === null && factual === null };
}

const FACTS_ASSISTANT: FactsNeed = { scope: true, tickets: true, changeRequests: true, releases: true };
const FACTS_CHAT: FactsNeed = { scope: true, milestones: true, tickets: true, changeRequests: true, releases: true, jobKinds: ["build.run", "change.build"] };
const OBJECTIVE_FIELDS = ["ItemId", "Statement"];

/** The reads of one message; round 1 starts them (prefetch) and the handler repeats the same calls for free from the memo. */
function readsOf(gw: ScopedGateway, a: Args, userId: string, project: string) {
  const p = planOf(a);
  return Promise.all([
    p.topic ? prefetchFacts(gw, project, FACTS_ASSISTANT) : p.factual ? prefetchFacts(gw, project, FACTS_CHAT) : null,
    p.factual === "objective" ? topVia(gw, "Objective", f.eq("ProjectId", project), OBJECTIVE_FIELDS, 1) : null,
    p.open ? activeReplyJobCountVia(gw, project, userId) : null,
  ]);
}

export const ASSISTANT_SEND_OPS = [
  defineOp({
    op: "assistant.send",
    kind: "command",
    scope: "project",
    permission: "comment",
    args: projectArgs({
      environment: v.enumOf(ASSISTANT_ENVIRONMENTS),
      text: v.string({ max: TEXT_MAX, trim: true }),
      attachments: v.array(
        v.object({
          name: v.string({ min: 1, max: 255 }),
          mime: v.string({ max: 100 }),
          size: v.int({ min: 0, max: MAX_FILE_BYTES }),
          excerpt: v.string({ max: EXCERPT_CHARS }),
        }),
        { max: MAX_FILES },
      ),
    }),
    // A message that queues a job ends in its own last round (no Operation record): a retry runs again from the keyed inserts.
    record: (data) => (data as { job?: unknown }).job === undefined,
    prefetch: (p) => (p.gw && p.projectId ? readsOf(p.gw, p.args as Args, p.callerUserId, p.projectId) : null),
    async handler(ctx, args, deps) {
      if (args.text === "" && args.attachments.length === 0) return deps.fail("invalid_input", MSG.assistantEmpty);
      const { notes, cls, topic, factual, open } = planOf(args);
      const attachmentsJson = JSON.stringify(notes);
      if (attachmentsJson.length > ATTACHMENTS_JSON_MAX) {
        return deps.fail("too_large", MSG.assistantAttachmentsTooLarge, { max: ATTACHMENTS_JSON_MAX });
      }
      const canAnalyse = ctx.permissions.includes("build.run");

      const userRow = assistantRow(args.projectId, args.environment, "user", args.text, ctx.now.toISOString(), { AttachmentsJson: attachmentsJson });
      const out = (rows: Row[]): Row[] => rows.map((m) => pick(m, FIELDS.assistant));
      const answerRow = (text: string, extra: Row = {}): Row =>
        assistantRow(args.projectId, args.environment, "assistant", text, isoPlus(ctx.now, 1), extra);

      // A deleting project writes nothing: liveProject answers from the router's row.
      await liveProject(ctx, deps);

      // A factual question is answered from the records: round 2 writes both messages together.
      if (topic || factual) {
        const [facts, objective] = await Promise.all([
          loadFacts(ctx, deps, topic ? FACTS_ASSISTANT : FACTS_CHAT),
          factual === "objective" ? topVia(deps.gw, "Objective", f.eq("ProjectId", args.projectId), OBJECTIVE_FIELDS, 1) : Promise.resolve(null),
        ]);
        let text: string;
        let points: string[] = [];
        if (topic) ({ text, points } = answerQuestion(topic, toAssistantRecords(facts)));
        else {
          const chatFacts = factsFrom(toChatRecords(facts), "planner");
          text = factualReply(factual!, {
            projectName: chatFacts.projectName,
            step: chatFacts.step,
            objective: str(objective?.[0] ?? {}, "Statement").trim() || null,
            facts: chatFacts,
            n: 0,
          });
        }
        const [user, answer] = await Promise.all([insertOnce(deps, userRow, "user"), insertOnce(deps, answerRow(text, { Points: points }), "answer")]);
        return { messages: out([user, answer]) };
      }

      if (cls === "bug" && !canAnalyse) {
        const [user, note] = await Promise.all([insertOnce(deps, userRow, "user"), insertOnce(deps, answerRow(BUG_NOTE_TEXT), "note")]);
        return { messages: out([user, note]) };
      }

      // An open question checks the open-job limit (read in round 1) before anything is written, as agentChat.send does.
      if (open) {
        const n = await activeReplyJobCountVia(deps.gw, args.projectId, ctx.caller.userId);
        if (n >= MAX_OPEN_REPLY_JOBS) return deps.fail("limit_reached", MSG.chatTooManyOpen, { max: MAX_OPEN_REPLY_JOBS });
      }

      // Round 2: the user message and the job (provisional target). Round 3: link them both ways.
      const input =
        cls === "bug"
          ? { projectId: args.projectId, assistantMessageId: "", environment: args.environment }
          : { projectId: args.projectId, thread: "assistant", threadId: args.environment, messageId: "" };
      const [user, { job }] = await Promise.all([
        insertOnce(deps, userRow, "user"),
        deps.jobs.create({
          kind: cls === "bug" ? "fix.analyse" : "chat.reply",
          projectId: args.projectId,
          input,
          targetType: "assistant-message",
          targetId: deps.ids.local("reply-target"),
        }),
      ]);
      const userId = str(user, "ItemId");
      deps.audit({ targetType: "assistant-message", targetId: userId, details: { jobId: str(job, "ItemId"), kind: cls === "bug" ? "fix.analyse" : "chat.reply" } });
      const [linked] = await Promise.all([
        deps.jobs.relink(job, {
          targetId: userId,
          input: cls === "bug" ? { ...input, assistantMessageId: userId } : { ...input, messageId: userId },
        }),
        deps.gw.update("AssistantMessage", userId, { EngineJobId: str(job, "ItemId") }),
        deps.flush(),
      ]);
      return { messages: out([{ ...user, EngineJobId: str(job, "ItemId") }]), job: linked };
    },
  }),
];

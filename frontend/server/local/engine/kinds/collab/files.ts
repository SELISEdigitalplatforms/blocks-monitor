// The files a person attached in an agent's chat (Attachment OwnerType "agent-chat", OwnerId = their AgentChatMessage),
// as chat.reply reads them: the files of the message it answers first, then those of their last few messages before it
// in the same thread, each group named by its message. Pictures go to Claude with the prompt, documents are quoted
// (ai/attachedGroups.ts). Never throws; no files: no pictures and "".
import type { Row } from "../../../../../functions/_lib/gateway";
import { str } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { ATTACHMENT_OWNERS, attachmentsOf } from "../../ai/attachments.ts";
import { groupedFiles, oneLine, type FileGroup, type GroupedFiles } from "../../ai/attachedGroups.ts";

/** How many of the person's earlier messages in the thread are read for files. */
export const EARLIER_MESSAGES = 6;

/** The person's earlier messages of the thread (before the one answered), oldest first, at most EARLIER_MESSAGES. */
export function earlierUserMessages(thread: readonly Row[], question: Row): Row[] {
  const id = str(question.ItemId);
  const at = str(question.At);
  return thread
    .filter((m) => m.Role === "user" && str(m.ItemId) && str(m.ItemId) !== id && (!at || !str(m.At) || str(m.At) <= at))
    .sort((a, b) => str(a.At).localeCompare(str(b.At)))
    .slice(-EARLIER_MESSAGES);
}

/** The files of the answered message and of the person's earlier messages, for the reply's prompt and pictures. */
export async function chatFiles(run: JobRun, question: Row, thread: readonly Row[]): Promise<GroupedFiles> {
  try {
    const id = str(question.ItemId);
    const earlier = earlierUserMessages(thread, question);
    const current = id ? await attachmentsOf(run, ATTACHMENT_OWNERS.chat, [id]) : [];
    const before = earlier.length ? await attachmentsOf(run, ATTACHMENT_OWNERS.chat, earlier.map((m) => str(m.ItemId))) : [];
    const groups: FileGroup[] = [
      { where: "With the message you are answering now", files: current },
      ...[...earlier].reverse().map((m) => ({
        where: `With their earlier message "${oneLine(str(m.Text), 100) || "(only files)"}"`,
        files: before.filter((f) => f.ownerId === str(m.ItemId)),
      })),
    ];
    return groupedFiles(groups, "Files the person attached in this chat (read them: they are part of what they said)");
  } catch (e) {
    run.log(`chat files: not read (${e instanceof Error ? e.message.slice(0, 100) : "error"})`);
    return { images: [], block: "" };
  }
}

// The conversation behind a request in an agent-chat thread (src/domain/chatActions.ts requestMessages): the person's
// recent messages of the thread, the files attached to them (Attachment rows of OwnerType "agent-chat", OwnerId = the
// message's ItemId), and the copies of those files a change request gets (OwnerType "change-request", OwnerId = the
// change request; the bytes stay where they are, under the same FileId). No op lives here.
import { f } from "../../../_lib";
import type { OpDeps, Row, ScopedGateway } from "../../../_lib";
import { HUMAN_ROLE, type ChatRole } from "../../../../src/domain/agentChat";
import { changeDescription, requestMessages, requestTitle, type ThreadMessage } from "../../../../src/domain/chatActions";
import { topVia } from "../common/loaders";
import { FIELDS, SCHEMA, num, str } from "../common/records";

/** How many of the newest messages of a thread are read for the conversation. */
export const THREAD_PAGE = 40;
export const CHAT_FILE_OWNER = "agent-chat";
export const CHANGE_FILE_OWNER = "change-request";

const FILE_FIELDS = [
  "ItemId", "ProjectId", "OwnerType", "OwnerId", "FileId", "FileName", "StoredName", "Kind", "Mime", "SizeBytes", "Origin", "Meta", "Status",
  "CreatedByUserId", "CreatedDate",
];

/** The newest messages of one agent's thread (the same query in the prefetch and the handler). */
export const threadRows = (gw: ScopedGateway, projectId: string, role: string): Promise<Row[]> =>
  topVia(gw, SCHEMA.agentChat, f.and(f.eq("ProjectId", projectId), f.eq("AgentRole", role)), FIELDS.agentChat, THREAD_PAGE, { field: "At", dir: "desc" });

export const toThreadMessage = (r: Row): ThreadMessage => ({
  id: str(r, "ItemId"),
  role: str(r, "Role") === "user" ? "user" : "agent",
  kind: str(r, "Kind"),
  text: str(r, "Text"),
  at: str(r, "At"),
  authorUserId: str(r, "AuthorUserId"),
});

/** The ready files attached to these chat messages, oldest first. */
export async function chatFiles(gw: ScopedGateway, projectId: string, messageIds: readonly string[]): Promise<Row[]> {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length) return [];
  const res = await gw.find(SCHEMA.attachment, {
    where: f.and(f.eq("ProjectId", projectId), f.eq("OwnerType", CHAT_FILE_OWNER), f.in("OwnerId", ids)),
    fields: FILE_FIELDS,
    page: 1,
    pageSize: 20,
  });
  return (res.items as Row[])
    .filter((r) => str(r, "Status") === "ready" && str(r, "FileId"))
    .sort((a, b) => str(a, "CreatedDate").localeCompare(str(b, "CreatedDate")));
}

export interface Conversation {
  /** The person's messages behind the request, oldest first. */
  messages: ThreadMessage[];
  /** Their attached files. */
  files: Row[];
  /** The built-in title (when the agent wrote none). */
  title: string;
}

/** The conversation up to `upToId` (a stored message, or `current` when the message is being sent now). */
export function conversationOf(rows: readonly Row[], o: { upToId: string; authorUserId: string; current?: ThreadMessage }): ThreadMessage[] {
  const thread = rows.map(toThreadMessage).filter((m) => m.id && m.id !== o.current?.id);
  if (o.current) thread.push(o.current);
  return requestMessages(thread, { upToId: o.upToId, authorUserId: o.authorUserId });
}

/** The description of a change request (or a board task) made from the conversation. */
export function descriptionOf(o: { role: ChatRole; summary: string; messages: readonly ThreadMessage[]; files: readonly Row[]; about?: string }): string {
  return changeDescription({
    summary: o.summary,
    quotes: o.messages.map((m) => m.text),
    agent: HUMAN_ROLE[o.role],
    about: o.about,
    files: o.files.map((r) => str(r, "FileName")).filter(Boolean),
  });
}

export const titleOf = (messages: readonly ThreadMessage[]): string => requestTitle(messages.map((m) => m.text));

/**
 * Copies the chat's files onto the change request (one Attachment row each, OwnerType "change-request", the same
 * stored bytes), repeat-safe by a per-file key. Answers the copies' ids.
 */
export async function copyFilesToChange(deps: OpDeps, projectId: string, changeRequestId: string, files: readonly Row[]): Promise<string[]> {
  const made = await Promise.all(
    files.map(async (r, i) => {
      const row: Row = {
        ProjectId: projectId,
        OwnerType: CHANGE_FILE_OWNER,
        OwnerId: changeRequestId,
        FileId: str(r, "FileId"),
        FileName: str(r, "FileName"),
        StoredName: str(r, "StoredName"),
        ...(str(r, "Kind") ? { Kind: str(r, "Kind") } : {}),
        Mime: str(r, "Mime"),
        SizeBytes: num(r, "SizeBytes"),
        ...(str(r, "Origin") ? { Origin: str(r, "Origin") } : {}),
        Meta: str(r, "Meta"),
        Status: "ready",
      };
      const res = await deps.gw.insert(SCHEMA.attachment, row, { key: `file:${i}:${str(r, "ItemId")}`.slice(0, 120) });
      return res.itemId ?? "";
    }),
  );
  return made.filter(Boolean);
}

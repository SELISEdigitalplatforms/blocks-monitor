// The task an agent-chat message creates, in ONE op (QA4-05): a change request, a Task ticket or a suggestion.
import { f } from "../../../_lib";
import type { OpDeps, Row } from "../../../_lib";
import { chatSuggestionKey, createdLine, laneFor, taskTitle } from "../../../../src/domain/agentChat";
import { changeCode, checkChangeDraft } from "../../../../src/domain/delivery";
import { formatNumber, insertWithNextNumber } from "../../../../src/domain/numbering";
import { plannedRoleOf } from "../../../../src/domain/ticketRole";
import type { FactsRows } from "../common/loaders";
import { topOf } from "../common/loaders";
import { FIELDS, SCHEMA, num, pick, str, strs } from "../common/records";
import { toChatRecords } from "./facts";
import type { ChatTaskRoute } from "./route";
import { copyFilesToChange, descriptionOf, titleOf } from "./conversation";
import type { ThreadMessage } from "../../../../src/domain/chatActions";
import type { ChatRole } from "../../../../src/domain/agentChat";

/** Insert under a per-command key. A repeat of the command answers the existing row's id from the insert itself (no read-back). */
export async function insertKeyed(deps: OpDeps, schema: string, row: Row, key: string): Promise<Row> {
  const res = await deps.gw.insert(schema, row, { key });
  if (!res.itemId) return deps.fail("conflict");
  return { ...row, ItemId: res.itemId };
}

/** The columns of the Ticket and ChangeRequest rows the task answer carries (every one is an S1 field: test/qa4-05-task-columns.test.ts). */
export const TASK_ANSWER = {
  ticket: [
    "ItemId", "ProjectId", "Number", "PlanRef", "Title", "Description", "TicketType", "AgentRole", "Column", "Source", "IsDone",
    "MilestoneId", "SortOrder", "FeatureRef",
  ],
  changeRequest: ["ItemId", "ProjectId", "Number", "Lane", "FeatureRef", "Title", "Description", "Status", "Version", "RequestedByUserId"],
} as const;

class NumberClash extends Error {}

/** max+1 behind the unique (ProjectId, Number) index: the first max comes from the facts read in round 1. */
async function insertNumbered(
  deps: OpDeps,
  schema: string,
  projectId: string,
  firstMax: number,
  make: (n: number) => Row,
  key: string,
): Promise<{ number: number; row: Row; replay: boolean }> {
  let first = true;
  const res = await insertWithNextNumber({
    readMax: async () => {
      if (first) {
        first = false;
        return firstMax;
      }
      const top = await topOf(deps, schema, f.eq("ProjectId", projectId), ["Number"], 1, { field: "Number", dir: "desc" });
      return num(top[0], "Number");
    },
    insert: async (n) => {
      const row = make(n);
      const out = await deps.gw.insert(schema, row, { key });
      if (!out.itemId) throw new NumberClash();
      return { row: { ...row, ItemId: out.itemId }, replay: !out.created };
    },
    isDuplicateKey: (e) => e instanceof NumberClash,
  });
  return { number: res.number, row: res.value.row, replay: res.value.replay };
}

const maxNumber = (rows: readonly Row[]): number => rows.reduce((m, r) => Math.max(m, num(r, "Number")), 0);

export interface CreatedTask {
  target: ChatTaskRoute;
  id: string;
  code: string;
  title: string;
  link: string;
  lane?: string;
  featureRef?: string;
  /** The created row, picked for the answer. */
  item: Row;
}

export const linkFor = (projectId: string, target: ChatTaskRoute, item: Row): string =>
  target === "change-request"
    ? `/p/${projectId}/delivered?change=${num(item, "Number")}`
    : target === "ticket"
      ? `/p/${projectId}/board?ticket=${str(item, "ItemId")}`
      : `/p/${projectId}/requirements?tab=suggestions`;

/** The item for the route, inserted in round 2 together with the user and handoff messages. With the conversation
 *  (the person's recent messages of the thread and their files), the title is written from the whole request and the
 *  description carries those messages; a change request also gets copies of the files. */
export async function createTask(
  deps: OpDeps,
  o: {
    route: ChatTaskRoute; projectId: string; userId: string; text: string; facts: FactsRows;
    conversation?: { role: ChatRole; messages: readonly ThreadMessage[]; files: readonly Row[] };
    /** An agent's offer: its own title and the description written from it (agentChat.act). */
    title?: string;
    description?: string;
  },
): Promise<CreatedTask> {
  const { route, projectId, facts } = o;
  const conv = o.conversation && (o.conversation.messages.length || o.conversation.files.length) ? o.conversation : null;
  const title = o.title?.trim() || (conv?.messages.length ? titleOf(conv.messages) : taskTitle(o.text));
  const text = o.description?.trim()
    || (conv && (conv.messages.length > 1 || conv.files.length > 0)
      ? descriptionOf({ role: conv.role, summary: "", messages: conv.messages, files: conv.files })
      : o.text);

  if (route === "suggestion") {
    const row = await insertKeyed(
      deps,
      SCHEMA.suggestion,
      { ProjectId: projectId, Source: "chat", Key: chatSuggestionKey(deps.ids.local("suggestion")), Title: title, Text: text.length > 2000 ? `${text.slice(0, 1999).trimEnd()}…` : text, Status: "open" },
      "suggestion",
    );
    const item = pick(row, FIELDS.suggestion);
    return { target: route, id: str(row, "ItemId"), code: "Suggestion", title, link: linkFor(projectId, route, item), item };
  }

  if (route === "change-request") {
    const records = toChatRecords(facts);
    const locked = facts.lockedVersion ? num(facts.lockedVersion, "Number") : null;
    const refs = [
      ...new Set(facts.milestones.filter((m) => locked === null || num(m, "ScopeVersion") === locked).flatMap((m) => strs(m, "FeatureRefs"))),
    ];
    const guess = laneFor(text, records.features);
    let rule = checkChangeDraft({ ...guess, title, description: text }, refs);
    if (!rule.ok) rule = checkChangeDraft({ lane: "add", featureRef: "", title, description: text }, refs);
    if (!rule.ok) return deps.fail("invalid_input");
    const v = rule.value;
    const made = await insertNumbered(
      deps,
      SCHEMA.changeRequest,
      projectId,
      maxNumber(facts.changeRequests),
      (n) => ({
        ProjectId: projectId, Number: n, Lane: v.lane, FeatureRef: v.featureRef, Title: v.title, Description: v.description,
        Status: "draft", RequestedByUserId: o.userId,
      }),
      "cr",
    );
    // A repeat of the command: the stored request keeps its own number.
    const stored = made.replay ? facts.changeRequests.find((r) => str(r, "ItemId") === str(made.row, "ItemId")) : undefined;
    // the files the person attached in the chat go with the change request (repeat-safe copies)
    if (conv?.files.length) await copyFilesToChange(deps, projectId, str(made.row, "ItemId"), conv.files);
    const item = pick({ ...made.row, ...(stored ?? {}), Number: stored ? num(stored, "Number") : made.number }, TASK_ANSWER.changeRequest);
    const code = changeCode({ lane: str(item, "Lane"), number: num(item, "Number") });
    return {
      target: route, id: str(item, "ItemId"), code, title: str(item, "Title"), link: linkFor(projectId, route, item),
      lane: str(item, "Lane"), featureRef: str(item, "FeatureRef"), item,
    };
  }

  const locked = facts.lockedVersion ? num(facts.lockedVersion, "Number") : null;
  const first = facts.milestones
    .filter((m) => locked === null || num(m, "ScopeVersion") === locked)
    .reduce<Row | null>((best, m) => (best === null || num(m, "Number") < num(best, "Number") ? m : best), null);
  const planned = facts.tickets.filter((t) => str(t, "Column") === "planned");
  const sortOrder = planned.reduce((m, t) => Math.max(m, num(t, "SortOrder") + 1), planned.length > 0 ? 1 : 0);
  const made = await insertNumbered(
    deps,
    SCHEMA.ticket,
    projectId,
    maxNumber(facts.tickets),
    (n) => ({
      ProjectId: projectId, Number: n, PlanRef: `chat-${n}`, Title: title, Description: text, TicketType: "task", AgentRole: plannedRoleOf({ type: "task" }),
      Column: "planned", Source: "chat", IsDone: false, MilestoneId: first ? str(first, "ItemId") : "", SortOrder: sortOrder,
    }),
    "ticket",
  );
  const stored = made.replay ? facts.tickets.find((r) => str(r, "ItemId") === str(made.row, "ItemId")) : undefined;
  const item = pick({ ...made.row, ...(stored ?? {}), Number: stored ? num(stored, "Number") : made.number }, TASK_ANSWER.ticket);
  return {
    target: route, id: str(item, "ItemId"), code: formatNumber("T", num(item, "Number")), title, link: linkFor(projectId, route, item), item,
  };
}

/** The agent message that tells the task was created. */
export function taskMessageRow(base: Row, at: string, t: CreatedTask): Row {
  return {
    ...base,
    Role: "agent",
    Kind: "task-created",
    At: at,
    TaskTarget: t.target,
    TaskId: t.id,
    TaskCode: t.code,
    TaskTitle: t.title,
    ...(t.target === "change-request" ? { TaskLane: t.lane ?? "", TaskFeatureRef: t.featureRef ?? "" } : {}),
    Text: createdLine({ code: t.code, title: t.title }),
  };
}

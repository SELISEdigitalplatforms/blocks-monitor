/**
 * The actions an agent of the team chat may offer (never promise): when the person asks for work, the agent's answer
 * carries ONE offer the person taps, and the tap runs the real op as that person (their permission):
 *   change-request  a change request with the conversation written in, sent to the business analyst for analysis
 *                   (cr.submit); only after the first release to dev, when change requests open
 *   preview-fix     feedback on a milestone preview (milestone.feedback: a fix ticket, the development team picks it up)
 *   update-design   the person's words as their comment on a screen (scope.feedback.add), while the scope is open
 *   add-to-scope    the person's words as their comment on a scope item (feature, story, milestone), while it is open
 *   parallel-streams how many independent change requests build side by side (cr.parallelStreams: 1..5, never above
 *                   the tech lead's suggestion), once change requests are built (target: the number)
 *   continue-increments
 *                   "Continue with the next increment when the checks pass" on or off (cr.continueIncrements), once
 *                   change requests are built (target: on or off)
 * An offer is an agent AgentChatMessage of Kind "text" whose TaskTarget is "offer:<kind>" (TaskTitle the title,
 * TaskFeatureRef the target's ItemId, Text what will be sent); once taken, its TaskId/TaskCode name what was made and a
 * "task-created" message confirms it. Pure: no React, DOM, timer or network.
 */
import { taskTitle } from "./agentChat";

export const CHAT_ACTIONS = ["change-request", "preview-fix", "update-design", "add-to-scope", "parallel-streams", "continue-increments"] as const;
export type ChatActionKind = (typeof CHAT_ACTIONS)[number];

export const isChatAction = (x: unknown): x is ChatActionKind =>
  typeof x === "string" && (CHAT_ACTIONS as readonly string[]).includes(x);

const OFFER_PREFIX = "offer:";
/** The TaskTarget of an offer message. */
export const offerTarget = (kind: ChatActionKind): string => `${OFFER_PREFIX}${kind}`;
/** The offered action of a TaskTarget, or null when it is not an offer. */
export function offerKindOf(taskTarget: unknown): ChatActionKind | null {
  if (typeof taskTarget !== "string" || !taskTarget.startsWith(OFFER_PREFIX)) return null;
  const k = taskTarget.slice(OFFER_PREFIX.length);
  return isChatAction(k) ? k : null;
}

/** The button of each offer. */
export const ACTION_BUTTON: Record<ChatActionKind, string> = {
  "change-request": "Create the change request",
  "preview-fix": "Send it as preview feedback",
  "update-design": "Post it on the screen",
  "add-to-scope": "Post it on the scope",
  "parallel-streams": "Set the parallel streams",
  "continue-increments": "Change the setting",
};

/** What the system really does on the tap, in the agent's words after "Tap … and I'll". */
export const ACTION_DOES: Record<ChatActionKind, string> = {
  "change-request": "save it as a change request and send it to the business analyst for analysis",
  "preview-fix": "send it to the development team as feedback on the preview, as a fix ticket on the board",
  "update-design": "post it as your comment on that screen, where the team picks it up",
  "add-to-scope": "post it as your comment on that part of the scope, where the team picks it up",
  "parallel-streams": "set how many independent change requests the team builds side by side (each still lands on development on its own)",
  "continue-increments": "set whether the next increment of a change starts by itself once its checks pass on development",
};

/** The one sentence an answer with an offer ends with (written by the system, so it is always true). */
export const tapLine = (kind: ChatActionKind): string => `Tap “${ACTION_BUTTON[kind]}” and I'll ${ACTION_DOES[kind]}.`;

/** The permission each action's op needs (the op checks it again). */
export const ACTION_PERMISSION: Record<ChatActionKind, readonly string[]> = {
  "change-request": ["build.run"],
  "preview-fix": ["comment", "build.run"],
  "update-design": ["comment"],
  "add-to-scope": ["comment"],
  // cr.parallelStreams also lets business.edit holders in
  "parallel-streams": ["build.run"],
  // cr.continueIncrements also lets business.edit holders in
  "continue-increments": ["build.run"],
};

/** The confirmation targets of a taken action (AgentChatMessage.TaskTarget of the "task-created" message). */
export const ACTION_RESULT: Record<ChatActionKind, "change-request" | "preview-fix" | "screen-comment" | "scope-comment" | "streams-setting" | "continue-setting"> = {
  "change-request": "change-request",
  "preview-fix": "preview-fix",
  "update-design": "screen-comment",
  "add-to-scope": "scope-comment",
  "parallel-streams": "streams-setting",
  "continue-increments": "continue-setting",
};

/** The two settings a continue-increments offer may name. */
export const CONTINUE_TARGETS: readonly NamedTarget[] = [{ id: "on", name: "on" }, { id: "off", name: "off" }];

/** The result id of a continue-increments action: the stored setting and its time ("continue-on-1794253852890"). */
export const continueResultId = (on: boolean, at: string): string => `continue-${on ? "on" : "off"}-${Number.isFinite(Date.parse(at)) ? Date.parse(at) : 0}`;

/** A tapped continue-increments offer made what it says: the stored setting is the caller's, the offered one, and the one
 *  the result id names (pure). */
export function continueActionMade(setting: { on: boolean; by: string; at: string } | null, o: { caller: string; target: string; resultId: string }): boolean {
  return !!setting && setting.by === o.caller && (setting.on ? "on" : "off") === o.target && continueResultId(setting.on, setting.at) === o.resultId;
}

/** The numbers a parallel-streams offer may name (the op checks the tech lead's suggestion again). */
export const STREAM_TARGETS: readonly NamedTarget[] = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: String(n) }));

/** The result id of a parallel-streams action: the stored choice's number and time ("streams-3-1794253852890"), so each
 *  choice made from the chat is confirmed once (pure). */
export const streamsResultId = (chosen: number, at: string): string => `streams-${chosen}-${Number.isFinite(Date.parse(at)) ? Date.parse(at) : 0}`;

/** A tapped parallel-streams offer made what it says (agentChat.recordAction): the stored choice is the caller's, the
 *  offered number, and the one the result id names (pure). */
export function streamsActionMade(choice: { chosen: number; by: string; at: string } | null, o: { caller: string; target: string; resultId: string }): boolean {
  return !!choice && choice.by === o.caller && String(choice.chosen) === o.target && streamsResultId(choice.chosen, choice.at) === o.resultId;
}

// ------------------------------------------------------------------ what can be offered now

export interface NamedTarget {
  id: string;
  name: string;
}
export interface ScopeTarget extends NamedTarget {
  type: "feature" | "story" | "milestone";
}

/** What the project offers right now, from its records. */
export interface ActionState {
  /** A release to dev exists: change requests open. */
  released: boolean;
  /** The journey is at Scope & success and the latest scope version is not locked: scope comments open. */
  scopeOpen: boolean;
  screens: readonly NamedTarget[];
  scopeItems: readonly ScopeTarget[];
  /** Milestones of the current scope version whose preview is ready and not accepted yet. */
  previews: readonly NamedTarget[];
  /** Change requests are built here (after the first release to dev): the parallel streams can be set from the chat. */
  streams?: boolean;
}

export function availableActions(s: ActionState): ChatActionKind[] {
  const out: ChatActionKind[] = [];
  if (s.released) out.push("change-request");
  if (s.previews.length > 0) out.push("preview-fix");
  if (s.scopeOpen && s.screens.length > 0) out.push("update-design");
  if (s.scopeOpen && s.scopeItems.length > 0) out.push("add-to-scope");
  if (s.streams) out.push("parallel-streams", "continue-increments");
  return out;
}

/** The targets an action may name (none for a change request). */
export function targetsFor(kind: ChatActionKind, s: ActionState): readonly NamedTarget[] {
  return kind === "preview-fix" ? s.previews : kind === "update-design" ? s.screens : kind === "add-to-scope" ? s.scopeItems
    : kind === "parallel-streams" ? STREAM_TARGETS : kind === "continue-increments" ? CONTINUE_TARGETS : [];
}

// ------------------------------------------------------------------ false promises

/**
 * Sentences in which the agent claims it will do or did work itself ("I'll add a ticket", "Let me update the hero",
 * "I've created a change request"). The chat cannot do any of that: only an offer the person taps does it. A sentence
 * starting with "Tap" is the system's own offer line.
 */
const WILL = /\b(?:i(?:'ll| will| shall|'m going to| am going to|'m about to| am about to)|let me|we(?:'ll| will| are going to|'re going to))\b/i;
const WORK = /\b(?:add|create|log|record|file|raise|open|put|make|implement|change|update|fix|build|send|submit|post|queue|schedule|start|note|write|move|hand|pass|forward|apply|redesign|adjust|include|turn|get (?:it|this|that) (?:done|built|added|changed))\b/i;
const DID = /\b(?:i|we)(?:'ve| have)(?: just| already| now)? (?:added|created|logged|recorded|filed|raised|opened|put|noted|made|submitted|posted|sent|queued|scheduled|updated|changed|implemented|forwarded|handed|passed|planned)\b/i;

/** The sentences of an answer that promise work (empty when it promises nothing). */
export function promisesIn(text: string): string[] {
  return text
    .replace(/[’]/g, "'")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => {
      const t = s.trim();
      if (!t || /^tap\b/i.test(t)) return false;
      const will = WILL.exec(t);
      return DID.test(t) || (!!will && WORK.test(t.slice(will.index + will[0].length)));
    });
}

// ------------------------------------------------------------------ the conversation behind a request

export interface ThreadMessage {
  id: string;
  role: "user" | "agent";
  kind: string;
  text: string;
  at: string;
  authorUserId: string;
}

const SMALL_TALK = /^(?:hi|hello|hey|hiya|thanks|thank you|thx|cheers|ok(?:ay)?|great|perfect|nice|cool|got it|yes|no|sure)\b[^a-z]*$/i;
/** "Do it", "implement this", "go ahead right now": the request itself lives in the messages before. */
const BARE_TRIGGER =
  /^(?:(?:ok(?:ay)?|yes|so|now)[,.!]?\s+)?(?:please[,]?\s+)?(?:just\s+)?(?:(?:do|implement|apply|build|make|ship|start|change|fix)\s+(?:it|this|that|them)|go ahead|proceed)(?:[,]?\s+(?:right now|now|asap|right away|please|for me|today))*[.!]*$/i;
/** Trailing lead-ins that are not part of the request ("…, implement this", "this was my feedback"). */
const TAIL = /(?:\s*[,/;:.\-–]+\s*|\s+)(?:this (?:is|was) my (?:feedback|request|comment)|(?:please\s+)?(?:just\s+)?(?:implement|do|apply|build|make|ship)\s+(?:it|this|that)(?:\s+(?:right now|now|asap|right away|please))*)[.!]*$/i;
const HEAD = /^(?:this (?:is|was) my (?:feedback|request|comment)[,:.\s-]*)/i;

export const isBareTrigger = (text: string): boolean => BARE_TRIGGER.test(text.trim().replace(/\s+/g, " "));

const MAX_QUOTES = 6;
const WINDOW_MS = 12 * 3600_000;
const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * The person's messages behind a request, oldest first: their own messages of this thread up to `upToId` (included),
 * newest first back to the last thing the thread already recorded (a "task-created" message), at most 6, from the last
 * 12 hours before it. Pure small talk is left out.
 */
export function requestMessages(thread: readonly ThreadMessage[], o: { upToId: string; authorUserId: string }): ThreadMessage[] {
  const sorted = [...thread].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1));
  const end = sorted.findIndex((m) => m.id === o.upToId);
  const upTo = end >= 0 ? sorted.slice(0, end + 1) : sorted;
  const last = upTo[upTo.length - 1];
  const since = last ? ms(last.at) - WINDOW_MS : 0;
  const out: ThreadMessage[] = [];
  for (let i = upTo.length - 1; i >= 0 && out.length < MAX_QUOTES; i--) {
    const m = upTo[i]!;
    if (m.kind === "task-created") break;
    if (ms(m.at) < since) break;
    if (m.role !== "user" || (o.authorUserId && m.authorUserId && m.authorUserId !== o.authorUserId)) continue;
    const t = m.text.trim();
    if (!t || SMALL_TALK.test(t)) continue;
    out.push(m);
  }
  return out.reverse();
}

const VAGUE = new Set([
  "this", "that", "with", "from", "into", "have", "been", "your", "they", "will", "would", "could", "should", "also", "just", "only",
  "right", "please", "need", "want", "like", "there", "which", "about", "what", "when", "then", "than", "them", "some", "here",
  "added", "checked", "desired", "really", "make", "made", "done", "doing", "implement", "feedback", "comment", "thing", "things",
]);
const contentWords = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !VAGUE.has(w)));

/** The request without its lead-ins and trailing "implement this". */
export function requestCore(text: string): string {
  let t = text.trim().replace(/\s+/g, " ").replace(HEAD, "");
  for (let i = 0; i < 3; i++) {
    const next = t.replace(TAIL, "").trim();
    if (next === t) break;
    t = next;
  }
  return t.replace(/\s*\/\s*$/, "").trim();
}

/**
 * A clean title from the person's messages (the built-in one; the agent's AI writes its own when it is on): the
 * message that says the most about the change (not a bare "do it"), its first sentence without lead-ins.
 */
export function requestTitle(texts: readonly string[]): string {
  const candidates = texts.map((t) => t.trim()).filter((t) => t && !isBareTrigger(t));
  if (!candidates.length) return taskTitle(texts[texts.length - 1] ?? "");
  let best = candidates[candidates.length - 1]!;
  let score = contentWords(requestCore(best)).size;
  for (let i = candidates.length - 2; i >= 0; i--) {
    const s = contentWords(requestCore(candidates[i]!)).size;
    if (s > score) {
      best = candidates[i]!;
      score = s;
    }
  }
  const core = requestCore(best).split(/\s+\/\s+|\n+/)[0] ?? best;
  return taskTitle(core || best);
}

const quote = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The description of a change request made from the chat: what to change (the agent's words, or the person's when the
 * agent wrote none), then the person's own messages in the thread, the item they named and the files they attached.
 * At most `max` characters (the change request's limit).
 */
export function changeDescription(o: {
  summary: string;
  quotes: readonly string[];
  agent: string;
  about?: string;
  files?: readonly string[];
  max?: number;
}): string {
  const max = o.max ?? 10_000;
  const parts: string[] = [];
  const summary = o.summary.trim();
  if (summary) parts.push(summary);
  const quotes = o.quotes.map(quote).filter(Boolean);
  if (quotes.length) parts.push(`What was said in the chat with the ${o.agent}:\n${quotes.map((q) => `- “${q}”`).join("\n")}`);
  if (o.about) parts.push(`About: ${o.about}.`);
  if (o.files?.length) parts.push(`Files from the chat: ${o.files.join(", ")}.`);
  const text = parts.join("\n\n");
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** The confirmation line in the chat once an action ran. */
export function actionDoneLine(kind: ChatActionKind, o: { code: string; title: string; submitted?: boolean; where?: string }): string {
  switch (kind) {
    case "change-request":
      return o.submitted
        ? `${o.code} is saved and sent for analysis: ${o.title}.`
        : `${o.code} is saved as a draft: ${o.title}. Open it to send it for analysis.`;
    case "preview-fix":
      return `${o.code} is on the board as feedback on the preview: ${o.title}.`;
    case "update-design":
      return `Your comment is posted on ${o.where ? `the “${o.where}” screen` : "the screen"}.`;
    case "add-to-scope":
      return `Your comment is posted on ${o.where ? `“${o.where}”` : "the scope"}.`;
    case "continue-increments":
      return o.where === "on"
        ? "From now on the next increment of a change starts by itself once its checks pass on development."
        : "Every next increment waits for someone to start it again.";
    case "parallel-streams":
      return o.where === "1"
        ? "Parallel streams set to 1: one change request is built at a time."
        : `Parallel streams set to ${o.where || "the number you chose"}: up to ${o.where || "that many"} independent change requests are built side by side; each still lands on development on its own.`;
  }
}

/** "use 3 parallel streams", "set parallel streams to 2", "build two changes in parallel": the number a message asks
 *  for (1..5), or null when it asks for none (pure). */
export function streamsAsked(text: string): number | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (!/\bparallel\b|\bside by side\b|\bat (?:the same|a|one) time\b|\bstreams?\b/.test(t)) return null;
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, single: 1 };
  const num = "([1-5]|one|two|three|four|five|single)";
  const pats = [
    new RegExp(`\\b${num}\\s+(?:parallel\\s+)?streams?\\b`),
    new RegExp(`\\bparallel\\s+streams?\\s*(?:(?:to|at|of)\\s+|[=:]\\s*)?${num}\\b`),
    new RegExp(`\\bstreams?\\s*(?:to\\s+|[=:]\\s*)${num}\\b`),
    new RegExp(`\\b${num}\\s+(?:change(?:\\s+request)?s?|crs?|builds?)\\s+(?:in parallel|side by side|at (?:the same|a|one) time)\\b`),
  ];
  for (const re of pats) {
    const m = re.exec(t);
    if (m) return WORDS[m[1]!] ?? Number(m[1]);
  }
  return null;
}

/**
 * Pure rules of the 3D-office agent chat on Blocks records: intent, topics, facts from real rows,
 * deterministic factual replies and the route a task takes. No React, DOM, timer or network.
 */
import { changeCode, isOpenChange } from "./delivery";
import { JOURNEY_STEPS, type JourneyStep } from "./journey";
import { effectiveStep } from "./projects";

export const CHAT_ROLES = ["planner", "dev", "reviewer", "qa", "secops", "docs", "shipper"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** The role a person sees for each chat agent, in sentence case like the 3D office (src/components/office/roles.tsx).
 *  Owner, 08.11.2026: the planner is shown as the business analyst and the developer as the tech lead, by role (no
 *  person's name); the ids stay as they were. */
export const HUMAN_ROLE: Record<ChatRole, string> = {
  planner: "Business analyst",
  dev: "Tech lead",
  reviewer: "Code reviewer",
  qa: "QA engineer",
  secops: "Security engineer",
  docs: "Technical writer",
  shipper: "Release manager",
};

/** The role inside a sentence ("I'm the business analyst"): the first letter lowered unless it starts an acronym (QA). */
export const roleInText = (role: ChatRole): string => {
  const r = HUMAN_ROLE[role];
  return /^[A-Z]{2}/.test(r) ? r : r.charAt(0).toLowerCase() + r.slice(1);
};

export const isChatRole = (x: unknown): x is ChatRole =>
  typeof x === "string" && (CHAT_ROLES as readonly string[]).includes(x);

/** The board column each agent works in (Ticket.Column). */
export const AGENT_COLUMN: Record<ChatRole, string> = {
  planner: "planned",
  dev: "dev",
  reviewer: "review",
  qa: "test",
  secops: "security",
  docs: "docs",
  shipper: "gate",
};

export const MAX_TEXT = 2000;
export const MAX_SHOWN = 50;
export const MAX_OPEN_REPLY_JOBS = 3;

// ------------------------------------------------------------------ intent

export type Intent = "task" | "conversation";

const VERBS = [
  "add", "build", "create", "change", "update", "fix", "remove", "delete", "make", "implement", "rename", "support",
  "allow", "enable", "introduce", "replace", "move", "improve", "enhance", "redesign", "show",
];
const VERB = `(?:${VERBS.join("|")})`;
const GREETING =
  /^(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening))\b[^,.!?:]*[,.!:]\s*/;
const REQUEST = [
  new RegExp(`^(?:can|could|would) (?:you|we) (?:please )?${VERB}\\b`),
  new RegExp(`^(?:can|could|would) you (?:please )?(?:also )?(?:help me )?${VERB}\\b`),
  /^(?:i need|i want|we need|we want|i'd like|i would like|we'd like) /,
  /^we should /,
  /^it would be (?:great|nice|good) (?:if|to) /,
];
const NOT_A_TASK =
  /^(?:i|we) (?:need|want) (?:some |your )?(?:help|an? update|a status|the status|an? answer|to know|to understand|to see|to ask|to talk|to check)\b/;
/** "Can you show me…", "Show me…", "Could you tell me…": asking to see or hear something is a question, not work. */
const ASKS_TO_SEE = /^(?:(?:can|could|would) you (?:please )?)?(?:show|tell|explain|walk) (?:me|us)\b|^(?:can|could|would) you (?:please )?explain\b/;
/** "…, implement this", "do this right now", "please apply it": the person tells the team to go ahead with what they
 *  described (also at the end of a longer message). Not when the message asks about it ("Did you do this?"). */
const GO_AHEAD = /(?:^|[,.;:!/–-] ?)(?:(?:ok|okay|yes|so|then|and|now|please|just)[,]? )*(?:implement|apply|do|build|make|ship) (?:this|that|it|them)(?: (?:right now|now|asap|right away|please|for me|today))*[.!]*$/;
/** "I don't know how to do this", "Did you do it": about the work, not an order to do it. */
const NOT_GO_AHEAD = /\b(?:how to|know how|not sure|don'?t know|do not know|can'?t|cannot|could ?n'?t|unable to|did you|have you|you didn'?t|didn'?t you|why)\b/;
/** "This was my feedback…", "Go ahead and add…", "Let's add…": a request in other words. */
const OTHER_REQUEST = [
  /^(?:this|that|here) (?:is|was) my (?:feedback|request|change request|comment)\b/,
  new RegExp(`^(?:go ahead|let'?s) (?:and )?${VERB}\\b`),
];
const QUESTION_START = /^(?:what|why|how|when|where|who|which|did|does|do you|have you|has|is|are|was|were|will|shall|should i|can you tell|could you tell)\b/;

function normalise(text: string): string {
  let t = text.trim().toLowerCase().replace(/\s+/g, " ");
  t = t.replace(GREETING, "");
  t = t.replace(/^please,?\s+/, "");
  return t;
}

export function classifyIntent(text: string): Intent {
  const t = normalise(text);
  if (!t) return "conversation";
  if (NOT_A_TASK.test(t) || ASKS_TO_SEE.test(t)) return "conversation";
  if (new RegExp(`^${VERB}\\b`).test(t)) return "task";
  if (REQUEST.some((r) => r.test(t))) return "task";
  if (OTHER_REQUEST.some((r) => r.test(t))) return "task";
  const asks = t.endsWith("?") || QUESTION_START.test(t);
  if (!asks && GO_AHEAD.test(t) && !NOT_GO_AHEAD.test(t)) return "task";
  return "conversation";
}

const TITLE_MAX = 120;

/** The first sentence without the lead-in, capitalised, at most 120 characters on a word boundary. */
export function taskTitle(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  t = t.replace(/^(?:hi|hello|hey)\b[^,.!?:]*[,!:]\s*/i, "");
  t = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  const lead = [
    /^please,?\s+/i,
    /^(?:can|could|would) (?:you|we) (?:please )?(?:also )?(?:help me )?/i,
    /^(?:i need|i want|we need|we want|i'd like|i would like|we'd like) (?:you )?(?:to )?/i,
    /^we should /i,
    /^it would be (?:great|nice|good) (?:if|to) (?:you |we )?(?:could |can )?/i,
  ];
  for (const r of lead) t = t.replace(r, "");
  t = t.replace(/[?.!\s]+$/, "").trim();
  t = t.replace(/\s+(?:to|on) (?:the|our|my) (?:backlog|board|list)$/i, "").trim();
  if (!t) t = text.trim().replace(/[?.!\s]+$/, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX);
  const sp = cut.lastIndexOf(" ");
  return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "");
}

const STOP = new Set([
  "this", "that", "with", "from", "into", "page", "pages", "screen", "make", "when", "what", "have", "been", "your", "their",
  "them", "then", "than", "they", "will", "would", "could", "should", "also", "more", "some", "each", "every", "only", "user", "users",
  "there", "which", "about", "after", "before", "where", "while", "item", "items", "list", "tab", "button", "add", "change", "create", "build",
]);
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
const stem = (w: string) => w.replace(/(?:ing|es|s)$/, "");

export function laneFor(
  text: string,
  features: readonly { ref: string; title: string }[],
): { lane: "change" | "enhance" | "add"; featureRef: string } {
  const t = text.toLowerCase();
  const tw = new Set(words(t).map(stem));
  const hit = features.find((f) => words(f.title).some((w) => tw.has(stem(w))));
  const featureRef = hit?.ref ?? "";
  let lane: "change" | "enhance" | "add";
  if (
    /\b(?:improve|enhance|better|faster|redesign|quicker|smoother)\b|\bmake\b.*\b(?:remember|faster|better|easier)\b/.test(t)
  ) {
    lane = "enhance";
  } else if (/\b(?:add|create|build|new|support|introduce|implement)\b/.test(t)) lane = "add";
  else if (/\b(?:change|rename|update|remove|delete|replace|move|fix)\b/.test(t)) lane = "change";
  else lane = "add";
  if ((lane === "change" || lane === "enhance") && !featureRef) return { lane: "add", featureRef: "" };
  return { lane, featureRef };
}

// ------------------------------------------------------------------ topics

export type ChatTopic = "greeting" | "thanks" | "task-hint" | "blockers" | "plan" | "release" | "step" | "working";

/** The small talk the chat answers at once (nothing else is answered without the team thinking about it). */
export type SmallTalk = "greeting" | "thanks" | "task-hint";

const NAMES = "(?:there|team|all|everyone|folks|guys|again|business analyst|tech lead|planner|developer|reviewer|tester|secops|docs|release gate|release manager)";
const PURE_GREETING = new RegExp(`^(?:hi|hello|hey|hiya|howdy|good (?:morning|afternoon|evening|day))(?: ${NAMES})?$`);
const PURE_THANKS = new RegExp(`^(?:(?:ok(?:ay)?|great|perfect|nice|cool|got it|super) )?(?:thanks|thank you|thx|cheers|great job|well done|nice work|good job)(?: (?:so much|a lot|very much))?(?: ${NAMES})?$`);
const PURE_TASK_HINT = /^(?:i|we) (?:have|got|'ve got|ve got) (?:a|another|some|one more) (?:task|request|change|job)(?: for you)?$|^(?:can|may) i give you (?:a|another) task$/;

/**
 * Small talk that needs no thinking: a message that is ONLY a greeting, a thank-you or "I have a task for you".
 * null = everything else; a real question goes to the engine's chat.reply job (Claude answers as the agent).
 */
export function topicOf(text: string): SmallTalk | null {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return "greeting";
  if (PURE_GREETING.test(t)) return "greeting";
  if (PURE_THANKS.test(t)) return "thanks";
  if (PURE_TASK_HINT.test(t)) return "task-hint";
  return null;
}

// ------------------------------------------------------------------ facts

export interface ChatRecords {
  project: { name: string; stage: string; resumeTo: string | null; scopeLockedAt: string | null };
  lockedVersion: { number: number } | null;
  features: { ref: string; title: string }[];
  milestones: { id: string; title: string; status: string; order: number }[];
  tickets: { number: number; title: string; agentRole: string; column: string; milestoneId: string; isDone: boolean }[];
  changeRequests: { id: string; number: number; lane: string; title: string; status: string; version: string }[];
  releases: { environment: string; version: string; releasedAt: string }[];
  jobs: { id: string; kind: string; status: string; progress: number; targetId: string; createdAt: string }[];
}

type Env = "dev" | "stage" | "production";

export interface ChatFacts {
  role: ChatRole;
  projectName: string;
  step: string;
  openTickets: { code: string; title: string }[];
  done: number;
  total: number;
  activeMilestone: { title: string } | null;
  build: { kind: string; status: string; progress: number } | null;
  lastRelease: Partial<Record<Env, { version: string; releasedAt: string }>>;
  openChanges: { code: string; title: string; status: string }[];
  /** The whole board: how many tickets there are, how many are done, how many still wait in Planned. */
  board: { total: number; done: number; planned: number };
}

/** The ticket's key as the Board shows it (MF-12). */
export const ticketCode = (n: number) => `MF-${n}`;
const ENVS: readonly Env[] = ["dev", "stage", "production"];

export function factsFrom(records: ChatRecords, role: ChatRole): ChatFacts {
  const p = records.project;
  const column = AGENT_COLUMN[role];
  const mine = records.tickets.filter((t) => t.agentRole === role);
  const open = mine
    .filter((t) => !t.isDone && t.column === column)
    .sort((a, b) => a.number - b.number);
  const milestones = [...records.milestones].sort((a, b) => a.order - b.order);
  const active =
    milestones.find((m) => m.status === "building") ?? milestones.find((m) => m.status === "preview-ready") ?? null;
  const builds = records.jobs
    .filter((j) => j.kind === "build.run" || j.kind === "change.build")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const last: ChatFacts["lastRelease"] = {};
  for (const env of ENVS) {
    const newest = records.releases
      .filter((r) => r.environment === env)
      .sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0))[0];
    if (newest) last[env] = { version: newest.version, releasedAt: newest.releasedAt };
  }
  return {
    role,
    projectName: p.name,
    step: effectiveStep(p.stage, p.resumeTo ?? undefined),
    openTickets: open.map((t) => ({ code: ticketCode(t.number), title: t.title })),
    done: mine.filter((t) => t.isDone || t.column === "done").length,
    total: mine.length,
    activeMilestone: active ? { title: active.title } : null,
    build: builds[0] ? { kind: builds[0].kind, status: builds[0].status, progress: Math.round(builds[0].progress) } : null,
    lastRelease: last,
    openChanges: records.changeRequests
      .filter((c) => isOpenChange(c.status))
      .sort((a, b) => a.number - b.number)
      .map((c) => ({ code: changeCode(c), title: c.title, status: c.status })),
    board: {
      total: records.tickets.length,
      done: records.tickets.filter((t) => t.isDone || t.column === "done").length,
      planned: records.tickets.filter((t) => !t.isDone && t.column === "planned").length,
    },
  };
}

// ------------------------------------------------------------------ replies

const pick = (n: number, options: string[]): string => options[Math.abs(n) % options.length];
const BUILD_ACTIVE = new Set(["queued", "claimed", "running"]);

function buildPart(f: ChatFacts): string {
  const b = f.build;
  if (!b) return "";
  if (b.status === "running") return ` The latest build is running at ${b.progress} %.`;
  if (b.status === "queued" || b.status === "claimed") return " The latest build is waiting for the MADP engine.";
  if (b.status === "failed") return " The latest build failed.";
  if (b.status === "succeeded") return " The latest build finished.";
  return "";
}

function releaseText(f: ChatFacts): string {
  const parts = ENVS.filter((e) => f.lastRelease[e]).map((e) => `v${f.lastRelease[e]!.version} on ${e}`);
  if (!parts.length) return "Not released yet.";
  return `Last release${parts.length > 1 ? "s" : ""}: ${parts.join(", ")}.`;
}

const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

function workingOn(f: ChatFacts): string {
  const counts = f.total > 0 ? ` ${f.done} of my ${f.total} ${f.total === 1 ? "ticket is" : "tickets are"} done.` : " I have no tickets yet.";
  let doing: string;
  if (f.role === "planner") {
    const b = f.board;
    doing = b.total === 0
      ? "I haven't planned any tickets yet."
      : b.done === 0 && b.planned === b.total
        ? `I've planned ${b.total} ${b.total === 1 ? "ticket" : "tickets"} on the board; none has started yet.`
        : `${b.done} of the ${b.total} ${b.total === 1 ? "ticket on the board is" : "tickets on the board are"} done${b.planned ? ` and ${b.planned} ${b.planned === 1 ? "is" : "are"} still planned` : ""}.`;
    if (f.activeMilestone) doing += ` The milestone being built is “${f.activeMilestone.title}”.`;
    return `${doing}${buildPart(f)}`.replace(/\s+/g, " ").trim();
  } else if (f.openTickets.length) {
    const [first, ...rest] = f.openTickets;
    doing = `My open ticket${rest.length ? "s" : ""}: ${first.code} “${first.title}”`;
    doing += rest.length ? `, then ${list(rest.slice(0, 3).map((t) => t.code))}.` : ".";
  } else {
    doing = "I have nothing open in my column right now.";
  }
  const build = f.role === "dev" || f.role === "shipper" ? buildPart(f) : "";
  return `${doing}${counts}${build}`.replace(/\s+/g, " ").trim();
}

function blockers(f: ChatFacts, n: number): string {
  if (f.build?.status === "failed") return "Yes: the latest build failed. It can be retried from the Build page.";
  if (f.openChanges.length) {
    return `Nothing's blocking me. ${f.openChanges.length === 1 ? "There is one open change" : "There are open changes"}: ${f.openChanges.map((c) => `${c.code} (${c.status})`).join(", ")}.`;
  }
  return pick(n, ["Nothing's blocking me.", "No blockers on my side."]);
}

const STEP_TEXT: Record<JourneyStep, string> = {
  business: "The project is at Project setup.",
  understanding: "The project understanding is being reviewed.",
  sanitization: "The project is at Understanding your project.",
  requirements: "The project is collecting requirements.",
  scope: "The scope is waiting for confirmation.",
  board: "The scope is locked and the board is planned.",
  build: "The build step is under way.",
  release: "The project is at the release step.",
};

function stepReply(f: ChatFacts, n: number): string {
  if (!(JOURNEY_STEPS as readonly string[]).includes(f.step)) return plan(f, n);
  return STEP_TEXT[f.step as JourneyStep];
}

function plan(f: ChatFacts, n: number): string {
  const lead = f.role === "planner" ? pick(n, ["Here is the plan.", "Here's where we are."]) : "The business analyst owns the plan.";
  const step = (JOURNEY_STEPS as readonly string[]).includes(f.step) ? STEP_TEXT[f.step as JourneyStep] : "";
  const ms = f.activeMilestone ? ` The active milestone is “${f.activeMilestone.title}”.` : "";
  const changes = f.openChanges.length
    ? ` Open changes: ${f.openChanges.map((c) => `${c.code} ${c.title}`).join(", ")}.`
    : " No open changes right now.";
  return `${lead} ${step}${ms}${buildPart(f)}${changes}`.replace(/\s+/g, " ").trim();
}

const SUGGEST: Record<ChatRole, string> = {
  planner: "the plan and the priorities",
  dev: "what I am building",
  reviewer: "what I am reviewing",
  qa: "how the tests look",
  secops: "what I checked for security",
  docs: "which pages are done",
  shipper: "the release gate or the environments",
};

/** `n` picks between wordings (the message count). Every sentence comes from the facts. */
export function replyFor(topic: ChatTopic, f: ChatFacts, n: number): string {
  let text: string;
  switch (topic) {
    case "task-hint":
      text =
        f.role === "planner"
          ? "Tell me what you need. I'll record it as a task for MADP."
          : "Tell me what you'd like built or changed. I'll hand it to the business analyst so it goes through MADP.";
      break;
    case "thanks":
      text = pick(n, ["Happy to help.", "Anytime."]);
      break;
    case "greeting":
      text = `Hi! I'm the ${roleInText(f.role)} for ${f.projectName}. You can ask me about ${SUGGEST[f.role]}.`;
      break;
    case "blockers":
      text = blockers(f, n);
      break;
    case "release":
      text = releaseText(f);
      break;
    case "plan":
      text = plan(f, n);
      break;
    case "step":
      text = stepReply(f, n);
      break;
    case "working":
      text = workingOn(f);
      break;
  }
  return text.slice(0, MAX_TEXT);
}

export const isBuildActive = (status: string): boolean => BUILD_ACTIVE.has(status);

/** The instant answer to small talk (topicOf), in the agent's voice. `n` picks between wordings (the message count). */
export function smallTalkReply(topic: SmallTalk, o: { role: ChatRole; projectName: string; n: number }): string {
  switch (topic) {
    case "greeting":
      return `Hi! I'm the ${roleInText(o.role)} on ${o.projectName || "this project"}. Ask me anything about ${SUGGEST[o.role]}.`;
    case "thanks":
      return pick(o.n, ["Happy to help.", "Anytime.", "Glad it helps."]);
    case "task-hint":
      return o.role === "planner"
        ? "Sure. Tell me what you need and I'll record it as a task for MADP."
        : "Sure. Tell me what you'd like built or changed, and I'll hand it to the business analyst so it goes through MADP.";
  }
}

// ------------------------------------------------------------------ routing

export type TaskRoute = "change-request" | "suggestion" | "scope-step";

/** After the lock only MADP plans board tickets (decision 21), so new work is a change request. */
export function routeTask(i: { devReleased: boolean; scopeLocked: boolean; step: string }): TaskRoute {
  if (i.scopeLocked) return "change-request";
  if (i.step === "business" || i.step === "sanitization" || i.step === "requirements") return "suggestion";
  return "scope-step";
}

export const ROUTE_PERMISSION = {
  "change-request": "build.run",
  suggestion: "requirements.edit",
} as const;

/** `chat-<12 hex>` from a stable FNV-1a (two seeds) of the user message id; matches Suggestion.Key. */
export function chatSuggestionKey(userMessageId: string): string {
  const fnv = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < userMessageId.length; i++) {
      h ^= userMessageId.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return `chat-${(hex(fnv(0x811c9dc5)) + hex(fnv(0x9747b28c))).slice(0, 12)}`;
}

export const handoffReply = (role: ChatRole): string =>
  role === "planner"
    ? "Got it. I'm recording it for MADP."
    : "That's a task: I'm handing it to the business analyst so it goes through MADP.";

export function createdLine(task: { code: string; title: string }): string {
  return task.code === "Suggestion"
    ? "Added to the MADP suggestions in Requirements."
    : `${task.code} is saved: ${task.title}.`;
}

export const NO_TASK_PERMISSION_REPLY = "You don't have permission to create this task. Ask a workspace admin.";

export const SCOPE_STEP_REPLY =
  "The scope is still open. Leave feedback on the scope item now; after the lock it becomes a change request.";

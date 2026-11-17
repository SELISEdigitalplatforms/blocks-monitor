// Claude-written chat answers (chat.reply, see ../../ai/index.ts): an agent of the 3D office answering in its own
// thread, and the release assistant answering about one environment. Both read the project's records (scope,
// milestones, the board with what each ticket waits for, builds, previews, releases, decisions, recent board events),
// the project context digest and the last messages of the thread. Null: keep the built-in answer.
import type { Row } from "../../../../../functions/_lib/gateway";
import { HUMAN_ROLE, MAX_TEXT, ticketCode, type ChatRole } from "../../../../../src/domain/agentChat";
import { str } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { aiJson } from "../../ai/index.ts";
import { S, markdown, obj, texts } from "../../ai/check.ts";
import { projectMaterial } from "../../ai/material.ts";
import type { CollabFacts, TicketFact } from "./facts.ts";
import { chatFiles } from "./files.ts";
import { acceptAgentAnswer, actionPrompt, actionStateOf, replySchema, type AgentAnswer } from "./actions.ts";
import { availableActions } from "../../../../../src/domain/chatActions";

const COLUMN: Record<string, string> = { planned: "Planned (not started)", dev: "In development", review: "In review", test: "In test", security: "Security check", docs: "Docs", gate: "Release gate", done: "Done" };
const BUILD_STATE: Record<string, string> = { queued: "waiting to start", claimed: "starting", running: "running", succeeded: "finished", failed: "stopped with an error", cancelled: "cancelled" };

const one = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

/** One ticket line: key, title, type, column, what it waits for, a short description. */
function ticketLine(t: TicketFact, codeOf: Map<string, string>, detail: boolean): string {
  const waits = t.dependsOn.map((d) => codeOf.get(d)).filter((c): c is string => Boolean(c));
  // no stored estimate: a ticket's hours were a guess before the real estimates (src/domain/engineEstimate.ts)
  const bits = [COLUMN[t.column] ?? t.column, t.type && t.type !== "story" ? t.type : "", waits.length ? `waits for ${waits.join(", ")}` : "no dependencies"].filter(Boolean);
  const about = detail && t.description ? ` — ${one(t.description, 140)}` : "";
  return `- ${ticketCode(t.number)} ${t.title} [${bits.join("; ")}]${about}`;
}

/** The project's state in a few lines: stage, scope, milestones, board (per milestone), builds, releases, decisions. */
export function stateOf(f: CollabFacts): string {
  const out: string[] = [`Stage: ${f.stage || "not set"}`];
  if (f.objective && str(f.objective.Statement)) out.push(`Objective: ${str(f.objective.Statement)}`);
  if (f.features.length) {
    out.push(`Features in the locked scope:\n${f.features.slice(0, 20).map((x) => `- ${x.title}${x.priority ? ` (${x.priority})` : ""}${x.milestone ? ` (milestone ${x.milestone.number})` : ""}: ${one(x.description, 160)}${x.stories.length ? ` Stories: ${x.stories.slice(0, 4).map((s) => s.title).join("; ")}` : ""}`).join("\n")}`);
  } else if (f.requirements.length) {
    out.push(`Requirements so far:\n${f.requirements.slice(0, 20).map((r) => `- [${str(r.Priority)}] ${str(r.Title)}`).join("\n")}`);
  }
  if (f.milestones.length) out.push(`Milestones:\n${f.milestones.map((m) => `- Milestone ${m.number} ${m.name} (${m.status}): ${one(m.goal, 160)}`).join("\n")}`);
  if (f.tickets.length) {
    const done = f.tickets.filter((t) => t.isDone).length;
    const by = new Map<string, number>();
    for (const t of f.tickets) if (!t.isDone) by.set(t.column, (by.get(t.column) ?? 0) + 1);
    out.push(`Board: ${f.tickets.length} tickets, ${done} done; open: ${[...by].map(([c, n]) => `${n} ${COLUMN[c] ?? c}`).join(", ") || "none"}`);
    const codeOf = new Map(f.tickets.map((t) => [t.id, ticketCode(t.number)]));
    const sorted = [...f.tickets].sort((a, b) => a.number - b.number);
    const groups: { title: string; tickets: TicketFact[] }[] = f.milestones.map((m) => ({ title: `Milestone ${m.number} ${m.name}`, tickets: sorted.filter((t) => t.milestoneId === m.id) }));
    const loose = sorted.filter((t) => !f.milestones.some((m) => m.id === t.milestoneId));
    if (loose.length) groups.push({ title: "Other tickets", tickets: loose });
    let shown = 0;
    for (const g of groups.filter((x) => x.tickets.length)) {
      const lines = g.tickets.slice(0, 16).map((t) => ticketLine(t, codeOf, shown++ < 30));
      out.push(`${g.title} tickets (in board order):\n${lines.join("\n")}`);
    }
  }
  const builds = f.buildJobs.slice(0, 3);
  if (builds.length) {
    out.push(`Builds, newest first:\n${builds.map((b) => `- ${str(b.Kind) === "change.build" ? "change build" : "milestone build"} ${BUILD_STATE[str(b.Status)] ?? str(b.Status)}${str(b.Status) === "running" ? ` at ${Math.round(Number(b.Progress) || 0)} %` : ""}${str(b.Message) ? `: ${one(str(b.Message), 140)}` : ""}${str(b.CreatedDate) ? ` (${str(b.CreatedDate).slice(0, 16).replace("T", " ")})` : ""}`).join("\n")}`);
  } else if (f.tickets.length) {
    out.push("Builds: none has started yet.");
  }
  const previews = f.previews.filter((p) => str(p.Url)).slice(-3);
  if (previews.length) out.push(`Previews:\n${previews.map((p) => `- ${str(p.Version) ? `v${str(p.Version)} ` : ""}${str(p.Status) || "ready"}`).join("\n")}`);
  if (f.releases.length) out.push(`Releases:\n${f.releases.slice(-6).map((r) => `- v${r.version} on ${r.env}${r.releasedAt ? ` (${r.releasedAt.slice(0, 10)})` : ""}`).join("\n")}`);
  if (f.changes.length) out.push(`Change requests:\n${f.changes.slice(-8).map((c) => `- ${c.code} ${c.title} — ${c.status}${c.version ? ` v${c.version}` : ""}`).join("\n")}`);
  const decisions = [...f.decisions, ...f.techDecisions].slice(0, 10);
  if (decisions.length) out.push(`Decisions:\n${decisions.map((d) => `- ${str(d.Title)}: ${one(str(d.Statement) || str(d.Choice), 200)}`).join("\n")}`);
  return out.join("\n\n");
}

/** The latest board events (moves, reviews, test reports, sends back), newest last. */
function recentEvents(events: readonly Row[], f: CollabFacts): string {
  const codeOf = new Map(f.tickets.map((t) => [t.id, ticketCode(t.number)]));
  return [...events]
    .filter((e) => str(e.Text).trim() && !/^Created in Planned:/.test(str(e.Text)))
    .sort((a, b) => str(a.At).localeCompare(str(b.At)))
    .slice(-10)
    .map((e) => `- ${codeOf.get(str(e.TicketId)) ?? "a ticket"}: ${one(str(e.Text), 160)}`)
    .join("\n");
}

const historyOf = (rows: readonly Row[], current: string): string =>
  rows
    .filter((m) => str(m.ItemId) !== current && str(m.Text).trim())
    .sort((a, b) => str(a.At).localeCompare(str(b.At)))
    .slice(-8)
    .map((m) => `${m.Role === "user" ? "Person" : "You"}: ${str(m.Text).replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

export function acceptReply(raw: unknown): string | null {
  const o = obj(raw);
  return o ? markdown(o.answer, MAX_TEXT, 4) : null;
}


/** What each agent of the team does, as the build really runs it (kinds/delivery.ts and build/realBuild.ts). */
const TEAM_WORK: Record<ChatRole, string> = {
  planner: "turns the locked scope into milestones and board tickets, decides the order and what each ticket waits for, and keeps the plan up to date",
  dev: "writes the code of a milestone's tickets on the build's own branch, in the order the plan gives",
  reviewer: "reviews the written code before it is tested: every screen and file the ticket needs is in place, the code is clearly structured and named, errors are handled, and the words people read in the app are plain, finished product wording (no leftover filler text)",
  qa: "runs the production build and checks each ticket against its acceptance criteria; a ticket that fails goes back to development",
  secops: "scans the code for keys, tokens, unsafe code and scripts loaded from other sites, and checks who can see personal data and money flows",
  docs: "updates the user guide and the release notes for what was built",
  shipper: "runs the release gate: the branch is merged into main, the build goes to the preview, and accepted versions go to dev, stage and production",
};
const TEAM_NAME: Record<ChatRole, string> = { planner: "Planner", dev: "Developer", reviewer: "Reviewer", qa: "Tester", secops: "SecOps", docs: "Docs", shipper: "Release gate" };
const teamText = (): string => (Object.keys(TEAM_WORK) as ChatRole[]).map((r) => `- ${TEAM_NAME[r]} (${HUMAN_ROLE[r]}): ${TEAM_WORK[r]}.`).join("\n");

/** Claude's answer in the agent's voice, with at most one offered action (./actions.ts): never a promise of work. */
export async function aiAgentReply(run: JobRun, o: { role: ChatRole; question: Row; facts: CollabFacts; thread: readonly Row[]; events?: readonly Row[] }): Promise<AgentAnswer | null> {
  const m = await projectMaterial(run, { budget: 2500 });
  const actions = actionStateOf(run.p);
  const available = availableActions(actions);
  // the files the person attached to this message and their last few before it (none: the prompt is unchanged)
  const attached = await chatFiles(run, o.question, o.thread);
  const history = historyOf(o.thread, str(o.question.ItemId));
  const events = recentEvents(o.events ?? [], o.facts);
  const prompt = [
    `The client asks you, the ${TEAM_NAME[o.role]}, in the team chat of ${run.p.name}:`,
    `"${str(o.question.Text).slice(0, 1500)}"`,
    "",
    "Answer as that colleague, in the first person: direct, friendly and concrete, two to six sentences. Use the project's records below: name tickets by their key and title (MF-12 “Title”), and features and milestones by their names. When the question asks for a choice or an order, give a clear recommendation and the reason from the records (what a ticket waits for, the milestone goal, the must-haves). If the records do not say, say so honestly. No headings, no code, no jargon; a short list only when it really helps.",
    "",
    actionPrompt(available, actions),
    history ? `\nThe conversation so far:\n${history}` : "",
    ...(attached.block ? [`\n${attached.block}`] : []),
    "",
    `How the team works (each agent's part):\n${teamText()}`,
    "",
    `The project now:\n${stateOf(o.facts)}`,
    events ? `\nLatest on the board:\n${events}` : "",
    "",
    `What the client told us:\n${m.text}`,
  ].join("\n");
  return aiJson(run, {
    task: `chat (${o.role})`,
    ...(attached.images.length ? { images: attached.images } : {}),
    role: `You are the ${TEAM_NAME[o.role]}, the ${HUMAN_ROLE[o.role].toLowerCase()} of the product team building ${run.p.name}: you ${TEAM_WORK[o.role]}.`,
    prompt,
    schema: replySchema(available, actions),
    timeoutMs: attached.block ? 75_000 : 40_000,
    beat: false,
    accept: (raw) => acceptAgentAnswer(raw, available, actions),
  });
}

export interface AssistantPlan {
  text: string;
  points: string[];
}

export function acceptAssistant(raw: unknown): AssistantPlan | null {
  const o = obj(raw);
  const t = o ? markdown(o.answer, 4000, 4) : null;
  return o && t ? { text: t, points: texts(o.points, 8, 300, 3) } : null;
}

const ASSISTANT_SCHEMA = S.obj({
  answer: S.str("Two to five plain sentences."),
  points: S.list(S.str(), 8, "Steps or facts that help, short; empty when not needed."),
});

export async function aiAssistantReply(run: JobRun, o: { env: string; question: Row; facts: CollabFacts; thread: readonly Row[] }): Promise<AssistantPlan | null> {
  const history = historyOf(o.thread, str(o.question.ItemId));
  const prompt = [
    `A person asks about ${run.p.name} as it runs on ${o.env}:`,
    `"${str(o.question.Text).slice(0, 1500)}"`,
    "",
    `Answer from the records below: what runs on ${o.env} (the newest release there), how a feature works (its stories and checks), and what is still being built. If it is not released to ${o.env} yet, say so and where it stands. Plain words, two to five sentences; "points" are short steps or facts when they help.`,
    history ? `\nThe conversation so far:\n${history}` : "",
    "",
    `The project now:\n${stateOf(o.facts)}`,
  ].join("\n");
  return aiJson(run, {
    task: "assistant answer",
    role: `You are the product assistant of ${run.p.name}: you explain the product to the people who use and run it.`,
    prompt,
    schema: ASSISTANT_SCHEMA,
    timeoutMs: 40_000,
    beat: false,
    accept: acceptAssistant,
  });
}

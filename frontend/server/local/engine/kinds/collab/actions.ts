// The one action an agent's chat answer may offer (src/domain/chatActions.ts): which actions the project allows right
// now (from its records), the part of Claude's answer schema and prompt about them, the check of the answer (no
// promised work; a known target), and the offer message the writer stores under the answer. Pure, except reading the
// project view.
import type { Row } from "../../../../../functions/_lib/gateway";
import { MAX_TEXT, type ChatRole } from "../../../../../src/domain/agentChat";
import {
  ACTION_BUTTON,
  ACTION_DOES,
  isChatAction,
  offerTarget,
  promisesIn,
  tapLine,
  targetsFor,
  type ActionState,
  type ChatActionKind,
  type NamedTarget,
} from "../../../../../src/domain/chatActions";
import { effectiveStep } from "../../../../../src/domain/projects";
import { str } from "../../context.ts";
import type { ProjectView } from "../../context.ts";
import { S, markdown, obj } from "../../ai/check.ts";
import { parseStreamsAdvice, suggestStreams } from "../../../../../src/domain/parallelStreams";
import { CONTINUE_LABEL, continueOn } from "../../../../../src/domain/continueIncrements";
import { streamChangeOf } from "../../streams.ts";

/** What the project allows to offer right now. */
export function actionStateOf(p: ProjectView): ActionState {
  const step = effectiveStep(str(p.project.Stage), str(p.project.ResumeTo) || undefined);
  const version = p.scopeVersionRow();
  const scopeOpen = step === "scope" && (!version || str(version.Status) !== "locked");
  const named = (r: Row, field: string): NamedTarget => ({ id: str(r.ItemId), name: str(r[field]).replace(/\s+/g, " ").trim() });
  const ok = (t: NamedTarget) => Boolean(t.id && t.name);
  return {
    released: p.releases("dev").length > 0,
    scopeOpen,
    screens: p.screens().map((s) => named(s, "Name")).filter(ok),
    scopeItems: scopeOpen
      ? [
          ...p.includedFeatures().map((r) => ({ ...named(r, "Title"), type: "feature" as const })),
          ...p.milestones().map((r) => ({ ...named(r, "Name"), type: "milestone" as const })),
        ].filter(ok)
      : [],
    previews: p.milestones().filter((m) => str(m.Status) === "preview-ready").map((m) => named(m, "Name")).filter(ok),
    // change requests are built once the first release is on dev: how many build side by side can be set from the chat
    streams: p.releases("dev").length > 0,
  };
}

/** The offer of an answer: what the tap does and to what. */
export interface ChatOffer {
  kind: ChatActionKind;
  title: string;
  /** What will be sent (the change request's request text, the comment, the preview feedback). */
  details: string;
  target: NamedTarget | null;
  /** The scope item's type for add-to-scope (feature or milestone). */
  targetType: "screen" | "feature" | "story" | "milestone" | "";
}

export interface AgentAnswer {
  text: string;
  offer: ChatOffer | null;
}

const WHAT: Record<ChatActionKind, string> = {
  "change-request": "a change request, sent to the product manager for analysis (for changes to the built and released app)",
  "preview-fix": "feedback on a milestone's preview that is ready, as a fix ticket for the development team (target: the milestone)",
  "update-design": "the person's request as their comment on one screen of the design (target: the screen)",
  "add-to-scope": "the person's request as their comment on one feature or milestone of the scope draft (target: that item)",
  "parallel-streams": "how many independent change requests the team builds side by side, 1 to 5 (target: the number); the system sets it only up to the tech lead's suggestion and only for people who run builds",
  "continue-increments": "whether the next increment of a feature starts by itself once its checks pass on development (target: on or off)",
};

/** The prompt lines about actions (the hard rule comes first, whatever is available). */
export function actionPrompt(available: readonly ChatActionKind[], s: ActionState): string {
  const lines = [
    "Hard rules: you cannot add, create, change, post, send, plan or build anything yourself from this chat, and nothing happens because you write it. Never say that you will do or did something (no \"I'll add\", \"I've added\", \"I'll create a ticket\", \"let me update\"). Never invent a way to get it done.",
  ];
  if (!available.length) {
    lines.push("No action can be offered in this chat right now: when the person asks for work, say plainly where in the app they can ask for it, and set action.kind to \"none\".");
    return lines.join("\n");
  }
  lines.push(
    "When the person asks for work (a change, a fix, feedback to carry out), offer exactly ONE of these actions in \"action\"; the person taps a button and the system does it as them. The system adds the sentence about the button to your answer, so do not write it yourself. Offer only these:",
    ...available.map((k) => {
      const names = targetsFor(k, s).map((t) => t.name).slice(0, 30);
      return `- "${k}": ${WHAT[k]}; the button is "${ACTION_BUTTON[k]}" and it will ${ACTION_DOES[k]}.${names.length ? ` Targets: ${names.map((n) => `“${n}”`).join(", ")}.` : ""}`;
    }),
    "For an action: \"title\" is a clean short title of the work written from the whole conversation (not a copy of the last message), \"details\" says in full what to change and how it should look or work, from everything the person said about it in this conversation (and comments they left on the item), in their words where possible, and \"target\" is the exact name of the screen, milestone or scope item it is about (empty for a change request). When the person only asks a question, set action.kind to \"none\".",
  );
  return lines.join("\n");
}

/** The answer schema: the answer and the one action (kind "none" when nothing is offered). */
export function replySchema(available: readonly ChatActionKind[], s: ActionState): object {
  const names = [...new Set(available.flatMap((k) => targetsFor(k, s).map((t) => t.name)))].slice(0, 120);
  return S.obj({
    answer: S.str("The answer: two to six sentences in plain words, at most 900 characters."),
    action: S.obj({
      kind: S.enum(["none", ...available]),
      title: S.str("A short title of the work, at most 80 characters; empty for none."),
      details: S.str("What to change, in full, at most 1500 characters; empty for none."),
      target: names.length ? S.enum(["", ...names]) : S.str("Always empty."),
    }),
  });
}

const one = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

/** Claude's answer as text and offer; a thrown Error says why it is not usable (aiJson retries once, then the built-in
 *  answer is used). An answer that promises work is never used. */
export function acceptAgentAnswer(raw: unknown, available: readonly ChatActionKind[], s: ActionState): AgentAnswer {
  const o = obj(raw);
  const answer = o ? markdown(o.answer, MAX_TEXT, 4) : null;
  if (!o || !answer) throw new Error("no usable answer");
  const promised = promisesIn(answer);
  if (promised.length) throw new Error(`the answer promises work the chat cannot do: "${one(promised[0]!, 80)}"`);
  const a = obj(o.action);
  const kind = a && isChatAction(a.kind) && available.includes(a.kind) ? a.kind : null;
  if (!kind) return { text: answer, offer: null };

  const title = one(typeof a!.title === "string" ? a!.title : "", 120);
  const details = typeof a!.details === "string" ? a!.details.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, 1800) : "";
  if (!title || !details) throw new Error("an action needs a title and details");
  const want = typeof a!.target === "string" ? a!.target.trim().toLowerCase() : "";
  const targets = targetsFor(kind, s);
  const target = targets.length ? targets.find((t) => t.name.toLowerCase() === want) ?? null : null;
  if (kind !== "change-request" && !target) throw new Error(`the ${kind} action names no known target`);
  const targetType = kind === "update-design" ? "screen" : kind === "add-to-scope" ? (s.scopeItems.find((x) => x.id === target!.id)?.type ?? "feature") : "";
  // the button sentence is the system's (always true); any "tap" sentence of the answer is replaced by it
  const body = answer.split(/(?<=[.!?])\s+/).filter((x) => !/^tap\b/i.test(x.trim())).join(" ").trim();
  const text = `${body}${body ? " " : ""}${tapLine(kind)}`.slice(0, MAX_TEXT);
  return { text, offer: { kind, title, details, target, targetType } };
}

/** The offer message stored right after the answer (an agent message, Kind "text", TaskTarget "offer:<kind>"). */
export function offerRow(role: ChatRole, offer: ChatOffer, o: { jobId: string; at: string }): Row {
  return {
    AgentRole: role,
    Role: "agent",
    Kind: "text",
    Text: offer.details.slice(0, MAX_TEXT),
    AuthorUserId: "",
    TaskTarget: offerTarget(offer.kind),
    TaskId: "",
    TaskCode: "",
    TaskTitle: offer.title,
    TaskLane: offer.targetType,
    TaskFeatureRef: offer.target?.id ?? "",
    EngineJobId: o.jobId,
    At: o.at,
  };
}

/** The tech lead's answer to "use 3 parallel streams" (src/domain/chatActions.ts streamsAsked), without a model: the
 *  suggestion and its reason from the records, and the offer that sets it as the person (cr.parallelStreams checks the
 *  right and the suggestion again). A number above the suggestion is offered at the suggestion, and the answer says
 *  why. */
export function streamsAnswer(p: ProjectView, asked: number): AgentAnswer {
  const changes = p.rows("ChangeRequest").filter((c) => c.IsDeleted !== true).map(streamChangeOf);
  const s = suggestStreams({ changes, advice: parseStreamsAdvice(p.project.StreamsAdvice) });
  const n = Math.min(asked, s.suggested);
  const lower = n < asked;
  const what = n === 1 ? "one change request at a time" : `up to ${n} independent change requests side by side`;
  const body = lower
    ? `I suggest at most ${s.suggested} for ${p.name} right now: ${s.reason.replace(/\.$/, "")}. So I'd build ${what}; each one still lands on development on its own, with its checks.`
    : `${n === 1 ? "Fine" : "Good idea"}: ${p.name} can build ${what}; each one still lands on development on its own, with its checks, and a change that touches the same code as a running one waits for it. ${s.reason}`;
  const text = `${body} ${tapLine("parallel-streams")}`.slice(0, MAX_TEXT);
  return {
    text,
    offer: {
      kind: "parallel-streams",
      title: n === 1 ? "Build one change request at a time" : `Use ${n} parallel streams`,
      details: n === 1 ? "One change request is built at a time." : `Up to ${n} independent change requests are built side by side; each still lands on development on its own.`,
      target: { id: String(n), name: String(n) },
      targetType: "",
    },
  };
}

/** The tech lead's answer to "continue with the next increment automatically" (or "stop continuing by itself")
 *  (src/domain/continueIncrements.ts continueAsked), without a model: what it means and the one offer that sets it as the
 *  person (cr.continueIncrements checks the right). */
export function continueAnswer(p: ProjectView, on: boolean): AgentAnswer {
  const now = continueOn(p.project.ContinueIncrements);
  const body = on
    ? `${now ? "It is on already" : "Good idea"}: once an increment of a feature passes its checks on development, I start the next one of the same change by myself, never past the last one and never when the checks fail or could not judge it. Cancel a next increment that started by itself to pause that change.`
    : `${now ? "Fine" : "It is off already"}: every next increment then waits for someone to start it, also when the checks of the one before pass.`;
  return {
    text: `${body} ${tapLine("continue-increments")}`.slice(0, MAX_TEXT),
    offer: {
      kind: "continue-increments",
      title: on ? "Continue with the next increment when the checks pass" : "Start every next increment by hand",
      details: on ? `${CONTINUE_LABEL}: on.` : `${CONTINUE_LABEL}: off.`,
      target: { id: on ? "on" : "off", name: on ? "on" : "off" },
      targetType: "",
    },
  };
}
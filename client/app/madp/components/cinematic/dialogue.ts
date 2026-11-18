/**
 * The conversation of the cinematic new project as a pure state machine. The agent's lines are scripted guidance (the
 * questions it asks); everything the visitor types is real and becomes the real project: the name, the type and the
 * brief as the project's first note (scratchMd). When the engine's chat.reply job is connected, `lineFor` is where the
 * agent's live replies come in. No React or DOM imports (unit-tested in test/cinematic.test.ts, test/cinematic-flow.test.ts).
 *
 * The walk never waits for the network: confirming starts project.create AND the walk to the product team at once.
 * `create` tracks the request apart from the walk (`phase`); the product team's door opens only once the project
 * exists, a failure is shown wherever the visitor is, with "Try again" (same requestId: idempotent) or "Change
 * something" (an edit at the door; a changed name or brief gets a new requestId). Nothing typed is ever lost.
 *
 * Step 2: in the product team's room the business analyst offers the real hand-over (business.handOver). Done, the walk continues
 * to the team's board and the app opens Product sanitization / Existing product analysis. A brownfield project must
 * name its repository on the Business step first, and someone without business.edit cannot hand over: both go to the
 * Business step instead.
 */
import { checkNoteBody, NOTE_BODY_MAX } from "@/madp/domain/docs";
import { checkProjectName } from "@/madp/domain/projects";
import type { CinematicType, PathKey } from "./journeyScenes";
import { t } from "@/madp/i18n";

export type Phase =
  | "choose" // in the lobby, picking the project type
  | "entering" // walking into the room
  | "greet"
  | "name"
  | "brief"
  | "confirm"
  | "leaving" // walking to the product team's door (the project is being created meanwhile)
  | "door" // at the door: the visitor knocks once the project exists
  | "edit" // after a failed create: name and brief side by side, wherever the visitor is
  | "through" // walking in
  | "team" // with the business analyst: hand over now, or the Business step first
  | "onward" // handed over: walking on to the team's board (step 2)
  | "done"; // leaving the 3D world for the app (see `exit`)

/** The project.create request, apart from where the visitor is. */
export type CreateStatus = "idle" | "pending" | "created" | "failed";
/** The business.handOver request in the product team's room. */
export type HandOverStatus = "idle" | "pending" | "failed";
/** Where the walk ends in the app. */
export type Exit = "business" | "sanitization";

export interface CineState {
  phase: Phase;
  type: CinematicType | null;
  name: string;
  brief: string;
  /** a problem with what was typed, or why the create / hand-over failed */
  error: string | null;
  projectId: string | null;
  create: CreateStatus;
  /** the create attempt's requestId: kept for a retry of the same input, dropped when the input changes */
  requestId: string | null;
  /** the walk out has reached the door (an edit after a failure returns there) */
  atDoor: boolean;
  handOver: HandOverStatus;
  exit: Exit | null;
}

export const INITIAL: CineState = {
  phase: "choose", type: null, name: "", brief: "", error: null, projectId: null,
  create: "idle", requestId: null, atDoor: false, handOver: "idle", exit: null,
};

export type CineEvent =
  | { t: "choose"; type: CinematicType }
  | { t: "arrived" }
  | { t: "continue" }
  | { t: "name"; value: string }
  | { t: "brief"; value: string }
  /** `requestId`: a fresh id the create uses unless this input already has one */
  | { t: "submit"; requestId?: string }
  | { t: "back" }
  | { t: "created"; projectId: string }
  | { t: "failed"; message: string }
  | { t: "retry" }
  | { t: "knock" }
  | { t: "handOver" }
  | { t: "handedOver" }
  | { t: "handOverFailed"; message: string }
  | { t: "toBusiness" };

export const nameError = () => t("studio.cinematic.dialogue.nameError", "Enter a name of 1 to 80 characters, without control characters.");
export const briefEmpty = () => t("studio.cinematic.dialogue.briefEmpty", "Tell the agent a few words about what you want to build.");
export const briefTooLong = () => t("studio.cinematic.dialogue.briefTooLong", "Keep it under {max} characters.", { max: NOTE_BODY_MAX.toLocaleString("en-GB") });

export function nameProblem(name: string): string | null {
  return checkProjectName(name).ok ? null : nameError();
}

export function briefProblem(brief: string): string | null {
  if (!brief.trim()) return briefEmpty();
  return checkNoteBody(brief.trim()).ok ? null : briefTooLong();
}

/** Phases in which the name and the brief can change (never while a create is pending or after it succeeded). */
const EDITABLE: ReadonlySet<Phase> = new Set(["name", "brief", "confirm", "edit"]);
const canEdit = (s: CineState) => EDITABLE.has(s.phase) && s.create !== "pending" && s.create !== "created";

/** A changed input is a new attempt: it gets a new requestId; the same input keeps its id (a retry is idempotent). */
function edited(s: CineState, patch: { name?: string; brief?: string }): CineState {
  const next = { ...s, ...patch, error: null };
  const changed = next.name !== s.name || next.brief !== s.brief;
  return changed ? { ...next, requestId: null } : next;
}

/** confirm (or an edit after a failure): the create starts now; the walk out starts or carries on */
function startCreate(s: CineState, requestId: string | undefined): CineState {
  return {
    ...s,
    phase: s.atDoor ? "door" : "leaving",
    create: "pending",
    requestId: s.requestId ?? requestId ?? null,
    error: null,
  };
}

export function reduce(s: CineState, e: CineEvent): CineState {
  switch (e.t) {
    case "choose":
      return s.phase === "choose" ? { ...s, phase: "entering", type: e.type } : s;
    case "arrived":
      if (s.phase === "entering") return { ...s, phase: "greet" };
      if (s.phase === "leaving") return { ...s, phase: "door", atDoor: true };
      // a failure on the way out: the edit stays open, the visitor is at the door when it is sent
      if (s.phase === "edit") return { ...s, atDoor: true };
      if (s.phase === "through") return { ...s, phase: "team" };
      if (s.phase === "onward") return { ...s, phase: "done", exit: "sanitization" };
      return s;
    case "continue":
      return s.phase === "greet" ? { ...s, phase: "name" } : s;
    case "name":
      return canEdit(s) ? edited(s, { name: e.value }) : s;
    case "brief":
      return canEdit(s) ? edited(s, { brief: e.value }) : s;
    case "submit": {
      if (s.phase === "name") {
        const problem = nameProblem(s.name);
        return problem ? { ...s, error: problem } : { ...s, phase: "brief", error: null };
      }
      if (s.phase === "brief") {
        const problem = briefProblem(s.brief);
        return problem ? { ...s, error: problem } : { ...s, phase: "confirm", error: null };
      }
      if (s.phase === "confirm") return startCreate(s, e.requestId);
      if (s.phase === "edit") {
        const problem = nameProblem(s.name) ?? briefProblem(s.brief);
        return problem ? { ...s, error: problem } : startCreate(s, e.requestId);
      }
      return s;
    }
    case "back":
      if (s.phase === "brief" || s.phase === "confirm") return { ...s, phase: "name", error: null };
      // "Change something" after a failed create: edit right where the visitor is
      if (s.create === "failed" && (s.phase === "leaving" || s.phase === "door")) return { ...s, phase: "edit", error: null };
      // leaving the edit unchanged: back to the failure, wherever the walk is
      if (s.phase === "edit") return { ...s, phase: s.atDoor ? "door" : "leaving" };
      return s;
    case "created":
      return s.create === "pending" ? { ...s, create: "created", projectId: e.projectId, error: null, requestId: null } : s;
    case "failed":
      return s.create === "pending" ? { ...s, create: "failed", error: e.message } : s;
    case "retry":
      return s.create === "failed" && (s.phase === "leaving" || s.phase === "door") ? { ...s, create: "pending", error: null } : s;
    case "knock":
      return s.phase === "door" && s.create === "created" ? { ...s, phase: "through" } : s;
    case "handOver":
      return s.phase === "team" && s.handOver !== "pending" ? { ...s, handOver: "pending", error: null } : s;
    case "handedOver":
      return s.phase === "team" && s.handOver === "pending" ? { ...s, phase: "onward", handOver: "idle", error: null } : s;
    case "handOverFailed":
      return s.phase === "team" && s.handOver === "pending" ? { ...s, handOver: "failed", error: e.message } : s;
    case "toBusiness":
      return s.phase === "team" && s.handOver !== "pending" ? { ...s, phase: "done", exit: "business" } : s;
  }
}

/** Which walk the camera is on in each phase; it walks only when this changes. */
export function pathKeyFor(phase: Phase, exit: Exit | null = null): PathKey {
  switch (phase) {
    case "choose":
      return "lobby";
    case "leaving":
    case "door":
    case "edit":
      return "leave";
    case "through":
    case "team":
      return "through";
    case "onward":
      return "onward";
    case "done":
      return exit === "sanitization" ? "onward" : "through";
    default:
      return "enter";
  }
}

/** Which spoken moment a phase belongs to: walking out and waiting at the door are one moment, so are walking on to
 *  the board and leaving for step 2; a line is typed (and spoken) once per moment, not again when only the walk moves on. */
export function momentOf(phase: Phase, exit: Exit | null): string {
  if (phase === "leaving" || phase === "door") return "out";
  if (phase === "onward" || (phase === "done" && exit === "sanitization")) return "onward";
  if (phase === "through" || phase === "team") return "team";
  return phase;
}

/** What goes to project.create: the visitor's own words, nothing invented. */
export function createArgs(s: CineState): { name: string; scratchMd: string; projectType: CinematicType } {
  if (!s.type) throw new Error("createArgs: no project type chosen");
  return { name: s.name.trim(), scratchMd: s.brief.trim(), projectType: s.type };
}

/** The door opens only for a project that exists. */
export function doorOpen(s: CineState): boolean {
  return s.create === "created" && s.projectId !== null;
}

/** "Use the form" and "Close" stay off while a write is in flight (leaving then could duplicate or orphan it). */
export function busy(s: CineState): boolean {
  return s.create === "pending" || s.handOver === "pending";
}

/** What the business analyst can offer in step 2's room. */
export type TeamChoice = "handOver" | "repoFirst" | "businessOnly";

/** Hand over now (greenfield, with business.edit), name the repository first (brownfield: MADP analyses the existing
 *  product from it; the walk does not ask for it), or, without business.edit, only the Business step. */
export function teamChoice(type: CinematicType | null, canHandOver: boolean): TeamChoice {
  if (!canHandOver) return "businessOnly";
  return type === "brownfield" ? "repoFirst" : "handOver";
}

/* ── the cast and the script ─────────────────────────────────────────────── */

export interface CastMember { name: string; role: string; initials: string }

/** Owner, 24.10.2026: the business agent hosts the coffee shop and the meeting room. Owner, 08.11.2026: no invented
 *  human names presented as people; the business agent and the business analyst (the role that plans and analyses with
 *  the client) are shown by role. Initials "AG" keep the business agent apart from the business analyst's "BA". */
const BUSINESS_AGENT: CastMember = {
  get name() { return t("studio.cinematic.hosts.businessAgent", "Business agent"); },
  get role() { return t("studio.cinematic.hosts.businessAgent", "Business agent"); },
  initials: "AG",
};
export const HOST: Record<CinematicType, CastMember> = { greenfield: BUSINESS_AGENT, brownfield: BUSINESS_AGENT };
export const PRODUCT_LEAD: CastMember = {
  get name() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); },
  get role() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); },
  initials: "BA",
};

export interface Line { who: CastMember; text: string }

const excerpt = (text: string, max = 140) => {
  const one = text.trim().replace(/\s+/g, " ");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** The scripted line for the phase; null while there is nobody to talk to (lobby, walking in). `nextStepLabel` is the
 *  step-2 name for the type; `choice` what the business analyst can offer (see teamChoice). */
export function lineFor(s: CineState, nextStepLabel: string, choice: TeamChoice = "handOver"): Line | null {
  if (!s.type) return null;
  const host = HOST[s.type];
  const green = s.type === "greenfield";
  const name = s.name.trim();
  switch (s.phase) {
    case "greet":
      return {
        who: host,
        text: green
          ? t("studio.cinematic.dialogue.greetNew", "Hi, I'm MADP's business agent. Grab a coffee — let's talk about the product you want to build.")
          : t("studio.cinematic.dialogue.greetExisting", "Welcome in, I'm MADP's business agent. You have a product already — let's talk about what should change."),
      };
    case "name":
      return { who: host, text: green ? t("studio.cinematic.dialogue.askNameNew", "First things first: what should we call this project?") : t("studio.cinematic.dialogue.askNameExisting", "What should we call this change project?") };
    case "brief":
      return {
        who: host,
        text: green
          ? t("studio.cinematic.dialogue.askBriefNew", "Now tell me what you want to build: who it is for, the problem it solves, and what a good first version does.")
          : t("studio.cinematic.dialogue.askBriefExisting", "Tell me about the product as it is today and what should change: who uses it, what hurts, and what good looks like."),
      };
    case "confirm":
      return { who: host, text: t("studio.cinematic.dialogue.confirm", "Here is what I'll take to the product team — “{name}”: {brief} Shall I open the project?", { name, brief: excerpt(s.brief) }) };
    case "edit":
      return { who: host, text: t("studio.cinematic.dialogue.edit", "Change what you like, then send it again. Nothing was saved yet.") };
    case "leaving":
    case "door":
      if (s.create === "failed") return { who: host, text: t("studio.cinematic.dialogue.createFailed", "That did not go through. Nothing was saved; we can try again, or change something first.") };
      if (s.create === "created") {
        return {
          who: host,
          text: green
            ? t("studio.cinematic.dialogue.createdNew", "Done — “{name}” is open, and your words are its first note. {next} happens next door, with the product team.", { name, next: nextStepLabel })
            : t("studio.cinematic.dialogue.createdExisting", "Done — “{name}” is open, and your words are its first note. {next} happens next door, with the product team. You can connect the GitHub repository in Project setup.", { name, next: nextStepLabel }),
        };
      }
      return s.phase === "door"
        ? { who: host, text: t("studio.cinematic.dialogue.nearlyThere", "Nearly there — I'm still setting up “{name}”. {next} happens behind this door.", { name, next: nextStepLabel }) }
        : { who: host, text: t("studio.cinematic.dialogue.settingUp", "I'm setting up “{name}” now — head through the back door to the product team. {next} happens next door.", { name, next: nextStepLabel }) };
    case "through":
    case "team":
      if (s.handOver === "failed") return { who: PRODUCT_LEAD, text: t("studio.cinematic.dialogue.handOverFailed", "The project analysis could not be started. The project is safe as it is; try again, or open Project setup.") };
      if (choice === "repoFirst") {
        return {
          who: PRODUCT_LEAD,
          text: t("studio.cinematic.dialogue.repoFirst", "Welcome, I'm your business analyst. {next} starts from your code: connect the product's GitHub repository in Project setup, then start the project analysis.", { next: nextStepLabel }),
        };
      }
      if (choice === "businessOnly") {
        return { who: PRODUCT_LEAD, text: t("studio.cinematic.dialogue.businessOnly", "Welcome, I'm your business analyst. Project setup is next: add what we should know, then a teammate starts the project analysis.") };
      }
      return {
        who: PRODUCT_LEAD,
        text: t("studio.cinematic.dialogue.handOver", "Welcome, I'm your business analyst. In {next} we turn your brief into clear needs: questions, decisions and the technical direction. Start the project analysis now and we begin, or add more in Project setup first.", { next: nextStepLabel }),
      };
    case "onward":
      return { who: PRODUCT_LEAD, text: t("studio.cinematic.dialogue.onward", "It's with us now. Your brief is on our board — we start {next} with the open questions.", { next: nextStepLabel }) };
    case "done":
      return s.exit === "sanitization"
        ? { who: PRODUCT_LEAD, text: t("studio.cinematic.dialogue.onward", "It's with us now. Your brief is on our board — we start {next} with the open questions.", { next: nextStepLabel }) }
        : { who: PRODUCT_LEAD, text: t("studio.cinematic.dialogue.toBusiness", "Welcome, I'm your business analyst. Add what we should know in Project setup; we take it from there.") };
    default:
      return null;
  }
}

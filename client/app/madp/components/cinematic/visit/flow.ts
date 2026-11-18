/** The office visit's flow, pure (no React, no store): which step of the app the visit is at, where in the office that
 *  happens, how the step indicator reads and where leaving lands. The office walks the app's own steps in the app's
 *  own order, with the app's own names, and never one of its own:
 *   Project Setup (the MADP Assistant, at reception): the guided start's questions (what kind of product, its name and
 *     description, the website of a product that is already live, where the code lives, "create"), then the Project
 *     setup page's Material and "Start project analysis" (the hand-over);
 *   Business Analysis (the business analyst, at the meeting table): the analyst's checklist, in its order
 *     (analysis-next ANALYST_ITEMS: objective and users, what I understood, a few questions, the requirements, the scope);
 *   after the scope is locked: Software Engineering (the Build page).
 *  Every state comes from the project's records (the same rules as the Project setup and Business Analysis pages); the
 *  only thing kept here is the draft of the guided start's answers before the project exists. */
import { ANALYST_ITEMS, type AnalystItem } from "@/madp/components/analysis-next/model";
import type { ChecklistState } from "@/madp/components/analysis/pm/pmModel";
import { checkProjectName } from "@/madp/domain/projects";
import { checkWebsite, type StartAnswers } from "@/madp/domain/guidedStart";
import { stepIndex, type JourneyStep } from "@/madp/domain/journey";

/* ── the steps ───────────────────────────────────────────────────────────── */

/** Project Setup as the Project setup page shows it: its three chips (About, Code, Material) and its sign-off, "Start
 *  project analysis". The guided start's questions belong to About and Code until the project exists. */
export type SetupItem = "about" | "where" | "share" | "handOver";
export const SETUP_ITEMS: readonly SetupItem[] = ["about", "where", "share", "handOver"];

/** What the office asks in Project Setup. Before the project exists: the guided start's steps (kind; about = name,
 *  description and, for a product that is live, its website; where; ready = create). After: Material, then the hand-over. */
export type SetupAsk = "kind" | "name" | "description" | "website" | "where" | "ready" | "material" | "handOver";

/** The guided start's answers while the project does not exist yet, and what the person already went past. */
export interface SetupDraft {
  answers: StartAnswers;
  /** the website question of a product that is live was answered (an empty answer is fine: it is optional) */
  websiteDone: boolean;
  /** "where the code lives" was confirmed */
  whereDone: boolean;
  /** the description was given (any real answer) or set aside */
  aboutDone?: boolean;
}

/** The project as the office needs it (a ProjectRecord has all of these). */
export interface FlowProject {
  id: string;
  step: JourneyStep;
  handedOverAt: string | null;
  status?: string;
}

/** The step of Project Setup to ask now. `shared`: what the client shared so far (the setup page's Material count);
 *  `materialPassed`: the person said "no files for now" or finished sharing in this visit. */
export function setupAskOf(draft: SetupDraft, project: FlowProject | null, shared = 0, materialPassed = false): SetupAsk | null {
  if (project) {
    if (project.step !== "business" || project.handedOverAt) return null;
    return shared > 0 || materialPassed ? "handOver" : "material";
  }
  const a = draft.answers;
  if (!a.kind) return "kind";
  if (!checkProjectName(a.name).ok) return "name";
  if (!draft.aboutDone) return "description";
  if (a.kind === "existing" && (!draft.websiteDone || !checkWebsite(a.website).ok)) return "website";
  if (!draft.whereDone) return "where";
  return "ready";
}

/** "skipped": the visitor went past it (no files for now); it can still be done in the app any time */
export type ItemState = "done" | "now" | "open" | "later" | "skipped";

/** The Project Setup checklist as the indicator shows it. `codeDone`: the setup page's Code chip is ticked. */
export function setupStates(i: { ask: SetupAsk | null; created: boolean; codeDone: boolean; shared: number; handedOver: boolean }): Record<SetupItem, ItemState> {
  const { ask } = i;
  const aboutAsks: (SetupAsk | null)[] = ["kind", "name", "description", "website"];
  return {
    about: i.created ? "done" : aboutAsks.includes(ask) ? "now" : "later",
    where: i.created ? (i.codeDone ? "done" : "open") : ask === "where" || ask === "ready" ? "now" : "later",
    share: i.shared > 0 ? "done" : ask === "material" ? "now" : i.handedOver || ask === "handOver" ? "skipped" : i.created ? "open" : "later",
    handOver: i.handedOver ? "done" : ask === "handOver" ? "now" : "later",
  };
}

/** The analyst's checklist in the office: the app's states (analysis-next analystChecklistStates), each item a
 *  conversation. An item the person picked wins; otherwise the first item in the checklist's order that is still to
 *  do ("now", or "open": an earlier item not done while the project already works on a later one), else the last one
 *  done. Nothing is skipped: an open earlier item comes before the later one, unless the person set it aside ("later")
 *  in this visit; then it waits until the rest is done. */
export function analysisItemOf(states: Record<AnalystItem, ChecklistState>, picked: AnalystItem | null = null, aside: ReadonlySet<AnalystItem> = new Set()): AnalystItem {
  if (picked && states[picked] !== "later" && states[picked] !== "skipped") return picked;
  // what the person set aside in this visit ("later") waits until the rest is done; it stays "still open" on the list
  const todo = ANALYST_ITEMS.filter((it) => states[it] === "now" || states[it] === "open");
  const next = todo.find((it) => !aside.has(it)) ?? todo.find((it) => states[it] === "now") ?? todo[0];
  if (next) return next;
  const done = [...ANALYST_ITEMS].reverse().find((it) => states[it] === "done");
  return done ?? ANALYST_ITEMS[0];
}

/** The indicator's state of an analyst item (the app's states; "skipped" never happens in a visit). */
export function analysisIndicator(states: Record<AnalystItem, ChecklistState>, at: AnalystItem): Record<AnalystItem, ItemState> {
  const out = {} as Record<AnalystItem, ItemState>;
  for (const it of ANALYST_ITEMS) {
    const s = states[it];
    out[it] = s === "done" ? "done" : it === at ? "now" : s === "now" || s === "open" ? "open" : "later";
  }
  return out;
}

/* ── where it happens ────────────────────────────────────────────────────── */

export type OfficePhase = "setup" | "analysis" | "engineering";
export type OfficePlace = "reception" | "meeting" | "buildfloor";

/** The phase a project is in (no project yet: Project Setup). */
export function phaseOfProject(project: FlowProject | null): OfficePhase {
  if (!project || project.step === "business") return "setup";
  return stepIndex(project.step) >= stepIndex("board") ? "engineering" : "analysis";
}

/** Project Setup happens at reception with the MADP Assistant, Business Analysis at the meeting table with the business
 *  analyst; once the scope is locked the visit ends on the build floor. */
export const PLACE_OF_PHASE: Record<OfficePhase, OfficePlace> = { setup: "reception", analysis: "meeting", engineering: "buildfloor" };

/** Who speaks in a phase. */
export const SPEAKER_OF_PHASE: Record<OfficePhase, "assistant" | "pm"> = { setup: "assistant", analysis: "pm", engineering: "pm" };

/* ── leaving and coming back ─────────────────────────────────────────────── */

/** The app's page of the step the project is at: leaving the office lands there, with everything already in it. */
export function leaveUrl(project: FlowProject | null): string {
  if (!project) return "/new";
  const phase = phaseOfProject(project);
  if (phase === "setup") return `/p/${project.id}/business`;
  if (phase === "analysis") return `/p/${project.id}/analysis`;
  return `/p/${project.id}/build`;
}

/** The project to continue in the office: the one asked for (?project=), else none (a new visit). */
export function resumeIdOf(search: string): string | null {
  const id = new URLSearchParams(search).get("project")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

/** Projects that can be continued in the office: before the scope is locked, not being deleted, most recent first. */
export function continuable<P extends FlowProject & { lastUpdatedDate?: string; createdDate?: string }>(projects: readonly P[], max = 3): P[] {
  return projects
    .filter((p) => p.status !== "deleting" && stepIndex(p.step) < stepIndex("board"))
    .slice()
    .sort((a, b) => (b.lastUpdatedDate ?? b.createdDate ?? "").localeCompare(a.lastUpdatedDate ?? a.createdDate ?? ""))
    .slice(0, max);
}

/* ── "Next for you", for the item the conversation is at ─────────────────── */

export interface NextWords { title: string; detail: string }

/** "Next for you" on the step list says what the conversation is doing now, so the two never disagree: the analysis
 *  page's own next action when it is about this item (or about nothing in particular: the analyst is working), else
 *  the page's own words for this item. */
export function nextForItem(item: AnalystItem, next: { item: AnalystItem | null; title: string; detail: string; blockedBecause?: string; working?: boolean },
  words: Record<AnalystItem, NextWords>): NextWords {
  if (next.item === item || (next.item === null && next.working)) return { title: next.title, detail: next.blockedBecause ?? next.detail };
  return words[item];
}

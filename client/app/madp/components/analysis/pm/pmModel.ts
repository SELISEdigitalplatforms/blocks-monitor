/** The business analyst's panel (left column of Business Analysis): which checklist item is done, which one is now,
 *  and what the business analyst says about each. Pure: no React, no store. The stored step decides (pmItemState);
 *  the brief is also done as soon as the objective and the end users are known well enough. */
import { stepIndex, type JourneyStep } from "@/madp/domain/journey";
import { PM_ITEMS, pmItemState, type ItemState, type PmItem } from "../model";
import { t } from "@/madp/i18n";

// The brief rules are shared with the functions and the engine (the design intent reads the same answers).
export { briefAnswers, briefQuestions, isThin } from "@/madp/domain/projectBrief";

/** Each checklist item's state: the stored step, and for the brief also the answers themselves. */
export function checklistStates(step: JourneyStep | null, briefReady: boolean): Record<PmItem, ItemState> {
  const out = {} as Record<PmItem, ItemState>;
  for (const item of PM_ITEMS) out[item] = pmItemState(item, step);
  if (out.brief === "now" && briefReady) out.brief = "done";
  // while the brief is still open the confirmation waits for it
  if (out.brief === "now" && out.understood === "now") out.understood = "later";
  return out;
}

/* ── an existing product attached to the Factory as it is live ──────────────── */

/** A checklist item's state in the analyst column: today's three, plus "skipped" ("Not used") for an item that never
 *  happened on an existing product attached to the Factory as it is live, and "open" for an earlier item that is not
 *  done yet while the project already works on a later one (it can still be done; it is not the current item). */
export type ChecklistState = ItemState | "skipped" | "open";

/** What the records say about the first two items. The stored step alone cannot tell: the hand-over moves a project
 *  straight to the questions (step "sanitization"), past the step these two belong to. */
export interface ChecklistFacts {
  /** The objective and the end users are recorded: briefAnswers over the project's own fields and the answers to the
   *  business analyst's own questions finds nothing missing (the facts every agent reads, projectBrief briefFacts). */
  briefReady: boolean;
  /** "What we understood" was confirmed: the brief's own confirmation (Brief.confirmedAt). */
  understoodConfirmed: boolean;
}

/** What the records say really happened on a live product (the stored step was set when it was attached, so it says
 *  nothing about the analysis). */
export interface LiveFacts {
  /** "What we understood" was confirmed: the brief's own confirmation, not the step. */
  understoodConfirmed: boolean;
  /** Files the business analyst read. */
  filesRead: number;
  /** Questions answered or set aside. */
  questionsHandled: number;
  /** The requirements' stored approval. */
  requirementsApproved: boolean;
  /** The scope's stored lock. */
  scopeLocked: boolean;
}

/** An existing product attached as it is live (analysis-next/model.ts attachedLive) at a step past the analysis
 *  (Software Engineering or later). */
export function livePastAnalysis(live: boolean, step: JourneyStep | null): boolean {
  return live && !!step && stepIndex(step) >= stepIndex("board");
}

/** The analyst column's checklist. Every project: today's states (checklistStates), except at the questions (step
 *  "sanitization", where the hand-over lands): the objective and the users are done only once they are recorded, and
 *  "Check what I understood" only once it is confirmed; until then each is "open" (still to do, while the questions
 *  stay the current item). Once the questions step is signed off, both count as signed with it, as "What we
 *  understood" does (understandingSigned). A live product past the analysis (`live` given): an item is done only when
 *  its own record says it happened (the brief known, what was understood confirmed or files read, questions handled,
 *  the requirements approved, the scope locked), else "skipped". */
export function analystChecklistStates(step: JourneyStep | null, facts: ChecklistFacts, live: LiveFacts | null): Record<PmItem, ChecklistState> {
  const states: Record<PmItem, ChecklistState> = checklistStates(step, facts.briefReady);
  if (!live || !livePastAnalysis(true, step)) {
    if (step === "sanitization") {
      if (!facts.briefReady) states.brief = "open";
      if (!facts.understoodConfirmed) states.understood = "open";
    }
    return states;
  }
  const did = (yes: boolean): ChecklistState => (yes ? "done" : "skipped");
  return {
    brief: did(facts.briefReady),
    understood: did(live.understoodConfirmed || live.filesRead > 0),
    questions: did(live.questionsHandled > 0),
    requirements: did(live.requirementsApproved),
    scope: did(live.scopeLocked),
  };
}

/** The item the conversation opens on: the first one to do now, else the last one done, else the first. */
export function currentItem(states: Record<PmItem, ItemState>): PmItem {
  const now = PM_ITEMS.find((i) => states[i] === "now");
  if (now) return now;
  const done = [...PM_ITEMS].reverse().find((i) => states[i] === "done");
  return done ?? PM_ITEMS[0];
}

/** What the business analyst will do at an item not reached yet, in one plain sentence. */
export const LATER_TEXT: Record<PmItem, string> = {
  get brief() { return t("analysis.workspace.later.brief", "I'll start by checking that I know the objective and who will use it."); },
  get understood() { return t("analysis.workspace.later.understood", "Once the objective and the users are clear, I'll sum up what I read and ask you to confirm it."); },
  get questions() { return t("analysis.workspace.later.questions", "Then I'll ask the questions your setup and files leave open, one at a time."); },
  get requirements() { return t("analysis.workspace.later.requirements", "With your answers I'll write the requirements for you to review and approve."); },
  get scope() { return t("analysis.workspace.later.scope", "Last, I'll turn the requirements into features, screens and milestones, and we lock the scope together."); },
};

/** What the business analyst says about an item that is done. */
export const DONE_TEXT: Record<PmItem, string> = {
  get brief() { return t("analysis.workspace.done.brief", "I have the objective and the end users."); },
  get understood() { return t("analysis.workspace.done.understood", "You confirmed what I understood."); },
  get questions() { return t("analysis.workspace.done.questions", "The open questions are settled."); },
  get requirements() { return t("analysis.workspace.done.requirements", "You approved the requirements."); },
  get scope() { return t("analysis.workspace.done.scope", "The scope is locked. The team plans the work from here."); },
};

/** "I read your setup and 3 files." */
export function readLine(files: number): string {
  if (files <= 0) return t("analysis.workspace.readSetup", "I read your project setup.");
  if (files === 1) return t("analysis.workspace.readSetupOneFile", "I read your project setup and one file.");
  return t("analysis.workspace.readSetupFiles", "I read your project setup and {count} files.", { count: files });
}

/** "Question 3 of 7" for the question being asked now (1-based). */
export function questionCounter(handled: number, total: number): string {
  if (total <= 0) return "";
  return t("analysis.workspace.questionCounter", "Question {n} of {total}", { n: Math.min(handled + 1, total), total });
}

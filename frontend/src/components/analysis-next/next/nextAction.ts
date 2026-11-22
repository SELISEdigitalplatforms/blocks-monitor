/**
 * "Next for you" (Business Analysis, next design): the ONE thing that moves the project on, said the way a calm business
 * analyst would say it. Pure: no React, no store. useNextAction fills NextFacts from the same hooks and rules today's
 * page uses (src/components/analysis/*) and calls nextActionFrom; the tests check every case here.
 *
 * Rules: one action at a time, short and warm, never pressuring; while the analyst works there is no button; while
 * anything the current step needs is still loading the card says so and never guesses an action.
 */
import { stepIndex, type JourneyStep } from "@/domain/journey";
import type { NextAction } from "../model";
import { t } from "@/i18n";

/** What the current step needs to know, gathered by useNextAction. Each group is read only at its own step; a group
 *  that is missing at its step counts as still loading. */
export interface NextFacts {
  /** The stored journey step (null while the project is opening). */
  step: JourneyStep | null;
  /** Something the current step needs has not arrived yet: say nothing wrong. */
  loading: boolean;
  /** Something the current step needs could not be read (after the query's own retries). */
  trouble?: boolean;
  /** An existing product attached to the Factory as it is live: it never went through the analysis (no scope). */
  attachedLive?: boolean;

  /** Step "understanding": the objective and the end users (pmModel briefAnswers on the panel's inputs). */
  brief?: {
    /** How many of the two answers are missing or too thin (0, 1 or 2). */
    missing: number;
    /** May answer (BriefTalk: sanitization.edit after the hand-over). */
    canAnswer: boolean;
  };

  /** Step "understanding": what I understood (the brief /api/brief/:id, as UnderstoodTalk reads it). */
  understood?: {
    /** Files still being read (processing or waiting). */
    filesReading: number;
    /** Files that could not be read (they don't block the confirmation; the Files part offers a retry). */
    filesFailed: number;
    /** Points where the sources disagree and nobody settled yet (the confirm refuses with conflicts_open). */
    conflicts: number;
    /** Already confirmed (the step moves on in a moment). */
    confirmed: boolean;
    /** May confirm (business.edit). */
    canConfirm: boolean;
  };

  /** Step "sanitization": my questions (Clarification rows) and the step's own next move (understandingNow). */
  questions?: {
    /** Questions still open (set-aside ones are not open). */
    open: number;
    /** understandingNow(...).primary.kind: what the step does once none is open. */
    next: "wait" | "start" | "answer" | "prepare" | "preparing" | "confirm" | "continue";
    /** The reading stopped before it finished (start it again). */
    readFailed: boolean;
    /** The work the step waits on stopped and has to start again (understandingNow's `stopped`). Its reason is said
     *  here only when the engine's capacity is used up (in the app's words, which fit the analyst's voice). */
    stopped?: { text: string; capacity: boolean } | null;
    /** May start, prepare or confirm (sanitization.edit). */
    canEdit: boolean;
  };

  /** Step "requirements": Goals & requirements (the same blockers as RequirementsTalk / RequirementsPage). */
  requirements?: {
    /** A requirements.draft job is queued or running ("review": the suggestions pass). */
    drafting: "draft" | "review" | null;
    /** Requirements written so far. */
    count: number;
    /** What the approval still waits for, in today's words (confirmBlockers + the design check), in order. */
    blockers: string[];
    /** Checklist items still open (goalsNow nowItems); the approval asks "approve anyway?", it does not wait. */
    openItems: number;
    /** May approve (requirements.edit). */
    canApprove: boolean;
  };

  /** Step "scope": Scope & success (the same rules as ScopeTalk + LockCard). */
  scope?: {
    /** A scope.draft job is queued or running and its plan is not in yet: no feature, or no milestone, in it
     *  (pageState.ts planBeingDrafted); the draft proposes the milestones after the features. */
    drafting: boolean;
    /** A milestones.suggest job is queued or running: the lock waits for its plan. */
    replanning: boolean;
    /** The scope is locked (or the build started): scopePageState phase is not "draft". */
    locked: boolean;
    /** The lock checklist's open conditions, in order (lockChecklist + Success & performance). */
    blockers: string[];
    /** May lock (scope.lock while the scope is a draft). */
    canLock: boolean;
  };
}

export type NextItem = Exclude<NextAction["item"], null>;

/* ── the analyst's words ─────────────────────────────────────────────────── */

/** Read at call time: each text is looked up in the current language when it is read (spreading a group reads it). */
export const NEXT_TEXT = {
  loading: { get title() { return t("analysis.next.oneMoment", "One moment"); }, get detail() { return t("analysis.next.loadingDetail", "I'm getting your analysis ready…"); } },
  trouble: { get title() { return t("analysis.next.oneMoment", "One moment"); }, get detail() { return t("analysis.next.troubleDetail", "I couldn't open everything just now. Try again in a moment."); } },
  notStarted: { get title() { return t("analysis.next.notStarted", "Not started yet"); }, get detail() { return t("analysis.next.notStartedDetail", "Once the project setup is handed over, I'll start here."); } },
  get working() { return t("analysis.next.working", "Nothing for you right now"); },
  brief: { get title() { return t("analysis.next.brief", "Tell me the objective and who will use it"); }, get detail() { return t("analysis.next.briefDetail", "Two short answers, then I'll check everything I read."); } },
  understood: { get title() { return t("analysis.next.understood", "Check what I understood"); }, get detail() { return t("analysis.next.understoodDetail", "Takes a minute. Then I'll ask a few questions."); } },
  get readingFiles() { return t("analysis.next.readingFiles", "I'm reading your files…"); },
  get gettingQuestions() { return t("analysis.next.gettingQuestions", "I'm getting my questions ready…"); },
  get writingQuestions() { return t("analysis.next.writingQuestions", "I'm writing my questions…"); },
  get questionsDetail() { return t("analysis.next.questionsDetail", "One at a time; you can leave any for later."); },
  read: { get title() { return t("analysis.next.read", "Let me read what you shared"); }, get detail() { return t("analysis.next.readDetail", "I read the brief and everything you shared, then ask you a few questions."); } },
  readAgain: { get title() { return t("analysis.next.readAgain", "Let me read your material again"); }, get detail() { return t("analysis.next.readAgainDetail", "Something interrupted my reading. Nothing you added is lost."); } },
  toRequirements: {
    get title() { return t("analysis.next.toRequirements", "Continue to the requirements"); },
    get prepare() { return t("analysis.next.toRequirementsPrepare", "Your answers are in. Next I'll write the requirements."); },
    get confirm() { return t("analysis.next.toRequirementsConfirm", "Your answers are in, and the first requirements are ready."); },
    get stopped() { return t("analysis.next.toRequirementsStopped", "I stopped before the first requirements were ready. Your answers are not lost; continue to start again."); },
  },
  get writingRequirements() { return t("analysis.next.writingRequirements", "I'm writing the requirements…"); },
  get reviewingRequirements() { return t("analysis.next.reviewingRequirements", "I'm reviewing the requirements…"); },
  requirements: { get title() { return t("analysis.next.requirements", "Approve the requirements"); }, get detail() { return t("analysis.next.requirementsDetail", "Read them through, change anything, then approve."); } },
  get writingScope() { return t("analysis.next.writingScope", "I'm writing the scope…"); },
  get replanning() { return t("analysis.next.replanning", "I'm arranging the milestones again…"); },
  scope: { get title() { return t("analysis.next.scope", "Lock the scope"); }, get detail() { return t("analysis.next.scopeDetail", "Check the features, milestones and success targets, then lock it."); } },
  done: { get title() { return t("analysis.next.allDone", "All done here"); }, get detail() { return t("analysis.next.doneDetail", "The scope is locked. The team is building it in Software Engineering."); } },
  released: { get title() { return t("analysis.next.allDone", "All done here"); }, get detail() { return t("analysis.next.releasedDetail", "The scope is locked and built. The rest happens in Release."); } },
  liveProduct: { get title() { return t("analysis.next.allDone", "All done here"); }, get detail() { return t("analysis.next.liveProductDetail", "This product came to the Factory as it is live, so there is no analysis to do here."); } },
  /** Who acts instead when the person may not (today's words on each item). */
  team: {
    get brief() { return t("analysis.next.team.brief", "The project team answers this."); },
    get understood() { return t("analysis.next.team.understood", "The project team confirms this."); },
    get start() { return t("analysis.next.team.start", "The project team starts the reading."); },
    get questions() { return t("analysis.next.team.questions", "The project team confirms this step."); },
    get requirements() { return t("analysis.next.team.requirements", "The project team approves the requirements."); },
    get scope() { return t("analysis.next.team.scope", "The project team locks the scope."); },
  },
};

/** "Answer 1 question", "Answer 3 questions". */
export function answerTitle(n: number): string {
  return n === 1 ? t("analysis.next.answerOne", "Answer 1 question") : t("analysis.next.answerMany", "Answer {count} questions", { count: n });
}

/** "One point disagrees between your sources. Settle it before you confirm." */
export function conflictsText(n: number): string {
  return n === 1
    ? t("analysis.next.conflictOne", "One point disagrees between your sources. Settle it before you confirm.")
    : t("analysis.next.conflictMany", "{count} points disagree between your sources. Settle them before you confirm.", { count: n });
}

/** A sentence in the analyst's own voice: today's texts sometimes name "the product manager"; here that is "my"/"me". */
export function inMyWords(text: string): string {
  const out = text
    .replace(/\b(?:the|your) product manager's\b/gi, "my")
    .replace(/\b(?:the|your) product manager\b/gi, "your business analyst")
    .replace(/\bproduct manager\b/gi, "business analyst")
    .trim();
  if (out === "") return out;
  const s = out[0]!.toUpperCase() + out.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/** The first reason, and how many more: "Write the objective, and 2 more." (null when there is none). */
export function blockedText(reasons: readonly string[]): string | null {
  const list = [...new Set(reasons.map(inMyWords).filter(Boolean))];
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;
  return t("analysis.next.andMore", "{first}, and {count} more.", { first: list[0]!.replace(/[.!?…]+$/, ""), count: list.length - 1 });
}

/* ── the one action ──────────────────────────────────────────────────────── */

const working = (detail: string, item: NextItem | null): NextAction => ({ title: NEXT_TEXT.working, detail, item, button: null, working: true });
const loading = (): NextAction => ({ ...NEXT_TEXT.loading, item: null, button: null, working: true });
const act = (title: string, detail: string, item: NextItem, button: string, blockedBecause?: string | null): NextAction =>
  blockedBecause ? { title, detail, item, button, blockedBecause } : { title, detail, item, button };

/** The one thing to do next, from the facts. Never a wrong action: unknown → a calm "one moment". */
export function nextActionFrom(f: NextFacts): NextAction {
  if (!f.step) return loading();
  const at = stepIndex(f.step);
  // past the analysis: the scope is locked and the team builds (or releases); a live product attached as it is never
  // had an analysis or a scope, so the words must not claim one
  if (at >= stepIndex("board")) {
    const txt = f.attachedLive ? NEXT_TEXT.liveProduct : at >= stepIndex("release") ? NEXT_TEXT.released : NEXT_TEXT.done;
    return { ...txt, item: null, button: null, finished: true };
  }
  if (at < stepIndex("understanding")) return { ...NEXT_TEXT.notStarted, item: null, button: null };
  if (f.loading) return loading();
  if (f.trouble) return { ...NEXT_TEXT.trouble, item: null, button: null };

  switch (f.step) {
    case "understanding": return understandingNext(f);
    case "sanitization": return questionsNext(f);
    case "requirements": return requirementsNext(f);
    case "scope": return scopeNext(f);
    default: return loading();
  }
}

function understandingNext(f: NextFacts): NextAction {
  const { brief, understood: u } = f;
  if (!brief || !u) return loading();
  if (brief.missing > 0) {
    return act(NEXT_TEXT.brief.title, NEXT_TEXT.brief.detail, "brief", t("analysis.next.button.start", "Start"), brief.canAnswer ? null : NEXT_TEXT.team.brief);
  }
  if (u.confirmed) return working(NEXT_TEXT.gettingQuestions, "questions");
  if (u.filesReading > 0) return working(NEXT_TEXT.readingFiles, "understood");
  const why = !u.canConfirm ? NEXT_TEXT.team.understood : u.conflicts > 0 ? conflictsText(u.conflicts) : null;
  return act(NEXT_TEXT.understood.title, NEXT_TEXT.understood.detail, "understood", t("analysis.next.button.review", "Review"), why);
}

function questionsNext(f: NextFacts): NextAction {
  const q = f.questions;
  if (!q) return loading();
  if (q.open > 0) return act(answerTitle(q.open), NEXT_TEXT.questionsDetail, "questions", t("analysis.next.button.start", "Start"));
  switch (q.next) {
    case "wait": return working(NEXT_TEXT.writingQuestions, "questions");
    case "preparing": return working(NEXT_TEXT.writingRequirements, "questions");
    case "start": {
      const txt = q.readFailed ? NEXT_TEXT.readAgain : NEXT_TEXT.read;
      const detail = q.readFailed && q.stopped?.capacity ? q.stopped.text : txt.detail;
      return act(txt.title, detail, "questions", t("analysis.next.button.start", "Start"), q.canEdit ? null : NEXT_TEXT.team.start);
    }
    case "prepare":
    case "confirm": {
      // the first requirements stopped: say so (and why, when the engine's capacity is used up), never "working"
      const stopped = q.next === "prepare" && q.stopped ? (q.stopped.capacity ? q.stopped.text : NEXT_TEXT.toRequirements.stopped) : null;
      return act(NEXT_TEXT.toRequirements.title, stopped ?? NEXT_TEXT.toRequirements[q.next], "questions", t("analysis.next.button.continue", "Continue"), q.canEdit ? null : NEXT_TEXT.team.questions);
    }
    // "answer" with none open, or "continue" (signed off, the step moves on in a moment)
    default: return working(NEXT_TEXT.writingRequirements, "questions");
  }
}

function requirementsNext(f: NextFacts): NextAction {
  const r = f.requirements;
  if (!r) return loading();
  if (r.drafting === "draft") return working(NEXT_TEXT.writingRequirements, "requirements");
  if (r.drafting === "review") return working(NEXT_TEXT.reviewingRequirements, "requirements");
  // no requirement yet and nothing running: today's page says the same ("I'm writing the requirements")
  if (r.count === 0) return working(NEXT_TEXT.writingRequirements, "requirements");
  const why = !r.canApprove ? NEXT_TEXT.team.requirements : blockedText(r.blockers);
  return act(NEXT_TEXT.requirements.title, NEXT_TEXT.requirements.detail, "requirements", t("analysis.next.button.review", "Review"), why);
}

function scopeNext(f: NextFacts): NextAction {
  const s = f.scope;
  if (!s) return loading();
  if (s.locked) return { ...NEXT_TEXT.done, item: null, button: null, finished: true };
  if (s.drafting) return working(NEXT_TEXT.writingScope, "scope");
  if (s.replanning) return working(NEXT_TEXT.replanning, "scope");
  const why = !s.canLock ? NEXT_TEXT.team.scope : blockedText(s.blockers);
  return act(NEXT_TEXT.scope.title, NEXT_TEXT.scope.detail, "scope", t("analysis.next.button.review", "Review"), why);
}

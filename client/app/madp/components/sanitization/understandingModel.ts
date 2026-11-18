/** "Understanding your project" (step 2), the step standard: the business analyst delivers "What we understood" and the
 *  answered questions; you answer the questions one at a time; sign-off: Continue. Pure: the step frame (status line,
 *  primary button, chips, agent line) and its tests read the same state. The business analyst's reading is the analysis
 *  the hand-over starts (sanitization.assist, focus "clarifications"); the first requirements are prepared behind the
 *  scenes (requirements.draft) once the questions are answered or set aside, and show up in Goals & requirements. */

import { t } from "@/madp/i18n";
import { AI_CAPACITY_CODE, isKnownFailureCode } from "@/madp/blocks/engine/types";

export type JobState = "none" | "active" | "succeeded" | "failed" | "cancelled";

export interface JobView {
  state: JobState;
  /** 0–100 while active. */
  progress: number;
  message: string | null;
  /** A failed job's code (EngineJob.errorCode). With a code the app knows (isKnownFailureCode), `message` is the app's
   *  own words for why it stopped (failedJobText), e.g. the engine's capacity is used up. */
  errorCode?: string | null;
}

export interface UnderstandingInput {
  existing: boolean;
  /** The step is signed off (the requirements' first version is confirmed). */
  completed: boolean;
  canEdit: boolean;
  /** The material the business analyst reads: notes with text and ready files. */
  notes: number;
  files: number;
  questions: { open: number; answered: number; deferred: number };
  requirements: number;
  hasObjective: boolean;
  questionsJob: JobView;
  draftJob: JobView;
}

export type ChipKey = "read" | "questions" | "draft";
export interface NowChip { key: ChipKey; label: string; value: string; done: boolean; busy?: boolean }

export type PrimaryKind = "wait" | "start" | "answer" | "prepare" | "preparing" | "confirm" | "continue";
export interface Primary { kind: PrimaryKind; label: string; disabled?: boolean }

export interface NowState {
  /** The one-line status beside the chips. */
  status: string;
  /** The shared frame's status tones. */
  tone: "done" | "progress" | "waiting" | "attention";
  primary: Primary;
  chips: NowChip[];
  /** The business analyst's line; `working` shows the shimmer bar (with `progress` when known). */
  agent: { text: string; working: boolean; progress: number | null };
  /** The work the step waits on stopped and has to start again, and why when that is known: the reading (with its
   *  known reason only), or the first requirements (their job's own line). `capacity`: the engine's capacity is used
   *  up (code ai.capacity). */
  stopped?: { text: string; capacity: boolean };
}

/** Why a failed job stopped, when its code is one the app has its own words for; else null. */
function knownWhy(j: JobView): string | null {
  return j.state === "failed" && isKnownFailureCode(j.errorCode) && j.message ? j.message : null;
}
const stoppedBy = (j: JobView, text: string): NonNullable<NowState["stopped"]> => ({ text, capacity: j.errorCode === AI_CAPACITY_CODE });

export function roleLine(): { who: string; delivers: string; you: string } {
  return {
    who: t("settings.sanitization.role.who", "Business analyst"),
    delivers: t("settings.sanitization.role.delivers", "What we understood, and your answers to a few questions"),
    you: t("settings.sanitization.role.you", "answer the questions, one at a time"),
  };
}

export function materialText(notes: number, files: number): string {
  const parts = [
    notes ? (notes === 1 ? t("settings.sanitization.now.material.oneNote", "1 note") : t("settings.sanitization.now.material.notes", "{count} notes", { count: notes })) : "",
    files ? (files === 1 ? t("settings.sanitization.now.material.oneFile", "1 file") : t("settings.sanitization.now.material.files", "{count} files", { count: files })) : "",
  ].filter(Boolean);
  if (parts.length === 2) return t("settings.sanitization.now.material.both", "{notes} and {files}", { notes: parts[0]!, files: parts[1]! });
  return parts[0] ?? t("settings.sanitization.now.material.brief", "the project brief");
}

/** The questions' progress line: "3 of 5 answered", plus the ones set aside ("not sure" or "later"). Handled = no
 *  longer open (answered or set aside): the bar fills with those. */
export function questionsProgress(q: { open: number; answered: number; deferred: number }): { total: number; handled: number; text: string } {
  const total = q.open + q.answered + q.deferred;
  const handled = q.answered + q.deferred;
  if (total === 0) return { total, handled, text: t("settings.sanitization.progress.none", "No questions yet") };
  if (q.open === 0 && q.deferred === 0) {
    return { total, handled, text: total === 1 ? t("settings.sanitization.progress.oneAnswered", "The question is answered") : t("settings.sanitization.progress.allAnswered", "All {total} answered", { total }) };
  }
  const text = q.deferred
    ? t("settings.sanitization.progress.answeredAside", "{answered} of {total} answered · {deferred} set aside", { answered: q.answered, total, deferred: q.deferred })
    : t("settings.sanitization.progress.answered", "{answered} of {total} answered", { answered: q.answered, total });
  return { total, handled, text };
}

/* ── answering like a conversation ─────────────────────────────────────────── */

/** "Not sure" and "Later" set a question aside (the deferred status) with these reasons; the person's own words follow. */
export const NOT_SURE_REASON = "Not sure yet. Your business analyst suggests an answer.";
export const LATER_REASON = "Answer later.";
/** Earlier wordings of the standard "Not sure" reason that saved rows still carry: before the role was named "your
 *  business analyst" (owner, 08.11.2026) it read "The product manager…", and briefly "The business analyst…". Read
 *  back as the standard sentence, never as the person's own words. (The engine only tests the "Not sure" prefix.) */
export const NOT_SURE_REASONS_BEFORE: readonly string[] = [
  "Not sure yet. The product manager suggests an answer.",
  "Not sure yet. The business analyst suggests an answer.",
];
const STANDARD_REASONS = new Set([NOT_SURE_REASON, ...NOT_SURE_REASONS_BEFORE, LATER_REASON]);

export type AsideKind = "notSure" | "later";

export function asideReason(kind: AsideKind, words: string): string {
  const w = words.trim();
  if (kind === "notSure") return w ? `Not sure yet: ${w}` : NOT_SURE_REASON;
  return w ? `Answer later: ${w}` : LATER_REASON;
}

/** How a set-aside question was set aside, from its reason ("Not sure yet…" or anything else = later). */
export function asideKindOf(reason: string | null | undefined): AsideKind {
  return /^not sure\b/i.test((reason ?? "").trim()) ? "notSure" : "later";
}

/** The person's own words in a reason written by asideReason ("" for the standard sentences). */
export function asideWords(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (STANDARD_REASONS.has(r)) return "";
  const m = /^(?:not sure yet|answer later):\s*(.*)$/is.exec(r);
  return m ? m[1]!.trim() : r;
}

/** The question to answer next: the one asked for, while it is still open; else the first open one. */
export function activeQuestion<T extends { ItemId: string; Status: string }>(rows: readonly T[], wanted: string | null): string | null {
  if (wanted && rows.some((r) => r.ItemId === wanted && r.Status === "open")) return wanted;
  return rows.find((r) => r.Status === "open")?.ItemId ?? null;
}

export function understandingNow(i: UnderstandingInput): NowState {
  const qp = questionsProgress(i.questions);
  const reading = i.questionsJob.state === "active";
  const readDone = i.questionsJob.state === "succeeded" || qp.total > 0 || i.requirements > 0;
  const readFailed = !readDone && !reading && (i.questionsJob.state === "failed" || i.questionsJob.state === "cancelled");
  const drafting = i.draftJob.state === "active";
  // A finished draft is ready even before its rows are read again: the job list sees "succeeded" a moment before the
  // requirements and the objective arrive, and the chip must not flip back to "after your answers" (a to-do) meanwhile.
  // (The server never drafts twice either: a succeeded draft is the draft, see autoDraft.ts shouldDraft.)
  const draftReady = !drafting && ((i.requirements > 0 && i.hasObjective) || i.draftJob.state === "succeeded");
  const material = materialText(i.notes, i.files);
  const goals = i.existing ? t("settings.sanitization.now.goalsExisting", "Goals for the change") : t("settings.sanitization.now.goalsNew", "Goals & requirements");
  const next = t("settings.sanitization.now.continueTo", "Continue to {goals}", { goals });

  const chips: NowChip[] = [
    { key: "read", label: t("settings.sanitization.chip.material", "Material"), done: readDone, busy: reading,
      value: reading ? t("settings.sanitization.chip.reading", "reading…") : readDone ? t("settings.sanitization.chip.materialRead", "{material} read", { material }) : t("settings.sanitization.chip.notRead", "not read yet") },
    { key: "questions", label: t("settings.sanitization.chip.questions", "Questions"), done: (qp.total > 0 && i.questions.open === 0) || (readDone && !reading && qp.total === 0), busy: reading && qp.total === 0,
      value: qp.total === 0 ? (reading ? t("settings.sanitization.chip.coming", "coming") : readDone ? t("settings.sanitization.chip.noneNeeded", "none needed") : "") : qp.text },
    { key: "draft", label: t("settings.sanitization.chip.firstRequirements", "First requirements"), done: draftReady || i.completed, busy: drafting,
      value: drafting ? t("settings.sanitization.chip.beingPrepared", "being prepared") : draftReady || i.completed ? t("settings.sanitization.chip.ready", "ready") : t("settings.sanitization.chip.afterAnswers", "after your answers") },
  ];

  const job = (j: JobView, fallback: string) => ({ text: j.message ? `${fallback} ${j.message}` : fallback, working: true, progress: j.progress || null });
  let status: string;
  let tone: NowState["tone"];
  let primary: Primary;
  let agent: NowState["agent"];
  let stopped: NowState["stopped"];
  if (i.completed) {
    status = t("settings.sanitization.now.signedOff", "Signed off. The work continues in {goals}.", { goals });
    tone = "done";
    primary = { kind: "continue", label: t("settings.sanitization.now.openGoals", "Open {goals}", { goals }) };
    agent = { text: t("settings.sanitization.now.agentDone", "Your answers are part of the first version of the requirements."), working: false, progress: null };
  } else if (reading) {
    status = t("settings.sanitization.now.reading", "The business analyst is reading your material");
    tone = "progress";
    const answerLabel = t("settings.sanitization.now.answerQuestions", "Answer the questions");
    primary = i.questions.open > 0 ? { kind: "answer", label: answerLabel } : { kind: "wait", label: answerLabel, disabled: true };
    agent = job(i.questionsJob, t("settings.sanitization.now.agentReading", "Reading your material and writing the questions."));
  } else if (!readDone) {
    status = readFailed ? t("settings.sanitization.now.readStopped", "The reading stopped before it finished") : t("settings.sanitization.now.notRead", "Not read yet");
    tone = "attention";
    primary = { kind: "start", label: readFailed ? t("settings.sanitization.now.restartReading", "Start the reading again") : t("settings.sanitization.now.startReading", "Start reading"), disabled: !i.canEdit };
    const why = readFailed ? knownWhy(i.questionsJob) : null;
    agent = {
      text: why ?? (readFailed ? t("settings.sanitization.now.agentInterrupted", "Something interrupted the reading. Nothing you added is lost.")
        : t("settings.sanitization.now.agentIdle", "Reads the brief and everything you shared, then asks you a few questions.")),
      working: false, progress: null,
    };
    if (why) stopped = stoppedBy(i.questionsJob, why);
  } else if (i.questions.open > 0) {
    status = i.questions.open === 1 ? t("settings.sanitization.now.oneQuestion", "One question for you") : t("settings.sanitization.now.questions", "{count} questions for you", { count: i.questions.open });
    tone = "attention";
    primary = { kind: "answer", label: t("settings.sanitization.now.answerQuestions", "Answer the questions") };
    agent = { text: t("settings.sanitization.now.agentWaiting", "Read {material}. Waiting for your answers; \"Not sure\" is a fine answer.", { material }), working: false, progress: null };
  } else if (drafting) {
    status = t("settings.sanitization.now.preparing", "Preparing the first requirements");
    tone = "progress";
    primary = { kind: "preparing", label: next, disabled: true };
    agent = job(i.draftJob, t("settings.sanitization.now.agentDrafting", "Writing the first requirements from your answers."));
  } else if (!draftReady && i.draftJob.state === "failed") {
    // the newest draft stopped (it does not start again by itself): say so and why, continuing prepares it again
    const why = i.draftJob.message || t("settings.sanitization.now.agentDraftInterrupted", "Something interrupted the first requirements. Your answers are not lost.");
    status = t("settings.sanitization.now.draftStopped", "The first requirements stopped before they were ready");
    tone = "attention";
    primary = { kind: "prepare", label: next, disabled: !i.canEdit };
    agent = { text: why, working: false, progress: null };
    stopped = stoppedBy(i.draftJob, why);
  } else if (!draftReady) {
    status = qp.total > 0 ? t("settings.sanitization.now.allHandled", "All questions handled") : t("settings.sanitization.now.noQuestionsNeeded", "No questions needed");
    tone = "done";
    primary = { kind: "prepare", label: next, disabled: !i.canEdit };
    agent = { text: t("settings.sanitization.now.agentPrepare", "Prepares the first requirements for {goals} when you continue.", { goals }), working: false, progress: null };
  } else {
    status = t("settings.sanitization.now.ready", "Ready");
    tone = "done";
    primary = { kind: "confirm", label: next, disabled: !i.canEdit };
    agent = { text: t("settings.sanitization.now.agentReady", "Your answers are in. The first requirements are ready in {goals}.", { goals }), working: false, progress: null };
  }
  return { status, tone, primary, chips, agent, ...(stopped ? { stopped } : {}) };
}

export { briefAbout } from "../../domain/projectBrief";

/* ── "What we understood" ───────────────────────────────────────────────────── */

const clipText = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** "A, B and C" (and "+ 2 more"). */
function listLine(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.length > 1 ? t("settings.sanitization.understood.listAnd", "{first} and {last}", { first: shown.slice(0, -1).join(", "), last: shown[shown.length - 1]! }) : shown[0] ?? "";
  return rest > 0 ? t("settings.sanitization.understood.listMore", "{list} (and {count} more)", { list: joined, count: rest }) : joined;
}

/** The 3–4 plain lines: the picture in one sentence, the goal, who it is for, what it must do (or what should change). */
export function understoodLines(o: {
  existing: boolean; objective: string | null; brief: string; goal: string; users: string; mustHaves: readonly { text: string; priority: string }[];
  changes: readonly string[];
}): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const same = (a: string, b: string) => a.trim().replace(/[.;!]+$/, "").toLowerCase() === b.trim().replace(/[.;!]+$/, "").toLowerCase();
  // an objective that only repeats the goal says nothing new: the brief leads then
  const objective = (o.objective ?? "").trim();
  const lead = (objective && !(o.goal.trim() && same(objective, o.goal)) ? objective : o.brief.trim() || objective).trim();
  if (lead) out.push({ label: t("settings.sanitization.understood.inShort", "In short"), text: clipText(lead, 260) });
  if (o.goal.trim() && !same(o.goal, lead)) out.push({ label: t("settings.sanitization.understood.goal", "Goal"), text: clipText(o.goal.trim(), 220) });
  if (o.users.trim()) out.push({ label: t("settings.sanitization.understood.for", "For"), text: clipText(o.users.trim(), 160) });
  if (o.existing && o.changes.length) out.push({ label: t("settings.sanitization.understood.change", "What should change"), text: clipText(listLine(o.changes.map((c) => c.replace(/[.;]+$/, ""))), 220) });
  else if (o.mustHaves.length) {
    const ordered = [...o.mustHaves.filter((m) => m.priority === "must"), ...o.mustHaves.filter((m) => m.priority !== "must")];
    out.push({ label: t("settings.sanitization.understood.mustDo", "It must"), text: clipText(listLine(ordered.map((m) => m.text.replace(/[.;]+$/, ""))), 220) });
  }
  return out.slice(0, 4);
}

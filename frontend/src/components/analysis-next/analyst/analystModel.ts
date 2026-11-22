/** The business analyst's column (Business Analysis, next design): the small rules behind it. Pure: no React, no store.
 *  The checklist states and the brief rules come from today's panel (analysis/pm/pmModel.ts), unchanged. */
import { DOC_PART_LABEL, PM_ITEM_PART, type DocPart, type PmItem } from "@/components/analysis/model";
import type { ChecklistState, LiveFacts } from "@/components/analysis/pm/pmModel";
import { PART_STATUS_LABEL } from "../model";
import { t } from "@/i18n";

export {
  analystChecklistStates, briefAnswers, briefQuestions, checklistStates, currentItem, isThin, livePastAnalysis, DONE_TEXT, LATER_TEXT, readLine,
  type ChecklistFacts, type ChecklistState, type LiveFacts,
} from "@/components/analysis/pm/pmModel";

/** The analyst's one message on an existing product attached to the Factory as it is live, past the analysis. */
export const LIVE_PRODUCT_SAYS = "This product came to the Factory as it is live, so there was no analysis to do. To change it, request a change or a new feature.";
/** LIVE_PRODUCT_SAYS in the current language. */
export function liveProductSays(): string {
  return t("analysis.analyst.liveProductSays", "This product came to the Factory as it is live, so there was no analysis to do. To change it, request a change or a new feature.");
}

/** "I read 3 files." on a live product (it had no project setup to read). */
export function liveReadLine(files: number): string {
  return files === 1 ? t("analysis.analyst.readOneFile", "I read one file.") : t("analysis.analyst.readFiles", "I read {count} files.", { count: files });
}

/** The same query key as Project understanding and today's panel, so the three share one read. */
export const briefKey = (projectId: string) => ["understanding-brief", projectId] as const;

/** The part of the analysis an item opens on the right. */
export const itemPart = (item: PmItem): DocPart => PM_ITEM_PART[item];

/** The checklist's small text. On a live product (`live` given) a check nobody made is never "Done": what was understood
 *  but only read, not confirmed, says how many files were read. An earlier item still to do while the questions run
 *  ("open") says what it waits for. */
export function checklistNote(item: PmItem, state: ChecklistState, q?: { open: number; answered: number; deferred: number },
  live?: Pick<LiveFacts, "understoodConfirmed" | "filesRead"> | null): string {
  if (state === "skipped") return PART_STATUS_LABEL.skipped;
  if (state === "done" && live && item === "understood" && !live.understoodConfirmed && live.filesRead > 0) {
    return live.filesRead === 1 ? t("analysis.analyst.oneFileRead", "1 file read") : t("analysis.analyst.filesRead", "{count} files read", { count: live.filesRead });
  }
  if (state === "done") return t("analysis.analyst.noteDone", "Done");
  if (state === "later") return t("analysis.analyst.noteLater", "Later");
  if (state === "open") return OPEN_NOTE[item];
  if (item === "questions" && q && q.open > 0) return q.open === 1 ? t("analysis.analyst.oneLeft", "1 left") : t("analysis.analyst.nLeft", "{count} left", { count: q.open });
  return t("analysis.analyst.noteNow", "Now");
}

/** What an earlier item still to do ("open") waits for. */
export const OPEN_NOTE: Record<PmItem, string> = {
  get brief() { return t("analysis.analyst.toAnswer", "To answer"); },
  get understood() { return t("analysis.analyst.toConfirm", "To confirm"); },
  get questions() { return t("analysis.analyst.toAnswer", "To answer"); },
  get requirements() { return t("analysis.analyst.toApprove", "To approve"); },
  get scope() { return t("analysis.analyst.toLock", "To lock"); },
};

/** When the item in progress moves on (a sign-off), the open conversation follows it, unless the person opened
 *  another item themselves. Returns the item to open, or null when nothing should change. */
export function followCurrent(prev: PmItem | null, current: PmItem, open: PmItem | null): PmItem | null {
  if (prev === null || prev === current) return null;
  return open === prev ? current : null;
}

/* ── one question at a time ───────────────────────────────────────────────── */

/** Which part of the analysis an answer feeds: a modest guess from the question's words (the most specific first). */
const FEEDS: { part: DocPart; test: RegExp }[] = [
  { part: "success", test: /\b(measure|success|kpis?|metrics?|how (will|do|would) (you|we) know)\b/i },
  { part: "milestones", test: /\b(deadline|launch|go[- ]live|by when|first version|first release|phases?|release date)\b/i },
  {
    part: "workflows",
    test: /\b(fails?|failed|goes wrong|go wrong|refunds?|approv\w*|process|steps?|notif\w*|e-?mails?|payouts?|paid|payments?|pay|hosting|hosted|gdpr|laws?|legal|compliance|privacy|languages?|budget|not included|out of scope|exclude\w*|integrat\w*|import|export|offline|limits?|constraints?)\b/i,
  },
  { part: "screens", test: /\b(look|looks|brand\w*|colou?rs?|logo|design|style|screens?|mobile|phones?|tablets?)\b/i },
  { part: "objective", test: /\b(achieve|goal|purpose|problem|objective)\b|\bwho will use\b|\bend users?\b/i },
];

export function partForQuestion(question: string): DocPart {
  return FEEDS.find((f) => f.test.test(question))?.part ?? "features";
}

/** "Why I ask": where the question came from (when the record says) and which part the answer goes into. */
export interface WhyIAsk { part: DocPart; partLabel: string; from: string | null; text: string }

export function whyIAsk(i: {
  question: string; sourceType?: string | null; sourceRef?: string | null;
  refs?: readonly { id: string; type: string; title: string }[];
}): WhyIAsk {
  const part = partForQuestion(i.question);
  const partLabel = DOC_PART_LABEL[part];
  const ref = i.sourceRef ? (i.refs ?? []).find((r) => r.id === i.sourceRef) : undefined;
  const title = ref?.title.trim() ? `“${ref.title.trim()}”` : null;
  const from = i.sourceType === "doc-file" ? (title ?? t("analysis.analyst.oneOfYourFiles", "one of your files"))
    : i.sourceType === "doc-note" ? (title ?? t("analysis.analyst.yourNotes", "your notes"))
    : null;
  const text = from
    ? t("analysis.analyst.whyFrom", "It came up in {from}. Your answer goes into “{part}”.", { from, part: partLabel })
    : t("analysis.analyst.whyGoesInto", "Your answer goes into “{part}”.", { part: partLabel });
  return { part, partLabel, from, text };
}

/** The friendly word after an answer or a set-aside, before the next question. Honest about what happens: the
 *  first requirements are prepared once every question is handled (functions/.../autoDraft.ts). */
export type AckKind = "answered" | "notSure" | "later";

export function ackText(kind: AckKind, o: { last: boolean }): string {
  if (kind === "notSure") return o.last ? t("analysis.analyst.ackNotSureLast", "That's fine. I'll suggest an answer for you to check.") : t("analysis.analyst.ackNotSure", "That's fine. I'll suggest an answer for you to check. Next one:");
  if (kind === "later") return o.last ? t("analysis.analyst.ackLaterLast", "No problem, we can come back to it.") : t("analysis.analyst.ackLater", "No problem, we can come back to it. Next one:");
  return o.last ? t("analysis.analyst.ackAnsweredLast", "Got it, thank you.") : t("analysis.analyst.ackAnswered", "Got it. I'll use that in the requirements. Next one:");
}

/** Number keys pick a suggested answer: "1" … "9" → its index, when there is such a choice, no modifier is held and
 *  the person isn't typing in a text box. */
export function choiceIndex(key: string, count: number, o: { typing?: boolean; modifier?: boolean } = {}): number | null {
  if (o.typing || o.modifier) return null;
  if (!/^[1-9]$/.test(key)) return null;
  const i = Number(key) - 1;
  return i < count ? i : null;
}

/** Enter sends a written answer; Shift + Enter makes a new line; never while an input method is composing. */
export function sendsOnEnter(e: { key: string; shiftKey?: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/** How far the questions are, for the thin bar (handled = answered or set aside). */
export function progressPct(handled: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((Math.max(0, Math.min(handled, total)) / total) * 100);
}

/** Words reused from today's steps (errors, blockers) in the analyst's voice: never "product manager", "MADP" or "AI". */
export function myWords(text: string): string {
  return text
    .replace(/\b(?:the|your) MADP\b/g, "my")
    .replace(/\bMADP\b/g, "your business analyst")
    .replace(/\b(?:the|your) product manager's\b/gi, "my")
    .replace(/\b(?:the|your) product manager\b/gi, "your business analyst")
    .replace(/\bproduct manager\b/gi, "business analyst")
    .replace(/(^|[.!?]\s+)your business analyst/g, (_m, p: string) => `${p}Your business analyst`);
}

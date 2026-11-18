/**
 * Business Analysis, next design (owner 08.11.2026, third round): a copy of the analysis page at /p/:id/analysis-next,
 * beside the current one. It should feel like working with a calm, experienced business analyst: one thing at a time,
 * always clear what to do next, nothing to hunt for. Front end only: every part reads the same records and every
 * action calls the same ops as today's page (src/components/analysis/*).
 *
 * Layout: a top bar (readiness "7 of 9 parts ready"), the analyst's column on the left (the "Next for you" card and the
 * conversation, one question at a time), the analysis on the right as a list of parts that start collapsed to one
 * line (title, one-line summary, status) and open in place; a sticky action bar at the bottom on wide screens; two
 * tabs (Conversation / Analysis) on phones.
 *
 * Shared vocabulary (use exactly these words everywhere on the page):
 *   statuses  "Needs you" · "Draft" · "Confirmed" · "Not started" · "Not used"
 *   verbs     Confirm · Edit · Later · Answer
 *   the role  "Your business analyst" (never "product manager", never "AI"; no invented human name)
 * No React imports here (pure).
 */
import type { DocPart } from "@/madp/components/analysis/model";
import { t } from "@/madp/i18n";
export { DOC_PARTS, DOC_PART_LABEL, partOpen, type DocPart, type AnalysisCtx } from "@/madp/components/analysis/model";

/** Where a part stands, in the words people read. A status never contradicts the part's own text (owner rule: zero
 *  data mismatches):
 *   - "not-started"  the step that writes the part is still ahead;
 *   - "draft" / "needs-you"  the step is current (the text says what is there now, "being written" only while the
 *     engine job that writes it is queued or running);
 *   - "confirmed"  the step was passed AND the part has content;
 *   - "skipped" ("Not used")  the step was passed WITHOUT content: an existing product attached to the Factory as it
 *     is live (it never went through the analysis), or a step left empty. The text says why.
 *  An existing product attached as it is live (live/liveDoc.ts) has two more:
 *   - "documented" ("From the live product")  written down from the live product's code and documents;
 *   - "undocumented" ("Not documented yet")  nothing written down yet (or being written down right now). */
export type PartStatus = "needs-you" | "draft" | "confirmed" | "not-started" | "skipped" | "documented" | "undocumented";

/** Read at render time: each label is looked up in the current language when it is read. */
export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  get "needs-you"() { return t("analysis.next.status.needsYou", "Needs you"); },
  get draft() { return t("analysis.next.status.draft", "Draft"); },
  get confirmed() { return t("analysis.next.status.confirmed", "Confirmed"); },
  get "not-started"() { return t("analysis.next.status.notStarted", "Not started"); },
  get skipped() { return t("analysis.next.status.skipped", "Not used"); },
  get documented() { return t("analysis.next.status.documented", "From the live product"); },
  get undocumented() { return t("analysis.next.status.undocumented", "Not documented yet"); },
};

/** An existing product attached to the Factory as it is live: it skipped the setup and was never handed over, so it
 *  has no analysis of its own (the same rule as the setup chips, src/components/business/setupChips.ts). */
export function attachedLive(project: { type: string; handedOverAt: string | null } | null | undefined): boolean {
  return project?.type === "brownfield" && !project.handedOverAt;
}

/** Why a part of an attached live product is empty ("Not used"); English source text (liveProductText() reads it in
 *  the current language). */
export const LIVE_PRODUCT_TEXT = "Not part of this project: it came to the Factory as a live product.";
export function liveProductText(): string {
  return t("analysis.next.liveProductText", "Not part of this project: it came to the Factory as a live product.");
}

/** A passed step's empty part: "Not used", with the reason (the live product's, else the part's own words). */
export function notUsed(id: DocPart, live: boolean, none: string, fingerprint = "skipped"): PartSummary {
  return { id, status: "skipped", summary: live ? liveProductText() : none, fingerprint };
}

/** One line about a part, for its collapsed row (computed from the same records the part shows when open). */
export interface PartSummary {
  id: DocPart;
  status: PartStatus;
  /** One plain sentence or a short list ("8 features, 2 still to confirm"); never empty: say what will appear. */
  summary: string;
  /** Short source labels shown as chips ("Project setup", "bike-brief.md", "AGIS handbook p.112"), when known. */
  sources?: string[];
  /** Things that block confirming this part, in plain words ("2 requirements have no check yet"). */
  issues?: string[];
  /** A fingerprint of the part's content: when it changes after an answer, the row briefly highlights. */
  fingerprint: string;
  /** Still loading: the row shows a quiet placeholder, not a wrong status. */
  loading?: boolean;
}

/** The analyst's checklist items (same order as today's page). */
export { PM_ITEMS as ANALYST_ITEMS, type PmItem as AnalystItem } from "@/madp/components/analysis/model";

export const ANALYST_ITEM_LABEL: Record<"brief" | "understood" | "questions" | "requirements" | "scope", string> = {
  get brief() { return t("analysis.next.item.brief", "Objective and the people who will use it"); },
  get understood() { return t("analysis.next.item.understood", "Check what I understood"); },
  get questions() { return t("analysis.next.item.questions", "A few questions"); },
  get requirements() { return t("analysis.next.item.requirements", "Approve the requirements"); },
  get scope() { return t("analysis.next.item.scope", "Agree and lock the scope"); },
};

/** The one thing that moves the project on, for the "Next for you" card and the sticky bar. */
export interface NextAction {
  /** Short title: "Answer 2 questions", "Approve the requirements", "Nothing for you right now". */
  title: string;
  /** One calm sentence: why, and what happens after ("Then I write the requirements for you to check."). */
  detail: string;
  /** The checklist item where the action lives (the analyst column opens it); null: nothing to do now. */
  item: "brief" | "understood" | "questions" | "requirements" | "scope" | null;
  /** The button's word ("Start", "Review", "Lock the scope"); null when there is no button. */
  button: string | null;
  /** When the action exists but cannot be done yet, why, in plain words ("Files are still being read"). */
  blockedBecause?: string;
  /** The analyst is working (reading files, drafting): show a calm "working on it" state, no button. */
  working?: boolean;
  /** The button does something besides opening an item: "document" starts the documentation of a live product. */
  action?: "document";
  /** The button goes to this address instead (a change request waiting for the person). */
  href?: string;
}

/** Readiness for the top bar: confirmed parts out of the parts this project uses ("Not used" parts count neither as
 *  ready nor in the total, so an empty part never makes the analysis look further along than it is; nor do the parts
 *  of a live product, which never had an analysis to be ready for). */
export function readiness(parts: readonly PartSummary[]): { ready: number; total: number; needsYou: number } {
  const outside = new Set<PartStatus>(["skipped", "documented", "undocumented"]);
  return {
    ready: parts.filter((p) => p.status === "confirmed").length,
    total: parts.filter((p) => !outside.has(p.status)).length,
    needsYou: parts.filter((p) => p.status === "needs-you").length,
  };
}

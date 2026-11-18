/** Business Analysis of an existing product attached to the Factory as it is live (attachedLive, past the analysis):
 *  it never went through an analysis, so its parts show what was written down FROM the live product (the engine job
 *  "product.document", queued by the op project.documentExisting; src/domain/liveProduct.ts), labelled plainly with
 *  when, or say honestly that nothing was written down yet, with the action that does it. Pure: no React, no store.
 *
 *  Rules (owner rule: zero data mismatches):
 *   - a part with content on a documented product reads "From the live product" with the date it was last documented,
 *     never "Confirmed" (nobody confirmed it) and never with issues to settle;
 *   - an empty part says "Not documented yet" until the product is documented, "Being written down…" while the job
 *     runs, and after a documentation that found nothing for it, "Not used" with the plain reason;
 *   - "What we read from your files" is the person's own material and keeps its own words;
 *   - the action is offered only to people who may start it (business.edit) and only when the server would accept it
 *     (documentRefusal); otherwise the card says why, in plain words. */
import { documentRefusalText } from "@/madp/components/requirements/domainLabels";
import { formatDateTime } from "@/madp/lib/dates";
import { DOCUMENT_JOB_KIND, DOCUMENT_REFUSAL_TEXT, type ExistingDesignSystem } from "@/madp/domain/liveProduct";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import type { DocPart, NextAction, PartSummary } from "../model";
import { t } from "@/madp/i18n";

export type DocumentRefusal = keyof typeof DOCUMENT_REFUSAL_TEXT;

/** Where the documentation of a live product stands, as the analysis page reads it. */
export interface LiveDocFacts {
  /** When the product was last documented (Project.LiveProductJson documentedAt); null when it never was. */
  documentedAt: string | null;
  /** A product.document job is queued, claimed or running: its progress (0-100) and its plain message. */
  running: { progress: number; message: string | null } | null;
  /** The newest product.document job stopped (failed or cancelled) without documenting the product again. */
  stopped: boolean;
  /** The person may start it (business.edit). */
  canDocument: boolean;
  /** Why the server would refuse it (documentRefusal), null when it would accept it. */
  refusal: DocumentRefusal | null;
  /** What the documentation found no source for (the snapshot's leftEmpty, plain sentences). */
  leftEmpty: readonly string[];
  /** The reads are still arriving: say nothing wrong. */
  loading: boolean;
}

/** Read at render time: each text is looked up in the current language when it is read. */
export const LIVE_TEXT = {
  get documented() { return t("analysis.live.documented", "From the live product"); },
  get notDocumented() { return t("analysis.live.notDocumented", "Not documented yet"); },
  /** an empty part before the product is documented */
  get emptyPart() { return t("analysis.live.emptyPart", "Nothing written down from the live product yet."); },
  /** the same, opened: what the action does */
  get emptyPartOpen() { return t("analysis.live.emptyPartOpen", "Nothing is written down yet. Documenting the live product fills this in from its code and documents."); },
  get emptyPartNoRight() { return t("analysis.live.emptyPartNoRight", "Nothing written down from the live product yet. It is filled in once the product is documented."); },
  /** while the job runs */
  get writing() { return t("analysis.live.writing", "Being written down from the live product…"); },
  /** an empty part after a documentation that found nothing for it */
  get nothingFound() { return t("analysis.live.nothingFound", "Nothing in the live product's code or documents says this."); },
  /** who may start it instead */
  get team() { return t("analysis.live.team", "The project team documents the live product."); },
  button: {
    get first() { return t("analysis.live.buttonFirst", "Document from the live product"); },
    get again() { return t("analysis.live.buttonAgain", "Refresh from the live product"); },
  },
};

/** "9 Nov 2026, 02:40" (the app's one date format); "" for no date. */
export const documentedWhen = (at: string | null | undefined): string => formatDateTime(at);

/** "Documented from the live product on 9 Nov 2026, 02:40." (or without the date when it is unreadable). */
export function documentedLine(at: string | null | undefined): string {
  const when = documentedWhen(at);
  return when ? t("analysis.live.documentedOn", "Documented from the live product on {when}.", { when }) : t("analysis.live.documentedLine", "Documented from the live product.");
}

/** The source chip of a documented part: "Documented 9 Nov 2026, 02:40". */
export function documentedChip(at: string | null | undefined): string {
  const when = documentedWhen(at);
  return when ? t("analysis.live.documentedChip", "Documented {when}", { when }) : t("analysis.live.documentedChipNoDate", "Documented");
}

/** The documentation's own facts from the job list and the snapshot (pure, for tests): the newest job running, or
 *  stopped after the last documentation. */
export function jobFacts(jobs: readonly EngineJob[], documentedAt: string | null): Pick<LiveDocFacts, "running" | "stopped"> {
  const last = latestEngineJob(jobs.filter((j) => j.kind === DOCUMENT_JOB_KIND));
  if (!last) return { running: null, stopped: false };
  if (isActiveEngineJob(last)) return { running: { progress: last.progress, message: last.message }, stopped: false };
  const stoppedAt = Date.parse(last.finishedAt ?? last.updatedAt ?? last.createdAt ?? "");
  const docAt = documentedAt ? Date.parse(documentedAt) : NaN;
  const after = !Number.isFinite(docAt) || !Number.isFinite(stoppedAt) || stoppedAt > docAt;
  return { running: null, stopped: (last.status === "failed" || last.status === "cancelled") && after };
}

/** The action's word: "Document…" the first time, "Refresh…" once it was documented. */
export function documentButton(f: Pick<LiveDocFacts, "documentedAt">): string {
  return f.documentedAt ? LIVE_TEXT.button.again : LIVE_TEXT.button.first;
}

/** Whether the action may be offered right now: the right to start it, the server would accept it, nothing running. */
export function canStartDocumentation(f: LiveDocFacts): boolean {
  return f.canDocument && f.refusal === null && f.running === null && !f.loading;
}

/** Why the action is not offered, in plain words (null when it is, or while the job runs). */
export function documentBlockedText(f: LiveDocFacts): string | null {
  if (f.running || f.loading) return null;
  if (f.refusal) return documentRefusalText(f.refusal);
  if (!f.canDocument) return LIVE_TEXT.team;
  return null;
}

/** The plain progress line while the job runs: its own message (the engine writes plain lines), else a calm default. */
export function runningLine(running: NonNullable<LiveDocFacts["running"]>): string {
  const msg = (running.message ?? "").trim();
  const pct = Math.round(Math.min(100, Math.max(0, running.progress)));
  const line = msg || t("analysis.live.reading", "Reading the product's code and documents.");
  return pct > 0 ? `${line.replace(/[.…]+$/, "")} (${pct}%).` : line;
}

/** The parts the documentation writes (the files part is the person's own material). */
const WRITTEN_PARTS: ReadonlySet<DocPart> = new Set(["understood", "objective", "features", "workflows", "scope", "screens", "milestones", "success"]);

/** What leftEmpty sentence belongs to a part ("The goal: no source states it." → understood), when one does. */
const LEFT_EMPTY_HINT: Partial<Record<DocPart, RegExp>> = {
  understood: /\b(goal|users?|description|brief|client)\b/i,
  objective: /\b(objective|goal)\b/i,
  workflows: /\b(workflows?|constraints?)\b/i,
  scope: /\b(modules?|features?)\b/i,
  milestones: /\b(milestones?|phases?)\b/i,
  screens: /\b(design|look|theme|colou?rs?)\b/i,
  success: /\b(success|targets?|metrics?)\b/i,
};

export function leftEmptyFor(part: DocPart, leftEmpty: readonly string[]): string | null {
  const re = LEFT_EMPTY_HINT[part];
  return re ? leftEmpty.find((s) => re.test(s)) ?? null : null;
}

/** A part's row as a live product shows it (see the rules at the top). Every other project: unchanged. */
export function livePartSummary(s: PartSummary, f: LiveDocFacts | null): PartSummary {
  if (!f || s.loading || !WRITTEN_PARTS.has(s.id)) return s;
  if (f.loading) return { ...s, summary: t("analysis.live.opening", "Opening…"), loading: true };
  const empty = s.status === "skipped";
  if (empty) {
    if (f.running) return { id: s.id, status: "undocumented", summary: LIVE_TEXT.writing, fingerprint: `${s.fingerprint}:writing` };
    if (!f.documentedAt) {
      return { id: s.id, status: "undocumented", summary: canStartDocumentation(f) ? LIVE_TEXT.emptyPart : LIVE_TEXT.emptyPartNoRight, fingerprint: `${s.fingerprint}:none` };
    }
    return { id: s.id, status: "skipped", summary: leftEmptyFor(s.id, f.leftEmpty) ?? LIVE_TEXT.nothingFound, fingerprint: `${s.fingerprint}:${f.documentedAt}` };
  }
  // content the people wrote before any documentation keeps its own words
  if (!f.documentedAt) return s;
  return {
    id: s.id, status: "documented", summary: s.summary,
    sources: [documentedChip(f.documentedAt)],
    fingerprint: `${s.fingerprint}:${f.documentedAt}`,
  };
}

/** "Next for you" on a live product: document it while nothing is written down (or the last run stopped); while it
 *  runs, a calm working state; once documented, nothing to do here (the refresh lives in the About card). */
export function liveNextAction(f: LiveDocFacts): NextAction {
  if (f.loading) return { title: t("analysis.live.next.oneMoment", "One moment"), detail: t("analysis.live.next.opening", "I'm opening what was written down about this product…"), item: null, button: null, working: true };
  if (f.running) {
    return { title: t("analysis.live.next.documenting", "Documenting the live product"), detail: runningLine(f.running), item: null, button: null, working: true };
  }
  const blocked = documentBlockedText(f);
  if (f.stopped) {
    const base = { title: t("analysis.live.next.stopped", "The documentation stopped"), detail: t("analysis.live.next.stoppedDetail", "It stopped before it finished; nothing written down before is lost. Start it again to finish it.") };
    return blocked ? { ...base, item: null, button: documentButton(f), action: "document", blockedBecause: blocked } : { ...base, item: null, button: documentButton(f), action: "document" };
  }
  if (!f.documentedAt) {
    const base = {
      title: t("analysis.live.next.document", "Document the live product"),
      detail: t("analysis.live.next.documentDetail", "It came to the Factory as it is live, so nothing is written down here yet. I'll read its code and documents and write down what it does today."),
    };
    return blocked ? { ...base, item: null, button: documentButton(f), action: "document", blockedBecause: blocked } : { ...base, item: null, button: documentButton(f), action: "document" };
  }
  return {
    title: t("analysis.live.next.allWritten", "All written down"),
    detail: `${documentedLine(f.documentedAt)} ${t("analysis.live.next.toChange", "To change the product, request a change or a new feature.")}`,
    item: null, button: null,
  };
}

/* ── the existing design system (Look & feel of a documented product) ─────── */

const list = (items: readonly string[]): string =>
  items.length <= 1 ? items[0] ?? "" : t("analysis.live.listAnd", "{first} and {last}", { first: items.slice(0, -1).join(", "), last: items[items.length - 1]! });

/** "The existing design system · 5 colour themes · Plus Jakarta Sans · light and dark" */
export function designSystemLine(d: ExistingDesignSystem): string {
  const bits = [
    d.themes.length ? (d.themes.length === 1 ? t("analysis.live.oneColourTheme", "1 colour theme") : t("analysis.live.colourThemes", "{count} colour themes", { count: d.themes.length })) : "",
    d.fonts.length ? list(d.fonts.slice(0, 2)) : "",
    d.modes.length ? list(d.modes) : "",
  ].filter(Boolean);
  return [t("analysis.live.existingSystem", "The existing design system"), ...bits].join(" · ");
}

/* ── the detailed pages ("Show them") of a live product ───────────────────── */

/** The detailed pages of a live product: the same parts as the main view, in three sections (a live product never had
 *  the questions of an analysis, so that section is not shown). */
export const LIVE_SECTIONS: readonly { id: "understanding" | "requirements" | "scope"; label: string; parts: readonly DocPart[] }[] = [
  { id: "understanding", get label() { return t("analysis.live.section.understanding", "Project understanding"); }, parts: ["understood", "files"] },
  { id: "requirements", get label() { return t("analysis.live.section.requirements", "Goals & requirements"); }, parts: ["objective", "features", "workflows"] },
  { id: "scope", get label() { return t("analysis.live.section.scope", "Scope & success"); }, parts: ["scope", "screens", "milestones", "success"] },
];

/** A section's status from its parts' own statuses, so the header never says more than its parts: "From the live
 *  product" once any part was written down from it, "Not documented yet" while one still waits for it, "Not used" when
 *  every part is empty, otherwise the first part's own status (a section of the person's own files). */
export function liveSectionStatus(parts: readonly Pick<PartSummary, "status">[]): PartSummary["status"] {
  if (parts.some((p) => p.status === "documented")) return "documented";
  if (parts.some((p) => p.status === "undocumented")) return "undocumented";
  if (parts.length > 0 && parts.every((p) => p.status === "skipped")) return "skipped";
  return parts.find((p) => p.status !== "skipped")?.status ?? "skipped";
}

/** The detailed pages' one line about a live product (it says only what is true: written down, or not yet). */
export function liveSectionsText(documented: boolean): string {
  return documented
    ? t("analysis.live.sectionsDocumented", "This product came to the Factory as a live product, so it had no analysis. These are the parts as they were written down from it, each in full.")
    : t("analysis.live.sectionsNotDocumented", "This product came to the Factory as a live product, so it had no analysis. Once it is documented from its code and documents, each part shows here in full.");
}

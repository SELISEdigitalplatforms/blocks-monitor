/** Pure helpers of the Business step page: the hand-over state and the ?item= selection. No React, no network. */
import { canHandOver } from "../../domain/projects";
import { SCRATCH_ID } from "./treeModel";
import { getCulture, t } from "@/i18n";
import type { DocKind } from "../../domain/docs";
import type { RepoVisibility } from "../../domain/projectType";

/** A folder kind's name in the current language (src/domain keeps its labels English: it runs on the server too). */
export function docKindName(kind: DocKind): string {
  switch (kind) {
    case "meeting": return t("analysis.business.kind.meeting", "Meeting");
    case "presentation": return t("analysis.business.kind.presentation", "Presentation");
    case "event": return t("analysis.business.kind.event", "Event");
    case "ideation": return t("analysis.business.kind.ideation", "Ideation");
    default: return t("analysis.business.kind.other", "Other");
  }
}

/** A repository's visibility in the current language. */
export function visibilityName(v: RepoVisibility): string {
  return v === "internal" ? t("analysis.business.visibility.internal", "Internal") : t("analysis.business.visibility.private", "Private");
}

/** The page's words, read in the current language when called (render time). */
export const businessSubtitle = () => t("analysis.business.subtitle", "Your answers and everything you already have: meetings, ideas, documents and files.");
export const handOverLabel = () => t("analysis.business.handOver", "Hand over to product");
export const needEdit = () => t("analysis.business.needEdit", "You need permission to edit the project setup.");
export const needContent = () => t("analysis.business.needContent", "Write something in the Scratch pad or a note, or upload a file, first.");
export const continueLabel = (brownfield: boolean) => (brownfield
  ? t("analysis.business.continueExisting", "Continue to Existing product analysis")
  : t("analysis.business.continueSanitization", "Continue to Product sanitization"));

export interface HandOverInput {
  project: { handedOverAt: string | null; handedOverByUserId?: string | null; type?: string; repoOwner?: string; repoName?: string; repoBranch?: string };
  counts: { notes: number; readyFiles: number };
  /** whether the scratch pad has a record (it counts as one note; the server checks its text precisely) */
  hasScratch?: boolean;
  canEdit: boolean;
  newCount: number;
  handedOverByName?: string | null;
}

export interface HandOverState {
  mode: "before" | "after";
  label: string;
  disabled: boolean;
  reason: string | null;
  summary?: string;
}

export function formatHandOverTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = getCulture() === "de-CH" ? "de-CH" : "en-GB";
  const date = d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

export function handOverState(i: HandOverInput): HandOverState {
  if (i.project.handedOverAt) {
    const when = formatHandOverTime(i.project.handedOverAt);
    const handed = i.project.handedOverByUserId
      ? t("analysis.business.handedOverBy", "Handed over on {when} by {name}", { when, name: i.handedOverByName?.trim() || t("analysis.business.formerMember", "a former member") })
      : t("analysis.business.handedOverOn", "Handed over on {when}", { when });
    return {
      mode: "after",
      label: continueLabel(i.project.type === "brownfield"),
      disabled: false,
      reason: null,
      summary: `${handed} · ${t("analysis.business.newSinceHandOver", "{count} new since hand-over", { count: i.newCount })}`,
    };
  }
  let reason: string | null = null;
  if (!i.canEdit) reason = needEdit();
  else if (!canHandOver({ notesWithText: i.counts.notes + (i.hasScratch ? 1 : 0), readyFiles: i.counts.readyFiles })) reason = needContent();
  return { mode: "before", label: handOverLabel(), disabled: reason !== null, reason };
}

/* ── selection in ?item= ─────────────────────────────────────────────────── */

export function selectionFromSearch(params: URLSearchParams): string | null {
  const v = params.get("item");
  return v && v.trim() ? v.trim() : null;
}

export function withSelection(params: URLSearchParams, id: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id) next.set("item", id);
  else next.delete("item");
  return next;
}

interface Identified { id: string }
export interface SelectionData {
  folders: readonly Identified[];
  notes: readonly Identified[];
  files: readonly Identified[];
  scratch: Identified | null;
}

export type Resolved =
  | { kind: "none" }
  | { kind: "missing"; id: string }
  | { kind: "scratch" }
  | { kind: "folder" | "note" | "file"; id: string };

export function resolveSelection(data: SelectionData, id: string | null): Resolved {
  if (!id) return { kind: "none" };
  if (id === SCRATCH_ID || (data.scratch && data.scratch.id === id)) return { kind: "scratch" };
  if (data.folders.some((f) => f.id === id)) return { kind: "folder", id };
  if (data.notes.some((n) => n.id === id)) return { kind: "note", id };
  if (data.files.some((f) => f.id === id)) return { kind: "file", id };
  return { kind: "missing", id };
}

export function isEmptyProject(data: SelectionData): boolean {
  const scratchId = data.scratch?.id;
  return data.folders.length === 0 && data.files.length === 0 && !data.scratch
    && data.notes.filter((n) => n.id !== scratchId).length === 0;
}

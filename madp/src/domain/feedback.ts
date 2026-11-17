/**
 * Feedback: shared rules for FeedbackThread, FeedbackComment and feedback attachments.
 * Pure (imports only other src/domain files), so the collab functions and the web bundle it alike.
 * Feature, screen, story and milestone threads belong to the scope feedback ops (L7); sanitization to L5.
 */
import { fileTypeFor } from "./docs";
import { effectiveStep } from "./projects";
import type { WorkspacePermission } from "./rbac";
import { isActiveRequirementStatus, isRequirementsStepOpen } from "./requirements";

/** "extra": a key workflow, a "not included" item or a constraint of Goals & requirements (RequirementExtra). */
export const FEEDBACK_TARGETS = ["requirement", "extra"] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

export function isFeedbackTarget(x: unknown): x is FeedbackTarget {
  return typeof x === "string" && (FEEDBACK_TARGETS as readonly string[]).includes(x);
}

export const TARGET_SCHEMA: Record<FeedbackTarget, "Requirement" | "RequirementExtra"> = { requirement: "Requirement", extra: "RequirementExtra" };

/** A target accepts feedback while its record exists and is not removed. */
export function isLiveTarget(type: FeedbackTarget, row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (type === "requirement") return isActiveRequirementStatus(row.Status ?? row.status);
  if (type === "extra") return (row.Status ?? row.status) !== "removed";
  return false;
}

export type FeedbackClosedReason = "requirementsConfirmed" | "notYet";
export type FeedbackGate = { open: true } | { open: false; reason: FeedbackClosedReason };

export function feedbackGate(
  type: FeedbackTarget,
  project: { stage?: string | null; resumeTo?: string | null },
): FeedbackGate {
  if (type !== "requirement" && type !== "extra") return { open: false, reason: "notYet" };
  const step = effectiveStep(project.stage ?? "", project.resumeTo ?? undefined);
  if (isRequirementsStepOpen(step)) return { open: true };
  return { open: false, reason: step === "business" || step === "sanitization" ? "notYet" : "requirementsConfirmed" };
}

export const RESOLVE_PERMISSION: Record<FeedbackTarget, WorkspacePermission> = {
  requirement: "requirements.edit",
  extra: "requirements.edit",
};

export const COMMENT_MAX = 5000;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMENTS_PER_THREAD = 500;
export const STALE_DRAFT_MS = 3600000;
export const DRAFT_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

const DRAFT_PREFIX = "draft:";
export function draftOwnerId(draftKey: string): string {
  return `${DRAFT_PREFIX}${draftKey}`;
}
export function isDraftOwnerId(ownerId: string): boolean {
  return typeof ownerId === "string" && ownerId.startsWith(DRAFT_PREFIX);
}

/** Attachment.Kind (validations.json) for a file type of ./docs fileTypeFor. */
export function attachmentKind(
  fileType: ReturnType<typeof fileTypeFor>,
): "email" | "notes" | "pdf" | "doc" | "sheet" | "slides" | "image" | "audio" | "video" | "other" {
  if (!fileType) return "other";
  switch (fileType.family) {
    case "pdf": return "pdf";
    case "image": return "image";
    case "email": return "email";
    case "audio": return "audio";
    case "video": return "video";
    case "text": return fileType.ext === "csv" ? "sheet" : "notes";
    case "office":
      if (fileType.ext === "xls" || fileType.ext === "xlsx" || fileType.ext === "ods") return "sheet";
      if (fileType.ext === "ppt" || fileType.ext === "pptx" || fileType.ext === "odp") return "slides";
      return "doc";
    default: return "other";
  }
}

const INLINE_MIMES: readonly string[] = [
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain",
];
/** Passive types that may open in a new tab; everything else downloads. */
export function opensInline(mime: string): boolean {
  const m = String(mime ?? "").split(";")[0].trim().toLowerCase();
  return INLINE_MIMES.includes(m);
}

export function orderComments<T extends { at: string; id: string }>(c: readonly T[]): T[] {
  return [...c].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function threadCounts(
  thread: { status: string } | null,
  comments: readonly { kind: string; attachmentIds: readonly string[] }[],
): { comments: number; replies: number; attachments: number } {
  if (!thread) return { comments: 0, replies: 0, attachments: 0 };
  let c = 0;
  let r = 0;
  let a = 0;
  for (const x of comments) {
    if (x.kind === "comment") c += 1;
    else r += 1;
    a += x.attachmentIds.length;
  }
  return { comments: c, replies: r, attachments: a };
}

export function threadKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export function statusChange(current: string, wanted: string): "noop" | "change" {
  return current === wanted ? "noop" : "change";
}

// ── The feedback → work loop (feedback.apply) ─────────────────────────────────────────────────────────────────────
// open: a person commented and the team has not started; working: the team is on it (feedback.apply runs);
// updated: the team answered or changed the item and waits for the person; resolved: the person accepted and closed it.

export const THREAD_STATUSES = ["open", "working", "updated", "resolved"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export function isThreadStatus(x: unknown): x is ThreadStatus {
  return typeof x === "string" && (THREAD_STATUSES as readonly string[]).includes(x);
}
/** What a person may set: reopen a thread, or accept and close it. "working" and "updated" are the team's. */
export const PERSON_THREAD_STATUSES = ["open", "resolved"] as const;

/** comment: a person's words; system: a recorded event (applied, kept, closed); agent: the team's reply;
 *  proposal: the team's suggested new wording of the item (see proposalText), waiting for "Apply change" / "Keep as is". */
export const COMMENT_KINDS = ["comment", "system", "agent", "proposal"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];
export const isPersonComment = (kind: string): boolean => kind === "comment";
export const isTeamComment = (kind: string): boolean => kind === "agent" || kind === "proposal";

/** A thread the team still has to finish (shown as a warning before the scope is locked or the requirements approved). */
export function needsWork(status: string): boolean {
  return status === "open" || status === "working";
}

/** The thread's status once a person adds a comment: the team picks it up (a running job stays "working"). */
export function statusAfterComment(current: string): ThreadStatus {
  return current === "working" ? "working" : "open";
}

/** The ActiveKey target of the one feedback.apply job per thread. */
export const FEEDBACK_JOB_TARGET = "feedback-thread";

/** Plain words for each status. */
export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  open: "Waiting for the team",
  working: "The team is working on this",
  updated: "Updated — have a look",
  resolved: "Accepted and closed",
};

type TeamRole = "designer" | "analyst" | "planner";

function teamOf(targetType: string): TeamRole {
  switch (targetType) {
    case "screen": return "designer";
    case "requirement":
    case "extra":
    case "sanitization": return "analyst";
    default: return "planner";
  }
}

/** Who answers in a thread, by the kind of item it is about, as people read it: the analysis role and the planner
 *  (pipeline step 01) are both the business analyst (owner, 08.11.2026). Every label the UI shows comes from here. */
export function teamLabelOf(targetType: string): string {
  return { designer: "The designer", analyst: "The business analyst", planner: "The business analyst" }[teamOf(targetType)];
}

/** The same role in the engine's words, never shown in the UI (use teamLabelOf there). Only server/ calls it (the
 *  feedback prompts in server/local/engine/kinds/feedback.ts and the engine context in
 *  server/engine-context/feedbackContext.ts), whose prompts still name the analysis role product manager: the text
 *  stays until those prompts are renamed, then it follows teamLabelOf. */
export function teamRoleOf(targetType: string): string {
  return { designer: "The designer", analyst: "The product manager", planner: "The planner" }[teamOf(targetType)];
}

/** A suggested new wording of an item, written as a FeedbackComment of kind "proposal". The stored text is what people
 *  read and what "Apply change" saves: an optional first line "New title: …", then "New text:" and the text (it may run
 *  over several lines). */
export interface Proposal { title: string; text: string }
const TITLE_LINE = "New title: ";
const TEXT_LINE = "New text:";

export function proposalText(p: Proposal): string {
  const title = p.title.replace(/\s+/g, " ").trim();
  const text = p.text.trim();
  return [title ? `${TITLE_LINE}${title}` : "", `${TEXT_LINE}${text ? ` ${text}` : ""}`].filter(Boolean).join("\n");
}

/** The proposal of a stored text (null when it is not one). */
export function parseProposal(stored: string): Proposal | null {
  const s = String(stored ?? "").replace(/\r\n/g, "\n");
  let title = "";
  let rest = s;
  if (s.startsWith(TITLE_LINE)) {
    const nl = s.indexOf("\n");
    title = (nl < 0 ? s.slice(TITLE_LINE.length) : s.slice(TITLE_LINE.length, nl)).trim();
    rest = nl < 0 ? "" : s.slice(nl + 1);
  }
  if (!rest.startsWith(TEXT_LINE)) return title ? { title, text: "" } : null;
  return { title, text: rest.slice(TEXT_LINE.length).trim() };
}

/** The proposal still waiting for a decision: the newest team entry is a proposal, nothing was recorded after it and
 *  the thread waits for the person. */
export function openProposal<T extends { kind: string; at: string; id: string }>(status: string, comments: readonly T[]): T | null {
  if (status !== "updated") return null;
  const list = orderComments(comments);
  const last = list[list.length - 1];
  return last && last.kind === "proposal" ? last : null;
}

/** The text of the system entry a person's decision writes. */
export const DECISION_TEXT = {
  applied: "Applied the suggested change.",
  kept: "Kept the item as it was.",
  accepted: "Accepted and closed.",
  reopened: "Reopened.",
} as const;
export type FeedbackDecision = keyof typeof DECISION_TEXT;

export function isStaleDraftAttachment(att: { status: string; createdAt: string }, now: Date | number): boolean {
  if (att.status !== "pending") return false;
  const created = Date.parse(att.createdAt);
  if (!Number.isFinite(created)) return false;
  const t = typeof now === "number" ? now : now.getTime();
  return t - created > STALE_DRAFT_MS;
}

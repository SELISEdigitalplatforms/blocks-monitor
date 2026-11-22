import { getCulture, t } from "../i18n";
import { teamLabelOf as teamLabelEnglish } from "../domain/feedback";
/** Feedback threads on line items: pure helpers (ordering, counts, Regenerate composition, version history).
 *  No React, DOM, store or db here, and no clock or randomness: callers pass the time and the seed. */

/** Goals & requirements: requirement, extra. Scope & success: feature, story, screen, milestone, success (a target key). */
export type FeedbackTargetType = "requirement" | "extra" | "feature" | "story" | "screen" | "milestone" | "success";
/** open → working (the team is on it) → updated (the team answered, waiting for the person) → resolved (accepted and closed). */
export type ThreadStatus = "open" | "working" | "updated" | "resolved";
/** comment: a person's words; system: a recorded event; agent: the team's reply; proposal: the team's suggested change. */
export type CommentKind = "comment" | "system" | "agent" | "proposal";

export interface FeedbackAttachmentMeta { id: string; commentId: string; name: string; mime: string; size: number }
export interface FeedbackComment {
  id: string; threadId: string; author: string; text: string; kind: CommentKind; createdAt: string;
  attachments: FeedbackAttachmentMeta[];
}
export interface FeedbackThread {
  id: string; projectId: string; targetType: FeedbackTargetType; targetId: string; status: ThreadStatus;
  createdAt: string; comments: FeedbackComment[];
}
/** One text of an item: version 1 is the original, each Regenerate adds the next. */
export interface ItemVersion {
  n: number; text: string; at: string; commentIds: string[];
  /** Set when the version applies an accepted fix from the grilling (the value stays 'second-opinion' so saved versions keep loading). */
  from?: "second-opinion";
}
/** Item versions by targetKey(type, id); only items with at least two versions are stored. */
export type ItemVersions = Record<string, ItemVersion[]>;

export const FEEDBACK_TARGET_TYPES = ["requirement", "extra", "feature", "story", "screen", "milestone", "success"] as const;
export const isTargetType = (v: unknown): v is FeedbackTargetType =>
  typeof v === "string" && (FEEDBACK_TARGET_TYPES as readonly string[]).includes(v);

/** How long the simulated "MADP is refining this item…" state shows. */
export const REFINE_MS = 1500;

export const targetKey = (type: FeedbackTargetType, id: string): string => `${type}:${id}`;

/* ── ordering and counts ── */

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : t;
};

/** A sorted copy, oldest first; invalid dates last; ties keep their input order. */
export function orderComments<T extends { createdAt: string }>(list: readonly T[]): T[] {
  return list
    .map((c, i) => ({ c, i, t: time(c.createdAt) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t < b.t ? -1 : 1))
    .map((x) => x.c);
}

export function userComments(thread: FeedbackThread | null | undefined): FeedbackComment[] {
  return thread ? orderComments(thread.comments).filter((c) => c.kind === "comment") : [];
}

export function threadCounts(thread: FeedbackThread | null | undefined): { comments: number; replies: number; attachments: number } {
  const list = userComments(thread);
  return {
    comments: list.length,
    replies: Math.max(0, list.length - 1),
    attachments: list.reduce((n, c) => n + c.attachments.length, 0),
  };
}

export const firstComment = (thread: FeedbackThread | null | undefined): FeedbackComment | null =>
  userComments(thread)[0] ?? null;

/** The comments no version has used yet (and that say something). */
export function pendingComments(thread: FeedbackThread | null | undefined, history?: readonly ItemVersion[]): FeedbackComment[] {
  const used = new Set((history ?? []).flatMap((v) => v.commentIds));
  return userComments(thread).filter((c) => c.text.trim() !== "" && !used.has(c.id));
}

/* ── Regenerate: deterministic text composition ── */

const FILLER = /^(?:(?:please|pls|could you|can you|can we|we need to|we should|i think|i'd like|maybe|also|and|add that|make sure that|make sure|ensure that|ensure)\b|note:)[\s,]*/i;

function clauseOf(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  for (;;) {
    const next = s.replace(FILLER, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[.!?;,:]+$/, "").trim();
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 160) {
    const cut = s.lastIndexOf(" ", 160);
    s = s.slice(0, cut > 0 ? cut : 160) + "…";
  }
  return s;
}

export function refineText(text: string, comments: readonly { text: string }[]): string {
  const base = text.trim();
  const seen = new Set<string>();
  const clauses: string[] = [];
  for (const c of comments) {
    const clause = clauseOf(c.text);
    if (!clause) continue;
    const low = clause.toLowerCase();
    if (seen.has(low) || base.toLowerCase().includes(low)) continue;
    seen.add(low);
    clauses.push(clause);
  }
  if (!clauses.length) return text;
  const head = /[.!?…]$/.test(base) ? base : base + ".";
  return head + clauses.map((c) => ` ${c}.`).join("");
}

/* ── version history ── */

export function regenerateHistory(
  history: readonly ItemVersion[] | undefined, base: string, comments: readonly FeedbackComment[], at: string,
): ItemVersion[] | null {
  const start: ItemVersion[] = history?.length ? [...history] : [{ n: 1, text: base, at, commentIds: [] }];
  const cur = start[start.length - 1];
  const used = comments.filter((c) => c.kind === "comment" && c.text.trim() !== "");
  const refined = refineText(cur.text, used);
  if (refined === cur.text) return null;
  return [...start, { n: cur.n + 1, text: refined, at, commentIds: used.map((c) => c.id) }];
}

export function undoHistory(history: readonly ItemVersion[]): ItemVersion[] {
  const next = history.slice(0, -1);
  return next.length < 2 ? [] : next;
}

export const currentVersion = (history: readonly ItemVersion[] | undefined): ItemVersion | null =>
  history && history.length >= 2 ? history[history.length - 1] : null;
export const currentText = (history: readonly ItemVersion[] | undefined, base: string): string =>
  currentVersion(history)?.text ?? base;
export const previousText = (history: readonly ItemVersion[] | undefined): string | null =>
  history && history.length >= 2 ? history[history.length - 2].text : null;

const isVersion = (v: unknown): v is ItemVersion => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.n === "number" && Number.isInteger(o.n) && o.n > 0 && typeof o.text === "string" && typeof o.at === "string"
    && Array.isArray(o.commentIds) && o.commentIds.every((i) => typeof i === "string");
};

export function normalizeVersions(raw: unknown): ItemVersions {
  const out: ItemVersions = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(val) || !val.every(isVersion)) continue;
    const list = (val as ItemVersion[])
      .map((v) => ({ n: v.n, text: v.text, at: v.at, commentIds: [...v.commentIds], ...(v.from === "second-opinion" ? { from: "second-opinion" as const } : {}) }))
      .sort((a, b) => a.n - b.n);
    if (list.length >= 2) out[key] = list;
  }
  return out;
}

export function withHistory(all: ItemVersions, key: string, history: readonly ItemVersion[]): ItemVersions {
  const next: ItemVersions = { ...all };
  if (history.length < 2) delete next[key];
  else next[key] = [...history];
  return next;
}

export const versionLabel = (v: ItemVersion): string =>
  v.from === "second-opinion" ? `Version ${v.n} · Updated in the grilling` :
  `Version ${v.n} · Regenerated from ${v.commentIds.length} ${v.commentIds.length === 1 ? "comment" : "comments"}`;
export const regeneratedNote = (n: number): string => `Regenerated · version ${n}`;
export const undoneNote = (n: number): string => `Undone · back to version ${n}`;

/* ── people and time ── */

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatCommentTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return t("common.time.justNowCap", "Just now");
  if (diff < 3_600_000) return t("common.time.minutesAgo", "{n} min ago", { n: Math.floor(diff / 60_000) });
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return t("common.time.todayAt", "Today, {time}", { time: hm });
  const german = getCulture() === "de-CH";
  const day = german
    ? d.toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "short" })
    : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `${day}, ${hm}` : `${day} ${d.getFullYear()}, ${hm}`;
}

/** Who answers in a thread (domain/feedback's teamLabelOf), in the chosen language. */
export function teamLabelOf(targetType: string): string {
  return teamLabelEnglish(targetType) === "The designer"
    ? t("common.roles.theDesigner", "The designer")
    : t("common.roles.theBusinessAnalyst", "The business analyst");
}

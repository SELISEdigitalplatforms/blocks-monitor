// Feedback in the project context: the comments people leave on an item (FeedbackThread + FeedbackComment rows) and
// what the team answered, so every job sees them ("I can't see your comment" never again).
//
//   snapshot  sections.feedback (snapshot.ts): per thread the item it is about in plain words (the requirement's title,
//             the screen's name, the success target's name…), its status and its entries in order (who, kind, text,
//             the attached files' names). Threads that wait for the team first, the resolved ones last and shorter.
//   ledger    userActionsOf (userEvents.ts) adds the feedback actions: "feedback.commented" (a person's comment) and
//             "feedback.resolved" (a person closed the thread, with the decision recorded: applied / kept) as "user"
//             events, and the team's entries "feedback.replied" / "feedback.proposed" as "feedback" events. Each has
//             a stable key (the comment, or the thread + the time it was closed), so a refresh never writes one twice.
//
// Pure: reads the project's rows only. Imports only types from snapshot.ts / userEvents.ts (both import this file).
import type { Row } from "../../functions/_lib/gateway";
import type { ProjectView } from "../local/engine/context.ts";
import { DECISION_TEXT, openProposal, orderComments, teamRoleOf } from "../../src/domain/feedback.ts";
import { SUCCESS_SHORT, type SuccessKey } from "../../src/domain/successTargets.ts";
import type { Item } from "./snapshot.ts";
import type { UserAction } from "./userEvents.ts";

/** One entry of a thread: a person's comment, a recorded event, the team's reply or its suggested change. */
export interface FeedbackEntry extends Item {
  /** IAM user id of the person ("" for the team: the engine's replies, suggested changes and recorded events). */
  by: string;
  /** The person's display name; "the team" for the engine's entries. */
  who: string;
  /** comment | system | agent | proposal (src/domain/feedback.ts COMMENT_KINDS). */
  kind: string;
  text: string;
  at: string;
  /** The names of the files attached to the entry. */
  files: string[];
}

export interface FeedbackThreadItem extends Item {
  targetType: string;
  targetId: string;
  /** "Schema:ItemId" of the item ("" for a success target: it is a value of the scope version, not a record). */
  target: string;
  /** What kind of item, in plain words ("Requirement R3", "Key workflow", "Screen", "Success & performance"). */
  label: string;
  /** The item's own name (its title, the screen's name, the success target's name); "" when the item is gone. */
  item: string;
  /** open | working | updated | resolved (src/domain/feedback.ts THREAD_STATUSES). */
  status: string;
  /** Who answers for the team ("The designer", "The product manager", "The planner"). */
  team: string;
  /** The team's suggested change waits for the person's "Apply change" / "Keep as is". */
  proposalWaiting: boolean;
  /** The decision a person recorded last ("Applied the suggested change.", "Kept the item as it was.", "Accepted and
   *  closed."), "" when none. */
  decision: string;
  /** All entries of the thread. */
  total: number;
  /** Entries before the ones shown. */
  earlier: number;
  /** The newest entries, oldest first (an open thread's last 8, a resolved thread's last 3). */
  entries: FeedbackEntry[];
  /** When the last entry was written. */
  lastAt: string;
}

export interface FeedbackSection {
  /** The threads that are not resolved: waiting for the team (open), being worked on, answered (updated). */
  threads: FeedbackThreadItem[];
  /** The newest resolved threads, summarised. */
  resolved: FeedbackThreadItem[];
  /** How many threads are resolved in all. */
  resolvedTotal: number;
}

const ACTIVE_MAX = 40;
const RESOLVED_MAX = 20;
const ACTIVE_ENTRIES = 8;
const RESOLVED_ENTRIES = 3;
const TEAM = "the team";
const STATUS_RANK: Record<string, number> = { open: 0, working: 1, updated: 2 };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Clipped, keeping line breaks (a suggested change's "New title: …" / "New text: …" lines). */
const clip = (s: string, max: number): string => {
  const t = s.replace(/\r\n/g, "\n").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
/** Clipped on one line. */
const one = (s: string, max: number): string => clip(s.replace(/\s+/g, " "), max);
const ids = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      return ids(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return typeof v === "string" && v.trim() ? [v.trim()] : [];
};
const ISO = /^\d{4}-\d\d-\d\dT/;
const engineRow = (r: Row): boolean => str(r.RequestKey).startsWith("engine:");
const exampleRow = (r: Row): boolean => str(r.SeedKey) !== "";
/** The engine job that wrote a row ("engine:<jobId>:<attempt>:…"), or "". */
const jobOf = (r: Row): string => (engineRow(r) ? str(r.RequestKey).split(":")[1] ?? "" : "");

const EXTRA_LABEL: Readonly<Record<string, string>> = { workflow: "Key workflow", exclusion: "Not included", constraint: "Constraint" };

/** What a thread is about: the kind of item in plain words, the item's own name and its "Schema:ItemId". */
export function feedbackItemOf(p: ProjectView, targetType: string, targetId: string): { label: string; item: string; target: string } {
  const row = (schema: string) => (targetId ? p.row(schema, targetId) : undefined);
  const named = (schema: string, label: string, name: (r: Row) => string) => {
    const r = row(schema);
    return { label, item: r ? one(name(r), 200) : "", target: `${schema}:${targetId}` };
  };
  switch (targetType) {
    case "requirement": {
      const r = row("Requirement");
      return { label: r && num(r.Number) ? `Requirement R${num(r.Number)}` : "Requirement", item: r ? one(str(r.Title) || str(r.Text), 200) : "", target: `Requirement:${targetId}` };
    }
    case "extra": {
      const r = row("RequirementExtra");
      return { label: EXTRA_LABEL[str(r?.Kind)] ?? "Goals & requirements item", item: r ? one(str(r.Title), 200) : "", target: `RequirementExtra:${targetId}` };
    }
    case "feature":
      return named("Feature", "Feature", (r) => str(r.Title));
    case "story":
      return named("Story", "User story", (r) => str(r.Title) || str(r.Text));
    case "screen":
      return named("DesignScreen", "Screen", (r) => str(r.Name) || str(r.Key));
    case "milestone":
      return named("Milestone", "Milestone", (r) => str(r.Name) || str(r.Title));
    case "success":
      return { label: "Success & performance", item: SUCCESS_SHORT[targetId as SuccessKey] ?? targetId, target: "" };
    case "sanitization":
      return { label: "Project understanding", item: p.name, target: `Project:${targetId}` };
    default:
      return { label: targetType || "Item", item: "", target: "" };
  }
}

interface ThreadRows {
  thread: Row;
  id: string;
  comments: { row: Row; id: string; at: string; kind: string }[];
}

/** The project's threads that have entries, each with its entries oldest first. */
function threadsOf(p: ProjectView): ThreadRows[] {
  const byThread = new Map<string, Row[]>();
  for (const c of p.rows("FeedbackComment")) {
    const t = str(c.ThreadId);
    if (!t) continue;
    const list = byThread.get(t) ?? [];
    list.push(c);
    byThread.set(t, list);
  }
  const out: ThreadRows[] = [];
  for (const t of p.rows("FeedbackThread")) {
    const id = str(t.ItemId);
    const rows = byThread.get(id);
    if (!id || !rows?.length) continue;
    out.push({ thread: t, id, comments: orderComments(rows.map((row) => ({ row, id: str(row.ItemId), at: str(row.At) || str(row.CreatedDate), kind: str(row.Kind) || "comment" }))) });
  }
  return out;
}

/** The names of the files attached to each comment (ready files: by the comment's AttachmentIds and by their owner). */
function filesOf(p: ProjectView): (comment: Row) => string[] {
  const byId = new Map<string, Row>();
  const byOwner = new Map<string, Row[]>();
  for (const a of p.rows("Attachment")) {
    if (a.Status !== "ready") continue;
    byId.set(str(a.ItemId), a);
    if (str(a.OwnerType) === "feedback-comment" && str(a.OwnerId) && !str(a.OwnerId).startsWith("draft:")) {
      const list = byOwner.get(str(a.OwnerId)) ?? [];
      list.push(a);
      byOwner.set(str(a.OwnerId), list);
    }
  }
  return (c) => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const a of [...ids(c.AttachmentIds).map((id) => byId.get(id)), ...(byOwner.get(str(c.ItemId)) ?? [])]) {
      if (!a || seen.has(str(a.ItemId))) continue;
      seen.add(str(a.ItemId));
      names.push(one(str(a.FileName) || "file", 120));
    }
    return names;
  };
}

const DECISIONS: readonly string[] = [DECISION_TEXT.applied, DECISION_TEXT.kept, DECISION_TEXT.accepted];

/** The last decision a person recorded in the thread (a system entry with an author), or null. */
function lastDecision(t: ThreadRows): ThreadRows["comments"][number] | null {
  for (let i = t.comments.length - 1; i >= 0; i -= 1) {
    const c = t.comments[i]!;
    if (c.kind === "system" && str(c.row.AuthorUserId) && DECISIONS.includes(str(c.row.Text).trim())) return c;
    if (c.kind === "system" && str(c.row.Text).trim() === DECISION_TEXT.reopened) return null;
  }
  return null;
}

/** The feedback section of the project's context, or null when nobody has commented yet. */
export function feedbackSectionOf(p: ProjectView): FeedbackSection | null {
  const threads = threadsOf(p);
  if (!threads.length) return null;
  const files = filesOf(p);
  const who = (by: string) => (by ? p.personName(by) || "a person" : TEAM);
  const items = threads.map((t): FeedbackThreadItem => {
    const status = str(t.thread.Status) || "open";
    const resolved = status === "resolved";
    const shown = t.comments.slice(-(resolved ? RESOLVED_ENTRIES : ACTIVE_ENTRIES));
    const max = resolved ? 300 : 800;
    const what = feedbackItemOf(p, str(t.thread.TargetType), str(t.thread.TargetId));
    const decision = lastDecision(t);
    return {
      ref: `FeedbackThread:${t.id}`,
      targetType: str(t.thread.TargetType),
      targetId: str(t.thread.TargetId),
      ...what,
      status,
      team: teamRoleOf(str(t.thread.TargetType)),
      proposalWaiting: openProposal(status, t.comments) !== null,
      decision: decision ? str(decision.row.Text).trim() : "",
      total: t.comments.length,
      earlier: t.comments.length - shown.length,
      entries: shown.map((c) => {
        const by = str(c.row.AuthorUserId);
        return { ref: `FeedbackComment:${c.id}`, by, who: who(by), kind: c.kind, text: clip(str(c.row.Text), max), at: c.at, files: files(c.row) };
      }),
      lastAt: t.comments[t.comments.length - 1]!.at,
    };
  });
  const newest = (a: FeedbackThreadItem, b: FeedbackThreadItem) => b.lastAt.localeCompare(a.lastAt) || a.ref.localeCompare(b.ref);
  const active = items.filter((t) => t.status !== "resolved").sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || newest(a, b));
  const resolved = items.filter((t) => t.status === "resolved").sort(newest);
  return { threads: active.slice(0, ACTIVE_MAX), resolved: resolved.slice(0, RESOLVED_MAX), resolvedTotal: resolved.length };
}

/** The feedback actions the rows show (people's comments and closes, the team's replies and suggested changes), for
 *  the ledger (userEvents.ts userActionsOf). Example rows (SeedKey) are not actions. */
export function feedbackActionsOf(p: ProjectView): UserAction[] {
  const out: UserAction[] = [];
  const add = (a: UserAction) => {
    if (a.at && ISO.test(a.at)) out.push(a);
  };
  const files = filesOf(p);
  for (const t of threadsOf(p)) {
    const targetType = str(t.thread.TargetType);
    const what = feedbackItemOf(p, targetType, str(t.thread.TargetId));
    const base = { thread: `FeedbackThread:${t.id}`, targetType, ...(what.target ? { target: what.target } : {}), label: what.label, item: what.item };
    for (const c of t.comments) {
      if (exampleRow(c.row)) continue;
      const ref = `FeedbackComment:${c.id}`;
      const author = str(c.row.AuthorUserId);
      const text = one(str(c.row.Text), 300);
      if (c.kind === "comment" && author && !engineRow(c.row)) {
        const names = files(c.row);
        add({ key: `feedback.commented:${c.id}`, action: "feedback.commented", ref, by: author, at: c.at, detail: { ...base, text, ...(names.length ? { files: names } : {}) } });
      } else if ((c.kind === "agent" || c.kind === "proposal") && !author) {
        const action = c.kind === "agent" ? "feedback.replied" : "feedback.proposed";
        const jobId = jobOf(c.row);
        add({ key: `${action}:${c.id}`, type: "feedback", action, ref, by: "", at: c.at, detail: { ...base, text, ...(jobId ? { jobId } : {}) } });
      }
    }
    // closed by a person: when and by whom the decision entry says (else the thread row's last update)
    if (str(t.thread.Status) !== "resolved" || exampleRow(t.thread)) continue;
    const d = lastDecision(t);
    const by = d ? str(d.row.AuthorUserId) : str(t.thread.UpdatedByUserId);
    const at = d ? d.at : str(t.thread.LastUpdatedDate);
    if (!by) continue;
    const decision = d ? str(d.row.Text).trim() : "";
    add({
      key: `feedback.resolved:${t.id}:${at}`, action: "feedback.resolved", ref: `FeedbackThread:${t.id}`, by, at,
      detail: { ...base, ...(decision === DECISION_TEXT.applied ? { decision: "applied" } : decision === DECISION_TEXT.kept ? { decision: "kept" } : {}), ...(decision ? { decisionText: decision } : {}) },
    });
  }
  return out;
}

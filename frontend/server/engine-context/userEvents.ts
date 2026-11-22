// What people did in the project, as ledger events of their own (type "user"): the office's who-it's-for and goal
// answers, answers and set-aside questions, their own questions, approvals and decisions, the second opinion's points
// they decided, approval policies they set up, the scope lock, milestone accepts, chat questions, uploads, notes and
// the files attached to answers, chats and feedback. Read from the records' own fields (who: the *ByUserId / author
// field, when: the *At field or the record's creation), so an event says who did it and when even when it is noticed
// later: by the context refresh before a job, or by the worker's periodic refresh of the active projects
// (engineWorker/contextRefresh.ts).
//
// Each action has a stable key (record + the time it happened); the ledger is the memory of what was recorded, so a
// refresh appends only the actions not in it yet (the first refresh of an older project records its history once).
// Rows the engine wrote (RequestKey "engine:…") and example rows (SeedKey) are not people's actions.
//
// Feedback (feedbackContext.ts feedbackActionsOf): a person's comment on an item ("feedback.commented") and the close of
// a thread ("feedback.resolved", with the decision recorded) are "user" events; the team's replies and suggested
// changes ("feedback.replied", "feedback.proposed") are "feedback" events, recorded by the same refresh.
import type { Row } from "../../functions/_lib/gateway";
import type { ProjectView } from "../local/engine/context.ts";
import { attachedFile, attachmentOwnerSchema, type Sections } from "./snapshot.ts";
import { feedbackActionsOf } from "./feedbackContext.ts";
import { appendLedger, readLedger, type LedgerEvent } from "./store.ts";
import { offerKindOf } from "../../src/domain/chatActions";

export interface UserAction {
  key: string;
  /** The ledger event's type: "user" (default) for people's actions, "change" for the engine's steps of a change
   *  request (changeEvents.ts), "feedback" for the team's entries in a feedback thread (feedbackContext.ts), "chat" for
   *  what an agent offered in a chat (an action the person may tap). */
  type?: "user" | "change" | "feedback" | "chat";
  action: string;
  /** "Schema:ItemId" of the record the action is on. */
  ref: string;
  /** IAM user id ("" when the record does not say). */
  by: string;
  /** ISO time it happened. */
  at: string;
  detail?: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clip = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const ISO = /^\d{4}-\d\d-\d\dT/;
/** A short stable key of a text (an answer's own words, so each answer given is one event). */
const textKey = (s: string): string => {
  let h = 2166136261;
  for (const ch of s.replace(/\s+/g, " ").trim()) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h.toString(36);
};
const engineRow = (r: Row): boolean => str(r.RequestKey).startsWith("engine:") || str(r.SeedKey) !== "";
const personRow = (r: Row): boolean => !engineRow(r);

/** The people's actions the project's records show, oldest first (pure). */
export function userActionsOf(p: ProjectView, sections?: Pick<Sections, "sources"> | null): UserAction[] {
  const out: UserAction[] = [];
  const add = (a: UserAction) => {
    if (!a.at || !ISO.test(a.at) || !a.ref.includes(":")) return;
    out.push(a);
  };
  const ref = (schema: string, r: Row) => `${schema}:${str(r.ItemId)}`;
  const project = p.project;
  const pid = str(project.ItemId);

  // the project's own steps
  if (str(project.BusinessHandedOverAt)) {
    add({ key: `handed-over:${pid}:${str(project.BusinessHandedOverAt)}`, action: "setup.handed-over", ref: `Project:${pid}`, by: str(project.BusinessHandedOverByUserId), at: str(project.BusinessHandedOverAt) });
  }
  const brief = sections?.sources?.brief;
  if (brief?.confirmedAt) {
    add({ key: `understanding:${pid}:${brief.confirmedAt}`, action: "understanding.confirmed", ref: `Project:${pid}`, by: brief.confirmedByUserId, at: brief.confirmedAt });
  }
  if (str(project.SanitizationCompletedAt)) {
    add({ key: `sanitization:${pid}:${str(project.SanitizationCompletedAt)}`, action: "questions.completed", ref: `Project:${pid}`, by: "", at: str(project.SanitizationCompletedAt) });
  }
  // the office's answers saved through project.setup (who it is for, the goal): one event per answer given, when and by
  // whom the project row says it was last saved (the row has no time of its own per answer)
  for (const [field, action] of [["TargetUsers", "setup.users-answered"], ["Goal", "setup.goal-answered"]] as const) {
    const v = str(project[field]).trim();
    if (!v) continue;
    // project.setup is open only before the hand-over: an answer given then is no later than the hand-over
    const saved = str(project.LastUpdatedDate) || str(project.CreatedDate);
    const handed = str(project.BusinessHandedOverAt);
    const at = handed && ISO.test(handed) && handed < saved ? handed : saved;
    // after the hand-over the row's last updater can be someone (or the engine) acting later: the person who handed
    // the setup over is the one who gave its answers
    const by = (handed && str(project.BusinessHandedOverByUserId)) || str(project.UpdatedByUserId) || str(project.CreatedByUserId);
    add({ key: `${action}:${pid}:${textKey(v)}`, action, ref: `Project:${pid}`, by, at, detail: { answer: clip(v, 300) } });
  }
  if (str(project.RequirementsConfirmedAt)) {
    add({ key: `requirements:${pid}:${str(project.RequirementsConfirmedAt)}`, action: "requirements.approved", ref: `Project:${pid}`, by: str(project.RequirementsConfirmedByUserId), at: str(project.RequirementsConfirmedAt) });
  }

  // questions and answers
  for (const c of p.clarifications()) {
    const r = ref("Clarification", c);
    const q = { number: num(c.Number), question: clip(str(c.Question), 200) };
    if (personRow(c)) add({ key: `asked:${r}`, action: "question.added", ref: r, by: str(c.CreatedByUserId), at: str(c.CreatedDate), detail: q });
    if (c.Status === "answered" && str(c.AnsweredAt)) {
      add({ key: `answered:${r}:${str(c.AnsweredAt)}`, action: "question.answered", ref: r, by: str(c.AnsweredByUserId), at: str(c.AnsweredAt), detail: { ...q, answer: clip(str(c.Answer), 300) } });
    } else if (c.Status === "deferred") {
      add({ key: `aside:${r}:${str(c.LastUpdatedDate)}`, action: "question.set-aside", ref: r, by: str(c.UpdatedByUserId), at: str(c.LastUpdatedDate), detail: { ...q, reason: clip(str(c.DeferReason), 200) } });
    }
  }
  for (const d of p.rows("Decision")) {
    if ((d.Status === "accepted" || d.Status === "rejected") && str(d.DecidedAt)) {
      add({ key: `decision:${str(d.ItemId)}:${str(d.Status)}:${str(d.DecidedAt)}`, action: `decision.${str(d.Status)}`, ref: ref("Decision", d), by: str(d.DecidedByUserId), at: str(d.DecidedAt), detail: { title: clip(str(d.Title), 160) } });
    }
  }
  for (const t of p.rows("TechDecision")) {
    if ((t.Status === "accepted" || t.Status === "rejected") && str(t.DecidedAt)) {
      add({ key: `tech:${str(t.ItemId)}:${str(t.Status)}:${str(t.DecidedAt)}`, action: `tech-decision.${str(t.Status)}`, ref: ref("TechDecision", t), by: str(t.DecidedByUserId), at: str(t.DecidedAt), detail: { title: clip(str(t.Title), 160) } });
    }
  }

  // material people shared
  for (const f of p.rows("DocFile")) {
    if (!personRow(f) || f.Status === "deleted" || f.Status === "rejected") continue;
    add({ key: `upload:${str(f.ItemId)}`, action: "file.uploaded", ref: ref("DocFile", f), by: str(f.CreatedByUserId), at: str(f.CreatedDate), detail: { name: clip(str(f.Name), 160), sizeBytes: num(f.SizeBytes), mime: str(f.Mime) } });
  }
  // files people attached to an answer, a change request, a chat message or feedback (once the record they belong to
  // is saved: a "draft:" owner is a text still being written)
  for (const a of p.rows("Attachment")) {
    if (!attachedFile(a) || !personRow(a)) continue;
    add({
      key: `attached:${str(a.ItemId)}`, action: "file.attached", ref: ref("Attachment", a), by: str(a.CreatedByUserId), at: str(a.CreatedDate),
      detail: { owner: `${attachmentOwnerSchema(str(a.OwnerType))}:${str(a.OwnerId)}`, ownerType: str(a.OwnerType), name: clip(str(a.FileName) || "file", 160), sizeBytes: num(a.SizeBytes), mime: str(a.Mime) },
    });
  }
  for (const n of p.rows("DocNote")) {
    if (!personRow(n) || (!str(n.BodyMd).trim() && !str(n.Title).trim())) continue;
    add({ key: `note:${str(n.ItemId)}`, action: "note.added", ref: ref("DocNote", n), by: str(n.CreatedByUserId), at: str(n.CreatedDate), detail: { title: clip(str(n.Title), 160) } });
  }
  for (const r of p.rows("Requirement")) {
    if (personRow(r)) add({ key: `requirement:${str(r.ItemId)}`, action: "requirement.added", ref: ref("Requirement", r), by: str(r.CreatedByUserId), at: str(r.CreatedDate), detail: { title: clip(str(r.Title), 160) } });
  }
  for (const x of p.rows("RequirementExtra")) {
    if (x.Origin === "person") add({ key: `extra:${str(x.ItemId)}`, action: "requirement-extra.added", ref: ref("RequirementExtra", x), by: str(x.CreatedByUserId), at: str(x.CreatedDate), detail: { kind: str(x.Kind), title: clip(str(x.Title), 160) } });
  }
  for (const b of p.rows("DesignBrief")) {
    if (str(b.ConfirmedAt)) add({ key: `look:${str(b.ItemId)}:${str(b.ConfirmedAt)}`, action: "look-and-feel.confirmed", ref: ref("DesignBrief", b), by: str(b.ConfirmedByUserId), at: str(b.ConfirmedAt) });
  }

  // scope, milestones, approvals, releases
  for (const v of p.rows("ScopeVersion")) {
    const r = ref("ScopeVersion", v);
    const n = { scopeVersion: num(v.Number) };
    if (str(v.ScreensReviewedAt)) add({ key: `screens:${r}:${str(v.ScreensReviewedAt)}`, action: "screens.reviewed", ref: r, by: str(v.ScreensReviewedBy), at: str(v.ScreensReviewedAt), detail: n });
    if (str(v.LockedAt)) add({ key: `lock:${r}:${str(v.LockedAt)}`, action: "scope.locked", ref: r, by: str(v.LockedByUserId), at: str(v.LockedAt), detail: n });
    if (str(v.UnlockedAt)) add({ key: `unlock:${r}:${str(v.UnlockedAt)}`, action: "scope.unlocked", ref: r, by: "", at: str(v.UnlockedAt), detail: n });
  }
  for (const m of p.rows("Milestone")) {
    if (str(m.AcceptedAt)) add({ key: `accept:${str(m.ItemId)}:${str(m.AcceptedAt)}`, action: "milestone.accepted", ref: ref("Milestone", m), by: str(m.AcceptedByUserId), at: str(m.AcceptedAt), detail: { name: clip(str(m.Name), 160), scopeVersion: num(m.ScopeVersion) } });
  }
  // the second opinion's points people decided (accepted, answered, dismissed)
  for (const c of p.rows("Challenge")) {
    const status = str(c.Status);
    if (!["accepted", "answered", "dismissed"].includes(status) || !str(c.DecidedAt) || !str(c.DecidedByUserId)) continue;
    const words = status === "accepted" ? str(c.FinalText) || str(c.SuggestedFix) : status === "answered" ? str(c.AnswerText) : str(c.DismissReason);
    add({
      key: `challenge:${str(c.ItemId)}:${status}:${str(c.DecidedAt)}`, action: `second-opinion.${status}`, ref: ref("Challenge", c), by: str(c.DecidedByUserId), at: str(c.DecidedAt),
      detail: { point: clip(str(c.Question), 200), rule: str(c.ChallengeType), ...(words ? { [status === "dismissed" ? "reason" : status === "answered" ? "answer" : "fix"]: clip(words, 300) } : {}) },
    });
  }
  // approval policies people set up (the policy row and its approver steps; each save is one event)
  const policySteps = p.rows("ApprovalStep").filter((s) => str(s.ParentType) === "policy");
  for (const pol of p.rows("ApprovalPolicy")) {
    if (!personRow(pol)) continue;
    const mine = policySteps.filter((s) => str(s.ParentId) === str(pol.ItemId));
    const latest = [pol, ...mine].reduce((a, b) => (str(b.LastUpdatedDate) > str(a.LastUpdatedDate) ? b : a));
    const at = str(latest.LastUpdatedDate) || str(pol.CreatedDate);
    const by = str(latest.UpdatedByUserId) || str(pol.UpdatedByUserId) || str(pol.CreatedByUserId);
    if (!by) continue;
    add({
      key: `policy:${str(pol.ItemId)}:${at}`, action: "approval-policy.saved", ref: ref("ApprovalPolicy", pol), by, at,
      detail: { environment: str(pol.Environment), status: str(pol.Status), steps: mine.length, approvers: [...new Set(mine.flatMap((s) => (Array.isArray(s.ApproverUserIds) ? (s.ApproverUserIds as unknown[]) : [s.ApproverUserId]).filter((x): x is string => typeof x === "string" && x !== "")))].length },
    });
  }
  for (const a of p.rows("ApprovalRequest")) {
    const by = str(a.RequestedByUserId) || str(a.CreatedByUserId);
    if (by) add({ key: `approval-asked:${str(a.ItemId)}`, action: "approval.requested", ref: ref("ApprovalRequest", a), by, at: str(a.RequestedAt) || str(a.CreatedDate), detail: { environment: str(a.Environment), version: str(a.Version) } });
  }
  for (const s of p.rows("ApprovalStep")) {
    if (!str(s.DecidedAt) || !str(s.Decision)) continue;
    const parent = str(s.ParentType) === "request" ? "ApprovalRequest" : str(s.ParentType) === "policy" ? "ApprovalPolicy" : str(s.ParentType);
    add({ key: `approval:${str(s.ItemId)}:${str(s.DecidedAt)}`, action: `approval.${str(s.Decision)}`, ref: ref("ApprovalStep", s), by: str(s.DecidedByUserId), at: str(s.DecidedAt), detail: { step: clip(str(s.Label) || str(s.StepType), 120), request: parent && str(s.ParentId) ? `${parent}:${str(s.ParentId)}` : "" } });
  }
  for (const r of p.rows("Release")) {
    if (str(r.ReleasedAt) && str(r.ReleasedByUserId)) add({ key: `release:${str(r.ItemId)}:${str(r.ReleasedAt)}`, action: "release.released", ref: ref("Release", r), by: str(r.ReleasedByUserId), at: str(r.ReleasedAt), detail: { environment: str(r.Environment), version: str(r.Version) } });
  }

  // questions people asked in the chats, the actions the agents offered there and the ones people took
  const chat = p.rows("AgentChatMessage");
  for (const m of chat) {
    if (m.Role === "user") add({ key: `chat:${str(m.ItemId)}`, action: "chat.asked", ref: ref("AgentChatMessage", m), by: str(m.AuthorUserId) || str(m.CreatedByUserId), at: str(m.At) || str(m.CreatedDate), detail: { thread: `agent:${str(m.AgentRole)}`, text: clip(str(m.Text), 300) } });
    const offered = m.Role === "agent" && m.Kind === "text" ? offerKindOf(m.TaskTarget) : null;
    if (offered) {
      add({
        key: `chat-offer:${str(m.ItemId)}`, type: "chat", action: "chat.action-offered", ref: ref("AgentChatMessage", m), by: "", at: str(m.At) || str(m.CreatedDate),
        detail: { thread: `agent:${str(m.AgentRole)}`, offer: offered, title: clip(str(m.TaskTitle), 160), ...(str(m.TaskFeatureRef) ? { target: str(m.TaskFeatureRef) } : {}), engineJobId: str(m.EngineJobId) },
      });
    }
  }
  for (const m of chat) {
    // the confirmation of a tapped offer (it carries the answer's job): the action's own record, who took it and when
    if (m.Kind !== "task-created" || !str(m.EngineJobId)) continue;
    const offer = chat.find((o) => o.Role === "agent" && o.Kind === "text" && offerKindOf(o.TaskTarget) && str(o.TaskId) === str(m.TaskId) && str(o.EngineJobId) === str(m.EngineJobId));
    if (!offer) continue;
    const result = str(m.TaskTarget) === "change-request" ? "ChangeRequest" : str(m.TaskTarget) === "preview-fix" ? "Ticket" : "FeedbackComment";
    add({
      key: `chat-taken:${str(offer.ItemId)}`, action: "chat.action-taken", ref: ref("AgentChatMessage", offer), by: str(m.CreatedByUserId), at: str(m.At) || str(m.CreatedDate),
      detail: { thread: `agent:${str(m.AgentRole)}`, offer: offerKindOf(offer.TaskTarget), result: `${result}:${str(m.TaskId)}`, code: str(m.TaskCode), title: clip(str(m.TaskTitle), 160) },
    });
  }
  for (const m of p.rows("AssistantMessage")) {
    if (m.Role === "user") add({ key: `chat:${str(m.ItemId)}`, action: "chat.asked", ref: ref("AssistantMessage", m), by: str(m.CreatedByUserId), at: str(m.At) || str(m.CreatedDate), detail: { thread: `assistant:${str(m.Environment)}`, text: clip(str(m.Text), 300) } });
  }
  // comments people left on items, the threads they closed, and the team's answers in them
  for (const a of feedbackActionsOf(p)) add(a);
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/** The keys of the user (and change, feedback) events in the ledger. */
export function recordedKeys(events: readonly LedgerEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const e of events) if ((e.type === "user" || e.type === "change" || e.type === "feedback" || e.type === "chat") && typeof e.key === "string") keys.add(e.key);
  return keys;
}

/** Appends the people's actions the ledger does not hold yet; answers how many were added. `nameOf` gives a person's
 *  name for the event (never anything else about them). */
export function recordUserActions(
  dir: string,
  actions: readonly UserAction[],
  o: { contextVersion: number; nameOf?: (userId: string) => string; now?: Date },
): number {
  const known = recordedKeys(readLedger(dir));
  const recordedAt = (o.now ?? new Date()).toISOString();
  let n = 0;
  for (const a of actions) {
    if (known.has(a.key)) continue;
    known.add(a.key);
    const name = a.by && o.nameOf ? o.nameOf(a.by) : "";
    appendLedger(dir, {
      type: a.type ?? "user", at: a.at, action: a.action, ref: a.ref, by: a.by, ...(name ? { byName: name } : {}),
      ...(a.detail ?? {}), contextVersion: o.contextVersion, recordedAt, key: a.key,
    });
    n += 1;
  }
  return n;
}

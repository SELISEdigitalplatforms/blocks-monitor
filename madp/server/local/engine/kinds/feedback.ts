// feedback.apply: the team works on a comment a person left in a feedback thread (FeedbackThread / FeedbackComment).
// The ops queue it for every new comment (one active job per thread: comments that arrive while it runs are picked up
// by the same job before it ends). The job reads the thread, its comments, the files attached to them
// (ai/attachments.ts: pictures go to Claude as images), the item and the project context, and:
//   1. answers in the thread at once (Kind "agent": what it understood and what it will do) and sets the thread to
//      "working";
//   2. does the work:
//      - a screen (scope still open): the designer redesigns that one screen, a new DesignScreen version (feedback/screen.ts);
//        the thread moves to the new version, so it follows the newest screen;
//      - a requirement, extra, feature, story, milestone or success target whose step is still open: proposes the
//        changed wording (Kind "proposal", src/domain/feedback.ts proposalText); "Apply change" saves it through the
//        item's normal edit op;
//      - anything once the scope is locked (or the requirements are approved): a change request with the full comment,
//        the item and the attached files, sent to the change analysis when the change process is open (cr.submit's rules);
//      - the question discussion: an answer;
//   3. sets the thread to "updated" (waiting for the person; their "Accept and close" sets "resolved").
// Built-in text keeps every step working when Claude is not there.
import type { Row } from "../../../../functions/_lib/gateway";
import { f } from "../../../../functions/_lib/filter";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { effectiveStep } from "../../../../src/domain/projects";
import { feedbackGate, orderComments, proposalText, teamRoleOf, type Proposal } from "../../../../src/domain/feedback";
import { parseSuccessTargets, SUCCESS_KEYS, SUCCESS_LABEL, type SuccessKey } from "../../../../src/domain/successTargets";
import { num, str, strs } from "../context.ts";
import { JobFailure, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { aiJson } from "../ai/index.ts";
import { S, text as aiText } from "../ai/check.ts";
import { projectMaterial } from "../ai/material.ts";
import { ATTACHMENT_OWNERS, attachmentRows, attachmentsBlock, attachmentsOf, imagesOf, type AttachedFile } from "../ai/attachments.ts";
import { clip, sentence } from "../text.ts";
import { redesignScreen } from "./feedback/screen.ts";

const COMMENT_FIELDS = ["ItemId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At", "RequestKey"];
const THREAD_FIELDS = ["ItemId", "ProjectId", "TargetType", "TargetId", "Status"];
/** Rounds one job works before it ends (each round answers the comments that came in meanwhile). */
const MAX_ROUNDS = 4;

type Mode = "redesign" | "propose" | "change" | "answer";

/** What a thread is about, as the team works on it. */
export interface FeedbackItem {
  type: string;
  id: string;
  /** "screen", "requirement", "workflow", "feature"… in plain words. */
  noun: string;
  /** The item's name as people see it. */
  name: string;
  /** The wording a proposal changes (title "" where the item has none of its own). */
  title: string;
  text: string;
  /** People can still change the item directly (its step is open). */
  editable: boolean;
  /** The scope is locked (the build follows it). */
  locked: boolean;
  /** The feature it belongs to ("feature:<key>"), "" when none is known. */
  featureRef: string;
  row: Row | null;
}

// ------------------------------------------------------------------ reads

/** The thread's comments as stored now (the Data Gateway, so a comment written while the job runs is seen), merged
 *  with what this job wrote; oldest first. */
async function commentsOf(run: JobRun, threadId: string): Promise<Row[]> {
  const byId = new Map<string, Row>();
  for (const c of run.p.rows("FeedbackComment")) if (c.ThreadId === threadId) byId.set(str(c.ItemId), c);
  try {
    const fresh = await run.deps.gateway.findAll("FeedbackComment", { where: f.eq("ThreadId", threadId), fields: COMMENT_FIELDS, max: 600 });
    for (const c of fresh) if (c.ProjectId === run.projectId) byId.set(str(c.ItemId), { ...byId.get(str(c.ItemId)), ...c });
  } catch (e) {
    run.log(`comments: the stored thread was not read (${e instanceof Error ? e.message.slice(0, 120) : "error"}); using the job's copy`);
  }
  return orderComments([...byId.values()].map((c) => ({ ...c, at: str(c.At), id: str(c.ItemId) }))).map(({ at: _a, id: _i, ...c }) => c as Row);
}

async function threadOf(run: JobRun, threadId: string): Promise<Row | null> {
  const local = run.p.row("FeedbackThread", threadId);
  try {
    const fresh = await run.deps.gateway.get("FeedbackThread", threadId, THREAD_FIELDS);
    if (fresh && fresh.ProjectId === run.projectId) return { ...local, ...fresh, ItemId: threadId };
  } catch {
    /* the job's copy below */
  }
  return local ?? null;
}

/** The person's comments the team has not answered yet (pure): those after the team's last entry (agent or proposal)
 *  of an earlier job. Within one job, `handled` are the comments it answered and `mine` the entries it wrote, so a
 *  comment written while the job worked (it sorts before the job's last entry) is still answered in its next round. */
export function unanswered(comments: readonly Row[], handled: ReadonlySet<string> = new Set(), mine: ReadonlySet<string> = new Set()): Row[] {
  let lastTeam = -1;
  comments.forEach((c, i) => {
    if ((c.Kind === "agent" || c.Kind === "proposal") && !mine.has(str(c.ItemId))) lastTeam = i;
  });
  return comments.slice(lastTeam + 1).filter((c) => c.Kind === "comment" && str(c.Text).trim() !== "" && !handled.has(str(c.ItemId)));
}

const scopeLocked = (run: JobRun): boolean => {
  const v = run.p.scopeVersionRow();
  return str(v?.Status) === "locked" || !!str(run.p.project.ScopeLockedAt);
};
const scopeOpen = (run: JobRun): boolean => !scopeLocked(run) && effectiveStep(str(run.p.project.Stage), str(run.p.project.ResumeTo)) === "scope";
const requirementsOpen = (run: JobRun): boolean => feedbackGate("requirement", { stage: str(run.p.project.Stage), resumeTo: str(run.p.project.ResumeTo) }).open;

/** The item a thread is about (pure over the project's rows). */
export function itemOf(run: JobRun, thread: Row): FeedbackItem {
  const type = str(thread.TargetType);
  const id = str(thread.TargetId);
  const p = run.p;
  const locked = scopeLocked(run);
  const base = { type, id, locked, featureRef: "", row: null as Row | null };
  switch (type) {
    case "screen": {
      const row = p.row("DesignScreen", id) ?? null;
      return { ...base, row, noun: "screen", name: str(row?.Name) || "this screen", title: "", text: "", editable: !locked };
    }
    case "requirement": {
      const row = p.row("Requirement", id) ?? null;
      const n = num(row?.Number);
      return { ...base, row, noun: "requirement", name: str(row?.Title) || (n ? `requirement R${n}` : "this requirement"), title: str(row?.Title), text: str(row?.Text), editable: requirementsOpen(run) };
    }
    case "extra": {
      const row = p.row("RequirementExtra", id) ?? null;
      const kind = str(row?.Kind);
      const workflow = kind === "workflow";
      return {
        ...base,
        row,
        noun: workflow ? "key workflow" : kind === "constraint" ? "constraint" : "item that is not included",
        name: str(row?.Title) || "this item",
        title: workflow ? str(row?.Title) : "",
        text: workflow ? strs(row?.Steps).join("\n") : str(row?.Title),
        editable: requirementsOpen(run),
      };
    }
    case "feature": {
      const row = p.row("Feature", id) ?? null;
      return { ...base, row, noun: "feature", name: str(row?.Title) || "this feature", title: str(row?.Title), text: str(row?.Description), editable: scopeOpen(run), featureRef: row ? `feature:${str(row.Key)}` : "" };
    }
    case "story": {
      const row = p.row("Story", id) ?? null;
      return { ...base, row, noun: "user story", name: str(row?.Title) || clip(str(row?.Text), 80) || "this story", title: "", text: str(row?.Text) || str(row?.Title), editable: scopeOpen(run), featureRef: str(row?.FeatureRef) };
    }
    case "milestone": {
      const row = p.row("Milestone", id) ?? null;
      return { ...base, row, noun: "milestone", name: str(row?.Name) || (num(row?.Number) ? `milestone ${num(row?.Number)}` : "this milestone"), title: str(row?.Name), text: str(row?.Goal), editable: scopeOpen(run), featureRef: strs(row?.FeatureRefs)[0] ?? "" };
    }
    case "success": {
      const key = (SUCCESS_KEYS as readonly string[]).includes(id) ? (id as SuccessKey) : null;
      const value = key ? parseSuccessTargets(p.scopeVersionRow()?.SuccessTargets)[key]?.value ?? "" : "";
      return { ...base, noun: "success target", name: key ? SUCCESS_LABEL[key] : "this target", title: "", text: value, editable: scopeOpen(run) };
    }
    default:
      return { ...base, noun: "question", name: p.name || "the project", title: "", text: "", editable: false };
  }
}

export function modeOf(item: FeedbackItem): Mode {
  if (item.type === "sanitization") return "answer";
  if (item.type === "screen") return item.editable && item.row ? "redesign" : "change";
  if (!item.row && item.type !== "success") return "answer";
  return item.editable ? "propose" : "change";
}

// ------------------------------------------------------------------ words

const quote = (s: string, max = 160) => `“${clip(s.replace(/\s+/g, " ").trim().replace(/[.!?;:,\s]+$/, ""), max)}”`;

/** The first answer, written before the work (pure). */
export function ackText(item: FeedbackItem, mode: Mode, comment: string): string {
  switch (mode) {
    case "redesign":
      return `Got it. I'm redesigning the ${item.name} screen now: ${quote(comment)}. The new version will show up here when it is ready.`;
    case "propose":
      return `Got it. I'm drafting new wording for this ${item.noun} that covers ${quote(comment)}. I'll post it here for you to apply or keep as it is.`;
    case "change":
      return item.locked
        ? "The scope is locked, so the build follows it as it is. I'm writing your comment up as a change request, so the team can see what it changes and plan it."
        : `This ${item.noun} is approved already, so I'm writing your comment up as a change request for the team.`;
    default:
      return "Thanks, I'm looking at this now.";
  }
}

function threadLines(run: JobRun, comments: readonly Row[], role: string): string {
  return comments
    .filter((c) => c.Kind !== "system")
    .slice(-12)
    .map((c) => `- ${c.Kind === "comment" ? run.p.personName(str(c.AuthorUserId)) || "The client" : role}: ${clip(str(c.Text).replace(/\s+/g, " "), 600)}`)
    .join("\n");
}

/** The built-in proposal (pure): the comment's ask added to the item's wording. */
export function builtInProposal(item: FeedbackItem, comment: string): Proposal {
  const ask = sentence(comment.replace(/\s+/g, " ").trim());
  if (!item.text.trim()) return { title: item.title, text: ask };
  if (item.type === "extra" && item.title) return { title: item.title, text: `${item.text.trim()}\n${ask}` };
  return { title: item.title, text: `${item.text.trim().replace(/[.\s]*$/, ".")} ${ask}` };
}

const PROPOSAL_SCHEMA = S.obj({
  title: S.str("The item's new title, or \"\" to keep it (always \"\" when the item has no title of its own)."),
  text: S.str("The item's complete new wording (not only the change), in the same style and length as now."),
});

export function acceptProposal(raw: unknown, item: FeedbackItem): Proposal | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const text = aiText(r.text, 4000, 3);
  if (!text) return null;
  const title = item.title ? aiText(r.title, 160, 2) ?? "" : "";
  return { title: title && title !== item.title ? title : item.title, text };
}

async function proposalOf(run: JobRun, item: FeedbackItem, o: { comment: string; thread: string; files: AttachedFile[]; round: string }): Promise<Proposal> {
  const m = await projectMaterial(run, { budget: 1800, contextBudget: 1400 });
  const role = item.type === "requirement" || item.type === "extra" ? "You are the product manager of the product team." : "You are the planner of the product team.";
  const ai = await aiJson(run, {
    task: `feedback proposal ${o.round}`,
    role: `${role} A client commented on one ${item.noun}; you rewrite that ${item.noun} so it does what the comment asks.`,
    prompt: [
      `Rewrite this ${item.noun} of ${run.p.name} following the client's comment. Keep what the comment does not touch.`,
      "",
      item.title ? `Title now: ${item.title}` : "",
      `Wording now: ${item.text || "(empty)"}`,
      item.type === "extra" && item.title ? "The wording is the workflow's steps, one per line." : "",
      "",
      `The client's comment: """${o.comment}"""`,
      o.thread ? `\nThe conversation so far:\n${o.thread}` : "",
      attachmentsBlock(o.files),
      "",
      `Material:\n${m.text}`,
    ].filter((l) => l !== "").join("\n"),
    schema: PROPOSAL_SCHEMA,
    images: imagesOf(o.files, "attached to the comment"),
    accept: (raw) => acceptProposal(raw, item),
  });
  return ai ?? builtInProposal(item, o.comment);
}

const ANSWER_SCHEMA = S.obj({ reply: S.str("Your answer in the thread: two to five plain sentences.") });

async function answerOf(run: JobRun, item: FeedbackItem, o: { comment: string; thread: string; files: AttachedFile[]; round: string }): Promise<string> {
  const m = await projectMaterial(run, { budget: 2200, contextBudget: 1600 });
  const ai = await aiJson(run, {
    task: `feedback answer ${o.round}`,
    role: "You are the product manager of the product team, answering the client in a discussion about the project.",
    prompt: [
      `Answer the client's latest comment about ${item.name}. Say what you understood and what the team does with it next; ask one short question back only when something is really unclear.`,
      "",
      `The client's comment: """${o.comment}"""`,
      o.thread ? `\nThe conversation so far:\n${o.thread}` : "",
      attachmentsBlock(o.files),
      "",
      `Material:\n${m.text}`,
    ].filter((l) => l !== "").join("\n"),
    schema: ANSWER_SCHEMA,
    images: imagesOf(o.files, "attached to the comment"),
    accept: (raw) => aiText((raw as Record<string, unknown>)?.reply, 1500, 10),
  });
  const latest = o.comment.split("\n\n").at(-1) ?? o.comment;
  return ai ?? `Thanks, noted: ${quote(latest, 200)}. The team reads this with the questions and takes it into account in the requirements draft.`;
}

// ------------------------------------------------------------------ change requests

/** The feature a change is about: the item's own, else the locked feature whose title shares the most words with the
 *  item and the comment (pure). */
export function featureRefOf(item: FeedbackItem, comment: string, features: readonly Row[]): string {
  if (item.featureRef) return item.featureRef;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const want = words(`${item.name} ${comment}`);
  let best: { ref: string; score: number } | null = null;
  for (const ft of features) {
    const have = words(`${str(ft.Title)} ${str(ft.Description)}`);
    const score = [...want].filter((w) => have.has(w)).length;
    if (!best || score > best.score) best = { ref: `feature:${str(ft.Key)}`, score };
  }
  return best?.ref ?? "";
}

/** "Landing Hero: wide header banner across the whole page" (at most 120 characters). */
export function changeTitle(item: FeedbackItem, comment: string): string {
  const first = comment.trim().split(/(?<=[.!?])\s+|\n+/)[0]!.trim().replace(/[.!?]+$/, "");
  const t = `${item.name}: ${first}`;
  return t.length <= 120 ? t : `${t.slice(0, 117).replace(/\s+\S*$/, "")}…`;
}

async function fileChange(run: JobRun, item: FeedbackItem, o: { comment: Row; text: string; files: AttachedFile[] }): Promise<{ id: string; number: number; analysing: boolean; outputs: string[] }> {
  const p = run.p;
  const existing = p.changeRequests().find((c) => c.RequestKey === run.key(`cr-${str(o.comment.ItemId)}`));
  const outputs: string[] = [];
  let id = existing ? str(existing.ItemId) : "";
  let number = num(existing?.Number);
  if (!existing) {
    const features = p.includedFeatures();
    const ref = featureRefOf(item, o.text, features);
    const title = changeTitle(item, o.text);
    const fileNote = o.files.length ? `\n\nFiles attached to the comment: ${o.files.map((x) => x.name).join(", ")}.` : "";
    const description = clip(`${o.text.trim()}\n\nAbout the ${item.noun} “${item.name}” (a comment in its feedback thread).${fileNote}`, 4000);
    // the next number; a clash with a change written at the same moment takes the one after it
    for (let attempt = 0; attempt < 4 && !id; attempt++) {
      let top = 0;
      try {
        const r = await run.deps.gateway.find("ChangeRequest", { where: f.eq("ProjectId", run.projectId), fields: ["ItemId", "Number"], sort: { field: "Number", dir: "desc" }, pageSize: 1 });
        top = num(r.items[0]?.Number);
      } catch {
        top = p.changeRequests().reduce((mx, c) => Math.max(mx, num(c.Number)), 0);
      }
      const n = top + 1 + attempt;
      const local = attempt === 0 ? `cr-${str(o.comment.ItemId)}` : `cr-${str(o.comment.ItemId)}-${attempt}`;
      const got = await run.insert(
        "ChangeRequest",
        { Number: n, Lane: ref ? "change" : "add", FeatureRef: ref, Title: title, Description: description, Status: "draft", RequestedByUserId: str(o.comment.AuthorUserId) || run.requester, EngineJobId: run.id },
        local,
        { by: str(o.comment.AuthorUserId) || undefined },
      );
      // a unique-key answer of another change (the same number) is not ours
      if (run.deps.store.get("ChangeRequest", got)?.RequestKey === run.key(local)) {
        id = got;
        number = n;
      }
    }
    if (!id) throw new JobFailure("The change request could not be numbered. Comment again in a moment.");
  }
  outputs.push(`ChangeRequest:${id}`);
  // the comment's files go with the change (copies owned by the change request; the comment keeps its own)
  for (const a of attachmentRows(run, ATTACHMENT_OWNERS.comment, [str(o.comment.ItemId)])) {
    const copy = await run.insert(
      "Attachment",
      {
        OwnerType: ATTACHMENT_OWNERS.changeRequest,
        OwnerId: id,
        FileId: str(a.FileId),
        FileName: str(a.FileName),
        StoredName: str(a.StoredName),
        Kind: str(a.Kind) || "other",
        Mime: str(a.Mime),
        SizeBytes: num(a.SizeBytes),
        Origin: str(a.Origin) || "upload",
        Meta: str(a.Meta),
        Status: "ready",
      },
      `cr-file-${str(a.ItemId)}`,
      { by: str(a.CreatedByUserId) || undefined },
    );
    outputs.push(`Attachment:${copy}`);
  }
  // cr.submit's rules: the change analysis opens after the first release to dev
  const cr = p.row("ChangeRequest", id);
  const devReleases = p.releases("dev").length;
  let analysing = str(cr?.Status) === "analysing";
  if (!analysing && devReleases > 0 && str(cr?.Status) === "draft") {
    const jobId = await run.queueJob({
      kind: "change.analyse",
      input: { projectId: run.projectId, changeRequestId: id },
      target: { type: "ChangeRequest", id },
      requestKey: `job:change.analyse:${id}:feedback`,
    });
    await run.update("ChangeRequest", id, { Status: "analysing" });
    outputs.push(`EngineJob:${jobId}`);
    analysing = true;
  }
  return { id, number, analysing, outputs };
}

// ------------------------------------------------------------------ the writer

/** An ISO time after `after` (a thread is sorted by At). */
function atAfter(run: JobRun, after: string): string {
  const now = run.now().getTime();
  const t = Date.parse(after);
  return new Date(Number.isFinite(t) && t >= now ? t + 1 : now).toISOString();
}

async function say(run: JobRun, threadId: string, kind: "agent" | "proposal", text: string, after: string, local: string): Promise<string> {
  return run.insert(
    "FeedbackComment",
    { ThreadId: threadId, AuthorUserId: "", Kind: kind, Text: clip(text, 4900), AttachmentIds: [], At: atAfter(run, after) },
    local,
    // the team's rows carry the requester as their writer, like every engine row
  );
}

async function setStatus(run: JobRun, threadId: string, status: string): Promise<void> {
  await run.update("FeedbackThread", threadId, { Status: status });
}

async function round(run: JobRun, threadId: string, thread: Row, comments: Row[], pending: Row[], n: number): Promise<{ outputs: string[]; message: string }> {
  const item = itemOf(run, thread);
  const mode = modeOf(item);
  const role = teamRoleOf(item.type);
  const last = pending[pending.length - 1]!;
  const ask = pending.map((c) => str(c.Text).trim()).join("\n\n");
  const outputs: string[] = [];
  const k = (s: string) => `r${n}-${str(last.ItemId).slice(0, 12)}-${s}`;

  // 1. answer at once, and show the thread as being worked on
  let lastAt = str(last.At);
  if (mode !== "answer") {
    const ackId = await say(run, threadId, "agent", ackText(item, mode, str(last.Text)), lastAt, k("ack"));
    outputs.push(`FeedbackComment:${ackId}`);
    lastAt = str(run.p.row("FeedbackComment", ackId)?.At) || lastAt;
  }
  await setStatus(run, threadId, "working");
  await run.step(10 + n, mode === "redesign" ? `Redesigning the ${item.name} screen.` : mode === "change" ? "Writing up a change request." : `Working on the comment about ${item.name}.`);

  // 2. the files of the comments being answered (pictures go to Claude)
  const files = await attachmentsOf(run, ATTACHMENT_OWNERS.comment, pending.map((c) => str(c.ItemId)));
  const history = threadLines(run, comments.filter((c) => !pending.includes(c)), role);
  const outputsOf = (r: { outputs: string[] }) => outputs.push(...r.outputs);
  let message = "";

  if (mode === "redesign") {
    const made = await redesignScreen(run, { target: item.row!, comment: ask, thread: history, files: attachmentsBlock(files), images: imagesOf(files, "attached to the comment"), round: k("design") });
    outputsOf(made);
    // the thread follows the newest version of the screen
    if (made.newTargetId && made.newTargetId !== item.id) await run.update("FeedbackThread", threadId, { TargetId: made.newTargetId });
    const reply = `Here is version ${made.version} of the ${made.name} screen. ${made.summary} Compare it with the previous version, then accept it or comment again.`;
    outputs.push(`FeedbackComment:${await say(run, threadId, "agent", reply, lastAt, k("done"))}`);
    message = `Redesigned the ${made.name} screen (version ${made.version}).`;
  } else if (mode === "propose") {
    const proposal = await proposalOf(run, item, { comment: ask, thread: history, files, round: k("proposal") });
    // the proposal is the thread's last entry: "Apply change" / "Keep as is" belong to it
    outputs.push(`FeedbackComment:${await say(run, threadId, "proposal", proposalText(proposal), lastAt, k("proposal"))}`);
    message = `Suggested new wording for the ${item.noun} ${quote(item.name, 60)}.`;
  } else if (mode === "change") {
    const cr = await fileChange(run, item, { comment: last, text: ask, files });
    outputsOf(cr);
    const next = cr.analysing
      ? "The team is analysing it now: what it changes, how long it takes and what it costs. You'll see the result with the change request."
      : "It goes to the team for analysis once the first version is live on dev; you can follow it with the other change requests.";
    const reply = `I've written this up as change request #${cr.number} ${quote(changeTitle(item, ask), 100)}, with your full comment${files.length ? " and the files you attached" : ""}. ${next}`;
    outputs.push(`FeedbackComment:${await say(run, threadId, "agent", reply, lastAt, k("done"))}`);
    message = `Filed change request #${cr.number} from the comment.`;
  } else {
    const answer = await answerOf(run, item, { comment: ask, thread: history, files, round: k("answer") });
    outputs.push(`FeedbackComment:${await say(run, threadId, "agent", answer, lastAt, k("answer"))}`);
    message = "Answered the comment.";
  }
  return { outputs, message };
}

export async function feedbackApply(run: JobRun): Promise<KindResult> {
  const threadId = str(run.input.threadId);
  if (!threadId) throw new JobFailure("This comment is not linked to a thread.");
  const outputs: string[] = [];
  let message = "";
  await run.step(3, "Reading the comment.");
  const handled = new Set<string>();
  const mine = new Set<string>();
  for (let n = 1; n <= MAX_ROUNDS; n++) {
    const thread = await threadOf(run, threadId);
    if (!thread) throw new JobFailure("The comment's thread is no longer there.");
    const comments = await commentsOf(run, threadId);
    const pending = unanswered(comments, handled, mine);
    if (pending.length === 0) break;
    for (const c of pending) handled.add(str(c.ItemId));
    try {
      const r = await round(run, threadId, thread, comments, pending, n);
      outputs.push(...r.outputs);
      for (const o of r.outputs) if (o.startsWith("FeedbackComment:")) mine.add(o.slice("FeedbackComment:".length));
      message = r.message;
    } catch (e) {
      if (e instanceof Error && e.name === "JobGone") throw e;
      // the person sees that the team could not finish, and the thread is open again for another try
      try {
        const last = pending[pending.length - 1]!;
        await say(run, threadId, "agent", "Sorry, I couldn't finish this one. Comment again and I'll have another go.", str(last.At), `r${n}-failed`);
        await setStatus(run, threadId, "open");
      } catch {
        /* the job's failure says it */
      }
      throw e;
    }
    // waiting for the person now; a comment that came in meanwhile is the next round
    await setStatus(run, threadId, "updated");
  }
  if (!message) {
    // nothing left to answer (another job did it): the thread is not left "working"
    const thread = await threadOf(run, threadId);
    if (thread && str(thread.Status) === "working") await setStatus(run, threadId, "updated");
    message = "Nothing new to work on in this thread.";
  }
  outputs.push(`FeedbackThread:${threadId}`);
  return { outputs: [...new Set(outputs)], message: message.slice(0, 200) };
}

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = { "feedback.apply": feedbackApply };

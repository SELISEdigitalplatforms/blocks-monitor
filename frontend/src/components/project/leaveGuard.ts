/**
 * Leaving a project for another one (the project switcher) or for another workspace (the account menu, from a project
 * page): what is still open here for the person, said the way the team would say it. Pure: no React, no store.
 * useLeaveFacts gathers the facts from the reads and rules that already say "waiting for you" elsewhere: the Team panel
 * (teamMessages.ts, needsYou), the Dashboard / Projects (projectNow.ts) and Business Analysis' "Next for you"
 * (nextAction.ts); LeaveProjectDialog shows the list. Nothing here invents a row: every line is counted from a fact.
 */
import { t } from "@/i18n";
import type { EngineJobKind, EngineJobStatus } from "@/domain/engineJob";
import type { WorkspacePermission } from "@/domain/rbac";
import { nextActionFrom, type NextFacts } from "@/components/analysis-next/next/nextAction";

/** A Business Analysis step waiting for the person's move (beyond answering questions). */
export type AnalysisWait = "check" | "start" | "continue" | "requirements" | "scope";

/** Work of the team on this project, queued or running (an EngineJob). */
export interface LeaveWork {
  jobId: string;
  kind: EngineJobKind;
  status: EngineJobStatus;
  /** "the analysis of CR-007", "the build of milestone 2" (workWhat) */
  what: string;
  /** the signed-in person asked for it (EngineJob.RequestedByUserId) */
  mine: boolean;
  /** the person holds a permission that stops it and starts it again (JOB_PAUSE_PERMISSION) */
  permitted: boolean;
}

export interface LeaveFacts {
  /** answers the business analyst waits for from the person: open questions, the brief's missing answers, open
   *  change-request questions */
  answers: number;
  /** change requests waiting for the person's approval ("CR-006") */
  decisions: readonly string[];
  /** a Business Analysis step waiting for the person (Next for you), null when none */
  analysis: AnalysisWait | null;
  /** release approval requests waiting for the person */
  releases: number;
  /** approved change builds the tech lead starts when the person says so ("the build of CR-005") */
  goAheads: readonly string[];
  /** stopped work the team starts again when the person says so */
  restarts: readonly { who: "analyst" | "lead"; what: string }[];
  /** the rest of what "waiting for you" lists for the project (projectNow.ts), in its own words: the setup to finish,
   *  a preview to try, work of the person's that did not finish */
  waiting: readonly string[];
  /** the team's work on the project, queued or running */
  work: readonly LeaveWork[];
  /** text typed and not sent ("message to your tech lead") */
  drafts: readonly { id: string; label: string }[];
}

export const NO_LEAVE_FACTS: LeaveFacts = { answers: 0, decisions: [], analysis: null, releases: 0, goAheads: [], restarts: [], waiting: [], work: [], drafts: [] };

export type UnfinishedKind = "draft" | "answers" | "approval" | "go" | "waiting" | "work";

export interface UnfinishedItem {
  id: string;
  kind: UnfinishedKind;
  text: string;
  /** work the person may pause before switching: the job and what pausing it means */
  pause?: { jobId: string; text: string };
}

const cap = (s: string) => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);
/** "CR-006", "CR-006 and CR-007", or "3 change requests" (`many` names the count in a sentence) */
const codes = (list: readonly string[], many: (n: number) => string) =>
  list.length === 1 ? list[0]! : list.length === 2 ? t("project.leave.twoCodes", "{a} and {b}", { a: list[0]!, b: list[1]! }) : many(list.length);

function analysisText(w: AnalysisWait): string {
  switch (w) {
    case "check": return t("project.leave.analysis.check", "Your business analyst needs you to check what was understood");
    case "start": return t("project.leave.analysis.start", "Your business analyst is waiting for your go to read what you shared");
    case "continue": return t("project.leave.analysis.continue", "Your business analyst is waiting for you to continue to the requirements");
    case "requirements": return t("project.leave.analysis.requirements", "Your business analyst needs your approval on the requirements");
    case "scope": return t("project.leave.analysis.scope", "Your business analyst needs you to lock the scope");
  }
}

/** May the person pause this work: it is still queued or running, they started it, and they hold a permission that
 *  starts it again. */
export function canPause(w: LeaveWork): boolean {
  return w.mine && w.permitted && (w.status === "queued" || w.status === "claimed" || w.status === "running");
}

/** What is unfinished here for the person, in the team's words; empty when nothing is (then the switch needs no
 *  question). Unsent text first (it is the one thing lost on leaving), then what the team waits for, then its work. */
export function unfinishedItems(f: LeaveFacts): UnfinishedItem[] {
  const out: UnfinishedItem[] = [];
  if (f.drafts.length === 1) out.push({ id: `draft:${f.drafts[0]!.id}`, kind: "draft", text: t("project.leave.unsentOne", "You have an unsent {what}", { what: f.drafts[0]!.label }) });
  else if (f.drafts.length > 1) out.push({ id: "drafts", kind: "draft", text: t("project.leave.unsentMany", "You have {count} unsent messages", { count: f.drafts.length }) });
  if (f.answers > 0) out.push({ id: "answers", kind: "answers", text: f.answers === 1 ? t("project.leave.answersOne", "Your business analyst is waiting for {count} answer", { count: f.answers }) : t("project.leave.answersMany", "Your business analyst is waiting for {count} answers", { count: f.answers }) });
  if (f.decisions.length) out.push({ id: "decisions", kind: "approval", text: t("project.leave.decisions", "Your business analyst needs your approval on {what}", { what: codes(f.decisions, (n) => t("project.leave.changeRequestsCount", "{count} change requests", { count: n })) }) });
  if (f.analysis) out.push({ id: `analysis:${f.analysis}`, kind: "approval", text: analysisText(f.analysis) });
  if (f.releases > 0) out.push({ id: "releases", kind: "approval", text: f.releases === 1 ? t("project.leave.releaseOne", "Your tech lead needs you to approve a release") : t("project.leave.releaseMany", "Your tech lead needs you to approve {count} releases", { count: f.releases }) });
  if (f.goAheads.length) out.push({ id: "go", kind: "go", text: t("project.leave.goAheads", "Your tech lead is waiting for your go on {what}", { what: codes(f.goAheads, (n) => t("project.leave.buildsCount", "{count} builds", { count: n })) }) });
  f.restarts.forEach((r, i) => out.push({
    id: `restart:${i}`, kind: "go",
    text: r.who === "analyst"
      ? t("project.leave.restartAnalyst", "Your business analyst can start {what} again when you say so", { what: r.what })
      : t("project.leave.restartLead", "Your tech lead can start {what} again when you say so", { what: r.what }),
  }));
  f.waiting.forEach((text, i) => out.push({ id: `waiting:${i}`, kind: "waiting", text }));
  for (const w of f.work) {
    if (w.status !== "queued" && w.status !== "claimed" && w.status !== "running") continue;
    out.push({
      id: `work:${w.jobId}`, kind: "work",
      text: w.status === "queued" ? t("project.leave.workQueued", "{what} is waiting to start", { what: cap(w.what) }) : t("project.leave.workRunning", "{what} is running", { what: cap(w.what) }),
      ...(canPause(w) ? { pause: { jobId: w.jobId, text: t("project.leave.workPause", "{what} will stop; you can resume it later.", { what: cap(w.what) }) } } : {}),
    });
  }
  return out;
}

/** The work the dialog's "Pause the work and switch" pauses (none: no such button). */
export function pausable(items: readonly UnfinishedItem[]): { jobId: string; text: string }[] {
  return items.flatMap((i) => (i.pause ? [i.pause] : []));
}

/** The dialog's title. */
export function leaveTitle(projectName: string): string {
  const name = projectName.trim();
  return name ? t("project.leave.titleNamed", "Leave {name} for now?", { name }) : t("project.leave.title", "Leave this project for now?");
}

// ------------------------------------------------------------------------------------------- Business Analysis

/** What "Next for you" waits for from the person, from the page's own facts (nextActionFrom): the brief's missing
 *  answers, or a step's move the person may make. Open questions are not counted here: they are counted once, by the
 *  "waiting for you" rule (owner of the question, or the project's person when nobody owns it). */
export function analysisWaiting(f: NextFacts): { answers: number; wait: AnalysisWait | null } {
  const none = { answers: 0, wait: null };
  const a = nextActionFrom(f);
  if (a.working || !a.button || !a.item) return none;
  switch (a.item) {
    case "brief": return f.brief?.canAnswer ? { answers: f.brief.missing, wait: null } : none;
    case "understood": return f.understood?.canConfirm ? { answers: 0, wait: "check" } : none;
    case "questions": {
      const q = f.questions;
      if (!q || q.open > 0 || !q.canEdit) return none;
      return { answers: 0, wait: q.next === "start" ? "start" : "continue" };
    }
    case "requirements": return f.requirements?.canApprove ? { answers: 0, wait: "requirements" } : none;
    case "scope": return f.scope?.canLock ? { answers: 0, wait: "scope" } : none;
    default: return none;
  }
}

// ------------------------------------------------------------------------------------------- the team's work

/** Who may stop and start each kind of work again: any one of these (job.cancel lets the requester stop it; job.retry
 *  re-checks this permission). The same map as the server's (functions/project/ops/jobs/permissions.ts), checked equal
 *  by test/project/leaveGuard.test.ts. */
export const JOB_PAUSE_PERMISSION: Readonly<Record<EngineJobKind, readonly WorkspacePermission[]>> = {
  "requirements.draft": ["requirements.edit", "sanitization.edit"],
  "sanitization.assist": ["sanitization.edit"],
  "design.generate": ["design.edit"],
  "scope.draft": ["requirements.edit", "scope.lock"],
  "scope.grill": ["scope.lock"],
  "scope.success": ["requirements.edit", "scope.lock"],
  "milestones.suggest": ["scope.lock"],
  "board.plan": ["board.edit"],
  "build.run": ["build.run"],
  "change.build": ["build.run"],
  "change.analyse": ["build.run"],
  "fix.analyse": ["build.run"],
  "preview.deploy": ["build.run"],
  "wiki.generate": ["wiki.edit"],
  "docs.generate": ["wiki.edit"],
  "chat.reply": ["comment"],
  "setup.assist": ["business.edit"],
  "feedback.apply": ["comment"],
  "file.extract": ["business.edit"],
  "engine.skills-sync": ["workspace.manage"],
  "product.document": ["business.edit"],
  "platform.feedback": [],
};

/** Work that counts as the team at work on the project: a reply to a question in a chat is not. */
export function isLeaveWork(kind: EngineJobKind): boolean {
  return kind !== "chat.reply";
}


/** The work's name in a sentence, from its kind and target: "the analysis of CR-007", "the build of milestone 2",
 *  "the release to staging". `change` names a change request (its code), `milestone` a milestone (its number). */
export function workWhat(
  kind: EngineJobKind,
  target: { change?: string | null; milestone?: number | null; deployTo?: "preview" | "dev" | "stage" | "production" },
): string {
  const ms = target.milestone ?? null;
  switch (kind) {
    case "change.analyse": return target.change ? t("project.work.changeAnalyseOf", "the analysis of {code}", { code: target.change }) : t("project.work.changeAnalyse", "the analysis of a change request");
    case "change.build": return target.change ? t("project.work.changeBuildOf", "the build of {code}", { code: target.change }) : t("project.work.changeBuild", "the build of a change request");
    case "fix.analyse": return t("project.work.fixAnalyse", "the bug analysis");
    case "build.run": return ms ? t("project.work.buildMilestone", "the build of milestone {n}", { n: ms }) : t("project.work.build", "the build");
    case "preview.deploy": {
      const to = target.deployTo ?? "preview";
      if (to === "dev") return t("project.work.releaseDev", "the release to development");
      if (to === "stage") return t("project.work.releaseStage", "the release to staging");
      if (to === "production") return t("project.work.releaseProduction", "the release to production");
      return ms ? t("project.work.previewMilestone", "the preview of milestone {n}", { n: ms }) : t("project.work.preview", "the preview");
    }
    case "board.plan": return t("project.work.boardPlan", "the work plan");
    case "requirements.draft": return t("project.work.requirementsDraft", "the requirements draft");
    case "sanitization.assist": return t("project.work.sanitizationAssist", "the reading for the clarifying questions");
    case "design.generate": return t("project.work.designGenerate", "the screen design work");
    case "scope.draft": return t("project.work.scopeDraft", "the scope draft");
    case "scope.grill": return t("project.work.scopeGrill", "the second opinion on the scope");
    case "scope.success": return t("project.work.scopeSuccess", "the success & performance draft");
    case "milestones.suggest": return t("project.work.milestonesSuggest", "the milestone plan");
    case "wiki.generate": return t("project.work.wikiGenerate", "the wiki update");
    case "docs.generate": return t("project.work.docsGenerate", "the project documentation");
    case "product.document": return t("project.work.productDocument", "the documentation of the live product");
    case "setup.assist": return t("project.work.setupAssist", "the reading of what you shared");
    case "feedback.apply": return t("project.work.feedbackApply", "the work on your feedback");
    case "file.extract": return t("project.work.fileExtract", "the reading of your file");
    case "chat.reply": return t("project.work.chatReply", "the reply to your question");
    default: return t("project.work.other", "the work");
  }
}

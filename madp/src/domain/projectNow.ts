/**
 * Where a project stands, in the client's words: the step it is at, who works on it there (the same roles the step
 * frames name, STEP-STANDARD.md) and what is waiting for you. Pure rules over the records the dashboard already reads;
 * no React, DOM or store imports.
 *
 *   Business Analysis · Business analyst · Requirements waiting for your approval
 *   Software Engineering · Development team is working on it · Preview ready to try
 *
 * The step's name is one of the four the stepper shows (Project Setup, Business Analysis, Software Engineering,
 * Release); what waits for you still follows the stored step (scope: "Scope waiting for your sign-off").
 */
import type { DashboardRecords, DashJob, DashOpenChange, DashProject } from "./dashboard";
import { isActiveJob, jobLabel, myApprovalRequests, STEP_PERMISSION, stepPath } from "./dashboard";
import { changeApproverIds, changeDecideRight, type ChangeDecideRight } from "./delivery";
import type { EngineJobKind } from "./engineJob";
import { changeWaitHref, changeWaitText, changesWaiting, sortChangeWaits, type ChangeWait, type ChangeWaitJob } from "@/components/team/changeWaiting";
import type { JourneyPage, JourneyStep } from "./journey";
import { phaseLabelOf } from "./phases";
import { isDeletingProject } from "./projects";

/** The step's name as the stepper shows it: one of the four ("Business Analysis" for requirements or scope). */
export function stepNameOf(p: Pick<DashProject, "step">): string {
  return phaseLabelOf(p.step);
}

/** Who works on each step: the role its step frame names. `short` fits a list cell. */
export const STEP_ROLE: Record<JourneyStep, { who: string; short: string }> = {
  business: { who: "Business analyst", short: "Business analyst" },
  understanding: { who: "You", short: "Your review" },
  sanitization: { who: "Business analyst", short: "Business analyst" },
  requirements: { who: "Business analyst", short: "Business analyst" },
  scope: { who: "Business analyst + solution architect", short: "Business analyst" },
  board: { who: "Development team", short: "Development team" },
  build: { who: "Development team", short: "Development team" },
  release: { who: "Release manager", short: "Release manager" },
};

export type WaitingKind = "questions" | "setup" | "understood" | "requirements" | "scope" | "preview" | "release" | "retry" | "change";

/** One thing waiting for you on one project. */
export interface WaitingItem {
  id: string;
  kind: WaitingKind;
  projectId: string;
  project: string;
  /** "2 questions from your business analyst" */
  text: string;
  /** The button's word: "Answer", "Review", "Try it". */
  action: string;
  to: string;
  /** How many things it stands for ("2 questions" is 2); 1 when absent. "Waiting for you" counts these, the way the
   *  Team panel counts what waits for you (each question, each approval, each build to start). */
  count?: number;
}

/** The project's plain status line. */
export interface ProjectNow {
  projectId: string;
  step: JourneyStep;
  stepLabel: string;
  role: string;
  roleShort: string;
  paused: boolean;
  stopped: boolean;
  /** Someone on the team is at work on it right now (an active job). */
  working: boolean;
  /** "Business analyst is working on it", "Paused", "With the release manager". */
  workingText: string;
  waiting: WaitingItem[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The job kinds that mean the team is at work on the step (not a chat reply or a wiki page). */
const WORK_KINDS: readonly EngineJobKind[] = [
  "setup.assist", "sanitization.assist", "requirements.draft", "design.generate", "scope.draft", "scope.grill", "scope.success",
  "milestones.suggest", "board.plan", "build.run", "change.build", "fix.analyse", "preview.deploy",
];

/** The person's team: the workspace's active members (who may approve a change when no policy names approvers). */
export interface NowTeam { activeMemberIds: readonly string[] }

/** What the project's change requests wait for from `me`: the Team panel's own rule (changeWaiting.ts) over the
 *  dashboard's rows. */
export function projectChangeWaits(
  records: Pick<DashboardRecords, "jobs" | "openChanges" | "policyApprovers">, projectId: string, me: string,
  permissions: readonly string[], team: NowTeam,
): ChangeWait[] {
  const changes = (records.openChanges ?? []).filter((c) => c.projectId === projectId);
  if (!me || changes.length === 0) return [];
  const jobs: ChangeWaitJob[] = records.jobs.filter((j) => j.projectId === projectId).map((j) => ({
    id: j.id, kind: j.kind, status: j.status, createdAt: j.createdAt || null, changeRequestId: j.changeRequestId ?? "",
    releaseDeploy: j.releaseDeploy === true, afterDeploy: j.afterDeploy === true,
  }));
  const approverIds = changeApproverIds([{ approverUserIds: records.policyApprovers?.[projectId] ?? [] }], team.activeMemberIds);
  const canApprove = permissions.includes("release.approve");
  const rightOf = (cr: Pick<DashOpenChange, "createdByUserId">): ChangeDecideRight => !canApprove
    ? { ok: false, reason: "notApprover", others: approverIds.filter((id) => id !== cr.createdByUserId) }
    : changeDecideRight(me, { requesterId: cr.createdByUserId, approverIds, activeMemberIds: team.activeMemberIds });
  return changesWaiting({
    changes,
    jobs, canRun: permissions.includes("build.run"), rightOf,
  });
}

/** Is the project mine: assigned to me, started by me, or I am its approver. */
export function isMine(p: DashProject, me: string): boolean {
  if (!me) return false;
  return p.assigneeUserId === me || p.createdByUserId === me || p.approverUserId === me;
}

/** Where every project stands and what waits for `me` on it, keyed by project id. A project being deleted has no entry:
 *  nothing of it waits for anyone (the dashboard's records never list it either: liveDashboardRecords). */
export function projectsNow(records: DashboardRecords, me: string, permissions: readonly string[], team: NowTeam = { activeMemberIds: [] }): Map<string, ProjectNow> {
  const out = new Map<string, ProjectNow>();
  const activeBy = new Map<string, DashJob>();
  for (const j of records.jobs) if (isActiveJob(j) && WORK_KINDS.includes(j.kind) && !activeBy.has(j.projectId)) activeBy.set(j.projectId, j);
  // only the newest job of a kind per project counts: a later run replaces an earlier failure
  const newest = new Map<string, DashJob>();
  for (const j of records.jobs) {
    const key = `${j.projectId}:${j.kind}`;
    const seen = newest.get(key);
    if (!seen || Date.parse(j.createdAt) > Date.parse(seen.createdAt)) newest.set(key, j);
  }
  const can = (step: JourneyStep) => {
    const needed = STEP_PERMISSION[step];
    return !needed || permissions.includes(needed);
  };

  for (const p of records.projects) {
    if (isDeletingProject(p)) continue;
    const role = STEP_ROLE[p.step];
    const paused = p.stage === "paused";
    const stopped = p.stage === "abandoned";
    const working = !paused && !stopped && activeBy.has(p.id);
    const mine = isMine(p, me);
    const waiting: WaitingItem[] = [];
    const add = (kind: WaitingKind, text: string, action: string, page: JourneyPage, key: string = kind, count = 1) =>
      waiting.push({ id: `${kind}:${p.id}:${key}`, kind, projectId: p.id, project: p.name, text, action, to: stepPath(p.id, page), ...(count !== 1 ? { count } : {}) });

    if (!paused && !stopped) {
      // approvals you are asked for come first: they hold a release (counted per request, not per step)
      const approvals = myApprovalRequests(records.approvals.filter((a) => a.projectId === p.id), me);
      if (approvals.length > 0) add("release", approvals.length === 1 ? "Release waiting for your approval" : `${approvals.length} releases waiting for your approval`, "Review", "release", "release", approvals.length);

      const questions = records.clarifications.filter((c) => c.projectId === p.id && (c.ownerUserId === me || (!c.ownerUserId && mine)));
      if (questions.length > 0) add("questions", `${plural(questions.length, "question", "questions")} from your business analyst`, "Answer", "sanitization", "questions", questions.length);

      // the change requests: what the Team panel marks as waiting for you, each opening its change request
      for (const w of sortChangeWaits(projectChangeWaits(records, p.id, me, permissions, team))) {
        const { text, action } = changeWaitText(w);
        waiting.push({ id: `change:${p.id}:${w.changeRequestId}:${w.kind}`, kind: "change", projectId: p.id, project: p.name, text, action, to: changeWaitHref(p.id, w), ...(w.count !== 1 ? { count: w.count } : {}) });
      }

      if (mine && !working && can(p.step)) {
        if (p.step === "business") add("setup", "Finish your project setup", "Continue", "business");
        else if (p.step === "sanitization" && questions.length === 0) add("understood", "What we understood is ready to check", "Review", "sanitization");
        else if (p.step === "requirements") add("requirements", "Requirements waiting for your approval", "Review", "requirements");
        else if (p.step === "scope" && (!p.approverUserId || p.approverUserId === me)) add("scope", "Scope waiting for your sign-off", "Review", "scope");
      }

      const previews = (records.milestones ?? []).filter((m) => m.projectId === p.id && m.status === "preview-ready");
      if (mine && previews.length > 0) {
        add("preview", previews.length === 1 ? `Preview ready to try: ${previews[0].name}` : `${previews.length} previews ready to try`, "Try it", "build", "preview", previews.length);
      }

      for (const j of newest.values()) {
        if (j.projectId !== p.id || j.status !== "failed" || j.requestedByUserId !== me) continue;
        // a change's analysis or build waits through its change request (above), never twice
        if (CHANGE_KINDS.includes(j.kind)) continue;
        add("retry", `${jobLabel(j)} didn't finish. Try again`, "Open", JOB_PAGE[j.kind] ?? p.step, j.id);
      }
    }

    const workingText = stopped ? "Stopped"
      : paused ? `Paused at ${stepNameOf(p)}`
      : working ? `${role.short} is working on it`
      : p.step === "release" ? "Released"
      : `With the ${lower(role.short)}`;
    out.set(p.id, { projectId: p.id, step: p.step, stepLabel: stepNameOf(p), role: role.who, roleShort: role.short, paused, stopped, working, workingText, waiting });
  }
  return out;
}

/** The change requests' own work: what it waits for is said once, by the change request (projectChangeWaits). */
const CHANGE_KINDS: readonly EngineJobKind[] = ["change.analyse", "change.build"];

/** How many things wait (each item's count): the "Waiting for you" number. */
export function waitingCount(items: readonly Pick<WaitingItem, "count">[]): number {
  return items.reduce((n, w) => n + (w.count ?? 1), 0);
}

/** Everything waiting for `me`, newest projects first (the order of the records), at most `cap` items. */
export function waitingForYou(now: Map<string, ProjectNow>, cap = Infinity): WaitingItem[] {
  return [...now.values()].flatMap((p) => p.waiting).slice(0, cap);
}

/** "2 things are waiting for you" / "Nothing is waiting for you". */
export function waitingSummary(count: number): string {
  if (count <= 0) return "Nothing is waiting for you";
  return `${plural(count, "thing is", "things are")} waiting for you`;
}

/** The page that shows each kind of work (a failed one opens there). */
const JOB_PAGE: Partial<Record<EngineJobKind, JourneyPage>> = {
  "setup.assist": "business",
  "file.extract": "understanding",
  "sanitization.assist": "sanitization",
  "requirements.draft": "requirements",
  "design.generate": "requirements",
  "scope.draft": "scope",
  "scope.grill": "scope",
  "scope.success": "scope",
  "milestones.suggest": "scope",
  "board.plan": "board",
  "build.run": "build",
  "change.build": "build",
  "fix.analyse": "build",
  "preview.deploy": "build",
  "wiki.generate": "wiki",
};

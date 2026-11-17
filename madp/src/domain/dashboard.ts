/**
 * Dashboard selectors: pure rules over the Blocks records the dashboard reads in one wave.
 * No React, DOM or store imports. Every number and line is counted from the records it is given.
 */
import { isTerminal, type EngineJobKind, type EngineJobStatus } from "./engineJob";
import { ENGINE_JOB_KIND_TEXT as ENGINE_JOB_KIND_LABEL } from "@/components/engine/jobWords";
import { buildTabPath, TRANSITIONS, type JourneyPage, type JourneyStep } from "./journey";
import { phaseLabelOf, stepPath as phaseStepPath } from "./phases";
import { effectiveStep, isDeletingProject } from "./projects";
import { jobAttention } from "./afterDeploy";
import { byNewest, compareNewest, latestTime, timeOf } from "../lib/newest";
import { getCulture, t } from "../i18n";

export interface DashProject {
  id: string;
  name: string;
  clientName: string;
  /** Project.Stage as stored (a paused or abandoned project stands at its resume step) */
  stage: string;
  step: JourneyStep;
  assigneeUserId: string;
  createdByUserId: string;
  updatedAt: string;
  /** Blocks CreatedDate of the project row */
  createdAt?: string;
  handedOverAt: string;
  sanitizedAt: string;
  confirmedAt: string;
  lockedAt: string;
  /** additive: the approver chosen at Project setup (Project.ApprovalOwnerUserId) */
  approverUserId?: string;
  /** additive: Project.RepoMode ("new" / "existing") */
  repoMode?: string;
  /** additive: Project.Status ("active", or "deleting" while its purge runs: never listed) */
  status?: string;
}
export interface DashJob {
  id: string;
  projectId: string;
  kind: EngineJobKind;
  status: EngineJobStatus;
  progress: number;
  requestedByUserId: string;
  createdAt: string;
  finishedAt: string;
  errorCode: string;
  /** additive: where a preview.deploy goes (its InputJson): "preview" for a milestone, else the release's environment */
  deployTo?: "preview" | "dev" | "stage" | "production";
  /** additive: what a sanitization.assist job worked on (its InputJson focus); absent means the clarifying questions */
  focus?: "clarifications" | "technical" | "requirements";
  /** additive: the change request a change.analyse or change.build job is for (its InputJson) */
  changeRequestId?: string;
  /** additive: a preview.deploy that deploys a release (names a release or an environment), not a build */
  releaseDeploy?: boolean;
  /** additive: a run of only the steps after a deploy (InputJson afterDeploy) */
  afterDeploy?: boolean;
}

/** True when a preview.deploy's input names a release or an environment: a release's deployment, not a build. */
export function releaseDeployInput(inputJson: string | null | undefined): boolean {
  return /"(release|environment)"\s*:/.test(inputJson ?? "");
}

/** Per project, the people its approval policies name: each ApprovalPolicy row (ItemId, ProjectId) with its steps
 *  (ApprovalStep rows of ParentType "policy": ParentId, ApproverUserIds), as useApprovalPolicies reads them. */
export function policyApproversOf(policies: readonly Record<string, unknown>[], steps: readonly Record<string, unknown>[]): Record<string, string[]> {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const projectOf = new Map(policies.map((p) => [s(p.ItemId), s(p.ProjectId)] as const));
  const out: Record<string, string[]> = {};
  for (const step of steps) {
    const projectId = projectOf.get(s(step.ParentId));
    if (!projectId) continue;
    const ids = Array.isArray(step.ApproverUserIds) ? step.ApproverUserIds.filter((x): x is string => typeof x === "string" && x !== "") : [];
    out[projectId] = [...new Set([...(out[projectId] ?? []), ...ids])];
  }
  return out;
}

/** What a job's InputJson says about change requests and builds (the change it is for, a release deploy, a run of
 *  only the steps after a deploy), for the rules that say what change requests wait for. */
export function jobInputFacts(kind: EngineJobKind, inputJson: string): Pick<DashJob, "changeRequestId" | "releaseDeploy" | "afterDeploy"> {
  let input: Record<string, unknown> = {};
  try {
    const v = JSON.parse(inputJson || "{}") as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) input = v as Record<string, unknown>;
  } catch {
    /* not JSON: nothing to say */
  }
  return {
    ...(kind === "change.analyse" || kind === "change.build" ? { changeRequestId: typeof input.changeRequestId === "string" ? input.changeRequestId : "" } : {}),
    ...(kind === "preview.deploy" ? { releaseDeploy: releaseDeployInput(inputJson) } : {}),
    ...(input.afterDeploy === true ? { afterDeploy: true } : {}),
  };
}

/** Where a preview.deploy job goes, from its InputJson: a milestone preview, or a release to an environment. */
export function deployTargetOf(inputJson: string): DashJob["deployTo"] {
  try {
    const i = JSON.parse(inputJson || "{}") as { release?: unknown; environment?: unknown };
    if (i.environment === "stage" || i.environment === "production") return i.environment;
    if (typeof i.release === "string" && i.release !== "") return "dev";
  } catch {
    /* not JSON: a milestone preview */
  }
  return "preview";
}

/** What a sanitization.assist job worked on, from its InputJson: the clarifying questions (the default), the technical
 *  decisions, or further requirement suggestions. */
export function assistFocusOf(inputJson: string): NonNullable<DashJob["focus"]> {
  try {
    const f = (JSON.parse(inputJson || "{}") as { focus?: unknown }).focus;
    if (f === "technical" || f === "requirements") return f;
  } catch {
    /* not JSON: the clarifying questions */
  }
  return "clarifications";
}

/** The same kind does three pieces of work; each reads as its own (never twice "Clarifying questions finished"). */
const ASSIST_LABEL: Record<NonNullable<DashJob["focus"]>, string> = {
  get clarifications() { return ENGINE_JOB_KIND_LABEL["sanitization.assist"]; },
  get technical() { return t("build.jobs.assist.technical", "Technical decisions"); },
  get requirements() { return t("build.jobs.assist.requirements", "Requirement suggestions"); },
};

const DEPLOY_LABEL: Record<NonNullable<DashJob["deployTo"]>, string> = {
  get preview() { return ENGINE_JOB_KIND_LABEL["preview.deploy"]; },
  get dev() { return t("build.jobs.deploy.dev", "Release to development"); },
  get stage() { return t("build.jobs.deploy.stage", "Release to staging"); },
  get production() { return t("build.jobs.deploy.production", "Release to production"); },
};

/** The plain name of a job for people: a release deploy reads as the release, not as a milestone preview; the
 *  technical reading as "Technical decisions", not as the clarifying questions. */
export function jobLabel(j: Pick<DashJob, "kind" | "deployTo" | "focus">): string {
  if (j.kind === "preview.deploy" && j.deployTo) return DEPLOY_LABEL[j.deployTo];
  if (j.kind === "sanitization.assist" && j.focus) return ASSIST_LABEL[j.focus];
  return ENGINE_JOB_KIND_LABEL[j.kind];
}
export type ReleaseEnv = "dev" | "stage" | "production";
export interface DashRelease {
  projectId: string; env: ReleaseEnv; version: string; status: string; releasedAt: string;
  /** additive: the build that deployed it (its EngineJobId) */
  jobId?: string;
}

/** True when the change a release deployed is on its environment but not usable there: the newest delivered build of
 *  that change left its own checks failing (src/domain/changeChecks.ts). Never shown as delivered (pure). */
export function releaseNotUsable(r: DashRelease, jobs: readonly DashJob[]): boolean {
  const job = r.jobId ? jobs.find((j) => j.id === r.jobId) : undefined;
  if (!job || job.kind !== "change.build" || !job.changeRequestId) return false;
  const newest = jobs
    .filter((j) => j.projectId === job.projectId && j.kind === "change.build" && j.changeRequestId === job.changeRequestId && j.status === "succeeded")
    .sort(compareNewest((j) => j.finishedAt))[0];
  return jobAttention(newest)?.broken ?? false;
}
export interface DashApproval {
  id: string; projectId: string; label: string; stepType: string; required: boolean; approverUserIds: string[];
  /** additive: the approval request the step belongs to (one request has several steps) and who asked for it */
  requestId?: string;
  requestedByUserId?: string;
}

/** Whether `me` is asked to decide this open step: one of its approvers, and not the requester while another approver
 *  of the step exists (four-eyes with the one-person fallback, as approvalRequest.decide). */
export function isMyApproval(a: DashApproval, me: string): boolean {
  if (!me || !a.approverUserIds.includes(me)) return false;
  return a.requestedByUserId !== me || a.approverUserIds.every((id) => id === me);
}

/** The approval requests waiting for `me`, one per request however many steps it has: the steps grouped by request. */
export function myApprovalRequests(approvals: readonly DashApproval[], me: string): DashApproval[][] {
  const by = new Map<string, DashApproval[]>();
  for (const a of approvals) {
    if (!isMyApproval(a, me)) continue;
    const key = a.requestId || a.id;
    by.set(key, [...(by.get(key) ?? []), a]);
  }
  return [...by.values()];
}
export interface DashClarification { id: string; projectId: string; number: number; question: string; ownerUserId: string }
export interface DashTicket { id: string; projectId: string; title: string; doneAt: string }
/** additive: a milestone (only the ones with a preview ready to try are read) */
export interface DashMilestone { id: string; projectId: string; name: string; status: string }
export interface DashChange { id: string; projectId: string; number: number; title: string; status: string; createdAt: string }
/** additive: a change request still on its way to development, with what decides what it waits for (its Analysis,
 *  decision and requester) */
export interface DashOpenChange {
  id: string; projectId: string; number: number; lane: string; status: string;
  analysis: string | null; decidedAt: string | null; createdByUserId: string | null;
}

export interface DashboardRecords {
  projects: readonly DashProject[];
  jobs: readonly DashJob[];
  releases: readonly DashRelease[];
  approvals: readonly DashApproval[];
  clarifications: readonly DashClarification[];
  tickets: readonly DashTicket[];
  changes: readonly DashChange[];
  /** additive: milestones whose preview is ready to try */
  milestones?: readonly DashMilestone[];
  /** additive: the change requests still on their way (what they wait for from the person) */
  openChanges?: readonly DashOpenChange[];
  /** additive: per project, the people its release approval policies name (they approve its change requests) */
  policyApprovers?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Only live projects and their rows: a project being deleted (Status "deleting") is not listed, and no row of a project
 * that is not listed (deleted, being deleted, or outside the read) reaches a count, a card or "Waiting for you". Every
 * reader of the dashboard's records gets them through this.
 */
export function liveDashboardRecords(records: DashboardRecords): DashboardRecords {
  const projects = records.projects.filter((p) => !isDeletingProject(p));
  const ids = new Set(projects.map((p) => p.id));
  const live = <T extends { projectId: string }>(rows: readonly T[] | undefined): T[] => (rows ?? []).filter((r) => ids.has(r.projectId));
  return {
    projects,
    jobs: live(records.jobs),
    releases: live(records.releases),
    approvals: live(records.approvals),
    clarifications: live(records.clarifications),
    tickets: live(records.tickets),
    changes: live(records.changes),
    milestones: live(records.milestones),
    openChanges: live(records.openChanges),
    policyApprovers: Object.fromEntries(Object.entries(records.policyApprovers ?? {}).filter(([id]) => ids.has(id))),
  };
}

const time = (iso: string): number => {
  const t = timeOf(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** True while the job is queued, claimed or running. */
export const isActiveJob = (j: Pick<DashJob, "status">): boolean => !isTerminal(j.status);
/** Build jobs: the ones that put a project on the "Live now" floor. */
const BUILD_KINDS: readonly EngineJobKind[] = ["build.run", "change.build"];

/** The page of a step: the board opens the Build page's Board tab, an analysis step its section of the Business Analysis
 *  page (/p/:id/analysis#scope), every other step its own page. */
export const stepPath = (projectId: string, page: JourneyPage): string => (page === "board" ? buildTabPath(projectId, "board") : phaseStepPath(projectId, page));

/** The permission that moves a project on from each step (from the journey's own transitions). */
export const STEP_PERMISSION: Readonly<Partial<Record<JourneyStep, string>>> = (() => {
  const out: Partial<Record<JourneyStep, string>> = {};
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    if (action === "scope.unlock" || t.by !== "user" || !t.permission) continue;
    out[t.from] = t.permission;
  }
  return out;
})();

/** The page that shows each kind of engine job. */
const JOB_PAGE: Record<EngineJobKind, JourneyPage | null> = {
  "requirements.draft": "requirements",
  "sanitization.assist": "sanitization",
  "design.generate": "requirements",
  "scope.draft": "scope",
  "scope.grill": "scope",
  "scope.success": "scope",
  "milestones.suggest": "scope",
  "board.plan": "board",
  "build.run": "build",
  "change.build": "build",
  "change.analyse": "build",
  "fix.analyse": "build",
  "preview.deploy": "build",
  "wiki.generate": "wiki",
  "docs.generate": "wiki",
  "chat.reply": null,
  "setup.assist": "business",
  "feedback.apply": null,
  "file.extract": "understanding",
  "engine.skills-sync": null,
  "product.document": "requirements",
};

/** The step a project row stands at, from its stored Stage and ResumeTo. */
export function stepOfStage(stage: string, resumeTo = ""): JourneyStep {
  return effectiveStep(stage, resumeTo);
}

export interface Kpis { projects: number; inBuild: number; released: number; waiting: number }

/** Projects, projects at the Build step (stage board or build), projects with a release, and engine jobs waiting (queued or claimed). */
export function kpis(records: Pick<DashboardRecords, "projects" | "jobs" | "releases">): Kpis {
  const ids = new Set(records.projects.map((p) => p.id));
  const released = new Set(records.releases.filter((r) => ids.has(r.projectId) && r.status !== "failed").map((r) => r.projectId));
  return {
    projects: records.projects.length,
    // the stored stage "board" is shown as the Build step everywhere else, so it counts as in build here too
    inBuild: records.projects.filter((p) => p.stage === "build" || p.stage === "board").length,
    released: released.size,
    waiting: records.jobs.filter((j) => ids.has(j.projectId) && (j.status === "queued" || j.status === "claimed")).length,
  };
}

/** Each project's latest activity (epoch ms): the newest of its own update and creation, its jobs (asked for or
 *  finished), its releases, its change requests and its done tasks. A project that only got a release still moves up. */
export function latestActivity(records: Pick<DashboardRecords, "projects" | "jobs" | "releases" | "changes" | "tickets">): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (projectId: string, ...at: string[]) => {
    const t = latestTime(...at);
    if (Number.isNaN(t)) return;
    const seen = out.get(projectId);
    if (seen === undefined || t > seen) out.set(projectId, t);
  };
  for (const p of records.projects) bump(p.id, p.updatedAt, p.createdAt ?? "");
  for (const j of records.jobs) bump(j.projectId, j.createdAt, j.finishedAt);
  for (const r of records.releases) bump(r.projectId, r.releasedAt);
  for (const c of records.changes) bump(c.projectId, c.createdAt);
  for (const tk of records.tickets) bump(tk.projectId, tk.doneAt);
  return out;
}

/** Projects, newest first: by their latest activity when it is given (latestActivity), else by their own update. */
export function byRecent(projects: readonly DashProject[], activity?: ReadonlyMap<string, number>): DashProject[] {
  return byNewest(projects, (p) => activity?.get(p.id) ?? p.updatedAt, (p) => p.createdAt ?? "");
}

/** A project's last activity as a project list shows it: its latest activity (latestActivity), else its own last
 *  update. The lists sort by it and show it, so the order and the time shown always agree. */
export function projectActivityAt(p: { id: string; lastUpdatedDate?: string }, activity?: ReadonlyMap<string, number>): string | number | undefined {
  return activity?.get(p.id) ?? p.lastUpdatedDate;
}

/** The same order for a project list read elsewhere (the Projects page, the project switcher, Home): by the last
 *  activity (projectActivityAt). */
export function projectsByActivity<T extends { id: string; lastUpdatedDate?: string; createdDate?: string }>(projects: readonly T[], activity?: ReadonlyMap<string, number>): T[] {
  return byNewest(projects, (p) => projectActivityAt(p, activity), (p) => p.createdDate ?? "");
}

export interface LiveNow { project: DashProject; job: DashJob | null }

/** The project with the newest active build.run or change.build job; otherwise the project on top of the project list
 *  (the latest activity when given, see byRecent). */
export function liveNow(projects: readonly DashProject[], jobs: readonly DashJob[], activity?: ReadonlyMap<string, number>): LiveNow | null {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const active = jobs
    .filter((j) => BUILD_KINDS.includes(j.kind) && isActiveJob(j) && byId.has(j.projectId))
    .sort(compareNewest((j) => j.createdAt))[0];
  if (active) return { project: byId.get(active.projectId)!, job: active };
  const latest = byRecent(projects, activity)[0];
  return latest ? { project: latest, job: null } : null;
}

export interface YourProject {
  id: string;
  name: string;
  clientName: string;
  step: JourneyStep;
  /** The step's name as the stepper shows it (one of the four: "Business Analysis" for scope). */
  stepLabel: string;
  paused: boolean;
  to: string;
  updatedAt: string;
}

/** The project list: name, current step and a link to that step's page, newest first (byRecent: the latest activity
 *  when given). */
export function yourProjects(projects: readonly DashProject[], activity?: ReadonlyMap<string, number>): YourProject[] {
  return byRecent(projects, activity).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    step: p.step,
    stepLabel: phaseLabelOf(p.step),
    paused: p.stage === "paused" || p.stage === "abandoned",
    to: stepPath(p.id, p.step),
    updatedAt: p.updatedAt,
  }));
}

export type ActivityKind = "journey" | "ticket" | "release" | "change" | "job";
export interface ActivityItem { id: string; kind: ActivityKind; text: string; projectId: string; project: string; at: string; to: string }

export const ACTIVITY_CAP = 10;

/** The plain environment names, the same as the Release step's (Test, Staging, Production). */
export const ENV_LABEL: Record<ReleaseEnv, string> = {
  get dev() { return t("build.release.env.dev", "Development"); },
  get stage() { return t("build.release.env.stage", "Staging"); },
  get production() { return t("build.release.env.production", "Production"); },
};

/** The latest events of the workspace, built from record timestamps, newest first. */
export function recentActivity(records: DashboardRecords, cap = ACTIVITY_CAP): ActivityItem[] {
  const byId = new Map(records.projects.map((p) => [p.id, p]));
  const out: ActivityItem[] = [];
  const add = (projectId: string, id: string, kind: ActivityKind, text: string, at: string, to: JourneyPage) => {
    const p = byId.get(projectId);
    if (!p || !at || time(at) === 0) return;
    out.push({ id, kind, text, projectId, project: p.name, at, to: stepPath(projectId, to) });
  };
  for (const p of records.projects) {
    add(p.id, `created:${p.id}`, "journey", "Project created", p.createdAt ?? "", "business");
    add(p.id, `handover:${p.id}`, "journey", "Project analysis started", p.handedOverAt, "sanitization");
    add(p.id, `sanitized:${p.id}`, "journey", "Project understood", p.sanitizedAt, "requirements");
    add(p.id, `confirmed:${p.id}`, "journey", "Requirements confirmed", p.confirmedAt, "scope");
    add(p.id, `locked:${p.id}`, "journey", "Scope locked", p.lockedAt, "board");
  }
  for (const t of records.tickets) add(t.projectId, `ticket:${t.id}`, "ticket", `Task done: ${t.title}`, t.doneAt, "board");
  for (const r of records.releases) {
    if (r.status === "released") add(r.projectId, `release:${r.projectId}:${r.env}:${r.version}`, "release", `Version ${r.version} released to ${ENV_LABEL[r.env]}`, r.releasedAt, "release");
  }
  for (const c of records.changes) add(c.projectId, `change:${c.id}`, "change", `Change asked for: ${c.title}`, c.createdAt, "release");
  for (const j of records.jobs) {
    if (j.status !== "succeeded" && j.status !== "failed") continue;
    const page = JOB_PAGE[j.kind] ?? byId.get(j.projectId)?.step ?? "business";
    const label = jobLabel(j);
    add(j.projectId, `job:${j.id}`, "job", j.status === "failed" ? `${label} didn't finish` : `${label} finished`, j.finishedAt || j.createdAt, page);
  }
  return byNewest(out, (e) => e.at).slice(0, cap);
}

export interface ReleaseRow {
  projectId: string;
  project: string;
  dev: { version: string; releasedAt: string; notUsable?: boolean } | null;
  stage: { version: string; releasedAt: string; notUsable?: boolean } | null;
  production: { version: string; releasedAt: string; notUsable?: boolean } | null;
}

/** Per project with a release: the newest version and date on dev, stage and production; with the jobs, whether the
 *  change it deployed is not usable there yet (releaseNotUsable). Newest first: the project with the newest release on
 *  top (by release time, on any environment); projects released at the same time by their latest update. */
export function releaseRows(projects: readonly DashProject[], releases: readonly DashRelease[], jobs: readonly DashJob[] = []): ReleaseRow[] {
  const rows: ReleaseRow[] = [];
  for (const p of byRecent(projects)) {
    const mine = releases.filter((r) => r.projectId === p.id && r.status === "released");
    if (mine.length === 0) continue;
    const pick = (env: ReleaseEnv) => {
      const best = mine.filter((r) => r.env === env).sort(compareNewest((r) => r.releasedAt))[0];
      return best ? { version: best.version, releasedAt: best.releasedAt, ...(releaseNotUsable(best, jobs) ? { notUsable: true } : {}) } : null;
    };
    rows.push({ projectId: p.id, project: p.name, dev: pick("dev"), stage: pick("stage"), production: pick("production") });
  }
  return byNewest(rows, (r) => latestTime(r.dev?.releasedAt, r.stage?.releasedAt, r.production?.releasedAt));
}

export type AttentionKind = "approval" | "clarification" | "job" | "assigned";
export interface AttentionItem { id: string; kind: AttentionKind; text: string; to: string }

/** What needs the caller: approvals they are asked for, their open clarifications, their failed engine jobs, projects assigned to them. */
export function needsAttention(
  records: DashboardRecords, me: string, permissions: readonly string[],
): AttentionItem[] {
  if (!me) return [];
  const byId = new Map(records.projects.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? "";
  const out: AttentionItem[] = [];
  for (const steps of myApprovalRequests(records.approvals, me)) {
    const a = steps[0]!;
    if (!byId.has(a.projectId)) continue;
    const labels = steps.map((x) => x.label).filter(Boolean).join(", ");
    out.push({ id: `approval:${a.requestId || a.id}`, kind: "approval", text: `${name(a.projectId)}: your approval is needed${labels ? ` (${labels})` : ""}`, to: stepPath(a.projectId, "release") });
  }
  for (const c of records.clarifications) {
    if (!byId.has(c.projectId) || c.ownerUserId !== me) continue;
    out.push({ id: `clarification:${c.id}`, kind: "clarification", text: `${name(c.projectId)}: question ${c.number} is waiting for your answer`, to: stepPath(c.projectId, "sanitization") });
  }
  // only the newest job of a kind per project counts: a later run replaces an earlier failure
  const newest = new Map<string, DashJob>();
  for (const j of records.jobs) {
    const key = `${j.projectId}:${j.kind}`;
    const seen = newest.get(key);
    if (!seen || time(j.createdAt) > time(seen.createdAt)) newest.set(key, j);
  }
  for (const j of newest.values()) {
    const p = byId.get(j.projectId);
    if (!p || j.status !== "failed" || j.requestedByUserId !== me) continue;
    const page = JOB_PAGE[j.kind] ?? p.step;
    out.push({ id: `job:${j.id}`, kind: "job", text: `${p.name}: ${jobLabel(j)} failed. Retry`, to: stepPath(p.id, page) });
  }
  for (const p of byRecent(records.projects)) {
    if (p.assigneeUserId !== me || p.stage === "paused" || p.stage === "abandoned") continue;
    const needed = STEP_PERMISSION[p.step];
    if (!needed || !permissions.includes(needed)) continue;
    out.push({ id: `assigned:${p.id}`, kind: "assigned", text: `${p.name}: assigned to you at ${phaseLabelOf(p.step)}`, to: stepPath(p.id, p.step) });
  }
  return out;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function relativeTime(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return t("shell.time.justNow", "just now");
  if (min < 60) return t("shell.time.minutesAgo", "{n} min ago", { n: min });
  if (min < 1440) return t("shell.time.hoursAgo", "{n} h ago", { n: Math.floor(min / 60) });
  if (min < 10_080) return t("shell.time.daysAgo", "{n} d ago", { n: Math.floor(min / 1440) });
  return new Date(ms).toLocaleDateString(getCulture() === "de-CH" ? "de-CH" : "en-GB", { day: "numeric", month: "short" });
}

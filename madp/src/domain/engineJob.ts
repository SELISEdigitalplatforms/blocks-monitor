/**
 * MADP engine job lifecycle (design 12.3 and 13.1) as a pure state machine.
 * No imports: the server functions bundle this same file.
 */

/** Every kind of work the MADP engine can be asked to do. */
export const ENGINE_JOB_KINDS = [
  "requirements.draft",
  "sanitization.assist",
  "design.generate",
  "scope.draft",
  "scope.grill",
  "scope.success",
  "milestones.suggest",
  "board.plan",
  "build.run",
  "change.build",
  "change.analyse",
  "fix.analyse",
  "preview.deploy",
  "wiki.generate",
  "docs.generate",
  "chat.reply",
  "setup.assist",
  "feedback.apply",
  "file.extract",
  "engine.skills-sync",
  "product.document",
] as const;
export type EngineJobKind = (typeof ENGINE_JOB_KINDS)[number];

/** Every status an engine job can be in. */
export const ENGINE_JOB_STATUSES = [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type EngineJobStatus = (typeof ENGINE_JOB_STATUSES)[number];

/** Statuses a job never leaves (except retry from failed). */
export const TERMINAL_STATUSES: readonly EngineJobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** True when the job has finished, one way or another. */
export function isTerminal(s: EngineJobStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** How many times a job may be claimed before it can't be retried. */
export const MAX_JOB_ATTEMPTS = 3;

const MAX_MESSAGE_LENGTH = 200;

/** Type guard for job kinds. */
export function isEngineJobKind(x: unknown): x is EngineJobKind {
  return typeof x === "string" && (ENGINE_JOB_KINDS as readonly string[]).includes(x);
}

/** Type guard for job statuses. */
export function isEngineJobStatus(x: unknown): x is EngineJobStatus {
  return typeof x === "string" && (ENGINE_JOB_STATUSES as readonly string[]).includes(x);
}

/** The mutable part of a job that the state machine owns. */
export interface EngineJobState {
  status: EngineJobStatus;
  progress: number;
  attempts: number;
  message: string | null;
}

/** A fresh job: queued, no progress, no attempts. */
export function newJobState(): EngineJobState {
  return { status: "queued", progress: 0, attempts: 0, message: null };
}

/** Who performs an event. */
export type JobActor = "user" | "engine" | "system";

/** Events that move a job. */
export type JobEvent =
  | "claim"
  | "release"
  | "start"
  | "progress"
  | "succeed"
  | "fail"
  | "cancel"
  | "retry";

/** Allowed source statuses, target status and actors for each event. */
export const JOB_TRANSITIONS: Readonly<
  Record<
    JobEvent,
    { from: readonly EngineJobStatus[]; to: EngineJobStatus | "same"; by: readonly JobActor[] }
  >
> = {
  claim: { from: ["queued"], to: "claimed", by: ["engine"] },
  release: { from: ["claimed"], to: "queued", by: ["system"] },
  start: { from: ["claimed"], to: "running", by: ["engine"] },
  progress: { from: ["running"], to: "same", by: ["engine"] },
  succeed: { from: ["claimed", "running"], to: "succeeded", by: ["engine"] },
  fail: { from: ["claimed", "running"], to: "failed", by: ["engine", "system"] },
  cancel: { from: ["queued", "claimed", "running"], to: "cancelled", by: ["user", "system"] },
  retry: { from: ["failed"], to: "queued", by: ["user"] },
};

/** True when the event is allowed for this job and actor. */
export function canApplyJobEvent(
  job: EngineJobState,
  event: JobEvent,
  actor: JobActor,
): boolean {
  const t = JOB_TRANSITIONS[event];
  if (!t.from.includes(job.status)) return false;
  if (!t.by.includes(actor)) return false;
  if (event === "retry" && job.attempts >= MAX_JOB_ATTEMPTS) return false;
  return true;
}

/** Applies an event and returns a new state; never mutates the input. */
export function applyJobEvent(
  job: EngineJobState,
  event: JobEvent,
  actor: JobActor,
  payload?: { progress?: number; message?: string },
): { ok: true; job: EngineJobState } | { ok: false; job: EngineJobState; reason: string } {
  const t = JOB_TRANSITIONS[event];
  if (isTerminal(job.status) && !(event === "retry" && job.status === "failed")) {
    return { ok: false, job, reason: "This job has already finished." };
  }
  if (!t.by.includes(actor)) {
    return { ok: false, job, reason: "You can't do that to this job." };
  }
  if (!t.from.includes(job.status)) {
    return { ok: false, job, reason: "This job isn't in a state where that can happen." };
  }
  if (event === "retry" && job.attempts >= MAX_JOB_ATTEMPTS) {
    return { ok: false, job, reason: "This job can't be retried again." };
  }

  const next: EngineJobState = { ...job };
  if (t.to !== "same") next.status = t.to;

  switch (event) {
    case "claim":
      next.attempts = job.attempts + 1;
      break;
    case "progress": {
      const raw = payload?.progress;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        next.progress = Math.max(job.progress, Math.min(100, Math.max(0, raw)));
      }
      if (typeof payload?.message === "string") {
        next.message = payload.message.slice(0, MAX_MESSAGE_LENGTH);
      }
      break;
    }
    case "succeed":
      next.progress = 100;
      break;
    case "fail":
      if (typeof payload?.message === "string") {
        next.message = payload.message.slice(0, MAX_MESSAGE_LENGTH);
      }
      break;
    case "retry":
      next.progress = 0;
      next.message = null;
      break;
    default:
      break;
  }
  return { ok: true, job: next };
}

/** Plain-language label for each status. */
export const JOB_STATUS_LABEL: Record<EngineJobStatus, string> = {
  queued: "Waiting to start",
  claimed: "Started",
  running: "In progress",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Plain-language name of each kind of engine job. */
export const ENGINE_JOB_KIND_LABEL: Record<EngineJobKind, string> = {
  "requirements.draft": "Requirements draft",
  "sanitization.assist": "Clarifying questions",
  "design.generate": "Screen designs",
  "scope.draft": "Scope draft",
  "scope.grill": "Second opinion",
  "scope.success": "Success & performance",
  "milestones.suggest": "Milestone plan",
  "board.plan": "Work plan",
  "build.run": "Build",
  "change.build": "Change build",
  "change.analyse": "Change analysis",
  "fix.analyse": "Bug analysis",
  "preview.deploy": "Milestone preview",
  "wiki.generate": "Wiki pages",
  "docs.generate": "Project documentation",
  "chat.reply": "Assistant reply",
  "setup.assist": "Reading what you shared",
  "feedback.apply": "Working on your feedback",
  "file.extract": "Reading your file",
  "engine.skills-sync": "Syncing Blocks skills",
  "product.document": "Documenting the live product",
};

/** Ops people call on the Blocks function "project" (slug mf-project). */
export const ENGINE_JOB_USER_OPS = {
  create: "job.create",
  cancel: "job.cancel",
  retry: "job.retry",
} as const;
/** One op people can call on engine jobs. */
export type EngineJobUserOp = (typeof ENGINE_JOB_USER_OPS)[keyof typeof ENGINE_JOB_USER_OPS];

/** Ops the MADP engine calls on the function mf-engine (IAM role mf-engine). */
export const ENGINE_JOB_ENGINE_OPS = {
  claim: "job.claim",
  progress: "job.progress",
  complete: "job.complete",
  fail: "job.fail",
} as const;
/** One op the MADP engine can call on engine jobs. */
export type EngineJobEngineOp = (typeof ENGINE_JOB_ENGINE_OPS)[keyof typeof ENGINE_JOB_ENGINE_OPS];

/** The only schemas a job of that kind may write. */
export const ENGINE_JOB_OUTPUTS: Readonly<Record<EngineJobKind, readonly string[]>> = {
  "requirements.draft": ["Requirement", "Objective"],
  "sanitization.assist": ["Clarification", "TechDecision"],
  "design.generate": ["DesignBrief", "StorageObject"],
  "scope.draft": ["ScopeVersion", "Feature", "Story", "Milestone"],
  "scope.grill": ["SecondOpinion", "Challenge"],
  "scope.success": ["ScopeVersion"],
  "milestones.suggest": ["Milestone"],
  "board.plan": ["Ticket"],
  "build.run": ["Run", "Ticket"],
  "change.build": ["Run", "ChangeRequest"],
  "change.analyse": ["ChangeRequest"],
  "fix.analyse": ["ChangeRequest"],
  "preview.deploy": ["Preview", "Milestone"],
  "wiki.generate": ["WikiPage"],
  "docs.generate": ["DocFile", "StorageObject"],
  "chat.reply": ["AgentChat", "AssistantMessage"],
  "setup.assist": ["SetupSuggestion", "DocFolder", "DocFile", "Project", "DocNote"],
  // the team's reply and proposal, a new screen version, or a change request with copies of the comment's files (and
  // its change.analyse job)
  "feedback.apply": ["FeedbackComment", "FeedbackThread", "DesignScreen", "StorageObject", "Suggestion", "ChangeRequest", "Ticket", "Attachment", "EngineJob"],
  // the file it read (DocFile) and what it found (a JSON object in the project's Storage folder)
  "file.extract": ["DocFile", "StorageObject"],
  "engine.skills-sync": [],
  // a live product documented from its code and documents (src/domain/liveProduct.ts): the project profile and snapshot,
  // the Business Analysis records (Origin "live-product"), the stage Release, and the wiki.generate / docs.generate jobs
  // it queues at the end
  "product.document": ["Project", "Objective", "Requirement", "RequirementExtra", "Feature", "Milestone", "ScopeVersion", "DesignBrief", "Release", "EngineJob"],
};

/** A pointer to one record a job wrote. */
export interface EngineOutputRef {
  schema: string;
  id: string;
}

/** Writes an output ref as "Schema:id". */
export function formatOutputRef(ref: EngineOutputRef): string {
  return `${ref.schema}:${ref.id}`;
}

/** Reads "Schema:id" back into a ref; null for anything else. */
export function parseOutputRef(x: unknown): EngineOutputRef | null {
  if (typeof x !== "string") return null;
  const m = /^([A-Z][A-Za-z0-9]{0,63}):([A-Za-z0-9_-]{1,128})$/.exec(x);
  return m ? { schema: m[1], id: m[2] } : null;
}

/** True when a job of this kind may write that schema. */
export function isAllowedOutput(kind: EngineJobKind, ref: EngineOutputRef): boolean {
  return ENGINE_JOB_OUTPUTS[kind].includes(ref.schema);
}

/** How long a claim lasts without a heartbeat. */
export const JOB_CLAIM_LEASE_MS = 120_000;
/** How often the engine reports progress while it works. */
export const JOB_HEARTBEAT_MS = 30_000;

/** Longest a job of each kind may run before the system stops it. */
export const JOB_MAX_RUN_MS: Readonly<Record<EngineJobKind, number>> = {
  "requirements.draft": 15 * 60_000,
  "sanitization.assist": 10 * 60_000,
  // the maximum practical limit (owner 09.11: a working design is never cut off): drawing up to 240 minutes (the
  // designer's highest allowed MF_ENGINE_FIGMA_TIMEOUT_MINUTES) + review + up to two polish rounds of 120 minutes each
  // + the brief is about 8 hours at worst; 9 hours only ends a design that is truly stuck
  "design.generate": 9 * 60 * 60_000,
  "scope.draft": 15 * 60_000,
  "scope.grill": 15 * 60_000,
  "scope.success": 5 * 60_000,
  "milestones.suggest": 10 * 60_000,
  "board.plan": 20 * 60_000,
  "build.run": 240 * 60_000,
  "change.build": 120 * 60_000,
  "change.analyse": 15 * 60_000,
  "fix.analyse": 30 * 60_000,
  "preview.deploy": 30 * 60_000,
  "wiki.generate": 30 * 60_000,
  "docs.generate": 30 * 60_000,
  "chat.reply": 3 * 60_000,
  "setup.assist": 10 * 60_000,
  "feedback.apply": 15 * 60_000,
  "file.extract": 10 * 60_000,
  "engine.skills-sync": 5 * 60_000,
  "product.document": 30 * 60_000,
};

/** The one host-level maintenance kind: its job belongs to no project (ProjectId "system") — it keeps the engine host's
 *  vendored Blocks skills current. Every claiming worker handles it; the daily queue is `engine.skills-sync:global`
 *  (the unique (ProjectId, ActiveKey) index refuses a second active row, so two queues never race). */
export const HOST_MAINTENANCE_KIND = "engine.skills-sync";

/** The ActiveKey one active host-maintenance job of a kind carries while queued, claimed or running. */
export const HOST_MAINTENANCE_ACTIVE = `${HOST_MAINTENANCE_KIND}:global`;

export function isHostMaintenance(kind: unknown): boolean {
  return kind === HOST_MAINTENANCE_KIND && isEngineJobKind(kind);
}

/** Message stored when the system stops a job whose lease or run time ran out. */
export const JOB_STOPPED_MESSAGE = "The MADP engine stopped responding, so this job was stopped.";

/** What the system does to a job whose lease expired (applied with actor "system"). */
export function leaseExpiryEvent(job: EngineJobState): "release" | "fail" | null {
  if (job.status === "claimed") return job.attempts < MAX_JOB_ATTEMPTS ? "release" : "fail";
  if (job.status === "running") return "fail";
  return null;
}

/** A status, or "waiting" for a queued job when no engine is connected. */
export type JobDisplayState = "waiting" | EngineJobStatus;

/** The MADP engine claims a queued job within seconds; a job still queued after this long means the engine is offline
 *  (or stopped claiming). The job waits — nothing is lost — and starts when the engine is back. */
export const ENGINE_PICKUP_MS = 45_000;

/** True when a queued job has waited longer than the engine ever takes to pick one up. */
export function waitingForEngine(job: { status: EngineJobStatus; createdAt: string | null }, now: number): boolean {
  if (job.status !== "queued" || !job.createdAt) return false;
  const at = Date.parse(job.createdAt);
  return Number.isFinite(at) && now - at > ENGINE_PICKUP_MS;
}

/** The state to show people: queued reads as waiting while no engine is connected. */
export function jobDisplayState(status: EngineJobStatus, engineConnected: boolean): JobDisplayState {
  return status === "queued" && !engineConnected ? "waiting" : status;
}

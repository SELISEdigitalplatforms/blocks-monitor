/** The Build step (step 5 of STEP-STANDARD.md) on the shared step frame: the development team (engineers + QA) builds a
 *  working preview milestone by milestone; you try the preview, give feedback and accept the milestone. Pure: the
 *  frame's status line, its one primary action, the checklist chips and the agent line (and their tests) read this one
 *  state. Only real records go in: the milestones, their tickets and previews, the engine jobs, the dev release, and
 *  the change request a change build (change.build) is for. While a change build runs, or when it is the newest build
 *  and no milestone is left, the step is about that change. */
import { isActiveEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import { isAfterDeployRetry, type AfterDeployAttention } from "@/madp/domain/afterDeploy";
import { fixRoundOf, isRevert } from "@/madp/domain/changeChecks";
import { connectOf } from "@/madp/domain/blocksConnect";
import { unfinishedWords } from "./afterDeployUi";
import { stoppedText } from "@/madp/components/changes/changeStopped";
import { t } from "@/madp/i18n";

export const BUILD_ROLE = {
  get who() { return t("build.step.role.who", "Development team (engineers + QA)"); },
  get delivers() { return t("build.step.role.delivers", "builds working previews, milestone by milestone"); },
  get you() { return t("build.step.role.you", "try the preview, give feedback, accept the milestone"); },
};

/** The same team on a product that works through change requests (an existing product attached as it is live, without
 *  milestones): no milestone to accept, each approved change is built and put on the development environment. */
export const CHANGE_BUILD_ROLE = {
  get who() { return BUILD_ROLE.who; },
  get delivers() { return t("build.step.changeRole.delivers", "builds each approved change request and puts it on the development environment"); },
  get you() { return t("build.step.changeRole.you", "approve each change request, then try it on development"); },
};

/** True when the product works through change requests rather than milestones: no milestone, and it is an existing
 *  product attached as it is live or it already has change requests. Its Build step speaks of change requests. */
export function worksByChanges(o: { milestones: number; attachedLive: boolean; changes: number }): boolean {
  return o.milestones === 0 && (o.attachedLive || o.changes > 0);
}

export interface StepMilestone {
  id: string;
  number: number;
  name: string;
  sortOrder: number;
  status: string;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
}
export interface StepTicket { milestoneId: string | null; column: string }
export interface StepPreview { url: string; version: string; status: string; createdAt: string | null }
/** The automatic test gate of the build in focus (model.ts qualityGates, id "04"). */
export interface StepTests { state: "pending" | "running" | "passed" | "failed" | "held"; detail: string }
/** The newest build when it is a change request's (change.build): the change, the increment it builds (a new feature
 *  on an existing product) and its tickets (model.ts changeBuildScope). */
export interface StepChangeBuild {
  job: EngineJob;
  /** "CR-002"; null when the change request can't be read */
  code: string | null;
  number: number | null;
  title: string;
  increment: { n: number; of: number; title: string } | null;
  tickets: { total: number; done: number };
  tests: StepTests | null;
  /** On development, but its steps after the deploy are not all finished (afterDeployUi.ts openAfterDeploy). */
  unfinished?: AfterDeployAttention | null;
}

export type BuildPhase =
  | "planning" // the next milestone has no tickets yet
  | "ready" // the next milestone can be built
  | "queued" // its build waits for the development team
  | "building"
  | "deploying" // built; the preview goes online
  | "review" // a preview is ready to try and accept
  | "stopped" // the last build stopped (failed or cancelled)
  | "complete"; // every milestone is accepted

/** `change` opens the change request of the build in focus (its next increment, or its build again, start there). */
export type BuildPrimaryKind = "start" | "watch" | "preview" | "accept" | "wait" | "release" | "change";
export interface BuildPrimary { kind: BuildPrimaryKind; label: string; disabled: boolean; reason: string | null }

export type BuildChipId = "milestone" | "tickets" | "preview" | "feedback" | "tests" | "accepted" | "change" | "increment";
export interface BuildChip {
  id: BuildChipId;
  label: string;
  value: string;
  state: "done" | "todo" | "attention" | "info";
  title: string;
}

export interface BuildStepInput<M extends StepMilestone = StepMilestone> {
  milestones: readonly M[];
  tickets: readonly StepTicket[];
  /** The newest preview of a milestone, or null. */
  previewOf: (milestoneId: string) => StepPreview | null;
  jobs: readonly EngineJob[];
  /** buildGate(): the next milestone to build and whether the button may start it. */
  gate: { milestone: { id: string } | null; enabled: boolean; reason: string | null };
  /** The automatic tests of a milestone's newest build, or null before its first build. */
  tests: (milestoneId: string | null) => StepTests | null;
  canAccept: boolean;
  /** Open feedback (fix tickets from milestone.feedback not done yet) on a milestone, and all feedback given on it. */
  feedback: (milestoneId: string) => { open: number; total: number };
  /** The signed-in person opened this milestone's newest preview (then the primary becomes Accept). */
  previewOpened: (milestoneId: string) => boolean;
  /** The newest build, when it is a change request's; else null. */
  change?: StepChangeBuild | null;
  /** A milestone whose build is on development but whose steps after the deploy are not all finished. */
  unfinished?: (milestoneId: string) => AfterDeployAttention | null;
  /** The product works through change requests, not milestones (worksByChanges): without a change build to be about,
   *  the step says so instead of speaking of milestones it never had. */
  byChanges?: boolean;
}

export interface BuildStepState<M extends StepMilestone = StepMilestone> {
  phase: BuildPhase;
  /** The milestone the step is about now (running, waiting for you, or next). */
  current: M | null;
  status: string;
  tone: "done" | "progress" | "waiting" | "attention";
  primary: BuildPrimary;
  chips: BuildChip[];
  /** The development team's line while work runs behind the scenes; progress 0–100 when known. `waiting`: nobody
   *  works on it now, it waits for a person (WAITING_FOR_YOU), so the line is shown without the working animation. */
  agent: { text: string; progress: number | null; waiting?: true } | null;
  /** Why the build (or preview) the step is about stopped: its job's plain failure line (EngineJob.Message, made plain
   *  on read), the same line the Team panel's tech lead shows; null unless that job failed with a line. */
  stopReason: string | null;
  /** All tickets and the done ones, over every milestone. */
  tickets: { total: number; done: number };
  /** The current milestone's tickets. */
  currentTickets: { total: number; done: number };
  accepted: number;
  built: number;
  /** A built milestone that waits for acceptance while the next one could already be built: offered in the main area. */
  alsoStart: M | null;
  /** The feedback on the current milestone. */
  feedback: { open: number; total: number };
  /** A build runs for feedback on the current (already built) milestone. */
  updating: boolean;
  /** The next milestone is built (its newest build succeeded) but its preview is not online: its start is a new
   *  preview, not another build (build.start does the same). */
  previewOnly: boolean;
  /** The change build the status line, the primary and the chips are about (it runs, or it is the newest build and no
   *  milestone waits); null when they are about the milestones. */
  change: (StepChangeBuild & { live: boolean; line: string }) | null;
}

/** The one sentence about the change in focus for the Overview: while it runs, the team's line ("The development team is
 *  fixing what the checks found in CR-018 increment 1 of 2 (round 1)."); otherwise the status line. The same words as
 *  the header, so the page never says two things about one change. */
function changeLine(c: StepChangeBuild, live: boolean, status: string): string {
  const line = live && !waitsForPerson(c.job) ? changeTeamLine(changeWords(c), changeRunOf(c.job), c.job.status === "queued") : status;
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

const BUILT = new Set(["preview-ready", "done"]);
export const isBuilt = (m: Pick<StepMilestone, "status">) => BUILT.has(m.status);
/** Accepted by the client, or finished with the release (the engine marks every milestone done at the dev release). */
export const isAccepted = (m: Pick<StepMilestone, "status" | "acceptedAt">) => Boolean(m.acceptedAt) || m.status === "done";

/** The plain line a failed job stopped with, or null (a job at work, or one that failed without a line). */
export const failureReason = (job: Pick<EngineJob, "status" | "message"> | null | undefined): string | null =>
  job?.status === "failed" && job.message ? job.message : null;

/** The line while a job waits for a person to approve the product's Blocks sign-in (the "Connect to Blocks" card). */
export const WAITING_FOR_YOU = "Waiting for you: connect to Blocks";
/** WAITING_FOR_YOU in the current language (the constant stays the English source). */
export const waitingForYou = (): string => t("build.step.waitingForYou", "Waiting for you: connect to Blocks");
const WAITS_FOR_SIGN_IN = /^Waiting for the Blocks sign-in of (.+) that another job started\.?$/;

/** True while a job waits for a person: its line is the Blocks sign-in's link and code (the engine's Connect to Blocks
 *  step, src/domain/blocksConnect.ts), or it waits for the sign-in another job of the product started. Nothing is
 *  being built meanwhile. */
export function waitsForPerson(job: Pick<EngineJob, "status" | "message"> | null | undefined): boolean {
  if (!job || !isActiveEngineJob(job) || !job.message) return false;
  return connectOf(job.message) !== null || WAITS_FOR_SIGN_IN.test(job.message.trim());
}

/** What a waiting job asks for, after "Waiting for you: ": its own sign-in line (the link and the code), or the sign-in
 *  another job of the product started. */
export function waitingDetail(message: string): string {
  const other = WAITS_FOR_SIGN_IN.exec(message.trim());
  return other ? t("build.step.waitingOtherSignIn", "connect {product} to Blocks. The sign-in another job of this product started waits for its approval.", { product: other[1] }) : message;
}

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};
const newestFirst = (a: EngineJob, b: EngineJob) => ms(b.createdAt) - ms(a.createdAt);

/** The milestone a job was started for (its InputJson), or null. */
export function milestoneOfJob(job: Pick<EngineJob, "inputJson"> | null | undefined): string | null {
  if (!job?.inputJson) return null;
  try {
    const v = JSON.parse(job.inputJson) as { milestoneId?: unknown } | null;
    return v && typeof v === "object" && typeof v.milestoneId === "string" ? v.milestoneId : null;
  } catch {
    return null;
  }
}

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** "1 ticket" / "3 tickets" in the current language. */
const ticketCount = (count: number) => (count === 1 ? t("build.step.ticketsOne", "{count} ticket", { count }) : t("build.step.ticketsMany", "{count} tickets", { count }));
const milestoneCount = (count: number) => (count === 1 ? t("build.step.milestonesOne", "{count} milestone", { count }) : t("build.step.milestonesMany", "{count} milestones", { count }));
/** A sentence about a milestone: "… milestone 3 …" under `key`, or "… the next milestone …" under `key`Next when there
 *  is none (each language words both whole). */
const ofMilestone = (m: { number: number } | null, named: (number: number) => string, next: () => string): string => (m ? named(m.number) : next());

/** "CR-002 increment 1 of 4" (a feature built in more than one increment), "CR-002", or "a change" when the change
 *  request can't be read. */
export function changeWords(c: { code: string | null; increment: { n: number; of: number } | null }): string {
  const code = c.code ?? aChange();
  return c.increment && c.increment.of > 1 ? t("build.step.changeIncrement", "{code} increment {n} of {of}", { code, n: c.increment.n, of: c.increment.of }) : code;
}
/** "a change": a change build whose change request can't be read. */
export const aChange = (): string => t("build.step.aChange", "a change");

/** What a change build is: the change's own build (an increment of a feature), a fix round of what its checks found
 *  on development, putting development back without it, or the steps after its deploy run again. */
export type ChangeRun = { kind: "build" } | { kind: "fix"; round: number } | { kind: "revert" } | { kind: "finish" };

/** The run of a change.build job, from its input (src/domain/changeChecks.ts, src/domain/afterDeploy.ts). */
export function changeRunOf(job: Pick<EngineJob, "kind" | "inputJson"> | null | undefined): ChangeRun {
  const fix = fixRoundOf(job ?? null);
  if (fix) return { kind: "fix", round: fix.round };
  if (isRevert(job ?? null)) return { kind: "revert" };
  if (isAfterDeployRetry(job)) return { kind: "finish" };
  return { kind: "build" };
}

/** What the development team does on a change, ONE wording for the Build step's status line, its team line, the
 *  Queue's stream line and the Overview: "Building CR-018 increment 2 of 2", "Fixing what the checks found in CR-018
 *  increment 1 of 2 (round 1)", "Putting development back without CR-018 increment 1 of 2", "Finishing the steps after
 *  the deploy of CR-018 increment 1 of 2". `what` is changeWords(): the increment is the one the run works on
 *  (model.ts changeBuildScope: a fix round's is its base build's, never the next one). */
export function changeDoing(what: string, run: ChangeRun): string {
  switch (run.kind) {
    case "fix": return t("build.step.doing.fix", "Fixing what the checks found in {what} (round {round})", { what, round: run.round });
    case "revert": return t("build.step.doing.revert", "Putting development back without {what}", { what });
    case "finish": return t("build.step.doing.finish", "Finishing the steps after the deploy of {what}", { what });
    default: return t("build.step.doing.build", "Building {what}", { what });
  }
}

/** The run as a thing, for "… is next in line" and "… stopped": "The build of CR-018", "Fix round 1 of CR-018
 *  increment 1 of 2", "Putting development back without CR-018", "The steps after the deploy of CR-018". */
export function changeRunName(what: string, run: ChangeRun): string {
  switch (run.kind) {
    case "fix": return t("build.step.run.fix", "Fix round {round} of {what}", { what, round: run.round });
    case "revert": return t("build.step.run.revert", "Putting development back without {what}", { what });
    case "finish": return t("build.step.run.finish", "The steps after the deploy of {what}", { what });
    default: return t("build.step.run.build", "The build of {what}", { what });
  }
}

/** The development team's line about a change's run: "The development team is fixing what the checks found in CR-018
 *  increment 1 of 2 (round 1)"; while it waits for the team, what it picks up next. */
export function changeTeamLine(what: string, run: ChangeRun, queued: boolean): string {
  if (queued) {
    switch (run.kind) {
      case "fix": return t("build.step.team.queuedFix", "The development team is picking up fix round {round} of {what}", { what, round: run.round });
      case "revert": return t("build.step.team.queuedRevert", "The development team is about to put development back without {what}", { what });
      case "finish": return t("build.step.team.queuedFinish", "The development team is picking up the steps after the deploy of {what}", { what });
      default: return t("build.step.team.queuedBuild", "The development team is picking up {what}", { what });
    }
  }
  switch (run.kind) {
    case "fix": return t("build.step.team.fix", "The development team is fixing what the checks found in {what} (round {round})", { what, round: run.round });
    case "revert": return t("build.step.team.revert", "The development team is putting development back without {what}", { what });
    case "finish": return t("build.step.team.finish", "The development team is finishing the steps after the deploy of {what}", { what });
    default: return t("build.step.team.build", "The development team is building {what}", { what });
  }
}

/** "2 of its 38 checks fail" from the deploy's open steps (accept-failed "<failed>/<files>"), else "its own checks did
 *  not pass": the same words as the change request's page (changeChecksUi.ts failingWords). */
export function checksFailWords(a: Pick<AfterDeployAttention, "details">): string {
  const m = /^(\d{1,4})\/(\d{1,4})$/.exec(a.details["accept-failed"] ?? "");
  return m ? t("build.step.checksFail", "{failed} of its {total} checks fail", { failed: m[1]!, total: m[2]! }) : t("build.step.checksNotPassed", "its own checks did not pass");
}

/** "Tickets 9 of 14 done": counted over the given milestone (or all when null). */
export function ticketProgress(tickets: readonly StepTicket[], milestoneId: string | null): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const t of tickets) {
    if (milestoneId !== null && t.milestoneId !== milestoneId) continue;
    if (milestoneId === null && !t.milestoneId) continue;
    total += 1;
    if (t.column === "done") done += 1;
  }
  return { total, done };
}

/** Where the work of a milestone is, in plain words: waiting, being built, being checked, done. */
export function workWords(tickets: readonly StepTicket[], milestoneId: string): string {
  let waiting = 0, building = 0, checking = 0, done = 0;
  for (const t of tickets) {
    if (t.milestoneId !== milestoneId) continue;
    if (t.column === "planned") waiting += 1;
    else if (t.column === "dev") building += 1;
    else if (t.column === "done") done += 1;
    else checking += 1;
  }
  const parts = [
    building ? t("build.step.work.building", "{count} being built", { count: building }) : "",
    checking ? t("build.step.work.checking", "{count} being checked", { count: checking }) : "",
    waiting ? t("build.step.work.waiting", "{count} waiting", { count: waiting }) : "",
    done ? t("build.step.work.done", "{count} done", { count: done }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("build.step.work.none", "No tickets planned yet");
}

/** The milestone's state in plain words, for the milestone list. `stopped`: its newest build (or preview) failed or
 *  was cancelled and nothing runs for it (milestoneStopped), so it is not being built, whatever its status says. */
export function milestoneWord(m: Pick<StepMilestone, "status" | "acceptedAt">, running: boolean, stopped = false): string {
  if (m.acceptedAt) return t("build.step.milestone.accepted", "Accepted");
  if (m.status === "done") return t("build.step.milestone.delivered", "Delivered");
  if (m.status === "preview-ready") return running ? t("build.step.milestone.updating", "Being updated") : t("build.step.milestone.readyToTry", "Ready to try");
  if (running) return t("build.step.milestone.building", "Being built");
  if (stopped) return t("build.step.milestone.stopped", "Stopped");
  if (m.status === "building") return t("build.step.milestone.building", "Being built");
  return t("build.step.milestone.planned", "Planned");
}

/** A milestone's own preview (not a release's or an environment's). */
const ownPreview = (j: Pick<EngineJob, "kind" | "inputJson">) => j.kind === "preview.deploy" && !/"(release|environment)"\s*:/.test(j.inputJson ?? "");

/** True when the milestone's newest build or preview job failed or was cancelled (a job that only finishes the steps
 *  after an earlier deploy does not count): the milestone list then says "Stopped", not "Being built". */
export function milestoneStopped(jobs: readonly EngineJob[], milestoneId: string): boolean {
  const newest = jobs
    .filter((j) => (j.kind === "build.run" || ownPreview(j)) && !isAfterDeployRetry(j) && milestoneOfJob(j) === milestoneId)
    .sort(newestFirst)[0];
  return Boolean(newest && (newest.status === "failed" || newest.status === "cancelled"));
}

/** The kinds a build start queues (build.start: a milestone's build, or its preview). */
const START_KINDS = new Set<string>(["build.run", "preview.deploy"]);

/** The jobs a start can answer with, read when the start is requested (startAnswered). */
export function startSnapshot(jobs: readonly Pick<EngineJob, "id" | "kind">[]): ReadonlySet<string> {
  return new Set(jobs.filter((j) => START_KINDS.has(j.kind)).map((j) => j.id));
}

/** True once the job a start requested is on the page: a build or preview job that was not there when the start was
 *  requested. From then on the job speaks for itself (running, waiting for you, stopped with its reason), and "The
 *  build was requested" is no longer true to show. */
export function startAnswered(jobs: readonly Pick<EngineJob, "id" | "kind">[], before: ReadonlySet<string> | null): boolean {
  return before !== null && jobs.some((j) => START_KINDS.has(j.kind) && !before.has(j.id));
}

const testsValue = (state: StepTests["state"]): string => ({
  passed: t("build.step.tests.passed", "passing"), failed: t("build.step.tests.failed", "sent back"), running: t("build.step.tests.running", "running"),
  held: t("build.step.tests.held", "waiting"), pending: t("build.step.tests.pending", "not yet"),
})[state];

/** The Build step's state. */
export function buildStep<M extends StepMilestone>(input: BuildStepInput<M>): BuildStepState<M> {
  const sorted = [...input.milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const byId = (id: string | null) => (id ? sorted.find((m) => m.id === id) ?? null : null);
  // a job that only finishes the steps after an earlier deploy (build.retryAfterDeploy) is not a build: it moves no
  // ticket and changes no status, so the phases never read it as one
  const jobs = [...input.jobs].sort(newestFirst).filter((j) => !isAfterDeployRetry(j));
  const finishing = input.jobs.find((j) => isActiveEngineJob(j) && isAfterDeployRetry(j)) ?? null;
  const activeOf = (kind: EngineJob["kind"]) => jobs.find((j) => j.kind === kind && isActiveEngineJob(j)) ?? null;
  const build = activeOf("build.run");
  const deploy = activeOf("preview.deploy");
  const plan = activeOf("board.plan");
  const change = activeOf("change.build");
  const next = byId(input.gate.milestone?.id ?? null);
  const awaiting = sorted.find((m) => isBuilt(m) && !isAccepted(m)) ?? null;
  const lastBuild = jobs.find((j) => j.kind === "build.run") ?? null;
  const stoppedOn = lastBuild && (lastBuild.status === "failed" || lastBuild.status === "cancelled") ? byId(milestoneOfJob(lastBuild)) : null;
  // built but not online: the next milestone's newest build succeeded, yet it has no ready preview (the preview failed
  // or was cancelled, or the build came from the removed template builder): build.start asks for a new preview
  const nextBuild = next ? jobs.find((j) => j.kind === "build.run" && milestoneOfJob(j) === next.id) ?? null : null;
  const previewOnly = Boolean(next && !isBuilt(next) && nextBuild?.status === "succeeded");
  const nextPreview = next ? jobs.find((j) => ownPreview(j) && milestoneOfJob(j) === next.id) ?? null : null;
  const previewStopped = previewOnly && (nextPreview?.status === "failed" || nextPreview?.status === "cancelled");

  // the milestone the running build (or preview) is for; a built milestone waiting for you stays the focus while the
  // team builds the next one (you can try and accept it meanwhile)
  const buildingOf = build ? byId(milestoneOfJob(build)) ?? next : null;
  const deployingOf = deploy ? byId(milestoneOfJob(deploy)) : null;
  const yoursFirst = (m: M | null) => Boolean(awaiting && m && m.id !== awaiting.id && !isBuilt(m));

  let phase: BuildPhase;
  let current: M | null;
  if (build && !yoursFirst(buildingOf)) {
    current = buildingOf;
    phase = build.status === "queued" ? "queued" : "building";
  } else if (deploy && deployingOf && !isAccepted(deployingOf) && !yoursFirst(deployingOf)) {
    current = deployingOf;
    phase = "deploying";
  } else if (awaiting) {
    current = awaiting;
    phase = "review";
  } else if (sorted.length > 0 && sorted.every(isAccepted)) {
    current = sorted[sorted.length - 1] ?? null;
    phase = "complete";
  } else if (previewStopped) {
    current = next;
    phase = "stopped";
  } else if (stoppedOn && !isBuilt(stoppedOn)) {
    current = stoppedOn;
    phase = "stopped";
  } else if (next && ticketProgress(input.tickets, next.id).total === 0) {
    current = next;
    phase = "planning";
  } else {
    current = next ?? sorted.find((m) => !isBuilt(m)) ?? null;
    phase = current ? "ready" : "complete";
  }

  // a change request's build: while it runs (unless a built milestone waits for you or its preview goes online), and as
  // the newest build once no milestone is left, the status line, the primary and the chips are about the change
  const ch = input.change && !(isAfterDeployRetry(input.change.job) && isActiveEngineJob(input.change.job)) ? input.change : null;
  const chLive = Boolean(ch && isActiveEngineJob(ch.job) && !build);
  const chNewest = Boolean(ch && (!lastBuild || ms(ch.job.createdAt) >= ms(lastBuild.createdAt)));
  const about = ch && (chLive ? phase !== "review" && phase !== "deploying" : chNewest && phase === "complete" && !build && !deploy) ? ch : null;

  const total = sorted.length;
  const tickets = ticketProgress(input.tickets, null);
  const currentTickets = current ? ticketProgress(input.tickets, current.id) : { total: 0, done: 0 };
  const accepted = sorted.filter(isAccepted).length;
  const built = sorted.filter(isBuilt).length;
  const preview = current ? input.previewOf(current.id) : null;
  const fb = current ? input.feedback(current.id) : { open: 0, total: 0 };
  const updating = Boolean(build && buildingOf && isBuilt(buildingOf));
  // the agent line names the milestone the team works on, which can differ from the one waiting for you
  const bm = buildingOf ?? current;
  const dm = deployingOf ?? current;
  const previewReady = Boolean(preview && /^https:\/\//i.test(preview.url) && preview.status !== "failed");
  // the milestone in focus is on development, but the steps after its deploy are not all finished
  const unfinished = current && (phase === "review" || phase === "complete") ? input.unfinished?.(current.id) ?? null : null;

  // why the build (or the preview) the step is about stopped: its job's own plain line
  const stoppedJob = phase === "stopped" ? (previewStopped ? nextPreview : lastBuild) : null;
  let stopReason = failureReason(stoppedJob);

  // status line
  let status: string;
  let tone: BuildStepState["tone"];
  switch (phase) {
    case "queued": status = ofMilestone(current, (number) => t("build.step.status.queued", "Milestone {number} is next in line for the development team", { number }), () => t("build.step.status.queuedNext", "The next milestone is next in line for the development team")); tone = "waiting"; break;
    case "building": status = updating
      ? ofMilestone(current, (number) => t("build.step.status.updating", "Working on your feedback for milestone {number}", { number }), () => t("build.step.status.updatingNext", "Working on your feedback for the next milestone"))
      : ofMilestone(current, (number) => t("build.step.status.building", "Building milestone {number} · {done} of {tickets} done", { done: currentTickets.done, tickets: ticketCount(currentTickets.total), number }), () => t("build.step.status.buildingNext", "Building the next milestone · {done} of {tickets} done", { done: currentTickets.done, tickets: ticketCount(currentTickets.total) }));
      tone = "progress"; break;
    case "deploying": status = ofMilestone(current, (number) => t("build.step.status.deploying", "Milestone {number} is built · its preview is going online", { number }), () => t("build.step.status.deployingNext", "The next milestone is built · its preview is going online")); tone = "progress"; break;
    case "review": status = unfinished
      ? ofMilestone(current, (number) => t("build.step.status.reviewUnfinished", "Milestone {number} is ready to try, {unfinished}", { unfinished: unfinishedWords(unfinished), number }), () => t("build.step.status.reviewUnfinishedNext", "The next milestone is ready to try, {unfinished}", { unfinished: unfinishedWords(unfinished) }))
      : ofMilestone(current, (number) => t("build.step.status.review", "Milestone {number} is ready to try", { number }), () => t("build.step.status.reviewNext", "The next milestone is ready to try"));
      tone = "attention"; break;
    case "stopped": status = previewStopped
      ? ofMilestone(current, (number) => t("build.step.status.previewStopped", "The preview of milestone {number} did not go online", { number }), () => t("build.step.status.previewStoppedNext", "The preview of the next milestone did not go online"))
      : ofMilestone(current, (number) => t("build.step.status.buildStopped", "The build of milestone {number} stopped", { number }), () => t("build.step.status.buildStoppedNext", "The build of the next milestone stopped"));
      tone = "attention"; break;
    case "planning": status = plan
      ? ofMilestone(current, (number) => t("build.step.status.planning", "The tickets of milestone {number} are being planned", { number }), () => t("build.step.status.planningNext", "The tickets of the next milestone are being planned"))
      : ofMilestone(current, (number) => t("build.step.status.noTickets", "Milestone {number} has no tickets planned yet", { number }), () => t("build.step.status.noTicketsNext", "The next milestone has no tickets planned yet"));
      tone = plan ? "progress" : "waiting"; break;
    case "ready": {
      const ready = ofMilestone(current, (number) => t("build.step.status.ready", "Ready to build milestone {number}", { number }), () => t("build.step.status.readyNext", "Ready to build the next milestone"));
      status = input.gate.enabled ? ready : input.gate.reason ?? ready; tone = "waiting"; break;
    }
    default:
      status = total === 1 ? t("build.step.status.oneAccepted", "The milestone is accepted") : total ? t("build.step.status.allAccepted", "All {total} milestones accepted", { total }) : t("build.step.status.nothing", "Nothing to build");
      if (unfinished) status = t("build.step.status.withUnfinished", "{status}, {unfinished}", { status, unfinished: unfinishedWords(unfinished) });
      tone = unfinished ? "attention" : "done";
  }

  // the one primary action
  const startLabel = current && previewOnly && current.id === next?.id ? t("build.step.primary.previewOnline", "Put the preview of milestone {number} online", { number: current.number })
    : current ? t("build.step.primary.startMilestone", "Start the build of milestone {number}", { number: current.number }) : t("build.step.primary.start", "Start the build");
  const watch = (): BuildPrimary => ({ kind: "watch", label: t("build.step.primary.watch", "Watch the build"), disabled: false, reason: null });
  const acceptLabel = () => t("build.step.primary.accept", "Accept milestone {number}", { number: current!.number });
  let primary: BuildPrimary;
  switch (phase) {
    case "queued":
    case "building":
      primary = watch(); break;
    case "deploying":
      primary = { kind: "wait", label: t("build.step.primary.previewGoingOnline", "Preview going online…"), disabled: true, reason: t("build.step.primary.previewOpensSoon", "The preview opens here in a moment.") }; break;
    case "review":
      primary = !previewReady
        ? { kind: "wait", label: acceptLabel(), disabled: true, reason: t("build.step.primary.previewNotOnline", "The preview isn't online yet.") }
        : fb.open > 0
          ? { kind: "wait", label: acceptLabel(), disabled: true, reason: t("build.step.primary.feedbackOpen", "The team is still working on your feedback.") }
          : input.canAccept
            // the build is done and waits for you: accepting is the step's one action, the preview link sits next to it
            ? { kind: "accept", label: t("build.step.primary.reviewAccept", "Review and accept milestone {number}", { number: current!.number }), disabled: false, reason: input.previewOpened(current!.id) ? null : t("build.step.primary.tryFirst", "Try the preview first: its link is next to this button.") }
            : { kind: "preview", label: t("build.step.primary.openPreview", "Open the preview"), disabled: false, reason: t("build.step.primary.acceptByTeam", "Try it. Accepting it is up to the project team.") };
      break;
    case "stopped":
      primary = previewStopped
        ? { kind: "start", label: t("build.step.primary.previewOnlineAgain", "Put the preview of milestone {number} online again", { number: current!.number }), disabled: !input.gate.enabled, reason: input.gate.reason }
        : { kind: "start", label: t("build.step.primary.startAgain", "Start milestone {number} again", { number: current!.number }), disabled: !input.gate.enabled, reason: input.gate.reason };
      break;
    case "planning":
    case "ready":
      primary = { kind: "start", label: startLabel, disabled: !input.gate.enabled, reason: input.gate.reason }; break;
    default:
      primary = { kind: "release", label: t("build.step.primary.release", "Go to Release"), disabled: false, reason: null };
  }

  // the development team's line, while work runs
  let agent: BuildStepState["agent"] = null;
  const releasing = deploy && /"release"\s*:/.test(deploy.inputJson ?? "") ? deploy : null;
  if (build) {
    agent = build.status === "queued"
      ? { text: updating
        ? ofMilestone(bm, (number) => t("build.step.team.queuedFeedback", "The development team is picking up your feedback for milestone {number}", { number }), () => t("build.step.team.queuedFeedbackNext", "The development team is picking up your feedback for the next milestone"))
        : ofMilestone(bm, (number) => t("build.step.team.queuedMilestone", "The development team is picking up milestone {number}", { number }), () => t("build.step.team.queuedMilestoneNext", "The development team is picking up the next milestone")), progress: null }
      : { text: updating
        ? ofMilestone(bm, (number) => t("build.step.team.feedback", "The development team is working on your feedback for milestone {number}", { number }), () => t("build.step.team.feedbackNext", "The development team is working on your feedback for the next milestone"))
        : ofMilestone(bm, (number) => t("build.step.team.milestone", "The development team is building milestone {number}", { number }), () => t("build.step.team.milestoneNext", "The development team is building the next milestone")), progress: Number.isFinite(build.progress) ? build.progress : null };
  } else if (releasing) {
    agent = { text: t("build.step.team.releasing", "The development team is releasing the app to the development environment"), progress: Number.isFinite(releasing.progress) ? releasing.progress : null };
  } else if (deploy && deployingOf && !isAccepted(deployingOf)) {
    agent = { text: ofMilestone(dm, (number) => t("build.step.team.preview", "The development team is putting the preview of milestone {number} online", { number }), () => t("build.step.team.previewNext", "The development team is putting the preview of the next milestone online")), progress: Number.isFinite(deploy.progress) ? deploy.progress : null };
  } else if (change) {
    // the increment the run works on and what it does (a fix round of increment 1 is never "building increment 2")
    const named = ch && ch.job.id === change.id ? changeWords(ch) : aChange();
    const queued = change.status === "queued";
    agent = { text: changeTeamLine(named, changeRunOf(change), queued), progress: queued || !Number.isFinite(change.progress) ? null : change.progress };
  } else if (plan) {
    agent = { text: t("build.step.team.planning", "The development team is planning the tickets"), progress: Number.isFinite(plan.progress) ? plan.progress : null };
  } else if (finishing) {
    agent = { text: t("build.step.team.finishing", "The development team is finishing the steps after the deploy"), progress: Number.isFinite(finishing.progress) ? finishing.progress : null };
  }
  // the job the line is about waits for a person to connect the product to Blocks: nobody works on it until then
  const agentJob = build ?? releasing ?? (deploy && deployingOf && !isAccepted(deployingOf) ? deploy : null) ?? change ?? plan ?? finishing;
  if (agent && waitsForPerson(agentJob)) agent = { text: waitingForYou(), progress: null, waiting: true };
  // and so does the status line, when it is about that job
  if ((phase === "building" || phase === "queued") ? waitsForPerson(build) : phase === "deploying" && waitsForPerson(deploy)) {
    status = waitingForYou();
    tone = "attention";
  }

  // the checklist chips (at most six)
  const previewState = previewReady ? "ready"
    : phase === "building" || phase === "queued" ? "building"
      : phase === "deploying" ? "deploying"
        : phase === "complete" ? "delivered" : "notYet";
  const previewValue = {
    ready: t("build.step.chip.previewReady", "ready"), building: t("build.step.chip.previewBuilding", "being built"),
    deploying: t("build.step.chip.previewDeploying", "going online"), delivered: t("build.step.chip.previewDelivered", "delivered"),
    notYet: t("build.step.chip.previewNotYet", "not yet"),
  }[previewState];
  const nOf = (n: number, of: number) => t("build.step.chip.nOf", "{n} of {of}", { n, of });
  const nOfDone = (n: number, of: number) => t("build.step.chip.nOfDone", "{n} of {of} done", { n, of });
  const chips: BuildChip[] = [
    {
      id: "milestone", label: t("build.step.chip.milestone", "Milestone"), value: current && total ? nOf(current.number, total) : `${total}`,
      state: phase === "complete" ? "done" : "info",
      title: current ? t("build.step.chip.milestoneTitle", "Milestone {number} of {total}: {name}", { number: current.number, total, name: current.name }) : milestoneCount(total),
    },
    {
      id: "tickets", label: t("build.step.chip.tickets", "Tickets"), value: nOfDone(tickets.done, tickets.total),
      state: tickets.total > 0 && tickets.done === tickets.total ? "done" : "info",
      title: t("build.step.chip.ticketsTitle", "{done} of {tickets} done over all milestones · open the board", { done: tickets.done, tickets: ticketCount(tickets.total) }),
    },
    {
      id: "preview", label: t("build.step.chip.preview", "Preview"), value: previewValue,
      state: previewReady || phase === "complete" ? "done" : "info",
      title: previewReady && preview
        ? ofMilestone(current, (number) => t("build.step.chip.previewReadyTitle", "The preview of milestone {number} is ready (version {version})", { version: preview.version, number }), () => t("build.step.chip.previewReadyTitleNext", "The preview of the next milestone is ready (version {version})", { version: preview.version }))
        : previewState === "notYet" ? ofMilestone(current, (number) => t("build.step.chip.previewLaterTitle", "The preview of milestone {number} comes once it is built", { number }), () => t("build.step.chip.previewLaterTitleNext", "The preview of the next milestone comes once it is built"))
          : previewState === "building" ? ofMilestone(current, (number) => t("build.step.chip.previewBuildingTitle", "The preview of milestone {number} is being built", { number }), () => t("build.step.chip.previewBuildingTitleNext", "The preview of the next milestone is being built"))
            : previewState === "deploying" ? ofMilestone(current, (number) => t("build.step.chip.previewDeployingTitle", "The preview of milestone {number} is going online", { number }), () => t("build.step.chip.previewDeployingTitleNext", "The preview of the next milestone is going online"))
              : ofMilestone(current, (number) => t("build.step.chip.previewDeliveredTitle", "The preview of milestone {number} is delivered", { number }), () => t("build.step.chip.previewDeliveredTitleNext", "The preview of the next milestone is delivered")),
    },
  ];
  if (current && (isBuilt(current) || fb.total > 0)) {
    const number = current.number;
    chips.push({
      id: "feedback", label: t("build.step.chip.feedback", "Feedback"), value: fb.open ? t("build.step.chip.feedbackOpen", "{count} open", { count: fb.open }) : fb.total ? t("build.step.chip.feedbackAllDone", "all done") : t("build.step.chip.feedbackNone", "none"),
      state: fb.open ? "info" : phase === "review" && fb.total === 0 ? "todo" : "done",
      title: fb.open
        ? (fb.open === 1 ? t("build.step.chip.feedbackOpenOne", "1 piece of feedback on milestone {number} the team is working on", { number })
          : t("build.step.chip.feedbackOpenMany", "{count} pieces of feedback on milestone {number} the team is working on", { count: fb.open, number }))
        : fb.total ? (fb.total === 1 ? t("build.step.chip.feedbackDoneOne", "Your feedback on milestone {number} is done", { number })
          : t("build.step.chip.feedbackDoneMany", "All {count} pieces of feedback on milestone {number} are done", { count: fb.total, number }))
          : isAccepted(current) ? t("build.step.chip.feedbackNotNeeded", "No feedback was needed on milestone {number}", { number })
            : t("build.step.chip.feedbackTell", "Tell the team what to change in milestone {number}", { number }),
    });
  }
  const tests = input.tests(current?.id ?? null);
  if (tests) {
    chips.push({
      id: "tests", label: t("build.step.chip.tests", "Tests"), value: testsValue(tests.state),
      state: tests.state === "passed" ? "done" : tests.state === "failed" ? "attention" : "info",
      title: ofMilestone(current, (number) => t("build.step.chip.testsTitle", "Automatic tests of milestone {number}: {detail}", { detail: tests.detail, number }), () => t("build.step.chip.testsTitleNext", "Automatic tests of the next milestone: {detail}", { detail: tests.detail })),
    });
  }
  chips.push({
    id: "accepted", label: t("build.step.chip.accepted", "Accepted"), value: nOf(accepted, total),
    state: total > 0 && accepted === total ? "done" : phase === "review" && previewReady && input.canAccept && fb.open === 0 ? "todo" : "info",
    title: t("build.step.chip.acceptedTitle", "{accepted} of {milestones} accepted", { accepted, milestones: milestoneCount(total) }),
  });

  const alsoStart = phase === "review" && next && input.gate.enabled && next.id !== current?.id ? next : null;

  // the change build the header is about: its status line, primary and chips
  let shownChips = chips;
  if (about) {
    const what = changeWords(about);
    const run = changeRunOf(about.job);
    const tk = about.tickets;
    const s = about.job.status;
    const inc = about.increment && about.increment.of > 1 ? about.increment : null;
    const more = Boolean(inc && inc.n < inc.of);
    // its newest build on development left its own checks failing: not usable there, never "the next increment"
    const broken = Boolean(about.unfinished?.broken);
    const open = about.number !== null
      ? { kind: "change" as const, label: about.code ? t("build.step.change.open", "Open {code}", { code: about.code }) : t("build.step.change.openRequest", "Open the change request"), disabled: false }
      : null;
    stopReason = failureReason(about.job);
    if (chLive) {
      status = waitsForPerson(about.job) ? waitingForYou()
        : s === "queued" ? t("build.step.change.nextInLine", "{run} is next in line for the development team", { run: run.kind === "build" ? capital(what) : changeRunName(what, run) })
          // a fix round, a revert or the steps after a deploy move no ticket: the line says what runs, not a ticket count
          : run.kind === "build" ? t("build.step.change.doingTickets", "{doing} · {done} of {tickets} done", { doing: changeDoing(what, run), done: tk.done, tickets: ticketCount(tk.total) }) : changeDoing(what, run);
      tone = waitsForPerson(about.job) ? "attention" : s === "queued" ? "waiting" : "progress";
      primary = watch();
    } else if (s === "succeeded" && run.kind === "revert") {
      status = t("build.step.change.putBack", "Development was put back without {what}", { what });
      tone = "attention";
      if (open) primary = { ...open, reason: t("build.step.change.buildAgain", "It can be built again from the change request.") };
    } else if (s === "succeeded") {
      status = about.unfinished
        ? broken
          ? t("build.step.change.onDevBroken", "{What} is on development, {unfinished}: {checks}", { What: capital(what), unfinished: unfinishedWords(about.unfinished), checks: checksFailWords(about.unfinished) })
          : t("build.step.change.onDevUnfinished", "{What} is on development, {unfinished}", { What: capital(what), unfinished: unfinishedWords(about.unfinished) })
        : t("build.step.change.onDev", "{What} is on development", { What: capital(what) });
      tone = more || about.unfinished ? "attention" : "done";
      if (broken && open) primary = { ...open, reason: t("build.step.change.fixFirst", "What its checks found is fixed first, from the change request; nothing more is built on top of it.") };
      else if (more && open) primary = { ...open, reason: t("build.step.change.nextIncrement", "Try it on development; the next increment starts from the change request.") };
    } else {
      // one rule for a stopped change build, cancelled or failed (src/components/changes/changeStopped.ts); a fix round
      // or a revert that stopped says so
      status = run.kind === "build" ? stoppedText(what) : t("build.step.change.runStopped", "{run} stopped", { run: changeRunName(what, run) });
      tone = "attention";
      if (open) primary = { ...open, reason: run.kind === "build" ? t("build.step.change.startsAgain", "Its build starts again from the change request.") : t("build.step.change.howToGoOn", "The change request says how to go on.") };
    }
    shownChips = [];
    if (about.code) {
      shownChips.push({
        id: "change", label: t("build.step.chip.change", "Change"), value: about.code, state: s === "succeeded" && !more && !about.unfinished ? "done" : "info",
        title: about.title ? `${about.code}: ${about.title}` : about.code,
      });
    }
    if (inc) {
      shownChips.push({
        id: "increment", label: t("build.step.chip.increment", "Increment"), value: nOf(inc.n, inc.of), state: s === "succeeded" && !broken && run.kind !== "revert" ? "done" : "info",
        title: inc.title ? t("build.step.chip.incrementTitleNamed", "Increment {n} of {of}: {title}", { n: inc.n, of: inc.of, title: inc.title }) : t("build.step.chip.incrementTitle", "Increment {n} of {of}", { n: inc.n, of: inc.of }),
      });
    }
    shownChips.push({
      id: "tickets", label: t("build.step.chip.tickets", "Tickets"), value: nOfDone(tk.done, tk.total),
      state: tk.total > 0 && tk.done === tk.total ? "done" : "info",
      title: t("build.step.chip.changeTicketsTitle", "{done} of {tickets} of {what} done · open the board", { done: tk.done, tickets: ticketCount(tk.total), what }),
    });
    if (broken && about.unfinished) {
      // the checks on development are what counts once it is there: the board's columns passed, the checks did not
      shownChips.push({
        id: "tests", label: t("build.step.chip.tests", "Tests"), value: run.kind === "fix" && chLive ? t("build.step.chip.testsBeingFixed", "being fixed") : t("build.step.chip.testsFailing", "failing"), state: "attention",
        title: t("build.step.chip.changeTestsDevTitle", "Automatic tests of {what} on the development environment: {checks}", { what, checks: checksFailWords(about.unfinished) }),
      });
    } else if (about.tests) {
      shownChips.push({
        id: "tests", label: t("build.step.chip.tests", "Tests"), value: testsValue(about.tests.state),
        state: about.tests.state === "passed" ? "done" : about.tests.state === "failed" ? "attention" : "info",
        title: t("build.step.chip.changeTestsTitle", "Automatic tests of {what}: {detail}", { what, detail: about.tests.detail }),
      });
    }
  }

  // a product that works through change requests, with no change build yet: no milestone words, no milestone chips
  if (input.byChanges && !about) {
    status = t("build.step.change.noneBuilding", "No change request is being built");
    tone = "waiting";
    primary = { kind: "release", label: t("build.step.primary.release", "Go to Release"), disabled: false, reason: t("build.step.change.onRelease", "Change requests are asked for and followed on the Release page.") };
    shownChips = [];
  }

  return {
    phase, current, status, tone, primary, chips: shownChips.slice(0, 6), agent, stopReason, tickets, currentTickets, accepted, built, alsoStart,
    feedback: fb, updating, previewOnly, change: about ? { ...about, live: chLive, line: changeLine(about, chLive, status) } : null,
  };
}

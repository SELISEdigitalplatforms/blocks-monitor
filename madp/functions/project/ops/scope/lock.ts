/**
 * scope.lock and scope.unlock: ONE lock for the scope and its milestones (constitution decision 21).
 * Depends only on the scope env contract (./ports, ./records, ./shared) and src/domain by relative path.
 * ARCHITECTURE: no transactions (MF-B03). The write order is fixed (version, project, board.plan job, audit) and every
 * step is repeat-safe, so a retry or scope.open's repair completes whatever is missing without duplicates.
 * The locker comes from ctx (env.userId) and the time from the server clock; args never name either.
 */
import { WORKSPACE_PERMISSIONS } from "../../../../src/domain/rbac";
import { journeyStep, type JourneyStep } from "../../../../src/domain/journey";
import { validateMilestonePlan, type PlanMilestone } from "../../../../src/domain/milestones";
import { SCOPE_OP_PERMISSION, canUnlock, lockBlockers } from "../../../../src/domain/scope";
import { canApplyJobEvent, isEngineJobStatus } from "../../../../src/domain/engineJob";
import { parseSuccessTargets, successBlockers } from "../../../../src/domain/successTargets";
import { fail, ok, parseArgs, type Parsed, type Row, type ScopeEnv, type ScopeOpDef } from "./ports";
import { SCHEMA, featureRec, milestoneRec, projectLockPatch, projectUnlockPatch, storyRec } from "./records";
import { byPlanOrder, loadProjectScopeRows, loadVersion, planNumbers, rawVersion, scopeStateOf, stepOf, type VersionView } from "./shared";

interface LockArgs {
  projectId: string;
  scopeVersionId: string;
}

const parseLockArgs = (raw: unknown) => parseArgs(raw, { scopeVersionId: { type: "id" } }) as Parsed<LockArgs>;

const UNLOCK_JOB_KINDS = ["board.plan", "build.run", "change.build"] as const;
const ACTIVE = new Set(["queued", "claimed", "running"]);
const rev = (project: Row): number | undefined => (typeof project.Rev === "number" && Number.isFinite(project.Rev) ? project.Rev : undefined);

/** The stored time, normalised, so the event key is the same on every retry. */
const stamp = (iso: string): string => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
};

/**
 * Steps 3 and 4 of the lock: the project moves to `board` (with the version number) and the board.plan job is queued.
 * Both reuse the stored LockedAt, so a retry or a repair never duplicates; `repaired` names what had to be done.
 * Skipped (nothing written) for a project that is past the board step.
 */
export async function completeLock(
  env: ScopeEnv,
  version: Pick<VersionView, "id" | "number" | "lockedAt">,
  milestones: readonly unknown[],
): Promise<{ boardPlanJobId: string; repaired: string[] }> {
  void milestones;
  const repaired: string[] = [];
  const step = stepOf(env.project);
  if (step !== "scope" && step !== "board") return { boardPlanJobId: "", repaired };
  const lockedAt = stamp(version.lockedAt);
  // The project move and the job are independent and each repeat-safe (stored LockedAt, eventKey): one round.
  const eventKey = `board.plan:${version.id}:${lockedAt}`;
  const create = (key: string) =>
    env.jobs.create({
      kind: "board.plan",
      // The contract shape: the locked scope and its milestones are read from the records by the engine.
      input: { projectId: env.projectId, scopeVersion: version.number },
      targetType: "scope-version",
      targetId: version.id,
      eventKey: key,
    });
  const [, first] = await Promise.all([
    step === "scope"
      ? env.db.update(SCHEMA.project, env.projectId, projectLockPatch(version.number, version.lockedAt, rev(env.project)))
      : Promise.resolve(null),
    create(eventKey),
  ]);
  // The same key gave back a cancelled plan (an unlock's cancel that raced this lock): queue it again under a
  // deterministic repair key, so a retry or a second repair finds that one and leaves exactly one live plan.
  const made = first.existing && first.job.Status === "cancelled" ? await create(`${eventKey}:requeue:${first.job.ItemId}`) : first;
  if (step === "scope") repaired.push("lock.project");
  if (!made.existing) repaired.push("lock.boardPlan");
  return { boardPlanJobId: made.job.ItemId, repaired };
}

function planOf(milestoneRows: Row[]): PlanMilestone[] | null {
  const out: PlanMilestone[] = [];
  for (const row of milestoneRows) {
    const m = milestoneRec(row);
    if (!m) return null;
    out.push({ id: m.id, number: m.number, name: m.name, goal: m.goal, featureRefs: m.featureRefs });
  }
  return out;
}

const LOCK_JOB_KINDS = ["board.plan", "milestones.suggest", "scope.draft", "scope.grill", "scope.success"] as const;
const isActive = (j: Row): boolean => ACTIVE.has(String(j.Status));

/** The project's active jobs the lock makes stale: suggestions and grills of any version, plans of other versions. */
function staleJobs(jobs: Row[], versionId: string): Row[] {
  return jobs.filter((j) => isActive(j) && (j.Kind === "board.plan" ? j.TargetId !== versionId : j.Kind === "milestones.suggest" || j.Kind === "scope.draft" || j.Kind === "scope.grill" || j.Kind === "scope.success"));
}

/**
 * QA4-07: Number follows SortOrder (position + 1). A target free at read time is written straight away; one held by
 * another row goes through a temporary Number now and gets its final Number in env.after (the bookkeeping round).
 */
function renumber(env: ScopeEnv, milestones: Row[]): { writes: Promise<unknown>[]; rows: Row[]; changed: boolean } {
  const ordered = byPlanOrder(milestones);
  const plan = planNumbers(milestones, ordered.map((r) => r.ItemId));
  const first = [...plan.direct, ...plan.temp];
  const writes = first.map((w) => env.db.update(SCHEMA.milestone, w.id, { Number: w.number }));
  if (plan.phase2.length) env.after(() => Promise.all(plan.phase2.map((w) => env.db.update(SCHEMA.milestone, w.id, { Number: w.number }))));
  const touched = new Set(first.map((w) => w.id));
  const rows = ordered.map((r) => ({ ...r, Number: plan.final.get(r.ItemId) as number, ...(touched.has(r.ItemId) ? { LastUpdatedDate: env.issuedStamp } : {}) }) as Row);
  return { writes, rows, changed: first.length > 0 };
}

const cancelStale = async (env: ScopeEnv, stale: Row[]): Promise<string[]> =>
  stale.length ? (await env.jobs.cancelRows(stale, "system")).cancelled : [];

export const scopeLock: ScopeOpDef<LockArgs> = {
  op: "scope.lock",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.lock"],
  parse: parseLockArgs,
  prefetch: (env, args) =>
    Promise.all([loadVersion(env, args.scopeVersionId), loadProjectScopeRows(env), env.jobs.list(LOCK_JOB_KINDS)]),
  async run(env, args) {
    const [version, allRows, jobs] = await Promise.all([
      loadVersion(env, args.scopeVersionId),
      loadProjectScopeRows(env),
      env.jobs.list(LOCK_JOB_KINDS),
    ]);
    if (!version) return fail("not_found");
    const state = scopeStateOf(allRows, version);
    const step = stepOf(env.project);
    const stale = staleJobs(jobs, version.id);

    if (version.status === "locked") {
      // Only the locker may complete an interrupted lock; a finished one is a plain conflict (a retry gets its answer).
      if (version.lockedByUserId !== env.userId) return fail("conflict", "scope.locked");
      const numbers = renumber(env, state.milestones);
      const [done, cancelledJobIds] = await Promise.all([
        completeLock(env, version, state.milestones),
        cancelStale(env, stale),
        ...numbers.writes,
      ]);
      if (done.repaired.length === 0 && !numbers.changed && cancelledJobIds.length === 0 && env.attempt <= 1) return fail("conflict", "scope.locked");
      env.audit("scope-version", version.id, { number: version.number, milestones: state.milestones.length });
      const moved = done.repaired.includes("lock.project");
      return ok({
        version: rawVersion(version),
        milestones: numbers.rows,
        project: moved ? { ...env.project, ...projectLockPatch(version.number, version.lockedAt, rev(env.project)), LastUpdatedDate: env.issuedStamp } : env.project,
        boardPlanJobId: done.boardPlanJobId,
        cancelledJobIds,
      });
    }
    // The lock's writes go out in one round: when the project move landed and the version write did not, the retry of the
    // same caller finishes the version (the project's stored ScopeLockedAt is the lock time the board.plan key was built on).
    const movedWithoutVersion =
      env.attempt > 1 &&
      step === "board" &&
      typeof env.project.ScopeLockedAt === "string" &&
      env.project.ScopeLockedAt !== "" &&
      env.project.CurrentScopeVersion === version.number;
    if (step !== "scope" && !movedWithoutVersion) return fail("conflict", "scope.notOpen");
    if (movedWithoutVersion) {
      const lockedAt = stamp(String(env.project.ScopeLockedAt));
      const patch = { Status: "locked", LockedAt: lockedAt, LockedByUserId: env.userId };
      const numbers = renumber(env, state.milestones);
      const [, done, cancelledJobIds] = await Promise.all([
        env.db.update(SCHEMA.scopeVersion, version.id, patch),
        completeLock(env, { id: version.id, number: version.number, lockedAt }, state.milestones),
        cancelStale(env, stale),
        ...numbers.writes,
      ]);
      env.audit("scope-version", version.id, { number: version.number, milestones: state.milestones.length });
      return ok({
        version: { ...rawVersion(version), ...patch, LastUpdatedDate: env.issuedStamp },
        milestones: numbers.rows,
        project: env.project,
        boardPlanJobId: done.boardPlanJobId,
        cancelledJobIds,
      });
    }

    const features = state.features.map(featureRec);
    const featureIdByKey = new Map(features.flatMap((f) => (f ? [[f.key, f.id] as [string, string]] : [])));
    const stories = state.stories.map((r) => storyRec(r, featureIdByKey));
    const plan = planOf(byPlanOrder(state.milestones));
    if (features.includes(null) || stories.includes(null) || !plan) {
      return fail("invalid_input", "scope.lockBlocked", { blockers: [{ kind: "unreadableRows" }] });
    }
    const fs = features.flatMap((f) => (f ? [f] : []));
    const ss = stories.flatMap((s) => (s ? [s] : []));
    // Stories are matched to features by the feature's ItemId (the stored Key is translated once in storyRec).
    const blockers = lockBlockers({
      features: fs.map((f) => ({ id: f.id, key: f.key, priority: f.priority })),
      stories: ss.map((s) => ({ id: s.id, featureId: s.featureId, text: s.text })),
      milestones: plan,
    });
    const included = fs.filter((f) => f.priority !== "excluded").map((f) => f.ref);
    const excluded = fs.filter((f) => f.priority === "excluded").map((f) => f.ref);
    const issues = validateMilestonePlan(plan, included, "lock", excluded);
    // Success & performance: every required value set, every question for the product manager answered or accepted
    const success = successBlockers(parseSuccessTargets(version.SuccessTargets));
    if (blockers.length || issues.length || success.length) return fail("invalid_input", "scope.lockBlocked", { blockers, issues, success });

    const permissions = env.isSuperAdmin ? WORKSPACE_PERMISSIONS : env.permissions;
    const accepted = journeyStep({ step: step as JourneyStep, scopeLocked: false }, "scope.lock", { kind: "user", permissions }, { milestoneCount: plan.length });
    if (!accepted.ok) return fail("conflict", "scope.notOpen");

    // The version, the project move, the board.plan job, the milestone numbers (QA4-07) and the stale jobs (QA4-15)
    // all go in one round; a retry or scope.open's repair completes whatever did not land.
    const versionPatch = { Status: "locked", LockedAt: env.nowIso, LockedByUserId: env.userId };
    const numbers = renumber(env, state.milestones);
    const [, done, cancelledJobIds] = await Promise.all([
      env.db.update(SCHEMA.scopeVersion, version.id, versionPatch),
      completeLock(env, { id: version.id, number: version.number, lockedAt: env.nowIso }, state.milestones),
      cancelStale(env, stale),
      ...numbers.writes,
    ]);
    env.audit("scope-version", version.id, { number: version.number, milestones: plan.length });
    return ok({
      version: { ...rawVersion(version), ...versionPatch, LastUpdatedDate: env.issuedStamp },
      milestones: numbers.rows,
      project: { ...env.project, ...projectLockPatch(version.number, env.nowIso, rev(env.project)), LastUpdatedDate: env.issuedStamp },
      boardPlanJobId: done.boardPlanJobId,
      cancelledJobIds,
    });
  },
};

export const scopeUnlock: ScopeOpDef<LockArgs> = {
  op: "scope.unlock",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.unlock"],
  parse: parseLockArgs,
  prefetch: (env, args) => Promise.all([loadVersion(env, args.scopeVersionId), env.jobs.list(UNLOCK_JOB_KINDS)]),
  async run(env, args) {
    const [version, jobs] = await Promise.all([loadVersion(env, args.scopeVersionId), env.jobs.list(UNLOCK_JOB_KINDS)]);
    if (!version) return fail("not_found");
    const step = stepOf(env.project);

    if (version.status === "draft" && step === "scope") {
      // Already open: the retry of an unlock that finished gets its answer; a first call is a mistake.
      if (env.attempt > 1) return ok({ version: rawVersion(version), project: env.project, cancelledJobId: null });
      return fail("conflict", "scope.notLocked");
    }
    // A lock interrupted before the project moved still stands at `scope`; unlocking it just reopens the version.
    const halfLocked = version.status === "locked" && step === "scope";
    if (!halfLocked && !canUnlock({ step, buildJobs: jobs.map((j) => ({ kind: String(j.Kind), status: String(j.Status) })) })) {
      return fail("conflict", "build.started");
    }

    // Every active board.plan job of the project goes (older stale plans too); one the user cannot cancel stops the
    // unlock before anything is written.
    const toCancel = jobs.filter((j) => j.Kind === "board.plan" && isActive(j));
    const cancellable = toCancel.every((j) => {
      const status = j.Status;
      return (
        isEngineJobStatus(status) &&
        canApplyJobEvent(
          { status, progress: Number(j.Progress ?? 0), attempts: Number(j.Attempts ?? 0), message: typeof j.Message === "string" && j.Message ? j.Message : null },
          "cancel",
          "user",
        )
      );
    });
    if (!cancellable) return fail("conflict", "scope.planRunning");
    if (step === "board") {
      const permissions = env.isSuperAdmin ? WORKSPACE_PERMISSIONS : env.permissions;
      const accepted = journeyStep({ step: "board", scopeLocked: true }, "scope.unlock", { kind: "user", permissions });
      if (!accepted.ok) return fail("conflict", "build.started");
    }
    // One round: the cancels, the version back to a draft (LockedAt / LockedByUserId stay as history; the next lock
    // overwrites them) and the project back to the scope step. Nothing is read back.
    const versionPatch = { Status: "draft", UnlockedAt: env.nowIso };
    const projectPatch = projectUnlockPatch(rev(env.project));
    const [cancelled] = await Promise.all([
      toCancel.length ? env.jobs.cancelRows(toCancel, "user") : Promise.resolve({ cancelled: [] as string[], skipped: [] as string[] }),
      version.status !== "draft" ? env.db.update(SCHEMA.scopeVersion, version.id, versionPatch) : null,
      step === "board" ? env.db.update(SCHEMA.project, env.projectId, projectPatch) : null,
    ]);
    if (cancelled.skipped.length > 0) {
      // A plan the state machine refused after the read (it moved on in between): undo the reopen, the user retries.
      await Promise.all([
        version.status !== "draft" ? env.db.update(SCHEMA.scopeVersion, version.id, { Status: version.status }) : null,
        step === "board" ? env.db.update(SCHEMA.project, env.projectId, { Stage: step }) : null,
      ]);
      return fail("conflict", "scope.planRunning");
    }
    // The audit. Tickets already planned for the lock stay; nothing is deleted here.
    env.audit("scope-version", version.id, { number: version.number, unlocked: true });
    const mine = toCancel.find((j) => j.TargetId === version.id && cancelled.cancelled.includes(j.ItemId));
    return ok({
      version: version.status !== "draft" ? { ...rawVersion(version), ...versionPatch, LastUpdatedDate: env.issuedStamp } : rawVersion(version),
      project: step === "board" ? { ...env.project, ...projectPatch, LastUpdatedDate: env.issuedStamp } : env.project,
      cancelledJobId: mine?.ItemId ?? cancelled.cancelled[cancelled.cancelled.length - 1] ?? null,
    });
  },
};

export const LOCK_HANDLERS: ScopeOpDef[] = [scopeLock, scopeUnlock];

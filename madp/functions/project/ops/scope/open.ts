/**
 * scope.open: the page calls it once on entry. A "command" because it may write, but it only applies deterministic
 * consequences of state that was already authorised (design 6.1 reconcile rule), so a viewer may call it:
 *  - product design is already reviewed in Requirements; no screenshot job is queued here;
 *  - the scope.draft job of a project that has just reached Scope & success: its draft version (or none yet) has no
 *    features while the requirements exist, so the product manager drafts the plan from them. Once per version, ever
 *    (its eventKey): features a person removed later never come back;
 *  - the repair of an interrupted scope.lock / scope.unlock.
 * Depends only on the scope env contract (./ports, ./records, ./shared) and src/domain by relative path.
 */
import { SCOPE_OP_PERMISSION } from "../../../../src/domain/scope";
import { ok, parseArgs, type Row, type ScopeEnv, type ScopeOpDef } from "./ports";
import { SCHEMA, jobRec, type JobRec } from "./records";
import { completeLock } from "./lock";
import { latestVersion, stepOf, type VersionView } from "./shared";

interface OpenArgs {
  projectId: string;
}

const ACTIVE = new Set(["queued", "claimed", "running"]);
const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

const OPEN_JOB_KINDS = ["board.plan", "scope.draft"] as const;

/** The scope.draft job to queue, or null: at the scope step, a draft version (or none yet) without features, requirements
 *  to draft from, and no draft job for this project yet (whatever became of an earlier one). */
export function wantsDraft(o: {
  step: string; version: { number: number; status: string } | null; featureCount: number; requirementCount: number; draftJobs: number;
}): { scopeVersion: number } | null {
  if (o.step !== "scope" || o.draftJobs > 0 || o.requirementCount === 0 || o.featureCount > 0) return null;
  if (o.version && o.version.status !== "draft") return null;
  return { scopeVersion: o.version?.number ?? 1 };
}

async function createDraftJob(env: ScopeEnv, scopeVersion: number): Promise<string> {
  // the rows are drafted for the project's assignee (or whoever opened the page first)
  const assignee = typeof env.project.AssigneeUserId === "string" ? env.project.AssigneeUserId : "";
  const requester = assignee && (await env.isActiveMember(assignee)) ? assignee : env.userId;
  const { job } = await env.jobs.create({
    kind: "scope.draft",
    input: { projectId: env.projectId, scopeVersion },
    targetType: "project",
    targetId: env.projectId,
    eventKey: `scope.draft:${env.projectId}:v${scopeVersion}`,
    requestedByUserId: requester,
  });
  return job.ItemId;
}

/** The repair of an interrupted lock / unlock: every write goes out in the caller's one round, nothing is read back. */
function repairs(env: ScopeEnv, version: VersionView, jobs: JobRec[], rows: Row[]): { writes: Promise<unknown>[]; repaired: () => string[] } {
  const repaired: string[] = [];
  const step = stepOf(env.project);
  const plans = jobs.filter((j) => j.kind === "board.plan" && j.targetId === version.id);
  const writes: Promise<unknown>[] = [];

  if (version.status === "locked") {
    // Locked, but the project is still at `scope`, or the board.plan job is missing: finish the lock.
    const planned = plans.some((j) => j.status !== "cancelled" && ms(j.createdAt) >= ms(version.lockedAt));
    if (step === "scope" || (step === "board" && !planned)) {
      writes.push(completeLock(env, version, []).then((done) => void repaired.push(...done.repaired)));
    }
  } else {
    // A draft must have no live board.plan job (an interrupted unlock). A plan newer than the version row belongs to a
    // lock in flight (its version write has not landed yet): it is left alone and the locker's retry completes it.
    const draftAt = ms(version.updatedAt);
    const live = new Set(plans.filter((job) => ACTIVE.has(job.status) && ms(job.createdAt) < draftAt).map((job) => job.id));
    const toCancel = rows.filter((r) => live.has(r.ItemId));
    if (toCancel.length) {
      writes.push(
        env.jobs.cancelRows(toCancel, "system").then((res) => {
          if (res.cancelled.length) repaired.push("unlock.boardPlan");
        }),
      );
    }
  }
  return { writes, repaired: () => repaired };
}

export const scopeOpen: ScopeOpDef<OpenArgs> = {
  op: "scope.open",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.open"],
  parse: (raw) => parseArgs(raw, {}) as ReturnType<ScopeOpDef<OpenArgs>["parse"]>,
  prefetch: (env) =>
    Promise.all([
      latestVersion(env),
      env.jobs.list(OPEN_JOB_KINDS),
      env.db.query(SCHEMA.feature, { ProjectId: env.projectId }, { fields: ["ItemId", "ScopeVersion"] }),
      env.db.query(SCHEMA.requirement, { ProjectId: env.projectId }, { fields: ["ItemId", "Status"] }),
    ]),
  async run(env) {
    const [version, jobRows, featureRows, requirementRows] = await Promise.all([
      latestVersion(env),
      env.jobs.list(OPEN_JOB_KINDS),
      env.db.query(SCHEMA.feature, { ProjectId: env.projectId }, { fields: ["ItemId", "ScopeVersion"] }),
      env.db.query(SCHEMA.requirement, { ProjectId: env.projectId }, { fields: ["ItemId", "Status"] }),
    ]);
    const jobs = jobRows.flatMap((r: Row) => {
      const j = jobRec(r);
      return j ? [j] : [];
    });
    const repair = version ? repairs(env, version, jobs, jobRows) : { writes: [], repaired: () => [] as string[] };
    const draft = wantsDraft({
      step: stepOf(env.project),
      version: version ? { number: version.number, status: String(version.Status ?? version.status) } : null,
      featureCount: featureRows.filter((r) => !version || Number(r.ScopeVersion ?? 1) === version.number).length,
      requirementCount: requirementRows.filter((r) => r.Status !== "dropped").length,
      draftJobs: jobs.filter((j) => j.kind === "scope.draft").length,
    });
    let draftJobId: string | null = null;
    const drafting = draft ? createDraftJob(env, draft.scopeVersion).then((id) => void (draftJobId = id)) : null;

    await Promise.all([drafting, ...repair.writes]);
    const repaired = repair.repaired();
    if (version && repaired.length) env.audit("scope-version", version.id, { number: version.number, repaired: repaired.join(",") });
    return ok({ designJobId: null, draftJobId, repaired });
  },
};

export const OPEN_HANDLERS: ScopeOpDef[] = [scopeOpen];

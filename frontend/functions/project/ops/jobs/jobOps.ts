// The generic job.* ops on mf-project (docs/ENGINE-CONTRACT.md section 4). Thin ops over deps.jobs.
import {
  applyJobEvent,
  isEngineJobKind,
  isEngineJobStatus,
  isTerminal,
  MAX_JOB_ATTEMPTS,
  type EngineJobKind,
} from "../../../../src/domain/engineJob";
import { activeKeyOf, defineOp, JOB_FIELDS } from "../../../_lib";
import type { Row } from "../../../_lib";
import { MAX_JOB_INPUT_CHARS, retryHostClaim } from "../../../_lib/jobs";
import { OpError } from "../../../_lib/errors";
import { v } from "../../../_lib/validate";
import { kindPermissions } from "./permissions";

const jobIdArgs = v.object({ jobId: v.id() });

interface JobCtx {
  caller: { userId: string };
  permissions: readonly string[];
  anchor?: Record<string, unknown> | null;
}

/** The requester, or a holder of the kind's permission. */
function mayActOn(ctx: JobCtx): { kind: EngineJobKind } | null {
  const anchor = ctx.anchor;
  const kind = anchor?.Kind;
  if (!anchor || !isEngineJobKind(kind)) return null;
  if (anchor.RequestedByUserId === ctx.caller.userId) return { kind };
  if (kindPermissions(kind).some((p) => ctx.permissions.includes(p))) return { kind };
  return null;
}

/** The job row of the op: one read, warmed by the prefetch in the router's round 1 (the memo answers the handler). */
async function loadJob(deps: { gw: { get(schema: string, id: string, fields: readonly string[]): Promise<Row | null> } }, jobId: string): Promise<Row> {
  const row = await deps.gw.get("EngineJob", jobId, JOB_FIELDS);
  if (!row) throw new OpError("not_found");
  return { ...row, ItemId: jobId };
}

const prefetchJob = (p: { args: { jobId: string }; gw: { get(schema: string, id: string, fields: readonly string[]): Promise<unknown> } | null }) =>
  p.gw ? p.gw.get("EngineJob", p.args.jobId, JOB_FIELDS) : undefined;

const jobCancel = defineOp({
  op: "job.cancel",
  kind: "command",
  scope: "project",
  permission: "membership",
  projectFrom: { schema: "EngineJob", arg: "jobId" },
  args: jobIdArgs,
  prefetch: prefetchJob,
  async handler(ctx, args, deps) {
    const allowed = mayActOn(ctx as unknown as JobCtx);
    if (!allowed) return deps.fail("forbidden");
    const job = await deps.jobs.cancel(args.jobId, { actor: "user", row: await loadJob(deps, args.jobId) });
    deps.audit({ targetType: "engine-job", targetId: args.jobId, details: { kind: allowed.kind } });
    return { jobId: args.jobId, status: String(job.Status) };
  },
});

const jobRetry = defineOp({
  op: "job.retry",
  kind: "command",
  scope: "project",
  permission: "membership",
  projectFrom: { schema: "EngineJob", arg: "jobId" },
  args: jobIdArgs,
  prefetch: prefetchJob,
  async handler(ctx, args, deps) {
    const allowed = mayActOn(ctx as unknown as JobCtx);
    if (!allowed) return deps.fail("forbidden");
    // The requester is re-checked against the CURRENT permission for the kind (a demoted requester cannot re-queue a privileged job).
    const needed = kindPermissions(allowed.kind);
    if (needed.length > 0 && !needed.some((p) => (ctx as unknown as JobCtx).permissions.includes(p))) return deps.fail("forbidden");
    // One write round on the row the prefetch read. The "already active" clash is the unique ActiveKey index's to refuse:
    // the update fails with a conflict, answered as job.alreadyActive (a pre-read of the key would cost a round).
    const job = await loadJob(deps, args.jobId);
    const status = job.Status;
    const attempts = typeof job.Attempts === "number" ? job.Attempts : 0;
    if (!isEngineJobStatus(status) || status !== "failed" || attempts >= MAX_JOB_ATTEMPTS) throw new OpError("conflict", "job.notRetryable");
    const msg = job.Message;
    const res = applyJobEvent(
      { status, progress: typeof job.Progress === "number" ? job.Progress : 0, attempts, message: typeof msg === "string" && msg !== "" ? msg : null },
      "retry",
      "user",
    );
    if (!res.ok) throw new OpError("conflict", "job.notRetryable");
    if (isTerminal(res.job.status)) throw new OpError("internal");
    const targetId = typeof job.TargetId === "string" && job.TargetId !== "" ? job.TargetId : undefined;
    const patch = {
      Status: res.job.status,
      Progress: res.job.progress,
      Attempts: res.job.attempts,
      Message: res.job.message ?? "",
      ActiveKey: activeKeyOf(String(job.Kind), targetId),
      ...retryHostClaim(job, ctx.now.toISOString()),
    };
    try {
      await deps.gw.update("EngineJob", args.jobId, patch);
    } catch (e) {
      if (e instanceof OpError && e.code === "conflict") throw new OpError("conflict", "job.alreadyActive");
      throw e;
    }
    deps.audit({ targetType: "engine-job", targetId: args.jobId, details: { kind: allowed.kind } });
    return { jobId: args.jobId, status: String(patch.Status) };
  },
});

interface JobCreateArgs {
  projectId: string;
  kind: EngineJobKind;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function bad(field: string, rule: string): never {
  throw new OpError("invalid_input", undefined, { field, rule });
}

/** projectId, kind and an optional input of any JSON (at most MAX_JOB_INPUT_CHARS); the input is never stored. */
function parseJobCreate(raw: unknown): JobCreateArgs {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return bad("args", "object");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "projectId" && k !== "kind" && k !== "input") bad(k, "unknown");
  if (typeof o.projectId !== "string" || !SAFE_ID.test(o.projectId)) bad("projectId", "id");
  if (!isEngineJobKind(o.kind)) bad("kind", "enum");
  if (o.input !== undefined) {
    let size = 0;
    try {
      size = JSON.stringify(o.input)?.length ?? 0;
    } catch {
      bad("input", "json");
    }
    if (size > MAX_JOB_INPUT_CHARS) bad("input", "max");
  }
  return { projectId: o.projectId as string, kind: o.kind as EngineJobKind };
}

// Every current kind is created by a feature op that checks its own gates and builds InputJson on the
// server. A later lane may open a kind here only with a per-kind input validator that checks every id
// against the project. Client-supplied InputJson is never stored.
const jobCreate = defineOp({
  op: "job.create",
  kind: "command",
  scope: "project",
  permission: "membership",
  args: parseJobCreate,
  async handler(_ctx, _args, deps) {
    return deps.fail("forbidden", "job.useStepAction");
  },
});

export const JOB_OPS = [jobCreate, jobCancel, jobRetry];

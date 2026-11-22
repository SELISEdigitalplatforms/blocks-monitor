/**
 * milestones.suggest and scope.grill: the job.create entries. The InputJson is built here from record ids only;
 * anything the client sends beyond the listed args is dropped.
 */
import { SCOPE_OP_PERMISSION } from "../../../../src/domain/scope";
import { fail, ok, type Row as PortRow, type ScopeEnv, type ScopeOpDef, type ScopeReadEnv } from "./ports";
import { SCHEMA, featureRec } from "./records";
import { loadVersion, refuseUnlessDraftOpen } from "./shared";

type Row = Record<string, any>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (key: string) => ({ ok: false as const, messageKey: "input.wrongType", params: { key } });
const NOTE_MAX = 500;

function parseBase(raw: unknown, withNote: boolean) {
  if (!isObj(raw)) return bad("args");
  const { projectId, scopeVersionId, note } = raw;
  if (typeof projectId !== "string" || !projectId) return bad("projectId");
  if (typeof scopeVersionId !== "string" || !scopeVersionId) return bad("scopeVersionId");
  const value: { projectId: string; scopeVersionId: string; note?: string } = { projectId, scopeVersionId };
  if (withNote && note !== undefined) {
    if (typeof note !== "string") return bad("note");
    if (note.length > NOTE_MAX) return { ok: false as const, messageKey: "input.tooLong", params: { key: "note", max: NOTE_MAX } };
    if (note.trim()) value.note = note.trim();
  }
  return { ok: true as const, value };
}

const featureRows = (env: ScopeReadEnv): Promise<PortRow[]> =>
  env.db.query(SCHEMA.feature, { ProjectId: env.projectId }, { sort: { field: "SortOrder", dir: "asc" } }) as Promise<PortRow[]>;
const ACTIVE = new Set(["queued", "claimed", "running"]);

async function createJob(env: ScopeEnv, kind: string, args: { scopeVersionId: string; note?: string }, needFeatures: boolean) {
  // One round: the version, (when needed) the project's features (narrowed to the version below) and the jobs of this kind.
  const [version, features, jobs] = await Promise.all([
    loadVersion(env, args.scopeVersionId),
    needFeatures ? featureRows(env) : Promise.resolve([] as Row[]),
    env.jobs.list([kind]),
  ]);
  if (!version) return fail("not_found");
  const refused = refuseUnlessDraftOpen(env, version);
  if (refused) return refused;
  if (needFeatures) {
    const included = (features as Row[]).filter(
      (r) => Number(r.ScopeVersion) === version.number && featureRec(r)!.priority !== "excluded" && r.Status !== "dropped",
    );
    if (!included.length) return fail("invalid_input", "milestones.needsFeatures");
  }
  const input = {
    projectId: env.projectId,
    scopeVersion: version.number,
    ...(args.note ? { note: args.note } : {}),
  };
  // Only the current job stays queued: the active ones of this kind for another version are cancelled in the same round.
  const stale = jobs.filter((j) => j.Kind === kind && j.TargetId !== version.id && ACTIVE.has(String(j.Status)));
  const [made, cancelled] = await Promise.all([
    env.jobs.create({ kind, input, targetType: "scope-version", targetId: version.id }),
    stale.length ? env.jobs.cancelRows(stale, "system") : Promise.resolve({ cancelled: [] as string[], skipped: [] as string[] }),
  ]);
  return ok({ job: made.job, existing: made.existing, cancelledJobIds: cancelled.cancelled });
}

const prefetchJob = (env: ScopeReadEnv, kind: string, args: { scopeVersionId: string }, needFeatures: boolean) =>
  Promise.all([loadVersion(env, args.scopeVersionId), needFeatures ? featureRows(env) : null, env.jobs.list([kind])]);

export const milestonesSuggest: ScopeOpDef = {
  op: "milestones.suggest",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["milestones.suggest"],
  parse: (raw) => parseBase(raw, true),
  prefetch: (env, args) => prefetchJob(env, "milestones.suggest", args, true),
  run: (env, args) => createJob(env, "milestones.suggest", args, true),
};

export const scopeGrill: ScopeOpDef = {
  op: "scope.grill",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.grill"],
  parse: (raw) => parseBase(raw, false),
  prefetch: (env, args) => prefetchJob(env, "scope.grill", args, false),
  run: (env, args) => createJob(env, "scope.grill", args, false),
};

export const SCOPE_JOB_HANDLERS: ScopeOpDef[] = [milestonesSuggest, scopeGrill];

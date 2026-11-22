/** scope.challenge.decide / undo: record the person's decision on a second-opinion point. An accepted fix that moves
 *  work between milestones (a milestone point, or a fix that names a milestone) also queues milestones.suggest with the
 *  fix as the note (adjust: that one change, every other assignment kept), so the planner moves what the fix says and
 *  nothing else; no other record is written. */
import { SCOPE_OP_PERMISSION } from "../../../../src/domain/scope";
import { fail, ok, type ScopeEnv, type ScopeOpDef, type ScopeReadEnv } from "./ports";
import { SCHEMA, challengeDecisionPatch, challengeUndoPatch } from "./records";
import { findInProject, latestVersion, refuseUnlessDraftOpen } from "./shared";

type Row = Record<string, any>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (key: string) => ({ ok: false as const, messageKey: "input.wrongType", params: { key } });
const readChallenge = (env: ScopeReadEnv, args: { challengeId: string }) => findInProject(env as unknown as ScopeEnv, SCHEMA.challenge, args.challengeId);
const TEXT_MAX = 5000;
const DECISIONS = ["accepted", "answered", "dismissed"] as const;
type Decision = (typeof DECISIONS)[number];
const NOTE_MAX = 500;
const ACTIVE = new Set(["queued", "claimed", "running"]);

/** The note for milestones.suggest when an accepted fix changes the milestones, else null (pure). */
export function milestoneNoteOf(row: { ChallengeType?: unknown; Question?: unknown }, fix: string): string | null {
  const text = fix.trim();
  if (!text) return null;
  const rule = String(row.ChallengeType ?? "");
  if (rule !== "milestone-order" && rule !== "milestone-gap" && !/\bmilestones?\b/i.test(text)) return null;
  return text.length <= NOTE_MAX ? text : `${text.slice(0, NOTE_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

export const challengeDecide: ScopeOpDef = {
  op: "scope.challenge.decide",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.challenge.decide"],
  parse(raw) {
    if (!isObj(raw)) return bad("args");
    const { projectId, challengeId, decision, text } = raw;
    if (typeof projectId !== "string" || !projectId) return bad("projectId");
    if (typeof challengeId !== "string" || !challengeId) return bad("challengeId");
    if (!DECISIONS.includes(decision as Decision)) return bad("decision");
    const value: { projectId: string; challengeId: string; decision: Decision; text?: string } = {
      projectId,
      challengeId,
      decision: decision as Decision,
    };
    if (text !== undefined) {
      if (typeof text !== "string") return bad("text");
      if (text.length > TEXT_MAX) return { ok: false as const, messageKey: "input.tooLong", params: { key: "text", max: TEXT_MAX } };
      if (text.trim()) value.text = text.trim();
    }
    return { ok: true as const, value };
  },
  prefetch: (env: ScopeReadEnv, args: { challengeId: string }) => Promise.all([readChallenge(env, args), latestVersion(env)]),
  async run(env, args: { challengeId: string; decision: Decision; text?: string }) {
    const [found, version] = await Promise.all([findInProject(env, SCHEMA.challenge, args.challengeId), latestVersion(env)]);
    const row = found as Row | null;
    if (!row) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;
    if (args.decision === "dismissed" && !args.text) return fail("invalid_input", "challenge.reasonRequired");
    if (args.decision === "answered" && !args.text) return fail("invalid_input", "challenge.textRequired");

    const decided = row.Status && row.Status !== "open";
    if (decided) {
      if (row.Status === args.decision && row.DecidedByUserId === env.userId) return ok({ challenge: row });
      return fail("conflict", "challenge.decided");
    }
    const text = args.text ?? (args.decision === "accepted" ? String(row.SuggestedFix ?? "") : undefined);
    const patch = challengeDecisionPatch(args.decision, text, env.userId, env.nowIso);
    const note = args.decision === "accepted" && version ? milestoneNoteOf(row, text ?? "") : null;
    const [, milestonesJob] = await Promise.all([
      env.db.update(SCHEMA.challenge, args.challengeId, patch),
      note && version ? queueMilestones(env, version.id, version.number, note, args.challengeId) : Promise.resolve(null),
    ]);
    // The answer is the row as written, with this request's issued stamp (no read-back).
    return ok({ challenge: { ...row, ...patch, LastUpdatedDate: env.issuedStamp }, ...(milestonesJob ? { milestonesJobId: milestonesJob } : {}) });
  },
};

/** Queues milestones.suggest for the version with the fix as its note (an active one of another version is left as it is);
 *  answers the job id, or null when it could not be queued (the decision stands either way). */
async function queueMilestones(env: ScopeEnv, versionId: string, versionNumber: number, note: string, challengeId: string): Promise<string | null> {
  try {
    const jobs = await env.jobs.list(["milestones.suggest"]);
    if (jobs.some((j) => j.TargetId === versionId && ACTIVE.has(String(j.Status)))) return null;
    const made = await env.jobs.create({
      kind: "milestones.suggest",
      // adjust: the planner applies this one change and keeps every other assignment (kinds/scope/milestones.ts)
      input: { projectId: env.projectId, scopeVersion: versionNumber, note, adjust: true, challengeId },
      targetType: "scope-version",
      targetId: versionId,
    });
    return String(made.job.ItemId ?? "") || null;
  } catch {
    return null;
  }
}

export const challengeUndo: ScopeOpDef = {
  op: "scope.challenge.undo",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.challenge.undo"],
  parse(raw) {
    if (!isObj(raw)) return bad("args");
    const { projectId, challengeId } = raw;
    if (typeof projectId !== "string" || !projectId) return bad("projectId");
    if (typeof challengeId !== "string" || !challengeId) return bad("challengeId");
    return { ok: true as const, value: { projectId, challengeId } };
  },
  prefetch: (env: ScopeReadEnv, args: { challengeId: string }) => Promise.all([readChallenge(env, args), latestVersion(env)]),
  async run(env, args: { challengeId: string }) {
    const [found, version] = await Promise.all([findInProject(env, SCHEMA.challenge, args.challengeId), latestVersion(env)]);
    const row = found as Row | null;
    if (!row) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;
    if (row.Status === "open") return ok({ challenge: row });
    const patch = challengeUndoPatch();
    await env.db.update(SCHEMA.challenge, args.challengeId, patch);
    return ok({ challenge: { ...row, ...patch, LastUpdatedDate: env.issuedStamp } });
  },
};

export const CHALLENGE_HANDLERS: ScopeOpDef[] = [challengeDecide, challengeUndo];

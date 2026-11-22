import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";
import { fail, fromCheck, gate, ok, requirePermission, withReads } from "./common";

type Reader = Pick<ReadEnv, "gateway" | "project">;
import { parseAssistInput, parseInstruction, sanitizationPhase } from "../../../../src/domain/sanitization";
import { isTerminal } from "../../../../src/domain/engineJob";

type Args = Record<string, unknown>;

export interface JobRefs {
  docNoteIds: string[];
  docFileIds: string[];
  clarificationIds: string[];
  decisionIds: string[];
  techDecisionIds: string[];
  requirementIds: string[];
}

type Focus = "clarifications" | "technical" | "requirements";

/** InputJson for requirements.draft: record ids only. */
export function buildDraftInput(projectId: string, refs: JobRefs, instruction?: string) {
  const input: Record<string, unknown> = { projectId, sanitizationVersion: 1, refs };
  if (instruction) input.instruction = instruction;
  return input;
}

/** InputJson for sanitization.assist: record ids only. */
export function buildAssistInput(
  projectId: string,
  focus: Focus,
  refId: string | undefined,
  question: string | undefined,
  refs: JobRefs,
) {
  const input: Record<string, unknown> = { projectId, focus, refs };
  if (refId) input.refId = refId;
  if (question) input.question = question;
  return input;
}

const ids = (rows: Row[]) => rows.map((r) => String(r.ItemId)).sort();
// Only fields the schemas have (DocNote has no Status): the Status conditions stay in the filters.
const IDS = { fields: ["ItemId"], max: 1000 };
const IDS_STATUS = { fields: ["ItemId", "Status"], max: 1000 };

export async function loadRefs(ctx: Reader): Promise<JobRefs> {
  const p = { ProjectId: ctx.project.ItemId };
  const [notes, files, clars, decs, techs, reqs] = await Promise.all([
    ctx.gateway.list("DocNote", p, IDS),
    ctx.gateway.list("DocFile", { ...p, Status: "ready" }, IDS),
    ctx.gateway.list("Clarification", { ...p, Status: { in: ["answered", "deferred"] } }, IDS),
    ctx.gateway.list("Decision", { ...p, Status: "accepted" }, IDS),
    ctx.gateway.list("TechDecision", p, IDS_STATUS),
    ctx.gateway.list("Requirement", p, IDS),
  ]);
  return {
    docNoteIds: ids(notes),
    docFileIds: ids(files),
    clarificationIds: ids(clars),
    decisionIds: ids(decs),
    techDecisionIds: ids(techs.filter((t) => t.Status !== "rejected")),
    requirementIds: ids(reqs),
  };
}

function listJobs(ctx: Reader, kind: string) {
  return ctx.gateway.list(
    "EngineJob",
    { ProjectId: ctx.project.ItemId, Kind: kind },
    { fields: ["ItemId", "Status", "InputJson"], sort: [{ field: "CreatedDate", dir: "desc" }], first: 50 },
  );
}

function parseJson(s: unknown): Record<string, unknown> {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The reads of sanitization.draftInitial (shared with its prefetch): the open jobs and the record ids, in one round. */
const draftReads = (env: Reader) => Promise.all([listJobs(env, "requirements.draft"), loadRefs(env)]);

async function draftInitial(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "current");
  if (blocked) return blocked;
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const parsed = parseInstruction(args.instruction);
  if (!parsed.ok) return fromCheck(parsed);

  const [jobs, refs] = await draftReads(ctx);
  const open = jobs.find((j) => !isTerminal(j.Status as never));
  if (open) return ok({ jobId: String(open.ItemId), existing: true });

  const instruction = parsed.value ? String(parsed.value) : undefined;
  const made = await ctx.jobs.create({
    kind: "requirements.draft",
    projectId: ctx.project.ItemId,
    inputJson: buildDraftInput(ctx.project.ItemId, refs, instruction),
  });
  ctx.audit({ action: "sanitization.draftInitial", targetType: "engine-job", targetId: made.jobId, details: { kind: "requirements.draft", existing: made.existing } });
  return ok({ jobId: made.jobId, existing: made.existing });
}

const FOCUS_SCHEMA: Record<Focus, string> = {
  clarifications: "Clarification",
  technical: "TechDecision",
  requirements: "Requirement",
};

/** The reads of sanitization.assist (shared with its prefetch): the referenced record, the open jobs and the record ids. */
const assistReads = (env: Reader, focus: Focus, refId: string) =>
  Promise.all([
    refId ? env.gateway.get(FOCUS_SCHEMA[focus], refId) : Promise.resolve(null),
    listJobs(env, "sanitization.assist"),
    loadRefs(env),
  ]);

function assistPrefetch(env: Reader, args: Args) {
  const parsed = parseAssistInput(args);
  if (!parsed.ok) return null;
  const { focus, refId } = parsed.value as { focus: Focus; refId: string };
  return assistReads(env, focus, refId);
}

async function assist(args: Args, ctx: OpContext): Promise<OpResult> {
  const blocked = gate(ctx, "reachable");
  if (blocked) return blocked;
  if (args.focus === "requirements" && sanitizationPhase({ stage: String(ctx.project.Stage ?? ""), resumeTo: typeof ctx.project.ResumeTo === "string" ? ctx.project.ResumeTo : undefined }) === "completed") {
    return fail("invalid_input", "sanitization.v1Frozen");
  }
  const denied = requirePermission(ctx, "sanitization.edit");
  if (denied) return denied;
  const parsed = parseAssistInput(args);
  if (!parsed.ok) return fromCheck(parsed);
  const { focus, refId, question } = parsed.value as { focus: Focus; refId: string; question: string };

  const [refRow, jobs, refs] = await assistReads(ctx, focus, refId);
  if (refId && (!refRow || refRow.ProjectId !== ctx.project.ItemId)) {
    return fail("invalid_input", "sanitization.badReference", { field: "refId" });
  }

  const same = jobs.find((j) => {
    if (isTerminal(j.Status as never)) return false;
    const input = parseJson(j.InputJson);
    return input.focus === focus && String(input.refId ?? "") === (refId || "");
  });
  if (same) return ok({ jobId: String(same.ItemId), existing: true });
  // Every assist job shares one ActiveKey: another focus or record would clash with the open job and be dropped.
  if (jobs.some((j) => !isTerminal(j.Status as never))) return fail("conflict", "sanitization.assistBusy");

  const made = await ctx.jobs.create({
    kind: "sanitization.assist",
    projectId: ctx.project.ItemId,
    inputJson: buildAssistInput(ctx.project.ItemId, focus, refId || undefined, question || undefined, refs),
  });
  ctx.audit({ action: "sanitization.assist", targetType: "engine-job", targetId: made.jobId, details: { kind: "sanitization.assist", focus, existing: made.existing } });
  return ok({ jobId: made.jobId, existing: made.existing });
}

export const SANITIZATION_JOB_OPS: OpTable = {
  "sanitization.draftInitial": withReads(draftInitial, { prefetch: (env) => draftReads(env) }),
  "sanitization.assist": withReads(assist, { prefetch: assistPrefetch }),
};

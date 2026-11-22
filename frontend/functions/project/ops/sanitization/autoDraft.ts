// The first requirements are prepared behind the scenes: once every question is answered or set aside (and the
// product manager's reading has finished writing questions), the answer that handled the last open question queues the
// requirements draft (requirements.draft), so they are ready in Goals & requirements when the person continues.
// Nothing is queued while a draft runs or after one finished, when requirements exist already, or after the sign-off;
// a failure here never fails the answer (the step then offers to prepare the draft itself).
// A draft made before the questions were answered (someone asked for it early) is refreshed instead: when the last
// open question is handled and the newest draft did not see every answer, a requirements.draft with purpose "refresh"
// rewrites the drafted requirements nobody has edited, with the answers in its prompt.
import { isTerminal } from "../../../../src/domain/engineJob";
import { sanitizationPhase } from "../../../../src/domain/sanitization";
import { buildDraftInput, loadRefs } from "./jobs";
import type { OpContext, Row } from "./ports";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function inputOf(job: Row): { focus?: unknown; purpose?: unknown; refs?: { clarificationIds?: unknown } } {
  try {
    const v = JSON.parse(str(job.InputJson)) as unknown;
    return v && typeof v === "object" ? (v as ReturnType<typeof inputOf>) : {};
  } catch {
    return {};
  }
}

function focusOf(job: Row): string {
  const v = inputOf(job).focus;
  return typeof v === "string" ? v : "";
}

/** The requirements draft jobs proper (not the review for suggestions, not the landing page section), newest first. */
const draftJobs = (jobs: readonly Row[]): Row[] =>
  jobs.filter((j) => j.Kind === "requirements.draft" && ["", "refresh"].includes(String(inputOf(j).purpose ?? "")));

/** Whether a finished draft should be refreshed with the answers now (pure): every question handled, no draft or
 *  question job running, and the newest finished draft did not see every answered or set-aside question. */
export function shouldRefresh(o: { openQuestions: number; anyQuestions: number; requirements: number; jobs: readonly Row[]; handledIds: readonly string[] }): boolean {
  if (o.openQuestions > 0 || o.anyQuestions === 0 || o.requirements === 0 || o.handledIds.length === 0) return false;
  for (const j of o.jobs) {
    const active = !isTerminal(j.Status as never);
    if (active && (j.Kind === "requirements.draft" || (j.Kind === "sanitization.assist" && focusOf(j) === "clarifications"))) return false;
  }
  const last = draftJobs(o.jobs).find((j) => j.Status === "succeeded");
  if (!last) return false;
  const seen = inputOf(last).refs?.clarificationIds;
  const covered = new Set(Array.isArray(seen) ? seen.map(String) : []);
  return o.handledIds.some((id) => !covered.has(id));
}

/** Whether the draft should start now, from the rows read (pure). */
export function shouldDraft(o: { openQuestions: number; anyQuestions: number; requirements: number; jobs: readonly Row[] }): boolean {
  if (o.openQuestions > 0 || o.anyQuestions === 0 || o.requirements > 0) return false;
  for (const j of o.jobs) {
    const active = !isTerminal(j.Status as never);
    if (j.Kind === "sanitization.assist" && active && focusOf(j) === "clarifications") return false;
    if (j.Kind === "requirements.draft" && (active || j.Status === "succeeded")) return false;
  }
  return true;
}

export async function draftWhenAnswered(ctx: OpContext): Promise<string | null> {
  try {
    const p = ctx.project;
    if (sanitizationPhase({ stage: str(p.Stage), resumeTo: str(p.ResumeTo) || undefined }) !== "open") return null;
    const projectId = str(p.ItemId);
    const [open, any, reqs, jobs] = await Promise.all([
      ctx.gateway.list("Clarification", { ProjectId: projectId, Status: "open" }, { fields: ["ItemId"], first: 1 }),
      ctx.gateway.list("Clarification", { ProjectId: projectId }, { fields: ["ItemId"], first: 1 }),
      ctx.gateway.list("Requirement", { ProjectId: projectId }, { fields: ["ItemId"], first: 1 }),
      ctx.gateway.list("EngineJob", { ProjectId: projectId, Kind: { in: ["requirements.draft", "sanitization.assist"] } },
        { fields: ["ItemId", "Kind", "Status", "InputJson"], sort: [{ field: "CreatedDate", dir: "desc" }], first: 50 }),
    ]);
    if (shouldDraft({ openQuestions: open.length, anyQuestions: any.length, requirements: reqs.length, jobs })) {
      const refs = await loadRefs(ctx);
      const made = await ctx.jobs.create({ kind: "requirements.draft", projectId, inputJson: buildDraftInput(projectId, refs) });
      ctx.audit({ action: "sanitization.draftAuto", targetType: "engine-job", targetId: made.jobId, details: { kind: "requirements.draft", existing: made.existing } });
      return made.jobId;
    }
    if (open.length > 0 || reqs.length === 0) return null;
    const refs = await loadRefs(ctx);
    if (!shouldRefresh({ openQuestions: open.length, anyQuestions: any.length, requirements: reqs.length, jobs, handledIds: refs.clarificationIds })) return null;
    const made = await ctx.jobs.create({ kind: "requirements.draft", projectId, inputJson: { ...buildDraftInput(projectId, refs), purpose: "refresh" } });
    ctx.audit({ action: "sanitization.draftAuto", targetType: "engine-job", targetId: made.jobId, details: { kind: "requirements.draft", existing: made.existing, refresh: true } });
    return made.jobId;
  } catch {
    return null;
  }
}

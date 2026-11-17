/**
 * project.addon.landingPage.save: the "Landing page" add-on of Understanding your project — no landing page, a new
 * dedicated one, or a change to the existing one, with the client's answers. Each save replaces the add-on and raises
 * its revision. Open while the project is in Understanding or Goals & requirements (before the requirements are
 * approved). Rules: src/domain/landingPage.ts.
 * The answers become the "Add-on: Landing page" section of Goals & requirements: the requirements draft writes it; once
 * the draft has started, a save queues requirements.draft with purpose "landingPage" to write it again, and the new
 * section waits for confirmation. "No landing page" removes the section.
 * project.addon.landingPage.confirm: the person confirms the section they reviewed (that revision); the requirements
 * can be approved only then (requirements.confirm checks it).
 */
import {
  LANDING_JOB_PURPOSE, LANDING_LIMITS, checkLanding, landingAccess, landingChangeText, type LandingAddOn, parseLandingAddOn, parseLandingSection, serialiseLandingAddOn,
  serialiseLandingSection, type LandingAnswers, type LandingChoice,
} from "../../../../src/domain/landingPage";
import { fail, ok, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

export interface LandingSaveArgs { projectId: string; choice: LandingChoice; answers: LandingAnswers | null }

const KEYS = ["projectId", "choice", "answers"] as const;
const MAX_ARGS_CHARS = 20_000;

export function parseLandingSave(args: unknown): { ok: true; value: LandingSaveArgs } | { ok: false; messageKey: string; params?: Record<string, unknown> } {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, messageKey: "input.wrongType", params: { key: "args" } };
  const r = args as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!(KEYS as readonly string[]).includes(k)) return { ok: false, messageKey: "input.unknownKey", params: { key: k } };
  if (typeof r.projectId !== "string" || !r.projectId) return { ok: false, messageKey: "input.wrongType", params: { key: "projectId" } };
  let size = 0;
  try { size = JSON.stringify(r).length; } catch { return { ok: false, messageKey: "input.wrongType", params: { key: "args" } }; }
  if (size > MAX_ARGS_CHARS) return { ok: false, messageKey: "input.tooLong", params: { key: "args", max: MAX_ARGS_CHARS } };
  const c = checkLanding({ choice: r.choice, answers: r.answers });
  if (!c.ok) {
    const p = c.problems[0]!;
    return { ok: false, messageKey: p.key === "choice" ? "project.landingChoiceInvalid" : "project.landingAnswerInvalid", params: { key: p.key, max: LANDING_LIMITS.url } };
  }
  return { ok: true, value: { projectId: r.projectId, ...c.value } };
}

export const projectLandingSave: OpDef<LandingSaveArgs, any> = {
  op: "project.addon.landingPage.save",
  permission: "sanitization.edit",
  scope: "project",
  parse: parseLandingSave,
  async run(env, args) {
    const p = env.project!;
    const access = landingAccess({
      stage: rowStage(env), step: p.step, canEditUnderstanding: true,
      canRequestChange: env.isSuperAdmin || env.permissions.includes("build.run" as never),
    });
    if (!access.editable) {
      // read only for everyone (paused or closed), or a late change without the right to open a change request
      const closed = !landingAccess({ stage: rowStage(env), step: p.step, canEditUnderstanding: true, canRequestChange: true }).editable;
      return closed ? fail("conflict", "project.landingClosed") : fail("forbidden", "project.landingNeedsChange");
    }
    const before = parseLandingAddOn((await landingRow(env, p.id))[F.project.landingPageAddOn]);
    const revision = (before?.revision ?? 0) + 1;
    const next: LandingAddOn = { choice: args.choice, answers: args.answers, revision, savedAt: env.nowIso, savedByUserId: env.userId };
    // After the requirements are approved, the change goes through a draft change request (one per open draft).
    let change: { id: string; number: number } | null = null;
    if (access.way === "change") {
      change = await draftChange(env, p.id, next, before);
      next.changeRequestId = change.id;
      next.changeNumber = change.number;
    }
    const patch: Record<string, string> = { [F.project.landingPageAddOn]: serialiseLandingAddOn(next) };
    if (args.choice === "none") patch[F.project.landingPageSection] = "";
    const [project, drafted] = await Promise.all([
      env.ports.db.update(SCHEMA.project, p.id, env.stampUpdate(patch)),
      args.choice === "none" ? Promise.resolve(false) : access.way === "change" ? Promise.resolve(true) : draftStarted(env, p.id),
    ]);
    let jobId: string | null = null;
    if (drafted && env.ports.jobs.create) {
      const job = await env.ports.jobs.create({
        kind: "requirements.draft", projectId: p.id, targetType: "project", targetId: p.id,
        eventKey: `landing-page:${p.id}:${revision}`, input: { projectId: p.id, purpose: LANDING_JOB_PURPOSE, revision },
      });
      jobId = job.jobId;
    }
    await env.audit("project.addon.landingPage.save", SCHEMA.project, p.id, { choice: args.choice, queued: Boolean(jobId), changeNumber: change?.number ?? null });
    return ok({ project, jobId, changeRequestId: change?.id ?? null, changeNumber: change?.number ?? null });
  },
};

const rowStage = (env: Env): string => String(env.projectRow?.[F.project.stage] ?? env.project?.stage ?? "");

/** Writes the answers into the draft change request this add-on opened before (while it is still a draft), else opens a
 *  new one (lane "add", numbered after the project's last change request), like cr.saveDraft does. */
async function draftChange(env: Env, projectId: string, next: LandingAddOn, before: LandingAddOn | null): Promise<{ id: string; number: number }> {
  const text = landingChangeText(next);
  if (before?.changeRequestId) {
    const [open] = await env.ports.db.query("ChangeRequest", { ItemId: before.changeRequestId }, { fields: ["ItemId", "ProjectId", "Status", "Number"], limit: 1 });
    if (open && open.ProjectId === projectId && open.Status === "draft") {
      await env.ports.db.update("ChangeRequest", open.ItemId, env.stampUpdate({ Title: text.title, Description: text.description }));
      return { id: open.ItemId, number: Number(open.Number) };
    }
  }
  const top = await env.ports.db.query("ChangeRequest", { ProjectId: projectId }, { fields: ["ItemId", "Number"], sort: { field: "Number", dir: "desc" }, limit: 1 });
  const number = (typeof top[0]?.Number === "number" ? top[0].Number : 0) + 1;
  const row = await env.insertOnce("ChangeRequest", {
    ProjectId: projectId, Number: number, Lane: "add", FeatureRef: "", Title: text.title, Description: text.description, Status: "draft",
    RequestedByUserId: env.userId,
  }, `landing-change:${next.revision}`);
  await env.audit("cr.saveDraft", "ChangeRequest", row.ItemId, { lane: "add", from: "landingPage" });
  return { id: row.ItemId, number: typeof row.Number === "number" ? row.Number : number };
}

type Env = Parameters<OpDef<unknown, unknown>["run"]>[0];

/** The add-on fields as stored (the router's own Project read carries only the common fields). */
async function landingRow(env: Env, projectId: string): Promise<Record<string, unknown>> {
  const rows = await env.ports.db.query(SCHEMA.project, { ItemId: projectId }, { fields: ["ItemId", F.project.landingPageAddOn, F.project.landingPageSection], limit: 1 });
  return rows[0] ?? {};
}

const ACTIVE_OR_DONE = new Set(["queued", "claimed", "running", "succeeded"]);

/** True once the requirements draft has started (requirements exist, or a draft job is running or done): the section
 *  is then written on its own; before that, the draft writes it. */
async function draftStarted(env: Env, projectId: string): Promise<boolean> {
  const [reqs, jobs] = await Promise.all([
    env.ports.db.query("Requirement", { ProjectId: projectId }, { fields: ["ItemId"], limit: 1 }),
    env.ports.db.query("EngineJob", { ProjectId: projectId, Kind: "requirements.draft" }, { fields: ["ItemId", "Status", "InputJson"], limit: 200 }),
  ]);
  if (reqs.length > 0) return true;
  return jobs.some((j) => ACTIVE_OR_DONE.has(String(j.Status)) && !String(j.InputJson ?? "").includes(`"purpose":"${LANDING_JOB_PURPOSE}"`));
}

export interface LandingConfirmArgs { projectId: string; revision: number }

export const projectLandingConfirm: OpDef<LandingConfirmArgs, any> = {
  op: "project.addon.landingPage.confirm",
  permission: "requirements.edit",
  scope: "project",
  parse(args) {
    if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, messageKey: "input.wrongType", params: { key: "args" } };
    const r = args as Record<string, unknown>;
    for (const k of Object.keys(r)) if (k !== "projectId" && k !== "revision") return { ok: false, messageKey: "input.unknownKey", params: { key: k } };
    if (typeof r.projectId !== "string" || !r.projectId) return { ok: false, messageKey: "input.wrongType", params: { key: "projectId" } };
    if (typeof r.revision !== "number" || !Number.isSafeInteger(r.revision) || r.revision < 1) return { ok: false, messageKey: "input.wrongType", params: { key: "revision" } };
    return { ok: true, value: { projectId: r.projectId, revision: r.revision } };
  },
  async run(env, args) {
    const p = env.project!;
    if (p.step !== "requirements") return fail("conflict", "project.landingClosed");
    const stored = await landingRow(env, p.id);
    const addOn = parseLandingAddOn(stored[F.project.landingPageAddOn]);
    const section = parseLandingSection(stored[F.project.landingPageSection]);
    // only the section written for the latest answers, and only the one the person looked at
    if (!addOn || addOn.choice === "none" || !section || section.revision !== addOn.revision || args.revision !== addOn.revision) {
      return fail("conflict", "project.landingChanged");
    }
    if (section.confirmedAt) return ok({ project: { ItemId: p.id, ...stored }, alreadyConfirmed: true });
    const next = serialiseLandingSection({ ...section, confirmedAt: env.nowIso, confirmedByUserId: env.userId });
    const project = await env.ports.db.update(SCHEMA.project, p.id, env.stampUpdate({ [F.project.landingPageSection]: next }));
    await env.audit("project.addon.landingPage.confirm", SCHEMA.project, p.id, { revision: args.revision });
    return ok({ project, alreadyConfirmed: false });
  },
};

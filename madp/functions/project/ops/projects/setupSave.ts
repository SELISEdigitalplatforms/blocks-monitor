/**
 * project.setup.save: the Project setup windows' answers ("What must it do?", "Who approves the result?") onto the
 * project, plus a refresh of their sections in the project's "Project brief" note when that note exists.
 * Each sent key replaces that detail; keys not sent stay as they are. Rules and field names: src/domain/setupDetails.ts.
 */
import {
  BRIEF_NOTE_TITLE, SETUP_FIELD, briefSectionBodies, checkSetupDetails, detailsToFields, refreshBriefSections, type SetupDetails,
} from "../../../../src/domain/setupDetails";
import { NOTE_BODY_MAX } from "../../../../src/domain/docs";
import { fail, ok, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

export interface SetupSaveArgs {
  projectId: string;
  details: Partial<SetupDetails>;
  /** undefined = not sent; "" is refused (an approval owner can be changed, not removed). */
  approvalOwnerUserId?: string;
}

const KEYS = ["projectId", "mustHaves", "workflows", "exclusions", "constraints", "intendedChanges", "changeTags", "approvalOwnerUserId"] as const;
/** A body bigger than this is refused before any check (the lists' own limits are far below it). */
const MAX_ARGS_CHARS = 60_000;

export function parseSetupSave(args: unknown): { ok: true; value: SetupSaveArgs } | { ok: false; messageKey: string; params?: Record<string, unknown> } {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, messageKey: "input.wrongType", params: { key: "args" } };
  const r = args as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!(KEYS as readonly string[]).includes(k)) return { ok: false, messageKey: "input.unknownKey", params: { key: k } };
  if (typeof r.projectId !== "string" || !r.projectId) return { ok: false, messageKey: "input.wrongType", params: { key: "projectId" } };
  let size = 0;
  try { size = JSON.stringify(r).length; } catch { return { ok: false, messageKey: "input.wrongType", params: { key: "args" } }; }
  if (size > MAX_ARGS_CHARS) return { ok: false, messageKey: "input.tooLong", params: { key: "args", max: MAX_ARGS_CHARS } };
  const d = checkSetupDetails(r);
  if (!d.ok) return d;
  let approvalOwnerUserId: string | undefined;
  if (r.approvalOwnerUserId !== undefined) {
    if (typeof r.approvalOwnerUserId !== "string" || !r.approvalOwnerUserId.trim() || r.approvalOwnerUserId.length > 128) {
      return { ok: false, messageKey: "project.approvalOwnerInvalid" };
    }
    approvalOwnerUserId = r.approvalOwnerUserId.trim();
  }
  if (Object.keys(d.value).length === 0 && approvalOwnerUserId === undefined) return { ok: false, messageKey: "project.setupNothingToSave" };
  return { ok: true, value: { projectId: r.projectId, details: d.value, ...(approvalOwnerUserId !== undefined ? { approvalOwnerUserId } : {}) } };
}

export const projectSetupSave: OpDef<SetupSaveArgs, any> = {
  op: "project.setup.save",
  permission: "business.edit",
  scope: "project",
  parse: parseSetupSave,
  async run(env, args) {
    const projectId = env.project!.id;
    const patch: Record<string, string> = detailsToFields(args.details);
    let approval: { name: string } | undefined;
    if (args.approvalOwnerUserId !== undefined) {
      const m = await env.ports.members.membership(env.workspaceId, args.approvalOwnerUserId);
      if (m?.status !== "active") return fail("invalid_input", "project.approvalOwnerNotMember");
      patch[SETUP_FIELD.approvalOwnerUserId] = args.approvalOwnerUserId;
      const acc = await env.ports.db.query("Account", { UserId: args.approvalOwnerUserId }, { fields: ["UserId", "DisplayName", "Email"], limit: 1 });
      const name = typeof acc[0]?.DisplayName === "string" && acc[0].DisplayName ? acc[0].DisplayName : typeof acc[0]?.Email === "string" ? acc[0].Email : "";
      approval = name ? { name } : undefined;
    }
    // The project is written while its brief note is read: the brief the guided start wrote (IsProjectBrief), else a
    // note a person titled "Project brief". The note keeps its other sections as they are.
    const fields = ["ItemId", F.note.projectId, F.note.folderId, F.note.title, F.note.bodyMd, F.note.sortOrder, F.note.isScratch, F.note.isProjectBrief, "CreatedDate", "LastUpdatedDate", "UpdatedByUserId"];
    const [project, flagged, titled] = await Promise.all([
      env.ports.db.update(SCHEMA.project, projectId, env.stampUpdate(patch)),
      env.ports.db.query(SCHEMA.note, { [F.note.projectId]: projectId, [F.note.isProjectBrief]: true }, { fields, limit: 1 }),
      env.ports.db.query(SCHEMA.note, { [F.note.projectId]: projectId, [F.note.title]: BRIEF_NOTE_TITLE }, { fields, limit: 5 }),
    ]);
    let note: Record<string, unknown> | undefined;
    const brief = flagged[0] ?? titled.find((n) => n[F.note.isScratch] !== true);
    if (brief) {
      const before = typeof brief[F.note.bodyMd] === "string" ? (brief[F.note.bodyMd] as string) : "";
      const after = refreshBriefSections(before, briefSectionBodies(args.details, approval));
      if (after !== before && after.length <= NOTE_BODY_MAX) {
        note = { ...brief, ...(await env.ports.db.update(SCHEMA.note, brief.ItemId, env.stampUpdate({ [F.note.bodyMd]: after }))) };
      }
    }
    await env.audit("project.setup.save", SCHEMA.project, projectId, { fields: Object.keys(patch), brief: Boolean(note) });
    return ok(note ? { project, note } : { project });
  },
};

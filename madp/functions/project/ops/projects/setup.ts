import { checkProjectName } from "../../../../src/domain/projects";
import { BRIEF_TITLE, briefMarkdown, parseTestEnv } from "../../../../src/domain/projectBrief";
import { carrySetupSections } from "../../../../src/domain/setupDetails";
import { normaliseWebUrl } from "../../../../src/domain/guidedStart";
import { DESCRIPTION_MAX, SETUP_TEXT, checkSetupAnswers, checkTestEnv, checkWebsiteUrl, APP_URL_MAX, WEBSITE_URL_MAX, TEST_ENV_MAX, SETUP_ANSWERS_MAX, type SetupTextKey } from "./create";
import { fail, ok, strictArgs, type OpDef } from "./op";
import { F, SCHEMA, rowStr } from "./records";

export interface SetupArgs {
  projectId: string;
  /** The new name, when it changes. */
  name: string | null;
  description: string;
  /** Project fields to write ("" clears one). */
  patch: Record<string, string>;
}

/**
 * The guided start's answers, changed on the Project setup page: the project's fields and the "Project brief" note
 * written from them (created again when it was deleted). Only while the project is being set up (the Business step):
 * after the hand-over the product manager works from what was handed over.
 */
export const projectSetup: OpDef<SetupArgs, any> = {
  op: "project.setup",
  permission: "project.edit",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, {
      projectId: { type: "string" },
      name: { type: "string", optional: true },
      description: { type: "string", max: 4 * DESCRIPTION_MAX },
      goal: { type: "string", max: 4 * SETUP_TEXT.goal },
      targetUsers: { type: "string", max: 4 * SETUP_TEXT.targetUsers },
      runInstructions: { type: "string", optional: true, max: 4 * SETUP_TEXT.runInstructions },
      blocksProjectRef: { type: "string", optional: true, max: 4 * SETUP_TEXT.blocksProjectRef },
      appUrl: { type: "string", optional: true, max: 4 * APP_URL_MAX },
      websiteUrl: { type: "string", optional: true, max: 4 * WEBSITE_URL_MAX },
      testEnv: { type: "string", optional: true, max: TEST_ENV_MAX },
      setupAnswers: { type: "string", max: SETUP_ANSWERS_MAX },
    });
    if (!a.ok) return a;
    const r = a.value as Record<string, string | undefined>;
    let name: string | null = null;
    if (r.name !== undefined) {
      const n = checkProjectName(r.name);
      if (!n.ok) return n;
      name = n.value;
    }
    const description = (r.description ?? "").trim();
    if (description.length > DESCRIPTION_MAX) return { ok: false, messageKey: "project.textTooLong", params: { field: "description", max: DESCRIPTION_MAX } };
    const patch: Record<string, string> = {};
    for (const [k, max] of Object.entries(SETUP_TEXT) as [SetupTextKey, number][]) {
      if (r[k] === undefined) continue;
      const v = r[k]!.trim();
      if (v.length > max) return { ok: false, messageKey: "project.textTooLong", params: { field: k, max } };
      patch[F.project[k]] = v;
    }
    if (r.appUrl !== undefined) {
      const url = normaliseWebUrl(r.appUrl);
      if (url === null) return { ok: false, messageKey: "project.appUrlInvalid" };
      patch[F.project.appUrl] = url;
    }
    if (r.websiteUrl !== undefined) {
      const w = checkWebsiteUrl(r.websiteUrl);
      if (!w.ok) return w;
      patch[F.project.websiteUrl] = w.value;
    }
    if (r.testEnv !== undefined) {
      if (r.testEnv.trim() === "") patch[F.project.testEnv] = "";
      else {
        const t = checkTestEnv(r.testEnv);
        if (!t.ok) return t;
        patch[F.project.testEnv] = t.value;
      }
    }
    const s = checkSetupAnswers(r.setupAnswers ?? "");
    if (!s.ok) return s;
    patch[F.project.setupAnswers] = s.value;
    return { ok: true, value: { projectId: r.projectId as string, name, description, patch } };
  },
  async run(env, args) {
    const p = env.project!;
    if (p.step !== "business") return fail("conflict", "project.setupLocked");
    const patch: Record<string, string> = { ...args.patch, ...(args.name ? { [F.project.name]: args.name } : {}) };
    // only an existing product has a website: a new idea's is ignored (and a stale one cleared)
    if (p.repoMode !== "existing" && F.project.websiteUrl in patch) patch[F.project.websiteUrl] = "";
    // A wizard's historical empty/default reference must never detach an
    // automatically provisioned tenant or bypass the main-account provisioner.
    if (env.ports.automaticBlocksProvisioning) delete patch[F.project.blocksProjectRef];
    const project = await env.ports.db.update(SCHEMA.project, args.projectId, env.stampUpdate(patch));
    const body = briefMarkdown({
      name: rowStr(project, F.project.name), existing: rowStr(project, F.project.repoMode) === "existing", description: args.description,
      goal: rowStr(project, F.project.goal), targetUsers: rowStr(project, F.project.targetUsers), appUrl: rowStr(project, F.project.appUrl),
      testEnv: parseTestEnv(rowStr(project, F.project.testEnv)), runInstructions: rowStr(project, F.project.runInstructions),
      blocksProjectRef: rowStr(project, F.project.blocksProjectRef),
    });
    const [existing] = await env.ports.db.query(SCHEMA.note, { [F.note.projectId]: args.projectId, [F.note.isProjectBrief]: true }, {
      limit: 1, fields: ["ItemId", F.note.projectId, F.note.folderId, F.note.title, F.note.bodyMd, F.note.sortOrder, F.note.isScratch, F.note.isProjectBrief, "CreatedDate", "LastUpdatedDate"],
    });
    let briefNote = null;
    if (existing) {
      // the answers' sections are rewritten; sections others keep in the note (must-haves, approval…) stay
      const merged = carrySetupSections(rowStr(existing, F.note.bodyMd), body);
      if (rowStr(existing, F.note.bodyMd) !== merged) {
        briefNote = await env.ports.db.update(SCHEMA.note, existing.ItemId as string, env.stampUpdate({ [F.note.bodyMd]: merged, [F.note.title]: BRIEF_TITLE }));
      } else briefNote = existing;
    } else if (body) {
      briefNote = await env.insertOnce(SCHEMA.note, {
        [F.note.projectId]: args.projectId, [F.note.folderId]: "", [F.note.title]: BRIEF_TITLE, [F.note.bodyMd]: body,
        [F.note.sortOrder]: 0, [F.note.isScratch]: false, [F.note.isProjectBrief]: true,
      }, "brief");
    }
    await env.audit("project.setup", SCHEMA.project, args.projectId, { fields: Object.keys(patch), briefNote: Boolean(briefNote) });
    return ok({ project, ...(briefNote ? { briefNote } : {}) });
  },
};

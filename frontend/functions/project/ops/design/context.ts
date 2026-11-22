import { defineOp, f, v, type OpDeps } from "../../../_lib";
import { designIntent, designSources, type DesignIntent, type DesignSources } from "../../../../src/domain/factoryDesign";

export const DESIGN_PROJECT_FIELDS = ["ItemId", "Name", "Goal", "TargetUsers", "Brief", "SetupWorkflows", "SetupExclusions", "SetupConstraints", "SetupMustHaves"];
/** The records besides the project that carry what it is about (src/domain/factoryDesign.ts DesignFacts): the Project
 *  brief note (the description) and the answered questions (the business analyst's brief questions among them). */
export const DESIGN_NOTE_FIELDS = ["ItemId", "BodyMd", "IsProjectBrief"];
export const DESIGN_CLARIFICATION_FIELDS = ["ItemId", "Number", "Question", "Answer", "Status"];
/** One canonical snapshot for queued work, stale checks, review and the client: the intent, its source and the source a
 *  design made before 08.11 carries (designSources; a saved design is current when designSourceCurrent says so). */
export async function loadDesignSources(db: { find(schema: string, where: Record<string, any>, options?: any): Promise<any[]> }, projectId: string): Promise<{ intent: DesignIntent } & DesignSources> {
  const [projects, objectives, requirements, extras, notes, clarifications] = await Promise.all([
    db.find("Project", { ItemId: projectId }, { limit: 1 }), db.find("Objective", { ProjectId: projectId }, { limit: 1 }),
    db.find("Requirement", { ProjectId: projectId }, { limit: 1000 }), db.find("RequirementExtra", { ProjectId: projectId }, { limit: 500 }),
    db.find("DocNote", { ProjectId: projectId, IsProjectBrief: true }, { limit: 20 }),
    db.find("Clarification", { ProjectId: projectId, Status: "answered" }, { limit: 500 }),
  ]);
  if (projects.length !== 1) throw new Error("design_project_not_found");
  const intent = designIntent(projects[0], objectives[0], requirements, extras, { notes, clarifications });
  return { intent, ...designSources(intent, projects[0]) };
}
export async function loadDesignIntent(db: Parameters<typeof loadDesignSources>[0], projectId: string): Promise<DesignIntent> {
  return (await loadDesignSources(db, projectId)).intent;
}
export async function loadDesignSourcesFromDeps(deps: OpDeps, projectId: string): Promise<{ intent: DesignIntent } & DesignSources> {
  const [project, objectives, requirements, extras, notes, clarifications] = await Promise.all([
    deps.gw.get("Project", projectId, DESIGN_PROJECT_FIELDS),
    deps.gw.findAll("Objective", { where: f.eq("ProjectId", projectId), fields: ["Statement", "AcceptanceCriteria"], max: 1 }),
    deps.gw.findAll("Requirement", { where: f.eq("ProjectId", projectId), fields: ["Key", "Title", "Text", "AcceptanceCriteria", "Status"], max: 1000 }),
    deps.gw.findAll("RequirementExtra", { where: f.eq("ProjectId", projectId), fields: ["Kind", "Title", "Who", "Steps", "ConstraintKind", "Status"], max: 500 }),
    deps.gw.findAll("DocNote", { where: f.and(f.eq("ProjectId", projectId), f.eq("IsProjectBrief", true)), fields: DESIGN_NOTE_FIELDS, max: 20 }),
    deps.gw.findAll("Clarification", { where: f.and(f.eq("ProjectId", projectId), f.eq("Status", "answered")), fields: DESIGN_CLARIFICATION_FIELDS, max: 500 }),
  ]);
  if (!project) return deps.fail("not_found");
  const intent = designIntent(project, objectives[0], requirements, extras, { notes, clarifications });
  return { intent, ...designSources(intent, project) };
}
export const designContext = defineOp({ op: "designBrief.context", kind: "view", scope: "project", permission: "view",
  args: v.object({ projectId: v.id() }),
  async handler(_ctx, args, deps) { const { intent, source, legacySource } = await loadDesignSourcesFromDeps(deps, args.projectId); return { intent, source, legacySource }; },
});

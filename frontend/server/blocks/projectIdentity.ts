import { JobFailure } from "../local/engine/run.ts";

/** Gateway ItemId remains a database key. Only this mapped OS identity may be
 * used as a project selector, SDK projectKey or generated app tenant. */
export function blocksProjectId(project: Record<string, unknown>): string {
  const provisioning = project.BlocksProvisioningStatus;
  if (provisioning !== "ready") {
    // pending / creating: the engine host is making it (a few minutes); anything else needs the engine team
    throw new JobFailure(provisioning === "pending" || provisioning === "creating"
      ? "The product's Blocks project is still being set up; a new project takes a few minutes. Start this again in a few minutes."
      : "The product's Blocks project could not be set up, so nothing was built or released. Ask the engine team to set it up, then start it again.", "blocks.project_not_ready");
  }
  const id = project.BlocksProjectRef;
  if (typeof id !== "string" || !/^D[0-9a-f]{32}$/i.test(id)) throw new JobFailure("The product's Blocks project is not recorded on this project, so nothing was built or released. Ask the engine team to record it, then start it again.", "blocks.project_missing");
  return id;
}

export function productIdentity(project: Record<string, unknown>, factoryRecordId: string) {
  const projectId = blocksProjectId(project);
  const environments: Record<string, string> = { dev: projectId };
  for (const [env, field, prefix] of [["stg", "BlocksStageProjectRef", "S"], ["prod", "BlocksProductionProjectRef", "P"]]) {
    const id = project[field];
    if (typeof id === "string" && new RegExp(`^${prefix}[0-9a-f]{32}$`, "i").test(id)) environments[env] = id;
  }
  return { projectId, factoryRecordId, environments };
}

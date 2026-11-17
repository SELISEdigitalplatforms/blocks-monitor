import type { RawGateway, Row } from "../../functions/_lib/gateway.ts";
import { f } from "../../functions/_lib/filter.ts";
import { PROJECT_FIELDS } from "../../src/blocks/projects/records.ts";
import type { ShellScope } from "./onboarding.ts";
import { ShellRefused } from "./assertion.ts";

/** Metadata choice only: Blocks continues to own the existing tenant and repository connections. */
export async function setProjectKind(raw: RawGateway, scope: Pick<ShellScope, "projectId" | "workspaceId" | "permissions" | "identity">, input: Record<string, unknown>): Promise<Row> {
  if (!scope.permissions.includes("project.edit")) throw new ShellRefused(403, "forbidden");
  if (Object.keys(input).some((k) => k !== "projectId" && k !== "kind") || (input.kind !== "greenfield" && input.kind !== "brownfield")) throw new ShellRefused(400, "invalid_product_kind");
  if (input.projectId !== scope.projectId) throw new ShellRefused(403, "scope_mismatch");
  const project = await raw.get("Project", scope.projectId, [...PROJECT_FIELDS]);
  if (!project || project.WorkspaceId !== scope.workspaceId || project.Status === "deleting") throw new ShellRefused(404, "not_found");
  if (project.Stage !== "business" || (typeof project.BusinessHandedOverAt === "string" && project.BusinessHandedOverAt !== "")) throw new ShellRefused(409, "product_kind_locked");
  const active = await raw.find("EngineJob", {
    where: f.and(f.eq("WorkspaceId", scope.workspaceId), f.eq("ProjectId", scope.projectId), f.in("Status", ["queued", "claimed", "running"])),
    fields: ["ItemId", "Status"], pageSize: 1,
  });
  if (active.items.length > 0) throw new ShellRefused(409, "project_work_active");
  const mode = input.kind === "brownfield" ? "existing" : "new";
  if (project.RepoMode === mode) return project;
  const patch = { RepoMode: mode, UpdatedByUserId: scope.identity.userId };
  if (typeof project.RepoMode === "string") {
    const result = await raw.updateMany("Project", f.and(f.eq("ItemId", scope.projectId), f.eq("WorkspaceId", scope.workspaceId), f.eq("Stage", "business"), f.eq("RepoMode", project.RepoMode)), patch);
    if (result.matched === 0) throw new ShellRefused(409, "product_kind_locked");
    if (result.matched === null) {
      const saved = await raw.get("Project", scope.projectId, ["ItemId", "WorkspaceId", "RepoMode", "UpdatedByUserId"]);
      if (!saved || saved.RepoMode !== mode || saved.UpdatedByUserId !== scope.identity.userId) throw new ShellRefused(409, "product_kind_locked");
    }
  } else {
    // Historical records without RepoMode use the original gateway update path.
    await raw.update("Project", scope.projectId, patch);
  }
  return { ...project, ...patch };
}

/** Serialize the type choice with project commands (including handing the project over for analysis). */
export function createProjectActionLane() {
  const actions = new Map<string, Promise<unknown>>();
  return <T>(projectId: string, action: () => Promise<T>): Promise<T> => {
    const previous = actions.get(projectId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    actions.set(projectId, result);
    const clear = () => { if (actions.get(projectId) === result) actions.delete(projectId); };
    void result.then(clear, clear);
    return result;
  };
}

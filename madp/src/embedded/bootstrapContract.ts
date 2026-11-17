import type { BlocksProfile } from "@/blocks/session";
import type { Member, MyWorkspace } from "@/blocks/workspaces/store";
import type { RoleDef } from "@/domain/roles";
import type { ProjectRecord } from "@/blocks/projects/records";

export interface ShellBootstrap {
  tenantId: string; profile: BlocksProfile; workspace: MyWorkspace; member: Member;
  customRole: RoleDef; project: ProjectRecord;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const list = (v: unknown): v is string[] => Array.isArray(v) && v.every((p) => typeof p === "string");

/** Browser presentation context never supplies identity, permissions or database record IDs. */
export function parseShellBootstrap(answer: unknown, expectedTenant: string): ShellBootstrap | null {
  if (!object(answer) || answer.ok !== true || !object(answer.data)) return null;
  const d = answer.data;
  if (!text(d.tenantId) || d.tenantId.toLowerCase() !== expectedTenant.toLowerCase() || !object(d.profile) || !object(d.workspace) || !object(d.member) || !object(d.customRole) || !object(d.project)) return null;
  if (!text(d.profile.userId) || d.profile.isSuperAdmin !== false || !list(d.profile.permissions) || !list(d.profile.roles)
    || !text(d.workspace.id) || d.workspace.id !== d.project.workspaceId || d.member.userId !== d.profile.userId
    || !list(d.customRole.permissions) || !list(d.member.permissions) || !text(d.project.id) || !text(d.project.blocksProjectRef)
    || d.project.blocksProjectRef.toLowerCase() !== expectedTenant.toLowerCase()) return null;
  return d as unknown as ShellBootstrap;
}

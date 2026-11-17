import { can } from "../../../../src/domain/rbac";
import { workspacePermissionsFor } from "../../../../src/domain/roles";
import { fail, ok, strictArgs, type OpDef } from "./op";
import type { MembersPort } from "./ports";
import { F, SCHEMA } from "./records";

/** The active members of the workspace with their resolved permissions (custom roles included). */
export async function activeMemberPermissions(env: { workspaceId: string; ports: { members: Pick<MembersPort, "activeMembers" | "customRoles"> } }) {
  const [members, customRoles] = await Promise.all([
    env.ports.members.activeMembers(env.workspaceId),
    env.ports.members.customRoles(env.workspaceId),
  ]);
  return new Map(
    members.map((m) => [m.userId, workspacePermissionsFor({ roleKey: m.roleKey, isSuperAdmin: false, customRoles })] as const),
  );
}

export const projectAssign: OpDef<{ projectId: string; assigneeUserId: string }, any> = {
  op: "project.assign",
  permission: "project.assign",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, { projectId: { type: "string" }, assigneeUserId: { type: "string", max: 128 } });
    if (!a.ok) return a;
    return { ok: true, value: { projectId: a.value.projectId as string, assigneeUserId: a.value.assigneeUserId as string } };
  },
  prefetch: (env, { assigneeUserId }) => (assigneeUserId !== "" ? activeMemberPermissions(env) : undefined),
  async run(env, { projectId, assigneeUserId }) {
    if (assigneeUserId !== "") {
      const perms = (await activeMemberPermissions(env)).get(assigneeUserId);
      if (!perms || !can(perms, "view")) return fail("invalid_input", "assign.notMember");
    }
    // The history row and the Project patch do not depend on each other: one round.
    const [assignment, project] = await Promise.all([
      env.insertOnce(
        SCHEMA.assignment,
        {
          [F.assignment.projectId]: projectId,
          [F.assignment.assigneeUserId]: assigneeUserId,
          [F.assignment.assignedByUserId]: env.userId,
          [F.assignment.at]: env.nowIso,
        },
        "assignment",
      ),
      env.ports.db.update(SCHEMA.project, projectId, env.stampUpdate({ [F.project.assigneeUserId]: assigneeUserId })),
    ]);
    await env.audit("project.assign", SCHEMA.project, projectId, { assigneeUserId });
    if (assigneeUserId !== "" && assigneeUserId !== env.userId) {
      await env.ports.notify.send({
        workspaceId: env.workspaceId,
        kind: "assigned",
        recipientUserId: assigneeUserId,
        projectId,
        link: `/p/${projectId}`,
        params: { projectName: env.project?.name ?? "" },
        eventKey: `assigned:${assignment.ItemId}`,
      });
    }
    return ok({ project, assignment });
  },
};

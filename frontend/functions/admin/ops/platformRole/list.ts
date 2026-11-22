// platformRole.list: the platform roles, the organization role templates and who holds which platform role
// (any platform permission). Not audited.
import { PLATFORM_PERMISSIONS } from "../../../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE } from "../../../../src/domain/roles";
import { ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { isTemplate, readScopedRoles } from "./scope";
import {
  ACCOUNT_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  SCHEMA,
  type AccountRow,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
} from "../../../workspace/ops/_shared/records";

export async function platformRoleList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: [...PLATFORM_PERMISSIONS],
    extra: {
      roles: () => readScopedRoles(deps),
      assignments: () =>
        deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { Status: "active" },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const all = open.caller.extra.roles as PlatformRoleRow[];
  const roles = all.filter((r) => !isTemplate(r));
  const templates = all.filter(isTemplate);
  const assignments = open.caller.extra.assignments as PlatformRoleAssignmentRow[];
  const userIds = [...new Set(assignments.map((r) => r.UserId))];
  const accounts = userIds.length
    ? await deps.gateway.listAll<AccountRow>(SCHEMA.account, { filter: { UserId: { in: userIds } }, fields: ACCOUNT_FIELDS, maxItems: 1000 })
    : [];
  const byUser = new Map(accounts.map((r) => [r.UserId, r]));
  return ok({
    roles: [
      { itemId: null, ...PLATFORM_ADMIN_ROLE, isBuiltIn: true },
      ...roles.map((r) => ({
        itemId: r.ItemId,
        key: r.Key,
        name: r.Name ?? "",
        description: r.Description ?? "",
        permissions: r.Permissions ?? [],
        isBuiltIn: false,
      })),
    ],
    // Organization role templates: copied into organizations as custom roles (workspaceRole.applyTemplate).
    templates: templates.map((r) => ({
      itemId: r.ItemId,
      key: r.Key,
      name: r.Name ?? "",
      description: r.Description ?? "",
      permissions: r.Permissions ?? [],
      isBuiltIn: false,
      scope: "organization" as const,
    })),
    assignments: assignments.map((r) => {
      const acc = byUser.get(r.UserId);
      return {
        itemId: r.ItemId,
        userId: r.UserId,
        roleKey: r.RoleKey,
        status: r.Status,
        email: acc?.Email ?? "",
        displayName: acc?.DisplayName ?? "",
      };
    }),
  });
}

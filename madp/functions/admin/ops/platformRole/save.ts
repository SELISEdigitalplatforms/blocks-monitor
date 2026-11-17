// platformRole.save: create or change a custom platform role, or (scope "organization") an organization role template
// (platform.roles.manage). Built-in roles are code-defined and never stored.
import { checkOrgRoleTemplateChange, checkPlatformRoleChange, PLATFORM_ADMIN_ROLE } from "../../../../src/domain/roles";
import { isRoleScope } from "../../../../src/domain/permissions";
import { cleanText, fromRoleCheck } from "../../../../src/domain/tenancy";
import { audit, fail, failCheck, iamFirst, ok, openOp, rbacChanged, readArgs } from "../../../workspace/ops/_shared/core";
import { platformRoleIamSlug, upsertIamRole } from "../../../workspace/ops/_shared/iamSync";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { activeAssignmentsRead, allRolesRead, allSettingsRead, platformReaders, stampPlatformReaders } from "./assign";
import { isTemplate, readScopedRoles } from "./scope";
import { SCHEMA, type PlatformRoleAssignmentRow, type PlatformRoleRow } from "../../../workspace/ops/_shared/records";

export async function platformRoleSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<unknown>> {
  const a = readArgs(args, { key: "string", name: "string", description: "string?", permissions: "string[]", scope: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const scope = a.value.scope ?? "platform";
  if (!isRoleScope(scope)) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["scope"] });
  const key = a.value.key.trim();
  const name = cleanText(a.value.name);
  const description = cleanText(a.value.description ?? "").slice(0, 300);
  const permissions = [...new Set(a.value.permissions)];
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.roles.manage",
    extra: {
      roles: allRolesRead(deps),
      active: activeAssignmentsRead(deps),
      settings: allSettingsRead(deps),
      scoped: () => readScopedRoles(deps, { Key: key }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (key === PLATFORM_ADMIN_ROLE.key) return fail("invalid_input", "tenancy.builtInRole");
  const granter = { isSuperAdmin: caller.isSuperAdmin, permissions: caller.platform.permissions };
  const bad = fromRoleCheck(
    scope === "organization"
      ? checkOrgRoleTemplateChange({ key, name, permissions }, granter)
      : checkPlatformRoleChange({ key, name, permissions }, granter),
  );
  if (!bad.ok) return failCheck(bad);
  // A key names one thing: a platform role and a template never share it, and a save never turns one into the other.
  const same = (caller.extra.scoped as PlatformRoleRow[])[0] ?? null;
  if (same && isTemplate(same) !== (scope === "organization")) return fail("conflict", "tenancy.roleKeyTaken");

  const roles = caller.extra.roles as PlatformRoleRow[];
  const existing = roles.find((r) => r.Key === key) ?? null;
  // The reader list once the role has its new permissions; computed in memory so the write and the restamp share a round.
  const changed = { ...(existing ?? {}), Key: key, Name: name, Description: description, Permissions: permissions } as PlatformRoleRow;
  const readerIds = platformReaders(caller.extra.active as PlatformRoleAssignmentRow[], [...roles.filter((r) => r.Key !== key), changed]);
  // rbac.source "iam": IAM first (the role and exactly these permissions); a failure writes no Factory row.
  const iamFail = await iamFirst(deps, (iam) =>
    upsertIamRole(iam, { slug: platformRoleIamSlug(key, scope === "organization" ? "organization" : "platform"), name, description, permissions }),
  );
  if (iamFail) return iamFail;
  const write = existing
    ? deps.gateway.update(SCHEMA.platformRole, existing.ItemId, {
        Name: name,
        Description: description,
        Permissions: permissions,
        UpdatedByUserId: caller.userId,
      })
    : deps.gateway.insertOnce(
        SCHEMA.platformRole,
        {
          Key: key,
          Name: name,
          Description: description,
          Permissions: permissions,
          IsBuiltIn: false,
          ...(scope === "organization" ? { Scope: "organization" } : {}),
          ReaderIds: readerIds,
          CreatedByUserId: caller.userId,
          UpdatedByUserId: caller.userId,
        },
        `platformRole:${key}`,
      );
  await Promise.all([write, stampPlatformReaders(deps, readerIds, caller.extra)]);
  await rbacChanged(deps);
  const role = { key, name, description, permissions, isBuiltIn: false, scope };
  await audit(deps, ctx, caller, {
    targetType: scope === "organization" ? "org-role-template" : "platform-role",
    targetId: key,
    details: {
      before: existing ? { name: existing.Name, description: existing.Description, permissions: existing.Permissions } : null,
      after: role,
    },
  });
  return ok({ role });
}

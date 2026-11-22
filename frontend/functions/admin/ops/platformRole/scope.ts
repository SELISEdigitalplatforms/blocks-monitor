// Platform roles and organization role templates share the PlatformRole schema; PlatformRole.Scope tells them apart
// (absent or "platform": a platform role; "organization": a template copied into organizations as a WorkspaceRole).
// Scope is an additive field (blocks/data/migrations/platform-rbac.json): the shared reads (openOp, the access resolver,
// the restamp) never ask for it, and these reads fall back to the rows without it on a tenant that lacks the field.
import type { Filter, OpDeps } from "../../../workspace/ops/_shared/ports";
import { PLATFORM_ROLE_FIELDS, SCHEMA, type PlatformRoleRow } from "../../../workspace/ops/_shared/records";

export const PLATFORM_ROLE_SCOPED_FIELDS = [...PLATFORM_ROLE_FIELDS, "Scope"] as const;

export const isTemplate = (row: Pick<PlatformRoleRow, "Scope"> | null | undefined): boolean => row?.Scope === "organization";

/** Every PlatformRole row with its Scope (rows of a tenant without the field read as platform roles). */
export async function readScopedRoles(deps: OpDeps, filter: Filter = {}): Promise<PlatformRoleRow[]> {
  try {
    return await deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter, fields: PLATFORM_ROLE_SCOPED_FIELDS });
  } catch {
    return deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter, fields: PLATFORM_ROLE_FIELDS });
  }
}

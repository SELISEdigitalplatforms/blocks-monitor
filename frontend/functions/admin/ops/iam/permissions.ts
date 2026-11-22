// iam.permissions.list: the Factory's permission catalogue beside what Blocks OS IAM holds (one IAM permission per key,
// resource madp-factory). platform.roles.manage or platform.people.manage. Not audited.
import { PLATFORM_PERMISSIONS } from "../../../../src/domain/rbac";
import { ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { IAM_READ_PERMISSIONS, PERMISSION_CATALOG, directoryOf, iamFail, noIam } from "./shared";
import { isFactoryResource } from "../../../_lib/iamAdmin";

export interface IamPermissionsView {
  catalog: { key: string; scope: "platform" | "organization"; inIam: boolean }[];
  onlyInIam: string[];
}

export async function iamPermissionsList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<IamPermissionsView>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: IAM_READ_PERMISSIONS });
  if (!open.ok) return { ok: false, error: open.error };
  const iam = directoryOf(deps);
  if (!iam) return noIam();
  let listed;
  try { listed = await iam.listPermissions(); } catch (e) { return iamFail(e); }
  const names = new Set(listed.map((p) => p.name));
  return ok({
    catalog: PERMISSION_CATALOG.map((key) => ({
      key,
      scope: (PLATFORM_PERMISSIONS as readonly string[]).includes(key) ? "platform" as const : "organization" as const,
      inIam: names.has(key),
    })),
    onlyInIam: listed.filter((p) => isFactoryResource(p.resource ?? "") && !PERMISSION_CATALOG.includes(p.name)).map((p) => p.name).sort(),
  });
}

// workspace.rename {workspaceId, name, expectedName} (workspace.manage): a Workspace admin of THIS workspace renames it.
// The router checks membership and the permission (the super admin counts as owner; acting outside membership is
// audited as viaPlatform), refuses impersonated callers (workspace.manage) and applies the per-user quota (OP_QUOTAS).
// Optimistic concurrency: `expectedName` is the name the admin saw. A stored name that differs (someone else renamed it
// in between) is a conflict; the name itself is compared, not LastUpdatedDate, because member changes restamp the
// Workspace row's ReaderIds and would make every open form stale. A stored name already equal to the new one is the
// same rename landing twice (a timed-out save, a second tab): answered without a write or an audit entry.
// The audit target type is lower-case ("workspace"): the AuditEvent TargetType pattern refuses capitals.
import { checkWorkspaceRename } from "../../../../src/domain/tenancy";
import { OpError, defineOp, issuedStamp, v, type ScopedGateway } from "../../../_lib";

export interface WorkspaceRenameAnswer {
  workspace: { id: string; name: string; updatedAt: string };
  /** False when the workspace already had this name (nothing was written). */
  changed: boolean;
}

const ARGS = v.object({
  workspaceId: v.id(),
  name: v.string({ max: 1000 }),
  expectedName: v.string({ max: 1000 }),
});

type Args = { workspaceId: string; name: string; expectedName: string };

/** Shape first (the library validator), then the shared name rule: both before any I/O. */
function parseArgs(raw: unknown): Args {
  const a = ARGS.parse(raw, "");
  const name = checkWorkspaceRename(a.name);
  if (!name.ok) throw new OpError("invalid_input", name.messageKey, name.params);
  return { workspaceId: a.workspaceId, name: name.value, expectedName: a.expectedName };
}

const ROW_FIELDS = ["ItemId", "WorkspaceId", "Name", "Status", "LastUpdatedDate"];

/** The one read of the row (prefetch and handler issue the same call, so the request memo answers the second). */
const readRow = (gw: ScopedGateway, workspaceId: string) => gw.get("Workspace", workspaceId, ROW_FIELDS);

const str = (x: unknown): string => (typeof x === "string" ? x : "");

export const WORKSPACE_RENAME_OPS = [
  defineOp({
    op: "workspace.rename",
    kind: "command",
    scope: "workspace",
    permission: "workspace.manage",
    args: parseArgs,
    prefetch: (p) => (p.gw && p.workspaceId ? readRow(p.gw, p.workspaceId) : undefined),
    async handler(ctx, args, deps): Promise<WorkspaceRenameAnswer> {
      const workspaceId = str(ctx.workspace?.ItemId);
      if (!workspaceId) return deps.fail("not_found");
      const row = await readRow(deps.gw, workspaceId);
      if (!row) return deps.fail("not_found");
      const before = str(row.Name);
      if (before === args.name) {
        return { workspace: { id: workspaceId, name: before, updatedAt: str(row.LastUpdatedDate) }, changed: false };
      }
      if (before.trim() !== args.expectedName.trim()) return deps.fail("conflict", "tenancy.workspaceRenamed");

      deps.audit({ action: "workspace.rename", targetType: "workspace", targetId: workspaceId, details: { before, after: args.name } });
      // The state change is the last write (same round trip as the audit and Operation rows); a retry still sees the old name.
      deps.after(() => deps.gw.update("Workspace", workspaceId, { Name: args.name }));
      return { workspace: { id: workspaceId, name: args.name, updatedAt: issuedStamp(ctx.now) }, changed: true };
    },
  }),
];

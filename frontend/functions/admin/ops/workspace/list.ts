// workspace.list: the platform view of every workspace (name, admins, member count, status), newest first. Audited.
import { audit, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { MEMBERSHIP_FIELDS, SCHEMA, WORKSPACE_FIELDS, type MembershipRow, type WorkspaceRow } from "../../../workspace/ops/_shared/records";

const PAGE_SIZE = 50;

export interface WorkspaceListItem {
  workspaceId: string;
  name: string;
  status: WorkspaceRow["Status"];
  memberCount: number;
  admins: { userId: string; email: string; displayName: string }[];
  /** The organization's active plan (billing Subscription.PlanKey); null where none is recorded or billing is not set up. */
  planKey: string | null;
}

/** Active plan per organization, read defensively: a tenant without the billing schema answers no plans. */
async function activePlans(deps: OpDeps, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await deps.gateway.listAll<{ WorkspaceId: string; PlanKey: string; Status: string }>("Subscription", {
      filter: { WorkspaceId: { in: [...ids] }, Status: "active" },
      fields: ["WorkspaceId", "PlanKey", "Status"],
      maxItems: 5000,
    });
    return new Map(rows.filter((r) => r.PlanKey).map((r) => [r.WorkspaceId, r.PlanKey]));
  } catch {
    return new Map();
  }
}

export async function workspaceList(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ items: WorkspaceListItem[]; totalCount: number; page: number; pageSize: number }>> {
  const a = readArgs(args, { page: "number?" });
  if (!a.ok) return { ok: false, error: a.error };
  const page = Math.max(1, Math.floor(a.value.page ?? 1));

  // The workspace page and then its members are read inside the permission round (they are chained, so this is two
  // rounds of depth in parallel with the caller checks), which leaves only the audit write after them.
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: ["platform.workspaces.view", "platform.workspaceRoles.view"],
    extra: {
      view: async () => {
        const res = await deps.gateway.list<WorkspaceRow>(SCHEMA.workspace, {
          filter: {},
          fields: WORKSPACE_FIELDS,
          // newest first: the newest organization on top (the gateway sorts on the date field, never on ItemId)
          sort: { field: "CreatedDate", dir: "desc" },
          page,
          pageSize: PAGE_SIZE,
        });
        const ids = res.items.map((w) => w.ItemId);
        const [members, plans] = await Promise.all([
          ids.length
            ? deps.gateway.listAll<MembershipRow>(SCHEMA.membership, {
                filter: { WorkspaceId: { in: ids }, Status: "active" },
                fields: MEMBERSHIP_FIELDS,
                maxItems: 5000,
              })
            : Promise.resolve([] as MembershipRow[]),
          activePlans(deps, ids),
        ]);
        return { res, members, plans };
      },
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const { res, members, plans } = caller.extra.view as {
    res: { items: WorkspaceRow[]; totalCount: number };
    members: MembershipRow[];
    plans: Map<string, string>;
  };
  const items = res.items.map((w) => {
    const mine = members.filter((m) => m.WorkspaceId === w.ItemId);
    return {
      workspaceId: w.ItemId,
      name: w.Name,
      status: w.Status,
      memberCount: mine.length,
      admins: mine
        .filter((m) => m.RoleKey === "owner")
        .map((m) => ({ userId: m.UserId, email: m.Email, displayName: m.DisplayName })),
      planKey: plans.get(w.ItemId) ?? null,
    };
  });
  await audit(deps, ctx, caller, { action: "workspace.list", targetType: "workspace", targetId: "all", details: { page } });
  return ok({ items, totalCount: res.totalCount, page, pageSize: PAGE_SIZE });
}

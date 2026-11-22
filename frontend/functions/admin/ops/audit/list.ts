// audit.list: the audit trail, newest first (platform.audit.view). Not itself audited.
import { fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { Filter, FilterValue, OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { ACCOUNT_FIELDS, AUDIT_EVENT_FIELDS, SCHEMA, type AccountRow, type AuditEventRow } from "../../../workspace/ops/_shared/records";

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const MAX_ACTOR_IDS = 500;
const MAX_ACCOUNTS = 1000;
const EPOCH = "1970-01-01T00:00:00.000Z";

type Paged = { items: AuditEventRow[]; totalCount: number; page: number; pageSize: number; hasMore: boolean; nextPage: number | null };

export async function auditList(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<Paged>> {
  const a = readArgs(args, {
    workspaceId: "string?",
    actorUserId: "string?",
    actor: "string?",
    crossWorkspaceOnly: "boolean?",
    action: "string?",
    targetType: "string?",
    from: "string?",
    to: "string?",
    page: "number?",
    pageSize: "number?",
  });
  if (!a.ok) return { ok: false, error: a.error };
  const v = a.value;
  const page = v.page ?? 1;
  const pageSize = v.pageSize ?? 50;
  const actorText = v.actor?.trim();
  const badActor = v.actor !== undefined && (actorText!.length < 1 || actorText!.length > 100);
  const badDate = (s?: string) => Boolean(s) && !ISO.test(s as string);
  if (
    !Number.isInteger(page) || page < 1 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    badDate(v.from) || badDate(v.to) || badActor
  ) {
    return fail("invalid_input", "tenancy.invalidArgs", { keys: ["page", "pageSize", "from", "to", "actor"] });
  }
  // The account read shares the access-check round of openOp.
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.audit.view",
    ...(actorText
      ? {
          extra: {
            accounts: async () => {
              try {
                return await deps.gateway.listAll<AccountRow>(SCHEMA.account, { filter: {}, fields: ACCOUNT_FIELDS, maxItems: MAX_ACCOUNTS + 1 });
              } catch (error) {
                if ((error as { code?: string })?.code === "limit_reached") return null;
                throw error;
              }
            },
          },
        }
      : {}),
  });
  if (!open.ok) return { ok: false, error: open.error };

  const filter: Record<string, FilterValue> = {};
  if (v.workspaceId) filter.WorkspaceId = v.workspaceId;
  if (actorText) {
    const accounts = open.caller.extra.accounts as AccountRow[] | null;
    if (!accounts || accounts.length > MAX_ACCOUNTS) return fail("limit_reached", "audit.actorTooBroad", { max: MAX_ACTOR_IDS });
    const needle = actorText.toLowerCase();
    const found = new Set<string>();
    for (const acc of accounts) {
      const hay = [acc.Email, acc.DisplayName].map((x) => String(x ?? "").toLowerCase());
      if (acc.UserId && hay.some((h) => h.includes(needle))) found.add(acc.UserId);
    }
    if (!/\s/.test(actorText)) found.add(actorText);
    let ids = [...found];
    if (v.actorUserId) ids = ids.filter((id) => id === v.actorUserId);
    if (ids.length === 0) return ok({ items: [], totalCount: 0, page, pageSize, hasMore: false, nextPage: null });
    if (ids.length > MAX_ACTOR_IDS) return fail("limit_reached", "audit.actorTooBroad", { max: MAX_ACTOR_IDS });
    filter.ActorUserId = ids.length === 1 ? ids[0] : { in: ids };
  } else if (v.actorUserId) filter.ActorUserId = v.actorUserId;
  if (v.crossWorkspaceOnly === true) filter.Impersonated = true;
  if (v.action) filter.Action = v.action;
  if (v.targetType) filter.TargetType = v.targetType;
  // Always a range on At: every audit query is one server-sorted, server-paged alternative (never the in-memory merge).
  filter.At = { gte: v.from ?? EPOCH, ...(v.to ? { lte: v.to } : {}) };
  const res = await deps.gateway.list<AuditEventRow>(SCHEMA.auditEvent, {
    filter: filter as Filter,
    fields: AUDIT_EVENT_FIELDS,
    sort: { field: "At", dir: "desc" },
    page,
    pageSize,
  });
  const hasMore = page * pageSize < res.totalCount;
  return ok({ items: res.items, totalCount: res.totalCount, page, pageSize, hasMore, nextPage: hasMore ? page + 1 : null });
}

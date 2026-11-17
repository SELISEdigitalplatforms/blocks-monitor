// notification.markRead: only the caller's own unread rows are written; others are skipped and counted.
import { finishWith, ok, openOp, readArgs } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import { NOTIFICATION_FIELDS, SCHEMA, type NotificationRow } from "../_shared/records";

export const MAX_MARK_READ_IDS = 100;

export async function notificationMarkRead(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ marked: number; skipped: number }>> {
  const a = readArgs(args, { ids: "string[]" });
  if (!a.ok) return { ok: false, error: a.error };
  const ids = [...new Set(a.value.ids)];
  if (ids.length < 1 || ids.length > MAX_MARK_READ_IDS || ids.some((i) => !i)) {
    return { ok: false, error: { code: "invalid_input", messageKey: "tenancy.invalidArgs", params: { keys: ["ids"] } } };
  }
  // The rows are read in the same round trip as the caller check; only the caller's own unread rows are written.
  const [op, rows] = await Promise.all([
    openOp(ctx, deps, { scope: "self" }),
    deps.gateway.listAll<NotificationRow>(SCHEMA.notification, {
      filter: { ItemId: { in: ids } },
      fields: NOTIFICATION_FIELDS,
      maxItems: MAX_MARK_READ_IDS,
    }),
  ]);
  if (!op.ok) return { ok: false, error: op.error };
  const { caller } = op;
  const own = rows.filter((r) => r.RecipientUserId === caller.userId && !r.IsRead);
  const now = deps.clock.now();
  await finishWith(deps, () =>
    Promise.all(
      own.map((r) =>
        deps.gateway.update(SCHEMA.notification, r.ItemId, { IsRead: true, ReadAt: now, UpdatedByUserId: caller.userId }),
      ),
    ),
  );
  return ok({ marked: own.length, skipped: ids.length - own.length });
}

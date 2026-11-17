// notification.markAllRead: one page (500) of the caller's unread rows per call.
import { finishWith, ok, openOp, readArgs } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import { NOTIFICATION_FIELDS, SCHEMA, type NotificationRow } from "../_shared/records";

export const MARK_ALL_ROWS = 500;
const PAGE_SIZE = 100;
const CHUNK = 25;

/** The first MARK_ALL_ROWS unread rows as 100-row pages read in parallel (the gateway allows 100 per page). */
async function readUnread(deps: OpDeps, userId: string): Promise<{ items: NotificationRow[]; totalCount: number }> {
  const pages = await Promise.all(
    Array.from({ length: MARK_ALL_ROWS / PAGE_SIZE }, (_, i) =>
      deps.gateway.list<NotificationRow>(SCHEMA.notification, {
        filter: { RecipientUserId: userId, IsRead: false },
        fields: NOTIFICATION_FIELDS,
        page: i + 1,
        pageSize: PAGE_SIZE,
      }),
    ),
  );
  return { items: pages.flatMap((p) => p.items), totalCount: pages[0]?.totalCount ?? 0 };
}

export async function notificationMarkAllRead(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ marked: number; remaining: number }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  // The page is read in the same round trip as the caller check (openOp refuses a caller without a user id).
  const userId = ctx.context.isAuthenticated ? (ctx.context.userId ?? "") : "";
  const [op, page] = await Promise.all([
    openOp(ctx, deps, { scope: "self" }),
    userId ? readUnread(deps, userId) : Promise.resolve({ items: [] as NotificationRow[], totalCount: 0 }),
  ]);
  if (!op.ok) return { ok: false, error: op.error };
  const { caller } = op;
  const now = deps.clock.now();
  await finishWith(deps, async () => {
    for (let i = 0; i < page.items.length; i += CHUNK) {
      await Promise.all(
        page.items
          .slice(i, i + CHUNK)
          .map((r) => deps.gateway.update(SCHEMA.notification, r.ItemId, { IsRead: true, ReadAt: now, UpdatedByUserId: caller.userId })),
      );
    }
  });
  const marked = page.items.length;
  return ok({ marked, remaining: Math.max(0, page.totalCount - marked) });
}

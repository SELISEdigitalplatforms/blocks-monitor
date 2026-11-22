// External share links of mf-project: shareLink.create, shareLink.list, shareLink.revoke.
// Only the SHA-256 of a token is stored; the clear token is in create's answer once and nowhere else
// (not in the Operation record, the audit details, a log line or an error).
import { OpError, defineOp, f, v, type OpDeps, type OpCtx, type Row } from "../../../_lib";
import { invalidInput } from "../../../_lib/errors";
import type { Validator } from "../../../_lib/validate";
import {
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_EXPIRY_DAYS,
  SHARE_LINK_ITEM_TYPES,
  SHARE_LINK_LIST_MAX,
  SHARE_LINK_MAX_ACTIVE_PER_ITEM,
  SHARE_LINK_SCHEMA,
  SHARE_LINK_VIEW_FIELDS,
  hashShareToken,
  isLive,
  newShareToken,
  shareLinkView,
} from "./contract";
import { readSharedItem } from "./items";

const DAY_MS = 86_400_000;
/** Rows read per item: far above the 20 live links an item may hold, so old revoked ones cannot hide a live one. */
const LINKS_PAGE = 100;

const itemRef = v.string({ min: 1, max: 128 });
const projectId = v.id();

/** 1, 7 or 30 (SHARE_LINK_EXPIRY_DAYS); any other number or type is refused. */
const expiryDays: Validator<number | undefined> = {
  kind: "mf.validator",
  optional: true,
  parse(raw, field) {
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isInteger(raw)) throw invalidInput(field, "int");
    if (!(SHARE_LINK_EXPIRY_DAYS as readonly number[]).includes(raw)) throw invalidInput(field, "enum");
    return raw;
  },
};

const itemArgs = { projectId, itemType: v.enumOf(SHARE_LINK_ITEM_TYPES), itemRef };

type ItemArgs = { projectId: string; itemType: string; itemRef: string };
type Reader = Pick<OpDeps["gw"], "find" | "get" | "findAll">;

const readItem = (gw: OpDeps["gw"], a: ItemArgs, workspaceId: string | null): Promise<Row | null> =>
  readSharedItem(gw, { itemType: a.itemType as never, itemRef: a.itemRef, projectId: a.projectId, ...(workspaceId ? { workspaceId } : {}) });

/** The item's links, newest first (one find). Never asks for the token hash. */
async function readLinks(gw: Reader, a: ItemArgs): Promise<Row[]> {
  const res = await gw.find(SHARE_LINK_SCHEMA, {
    where: f.and(f.eq("ProjectId", a.projectId), f.eq("ItemType", a.itemType), f.eq("ItemRef", a.itemRef)),
    fields: SHARE_LINK_VIEW_FIELDS,
    sort: { field: "CreatedDate", dir: "desc" },
    pageSize: LINKS_PAGE,
  });
  return res.items;
}

const byNewest = (x: Row, y: Row): number =>
  String(y.CreatedDate ?? "").localeCompare(String(x.CreatedDate ?? "")) || String(y.ItemId).localeCompare(String(x.ItemId));

const workspaceIdOf = (ctx: OpCtx): string | null => (typeof ctx.workspace?.ItemId === "string" ? ctx.workspace.ItemId : null);

const createLink = defineOp({
  op: "shareLink.create",
  kind: "command",
  scope: "project",
  permission: "items.shareExternal",
  record: () => false, // the answer carries the token: it never reaches the Operation record
  args: v.object({ ...itemArgs, expiresInDays: expiryDays }),
  prefetch: (p) => {
    if (!p.gw) return undefined;
    return Promise.all([readItem(p.gw as never, p.args, p.workspaceId), readLinks(p.gw, p.args)]);
  },
  async handler(ctx, args, deps) {
    const [item, links] = await Promise.all([readItem(deps.gw, args, workspaceIdOf(ctx)), readLinks(deps.gw, args)]);
    if (!item) return deps.fail("not_found", "share.itemNotFound");
    const now = ctx.now.getTime();
    if (links.filter((r) => isLive(r, ctx.now)).length >= SHARE_LINK_MAX_ACTIVE_PER_ITEM) {
      return deps.fail("invalid_input", "input.tooMany", { key: "links", max: SHARE_LINK_MAX_ACTIVE_PER_ITEM });
    }

    const days = args.expiresInDays ?? SHARE_LINK_DEFAULT_DAYS;
    const expiresAt = new Date(now + days * DAY_MS).toISOString();
    const token = newShareToken();
    const requestKey = deps.ids.uuid5(`${ctx.requestId}:shareLink.create`);
    const row: Row = {
      ProjectId: args.projectId,
      ItemType: args.itemType,
      ItemRef: args.itemRef,
      TokenHash: hashShareToken(token),
      ExpiresAt: expiresAt,
      ViewCount: 0,
    };
    const res = await deps.gw.insert(SHARE_LINK_SCHEMA, row, { requestKey });
    if (!res.created) {
      // A replay: this request's own row answers, without the token (it was shown once) and without a second audit.
      const found = await deps.gw.find(SHARE_LINK_SCHEMA, {
        where: f.eq("RequestKey", requestKey),
        fields: SHARE_LINK_VIEW_FIELDS,
        pageSize: 1,
      });
      const back = found.items[0];
      if (!back) throw new OpError("internal");
      return { link: shareLinkView(back), token: null };
    }
    const id = res.itemId;
    if (!id) throw new OpError("internal");
    deps.audit({
      action: "shareLink.create",
      targetType: "share-link",
      targetId: id,
      details: { shareLinkId: id, itemType: args.itemType, expiresAt },
    });
    const link = shareLinkView({
      ItemId: id,
      ProjectId: args.projectId,
      ItemType: args.itemType,
      ItemRef: args.itemRef,
      CreatedByUserId: ctx.caller.userId,
      CreatedDate: ctx.now.toISOString(),
      ExpiresAt: expiresAt,
      ViewCount: 0,
    });
    return { link, token };
  },
});

const listLinks = defineOp({
  op: "shareLink.list",
  kind: "view",
  scope: "project",
  permission: "items.shareExternal",
  args: v.object(itemArgs),
  prefetch: (p) => {
    if (!p.gw) return undefined;
    return Promise.all([readItem(p.gw as never, p.args, p.workspaceId), readLinks(p.gw, p.args)]);
  },
  async handler(ctx, args, deps) {
    const [item, links] = await Promise.all([readItem(deps.gw, args, workspaceIdOf(ctx)), readLinks(deps.gw, args)]);
    if (!item) return deps.fail("not_found", "share.itemNotFound");
    const live = links.filter((r) => isLive(r, ctx.now)).sort(byNewest).slice(0, SHARE_LINK_LIST_MAX);
    return { links: live.map((r) => shareLinkView(r)) };
  },
});

const readById = async (gw: Reader, a: { projectId: string; shareLinkId: string }): Promise<Row | null> => {
  const res = await gw.find(SHARE_LINK_SCHEMA, {
    where: f.and(f.eq("ItemId", a.shareLinkId), f.eq("ProjectId", a.projectId)),
    fields: SHARE_LINK_VIEW_FIELDS,
    pageSize: 1,
  });
  return res.items[0] ?? null;
};

const revokeLink = defineOp({
  op: "shareLink.revoke",
  kind: "command",
  scope: "project",
  permission: "items.shareExternal",
  args: v.object({ projectId, shareLinkId: v.string({ min: 1, max: 128 }) }),
  prefetch: (p) => (p.gw ? readById(p.gw, p.args) : undefined),
  async handler(ctx, args, deps) {
    const row = await readById(deps.gw, args);
    if (!row) return deps.fail("not_found", "share.notFound");
    if (row.CreatedByUserId !== ctx.caller.userId && !ctx.permissions.includes("members.manage")) {
      return deps.fail("forbidden", "share.notSharer");
    }
    if (row.RevokedAt) return { link: shareLinkView(row) }; // already revoked: nothing to write
    const revokedAt = ctx.now.toISOString();
    await deps.gw.update(SHARE_LINK_SCHEMA, args.shareLinkId, { RevokedAt: revokedAt });
    deps.audit({
      action: "shareLink.revoke",
      targetType: "share-link",
      targetId: args.shareLinkId,
      details: { shareLinkId: args.shareLinkId, itemType: String(row.ItemType ?? "") },
    });
    return { link: shareLinkView({ ...row, RevokedAt: revokedAt }) };
  },
});

export const SHARE_LINK_OPS = [createLink, listLinks, revokeLink];

// Person-written wiki pages: create, save, restore, delete (design 6.2). Every write needs wiki.edit.
import {
  BODY_MAX,
  MAX_PAGES,
  TITLE_MAX,
  WIKI_GROUP_IDS,
  canDeletePage,
  slugify,
  uniqueSlug,
} from "../../../../src/domain/wiki";
import { OpError, defineOp, f, v, type OpDeps, type Row } from "../../../_lib";
import { projectArgs } from "../common/args";
import { childOf, listOf, liveProject } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, pick, str } from "../common/records";
import { PAGE_READ_FIELDS, loadHistoryStubs, loaderDeps, prefetchChild, savePage, warm } from "./savePath";

const MAX_SLUG_TRIES = 5;
/** Time kept free for the answer and the router's own writes. */
const DELETE_MARGIN_MS = 4000;
/** History rows removed per round; the page goes with the last batch. */
const DELETE_BATCH = 50;
const DELETE_MAX_ROWS = 500;

/** Every history row of one page, ids only (one gateway read: the loader pages by itself). */
const historyIds = (deps: Parameters<typeof listOf>[0], projectId: string, pageId: string): Promise<Row[]> =>
  listOf(deps, SCHEMA.wikiHistory, f.and(f.eq("ProjectId", projectId), f.eq("PageId", pageId)), ["ItemId"], { max: DELETE_MAX_ROWS });

const createPage = defineOp({
  op: "wiki.page.create",
  kind: "command",
  scope: "project",
  permission: "wiki.edit",
  args: projectArgs({
    title: v.string({ min: 1, max: TITLE_MAX, trim: true }),
    pageGroup: v.enumOf(WIKI_GROUP_IDS),
    bodyMd: v.optional(v.string({ max: BODY_MAX })),
  }),
  prefetch: (p) => warm(listOf(loaderDeps(p), SCHEMA.wikiPage, f.eq("ProjectId", p.args.projectId), ["ItemId", "Slug"], { max: MAX_PAGES + 1 })),
  async handler(ctx, args, deps) {
    const [, existing] = await Promise.all([
      liveProject(ctx, deps),
      listOf(deps, SCHEMA.wikiPage, f.eq("ProjectId", args.projectId), ["ItemId", "Slug"], { max: MAX_PAGES + 1 }),
    ]);
    if (existing.length >= MAX_PAGES) return deps.fail("limit_reached", MSG.wikiTooManyPages, { max: MAX_PAGES });

    const taken = existing.map((r) => str(r, "Slug"));
    const bodyMd = args.bodyMd ?? "";
    const base = slugify(args.title);
    let page: Row | null = null;
    for (let n = 1; n <= MAX_SLUG_TRIES && page === null; n += 1) {
      const slug = uniqueSlug(base, taken);
      const key = n === 1 ? "page" : `page-${n}`;
      const row: Row = {
        ProjectId: args.projectId,
        Slug: slug,
        PageGroup: args.pageGroup,
        Title: args.title,
        BodyMd: bodyMd,
        SourcesJson: "{}",
        Origin: "person",
      };
      const res = await deps.gw.insert(SCHEMA.wikiPage, row, { key });
      if (res.created && res.itemId) {
        page = { ...row, ItemId: res.itemId };
        break;
      }
      // Not created: this request's own row (a retry; the answer carries its id) or the slug was taken meanwhile.
      // The slug it was stored with is in the list read above (the retry's own slug may differ: its row is taken by now).
      if (res.itemId) page = { ...row, Slug: str(existing.find((r) => str(r, "ItemId") === res.itemId) ?? row, "Slug"), ItemId: res.itemId };
      else taken.push(slug);
    }
    if (page === null) return deps.fail("conflict", MSG.wikiSlugTaken);

    // The first history row links to the new page and is not part of the answer, so it follows the answer.
    if (bodyMd.trim() !== "") {
      const pageId = str(page, "ItemId");
      deps.after(async () => {
        await deps.gw.insert(
          SCHEMA.wikiHistory,
          { ProjectId: args.projectId, PageId: pageId, BodyMd: bodyMd, EditedByUserId: ctx.caller.userId, Origin: "person", At: ctx.now.toISOString() },
          { key: "history" },
        );
      });
    }
    deps.audit({ targetType: "wiki-page", targetId: str(page, "ItemId"), details: { pageGroup: args.pageGroup } });
    return { page: pick(page, FIELDS.wikiPage) };
  },
});

/** One audit per save that wrote a version; an unchanged replay writes nothing. */
const auditSaved = (deps: OpDeps, pageId: string, out: { history: Row[]; unchanged?: true }): void => {
  if (out.unchanged) return;
  const last = out.history[out.history.length - 1];
  deps.audit({ targetType: "wiki-page", targetId: pageId, details: last ? { versionId: str(last, "ItemId") } : {} });
};

const savePageOp = defineOp({
  op: "wiki.page.save",
  kind: "command",
  scope: "project",
  permission: "wiki.edit",
  args: projectArgs({
    pageId: v.id(),
    bodyMd: v.string({ max: BODY_MAX }),
    title: v.optional(v.string({ min: 1, max: TITLE_MAX, trim: true })),
    expectedUpdatedAt: v.optional(v.dateTime()),
  }),
  prefetch: (p) =>
    warm(
      prefetchChild(p, SCHEMA.wikiPage, p.args.pageId, "ProjectId", p.args.projectId, PAGE_READ_FIELDS),
      loadHistoryStubs(loaderDeps(p), p.args.projectId, p.args.pageId),
    ),
  async handler(ctx, args, deps) {
    const [, page, history] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, SCHEMA.wikiPage, args.pageId, args.projectId, PAGE_READ_FIELDS),
      loadHistoryStubs(deps, args.projectId, args.pageId),
    ]);
    const out = await savePage(ctx, deps, { page, history }, args);
    auditSaved(deps, args.pageId, out);
    return out;
  },
});

const restorePage = defineOp({
  op: "wiki.page.restore",
  kind: "command",
  scope: "project",
  permission: "wiki.edit",
  args: projectArgs({
    pageId: v.id(),
    historyId: v.id(),
    expectedUpdatedAt: v.optional(v.dateTime()),
  }),
  prefetch: (p) =>
    warm(
      prefetchChild(p, SCHEMA.wikiPage, p.args.pageId, "ProjectId", p.args.projectId, PAGE_READ_FIELDS),
      loadHistoryStubs(loaderDeps(p), p.args.projectId, p.args.pageId),
      prefetchChild(p, SCHEMA.wikiHistory, p.args.historyId, "ProjectId", p.args.projectId, FIELDS.wikiHistory),
    ),
  async handler(ctx, args, deps) {
    const [, page, history, old] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, SCHEMA.wikiPage, args.pageId, args.projectId, PAGE_READ_FIELDS),
      loadHistoryStubs(deps, args.projectId, args.pageId),
      childOf(deps, SCHEMA.wikiHistory, args.historyId, args.projectId, FIELDS.wikiHistory),
    ]);
    if (str(old, "PageId") !== args.pageId) return deps.fail("not_found");
    const out = await savePage(ctx, deps, { page, history }, {
      projectId: args.projectId,
      bodyMd: str(old, "BodyMd"),
      expectedUpdatedAt: args.expectedUpdatedAt,
    });
    auditSaved(deps, args.pageId, out);
    return out;
  },
});

const deletePage = defineOp({
  op: "wiki.page.delete",
  kind: "command",
  scope: "project",
  permission: "wiki.edit",
  args: projectArgs({ pageId: v.id() }),
  prefetch: (p) =>
    warm(
      prefetchChild(p, SCHEMA.wikiPage, p.args.pageId, "ProjectId", p.args.projectId, ["ItemId", "Origin", "Title", "Slug"]),
      historyIds(loaderDeps(p), p.args.projectId, p.args.pageId),
    ),
  async handler(ctx, args, deps) {
    const [, page, rows] = await Promise.all([
      liveProject(ctx, deps),
      childOf(deps, SCHEMA.wikiPage, args.pageId, args.projectId, ["ItemId", "Origin", "Title", "Slug"]),
      historyIds(deps, args.projectId, args.pageId),
    ]);
    if (!canDeletePage(str(page, "Origin"))) {
      return deps.fail("invalid_input", MSG.wikiFactoryPage, { field: "pageId", rule: "factoryPage" });
    }

    // The last batch carries the page itself (a scoped remove reads first, so a separate round would cost the budget).
    // Out of time, the rest is left for the next call.
    const ids = rows.map((r) => str(r, "ItemId"));
    const removeBatch = async (batch: string[], withPage: boolean): Promise<void> => {
      const results = await Promise.allSettled([
        ...batch.map((id) => deps.gw.remove(SCHEMA.wikiHistory, id, { rowRead: true })),
        ...(withPage ? [deps.gw.remove(SCHEMA.wikiPage, args.pageId, { rowRead: true })] : []),
      ]);
      for (const r of results) {
        // A row an earlier attempt already removed is fine.
        if (r.status === "rejected" && !(r.reason instanceof OpError && r.reason.code === "not_found")) throw r.reason;
      }
    };
    const done = { done: true, remaining: 0, pageId: args.pageId };
    const details = { history: ids.length, slug: str(page, "Slug") };

    if (ids.length <= DELETE_BATCH) {
      // One batch: the removals (a read, then the delete) run next to the router's own closing writes.
      const work = removeBatch(ids, true);
      work.catch(() => undefined);
      deps.after(() => work);
      deps.audit({ targetType: "wiki-page", targetId: args.pageId, details });
      return done;
    }

    let removed = 0;
    let pageGone = false;
    while (!pageGone && (removed === 0 || ctx.remainingMs() > DELETE_MARGIN_MS)) {
      const batch = ids.slice(removed, removed + DELETE_BATCH);
      const last = removed + batch.length >= ids.length;
      await removeBatch(batch, last);
      removed += batch.length;
      pageGone = last;
    }
    if (!pageGone) return { done: false, remaining: ids.length - removed, pageId: args.pageId };
    deps.audit({ targetType: "wiki-page", targetId: args.pageId, details });
    return done;
  },
});

export const WIKI_PAGE_OPS = [createPage, savePageOp, restorePage, deletePage];

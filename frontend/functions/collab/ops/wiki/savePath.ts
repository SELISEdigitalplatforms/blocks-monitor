// The shared save path of wiki.page.save and wiki.page.restore (design 6.2, MF-B03: no compare-and-set,
// so the stale check is best-effort). History rows, prune and the page update are written in one round.
import { HISTORY_PRUNE_PER_CALL, canRetitlePage, historyToPrune } from "../../../../src/domain/wiki";
import { f, isOwnLandedWrite, type OpCtx, type OpDeps, type RawGateway, type Row, type ScopedGateway } from "../../../_lib";
import { topOf } from "../common/loaders";
import { FIELDS, SCHEMA, isoPlus, pick, sameInstant, str } from "../common/records";
import { MSG } from "../common/messages";

/** Everything the save path needs, read in the handler's first round. */
/** The page columns a save reads: the answer's fields plus the creator (who wrote the stored row). */
export const PAGE_READ_FIELDS = [...FIELDS.wikiPage, "CreatedByUserId"] as const;

export interface SaveTarget {
  page: Row;
  history: Row[];
}

export interface SaveInput {
  projectId: string;
  bodyMd: string;
  title?: string;
  expectedUpdatedAt?: string;
}

/** The loaders only touch `deps.gw`, so a prefetch can call them with the gateway alone (same call, same memo entry). */
export const loaderDeps = (p: { gw: ScopedGateway | null }): OpDeps => ({ gw: p.gw }) as unknown as OpDeps;

/** Prefetch twin of `deps.refs.child`: the very same gateway call, so the handler's `childOf` is answered by the memo. */
export function prefetchChild(
  p: { raw: RawGateway; workspaceId: string | null },
  schema: string,
  id: string,
  parentField: string,
  parentId: string,
  fields?: readonly string[],
): Promise<unknown> {
  if (!p.workspaceId) return Promise.resolve();
  return p.raw.find(schema, {
    where: f.and(f.eq("ItemId", id), f.eq("WorkspaceId", p.workspaceId), f.eq(parentField, parentId)),
    fields: [...new Set(["ItemId", "WorkspaceId", parentField, ...(fields ?? [])])],
    page: 1,
    pageSize: 1,
  });
}

/** One promise for a prefetch: it only warms the memo, so a failed read is left for the handler to meet. */
export const warm = (...work: Array<Promise<unknown>>): Promise<void> => Promise.all(work).then(() => undefined, () => undefined);

/** Newest first, at most 70 stubs: enough to know whether history exists and what to prune. */
export function loadHistoryStubs(deps: OpDeps, projectId: string, pageId: string): Promise<Row[]> {
  return topOf(deps, SCHEMA.wikiHistory, f.and(f.eq("ProjectId", projectId), f.eq("PageId", pageId)), ["ItemId", "At"], 70, {
    field: "At",
    dir: "desc",
  });
}

export async function savePage(
  ctx: OpCtx,
  deps: OpDeps,
  target: SaveTarget,
  input: SaveInput,
): Promise<{ page: Row; history: Row[]; unchanged?: true }> {
  const { page } = target;
  const pageId = str(page, "ItemId");
  const origin = str(page, "Origin");
  const newTitle = input.title !== undefined && input.title !== str(page, "Title") ? input.title : undefined;
  if (newTitle !== undefined && !canRetitlePage(origin)) {
    return deps.fail("invalid_input", MSG.wikiFactoryTitle, { field: "title", rule: "factoryPage" });
  }

  // Nothing to write (also what a retry of a finished save sees).
  if (input.bodyMd === str(page, "BodyMd") && newTitle === undefined) {
    return { page: pick(page, FIELDS.wikiPage), history: [], unchanged: true };
  }

  const updatedAt = str(page, "LastUpdatedDate");
  if (input.expectedUpdatedAt !== undefined && !sameInstant(input.expectedUpdatedAt, updatedAt)) {
    // The caller's own earlier save that landed after the client gave up is not a conflict: answer with the stored page.
    if (isOwnLandedWrite({ stored: page, callerUserId: ctx.caller.userId, values: { BodyMd: input.bodyMd, Title: input.title } })) {
      return { page: pick(page, FIELDS.wikiPage), history: [], unchanged: true };
    }
    return deps.fail("conflict", MSG.wikiStale, { updatedAt });
  }

  const now = ctx.now.toISOString();
  const seed = target.history.length === 0 && str(page, "BodyMd") !== "";

  const insertHistory = async (key: string, row: Row): Promise<Row> => {
    const res = await deps.gw.insert(SCHEMA.wikiHistory, { ProjectId: input.projectId, PageId: pageId, ...row }, { key });
    return { ...row, ProjectId: input.projectId, PageId: pageId, ItemId: res.itemId ?? "" };
  };

  // What to prune is known before the inserts run: the new rows are the newest, so they only count toward the cap.
  // Oldest first: a long backlog shrinks from the old end, HISTORY_PRUNE_PER_CALL rows per save.
  const counted = [
    ...target.history.map((h) => ({ id: str(h, "ItemId"), at: str(h, "At") })),
    ...Array.from({ length: seed ? 2 : 1 }, (_, i) => ({ id: `~new-${i}`, at: now })),
  ];
  const prune = historyToPrune(counted)
    .map((r) => r.id)
    .filter((id) => id !== "" && !id.startsWith("~new-"))
    .reverse()
    .slice(0, HISTORY_PRUNE_PER_CALL);

  const patch: Row = { BodyMd: input.bodyMd };
  if (newTitle !== undefined) patch.Title = newTitle;

  // Pruning is housekeeping, not part of the answer. A scoped remove reads first (two calls in a row), so the removals
  // start together with the writes below and the router's closing round waits for them.
  if (prune.length > 0) {
    const pruned = Promise.all(prune.map((id) => deps.gw.remove(SCHEMA.wikiHistory, id, { rowRead: true })));
    pruned.catch(() => undefined);
    deps.after(() => pruned);
  }

  // One round: the history inserts and the page update run together (nothing is read back).
  const [inserted] = await Promise.all([
    (async () => {
      const pending: Array<Promise<Row>> = [];
      // A person can always go back to what MADP wrote: record the current body before the first edit.
      if (seed) {
        pending.push(
          insertHistory("seed", {
            BodyMd: str(page, "BodyMd"),
            Origin: origin,
            EditedByUserId: str(page, "UpdatedByUserId"),
            At: updatedAt !== "" ? updatedAt : isoPlus(ctx.now, -1),
          }),
        );
      }
      pending.push(
        insertHistory("history", { BodyMd: input.bodyMd, Origin: "person", EditedByUserId: ctx.caller.userId, At: now }),
      );
      const rows = await Promise.all(pending);
      return rows.map((r) => pick(r, FIELDS.wikiHistory));
    })(),
    deps.gw.update(SCHEMA.wikiPage, pageId, patch),
  ]);
  // The stored LastUpdatedDate is set by Blocks and is not known here; the old one would be stale and the server clock
  // would not match it, so the answer leaves it out (the page body read returns the stored value).
  const { LastUpdatedDate: _stale, ...rest } = page;
  const saved: Row = { ...rest, ...patch, UpdatedByUserId: ctx.caller.userId };
  return { page: pick(saved, FIELDS.wikiPage), history: inserted };
}

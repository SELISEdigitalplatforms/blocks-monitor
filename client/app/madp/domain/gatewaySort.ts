// Shared gateway-sort rule (pure): the only place a Data Gateway sort object is written.
//
// Live fact (12.11.2026, Factory tenant, read-only probe over every page): the Data Gateway IGNORES a sort on ItemId,
// alone or as a tie-break. 1,474 Ticket rows read page by page sorted {Status: 1, ItemId: 1} came back as 784 distinct
// rows (pages overlapped, other rows were never returned); {Status: 1, _id: 1} returned all 1,474. {ItemId: 1} alone
// returned 428 distinct rows of 744 EngineJob rows; {_id: 1} all 744. The stored key `_id` holds the row's ItemId and is
// honoured. So a sort that means ItemId names `_id`, and every sort ends with `_id` as the tie-break: a page boundary
// never falls inside a run of equal values. Without a sort the gateway answers in its natural (insertion) order, which
// pages cleanly, so no sort is added then.

export type SortDirection = "asc" | "desc";
export interface SortEntry {
  readonly field: string;
  readonly dir?: SortDirection;
}

/** The gateway's own row key: the ItemId, stored as `_id`, unique and honoured by a sort. */
export const ROW_KEY = "_id";

/** The gateway sort object for these entries (in order; ItemId written as `_id`; `_id` ascending appended as the
 *  tie-break unless already there), or undefined when there is nothing to sort by. */
export function gatewaySort(entries: readonly SortEntry[] | undefined): Record<string, 1 | -1> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const out: Record<string, 1 | -1> = {};
  for (const e of entries) {
    const key = e.field === "ItemId" ? ROW_KEY : e.field;
    if (key in out) continue;
    out[key] = e.dir === "desc" ? -1 : 1;
  }
  if (!(ROW_KEY in out)) out[ROW_KEY] = 1;
  return out;
}

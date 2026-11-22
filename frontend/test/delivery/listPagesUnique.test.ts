// A list read page by page returns every row once (src/blocks/data/gql.ts queryListResult). Pages are read by position:
// while a build writes its ticket events, a row of page 1 can come back as the first row of page 2 (PrimaBook's Build
// page then drew one ticket event twice in the live feed: React's "two children with the same key").
import { afterEach, describe, expect, it } from "vitest";
import { addUnique, compareBySort, queryList, queryListResult } from "@/blocks/data/gql";
import { configureDataTransport, type DataRead } from "@/blocks/data/transport";

const row = (n: number) => ({ ItemId: `ev-${n}`, At: `2026-11-09T10:26:12.${String(n).padStart(3, "0")}Z` });

afterEach(() => configureDataTransport(null));

describe("a list read page by page", () => {
  it("keeps a row once when the next page repeats it (rows were added between the two page reads)", async () => {
    // 120 rows, then 7 more land before page 2 is read: page 2 starts 7 rows earlier than it would have
    const before = Array.from({ length: 120 }, (_, i) => row(i));
    const after = [...Array.from({ length: 7 }, (_, i) => row(500 + i)), ...before];
    configureDataTransport({
      read: async (r: DataRead) => {
        const rows = r.pageNo === 1 ? before : after;
        const items = rows.slice((r.pageNo - 1) * r.pageSize, r.pageNo * r.pageSize);
        return { items, totalCount: rows.length, pageNo: r.pageNo, pageSize: r.pageSize, hasNextPage: r.pageNo * r.pageSize < rows.length };
      },
    });
    const items = await queryList<{ ItemId: string }>("TicketEvent", { fields: ["ItemId"], sort: [{ field: "ItemId", dir: "asc" }], pageSize: 100 });
    const ids = items.map((i) => i.ItemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 100)).toEqual(before.slice(0, 100).map((r) => r.ItemId));
  });
  it("rows that tie on the sort and swap between two page reads: the repeat is dropped, the skipped row read again, the order kept", async () => {
    // 105 events, many written in the same millisecond: on the first pass page 1 ends with row 100 instead of row 99,
    // so page 2 repeats row 100 and row 99 is never returned; the second pass returns the pages as they are
    const rows = Array.from({ length: 105 }, (_, i) => ({ ItemId: `ev-${String(i).padStart(3, "0")}`, At: i < 90 ? new Date(Date.UTC(2026, 10, 5, 8, 0, i)).toISOString() : "2026-11-09T10:26:12.898Z" }));
    const swapped = [...rows.slice(0, 99), rows[100]!, rows[99]!, ...rows.slice(101)];
    let reads = 0;
    configureDataTransport({
      read: async (r: DataRead) => {
        reads += 1;
        const list = reads <= 1 ? swapped : rows; // page 1 of the first pass reads the swapped order
        const items = list.slice((r.pageNo - 1) * r.pageSize, r.pageNo * r.pageSize);
        return { items, totalCount: list.length, pageNo: r.pageNo, pageSize: r.pageSize, hasNextPage: r.pageNo * r.pageSize < list.length };
      },
    });
    const res = await queryListResult<{ ItemId: string; At: string }>("TicketEvent", { fields: ["ItemId", "At"], sort: [{ field: "At", dir: "asc" }], pageSize: 100 });
    expect(res.items.map((i) => i.ItemId)).toEqual(rows.map((r) => r.ItemId));
    expect(res.totalCount).toBe(105);
    expect(res.capped).toBe(false);
  });
  it("the client order matches the gateway's: each sort field, then ItemId; numbers by value; descending too", () => {
    const xs = [{ ItemId: "b", N: 10, At: "2026-11-02" }, { ItemId: "a", N: 9, At: "2026-11-02" }, { ItemId: "c", N: 2, At: "2026-11-01" }];
    expect([...xs].sort(compareBySort([{ field: "At", dir: "asc" }])).map((x) => x.ItemId)).toEqual(["c", "a", "b"]);
    expect([...xs].sort(compareBySort([{ field: "N", dir: "asc" }])).map((x) => x.ItemId)).toEqual(["c", "a", "b"]);
    expect([...xs].sort(compareBySort([{ field: "At", dir: "desc" }])).map((x) => x.ItemId)).toEqual(["a", "b", "c"]);
  });
  it("addUnique: by ItemId, the first one read wins; a row without an ItemId is always kept", () => {
    const out: { ItemId?: string; v: number }[] = [];
    const seen = new Set<string>();
    addUnique(out, seen, [{ ItemId: "a", v: 1 }, { ItemId: "b", v: 1 }]);
    addUnique(out, seen, [{ ItemId: "b", v: 2 }, { v: 3 }, { v: 3 }, { ItemId: "c", v: 2 }]);
    expect(out).toEqual([{ ItemId: "a", v: 1 }, { ItemId: "b", v: 1 }, { v: 3 }, { v: 3 }, { ItemId: "c", v: 2 }]);
  });
});

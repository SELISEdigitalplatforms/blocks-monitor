// Every list read pages with a sort the Data Gateway honours (src/domain/gatewaySort.ts). Live fact (12.11.2026): the
// gateway ignores a sort on ItemId, so pages tied on the sort overlapped: 1,474 Ticket rows sorted {Status, ItemId}
// read back as 784 distinct rows. `_id` (the stored ItemId) is honoured, so it is the tie-break and stands for ItemId.
import { describe, expect, it } from "vitest";
import { gatewaySort } from "@/domain/gatewaySort";
import { compileSort } from "@/blocks/data/gql";
import { validateDataRequest, type S1Catalog } from "../../server/fnHost/dataRead";
import { sortKeysOf, sortRows } from "../../server/local/query";
import { createRawGateway } from "../../functions/_lib/gateway";
import { f } from "../../functions/_lib/filter";
import type { SdkFactory } from "../../functions/_lib/sdk";

describe("gatewaySort", () => {
  it("appends _id as the tie-break and keeps the asked order", () => {
    expect(gatewaySort([{ field: "Status", dir: "asc" }])).toEqual({ Status: 1, _id: 1 });
    expect(Object.keys(gatewaySort([{ field: "CreatedDate", dir: "desc" }, { field: "Number" }])!)).toEqual(["CreatedDate", "Number", "_id"]);
    expect(gatewaySort([{ field: "CreatedDate", dir: "desc" }])).toEqual({ CreatedDate: -1, _id: 1 });
  });
  it("writes ItemId as _id (a sort on ItemId is ignored by the gateway), once, in its place and direction", () => {
    expect(gatewaySort([{ field: "ItemId", dir: "asc" }])).toEqual({ _id: 1 });
    expect(gatewaySort([{ field: "ItemId", dir: "desc" }])).toEqual({ _id: -1 });
    expect(gatewaySort([{ field: "Number", dir: "asc" }, { field: "ItemId", dir: "asc" }])).toEqual({ Number: 1, _id: 1 });
    expect(JSON.stringify(gatewaySort([{ field: "Number" }, { field: "ItemId" }]))).not.toContain("ItemId");
  });
  it("adds nothing without a sort (the natural order pages cleanly)", () => {
    expect(gatewaySort(undefined)).toBeUndefined();
    expect(gatewaySort([])).toBeUndefined();
  });
});

describe("every read path uses it", () => {
  it("the browser's GraphQL path (compileSort)", () => {
    expect(compileSort([{ field: "Number", dir: "asc" }, { field: "ItemId", dir: "asc" }] as never)).toEqual({ Number: 1, _id: 1 });
    expect(compileSort([{ field: "At", dir: "desc" }] as never)).toEqual({ At: -1, _id: 1 });
    expect(compileSort(undefined)).toBeUndefined();
  });
  it("POST /api/data (the server compiles the gateway input)", () => {
    const catalog: S1Catalog = new Map([["Ticket", new Set(["ItemId", "Status", "Number"])]]);
    const res = validateDataRequest({ reads: [
      { schema: "Ticket", fields: ["ItemId"], sort: [{ field: "Status", dir: "asc" }], pageNo: 2, pageSize: 100 },
      { schema: "Ticket", fields: ["ItemId"], sort: [{ field: "ItemId", dir: "asc" }], pageNo: 1, pageSize: 100 },
      { schema: "Ticket", fields: ["ItemId"], pageNo: 1, pageSize: 100 },
    ] }, catalog);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(JSON.parse(String(res.reads[0]!.member.input.sort))).toEqual({ Status: 1, _id: 1 });
    expect(JSON.parse(String(res.reads[1]!.member.input.sort))).toEqual({ _id: 1 });
    expect(res.reads[2]!.member.input.sort).toBeUndefined();
  });
  it("the local stand-in reads _id as the row's ItemId", () => {
    const rows = [{ ItemId: "c", S: 1 }, { ItemId: "a", S: 1 }, { ItemId: "b", S: 0 }];
    expect(sortRows(rows, sortKeysOf(JSON.stringify({ S: 1, _id: 1 }))).map((r) => r.ItemId)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, sortKeysOf({ _id: -1 })).map((r) => r.ItemId)).toEqual(["c", "b", "a"]);
  });
});

/** A fake SDK that pages like the live gateway: a sort on `_id` and on other fields is honoured; ItemId is ignored, and
 *  rows that tie on the honoured keys come in an order that changes from one page read to the next. */
function liveLikeSdk(rows: Record<string, unknown>[], sent: unknown[]): SdkFactory {
  let reads = 0;
  const list = (o: { pageNo?: number; pageSize?: number; sort?: Record<string, 1 | -1> | string }) => {
    reads += 1;
    const sort = typeof o.sort === "string" ? (JSON.parse(o.sort) as Record<string, 1 | -1>) : (o.sort ?? {});
    sent.push(sort);
    const keys = Object.entries(sort).filter(([k]) => k !== "ItemId");
    const shuffle = (id: string) => (id.charCodeAt(id.length - 1) * 7919 + reads * 104729) % 1009;
    const ordered = [...rows].sort((a, b) => {
      for (const [k, d] of keys) {
        const x = String(k === "_id" ? a.ItemId : a[k]);
        const y = String(k === "_id" ? b.ItemId : b[k]);
        if (x !== y) return (x < y ? -1 : 1) * d;
      }
      return shuffle(String(a.ItemId)) - shuffle(String(b.ItemId));
    });
    const size = o.pageSize ?? 20;
    const page = o.pageNo ?? 1;
    const items = ordered.slice((page - 1) * size, page * size);
    return Promise.resolve({ data: { getTickets: { items, totalCount: rows.length } } });
  };
  return () => ({ data: { collection: () => ({ list }) } }) as never;
}

describe("the functions' gateway (findAll)", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ ItemId: `t-${String(i).padStart(3, "0")}`, Status: i % 3 === 0 ? "done" : "open" }));
  const env = { apiUrl: "https://example.invalid", tenant: "T", clientId: "c", clientSecret: "s" };
  const tokens = { token: async () => "tok", claims: async () => ({}), invalidate: () => {} };

  it("pages tied on the sort return every row once, the sort sent with _id as the tie-break", async () => {
    const sent: unknown[] = [];
    const gw = createRawGateway({ env, sdk: liveLikeSdk(rows, sent), tokens, batch: false });
    const all = await gw.findAll("Ticket", { where: f.eq("WorkspaceId", "w"), fields: ["ItemId", "Status"], sort: { field: "Status", dir: "asc" } });
    expect(all).toHaveLength(250);
    expect(new Set(all.map((r) => r.ItemId)).size).toBe(250);
    expect(sent.every((s) => JSON.stringify(s) === JSON.stringify({ Status: 1, _id: 1 }))).toBe(true);
  });
  it("a sort on ItemId is sent as _id, and every row comes once", async () => {
    const sent: unknown[] = [];
    const gw = createRawGateway({ env, sdk: liveLikeSdk(rows, sent), tokens, batch: false });
    const all = await gw.findAll("Ticket", { where: f.eq("WorkspaceId", "w"), fields: ["ItemId"], sort: { field: "ItemId", dir: "asc" } });
    expect(all.map((r) => r.ItemId)).toEqual(rows.map((r) => r.ItemId));
    expect(sent[0]).toEqual({ _id: 1 });
  });
  it("a row repeated by the next page (written between two page reads) is kept once", async () => {
    let call = 0;
    const list = (o: { pageNo?: number; pageSize?: number }) => {
      call += 1;
      const page = o.pageNo ?? 1;
      const size = o.pageSize ?? 100;
      // page 2 starts one row early: the last row of page 1 comes again
      const start = (page - 1) * size - (page > 1 ? 1 : 0);
      return Promise.resolve({ data: { getTickets: { items: rows.slice(start, start + size), totalCount: rows.length } } });
    };
    const sdk = (() => ({ data: { collection: () => ({ list }) } })) as unknown as SdkFactory;
    const gw = createRawGateway({ env, sdk, tokens, batch: false });
    const all = await gw.findAll("Ticket", { where: f.eq("WorkspaceId", "w"), fields: ["ItemId"] });
    const ids = all.map((r) => r.ItemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(call).toBe(3);
  });
});

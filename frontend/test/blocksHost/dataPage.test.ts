// POST /api/data in Blocks mode: a page answer never cuts a list at its first page in silence, and a gateway call made
// for a browser read gives up instead of holding the screen on "loading" (server/blocks/host.ts).
import { describe, expect, it } from "vitest";
import { dataPage, fetchWithTimeout } from "../../server/blocks/host";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ItemId: `r${i}` }));

describe("dataPage", () => {
  it("follows the gateway's count", () => {
    expect(dataPage({ items: rows(100), totalCount: 250 }, { pageNo: 1, pageSize: 100 })).toMatchObject({ totalCount: 250, hasNextPage: true });
    expect(dataPage({ items: rows(50), totalCount: 250 }, { pageNo: 3, pageSize: 100 })).toMatchObject({ totalCount: 250, hasNextPage: false });
  });
  it("without a count, a full page says there may be more (it was read as the whole list before)", () => {
    expect(dataPage({ items: rows(100), totalCount: null }, { pageNo: 1, pageSize: 100 })).toMatchObject({ totalCount: 100, hasNextPage: true });
    expect(dataPage({ items: rows(100), totalCount: null }, { pageNo: 2, pageSize: 100 })).toMatchObject({ totalCount: 200, hasNextPage: true });
    expect(dataPage({ items: rows(30), totalCount: null }, { pageNo: 2, pageSize: 100 })).toMatchObject({ totalCount: 130, hasNextPage: false });
  });
});

describe("fetchWithTimeout", () => {
  it("aborts a call that does not answer in time", async () => {
    const never: typeof fetch = (_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    await expect(fetchWithTimeout(20, never)("https://example.invalid/")).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps the caller's own signal", async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const base: typeof fetch = async (_input, init) => {
      seen = init?.signal ?? undefined;
      return new Response("{}");
    };
    await fetchWithTimeout(60_000, base)("https://example.invalid/", { signal: ctl.signal });
    ctl.abort();
    expect(seen?.aborted).toBe(true);
  });
});

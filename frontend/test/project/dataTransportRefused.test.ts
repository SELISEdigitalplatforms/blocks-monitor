// One read the server refuses (a field its catalogue does not know yet, e.g. Project.LiveProductJson before the host
// reloads its schemas) must never take the other reads of the same batched request down with it.
import { describe, expect, it } from "vitest";
import { createDataTransport, type DataRead } from "../../src/blocks/data/transport";

const read = (schema: string, fields: string[]): DataRead => ({ schema, fields, pageNo: 1, pageSize: 10 });

/** A fake /api/data: 400 for any request that carries a read of `bad`; otherwise one empty page per read. */
function server(bad: (r: DataRead) => boolean) {
  const calls: number[] = [];
  const fetch = (async (_url: string, init: { body: string }) => {
    const { reads } = JSON.parse(init.body) as { reads: DataRead[] };
    calls.push(reads.length);
    if (reads.some(bad)) return new Response(JSON.stringify({ ok: false }), { status: 400 });
    return new Response(JSON.stringify({ results: reads.map(() => ({ ok: true, items: [], totalCount: 0, pageNo: 1, pageSize: 10, hasNextPage: false })) }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the batched read transport", () => {
  it("answers every read the server knows when one read of the batch is refused", async () => {
    const isBad = (r: DataRead) => r.fields.includes("LiveProductJson");
    const s = server(isBad);
    let flush: (() => void) | null = null;
    const t = createDataTransport({ fetch: s.fetch, schedule: (fn) => { flush = fn; }, onFreshness: () => undefined });
    const good = Array.from({ length: 9 }, (_, i) => t.read(read(`S${i}`, ["ItemId"])));
    const snapshot = t.read(read("Project", ["ItemId", "LiveProductJson"]));
    flush!();
    const results = await Promise.allSettled([...good, snapshot]);
    expect(results.slice(0, 9).every((r) => r.status === "fulfilled")).toBe(true);
    expect(results[9].status).toBe("rejected");
    // halves, not one request per read
    expect(s.calls.length).toBeLessThanOrEqual(1 + 2 * Math.ceil(Math.log2(10)) + 1);
  });

  it("sends a refused read alone from then on, so it never joins a batch again", async () => {
    const isBad = (r: DataRead) => r.fields.includes("LiveProductJson");
    const s = server(isBad);
    let flush: (() => void) | null = null;
    const t = createDataTransport({ fetch: s.fetch, schedule: (fn) => { flush = fn; }, onFreshness: () => undefined });
    const first = [t.read(read("A", ["ItemId"])), t.read(read("Project", ["LiveProductJson", "ItemId"]))];
    flush!();
    await Promise.allSettled(first);
    s.calls.length = 0;
    flush = null;
    const again = t.read(read("Project", ["ItemId", "LiveProductJson"]));
    const other = t.read(read("B", ["ItemId"]));
    flush!();
    const [a, b] = await Promise.allSettled([again, other]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("fulfilled");
    // the refused read left on its own; the other one in a batch of its own: no request carried both
    expect(s.calls).toEqual([1, 1]);
  });

  it("still fails a whole batch on any other refusal (no splitting on 401, 403, 429 or 5xx)", async () => {
    const calls: number[] = [];
    const fetch = (async (_u: string, init: { body: string }) => {
      calls.push((JSON.parse(init.body) as { reads: unknown[] }).reads.length);
      return new Response("{}", { status: 429 });
    }) as unknown as typeof globalThis.fetch;
    let flush: (() => void) | null = null;
    const t = createDataTransport({ fetch, schedule: (fn) => { flush = fn; }, onFreshness: () => undefined });
    const both = [t.read(read("A", ["ItemId"])), t.read(read("B", ["ItemId"]))];
    flush!();
    const r = await Promise.allSettled(both);
    expect(r.every((x) => x.status === "rejected")).toBe(true);
    expect(calls).toEqual([2]);
  });
});

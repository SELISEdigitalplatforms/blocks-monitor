// The brief's reads (server/api/brief/access.ts): a list read at the full page size gets its later pages when the
// gateway's count says there are more, and a failed read of the files fails the brief instead of answering "no files".
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { projectReads, readProjectFacts, withLaterPages, type CallerReads, type DataRead } from "../../server/api/brief/access";

const PID = "e34a92e7-2204-4729-8774-716321bb4f74";
const WS = "383b791a-eccf-49e8-a68b-9204da76f798";
const req = {} as IncomingMessage;
const res = {} as ServerResponse;
const files = Array.from({ length: 230 }, (_, i) => ({ ItemId: `f${i}`, Name: `file-${i}.pdf`, Mime: "application/pdf", Status: "ready" }));

/** The caller's reads over fixed tables: each read answers its page and the full count. */
function tables(t: Record<string, Record<string, unknown>[]>, fail: string[] = []): { reads: CallerReads; asked: DataRead[] } {
  const asked: DataRead[] = [];
  const reads: CallerReads = async (_q, _s, list) => {
    asked.push(...list);
    return {
      ok: true,
      userId: "u1",
      results: list.map((r) => {
        if (fail.includes(r.schema)) return { ok: false as const };
        const rows = t[r.schema] ?? [];
        return { ok: true as const, items: rows.slice((r.pageNo - 1) * r.pageSize, r.pageNo * r.pageSize), totalCount: rows.length };
      }),
    };
  };
  return { reads, asked };
}

describe("the brief reads every page of its lists", () => {
  it("230 files are read as three pages, each once", async () => {
    const t = tables({ Project: [{ ItemId: PID, WorkspaceId: WS, Name: "Shop" }], DocFile: files });
    const out = await readProjectFacts(t.reads, req, res, PID);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.facts.files).toHaveLength(230);
    expect(new Set(out.facts.files.map((f) => f.id)).size).toBe(230);
    expect(t.asked.filter((r) => r.schema === "DocFile").map((r) => r.pageNo)).toEqual([1, 2, 3]);
    // single-row reads never get more pages
    expect(t.asked.filter((r) => r.schema === "Project")).toHaveLength(1);
  });
  it("a failed read of the files fails the brief (it answered 'no files' before)", async () => {
    const t = tables({ Project: [{ ItemId: PID, WorkspaceId: WS, Name: "Shop" }] }, ["DocFile"]);
    expect(await readProjectFacts(t.reads, req, res, PID)).toMatchObject({ ok: false, status: 503 });
  });
  it("a later page that fails fails the whole list", async () => {
    let call = 0;
    const reads: CallerReads = async (_q, _s, list) => {
      call += 1;
      return { ok: true, userId: "u1", results: list.map(() => (call === 1 ? { ok: true as const, items: files.slice(0, 100), totalCount: 230 } : { ok: false as const })) };
    };
    const asked = projectReads(PID).filter((r) => r.schema === "DocFile");
    const first = await reads(req, res, asked);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await withLaterPages(reads, req, res, asked, first.results)).toBeNull();
  });
  it("without a count, the first page stays as it is", async () => {
    const asked = projectReads(PID).filter((r) => r.schema === "DocFile");
    const first = [{ ok: true as const, items: files.slice(0, 100) }];
    const out = await withLaterPages(async () => { throw new Error("not asked"); }, req, res, asked, first);
    expect(out?.[0]).toMatchObject({ ok: true });
    expect((out?.[0] as { items: unknown[] }).items).toHaveLength(100);
  });
});

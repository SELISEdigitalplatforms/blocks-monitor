// A project's ticket events: read newest first under the cap, so when a project has more events than are read the oldest
// are the ones left out (never the newest), then put back in time order for the timeline logic; the Build page says
// truthfully when older updates are missing from its counts.
//   npx vitest run --config test/ordering/vitest.config.ts test/ordering/projectEvents.test.tsx
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { configureDataTransport, createDataTransport, type DataRead } from "@/blocks/data/transport";
import { queryListResult } from "@/blocks/data/gql";
import { MAX_PROJECT_EVENTS, projectEventList, projectTicketEventsOptions } from "@/blocks/delivery/hooks";
import { TICKET_EVENT_FIELDS } from "@/blocks/delivery/types";
import { EventsCappedNote } from "@/components/build/BlocksBuildView";

const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString();
const event = (i: number) => ({ ItemId: `e-${i}`, ProjectId: "p", TicketId: "t-1", Kind: "move", FromColumn: "dev", ToColumn: "review", AuthorLabel: "dev", At: at(i), IsAuto: true });
// stored in no particular order
const ROWS = [3, 0, 6, 1, 5, 2, 4].map(event);

/** A gateway that honours the asked sort and pages. */
const fakeFetch = (async (_url: string, init: { body: string }) => {
  const { reads } = JSON.parse(init.body) as { reads: DataRead[] };
  const results = reads.map((r) => {
    const s = r.sort?.[0];
    const list = [...ROWS].sort((a, b) => (s ? (a.At < b.At ? -1 : 1) * (s.dir === "desc" ? -1 : 1) : 0));
    const from = (r.pageNo - 1) * r.pageSize;
    return { ok: true, items: list.slice(from, from + r.pageSize), totalCount: list.length, pageNo: r.pageNo, pageSize: r.pageSize, hasNextPage: from + r.pageSize < list.length };
  });
  return new Response(JSON.stringify({ results }), { status: 200 });
}) as unknown as typeof fetch;

describe("a project's ticket events", () => {
  beforeAll(() => configureDataTransport(createDataTransport({ fetch: fakeFetch, schedule: (fn) => setTimeout(fn, 0) })));
  afterAll(() => configureDataTransport(null));

  it("are read newest first (At descending) under the cap", () => {
    const o = projectTicketEventsOptions({ workspaceId: "w", projectId: "p" });
    expect(JSON.stringify(o.queryKey)).toContain('"sort":[{"field":"At","dir":"desc"}]');
    expect(JSON.stringify(o.queryKey)).toContain(`"maxItems":${MAX_PROJECT_EVENTS}`);
  });

  it("over the cap, the oldest are left out and the list says so; the rest come back in time order", async () => {
    // the same read as the hook's, with a cap of 5 for 7 events
    const read = await queryListResult<Record<string, unknown>>("TicketEvent", {
      fields: [...TICKET_EVENT_FIELDS], sort: [{ field: "At", dir: "desc" }], pageSize: 2, maxItems: 5,
    });
    expect(read.items.map((r) => r.ItemId)).toEqual(["e-6", "e-5", "e-4", "e-3", "e-2"]);
    const list = projectEventList(read, false, null);
    expect(list.data.map((e) => e.id)).toEqual(["e-2", "e-3", "e-4", "e-5", "e-6"]);
    expect(list).toMatchObject({ capped: true, totalCount: 7 });
  });

  it("under the cap, every event is there in time order and nothing is said", () => {
    const list = projectEventList({ items: [event(2), event(0), event(1)], capped: false, totalCount: 3 }, false, null);
    expect(list.data.map((e) => e.id)).toEqual(["e-0", "e-1", "e-2"]);
    expect(list.capped).toBe(false);
  });

  it("the Build page says how many of how many updates it counts", () => {
    const html = renderToStaticMarkup(createElement(EventsCappedNote, { shown: 5000, total: 6234 }));
    expect(html).toContain("Showing the newest 5,000 of 6,234 recorded ticket updates. The oldest are left out of the counts here.");
  });
});

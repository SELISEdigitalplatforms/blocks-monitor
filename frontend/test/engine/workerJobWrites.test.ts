// The Blocks worker's EngineJob writes are conditional (store.ts mirrored().update: updateMany on the state the worker
// saw). The tenant stores LastUpdatedDate as a date, so a condition on it never matches an ISO string: a design job
// whose writes carried one stayed "claimed · Waiting for the design worker." through its whole run and never got its
// outcome (08.11.2026). Here the fake Data Gateway compares like the tenant: a date field never equals a string.
import { describe, expect, it } from "vitest";
import { createGatewayStore, type Catalog } from "../../server/blocks/engineWorker/store";
import type { RawGateway, Row } from "../../functions/_lib/gateway";

const FIELDS = ["ItemId", "ProjectId", "Kind", "Status", "Attempts", "Progress", "Message", "ClaimedBy", "ClaimedAt", "ErrorCode", "FinishedAt", "ActiveKey", "OutputRefs", "LastUpdatedDate"];
const catalog: Catalog = { fields: (s) => (s === "EngineJob" ? FIELDS : null), projectSchemas: () => [], missing: () => [] };

/** A one-table Data Gateway: dates are stored as dates (answered as ISO strings), filters are Mongo-like. */
function tenant(rows: Row[]) {
  const table = new Map<string, Row>(rows.map((r) => [String(r.ItemId), { ...r, LastUpdatedDate: new Date("2026-11-08T20:32:01.972Z") }]));
  const filters: Record<string, unknown>[] = [];
  const out = (r: Row): Row => ({ ...r, LastUpdatedDate: (r.LastUpdatedDate as Date).toISOString() });
  const matches = (r: Row, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === "object" && "$ne" in v) return r[k] !== (v as { $ne: unknown }).$ne;
      return r[k] === v; // a Date never equals a string
    });
  const raw = {
    get: async (_s: string, id: string) => (table.has(id) ? out(table.get(id)!) : null),
    findAll: async () => [...table.values()].map(out),
  } as unknown as RawGateway;
  const client = async () => ({
    data: {
      graphql: async ({ variables }: { variables: { filter: string; input: Row } }) => {
        const filter = JSON.parse(variables.filter) as Record<string, unknown>;
        filters.push(filter);
        const hit = [...table.values()].find((r) => matches(r, filter));
        if (hit) Object.assign(hit, variables.input, { LastUpdatedDate: new Date() });
        return { data: { updateManyEngineJob: { acknowledged: Boolean(hit), totalImpactedData: hit ? 1 : 0 } } };
      },
    },
  });
  const store = createGatewayStore({ root: "/tmp", raw, client: client as never, invalidateToken: () => {}, catalog });
  return { store, row: (id: string) => out(table.get(id)!), set: (id: string, patch: Row) => Object.assign(table.get(id)!, patch), filters };
}

const designJob = (id: string): Row => ({
  ItemId: id, ProjectId: "p1", Kind: "design.generate", Status: "claimed", Attempts: 1, Progress: 0, ClaimedBy: "madp-engine-main",
  ClaimedAt: "2026-11-08T20:32:01.785Z", Message: "Waiting for the design worker.", ErrorCode: null,
});

describe("the Blocks worker's conditional EngineJob writes", () => {
  it("moves a pre-claimed design job to running and writes its progress and outcome", async () => {
    const t = tenant([designJob("j1")]);
    await t.store.refreshRow("EngineJob", "j1");
    const gw = t.store.mirrored();
    await gw.update("EngineJob", "j1", { Status: "running", Progress: 0, Message: "Started." });
    expect(t.row("j1")).toMatchObject({ Status: "running", Message: "Started." });
    await gw.update("EngineJob", "j1", { Progress: 10, Message: "The planner is designing screens." });
    await gw.update("EngineJob", "j1", { Progress: 10 }); // the heartbeat
    expect(t.row("j1")).toMatchObject({ Status: "running", Progress: 10, Message: "The planner is designing screens." });
    await gw.update("EngineJob", "j1", { Status: "succeeded", Progress: 100, Message: "Screen designs are ready.", OutputRefs: ["DesignBrief:b1"], FinishedAt: "2026-11-08T20:39:00.643Z", ActiveKey: "j1" });
    expect(t.row("j1")).toMatchObject({ Status: "succeeded", Progress: 100, ActiveKey: "j1", FinishedAt: "2026-11-08T20:39:00.643Z" });
    expect(t.filters.some((f) => "LastUpdatedDate" in f)).toBe(false);
  });

  it("a stop request wins over progress written from an older snapshot; the cancellation is acknowledged", async () => {
    const t = tenant([{ ...designJob("j2"), Status: "running", Progress: 30 }]);
    await t.store.refreshRow("EngineJob", "j2");
    const gw = t.store.mirrored();
    t.set("j2", { ErrorCode: "design.stopRequested" }); // jobs.ts cancel, not yet in the worker's snapshot
    await gw.update("EngineJob", "j2", { Progress: 60, Message: "Exporting the frames." });
    expect(t.row("j2")).toMatchObject({ Status: "running", Progress: 30, ErrorCode: "design.stopRequested" });
    await gw.update("EngineJob", "j2", { Status: "cancelled", ErrorCode: "", Message: "Design stopped.", ActiveKey: "j2" });
    expect(t.row("j2")).toMatchObject({ Status: "cancelled", ErrorCode: "" });
  });

  it("other kinds are conditional on Status and Attempts only", async () => {
    const t = tenant([{ ...designJob("j3"), Kind: "wiki.generate", Status: "running" }]);
    await t.store.refreshRow("EngineJob", "j3");
    await t.store.mirrored().update("EngineJob", "j3", { Progress: 50 });
    expect(t.row("j3").Progress).toBe(50);
    expect(t.filters.at(-1)).toEqual({ ItemId: "j3", Status: "running", Attempts: 1 });
  });
});

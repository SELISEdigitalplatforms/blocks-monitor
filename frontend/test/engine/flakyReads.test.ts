// The tenant's Data Gateway fails a share of reads at random ("Unexpected Execution Error"): the engine tries a read
// again before it counts as failed, so one random error never stops a job. Other errors are not retried.
import { describe, expect, it } from "vitest";
import { createGatewayStore, type Catalog } from "../../server/blocks/engineWorker/store";
import type { RawGateway, Row } from "../../functions/_lib/gateway";

const PID = "11111111-2222-4333-8444-555555555555";
const rows: Record<string, Row[]> = {
  Project: [{ ItemId: PID, WorkspaceId: "ws1", Name: "Shop" }],
  Feature: [{ ItemId: "f1", ProjectId: PID, Title: "Checkout" }],
};
const catalog: Catalog = {
  fields: (s) => (s === "Feature" ? ["ItemId", "ProjectId", "Title"] : s === "Project" ? ["ItemId", "WorkspaceId", "Name"] : null),
  projectSchemas: () => ["Feature"],
  missing: () => [],
};
function raw(failFirst: number, message: string): { gw: RawGateway; calls: () => number } {
  let calls = 0;
  const gw: RawGateway = {
    get: async (schema, id) => (rows[schema] ?? []).find((r) => r.ItemId === id) ?? null,
    find: async (schema) => ({ items: rows[schema] ?? [], totalCount: (rows[schema] ?? []).length }),
    findAll: async (schema) => {
      calls += 1;
      if (calls <= failFirst) throw new Error(message);
      return rows[schema] ?? [];
    },
    insert: async () => ({ created: true, itemId: "x" }),
    insertMany: async () => ({ created: 0, existing: 0 }),
    update: async () => undefined,
    updateMany: async () => ({ matched: 0 }),
    remove: async () => undefined,
  };
  return { gw, calls: () => calls };
}
const storeOf = (gw: RawGateway) => createGatewayStore({ root: "/tmp", raw: gw, client: async () => ({}) as never, invalidateToken: () => {}, catalog });

describe("random Data Gateway errors", () => {
  it("a read that fails at random is tried again, and the project loads", async () => {
    const r = raw(2, "Unexpected Execution Error");
    const store = storeOf(r.gw);
    await store.loadProject(PID, new Set(), { workspaceId: "ws1" });
    expect(store.get("Feature", "f1")).toMatchObject({ Title: "Checkout" });
    expect(r.calls()).toBe(3);
  });

  it("an error that is not a passing one is not retried", async () => {
    const r = raw(99, "forbidden");
    await expect(storeOf(r.gw).loadProject(PID, new Set(), { workspaceId: "ws1" })).rejects.toMatchObject({
      message: "Project preparation could not read Feature", cause: { message: "forbidden" },
    });
    expect(r.calls()).toBe(1);
  });
});

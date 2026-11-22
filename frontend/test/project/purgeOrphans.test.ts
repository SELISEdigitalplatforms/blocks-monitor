// scripts/purge-orphans.mjs (server/blocks/orphans.ts): what deleted projects left behind, found and removed by the
// delete's own rules; kept history is only counted, and a host-level row is never a project's leftover.
import { describe, expect, it } from "vitest";
import { memoryGateway } from "../../functions/_lib/testing/memoryGateway";
import { ORPHAN_SCHEMAS, applyOrphans, orphanReport, planOrphans, sdkListAll, type ListAll } from "../../server/blocks/orphans";
import type { SdkClient } from "../../functions/_lib/sdk";
import { PROJECT_CASCADE_KEEP, PROJECT_PURGE_SCHEMAS } from "../../src/domain/projects";

type Row = Record<string, unknown>;

/** A tenant in memory: rows per schema; a schema left out is not on the tenant. */
function tenant(rows: Record<string, Row[]>, onProjectsRead?: (n: number) => Row[] | void): ListAll {
  let projectReads = 0;
  return async (schema, fields) => {
    if (schema === "Project") {
      projectReads += 1;
      const extra = onProjectsRead?.(projectReads);
      if (extra) return extra;
    }
    const list = rows[schema];
    if (!list) return null;
    return list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k === "ItemId" || fields.includes(k))));
  };
}

const PROJECTS = [{ ItemId: "p1", Status: "active" }, { ItemId: "p2", Status: "deleting" }];

describe("planOrphans", () => {
  it("covers every schema with a delete rule, with the delete's decision", () => {
    expect(ORPHAN_SCHEMAS.filter((s) => s.decision === "delete").map((s) => s.schema)).toEqual([...PROJECT_PURGE_SCHEMAS]);
    expect(ORPHAN_SCHEMAS.filter((s) => s.decision === "keep").map((s) => s.schema)).toEqual(PROJECT_CASCADE_KEEP.map((k) => k.schema));
  });

  it("finds the rows of deleted projects and of projects being deleted, and nothing else", async () => {
    const plan = await planOrphans(tenant({
      Project: PROJECTS,
      Clarification: [
        { ItemId: "c1", ProjectId: "p1", Question: "private words" },
        { ItemId: "c2", ProjectId: "p2" },
        { ItemId: "c3", ProjectId: "p3" },
      ],
      DocFile: [{ ItemId: "f1", ProjectId: "p3", StorageObjectId: "obj-1" }],
      Notification: [{ ItemId: "n1", ProjectId: "p3" }, { ItemId: "n2", ProjectId: "" }],
      EngineJob: [{ ItemId: "j1", ProjectId: "system" }, { ItemId: "j2", ProjectId: "p2" }],
      Operation: [{ ItemId: "o1", ProjectId: "p3" }, { ItemId: "o2", ProjectId: "p9" }],
      CreditEntry: [{ ItemId: "e1", ProjectId: "" }, { ItemId: "e2", ProjectId: "p1" }],
    }));
    const of = (schema: string) => plan.schemas.find((s) => s.schema === schema)!;
    expect(plan.liveProjects).toBe(1);
    expect(plan.deletingProjectIds).toEqual(["p2"]);
    expect(plan.goneProjectIds).toEqual(["p3"]);
    expect(plan.historyOnlyProjectIds).toEqual(["p9"]);
    expect(of("Clarification")).toMatchObject({ decision: "delete", total: 3 });
    expect(of("Clarification").gone.map((r) => r.ItemId)).toEqual(["c3"]);
    expect(of("Clarification").deleting.map((r) => r.ItemId)).toEqual(["c2"]);
    // the leftovers carry ids and Storage-file fields only
    expect(of("Clarification").gone[0]).toEqual({ ItemId: "c3", ProjectId: "p3" });
    expect(of("DocFile").gone).toEqual([{ ItemId: "f1", ProjectId: "p3", StorageObjectId: "obj-1" }]);
    expect(of("Notification").gone.map((r) => r.ItemId)).toEqual(["n1"]);
    // the engine's host-level job is never a leftover
    expect(of("EngineJob").gone).toEqual([]);
    expect(of("EngineJob").deleting.map((r) => r.ItemId)).toEqual(["j2"]);
    expect(of("Operation")).toMatchObject({ decision: "keep" });
    expect(of("Operation").gone.map((r) => r.ItemId)).toEqual(["o1", "o2"]);
    expect(of("CreditEntry").gone).toEqual([]);
    // a schema the tenant does not have
    expect(of("Ticket").total).toBeNull();

    const report = orphanReport(plan).join("\n");
    expect(report).toContain("Clarification | delete | 3 | 1 | 1");
    expect(report).toContain("Ticket | delete | not on this tenant | 0 | 0");
    expect(report).toContain("c3");
    expect(report).not.toContain("private words");
    // kept history is counted, its ids are not listed
    expect(report).not.toContain("o1");
  });

  it("never takes the rows of a project created during the scan for leftovers", async () => {
    const plan = await planOrphans(tenant(
      { Project: PROJECTS, Clarification: [{ ItemId: "c5", ProjectId: "p5" }] },
      (n) => (n === 2 ? [...PROJECTS, { ItemId: "p5", Status: "active" }] : undefined),
    ));
    expect(plan.goneProjectIds).toEqual([]);
    expect(plan.schemas.find((s) => s.schema === "Clarification")!.gone).toEqual([]);
  });

  it("takes a project marked deleting during the scan as being deleted", async () => {
    const plan = await planOrphans(tenant(
      { Project: PROJECTS, Clarification: [{ ItemId: "c1", ProjectId: "p1" }] },
      (n) => (n === 2 ? [{ ItemId: "p1", Status: "deleting" }, PROJECTS[1]!] : undefined),
    ));
    expect(plan.deletingProjectIds).toEqual(["p1", "p2"]);
    expect(plan.schemas.find((s) => s.schema === "Clarification")!.deleting.map((r) => r.ItemId)).toEqual(["c1"]);
  });
});

describe("applyOrphans", () => {
  it("lets the purge finish the projects being deleted and removes the deleted projects' rows, files first; history stays", async () => {
    const gw = memoryGateway({ validate: false });
    for (const [schema, id, projectId, extra] of [
      ["Clarification", "c3", "p3", {}], ["DocFile", "f1", "p3", { StorageObjectId: "obj-1" }], ["Notification", "n1", "p3", {}],
      ["AttachmentExtraction", "x1", "p3", { ExtractedContentObjectId: "obj-2", FindingsObjectId: "obj-3" }],
      ["Operation", "o1", "p3", {}], ["Clarification", "c1", "p1", {}],
    ] as const) gw.seed(schema, { ItemId: id, ProjectId: projectId, RequestKey: id, ...extra });
    const plan = await planOrphans(tenant({
      Project: PROJECTS,
      ...Object.fromEntries(["Clarification", "DocFile", "Notification", "AttachmentExtraction", "Operation"].map((s) => [s, gw.rows(s)])),
    }));
    const order: string[] = [];
    const remove = gw.remove.bind(gw);
    gw.remove = async (schema, id) => { order.push(`row:${id}`); return remove(schema, id); };
    const ticks = [
      { picked: 1, finished: ["p2"], pending: [], failed: [], nextDueMs: null },
      { picked: 0, finished: [], pending: [], failed: [], nextDueMs: null },
    ];
    let tickCalls = 0;
    const res = await applyOrphans(plan, {
      raw: gw,
      async removeFile(fileId) { order.push(`file:${fileId}`); },
      async purgeTick() { return ticks[Math.min(tickCalls++, ticks.length - 1)]!; },
    }, { concurrency: 1 });

    expect(res.purged).toEqual(["p2"]);
    expect(res.purgeLeft).toEqual([]);
    expect(tickCalls).toBe(1);
    expect(res.removed).toEqual({ Clarification: 1, DocFile: 1, Notification: 1, AttachmentExtraction: 1 });
    expect(res.filesRemoved).toBe(3);
    expect(order.indexOf("file:obj-1")).toBeLessThan(order.indexOf("row:f1"));
    expect(order.indexOf("file:obj-3")).toBeLessThan(order.indexOf("row:x1"));
    expect(gw.rows("Operation").map((r) => r.ItemId)).toEqual(["o1"]);
    expect(gw.rows("Clarification").map((r) => r.ItemId)).toEqual(["c1"]);
  });

  it("reports the projects the purge could not finish now", async () => {
    const plan = await planOrphans(tenant({ Project: PROJECTS }));
    const res = await applyOrphans(plan, {
      raw: memoryGateway({ validate: false }),
      async removeFile() { throw new Error("no file to remove"); },
      async purgeTick() { return { picked: 0, finished: [], pending: [], failed: [], nextDueMs: 2000 }; },
    });
    expect(res.purgeLeft).toEqual(["p2"]);
    expect(res.removed).toEqual({});
  });
});

describe("sdkListAll", () => {
  type Page = { items: Row[]; totalCount: number };
  const fake = (pages: Record<string, (pageNo: number, sort: unknown) => Page | "missing">) =>
    async () => ({
      data: {
        collection: (schema: string) => ({
          async list(o: { pageNo: number; sort: unknown }) {
            const p = pages[schema]?.(o.pageNo, o.sort);
            if (!p || p === "missing") throw Object.assign(new Error("Blocks API 400"), { status: 400, body: `{"errors":[{"message":"Field \`get${schema}s\` does not exist on type \`Query\`"}]}` });
            return { data: { [`get${schema}s`]: p } };
          },
        }),
      },
    }) as unknown as SdkClient;

  it("pages by the stored key, de-duplicates and answers null for a schema the tenant does not have", async () => {
    const sorts: unknown[] = [];
    const rows = Array.from({ length: 150 }, (_, i) => ({ ItemId: `r${i}` }));
    const listAll = sdkListAll(fake({
      Ticket: (pageNo, sort) => { sorts.push(sort); return { items: rows.slice((pageNo - 1) * 100, pageNo * 100), totalCount: 150 }; },
    }), async () => undefined);
    expect((await listAll("Ticket", ["ProjectId"]))!.length).toBe(150);
    expect(sorts).toEqual([{ _id: 1 }, { _id: 1 }]);
    expect(await listAll("PlanningJob", ["ProjectId"])).toBeNull();
  });

  it("refuses a short read", async () => {
    const listAll = sdkListAll(fake({
      Ticket: () => ({ items: Array.from({ length: 100 }, (_, i) => ({ ItemId: `r${i}` })), totalCount: 150 }),
    }), async () => undefined);
    await expect(listAll("Ticket", ["ProjectId"])).rejects.toThrow(/short read/);
  });
});

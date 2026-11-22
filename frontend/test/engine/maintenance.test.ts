import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_MAINTENANCE_ACTIVE, HOST_MAINTENANCE_KIND, isEngineJobKind, isHostMaintenance, type EngineJobKind } from "../../src/domain/engineJob";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { acceptsWorkerJob, workerJobScope } from "../../server/blocks/engineWorker/jobScope";
import { ensureDailySkillsSync } from "../../server/blocks/engineWorker/dailySync";
import { makeWorld } from "./harness.ts";

describe("engine.skills-sync maintenance", () => {
  it("recognizes engine.skills-sync as an engine job kind", () => {
    expect(isEngineJobKind("engine.skills-sync")).toBe(true);
  });

  it("treats exactly the skills-sync kind as host maintenance, whatever holds the job row", () => {
    expect(isHostMaintenance("engine.skills-sync")).toBe(true);
    expect(isHostMaintenance("design.generate")).toBe(false);
    expect(isHostMaintenance("engine.unknown")).toBe(false);
    expect(isHostMaintenance(undefined)).toBe(false);
  });

  it("resolves the maintenance writer for engine.skills-sync", async () => {
    const writer = await writerOf("engine.skills-sync" as EngineJobKind);
    expect(typeof writer).toBe("function");
  });

  it("accepts the host-maintenance job on any project, kind or design-workflow scope while the host is ready", () => {
    const scope = workerJobScope({ MF_ENGINE_PROJECT_IDS: "some-project-id", MF_ENGINE_JOB_KINDS: "design.generate" });
    expect(acceptsWorkerJob(scope, { Kind: "engine.skills-sync" as never, ProjectId: "system" })).toBe(true);
    const factory = workerJobScope({ MF_ENGINE_DESIGN_WORKFLOW: "factory" });
    expect(acceptsWorkerJob(factory, { Kind: "engine.skills-sync" as never, ProjectId: "system" })).toBe(true);
  });

  it("refuses the host-maintenance job on a host that cannot run it (read-only, no engine home)", () => {
    const scope = workerJobScope({});
    expect(acceptsWorkerJob(scope, { Kind: "engine.skills-sync" as never, ProjectId: "system" }, false)).toBe(false);
    expect(acceptsWorkerJob(scope, { Kind: "engine.skills-sync" as never, ProjectId: "system" }, true)).toBe(true);
  });

  it("an operator-excluded kind stays excluded even for the host-maintenance job", () => {
    const scope = workerJobScope({ MF_ENGINE_EXCLUDED_JOB_KINDS: "engine.skills-sync" });
    expect(acceptsWorkerJob(scope, { Kind: "engine.skills-sync" as never, ProjectId: "system" })).toBe(false);
  });

  it("a host-maintenance job runs although no project row exists behind it (the system sentinel)", async () => {
    const calls: string[] = [];
    const world = await makeWorld({
      writers: async (kind) => kind === "engine.skills-sync"
        ? async (run) => { calls.push("synced"); await run.step(50, "Syncing Blocks skills."); return { message: "synced", outputs: [] }; }
        : writerOf(kind),
    });
    try {
      expect(world.store.get("Project", "system")).toBeUndefined();
      const res = await world.gw.insert("EngineJob", {
        ProjectId: "system", WorkspaceId: "system", Kind: "engine.skills-sync", Status: "queued",
        Progress: 0, Attempts: 0, Message: "", ActiveKey: HOST_MAINTENANCE_ACTIVE, InputJson: JSON.stringify({ force: true }),
        RequestKey: "engine.skills-sync:test",
      });
      if (!res.itemId) throw new Error("job not queued");
      await world.settle();
      const job = world.get("EngineJob", String(res.itemId));
      expect(job.Status).toBe("succeeded");
      expect(calls).toEqual(["synced"]);
    } finally {
      world.close();
    }
  });

  it("via the engine, one daily maintenance job when the kind has nothing active and the last is older than the interval", async () => {
    const now = new Date("2026-11-08T12:00:00.000Z");
    const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    const rows: Record<string, unknown>[] = [];
    const logs: string[] = [];
    let active: unknown[] = [];
    let past: unknown[] = [];
    let refused = false;
    let insertError: Error | null = null;
    const raw = {
      async find(_schema: string, q: { fields?: unknown }) {
        // the active read reads only ItemId; the most-recent read reads Status and CreatedDate
        const fields = Array.isArray(q.fields) ? (q.fields as string[]) : [];
        return { items: fields[0] === "ItemId" ? active : past } as never;
      },
      async insert(_schema: string, row: Record<string, unknown>) {
        if (insertError) throw insertError;
        if (refused) return { created: false, itemId: "22222222-2222-4222-8222-222222222222" } as never;
        rows.push(row);
        return { created: true, itemId: "11111111-1111-4111-8111-111111111111" } as never;
      },
    };
    const run = () => ensureDailySkillsSync(raw as never, { now: () => now, intervalHours: 24, log: (l) => logs.push(l) });

    past = [{ Status: "succeeded", CreatedDate: at(6) }];
    await run();
    expect(rows).toHaveLength(0);
    past = [{ Status: "succeeded", CreatedDate: at(25) }];
    await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Kind: "engine.skills-sync", Status: "queued", ActiveKey: "engine.skills-sync:global",
      ProjectId: "system", WorkspaceId: "system",
    });
    expect(String(rows[0]!.RequestKey)).toContain("engine.skills-sync:");
    // a failure older than four hours pulls the retry forward; a fresh failure waits for the day
    past = [{ Status: "failed", CreatedDate: at(20) }];
    await run();
    expect(rows).toHaveLength(2);
    past = [{ Status: "failed", CreatedDate: at(2) }];
    await run();
    expect(rows).toHaveLength(2);
    // an active job stops a second queue
    active = [{ ItemId: "j1" }];
    rows.length = 0;
    await run();
    expect(rows).toHaveLength(0);
    // the index race (this worker or the Blocks cron got the row in first): a success either way
    active = []; refused = true;
    past = [{ Status: "succeeded", CreatedDate: at(30) }];
    await run();
    expect(logs.at(-1)).toContain("already in the queue");
    insertError = new Error("The ActiveKey value is already taken by another row");
    await run();
    expect(logs.at(-1)).toContain("already in the queue");
  });

  it("validates the sync-skills-daily workflow JSON structure", () => {
    const workflowPath = path.resolve(__dirname, "../../blocks/logic/workflows/sync-skills-daily.json");
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
    expect(content.name).toBe("sync-skills-daily");
    expect(content.nodes).toHaveLength(3);

    const scheduleNode = content.nodes.find((n: { type: string }) => n.type === "schedule");
    expect(scheduleNode).toBeDefined();
    expect(scheduleNode.parameters.triggerInterval).toBe("custom");
    expect(scheduleNode.parameters.cronExpression).toBe("0 3 * * *");

    // the Data Gateway needs a RequestKey on every insert; the per-day key makes a same-day re-run idempotent
    const keyNode = content.nodes.find((n: { id: string }) => n.id === "n2");
    expect(keyNode).toBeDefined();
    expect(keyNode.type).toBe("code");
    expect(keyNode.parameters.mode).toBe("each");
    expect(keyNode.parameters.language).toBe("js");
    expect(keyNode.parameters.script).toContain("toISOString");
    expect(keyNode.parameters.script).toContain("sync-skills-daily:");

    const dataNode = content.nodes.find((n: { type: string }) => n.type === "dataAction");
    expect(dataNode).toBeDefined();
    expect(dataNode.parameters.actionType).toBe("insertData");
    expect(dataNode.parameters.collectionName).toBe("blx_EngineJobs");
    expect(dataNode.parameters.authenticationType).toBe("blocksAuthentication");
    expect(dataNode.parameters.fieldMapping.Kind).toBe(HOST_MAINTENANCE_KIND);
    expect(dataNode.parameters.fieldMapping.ActiveKey).toBe(HOST_MAINTENANCE_ACTIVE);
    expect(dataNode.parameters.fieldMapping.Status).toBe("queued");
    expect(dataNode.parameters.fieldMapping.ProjectId).toBe("system");
    expect(dataNode.parameters.fieldMapping.RequestKey).toBe('{{$node["Daily Job Key"].json.output.RequestKey}}');

    const edges = content.edges as Array<{ source: string; target: string; sourceHandle: string; targetHandle: string }>;
    expect(edges).toContainEqual({ id: "xy-edge__n1-n2", source: "n1", target: "n2", sourceHandle: "source", targetHandle: "target" });
    expect(edges).toContainEqual({ id: "xy-edge__n2-n3", source: "n2", target: "n3", sourceHandle: "source", targetHandle: "target" });
  });
});

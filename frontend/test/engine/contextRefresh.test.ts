// The Blocks worker's periodic context refresh (server/blocks/engineWorker/contextRefresh.ts): only active projects,
// never one with a job running, a light read after the first full one, and an answer dropped when a job started meanwhile.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/contextRefresh.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { USER_SCHEMAS, createContextRefresher } from "../../server/blocks/engineWorker/contextRefresh.ts";
import type { GatewayStore } from "../../server/blocks/engineWorker/store.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-refresh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the periodic context refresh", () => {
  it("reads the active projects only, skips a busy one, reads lightly after the first time", async () => {
    const now = Date.parse("2026-10-31T13:00:00Z");
    const jobs: Row[] = [
      { ProjectId: "p1", WorkspaceId: "w1", CreatedDate: "2026-10-31T12:50:00Z" },
      { ProjectId: "p2", WorkspaceId: "w1", CreatedDate: "2026-10-31T12:40:00Z" },
      { ProjectId: "old", WorkspaceId: "w1", CreatedDate: "2026-10-30T08:00:00Z" },
    ];
    const loads: { id: string; only: boolean }[] = [];
    const store = {
      get: (schema: string, id: string) => (schema === "EngineJob" && id === "j2" ? { ItemId: "j2", ProjectId: "p2" } : schema === "Project" ? { ItemId: id, WorkspaceId: "w1" } : undefined),
      async loadProject(id: string, _keep: unknown, hint?: { only?: readonly string[] }) {
        loads.push({ id, only: Boolean(hint?.only) });
        return true;
      },
    } as unknown as GatewayStore;
    const raw = { find: async () => ({ items: jobs, totalCount: jobs.length }) } as never;
    const lines: string[] = [];
    const r = createContextRefresher({ store, raw, root, readFile: async () => null, working: () => ["j2"], log: (l) => lines.push(l), now: () => now });
    await r.tick();
    await r.tick();
    expect(loads).toEqual([{ id: "p1", only: false }, { id: "p1", only: true }]);
    expect(USER_SCHEMAS).toEqual(expect.arrayContaining(["Clarification", "ScopeVersion", "Milestone", "AgentChatMessage", "DocFile", "ApprovalStep"]));
    expect(lines.filter((l) => /failed/.test(l))).toEqual([]);
  });

  it("drops an answer when a job of the project started meanwhile", async () => {
    let busy: string[] = [];
    const store = {
      get: (schema: string, id: string) => (schema === "EngineJob" && id === "j9" ? { ItemId: "j9", ProjectId: "p1" } : undefined),
      async loadProject(_id: string, _keep: unknown, hint?: { dropIf?: () => boolean }) {
        busy = ["j9"]; // the job is claimed while the read is under way
        return !hint?.dropIf?.();
      },
    } as unknown as GatewayStore;
    const r = createContextRefresher({ store, raw: { find: async () => ({ items: [], totalCount: 0 }) } as never, root, readFile: async () => null, working: () => busy, log: () => undefined });
    expect(await r.refreshOne("p1", "w1")).toBeNull();
  });
});

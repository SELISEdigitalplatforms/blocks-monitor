import { describe, expect, it, vi } from "vitest";
import { HEARTBEAT_MIN_GAP_MS, JobRun, type RunDeps } from "../../server/local/engine/run";
import { JOB_CLAIM_LEASE_MS, JOB_HEARTBEAT_MS } from "../../src/domain/engineJob";
import type { Row } from "../../functions/_lib/gateway";

describe("engine lease heartbeat", () => {
  it("keeps the latest progress and message while refreshing the lease", async () => {
    const job: Row = { ItemId: "job-1", ProjectId: "p1", WorkspaceId: "w1", Kind: "design.generate", Status: "running", Attempts: 1, Progress: 0 };
    const project: Row = { ItemId: "p1", WorkspaceId: "w1", Name: "Prototype" };
    const update = vi.fn(async (_schema: string, _id: string, patch: Row) => { Object.assign(job, patch); });
    const deps = { store: { get: (schema: string) => schema === "EngineJob" ? job : project, rows: () => [] },
      gateway: { update }, now: () => new Date("2026-11-02T10:00:00Z"), config: () => ({ enabled: true, pace: 1, sendBacks: false }),
      log: () => {}, sleep: async () => {}, backgroundProgress: true } as unknown as RunDeps;
    const run = new JobRun(deps, job, new AbortController().signal);
    await run.step(25, "Importing the prototype.");
    await run.heartbeat();
    await run.flush();
    expect(job).toMatchObject({ Progress: 25, Message: "Importing the prototype." });
    expect(update.mock.calls.at(-1)?.[2].Progress).toBe(25);
    job.Status = "cancelled";
    await expect(run.heartbeat()).rejects.toMatchObject({ name: "JobGone" });
  });

  it("writes the lease once per ~30 s however many beats ask (the job's 30 s beat and a lane's 20 s beat)", async () => {
    const job: Row = { ItemId: "job-2", ProjectId: "p1", WorkspaceId: "w1", Kind: "build.run", Status: "running", Attempts: 1, Progress: 10 };
    const project: Row = { ItemId: "p1", WorkspaceId: "w1", Name: "Prototype" };
    let t = Date.parse("2026-11-09T10:00:00Z");
    const writes: number[] = [];
    const update = vi.fn(async (_schema: string, _id: string, patch: Row) => { writes.push(t); Object.assign(job, patch); });
    const deps = { store: { get: (schema: string) => schema === "EngineJob" ? job : project, rows: () => [] },
      gateway: { update }, now: () => new Date(t), config: () => ({ enabled: true, pace: 1, sendBacks: false }),
      log: () => {}, sleep: async () => {}, backgroundProgress: true } as unknown as RunDeps;
    const run = new JobRun(deps, job, new AbortController().signal);
    const start = t;
    // ten minutes: the job's beat every 30 s, a lane's beat every 20 s, and a progress line now and then
    for (let s = 1; s <= 600; s++) {
      t = start + s * 1000;
      if (s % (JOB_HEARTBEAT_MS / 1000) === 0) await run.heartbeat();
      if (s % 20 === 0) await run.heartbeat();
      if (s % 170 === 0) await run.step(10 + s / 10, "A lane step.");
      await run.flush();
    }
    // before: 30 + 20 beats plus 3 lines = 53 writes; now about one per 30 s
    expect(writes.length).toBeLessThanOrEqual(25);
    expect(writes.length).toBeGreaterThanOrEqual(15);
    // the claim lease never runs out: no gap between writes comes near it
    const gaps = writes.map((w, i) => w - (i === 0 ? start : writes[i - 1]!));
    expect(Math.max(...gaps)).toBeLessThan(JOB_CLAIM_LEASE_MS / 2);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(HEARTBEAT_MIN_GAP_MS + JOB_HEARTBEAT_MS);
  });

  it("a beat after a failed write writes again (a failure does not count as the lease)", async () => {
    const job: Row = { ItemId: "job-3", ProjectId: "p1", WorkspaceId: "w1", Kind: "build.run", Status: "running", Attempts: 1, Progress: 10 };
    const project: Row = { ItemId: "p1", WorkspaceId: "w1", Name: "Prototype" };
    let fail = true;
    const update = vi.fn(async () => { if (fail) throw new Error("gateway busy"); });
    const deps = { store: { get: (schema: string) => schema === "EngineJob" ? job : project, rows: () => [] },
      gateway: { update }, now: () => new Date("2026-11-09T10:00:00Z"), config: () => ({ enabled: true, pace: 1, sendBacks: false }),
      log: () => {}, sleep: async () => {}, backgroundProgress: true } as unknown as RunDeps;
    const run = new JobRun(deps, job, new AbortController().signal);
    await run.heartbeat();
    await run.flush();
    fail = false;
    await run.heartbeat();
    await run.flush();
    expect(update).toHaveBeenCalledTimes(2);
    await run.heartbeat();
    await run.flush();
    expect(update).toHaveBeenCalledTimes(2);
  });
});


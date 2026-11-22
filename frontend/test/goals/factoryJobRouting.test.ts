import { describe, expect, it, vi } from "vitest";
import { createJobs, type JobsOptions } from "../../functions/_lib/jobs";

function jobs(workerId?: string, routes: Partial<JobsOptions> = {}) {
  const insert = vi.fn().mockResolvedValue({ created: true, itemId: "j1" });
  const service = createJobs({ gw: { insert } as any, raw: {} as any, ids: { job: () => "request1" } as any,
    caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T09:00:00Z"), verifiedProjectId: "p1", factoryDesignWorkerId: workerId, ...routes });
  return { service, insert };
}
describe("Factory design routing", () => {
  it('routes native designs and extraction independently without browser-controlled identities', async () => {
    const { service } = jobs('legacy-worker', { figmaDesignWorkerId: 'figma-cloud', extractionWorkerId: 'extractor-cloud' });
    expect((await service.create({ kind: 'design.generate', projectId: 'p1', input: { workflow: 'screens', claimedBy: 'browser-choice' } })).job.ClaimedBy).toBe('figma-cloud');
    expect((await service.create({ kind: 'file.extract', projectId: 'p1', input: {} })).job.ClaimedBy).toBe('extractor-cloud');
    expect((await service.create({ kind: 'design.generate', projectId: 'p1', input: { workflow: 'factory' } })).job.ClaimedBy).toBe('legacy-worker');
  });
  it('does not redirect extraction to a native-design-only route', async () => {
    const { service } = jobs(undefined, { figmaDesignWorkerId: 'figma-cloud' });
    const result = await service.create({ kind: 'file.extract', projectId: 'p1', input: {} });
    expect(result.job.Status).toBe('queued');
    expect(result.job.ClaimedBy).toBeUndefined();
  });
  it("inserts already assigned to the upgraded worker, never briefly queued for a screenshot-era worker", async () => {
    const { service, insert } = jobs("upgraded-worker");
    const result = await service.create({ kind: "design.generate", projectId: "p1", input: { workflow: "factory", claimedBy: "browser-cannot-choose" }, targetId: "b1" });
    expect(result.job).toMatchObject({ Status: "claimed", ClaimedBy: "upgraded-worker", Attempts: 1, ClaimedAt: "2026-11-02T09:00:00.000Z" });
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("fails closed before inserting if the Factory worker route has not been configured", async () => {
    const { service, insert } = jobs();
    await expect(service.create({ kind: "design.generate", projectId: "p1", input: { workflow: "factory" } })).rejects.toMatchObject({ code: "not_configured" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("leaves other job kinds on the normal queue", async () => {
    const { service } = jobs("upgraded-worker");
    expect((await service.create({ kind: "requirements.draft", projectId: "p1", input: {} })).job.Status).toBe("queued");
  });
});

describe("Job cancellation lifecycle", () => {
  it("cancels a queued design job immediately", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ matched: 1 });
    const service = createJobs({
      gw: { update, updateMany, get: vi.fn() } as any, raw: {} as any, ids: { job: () => "j1" } as any,
      caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T10:00:00Z"), verifiedProjectId: "p1",
    });
    const job = { ItemId: "j1", Kind: "design.generate", Status: "queued", Attempts: 0, ActiveKey: "k1" };
    const res = await service.cancel("j1", { actor: "user", row: job });
    expect(res.Status).toBe("cancelled");
    expect(res.ActiveKey).toBe("j1");
    expect(updateMany).toHaveBeenCalledWith("EngineJob", expect.anything(), expect.objectContaining({ Status: "cancelled" }));
  });

  it("requests stop for a running design job without marking it cancelled or releasing ActiveKey", async () => {
    const updateMany = vi.fn().mockResolvedValue({ matched: 1 });
    const service = createJobs({
      gw: { update: vi.fn(), updateMany, get: vi.fn() } as any, raw: {} as any, ids: { job: () => "j1" } as any,
      caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T10:00:00Z"), verifiedProjectId: "p1",
    });
    const job = { ItemId: "j1", Kind: "design.generate", Status: "running", Attempts: 1, ActiveKey: "k1" };
    const res = await service.cancel("j1", { actor: "user", row: job });
    expect(res.Status).toBe("running");
    expect(res.ErrorCode).toBe("design.stopRequested");
    expect(res.ActiveKey).toBe("k1");
    expect(updateMany).toHaveBeenCalledWith("EngineJob", expect.anything(), {
      ErrorCode: "design.stopRequested",
      Message: "Stop requested. Waiting for the design runner to exit.",
    });
  });

  it("is idempotent when a stop was already requested or job already cancelled", async () => {
    const updateMany = vi.fn();
    const service = createJobs({
      gw: { update: vi.fn(), updateMany, get: vi.fn() } as any, raw: {} as any, ids: { job: () => "j1" } as any,
      caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T10:00:00Z"), verifiedProjectId: "p1",
    });
    const stopPending = { ItemId: "j1", Kind: "design.generate", Status: "running", ErrorCode: "design.stopRequested" };
    expect(await service.cancel("j1", { actor: "user", row: stopPending })).toEqual(stopPending);

    const alreadyCancelled = { ItemId: "j1", Kind: "design.generate", Status: "cancelled" };
    expect(await service.cancel("j1", { actor: "user", row: alreadyCancelled })).toEqual(alreadyCancelled);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("handles completion race when conditional update matches 0 rows", async () => {
    const get = vi.fn().mockResolvedValue({ ItemId: "j1", Kind: "design.generate", Status: "succeeded" });
    const updateMany = vi.fn().mockResolvedValue({ matched: 0 });
    const service = createJobs({
      gw: { update: vi.fn(), updateMany, get } as any, raw: {} as any, ids: { job: () => "j1" } as any,
      caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T10:00:00Z"), verifiedProjectId: "p1",
    });
    const job = { ItemId: "j1", Kind: "design.generate", Status: "running", Attempts: 1 };
    await expect(service.cancel("j1", { actor: "user", row: job })).rejects.toMatchObject({ code: "conflict" });
  });

  it("cancels a non-design running job immediately", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const service = createJobs({
      gw: { update, get: vi.fn() } as any, raw: {} as any, ids: { job: () => "j1" } as any,
      caller: { userId: "u1" }, workspaceId: "w1", now: () => new Date("2026-11-02T10:00:00Z"), verifiedProjectId: "p1",
    });
    const job = { ItemId: "j1", Kind: "wiki.generate", Status: "running", Attempts: 1, ActiveKey: "k1" };
    const res = await service.cancel("j1", { actor: "user", row: job });
    expect(res.Status).toBe("cancelled");
    expect(res.ActiveKey).toBe("j1");
    expect(update).toHaveBeenCalledWith("EngineJob", "j1", expect.objectContaining({ Status: "cancelled" }));
  });
});

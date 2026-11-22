// project.documentExisting queues product.document (a live product documented from its code and documents) only for an
// existing product that is live, only for people who may edit the business context, and never twice at once.
//   npx vitest run --config test/project/vitest.config.ts test/project/documentExistingOp.test.ts
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { DOCUMENT_EXISTING_OPS } from "../../functions/project/ops/liveProduct/documentExisting";
import { DOCUMENT_JOB_KIND, DOCUMENT_OP } from "../../src/domain/liveProduct";
import { JOB_PAUSE_PERMISSION } from "../../src/components/project/leaveGuard";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };
const OWNER = { userId: "owner-1", email: "reto.arnold@selisegroup.com" };

function setup(o: { repoMode?: string; stage?: string; release?: "released" | "failed" | null } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }, { ...OWNER, roleKey: "owner" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, RepoMode: o.repoMode ?? "existing", Stage: o.stage ?? "release" });
  const stamp = { WorkspaceId: workspaceId, ReaderIds: [ME.userId, VIEWER.userId, OWNER.userId], ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
  const release = o.release === undefined ? "released" : o.release;
  if (release) seedRow(gateway, "Release", { ...stamp, Environment: "dev", Version: "0.1.0", Url: "https://dev.example.test", Status: release, ChangeRequestIds: [], ReleasedByUserId: ME.userId, EngineJobId: "" });
  const call = (who: { userId: string; email: string } = ME) =>
    runOp("project", DOCUMENT_EXISTING_OPS, { ctx: fakeCtx(who), gateway, request: { op: DOCUMENT_OP, args: { projectId } } });
  const jobs = () => gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId && j.Kind === DOCUMENT_JOB_KIND);
  return { gateway, projectId, call, jobs };
}

describe("project.documentExisting", () => {
  it("queues one product.document job for a live existing product, and answers the running one on a repeat", async () => {
    const t = setup();
    const res = await t.call();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(t.jobs()).toHaveLength(1);
    expect(t.jobs()[0]).toMatchObject({ Status: "queued", RequestedByUserId: ME.userId, ActiveKey: `${DOCUMENT_JOB_KIND}:project` });
    expect(JSON.parse(String(t.jobs()[0]!.InputJson))).toEqual({ projectId: t.projectId });
    expect(res.body.data.jobId).toBe(t.jobs()[0]!.ItemId);
    const again = await t.call(OWNER);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ jobId: res.body.data.jobId, existing: true });
    expect(t.jobs()).toHaveLength(1);
    // once it has finished, it can run again to refresh
    const done = t.jobs()[0]!;
    await t.gateway.update("EngineJob", String(done.ItemId), { Status: "succeeded", ActiveKey: String(done.ItemId) });
    expect((await t.call()).status).toBe(200);
    expect(t.jobs()).toHaveLength(2);
  });

  it("is refused to people who may not edit the business context", async () => {
    const t = setup();
    expect((await t.call(VIEWER)).status).toBe(403);
    expect(t.jobs()).toEqual([]);
  });

  it("is refused for a product that is new, not live yet, or paused", async () => {
    for (const [o, key] of [
      [{ repoMode: "new" }, "liveProduct.notExisting"],
      [{ release: null }, "liveProduct.notLive"],
      [{ release: "failed" as const }, "liveProduct.notLive"],
      [{ stage: "paused" }, "liveProduct.paused"],
    ] as const) {
      const t = setup(o);
      const res = await t.call();
      expect(res.status, JSON.stringify(o)).toBe(409);
      expect(JSON.stringify(res.body)).toContain(key);
      expect(t.jobs()).toEqual([]);
    }
  });

  it("lets the same people stop and start the work again as the server does", () => {
    expect(JOB_PAUSE_PERMISSION[DOCUMENT_JOB_KIND]).toEqual(["business.edit"]);
  });
});

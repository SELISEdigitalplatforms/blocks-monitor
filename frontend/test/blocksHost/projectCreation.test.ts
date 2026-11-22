import { describe, expect, it, vi } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { OpError } from "../../functions/_lib/errors";

describe("IAM-backed project creation", () => {
  const member = { userId: "iam-member", email: "member@selisegroup.com" };

  it('preserves recognized repository errors across the host module boundary', async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: 'member' }] });
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: 'iam' };
    ctx.platformCtx.verifyRepository = async () => { throw { code: 'conflict', message: 'conflict', messageKey: 'project.repoNameTaken' }; };
    const result = await runOp('project', PROJECT_OPS, { ctx, gateway, request: { op: 'project.create', args: {
      workspaceId, name: 'Prepared project', repo: 'example/product', repoBranch: 'main',
    } } });
    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({ code: 'conflict', messageKey: 'project.repoNameTaken' });
    expect(gateway.rows('Project')).toHaveLength(0);
  });

  it("creates the GitHub repository from the project name before saving its Gateway details", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    const verify = vi.fn(async () => { expect(gateway.rows("Project")).toHaveLength(0); });
    ctx.platformCtx.verifyRepository = verify;
    const result = await runOp("project", PROJECT_OPS, { ctx, gateway, request: { op: "project.create", args: {
      workspaceId, name: "My Project Name", newRepoOwner: "example", newRepoName: "ignored-name", repoVisibility: "private",
    } } });
    expect(result.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(member.userId, expect.objectContaining({ name: "my-project-name", kind: "new" }), expect.any(String));
    expect(gateway.rows("Project")[0]).toMatchObject({ RepoOwner: "example", RepoName: "my-project-name", RepoBranch: "main", RepoVisibility: "private" });
  });

  it("does not save a project when GitHub repository creation fails", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    ctx.platformCtx.verifyRepository = async () => { throw new OpError("conflict"); };
    const result = await runOp("project", PROJECT_OPS, { ctx, gateway, request: { op: "project.create", args: {
      workspaceId, name: "My Project", newRepoOwner: "example", newRepoName: "my-project", repoVisibility: "private",
    } } });
    expect(result.status).not.toBe(200);
    expect(gateway.rows("Project")).toHaveLength(0);
  });

  it("creates a cloud project without a repository: MADP Factory keeps the code, GitHub is not asked", async () => {
    for (const projectType of ["greenfield", "brownfield"]) {
      const gateway = memoryGateway();
      const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
      const ctx = fakeCtx(member);
      ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
      ctx.platformCtx.verifyRepository = vi.fn(async () => undefined);
      const result = await runOp("project", PROJECT_OPS, { ctx, gateway, request: { op: "project.create", args: { workspaceId, name: "No repository", projectType } } });
      expect(result.status, projectType).toBe(200);
      expect(gateway.rows("Project")).toHaveLength(1);
      expect(gateway.rows("Project")[0]).toMatchObject({ Name: "No repository", RepoProvider: "factory", Stage: "business" });
      expect(gateway.rows("Project")[0].RepoOwner ?? "").toBe("");
      expect(ctx.platformCtx.verifyRepository).not.toHaveBeenCalled();
    }
  });

  it("creates a cloud project without a repository even when GitHub is not set up on the host", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    const result = await runOp("project", PROJECT_OPS, { ctx, gateway, request: { op: "project.create", args: {
      workspaceId, name: "Marketplace", projectType: "greenfield", description: "A place to sell digital assets.", goal: "Sell online",
      targetUsers: "Creators", setupStatus: "draft", setupAnswers: JSON.stringify({ v: 1, kind: "new", repoChoice: "factory" }),
    } } });
    expect(result.status).toBe(200);
    expect(result.body.data.project).toMatchObject({ Name: "Marketplace", RepoProvider: "factory", RepoMode: "new" });
  });

  it("creates with verified IAM identity and no active Account mirror, preserving repository and queuing a server-owned tenant", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const account = gateway.rows("Account")[0];
    await gateway.update("Account", account.ItemId as string, { Status: "deactivated" });
    gateway.calls.length = 0;
    const ctx = fakeCtx(member);
    ctx.platformCtx.verifyRepository = async () => undefined;
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    const result = await runOp("project", PROJECT_OPS, {
      ctx, gateway,
      request: { op: "project.create", args: {
        workspaceId, name: "IAM project", repo: "example/product", repoBranch: "main",
        blocksProjectRef: "verified-tenant-reference",
      } },
    });
    expect(result.status).toBe(200);
    expect(result.body.data.project).toMatchObject({
      Name: "IAM project", WorkspaceId: workspaceId,
      RepoProvider: "github", RepoOwner: "example", RepoName: "product", RepoBranch: "main",
      BlocksProvisioningStatus: "pending", CreatedByUserId: member.userId,
    });
    expect(result.body.data.project.BlocksProjectRef).toBeUndefined();
    expect(gateway.calls.filter((call) => call.schema === "Account")).toEqual([]);

    const projectId = result.body.data.project.ItemId;
    await gateway.update("Project", projectId, { BlocksProjectRef: "operator-owned-tenant", BlocksProvisioningStatus: "ready" });
    const saved = await runOp("project", PROJECT_OPS, {
      ctx, gateway, request: { op: "project.setup", args: {
        projectId, description: "", goal: "A goal", targetUsers: "Users", setupAnswers: "{}", blocksProjectRef: "",
      } },
    });
    expect(saved.status).toBe(200);
    expect(gateway.rows("Project").find((row) => row.ItemId === projectId)?.BlocksProjectRef).toBe("operator-owned-tenant");
  });

  it("does not allow IAM identity to bypass workspace membership", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const ctx = fakeCtx({ userId: "outsider" });
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    const result = await runOp("project", PROJECT_OPS, {
      ctx, gateway, request: { op: "project.create", args: { workspaceId, name: "Denied" } },
    });
    expect(result.body.ok).toBe(false);
    expect(result.status).not.toBe(200);
  });

  it("recovers the same wizard submission after a brief-note failure without duplicating the project or brief", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "member" }] });
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...ctx.platformCtx.context as Record<string, unknown>, identitySource: "iam" };
    ctx.platformCtx.verifyRepository = async () => undefined;
    const request = { op: "project.create", requestId: "e2429b91-3b04-4a74-b238-76612d6e404e", args: {
      workspaceId, name: "Wizard recovery", projectType: "greenfield", description: "Track internal tasks.",
      newRepoOwner: "example", newRepoName: "wizard-recovery", repoVisibility: "private",
      goal: "Track task progress", targetUsers: "Workspace members", setupStatus: "draft",
      setupAnswers: JSON.stringify({ v: 1, kind: "new", name: "Wizard recovery", description: "Track internal tasks.", repoChoice: "create" }),
    } };
    gateway.failNext("insert", new OpError("internal"), { schema: "DocNote" });
    const first = await runOp("project", PROJECT_OPS, { ctx, gateway, request });
    expect(first.body.ok).toBe(false);
    expect(gateway.rows("Project")).toHaveLength(1);
    const projectId = gateway.rows("Project")[0].ItemId;
    const retry = await runOp("project", PROJECT_OPS, { ctx, gateway, request });
    expect(retry.status).toBe(200);
    expect(retry.body.data.project.ItemId).toBe(projectId);
    expect(gateway.rows("Project")).toHaveLength(1);
    const briefs = gateway.rows("DocNote").filter((row) => row.IsProjectBrief === true);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ ProjectId: projectId, Title: "Project brief" });
    expect(briefs[0].BodyMd).toContain("Track internal tasks.");
    expect(briefs[0].BodyMd).toContain("Track task progress");
  });
});

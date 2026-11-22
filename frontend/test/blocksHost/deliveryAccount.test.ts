import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedWorkspace } from "../../functions/_lib/testing";
import { deliveryBoundOps } from "../../functions/delivery/ops/bind";

// Blocks (IAM) sign-ins have no Account mirror row: the host verified the token live with IAM (which refuses an
// inactive user, see iam.test.ts), so delivery ops must see an active account, as the workspace and project ops do.
describe("delivery ops and the caller's account", () => {
  const member = { userId: "iam-owner", email: "owner@example.com" };
  const setup = () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "owner" }] });
    const { projectId } = seedProject(gateway, { workspaceId, Stage: "build" });
    for (const a of gateway.rows("Account")) void gateway.remove("Account", a.ItemId as string);
    return { gateway, projectId };
  };
  const feedback = (projectId: string) => ({ op: "milestone.feedback", args: { projectId, milestoneId: "no-such-milestone", text: "It works." } });

  it("accepts a verified IAM caller without an Account row (the op runs and answers on its own terms)", async () => {
    const { gateway, projectId } = setup();
    const ctx = fakeCtx(member);
    ctx.platformCtx.context = { ...(ctx.platformCtx.context as Record<string, unknown>), identitySource: "iam" };
    const result = await runOp("delivery", deliveryBoundOps, { ctx, gateway, request: feedback(projectId) });
    expect(result.body.error?.code).not.toBe("account_inactive");
    expect(result.body.error?.code).toBe("not_found");
  });

  it("still refuses a local sign-in without an active Account row", async () => {
    const { gateway, projectId } = setup();
    const result = await runOp("delivery", deliveryBoundOps, { ctx: fakeCtx(member), gateway, request: feedback(projectId) });
    expect(result.body.error?.code).toBe("account_inactive");
  });

  it("still refuses a local sign-in whose Account is deactivated", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...member, roleKey: "owner" }] });
    const { projectId } = seedProject(gateway, { workspaceId, Stage: "build" });
    await gateway.update("Account", gateway.rows("Account")[0].ItemId as string, { Status: "deactivated" });
    const result = await runOp("delivery", deliveryBoundOps, { ctx: fakeCtx(member), gateway, request: feedback(projectId) });
    expect(result.body.error?.code).toBe("account_inactive");
  });
});

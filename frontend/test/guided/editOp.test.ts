// project.update's repository rules for new and existing products: the parse rules, and runs through the real router.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { projectUpdate } from "../../functions/project/ops/projects/edit";
import { projectFromRow } from "../../src/blocks/projects/records";
import { repoKindOf, setupRepoChoice } from "../../src/components/business/NewRepositoryCard";

const parse = (args: Record<string, unknown>) => projectUpdate.parse({ projectId: "p-1", ...args }) as any;
const refused = (args: Record<string, unknown>) => {
  const r = parse(args);
  expect(r.ok).toBe(false);
  return r.messageKey as string;
};

describe("project.update parse: repositories", () => {
  it("an existing repository sets RepoExisting and clears the visibility (never null)", () => {
    expect(parse({ repo: "https://github.com/acme/landing.git", repoBranch: " develop " }).value).toEqual({
      projectId: "p-1",
      repo: "existing",
      patch: { RepoProvider: "github", RepoOwner: "acme", RepoName: "landing", RepoBranch: "develop", RepoExisting: "acme/landing", RepoVisibility: "" },
    });
    expect(refused({ repo: "acme/landing" })).toBe("project.branchInvalid");
    expect(refused({ repoBranch: "main" })).toBe("project.repoInvalid");
    expect(refused({ repo: "not a repo", repoBranch: "main" })).toBe("project.repoInvalid");
  });

  it("a new repository takes an optional branch (main by default) and clears RepoExisting", () => {
    expect(parse({ repoOwner: "acme", repoName: "cafe-shop", repoVisibility: "private" }).value).toEqual({
      projectId: "p-1",
      repo: "new",
      patch: { RepoProvider: "github", RepoOwner: "acme", RepoName: "cafe-shop", RepoVisibility: "private", RepoBranch: "main", RepoExisting: "" },
    });
    expect(parse({ repoOwner: "acme", repoName: "cafe-shop", repoVisibility: "internal", repoBranch: " trunk " }).value.patch)
      .toMatchObject({ RepoVisibility: "internal", RepoBranch: "trunk" });
    expect(parse({ repoOwner: "acme", repoName: "cafe-shop", repoVisibility: "private", repoBranch: "" }).value.patch.RepoBranch).toBe("main");
    expect(refused({ repoOwner: "acme", repoName: "cafe-shop", repoVisibility: "private", repoBranch: "bad branch" })).toBe("project.branchInvalid");
    expect(refused({ repoOwner: "acme", repoName: "x", repoVisibility: "public" })).toBe("project.repoVisibilityInvalid");
  });

  it("both kinds at once are refused; client fields alone touch no repository field", () => {
    expect(refused({ repo: "acme/a", repoBranch: "main", repoOwner: "acme", repoName: "b", repoVisibility: "private" })).toBe("project.repoMixed");
    expect(parse({ clientName: "Acme" }).value).toEqual({ projectId: "p-1", repo: null, patch: { ClientName: "Acme" } });
  });
});

describe("project.update run", () => {
  const ME = { userId: "member-1", email: "member@selisegroup.com" };
  const setup = (project: Record<string, unknown>) => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, ...project });
    const call = (args: Record<string, unknown>) =>
      runOp("project", PROJECT_OPS, { ctx: fakeCtx(ME), gateway, request: { op: "project.update", args: { projectId, ...args } } });
    const row = () => gateway.rows("Project").find((r) => r.ItemId === projectId)!;
    return { gateway, projectId, call, row };
  };
  const NEW_IN_EXISTING = { RepoMode: "new", RepoProvider: "github", RepoOwner: "acme", RepoName: "landing", RepoBranch: "main", RepoExisting: "acme/landing" };
  const NEW_IN_NEW = { RepoMode: "new", RepoProvider: "github", RepoOwner: "acme", RepoName: "cafe-shop", RepoBranch: "main", RepoVisibility: "private", RepoExisting: "" };

  it("a new product changes its existing repository and branch in the Business step", async () => {
    const { call, row } = setup({ ...NEW_IN_EXISTING, Stage: "business" });
    const res = await call({ repo: "acme/shop-v2", repoBranch: "develop" });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ RepoOwner: "acme", RepoName: "shop-v2", RepoBranch: "develop", RepoExisting: "acme/shop-v2", RepoVisibility: "" });
    expect(projectFromRow(res.body.data.project)).toMatchObject({ type: "greenfield", repoExisting: true, repoName: "shop-v2", repoBranch: "develop" });
  });

  it("a new product with no repository yet can pick an existing one", async () => {
    const { call, row } = setup({ RepoMode: "new", Stage: "business", SetupAnswers: '{"repoChoice":"existing"}' });
    expect((await call({ repo: "acme/landing", repoBranch: "main" })).status).toBe(200);
    expect(row()).toMatchObject({ RepoProvider: "github", RepoOwner: "acme", RepoName: "landing", RepoExisting: "acme/landing" });
  });

  it("the existing repository is fixed after the hand-over, for both kinds of product", async () => {
    for (const project of [{ ...NEW_IN_EXISTING, Stage: "sanitization" }, { RepoMode: "existing", RepoOwner: "acme", RepoName: "old", RepoBranch: "main", Stage: "requirements" }]) {
      const { call, row } = setup(project);
      const res = await call({ repo: "acme/other", repoBranch: "main" });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { messageKey: "project.repoLocked" } });
      expect(row().RepoName).toBe(project.RepoName);
    }
  });

  it("an existing product still changes its repository before the hand-over (and is marked RepoExisting)", async () => {
    const { call, row } = setup({ RepoMode: "existing", Stage: "business" });
    expect((await call({ repo: "acme/legacy", repoBranch: "release" })).status).toBe(200);
    expect(row()).toMatchObject({ RepoOwner: "acme", RepoName: "legacy", RepoBranch: "release", RepoExisting: "acme/legacy" });
  });

  it("a new product switches from an existing repository to a new one until the build starts", async () => {
    const { call, row } = setup({ ...NEW_IN_EXISTING, Stage: "sanitization" });
    expect((await call({ repoOwner: "acme", repoName: "cafe-shop", repoVisibility: "internal", repoBranch: "trunk" })).status).toBe(200);
    expect(row()).toMatchObject({ RepoOwner: "acme", RepoName: "cafe-shop", RepoVisibility: "internal", RepoBranch: "trunk", RepoExisting: "" });
  });

  it("a new product switches from a new repository to an existing one only in the Business step", async () => {
    const before = setup({ ...NEW_IN_NEW, Stage: "business" });
    expect((await before.call({ repo: "acme/landing", repoBranch: "main" })).status).toBe(200);
    expect(before.row()).toMatchObject({ RepoName: "landing", RepoExisting: "acme/landing", RepoVisibility: "" });

    const after = setup({ ...NEW_IN_NEW, Stage: "scope" });
    const res = await after.call({ repo: "acme/landing", repoBranch: "main" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { messageKey: "project.repoLocked" } });
    expect(after.row()).toMatchObject({ RepoName: "cafe-shop", RepoExisting: "" });
  });

  it("the new repository is fixed once the build starts, and never offered to an existing product", async () => {
    const built = setup({ ...NEW_IN_NEW, Stage: "build" });
    const res = await built.call({ repoOwner: "acme", repoName: "renamed", repoVisibility: "private" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { messageKey: "project.newRepoLocked" } });

    const existing = setup({ RepoMode: "existing", Stage: "business" });
    const r2 = await existing.call({ repoOwner: "acme", repoName: "x", repoVisibility: "private" });
    expect(r2.status).toBe(400);
    expect(r2.body).toMatchObject({ error: { messageKey: "project.notGreenfield" } });
  });

  it("an earlier new repository keeps a custom branch when renamed with it", async () => {
    const { call, row } = setup({ ...NEW_IN_NEW, RepoBranch: "develop", Stage: "business" });
    expect((await call({ repoOwner: "acme", repoName: "cafe-shop-2", repoVisibility: "private", repoBranch: "develop" })).status).toBe(200);
    expect(row()).toMatchObject({ RepoName: "cafe-shop-2", RepoBranch: "develop", RepoExisting: "" });
  });
});

describe("the Business card's repository kind", () => {
  const base = { repoOwner: "", repoName: "", repoBranch: "", repoExisting: false, setupAnswers: "" };
  it("follows the saved repository, else the guided start's choice, else a new repository", () => {
    expect(repoKindOf({ ...base, repoOwner: "acme", repoName: "landing", repoBranch: "main", repoExisting: true })).toEqual({ kind: "existing", saved: true });
    expect(repoKindOf({ ...base, repoOwner: "acme", repoName: "cafe", repoBranch: "main", setupAnswers: '{"repoChoice":"existing"}' })).toEqual({ kind: "create", saved: true });
    expect(repoKindOf({ ...base, setupAnswers: '{"v":1,"repoChoice":"existing"}' })).toEqual({ kind: "existing", saved: false });
    expect(repoKindOf({ ...base, setupAnswers: '{"repoChoice":"create"}' })).toEqual({ kind: "create", saved: false });
    expect(repoKindOf(base)).toEqual({ kind: "create", saved: false });
    for (const bad of ["{", "null", "[]", '{"repoChoice":"other"}']) expect(setupRepoChoice(bad), bad).toBeNull();
  });
});

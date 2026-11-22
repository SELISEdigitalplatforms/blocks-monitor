// project.create's guided-start fields and greenfield repositories: the parse rules, and one run through the real router.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { normaliseWebUrl, projectCreate } from "../../functions/project/ops/projects/create";
import { projectFromRow } from "../../src/blocks/projects/records";

const WS = "ws-1";
const parse = (args: Record<string, unknown>) => projectCreate.parse({ workspaceId: WS, ...args }) as any;
const refused = (args: Record<string, unknown>) => {
  const r = parse(args);
  expect(r.ok).toBe(false);
  return r.messageKey as string;
};

describe("project.create parse: unchanged without the new args", () => {
  it("a bare create has no repository and no guided fields", () => {
    const r = parse({});
    expect(r).toMatchObject({ ok: true, value: { type: "greenfield", repo: null, guided: {} } });
  });

  it("brownfield keeps repo + repoBranch, now marked existing", () => {
    const r = parse({ projectType: "brownfield", repo: "https://github.com/acme/shop.git", repoBranch: " develop " });
    expect(r.value.repo).toEqual({ kind: "existing", owner: "acme", name: "shop", branch: "develop" });
    expect(refused({ projectType: "brownfield", repo: "not a repo", repoBranch: "main" })).toBe("project.repoInvalid");
    expect(refused({ projectType: "brownfield", repo: "acme/shop", repoBranch: "a..b" })).toBe("project.branchInvalid");
  });

  it("unknown keys are still refused", () => {
    expect(refused({ goals: "x" })).toBe("input.unknownKey");
  });
});

describe("project.create parse: guided fields", () => {
  it("trims and keeps every field; empty strings are left out", () => {
    const r = parse({
      goal: "  Sell coffee online  ",
      targetUsers: "Café owners",
      appUrl: "app.example.com",
      testEnv: JSON.stringify({ available: "yes", url: "test.example.com", accessHow: "  ask Ana  " }),
      runInstructions: "npm ci && npm start",
      blocksProjectRef: " PRJ-42 ",
      setupAnswers: '{ "step1": { "a": 1 } }',
      setupStatus: "complete",
    });
    expect(r.ok).toBe(true);
    expect(r.value.guided).toEqual({
      goal: "Sell coffee online",
      targetUsers: "Café owners",
      appUrl: "https://app.example.com",
      testEnv: '{"available":"yes","url":"https://test.example.com","accessHow":"ask Ana"}',
      runInstructions: "npm ci && npm start",
      blocksProjectRef: "PRJ-42",
      setupAnswers: '{"step1":{"a":1}}',
      setupStatus: "complete",
    });
    expect(parse({ goal: "   ", appUrl: "", testEnv: "", setupAnswers: "" }).value.guided).toEqual({});
  });

  it("text limits count the trimmed text", () => {
    expect(parse({ goal: ` ${"g".repeat(2000)} ` }).ok).toBe(true);
    expect(parse({ goal: "g".repeat(2001) })).toMatchObject({ ok: false, messageKey: "project.textTooLong", params: { field: "goal", max: 2000 } });
    expect(refused({ targetUsers: "u".repeat(1001) })).toBe("project.textTooLong");
    expect(refused({ runInstructions: "r".repeat(5001) })).toBe("project.textTooLong");
    expect(refused({ blocksProjectRef: "b".repeat(201) })).toBe("project.textTooLong");
  });

  it("appUrl: http(s) only, a bare host gets https://", () => {
    expect(normaliseWebUrl(" https://app.example.com/login ")).toBe("https://app.example.com/login");
    expect(normaliseWebUrl("http://staging:8080")).toBe("http://staging:8080");
    expect(normaliseWebUrl("localhost:3000/x")).toBe("https://localhost:3000/x");
    expect(normaliseWebUrl("app.example.com:8443")).toBe("https://app.example.com:8443");
    for (const bad of ["ftp://x.com", "javascript:alert(1)", "mailto:a@b.com", "not a url", "staging", "https://u:p@x.com", "https://", `x.com/${"a".repeat(500)}`]) {
      expect(normaliseWebUrl(bad), bad).toBeNull();
      expect(refused({ appUrl: bad })).toBe("project.appUrlInvalid");
    }
  });

  it("testEnv: the shape is checked and its url follows the appUrl rule", () => {
    expect(parse({ testEnv: '{"available":"no"}' }).value.guided.testEnv).toBe('{"available":"no"}');
    expect(parse({ testEnv: '{"available":"unsure","url":"","accessHow":""}' }).value.guided.testEnv).toBe('{"available":"unsure"}');
    for (const bad of ["nope", "[]", "null", "{}", '{"available":"maybe"}', '{"available":"yes","extra":1}', '{"available":"yes","url":5}', '{"available":"yes","accessHow":[]}']) {
      expect(refused({ testEnv: bad }), bad).toBe("project.testEnvInvalid");
    }
    expect(refused({ testEnv: '{"available":"yes","url":"ftp://x.com"}' })).toBe("project.testEnvUrlInvalid");
    expect(refused({ testEnv: JSON.stringify({ available: "yes", accessHow: "a".repeat(2000) }) })).toBe("input.tooLong");
  });

  it("setupAnswers must be a JSON object; setupStatus draft or complete", () => {
    for (const bad of ["[]", "1", '"x"', "null", "{", "x"]) expect(refused({ setupAnswers: bad }), bad).toBe("project.setupAnswersInvalid");
    expect(refused({ setupAnswers: `{"a":"${"x".repeat(20000)}"}` })).toBe("input.tooLong");
    expect(parse({ setupStatus: "draft" }).value.guided.setupStatus).toBe("draft");
    expect(refused({ setupStatus: "done" })).toBe("input.wrongType");
    expect(refused({ setupStatus: "" })).toBe("input.wrongType");
  });
});

describe("project.create parse: greenfield repositories", () => {
  it("an existing repository", () => {
    const r = parse({ repo: "acme/landing", repoBranch: "main" });
    expect(r.value.repo).toEqual({ kind: "existing", owner: "acme", name: "landing", branch: "main" });
    expect(refused({ repo: "acme/landing" })).toBe("project.branchInvalid");
  });

  it("a new repository MADP creates, branch main unless given", () => {
    expect(parse({ newRepoOwner: "acme", newRepoName: "cafe-shop", repoVisibility: "private" }).value.repo)
      .toEqual({ kind: "new", owner: "acme", name: "cafe-shop", visibility: "private", branch: "main" });
    expect(parse({ newRepoOwner: "acme", newRepoName: "cafe-shop", repoVisibility: "internal", repoBranch: "trunk" }).value.repo)
      .toMatchObject({ kind: "new", visibility: "internal", branch: "trunk" });
    expect(refused({ newRepoOwner: "-bad-", newRepoName: "x", repoVisibility: "private" })).toBe("project.repoOwnerInvalid");
    expect(refused({ newRepoOwner: "acme", newRepoName: "x.git", repoVisibility: "private" })).toBe("project.repoNameInvalid");
    expect(refused({ newRepoOwner: "acme", newRepoName: "x", repoVisibility: "public" })).toBe("project.repoVisibilityInvalid");
    expect(refused({ newRepoOwner: "acme", newRepoName: "x", repoVisibility: "private", repoBranch: "bad branch" })).toBe("project.branchInvalid");
  });

  it("both kinds together, or a new repository for brownfield, are refused", () => {
    expect(refused({ repo: "acme/a", repoBranch: "main", newRepoOwner: "acme", newRepoName: "b", repoVisibility: "private" })).toBe("project.repoMixed");
    expect(refused({ projectType: "brownfield", newRepoOwner: "acme", newRepoName: "b", repoVisibility: "private" })).toBe("project.notGreenfield");
  });
});

describe("project.create run", () => {
  const ME = { userId: "member-1", email: "member@selisegroup.com" };
  const setup = () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    return { gateway, workspaceId, call: (args: Record<string, unknown>) => runOp("project", PROJECT_OPS, { ctx: fakeCtx(ME), gateway, request: { op: "project.create", args: { workspaceId, ...args } } }) };
  };

  it("stores the guided fields and a new repository; the client record reads them", async () => {
    const { gateway, call } = setup();
    const res = await call({
      name: "Café shop", goal: "Sell coffee online", appUrl: "shop.example.com", testEnv: '{"available":"no"}',
      setupAnswers: '{"goal":"Sell coffee online"}', setupStatus: "draft",
      newRepoOwner: "acme", newRepoName: "cafe-shop", repoVisibility: "private",
    });
    expect(res.status).toBe(200);
    const row = gateway.rows("Project")[0];
    expect(row).toMatchObject({
      Goal: "Sell coffee online", AppUrl: "https://shop.example.com", TestEnv: '{"available":"no"}', SetupAnswers: '{"goal":"Sell coffee online"}',
      SetupStatus: "draft", RepoMode: "new", RepoProvider: "github", RepoOwner: "acme", RepoName: "cafe-shop", RepoVisibility: "private",
      RepoBranch: "main", RepoExisting: "",
    });
    expect(row).not.toHaveProperty("TargetUsers");
    const rec = projectFromRow(res.body.data.project);
    expect(rec).toMatchObject({ goal: "Sell coffee online", appUrl: "https://shop.example.com", setupStatus: "draft", repoExisting: false, repoVisibility: "private", type: "greenfield" });
    const audit = gateway.rows("AuditEvent").find((e) => e.Action === "project.create");
    const details = JSON.parse(String(audit?.DetailsJson));
    expect(details).toMatchObject({ hasGoal: true, hasSetup: true, hasAppUrl: true, hasTestEnv: true, setupComplete: false, hasRepo: true, repoExisting: false });
    expect(String(audit?.DetailsJson)).not.toContain("Sell coffee");
  });

  it("a greenfield project in an existing repository is marked RepoExisting", async () => {
    const { gateway, call } = setup();
    const res = await call({ repo: "acme/landing", repoBranch: "develop" });
    expect(res.status).toBe(200);
    expect(gateway.rows("Project")[0]).toMatchObject({ RepoMode: "new", RepoOwner: "acme", RepoName: "landing", RepoBranch: "develop", RepoExisting: "acme/landing" });
    expect(gateway.rows("Project")[0]).not.toHaveProperty("RepoVisibility");
    expect(projectFromRow(res.body.data.project)).toMatchObject({ repoExisting: true, goal: "", setupStatus: "" });
  });

  it("a plain create writes none of the new fields", async () => {
    const { gateway, call } = setup();
    expect((await call({ name: "Plain" })).status).toBe(200);
    const row = gateway.rows("Project")[0];
    for (const f of ["Goal", "AppUrl", "TestEnv", "SetupAnswers", "SetupStatus", "RepoExisting", "RepoOwner"]) expect(row).not.toHaveProperty(f);
  });

  it("an invalid appUrl is refused before anything is written", async () => {
    const { gateway, call } = setup();
    const res = await call({ appUrl: "ftp://x.com" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { messageKey: "project.appUrlInvalid" } });
    expect(gateway.rows("Project")).toHaveLength(0);
  });
});

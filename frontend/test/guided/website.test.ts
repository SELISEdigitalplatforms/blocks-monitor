// The optional website of an existing product (Project.WebsiteUrl): the shared check, the About step's error, the
// create / setup / update ops (validated again on the server, ignored for a new idea) and the client record.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { checkWebsiteUrl, projectCreate } from "../../functions/project/ops/projects/create";
import { projectUpdate } from "../../functions/project/ops/projects/edit";
import { projectSetup } from "../../functions/project/ops/projects/setup";
import { projectFromRow } from "../../src/blocks/projects/records";
import {
  EMPTY_ANSWERS, LIMITS, WEBSITE_MESSAGE, answersFromProject, checkWebsite, sanitiseAnswers, toCreateArgs, toSetupArgs, validateStep,
  type StartAnswers,
} from "../../src/domain/guidedStart";
import { websiteLabel } from "../../src/components/business/WebsiteLink";
import { setAnswers, useGuidedStart } from "../../src/components/guided/store";

const about: StartAnswers = { ...EMPTY_ANSWERS, kind: "existing", name: "Depot Shift Planner", description: "Depot leads plan shifts; drivers see their rota." };

describe("checkWebsite", () => {
  it("is optional: empty or blank is no website", () => {
    expect(checkWebsite("")).toEqual({ ok: true, value: "" });
    expect(checkWebsite("   ")).toEqual({ ok: true, value: "" });
  });

  it("adds https:// to an address without a scheme and keeps http(s) ones", () => {
    expect(checkWebsite("alpinefresh.ch")).toEqual({ ok: true, value: "https://alpinefresh.ch" });
    expect(checkWebsite("  www.alpinefresh.ch/about ")).toEqual({ ok: true, value: "https://www.alpinefresh.ch/about" });
    expect(checkWebsite("http://kestrel-freight.co.uk")).toEqual({ ok: true, value: "http://kestrel-freight.co.uk" });
    expect(checkWebsite("HTTPS://Example.com")).toEqual({ ok: true, value: "HTTPS://Example.com" });
  });

  it("refuses anything that is not an http(s) web address", () => {
    for (const bad of ["ftp://alpinefresh.ch", "javascript:alert(1)", "mailto:info@alpinefresh.ch", "data:text/html,x", "alpine fresh", "alpinefresh",
      "https://", "https://user:pw@alpinefresh.ch", "file:///etc/passwd"]) {
      expect(checkWebsite(bad), bad).toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("keeps the address under the limit, counting the https:// it gets", () => {
    const host = (n: number) => `${"a".repeat(n - ".ch".length)}.ch`;
    expect(checkWebsite(`https://${host(LIMITS.website - 8)}`).ok).toBe(true);
    expect(checkWebsite(host(LIMITS.website - 8)).ok).toBe(true);
    expect(checkWebsite(host(LIMITS.website - 7))).toEqual({ ok: false, problem: "tooLong" });
  });
});

describe("the About step", () => {
  it("continues without a website and shows a plain error for a bad one", () => {
    expect(validateStep("about", about)).toEqual({});
    expect(validateStep("about", { ...about, website: "www.alpinefresh.ch" })).toEqual({});
    expect(validateStep("about", { ...about, website: "ftp://x.ch" }).website).toBe(WEBSITE_MESSAGE.invalid);
    expect(validateStep("about", { ...about, website: `${"a".repeat(600)}.ch` }).website).toBe(WEBSITE_MESSAGE.tooLong);
  });

  it("sends the normalised address to project.create, and nothing when empty", () => {
    expect(toCreateArgs({ ...about, website: "alpinefresh.ch" }, null).websiteUrl).toBe("https://alpinefresh.ch");
    expect(toCreateArgs(about, null)).not.toHaveProperty("websiteUrl");
  });

  it("a new idea has no website: not checked, not sent, not read back", () => {
    const idea = { ...about, kind: "new" as const, website: "ftp://x.ch" };
    expect(validateStep("about", idea)).toEqual({});
    expect(toCreateArgs({ ...idea, website: "x.ch" }, null)).not.toHaveProperty("websiteUrl");
    expect(toSetupArgs("p-1", { ...idea, website: "x.ch" }, "P").websiteUrl).toBe("");
    expect(answersFromProject({ name: "P", type: "greenfield", websiteUrl: "https://x.ch" }).website).toBe("");
  });

  it("switching the draft to a new idea drops the website", () => {
    useGuidedStart.setState({ owner: null, answers: { ...about, website: "www.x.ch" } });
    setAnswers({ kind: "existing" });
    expect(useGuidedStart.getState().answers.website).toBe("www.x.ch");
    setAnswers({ kind: "new" });
    expect(useGuidedStart.getState().answers.website).toBe("");
  });

  it("is kept in a draft, read back from the project and sent on project.setup", () => {
    expect(sanitiseAnswers({ ...about, website: "www.x.ch" }).website).toBe("www.x.ch");
    expect(sanitiseAnswers({ ...about, website: 5 }).website).toBe("");
    const a = answersFromProject({ name: "P", type: "brownfield", websiteUrl: "https://www.x.ch", setupAnswers: JSON.stringify({ ...about, website: "old.ch" }) });
    expect(a.website).toBe("https://www.x.ch");
    expect(toSetupArgs("p-1", { ...a, website: "" }, "P").websiteUrl).toBe("");
  });

  it("shows the address without its scheme", () => {
    expect(websiteLabel("https://www.alpinefresh.ch/")).toBe("www.alpinefresh.ch");
    expect(websiteLabel("http://x.ch/about")).toBe("x.ch/about");
  });
});

describe("the ops validate it again", () => {
  const WS = "ws-1";
  it("project.create, project.setup and project.update share one rule", () => {
    expect(checkWebsiteUrl("x.ch")).toEqual({ ok: true, value: "https://x.ch" });
    expect(checkWebsiteUrl("ftp://x.ch")).toMatchObject({ ok: false, messageKey: "project.websiteUrlInvalid" });
    expect(checkWebsiteUrl(`${"a".repeat(600)}.ch`)).toMatchObject({ ok: false, messageKey: "project.websiteUrlTooLong" });
    const create = (args: Record<string, unknown>) => projectCreate.parse({ workspaceId: WS, projectType: "brownfield", ...args }) as any;
    expect(create({ websiteUrl: "x.ch" }).value.guided.websiteUrl).toBe("https://x.ch");
    expect(create({ websiteUrl: "" })).toMatchObject({ ok: true, value: { guided: {} } });
    expect(create({ websiteUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, messageKey: "project.websiteUrlInvalid" });
    // a new idea's website is ignored
    expect(create({ projectType: "greenfield", websiteUrl: "x.ch" })).toMatchObject({ ok: true, value: { guided: {} } });
    expect((projectUpdate.parse({ projectId: "p-1", websiteUrl: "x.ch" }) as any).value.patch).toEqual({ WebsiteUrl: "https://x.ch" });
    expect((projectUpdate.parse({ projectId: "p-1", websiteUrl: "" }) as any).value.patch).toEqual({ WebsiteUrl: "" });
    expect(projectUpdate.parse({ projectId: "p-1", websiteUrl: "mailto:a@x.ch" })).toMatchObject({ ok: false, messageKey: "project.websiteUrlInvalid" });
    const setup = (websiteUrl: string) => projectSetup.parse({ projectId: "p-1", description: "", goal: "", targetUsers: "", setupAnswers: "{}", websiteUrl }) as any;
    expect(setup("www.x.ch").value.patch.WebsiteUrl).toBe("https://www.x.ch");
    expect(setup("ftp://x.ch")).toMatchObject({ ok: false, messageKey: "project.websiteUrlInvalid" });
  });

  const ME = { userId: "member-1", email: "member@selisegroup.com" };
  it("stores it on create and changes or clears it on update, through the router", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    const call = (op: string, args: Record<string, unknown>) => runOp("project", PROJECT_OPS, { ctx: fakeCtx(ME), gateway, request: { op, args } });

    const created = await call("project.create", { workspaceId, name: "With website", projectType: "brownfield", websiteUrl: "www.alpinefresh.ch" });
    expect(created.status).toBe(200);
    expect(projectFromRow(created.body.data.project).websiteUrl).toBe("https://www.alpinefresh.ch");
    const plain = await call("project.create", { workspaceId, name: "Without website", projectType: "brownfield" });
    expect(gateway.rows("Project").find((r) => r.ItemId === plain.body.data.project.ItemId)).not.toHaveProperty("WebsiteUrl");
    expect(projectFromRow(plain.body.data.project).websiteUrl).toBe("");

    const idea = await call("project.create", { workspaceId, name: "New idea", websiteUrl: "www.alpinefresh.ch" });
    expect(idea.status).toBe(200);
    expect(idea.body.data.project).not.toHaveProperty("WebsiteUrl");
    const bad = await call("project.create", { workspaceId, name: "Bad", projectType: "brownfield", websiteUrl: "ftp://x.ch" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { messageKey: "project.websiteUrlInvalid" } });
    expect(gateway.rows("Project")).toHaveLength(3);

    // editable after the hand-over too
    const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, Stage: "build", RepoMode: "existing" });
    const changed = await call("project.update", { projectId, websiteUrl: "alpinefresh.ch/en" });
    expect(changed.status).toBe(200);
    expect(gateway.rows("Project").find((r) => r.ItemId === projectId)?.WebsiteUrl).toBe("https://alpinefresh.ch/en");
    expect((await call("project.update", { projectId, websiteUrl: "" })).status).toBe(200);
    expect(gateway.rows("Project").find((r) => r.ItemId === projectId)?.WebsiteUrl).toBe("");

    // a new idea: the server ignores it (and clears a stale one)
    const { projectId: newId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, RepoMode: "new", WebsiteUrl: "https://stale.ch" });
    expect((await call("project.update", { projectId: newId, websiteUrl: "x.ch" })).status).toBe(200);
    expect(gateway.rows("Project").find((r) => r.ItemId === newId)?.WebsiteUrl).toBe("");
  });
});

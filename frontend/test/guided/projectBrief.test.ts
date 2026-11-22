// The Project brief: the note written from the guided start's answers (create and project.setup), the "What to do now"
// checklist, editing answers, and the local engine's analysis reading the brief like any note.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { briefMarkdown, parseTestEnv, setupChecklist, testEnvText } from "../../src/domain/projectBrief";
import { EMPTY_ANSWERS, answersFromProject, toCreateArgs, toSetupArgs, validateStep, type StartAnswers } from "../../src/domain/guidedStart";
import { readFacts } from "../../server/local/engine/kinds/analysis/facts";
import { ProjectView } from "../../server/local/engine/context";

const answers: StartAnswers = {
  ...EMPTY_ANSWERS, kind: "existing", name: "Booking Desk", description: "Customers book rooms by phone; they should book online.",
  goalTags: ["Save time"], goal: "Customers book and pay without calling us", userTags: ["Customers"], users: "Front desk staff",
  repo: { owner: "acme", name: "booking", branch: "main" }, appUrl: "booking.example.com", testEnv: "yes", testUrl: "test.example.com",
  testAccess: "Ana from IT creates accounts", runInstructions: "Our IT partner hosts it.",
};

describe("briefMarkdown", () => {
  it("writes readable sections; existing products get where it runs, the test version and how it is started", () => {
    const md = briefMarkdown({
      name: "Booking Desk", existing: true, description: answers.description, goal: "Save time. Customers book online", targetUsers: "Customers",
      appUrl: "https://booking.example.com", testEnv: { available: "yes", url: "https://test.example.com", accessHow: "Ana from IT" }, runInstructions: "Hosted by IT",
    });
    expect(md).toContain("## About the product");
    expect(md).toContain("## Goal\n\nSave time. Customers book online.");
    expect(md).toContain("## Where it runs today\n\nThe product runs at https://booking.example.com.");
    expect(md).toContain("Yes, there is a safe test version at https://test.example.com. Access: Ana from IT.");
    expect(md).toContain("## How it is started");
    const fresh = briefMarkdown({ name: "X", existing: false, description: "An app.", goal: "g", targetUsers: "u", blocksProjectRef: "kf-1" });
    expect(fresh).toContain("## About the project");
    expect(fresh).toContain("## SELISE Blocks project");
    expect(fresh).not.toContain("Where it runs");
  });

  it("test version wording and parsing", () => {
    expect(testEnvText(parseTestEnv('{"available":"no"}'))).toMatch(/no safe test version/);
    expect(testEnvText(parseTestEnv('{"available":"unsure"}'))).toMatch(/Not sure/);
    expect(parseTestEnv("nonsense")).toBeNull();
  });
});

describe("setupChecklist", () => {
  const base = { existing: false, name: "X", description: "An app", goal: "g", targetUsers: "u", repoSaved: false, repoText: "", repoWillBeCreated: true, sharedCount: 0 };
  it("counts the guided answers, a new repository to be created and shared files", () => {
    const items = setupChecklist(base);
    expect(items.map((i) => i.id)).toEqual(["about", "goal", "where", "share"]);
    expect(items.filter((i) => i.done).length).toBe(3);
    expect(setupChecklist({ ...base, existing: true, repoWillBeCreated: true }).find((i) => i.id === "where")!.done).toBe(false);
    expect(setupChecklist({ ...base, sharedCount: 2 }).every((i) => i.done)).toBe(true);
  });
  it("needs neither Must-haves nor Approver setup for either product type", () => {
    for (const existing of [false, true]) {
      const items = setupChecklist({ ...base, existing, repoSaved: true, sharedCount: 2 });
      expect(items).toHaveLength(4);
      expect(items.every((i) => i.done)).toBe(true);
      expect(items.some((i) => /must|workflow|constraint|exclusion|change|approv/i.test(i.label))).toBe(false);
    }
  });
});

describe("editing answers", () => {
  it("reads a project's answers back and sends project.setup arguments (the repository stays on its card)", () => {
    const p = {
      name: "Booking Desk", type: "brownfield", goal: "Save time. Customers book and pay without calling us", targetUsers: "x",
      appUrl: "https://booking.example.com", testEnv: '{"available":"no"}', runInstructions: "Hosted", setupAnswers: JSON.stringify(answers),
      repoOwner: "acme", repoName: "booking", repoBranch: "develop",
    };
    const a = answersFromProject(p);
    expect(a).toMatchObject({ kind: "existing", description: answers.description, goalTags: ["Save time"], testEnv: "no", repo: { branch: "develop" }, appUrl: "https://booking.example.com" });
    expect(validateStep("where", { ...a, repo: null }, null, { skipRepo: true })).toEqual({});
    const args = toSetupArgs("p1", { ...a, name: "Booking Desk 2" }, "Booking Desk");
    expect(args).toMatchObject({ projectId: "p1", name: "Booking Desk 2", testEnv: '{"available":"no"}', appUrl: "https://booking.example.com", blocksProjectRef: "" });
    expect(toSetupArgs("p1", a, "Booking Desk")).not.toHaveProperty("name");
    // a project made without the guided start shows its fields as free text
    expect(answersFromProject({ name: "Old", type: "greenfield", goal: "Sell more", targetUsers: "Shops" })).toMatchObject({ goal: "Sell more", users: "Shops", goalTags: [] });
  });
});

describe("project.create + project.setup through the router", () => {
  const ME = { userId: "member-1", email: "member@selisegroup.com" };
  const world = () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }] });
    const call = (op: string, args: Record<string, unknown>) => runOp("project", PROJECT_OPS, { ctx: fakeCtx(ME), gateway, request: { op, args } });
    return { gateway, workspaceId, call };
  };

  it("the guided create writes the Project brief note (no scratch pad); project.setup rewrites it and keeps others' sections", async () => {
    const { gateway, workspaceId, call } = world();
    const res = await call("project.create", { workspaceId, ...toCreateArgs(answers, null) });
    expect(res.status).toBe(200);
    const projectId = String(res.body.data.project.ItemId);
    const notes = () => gateway.rows("DocNote").filter((n) => n.ProjectId === projectId);
    expect(notes()).toHaveLength(1);
    const brief = notes()[0];
    expect(brief).toMatchObject({ Title: "Project brief", IsProjectBrief: true, FolderId: "" });
    expect(String(brief.BodyMd)).toContain("Customers book rooms by phone");
    expect(String(brief.BodyMd)).toContain("Ana from IT creates accounts");

    // someone else's section in the note, then the answers change
    await gateway.update("DocNote", String(brief.ItemId), { BodyMd: `${brief.BodyMd}\n\n## What it must do\n\n- Book online (Must)` });
    const edited = await call("project.setup", toSetupArgs(projectId, { ...answers, goal: "Book online in two minutes", testEnv: "no" }, "Booking Desk"));
    expect(edited.status).toBe(200);
    const body = String(notes()[0].BodyMd);
    expect(body).toContain("Save time. Book online in two minutes.");
    expect(body).toContain("There is no safe test version yet.");
    expect(body).toContain("## What it must do\n\n- Book online (Must)");
    expect(gateway.rows("Project").find((p) => p.ItemId === projectId)).toMatchObject({ Goal: "Save time. Book online in two minutes", TestEnv: '{"available":"no"}' });

    // after the hand-over the answers are fixed
    await gateway.update("Project", projectId, { Stage: "sanitization" });
    const late = await call("project.setup", toSetupArgs(projectId, answers, "Booking Desk"));
    expect(late.status).not.toBe(200);
  });

  it("the local engine's analysis reads the brief like any note", async () => {
    const { gateway, workspaceId, call } = world();
    const res = await call("project.create", { workspaceId, ...toCreateArgs(answers, null) });
    const projectId = String(res.body.data.project.ItemId);
    const store = {
      get: (schema: string, id: string) => gateway.rows(schema).find((r) => r.ItemId === id),
      rows: (schema: string) => gateway.rows(schema),
    };
    const facts = readFacts(new ProjectView(store as never, projectId));
    const texts = JSON.stringify(facts);
    expect(texts).toContain("Customers book rooms by phone");
    expect(texts).toContain("Our IT partner hosts it");
  });
});

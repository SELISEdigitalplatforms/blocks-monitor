// The Figma Make ops through the real router: the step op that queues the design job (the credit consent first, one
// job per brief, a prior reference kept but made unapprovable), and the approval gates that bind an approval to the
// exact direction and requirements the prototype was drawn against.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { DESIGN_OPS } from "../../functions/project/ops/design";
import { REQUIREMENT_OPS } from "../../functions/project/ops/requirements";
import { automaticDesignDirection, designSource, makeProjectUrl, parseMakePrototype } from "../../src/domain/figmaMake";
import { factoryPreviewPath } from "../../src/domain/factoryDesign";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const OTHER = { userId: "designer-2", email: "david.baumann@selisegroup.com", displayName: "David Baumann" };

describe("Factory intent approval and preview gates", () => {
  it('refuses approval of an incomplete Figma screen preview even when its source is current', async () => {
    const t = setup(); const context = await t.call(DESIGN_OPS, 'designBrief.context', {});
    const revision = 'b'.repeat(64);
    t.gateway.update('DesignBrief', t.briefId, { PrototypeJson: JSON.stringify({ provider: 'figma-design', projectId: t.projectId,
      projectUrl: 'https://www.figma.com/design/abc/Screens', previewUrl: factoryPreviewPath(t.projectId, revision), revision,
      source: context.body.data.source, jobId: 'j1', artifactFileId: 'f1', reviewComplete: false, totalScreens: 20,
      screens: [{ name: 'Orders', nodeId: '1:2', requirementKeys: ['assign-work'] }] }) } as never);
    expect((await t.call(DESIGN_OPS, 'designBrief.confirm', {})).status).toBe(400);
    expect(t.gateway.rows('DesignBrief')[0].Status).not.toBe('confirmed');
  });
  it("re-reads goals before confirming a Factory revision", async () => {
    const t = setup(); const context = await t.call(DESIGN_OPS, "designBrief.context", {});
    expect(context.status).toBe(200);
    const revision = "a".repeat(64), url = factoryPreviewPath(t.projectId, revision);
    t.gateway.update("DesignBrief", t.briefId, { PrototypeJson: JSON.stringify({ provider: "factory", projectId: t.projectId,
      projectUrl: url, previewUrl: url, revision, source: context.body.data.source, jobId: "j1", artifactFileId: "f1", figmaReferenceUrl: null }) } as never);
    expect((await t.call(DESIGN_OPS, "designBrief.confirm", {})).status).toBe(200);
    t.gateway.update("Project", t.projectId, { Goal: "A changed business goal" } as never);
    const refused = await t.call(DESIGN_OPS, "designBrief.confirm", {});
    expect(refused.status).toBe(400); expect(refused.body.error.messageKey).toBe("design.notConfirmable");
  });
  it("does not allow preview access to a different revision or a different project association", async () => {
    const t = setup();
    expect((await t.call(DESIGN_OPS, "designBrief.preview", { revision: "a".repeat(64) })).status).toBe(404);
    const url = factoryPreviewPath("different-project", "a".repeat(64));
    t.gateway.update("DesignBrief", t.briefId, { PrototypeJson: JSON.stringify({ provider: "factory", projectId: "different-project", projectUrl: url, previewUrl: url,
      revision: "a".repeat(64), source: "factory-v1:ux-1", jobId: "j1", artifactFileId: "f1", figmaReferenceUrl: null }) } as never);
    expect((await t.call(DESIGN_OPS, "designBrief.preview", { revision: "a".repeat(64) })).status).toBe(404);
  });
});

function setup(o: { mode?: string; prototype?: string; instructions?: string } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, {
    members: [{ ...ME, roleKey: "member" }, { ...OTHER, roleKey: "member" }],
  });
  const { projectId } = seedProject(gateway, { workspaceId, Name: "Field services", Stage: "requirements", CreatedByUserId: ME.userId });
  const requirements = [
    { key: "assign-work", title: "Assign work", text: "Managers assign technicians to jobs.", criteria: ["Assignments persist"], number: 1 },
    { key: "urgency", title: "Urgency", text: "Urgent requests stand out.", criteria: ["Urgent ones are marked"], number: 2 },
  ].map((r, i) => ({
    ...r,
    id: seedRow(gateway, "Requirement", {
      ProjectId: projectId, WorkspaceId: workspaceId, ReaderIds: [ME.userId, OTHER.userId],
      Key: r.key, Number: r.number, Title: r.title, Text: r.text, AcceptanceCriteria: r.criteria,
      Priority: "must", Status: "draft", SortOrder: i * 10,
    }),
  }));
  const briefArguments = {
    ProjectId: projectId, WorkspaceId: workspaceId, ReaderIds: [ME.userId, OTHER.userId],
    Mode: o.mode ?? "figma", Instructions: o.instructions ?? "Calm, premium feel with roomy empty states", Status: "draft",
  };
  const briefId = seedRow(gateway, "DesignBrief", briefArguments);
  if (o.prototype !== undefined) gateway.update("DesignBrief", briefId, { PrototypeJson: o.prototype } as never);
  const call = (ops: unknown, op: string, args: Record<string, unknown>, who = ME) =>
    runOp("project", ops, { ctx: fakeCtx(who), gateway, request: { op, args: { projectId, ...args } } });
  const brief = () => gateway.rows("DesignBrief").find((r) => r.ItemId === briefId)!;
  const jobs = () => gateway.rows("EngineJob").filter((j) => j.Kind === "design.generate");
  const designRequirements = requirements.map((r) => ({ key: r.key, title: r.title, text: r.text, criteria: r.criteria }));
  const source = designSource(automaticDesignDirection(designRequirements), designRequirements);
  return { gateway, projectId, briefId, brief, jobs, call, source };
}

describe("designBrief.generate", () => {
  it("does not mistake a running legacy screenshot job for a Make job or change its mode", async () => {
    const t = setup();
    expect((await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "" })).status).toBe(200);
    const legacy = t.jobs()[0];
    t.gateway.update("EngineJob", String(legacy.ItemId), { InputJson: JSON.stringify({ projectId: t.projectId, designBriefId: t.briefId }) } as never);
    t.gateway.update("DesignBrief", t.briefId, { Mode: "describe" } as never);
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ messageKey: "design.previousJobRunning" });
    expect(t.brief().Mode).toBe("describe");
    expect(t.jobs()).toHaveLength(1);
  });
  it("derives the direction automatically, with no manual description required", async () => {
    for (const instructions of ["", "  short  ", "x".repeat(10001)]) {
      const t = setup({ instructions });
      const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true });
      expect(res.status).toBe(200);
      expect(t.jobs()).toHaveLength(1);
      expect(String(t.brief().Instructions)).toContain("Derive the product journeys");
    }
  });

  it("queues from requirements without asking the end user about provider credits", async () => {
    const t = setup();
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "" });
    expect(res.status).toBe(200);
    expect(t.jobs()).toHaveLength(1);
    expect(JSON.parse(String(t.jobs()[0].InputJson))).not.toHaveProperty("acknowledgeFigmaCredits");
  });

  it("validates design feedback before queuing a job", async () => {
    const t = setup();
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "x".repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_input", messageKey: "input.invalid", params: { field: "feedback" } });
    expect(t.jobs()).toHaveLength(0);
  });

  it("queues one job per brief with the server-computed source, and keeps a prior reference unapprovable", async () => {
    const t = setup({ prototype: JSON.stringify({
      provider: "figma-make", projectUrl: makeProjectUrl("https://www.figma.com/make/field-services-app/"),
      previewUrl: null, revision: "rev-1", source: "ux-old", jobId: "job-0", artifactFileId: "file-0",
    }) });
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "calmer colours, tighter cards", acknowledgeFigmaCredits: true });
    expect(res.status).toBe(200);
    const open = t.jobs();
    expect(open).toHaveLength(1);
    const input = JSON.parse(String(open[0].InputJson));
    expect(input).toMatchObject({ projectId: t.projectId, designBriefId: t.briefId, feedback: "calmer colours, tighter cards" });
    // the fingerprint is computed from the rows, not taken from the client's input
    expect(input.source).toBe(t.source);
    expect(parseMakePrototype(t.brief().PrototypeJson)?.source).toBe(`pending:${String(open[0].ItemId)}`);
    // a second call while the job is open answers the open job, it does not queue a second one
    const again = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true });
    expect(again.status).toBe(200);
    expect(again.body.data.jobId).toBe(String(open[0].ItemId));
    expect(t.jobs()).toHaveLength(1);
  });

  it("upgrades legacy design modes to the sole Figma Make path", async () => {
    const t = setup({ mode: "describe" });
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true });
    expect(res.status).toBe(200);
    expect(t.brief().Mode).toBe("figma");
    expect(t.jobs()).toHaveLength(1);
    const second = setup();
    const ok = await second.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true });
    expect(ok.status).toBe(200);
    expect(second.jobs()).toHaveLength(1);
    // a member who is not in the workspace's design roles still may edit their own project's design
    const colleague = await second.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true }, OTHER);
    expect(colleague.status).toBe(200);
  });

  it("refuses direct direction edits and mode switching", async () => {
    const t = setup();
    const res = await t.call(DESIGN_OPS, "designBrief.save", { mode: "describe", instructions: "A manually edited direction" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ messageKey: "design.plannerOwned" });
    expect(t.brief().Mode).toBe("figma");
  });

  it("creates the planner-owned brief when none exists", async () => {
    const t = setup();
    t.gateway.remove("DesignBrief", t.briefId);
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "", acknowledgeFigmaCredits: true });
    expect(res.status).toBe(200);
    expect(t.gateway.rows("DesignBrief")).toHaveLength(1);
    expect(t.gateway.rows("DesignBrief")[0].Mode).toBe("figma");
  });

  it("records refinements against their prior revision and requirement keys", async () => {
    const t = setup();
    t.gateway.update("DesignBrief", t.briefId, { PrototypeJson: JSON.stringify({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null,
      revision: "rev-3", source: t.source, jobId: "job-old", artifactFileId: "file-old",
    }) } as never);
    const missing = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: " ", acknowledgeFigmaCredits: true });
    expect(missing.status).toBe(400);
    expect(t.jobs()).toHaveLength(0);
    const res = await t.call(DESIGN_OPS, "designBrief.generate", { feedback: "Make the order status easier to scan on phones", acknowledgeFigmaCredits: true });
    expect(res.status).toBe(200);
    expect(JSON.parse(String(t.jobs()[0].InputJson))).toMatchObject({
      requestType: "design-change", previousRevision: "rev-3", requirementKeys: ["assign-work", "urgency"],
      feedback: "Make the order status easier to scan on phones", source: t.source,
    });
    const approve = await t.call(DESIGN_OPS, "designBrief.confirm", {});
    expect(approve.status).toBe(400);
  });
});

describe("the approval gates", () => {
  it("does not accept a manually confirmed legacy design in place of reviewed Make screens", async () => {
    const t = setup({ mode: "describe" });
    t.gateway.update("DesignBrief", t.briefId, { Status: "confirmed" } as never);
    expect((await t.call(DESIGN_OPS, "designBrief.confirm", {})).status).toBe(400);
    expect((await t.call(REQUIREMENT_OPS, "requirements.confirm", {})).status).toBe(400);
  });
  it("designBrief.confirm binds the approval to the current requirements and direction", async () => {
    const stale = setup();
    const res = await stale.call(DESIGN_OPS, "designBrief.confirm", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ messageKey: "design.notConfirmable", params: { reason: "prototype_stale" } });
    expect(stale.brief().Status).toBe("draft");

    // a reference from the current direction and requirements approves
    const fresh = setup({ mode: "figma", prototype: JSON.stringify({
      provider: "figma-make", projectUrl: makeProjectUrl("https://www.figma.com/make/field-services-app/"),
      previewUrl: "https://field-services-app.figma.site", revision: "rev-2",
      source: "", jobId: "job-1", artifactFileId: "file-1",
    }) });
    const source = fresh.source;
    fresh.gateway.update("DesignBrief", fresh.briefId, {
      PrototypeJson: JSON.stringify({ provider: "figma-make", projectUrl: makeProjectUrl("https://www.figma.com/make/field-services-app/"), previewUrl: "https://field-services-app.figma.site", revision: "rev-2", source, jobId: "job-1", artifactFileId: "file-1" }),
    } as never);
    const ok = await fresh.call(DESIGN_OPS, "designBrief.confirm", {});
    expect(ok.status).toBe(200);
    expect(fresh.brief().Status).toBe("confirmed");

    // and once the requirements change, the approval of a prototype drawn before them is refused again
    await fresh.call(REQUIREMENT_OPS, "requirement.save", { clientKey: "offline-0001", title: "Offline mode", detail: "Technicians keep working offline.", criteria: ["Drafts survive a restart"], priority: "must" });
    const res2 = await fresh.call(DESIGN_OPS, "designBrief.confirm", {});
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatchObject({ params: { reason: "prototype_stale" } });
  });

  it("requirements.confirm refuses a missing figma prototype", async () => {
    const t = setup({ prototype: "" });
    const res = await t.call(REQUIREMENT_OPS, "requirements.confirm", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ messageKey: "design.notConfirmable", params: { reason: "prototype_stale" } });
    expect(t.gateway.rows("Project")[0].Stage).toBe("requirements");
  });

  it("requires explicit screen approval before moving current requirements to scope", async () => {
    const t = setup();
    seedRow(t.gateway, "Objective", { ProjectId: t.projectId, WorkspaceId: t.brief().WorkspaceId,
      ReaderIds: t.brief().ReaderIds, Statement: "Dispatch service work reliably", AcceptanceCriteria: ["Every request has an assignee"], Status: "draft" });
    t.gateway.update("DesignBrief", t.briefId, { PrototypeJson: JSON.stringify({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/field-services-app/", previewUrl: null,
      revision: "rev-2", source: t.source, jobId: "job-2", artifactFileId: "file-2",
    }) } as never);
    const before = await t.call(REQUIREMENT_OPS, "requirements.confirm", {});
    expect(before.status).toBe(400);
    expect(before.body.error).toMatchObject({ messageKey: "requirements.blockers", params: { missing: [{ code: "design_not_confirmed" }] } });
    expect((await t.call(DESIGN_OPS, "designBrief.confirm", {})).status).toBe(200);
    const approved = await t.call(REQUIREMENT_OPS, "requirements.confirm", {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.stage).toBe("scope");
    expect(t.brief()).toMatchObject({ Status: "confirmed", ConfirmedByUserId: ME.userId });
  });
});

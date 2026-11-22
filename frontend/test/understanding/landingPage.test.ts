// The "Landing page" add-on: its state, its checks, the Goals & requirements section written from the answers, and the
// review gate (project.addon.landingPage.save / .confirm through the real router; requirements.confirm's blocker).
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import {
  EMPTY_LANDING, audienceFrom, landingAccess, checkLanding, draftLandingSection, landingBrief, landingDraft, landingBlocks, landingChipValue, landingReview, landingSectionFor, landingState, parseLandingAddOn,
  parseLandingSection, serialiseLandingSection, type LandingAddOn, type LandingAnswers, type LandingContext,
} from "../../src/domain/landingPage";
import { confirmBlockers } from "../../src/domain/requirements";

const ANSWERS: LandingAnswers = {
  ...EMPTY_LANDING, purpose: "Get treasury analysts at mid-sized companies to book a demo", notes: "German and English",
  references: ["https://linear.app/"],
};
/** An older stored answer set (the fields the dialog no longer asks). */
const OLD: LandingAnswers = {
  ...ANSWERS, title: "Close Calendar by Alpine Fresh", audience: "treasury analysts", sections: "Hero\n- What it does\n3. Contact form", tone: "Calm", cta: "Request access",
};
const CTX: LandingContext = {
  name: "Close Calendar", description: "", goal: "Replace spreadsheets.", users: "Finance leads", websiteUrl: "https://www.alpinefresh.ch",
  features: ["Combine bank balances", "Expected payments", "Morning cash report", "Fourth"],
};
const addOn = (o: Partial<LandingAddOn> = {}): LandingAddOn =>
  ({ choice: "new", answers: ANSWERS, revision: 1, savedAt: "2026-10-28T08:00:00.000Z", savedByUserId: "u", ...o });

describe("landing page add-on state", () => {
  it("is open until decided, filled when wanted, not needed for No", () => {
    expect(landingState(null)).toBe("open");
    expect(landingState(addOn())).toBe("filled");
    expect(landingState(addOn({ choice: "none", answers: null }))).toBe("notNeeded");
    expect(landingChipValue(addOn({ choice: "none", answers: null }))).toBe("Not needed");
    expect(parseLandingAddOn("not json")).toBeNull();
    expect(parseLandingAddOn(JSON.stringify(addOn({ revision: 3 })))).toMatchObject({ choice: "new", revision: 3, answers: { purpose: ANSWERS.purpose } });
    // older stored answers stay readable
    expect(parseLandingAddOn(JSON.stringify(addOn({ answers: OLD })))!.answers).toMatchObject({ title: OLD.title, cta: "Request access" });
  });

  it("asks only what the page should achieve; the rest is optional", () => {
    expect(checkLanding({ choice: "none" })).toEqual({ ok: true, value: { choice: "none", answers: null } });
    expect(checkLanding({ choice: "maybe" })).toMatchObject({ ok: false, problems: [{ key: "choice" }] });
    expect(checkLanding({ choice: "new", answers: { purpose: " " } })).toMatchObject({ ok: false, problems: [{ key: "purpose", problem: "required" }] });
    expect(checkLanding({ choice: "modify", answers: { purpose: "Sell more" } })).toMatchObject({ ok: true, value: { answers: { purpose: "Sell more", notes: "", references: [] } } });
    const ok = checkLanding({ choice: "new", answers: { ...ANSWERS, references: ["linear.app", "linear.app"] } });
    expect(ok).toMatchObject({ ok: true, value: { answers: { references: ["https://linear.app"] } } });
    expect(checkLanding({ choice: "new", answers: { ...ANSWERS, references: ["not a url"] } })).toMatchObject({ ok: false, problems: [{ key: "references" }] });
    // an existing product's website is offered among the examples
    expect(landingDraft(null, "https://www.alpinefresh.ch").answers.references).toEqual(["https://www.alpinefresh.ch"]);
  });
});

describe("who can change the answers, and how", () => {
  // the bug: the chip only opened in Understanding and Goals & requirements; later it was a dead chip
  it("stays editable in every later step (through a change request) and explains read-only cases", () => {
    const base = { stage: "build", step: "build", canEditUnderstanding: true, canRequestChange: true };
    expect(landingAccess({ ...base, stage: "sanitization", step: "sanitization" })).toEqual({ editable: true, way: "direct", reason: null });
    expect(landingAccess({ ...base, stage: "requirements", step: "requirements" })).toMatchObject({ editable: true, way: "direct" });
    for (const step of ["scope", "board", "build", "release"]) expect(landingAccess({ ...base, stage: step, step })).toEqual({ editable: true, way: "change", reason: null });
    expect(landingAccess({ ...base, canEditUnderstanding: false })).toMatchObject({ editable: false, reason: expect.stringContaining("Only the project team") });
    expect(landingAccess({ ...base, canRequestChange: false })).toMatchObject({ editable: false, reason: expect.stringContaining("change request") });
    expect(landingAccess({ ...base, stage: "paused" })).toMatchObject({ editable: false, reason: expect.stringContaining("paused") });
    expect(landingAccess({ ...base, stage: "abandoned" })).toMatchObject({ editable: false });
  });
});

describe("the Goals & requirements section", () => {
  it("works out the headline, audience, button and sections from the answers and the project", () => {
    expect(audienceFrom("Get treasury analysts to book a demo")).toBe("");
    expect(audienceFrom("A page for treasury analysts at mid-sized companies, to book a demo")).toBe("treasury analysts at mid-sized companies");
    const b = landingBrief(addOn(), CTX)!;
    expect(b).toMatchObject({ title: "Close Calendar: replace spreadsheets", audience: "Finance leads", cta: "Book a demo", examples: ["https://linear.app/"] });
    expect(b.sections[1]).toBe("What it does: Combine bank balances, Expected payments, Morning cash report");
    // older answers win where they were given
    expect(landingBrief(addOn({ answers: OLD }), CTX)).toMatchObject({ title: OLD.title, audience: "treasury analysts", cta: "Request access", sections: ["Hero", "What it does", "Contact form"] });
    // a change to the existing page uses the project's website as the page
    expect(landingBrief(addOn({ choice: "modify" }), CTX)!.pageUrl).toBe("https://www.alpinefresh.ch");
  });

  it("writes goals and Must/Should/Could requirements", () => {
    const d = draftLandingSection(addOn(), CTX)!;
    expect(d.goals[0]).toBe('Launch a dedicated landing page for Close Calendar, headed "Close Calendar: replace spreadsheets".');
    expect(d.requirements.map((r) => r.priority)).toEqual([...d.requirements.map((r) => r.priority)].sort((x, y) => ["must", "should", "could"].indexOf(x) - ["must", "should", "could"].indexOf(y)));
    expect(new Set(d.requirements.map((r) => r.priority))).toEqual(new Set(["must", "should", "could"]));
    expect(d.requirements.some((r) => r.text.includes("German and English"))).toBe(true);
    const modify = draftLandingSection(addOn({ choice: "modify" }), CTX)!;
    expect(modify.goals[0]).toContain("Rework the existing landing page (www.alpinefresh.ch)");
    expect(modify.requirements.some((r) => r.title === "Keep the current address working")).toBe(true);
    expect(draftLandingSection(addOn({ choice: "none", answers: null }))).toBeNull();
  });

  it("needs a review for the latest answers before the requirements can be approved", () => {
    const a = addOn({ revision: 2 });
    expect(landingReview(addOn({ choice: "none", answers: null }), null)).toBe("none");
    expect(landingReview(a, null)).toBe("preparing");
    const old = landingSectionFor(addOn({ revision: 1 }), "t")!;
    expect(landingReview(a, old)).toBe("preparing");
    const fresh = landingSectionFor(a, "t")!;
    expect(landingReview(a, fresh)).toBe("review");
    expect(landingReview(a, { ...fresh, confirmedAt: "t2", confirmedByUserId: "u" })).toBe("confirmed");
    expect(landingBlocks(JSON.stringify(a), serialiseLandingSection(fresh))).toBe(true);
    expect(landingBlocks(JSON.stringify(a), serialiseLandingSection({ ...fresh, confirmedAt: "t2" }))).toBe(false);
    expect(landingBlocks("", "")).toBe(false);
    const base = { requirements: [{ id: "r", status: "draft", criteria: ["x"] }], objective: { text: "o", criteria: ["c"] }, designBrief: { status: "confirmed" } };
    expect(confirmBlockers({ ...base, landingPageOpen: true })).toEqual([{ code: "landing_page_not_confirmed" }]);
    expect(confirmBlockers(base)).toEqual([]);
  });
});

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };

function setup(stage: string, opts: { drafted?: boolean } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, Stage: stage, RepoMode: "new" });
  if (opts.drafted) seedRow(gateway, "Requirement", {
    WorkspaceId: workspaceId, ProjectId: projectId, Number: 1, Key: "r-1", Title: "R", Priority: "must", Status: "draft", ReaderIds: [ME.userId],
  });
  const call = (op: string, args: Record<string, unknown>, who: { userId: string; email: string } = ME) =>
    runOp("project", PROJECT_OPS, { ctx: fakeCtx(who), gateway, request: { op, args: { projectId, ...args } } });
  const row = () => gateway.rows("Project").find((r) => r.ItemId === projectId)!;
  const jobs = () => gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId);
  /** What the engine's requirements draft writes for the saved answers. */
  const writeSection = () => gateway.update("Project", projectId, {
    LandingPageSection: serialiseLandingSection(landingSectionFor(parseLandingAddOn(row().LandingPageAddOn), "t")!),
  });
  return { call, row, jobs, writeSection, gateway };
}

describe("project.addon.landingPage.save / confirm", () => {
  it("saves the answers, raises the revision and clears the section for No", async () => {
    const { call, row, jobs, writeSection } = setup("sanitization");
    expect((await call("project.addon.landingPage.save", { choice: "new", answers: ANSWERS })).status).toBe(200);
    expect(parseLandingAddOn(row().LandingPageAddOn)).toMatchObject({ choice: "new", revision: 1, savedByUserId: ME.userId });
    expect(jobs()).toHaveLength(0); // before the draft: the requirements draft writes the section
    await writeSection();
    expect(row().LandingPageSection).not.toBe("");
    await call("project.addon.landingPage.save", { choice: "none" });
    expect(parseLandingAddOn(row().LandingPageAddOn)).toMatchObject({ choice: "none", revision: 2, answers: null });
    expect(row().LandingPageSection).toBe("");
  });

  it("once the draft has started, a change queues the section again", async () => {
    const { call, jobs } = setup("requirements", { drafted: true });
    const res = await call("project.addon.landingPage.save", { choice: "new", answers: ANSWERS });
    expect(res.status).toBe(200);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ Kind: "requirements.draft" });
    expect(String(jobs()[0]!.RequestKey)).toContain(String(jobs()[0]!.ProjectId)); // one key per project and revision
    expect(JSON.parse(String(jobs()[0]!.InputJson))).toMatchObject({ purpose: "landingPage", revision: 1 });
  });

  it("confirms only the section written for the latest answers", async () => {
    const { call, row, writeSection } = setup("requirements");
    await call("project.addon.landingPage.save", { choice: "new", answers: ANSWERS });
    expect((await call("project.addon.landingPage.confirm", { revision: 1 })).body).toMatchObject({ error: { messageKey: "project.landingChanged" } });
    await writeSection();
    expect(landingBlocks(row().LandingPageAddOn, row().LandingPageSection)).toBe(true);
    expect((await call("project.addon.landingPage.confirm", { revision: 1 })).status).toBe(200);
    expect(parseLandingSection(row().LandingPageSection)).toMatchObject({ confirmedByUserId: ME.userId });
    expect(landingBlocks(row().LandingPageAddOn, row().LandingPageSection)).toBe(false);
    // a change asks for a new review
    await call("project.addon.landingPage.save", { choice: "new", answers: { ...ANSWERS, cta: "Start a trial" } });
    expect(landingBlocks(row().LandingPageAddOn, row().LandingPageSection)).toBe(true);
  });

  it("stays open after Understanding is confirmed: a late change opens (then updates) one draft change request", async () => {
    const { call, row, jobs, gateway: gw } = setup("build", { drafted: true });
    const first = await call("project.addon.landingPage.save", { choice: "new", answers: ANSWERS });
    expect(first.status).toBe(200);
    const crs = () => gw.rows("ChangeRequest");
    expect(first.body.data).toMatchObject({ changeNumber: 1 });
    expect(crs()).toHaveLength(1);
    expect(crs()[0]).toMatchObject({ Lane: "add", Status: "draft", Title: "Landing page: a new page", RequestedByUserId: ME.userId });
    expect(parseLandingAddOn(row().LandingPageAddOn)).toMatchObject({ revision: 1, changeNumber: 1 });
    expect(jobs()).toHaveLength(1); // the section is written again
    await call("project.addon.landingPage.save", { choice: "modify", answers: ANSWERS });
    expect(crs()).toHaveLength(1);
    expect(crs()[0]).toMatchObject({ Title: "Landing page: change the existing page" });
  });

  it("is read only while paused, and a viewer cannot save", async () => {
    expect((await setup("paused").call("project.addon.landingPage.save", { choice: "none" })).body).toMatchObject({ error: { messageKey: "project.landingClosed" } });
    expect((await setup("sanitization").call("project.addon.landingPage.save", { choice: "none" }, VIEWER)).status).toBe(403);
  });
});

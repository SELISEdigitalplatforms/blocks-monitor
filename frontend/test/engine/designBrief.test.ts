// The business analyst's design brief: written inside design.generate from everything Business Analysis gathered, with
// the chosen style direction and its reason; the designer's prompt carries the house principles, that direction, the
// recipes and the brief (no generic look); a revision keeps its direction unless the feedback asks for a different
// look; the hashed design intent never changes; people find the brief in "What MADP produced".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRun } from "../../server/local/engine/run";
import { designIntent, designIntentOf, factoryDesignSource, type DesignRows } from "../../src/domain/factoryDesign";
import { screenPreviewPath } from "../../src/domain/figmaScreens";

const mocks = vi.hoisted(() => ({ runner: vi.fn(), review: vi.fn() }));
vi.mock("../../server/local/engine/ai/makeRunner.ts", () => ({ makeRunner: () => mocks.runner, makeRunnerBinary: () => "unused", makeRunnerProvider: () => "claude" }));
vi.mock("../../server/local/engine/ai/figmaConfig.ts", () => ({
  figmaEngineConfig: () => ({}), reserveFigmaIteration: vi.fn(),
  assertFigmaWriteAvailable: vi.fn(), claimFigmaWrite: vi.fn(), finishFigmaWrite: vi.fn(), figmaDesignerModel: () => ({}),
  FigmaConfigurationError: class extends Error {},
}));
vi.mock("../../server/local/engine/ai/figmaUpload.ts", () => ({ startFigmaUploadBridge: () => () => {} }));
vi.mock("../../server/local/engine/ai/prototypeRunner.ts", () => ({ prototypeRunner: mocks.review }));
import { setAiRunner } from "../../server/local/engine/ai/index";
import { loadDesignKit, setDesignSkillDir, type DesignKit } from "../../server/local/engine/kinds/scope/designKit";
import {
  asksForNewLook, chooseDesignStyle, designBriefFacts, designBriefMarkdown, designerSystem, DESIGNER_SYSTEM_MAX_BYTES, FALLBACK_REASON,
  type PreparedDesignBrief, type StyleRecord,
} from "../../server/local/engine/kinds/scope/designerBrief";
import { generateFigmaScreens } from "../../server/local/engine/kinds/scope/figmaScreens";
import { writeProjectOutputs } from "../../server/engine-context/outputs";
import { listedFile } from "../../server/api/outputs/routes";
import { PRINCIPLES_MARKER, SKILL_MARKER, writeSkillTree } from "./designSkillFixture";

const GENERIC_LOOK = "a restrained palette with one confident accent colour";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==";

let root: string;
let kit: DesignKit;
const ai = vi.fn();
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "design-brief-"));
  setDesignSkillDir(writeSkillTree(root));
  kit = loadDesignKit();
  vi.clearAllMocks();
  ai.mockReset();
  setAiRunner(ai);
  mocks.review.mockResolvedValue({ status: "aligned", conflicts: [], rationale: "Presentation only." });
});
afterEach(() => { setDesignSkillDir(null); setAiRunner(null); fs.rmSync(root, { recursive: true, force: true }); });

// ------------------------------------------------------------------------------------------------- a project

function projectRows(): DesignRows {
  const project = {
    ItemId: "project1", Name: "Ledgerly", Brief: "", Goal: "Close the month in two days instead of a week",
    TargetUsers: "Accountants and finance managers at small Swiss firms", ClientIndustry: "Accounting", ClientRegion: "Switzerland", RepoMode: "new",
  };
  const requirements = [
    { ItemId: "r1", Key: "R1", Title: "Approve invoices", Text: "Finance managers approve supplier invoices.", Priority: "must", Status: "draft",
      AcceptanceCriteria: ["A finance manager sees every waiting invoice with its amount in CHF", "An approver can reject an invoice with a comment"] },
    { ItemId: "r2", Key: "R2", Title: "Capture receipts on the phone", Text: "Staff photograph receipts on their mobile phone.", Priority: "should", Status: "draft",
      AcceptanceCriteria: ["A receipt photo is attached to its expense"] },
    { ItemId: "r3", Key: "R3", Title: "Old idea", Text: "Dropped.", Status: "dropped", AcceptanceCriteria: ["Never shown"] },
  ];
  const rows: Record<string, Record<string, unknown>[]> = {
    RequirementExtra: [
      { ItemId: "x1", Kind: "workflow", Title: "Approve an invoice", Who: "Finance manager", Steps: ["Open the waiting invoices", "Check the amount", "Approve or reject"], SortOrder: 1 },
      { ItemId: "x2", Kind: "exclusion", Title: "Native mobile app", SortOrder: 1 },
      { ItemId: "x3", Kind: "constraint", ConstraintKind: "languages", Title: "German and French", SortOrder: 1 },
      { ItemId: "x4", Kind: "constraint", ConstraintKind: "other", Title: "Use our brand colour #0E5A6B and the logo from our brand guide", SortOrder: 2 },
      { ItemId: "x5", Kind: "constraint", ConstraintKind: "compliance", Title: "WCAG 2.1 AA on every screen", SortOrder: 3 },
      { ItemId: "x6", Kind: "constraint", ConstraintKind: "deadline", Title: "Live before 1 March", SortOrder: 4, Status: "removed" },
    ],
    DocNote: [{ ItemId: "n1", IsProjectBrief: true, BodyMd: "## About the project\nLedgerly keeps the books of small firms and closes each month quickly.\n\n## Goal\nFast close.\n" }],
    Clarification: [
      { ItemId: "c2", Number: 2, Question: "Which currency do invoices use?", Answer: "Always CHF, with Swiss number formats like 1'250.00.", Status: "answered" },
      { ItemId: "c1", Number: 1, Question: "Who approves invoices?", Answer: "The finance manager, or the owner above CHF 10'000.", Status: "answered" },
      { ItemId: "c3", Number: 3, Question: "Do you need reports?", Answer: "", Status: "open" },
    ],
    Objective: [{ ItemId: "o1", Statement: "Small firms close their books every month within two working days.", AcceptanceCriteria: ["The month is closed by the second working day"] }],
  };
  return { project, objective: () => rows.Objective[0], requirements: () => requirements, rows: (schema: string) => rows[schema] ?? [] };
}

function fakeRun(p: DesignRows, input: Record<string, unknown> = {}) {
  const putFile = vi.fn(async (..._args: unknown[]) => "artifact1");
  const update = vi.fn(async (..._args: unknown[]) => {});
  const run = { id: "job1", attempt: 1, projectId: "project1", workspaceId: "ws1", input: { source: factoryDesignSource(designIntentOf(p)), ...input }, p,
    signal: new AbortController().signal, job: { Progress: 0 },
    folder: () => ({ artifacts: root }), step: vi.fn(async () => {}), now: () => new Date("2026-11-08T00:00:00Z"),
    iso: () => "2026-11-08T00:00:00Z", check: vi.fn(), log: vi.fn(), putFile, update,
  } as unknown as JobRun;
  return { run, putFile, update };
}

const choice = (over: Partial<StyleRecord> = {}): StyleRecord => ({ version: 1, styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: "Finance teams read ledgers all day; a calm, exact look suits them.", how: "chosen", previousStyleId: null, previousStyleName: null, ...over });

// ------------------------------------------------------------------------------------------------- the brief

describe("the design brief", () => {
  it("holds the product, the objective, the users, devices, every requirement, workflows, exclusions, constraints, answers and the style with its reason", () => {
    const facts = designBriefFacts(projectRows());
    const md = designBriefMarkdown(facts, kit.styles.find((s) => s.id === "quiet-ledger")!, choice());
    expect(md).toMatch(/^# Design brief: Ledgerly\n/);
    expect(md).toContain("_Written by the business analyst for the screen designer from what Business Analysis gathered._");
    expect(md).toContain("Ledgerly keeps the books of small firms and closes each month quickly.");
    expect(md).toContain("- Kind of product: New product");
    expect(md).toContain("- Industry: Accounting");
    expect(md).toContain("Small firms close their books every month within two working days.");
    expect(md).toContain("Goal in the client's words: Close the month in two days instead of a week");
    expect(md).toContain("- The month is closed by the second working day");
    expect(md).toContain("Accountants and finance managers at small Swiss firms");
    expect(md).toContain("Roles in the workflows: Finance manager.");
    // devices: phone use named by R2, the native app set aside
    expect(md).toContain("- Phone: 390 px frames of the key flows. Phone use is mentioned in:");
    expect(md).toContain("Capture receipts on the phone (R2)");
    expect(md).toContain('- Left out of this version: "Native mobile app".');
    // every requirement with its user-facing criteria; a dropped one never
    expect(md).toContain("## Requirements (2)");
    expect(md).toContain("### R1. Approve invoices _(must)_");
    expect(md).toContain("- AC1: A finance manager sees every waiting invoice with its amount in CHF");
    expect(md).toContain("- AC2: An approver can reject an invoice with a comment");
    expect(md).toContain("### R2. Capture receipts on the phone _(should)_");
    expect(md).not.toContain("Old idea");
    expect(md).toContain("- **Approve an invoice** (Finance manager): Open the waiting invoices → Check the amount → Approve or reject");
    expect(md).toContain("## Not included\n\n- Native mobile app");
    // constraints, the removed one left out
    expect(md).toContain("- Languages: German and French");
    expect(md).toContain("- Compliance: WCAG 2.1 AA on every screen");
    expect(md).not.toContain("Live before 1 March");
    expect(md).toMatch(/### Brand\n\n- Use our brand colour #0E5A6B and the logo from our brand guide \(constraint\)/);
    expect(md).toMatch(/### Languages\n\n- Languages: German and French/);
    expect(md).toContain("- Compliance: WCAG 2.1 AA on every screen (constraint)");
    expect(md).toContain("- Dates, times, numbers and money in the format of Switzerland.");
    expect(md).toContain("Always CHF, with Swiss number formats like 1'250.00. (answer to Q2)");
    // answered questions in their order; an open one never
    expect(md.indexOf("**Q1. Who approves invoices?**")).toBeLessThan(md.indexOf("**Q2. Which currency do invoices use?**"));
    expect(md).not.toContain("Do you need reports?");
    // the chosen style and why
    expect(md).toContain("## Style direction: Quiet Ledger");
    expect(md).toContain("A calm back-office look on warm paper with a petrol accent: exact, unhurried.");
    expect(md).toContain("- Why: Finance teams read ledgers all day; a calm, exact look suits them.");
    expect(md).toContain("- How it was chosen: Chosen by the business analyst from the house style directions for this product.");
    expect(md).toContain("- Density: dense-but-airy");
    expect(md).not.toMatch(/\bAI\b/);
  });

  it("says plainly what was not recorded", () => {
    const empty: DesignRows = { project: { Name: "Kiosk" }, objective: () => undefined, requirements: () => [], rows: () => [] };
    const md = designBriefMarkdown(designBriefFacts(empty), kit.styles[0], choice({ styleId: kit.styles[0].id, styleName: kit.styles[0].name, reason: FALLBACK_REASON, how: "default" }));
    expect(md).toContain("No description of the product was recorded.");
    expect(md).toContain("- Phone: not mentioned in the requirements, the answers or the setup, so no phone frames are required.");
    expect(md).toContain("No requirements were recorded.");
    expect(md).toContain("No brand colours, logo or typeface were given: the style direction sets them.");
    expect(md).toContain(`- Why: ${FALLBACK_REASON}`);
    expect(md).toContain("The house default direction, the closest general fit.");
  });
});

// ------------------------------------------------------------------------------------------------- the style

describe("choosing the style direction", () => {
  const facts = () => designBriefFacts(projectRows());
  it("takes the direction the business analyst chose from the catalogue, with its reason", async () => {
    ai.mockResolvedValue({ styleId: "quiet-ledger", reason: "Accountants work in ledgers; a calm, exact look fits them." });
    const { run } = fakeRun(projectRows());
    expect(await chooseDesignStyle(run, kit, facts())).toMatchObject({ styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: "Accountants work in ledgers; a calm, exact look fits them.", how: "chosen" });
    const request = ai.mock.calls[0][0];
    expect(request.schema.properties.styleId.enum).toEqual(["field-bright", "quiet-ledger"]);
    expect(request.prompt).toContain('"product":"Ledgerly"');
    expect(request.prompt).toContain('"use_when":["accounting and invoicing","finance teams, on desktop"]');
    expect(request.prompt).toContain('"devices":"desktop and phone"');
  });
  it.each([
    ["a direction that is not in the catalogue", async () => ({ styleId: "neon-dream", reason: "Looks great." })],
    ["an empty reason", async () => ({ styleId: "field-bright", reason: " " })],
    ["no answer at all", async () => { throw new Error("runner offline"); }],
  ])("falls back to the README's default with the reason 'closest general fit' for %s", async (_what, answer) => {
    ai.mockImplementation(answer);
    const { run } = fakeRun(projectRows());
    expect(await chooseDesignStyle(run, kit, facts())).toMatchObject({ styleId: "quiet-ledger", reason: FALLBACK_REASON, how: "default" });
  });
  it("falls back to the default when the engine asks no one (AI off)", async () => {
    setAiRunner(null);
    const { run } = fakeRun(projectRows());
    expect(await chooseDesignStyle(run, kit, facts())).toMatchObject({ styleId: "quiet-ledger", reason: FALLBACK_REASON, how: "default" });
  });
  it("never lets a reason name the machinery", async () => {
    ai.mockResolvedValue({ styleId: "field-bright", reason: "The AI picked this." });
    const { run } = fakeRun(projectRows());
    const r = await chooseDesignStyle(run, kit, facts());
    expect(r.styleId).toBe("field-bright");
    expect(r.reason).toBe("It suits Ledgerly and its users best among the house style directions.");
  });

  it("knows feedback that asks for a different look", () => {
    for (const f of ["Make it feel warmer and friendlier", "Can we try a darker theme?", "The colours are too dull", "Use a more playful style", "It looks dated"]) expect(asksForNewLook(f), f).toBe(true);
    for (const f of ["Move the approve button next to the amount", "Add the due date to each row", "The table needs a column for the supplier"]) expect(asksForNewLook(f), f).toBe(false);
  });

  const previous = { styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: "Finance teams read ledgers all day." };
  it("keeps the previous design's direction for feedback about the content, without asking again", async () => {
    const { run } = fakeRun(projectRows());
    const r = await chooseDesignStyle(run, kit, facts(), { previous, feedback: "Add the due date to each row" });
    expect(r).toMatchObject({ styleId: "quiet-ledger", reason: "Finance teams read ledgers all day.", how: "kept", previousStyleId: "quiet-ledger" });
    expect(ai).not.toHaveBeenCalled();
    expect(designBriefMarkdown(facts(), kit.styles.find((s) => s.id === "quiet-ledger")!, r, { feedback: "Add the due date to each row", revision: true }))
      .toContain("- How it was chosen: Kept from the previous design; nothing in the feedback asks for a different look.");
  });
  it("chooses again with the feedback when it asks for a different look, and the brief says so", async () => {
    ai.mockResolvedValue({ styleId: "field-bright", reason: "They ask for a bolder, high-visibility look.", asksForDifferentLook: true });
    const { run } = fakeRun(projectRows());
    const feedback = "Make it bolder and brighter, the colours are too dull";
    const r = await chooseDesignStyle(run, kit, facts(), { previous, feedback });
    expect(r).toMatchObject({ styleId: "field-bright", how: "changed", previousStyleId: "quiet-ledger", previousStyleName: "Quiet Ledger" });
    expect(ai.mock.calls[0][0].prompt).toContain('The previous design used the direction "quiet-ledger"');
    expect(ai.mock.calls[0][0].prompt).toContain(JSON.stringify(feedback));
    expect(ai.mock.calls[0][0].schema.required).toEqual(["styleId", "reason", "asksForDifferentLook"]);
    const md = designBriefMarkdown(facts(), kit.styles.find((s) => s.id === "field-bright")!, r, { feedback, revision: true });
    expect(md).toContain("Changed for this revision: the feedback asks for a different look, so Quiet Ledger gives way to Field Bright.");
    expect(md).toContain(`## Feedback for this revision\n\n> ${feedback}`);
    expect(md).toContain("for a revision of the previous design");
  });
  it("keeps the direction when asked again and it still fits best, when the feedback turns out to be about the content, or when no answer comes", async () => {
    const { run } = fakeRun(projectRows());
    ai.mockResolvedValue({ styleId: "quiet-ledger", reason: "Still the calmest fit for ledgers.", asksForDifferentLook: true });
    expect(await chooseDesignStyle(run, kit, facts(), { previous, feedback: "Warmer colours please" })).toMatchObject({ styleId: "quiet-ledger", reason: "Still the calmest fit for ledgers.", how: "keptAfterFeedback" });
    setAiRunner(vi.fn(async () => ({ styleId: "field-bright", reason: "Bolder.", asksForDifferentLook: false })));
    const within = await chooseDesignStyle(run, kit, facts(), { previous, feedback: "I feel the list needs a supplier filter" });
    expect(within).toMatchObject({ styleId: "quiet-ledger", reason: "Finance teams read ledgers all day.", how: "kept" });
    expect(designBriefMarkdown(facts(), kit.styles.find((s) => s.id === "quiet-ledger")!, within, { feedback: "I feel the list needs a supplier filter" })).toContain("nothing in the feedback asks for a different look");
    setAiRunner(vi.fn(async () => { throw new Error("offline"); }));
    const unchecked = await chooseDesignStyle(run, kit, facts(), { previous, feedback: "Warmer colours please" });
    expect(unchecked).toMatchObject({ styleId: "quiet-ledger", reason: "Finance teams read ledgers all day.", how: "keptUnchecked" });
    expect(designBriefMarkdown(facts(), kit.styles.find((s) => s.id === "quiet-ledger")!, unchecked, { feedback: "Warmer colours please" })).toContain("- How it was chosen: Kept from the previous design; the feedback is applied within this direction.");
  });
  it("chooses afresh when the previous direction is no longer in the catalogue", async () => {
    ai.mockResolvedValue({ styleId: "field-bright", reason: "Crews outdoors." });
    const { run } = fakeRun(projectRows());
    expect(await chooseDesignStyle(run, kit, facts(), { previous: { styleId: "retired", styleName: "Retired", reason: "x" }, feedback: "Add a column" }))
      .toMatchObject({ styleId: "field-bright", how: "chosen", previousStyleId: "retired" });
  });
});

// ------------------------------------------------------------------------------------------------- the designer's prompt

describe("the designer's prompt", () => {
  const prepared = (brief: string): PreparedDesignBrief => ({ facts: designBriefFacts(projectRows()), style: kit.styles.find((s) => s.id === "quiet-ledger")!, record: choice(), brief, recipes: kit.recipes });
  it("holds the skill, the principles, the chosen direction, the recipes and the brief, in that order", () => {
    const system = designerSystem({ kit, prepared: prepared("# Design brief: Ledgerly\n\nBRIEF MARKER\n"), instructions: "INSTRUCTIONS MARKER", withSkill: true });
    const at = (s: string) => { const i = system.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    expect(at(SKILL_MARKER)).toBeLessThan(at(PRINCIPLES_MARKER));
    expect(at(PRINCIPLES_MARKER)).toBeLessThan(at("STYLE MARKER quiet-ledger"));
    expect(at("STYLE MARKER quiet-ledger")).toBeLessThan(at("RECIPE MARKER list-pages"));
    expect(at("RECIPE MARKER list-pages")).toBeLessThan(at("BRIEF MARKER"));
    expect(at("BRIEF MARKER")).toBeLessThan(at("INSTRUCTIONS MARKER"));
    expect(system).toContain("Why it was chosen: Finance teams read ledgers all day; a calm, exact look suits them.");
    expect(system).not.toContain("STYLE MARKER field-bright");
  });
  it("stays within what one command-line argument may carry, keeping the brief before the recipes", () => {
    const huge = `# Design brief: Ledgerly\n\n${"- AC1: a long acceptance criterion about invoices and approvals\n".repeat(3000)}`;
    const big = { ...prepared(huge), recipes: kit.recipes.map((r) => ({ ...r, text: `${r.text}\n${"recipe line\n".repeat(4000)}` })) };
    const system = designerSystem({ kit, prepared: big, instructions: "INSTRUCTIONS MARKER", withSkill: true });
    expect(Buffer.byteLength(system)).toBeLessThanOrEqual(DESIGNER_SYSTEM_MAX_BYTES);
    expect(system).toContain("The brief goes on in design-brief.md in the working directory");
    expect(system).toContain(PRINCIPLES_MARKER);
    expect(system).toContain("STYLE MARKER quiet-ledger");
    expect(system).toContain("INSTRUCTIONS MARKER");
  });
});

// ------------------------------------------------------------------------------------------------- the screen design job

function figmaResult(dir: string) {
  return async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "approvals.png"), Buffer.from(png, "base64"));
    fs.writeFileSync(path.join(dir, "ux-plan.md"), "UX plan");
    fs.writeFileSync(path.join(dir, "design-master.md"), "Design master");
    return { projectUrl: "https://www.figma.com/design/abc/Ledgerly", error: null,
      screens: [{ name: "Approvals", nodeId: "3:2", file: "approvals.png", requirementKeys: ["R1", "R2"] }],
      coverage: [{ key: "R1", screens: ["3:2"], criteria: ["AC1", "AC2"], noScreenReason: null }, { key: "R2", screens: ["3:2"], criteria: ["AC1"], noScreenReason: null }] };
  };
}

describe("design.generate (Figma screens)", () => {
  it("writes the brief before drawing and draws from the principles, the chosen direction and the brief, never the generic look", async () => {
    const p = projectRows();
    const intentBefore = JSON.stringify(designIntentOf(p));
    const sourceBefore = factoryDesignSource(designIntentOf(p));
    ai.mockResolvedValue({ styleId: "quiet-ledger", reason: "Accountants work in ledgers; a calm, exact look fits them." });
    const dir = path.join(root, "figma-screens", "job1");
    let briefAtDrawing = "";
    mocks.runner.mockImplementation(async (...args: unknown[]) => { briefAtDrawing = fs.readFileSync(path.join(dir, "design-brief.md"), "utf8"); return figmaResult(dir)(...(args as [])); });
    const { run, update, putFile } = fakeRun(p);
    await generateFigmaScreens(run, { ItemId: "brief1" });

    const request = mocks.runner.mock.calls[0][0];
    expect(request.system).toContain(SKILL_MARKER);
    expect(request.system).toContain(PRINCIPLES_MARKER);
    expect(request.system).toContain("STYLE MARKER quiet-ledger");
    expect(request.system).toContain("RECIPE MARKER app-shell");
    expect(request.system).toContain("# Design brief: Ledgerly");
    expect(request.system).toContain("- Why: Accountants work in ledgers; a calm, exact look fits them.");
    expect(request.system).toContain("follow the chosen style direction and the house principles");
    expect(request.system).not.toContain(GENERIC_LOOK);
    expect(request.system).not.toContain("polished, modern product look");
    // the Figma steps, the coverage rules and the workspace are unchanged
    expect(request.system).toContain("drawn with use_figma");
    expect(request.system).toContain("native-frame-receipt.json");
    expect(request.system).toContain("Requirement map (coverage)");
    // the brief was there when drawing started, and stays as the records say it
    expect(briefAtDrawing).toContain("## Style direction: Quiet Ledger");
    expect(fs.readFileSync(path.join(dir, "design-brief.md"), "utf8")).toBe(briefAtDrawing);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "design-style.json"), "utf8"))).toMatchObject({ styleId: "quiet-ledger", how: "chosen" });
    // the intent (and its hash) is the one the job was queued with: no style, no brief
    const prompt = JSON.parse(request.prompt);
    expect(JSON.stringify(prompt.intent)).toBe(intentBefore);
    expect(Object.keys(prompt.intent)).toEqual(["version", "project", "objective", "requirements", "extras"]);
    expect(intentBefore).not.toContain("quiet-ledger");
    const prototype = JSON.parse(String((update.mock.calls[0][2] as { PrototypeJson: string }).PrototypeJson));
    expect(prototype.source).toBe(sourceBefore);
    expect(prototype.source).toBe(factoryDesignSource(designIntent(p.project, p.objective(), p.requirements(), p.rows("RequirementExtra"), { notes: p.rows("DocNote"), clarifications: p.rows("Clarification") })));
    // the chosen style lives with the design
    expect(prototype.style).toEqual({ styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: "Accountants work in ledgers; a calm, exact look fits them." });
    const artifact = JSON.parse(Buffer.from(putFile.mock.calls[0][2] as Uint8Array).toString());
    expect(artifact.style).toEqual(prototype.style);
    expect(artifact.designBrief).toBe(briefAtDrawing);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default direction and still draws when the style cannot be chosen", async () => {
    ai.mockRejectedValue(new Error("offline"));
    const dir = path.join(root, "figma-screens", "job1");
    mocks.runner.mockImplementation(figmaResult(dir));
    const { run, update } = fakeRun(projectRows());
    await generateFigmaScreens(run, { ItemId: "brief1" });
    expect(mocks.runner.mock.calls[0][0].system).toContain("- Why: closest general fit");
    expect(JSON.parse(String((update.mock.calls[0][2] as { PrototypeJson: string }).PrototypeJson)).style).toEqual({ styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: FALLBACK_REASON });
  });

  const previousDesign = (styleId: string, styleName: string) => {
    const revision = "a".repeat(64);
    return { revision, json: JSON.stringify({ provider: "figma-design", projectId: "project1", projectUrl: "https://www.figma.com/design/old/Ledgerly", revision, source: "pending:job1", jobId: "job0",
      artifactFileId: "artifact0", previewUrl: screenPreviewPath("project1", revision), screens: [{ name: "Approvals", nodeId: "1:1", requirementKeys: ["R1"] }],
      style: { styleId, styleName, reason: "Finance teams read ledgers all day." } }) };
  };
  it("keeps the previous design's direction for a revision whose feedback is about the content", async () => {
    const prev = previousDesign("field-bright", "Field Bright");
    const dir = path.join(root, "figma-screens", "job1");
    mocks.runner.mockImplementation(figmaResult(dir));
    const { run, update } = fakeRun(projectRows(), { previousRevision: prev.revision, feedback: "Add the supplier to each row" });
    await generateFigmaScreens(run, { ItemId: "brief1", PrototypeJson: prev.json });
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(ai).not.toHaveBeenCalled();
    const request = mocks.runner.mock.calls[0][0];
    expect(request.system).toContain("STYLE MARKER field-bright");
    expect(request.system).toContain("Kept from the previous design; nothing in the feedback asks for a different look.");
    expect(JSON.parse(request.prompt).instructions).toMatch(/^Apply feedback to the previous visual direction if provided\./);
    expect(JSON.parse(String((update.mock.calls[0][2] as { PrototypeJson: string }).PrototypeJson)).style.styleId).toBe("field-bright");
  });
  it("chooses again for a revision whose feedback asks for a different look, and tells the designer", async () => {
    const prev = previousDesign("field-bright", "Field Bright");
    ai.mockResolvedValue({ styleId: "quiet-ledger", reason: "They ask for a calmer, more serious look.", asksForDifferentLook: true });
    const dir = path.join(root, "figma-screens", "job1");
    mocks.runner.mockImplementation(figmaResult(dir));
    const { run, update } = fakeRun(projectRows(), { previousRevision: prev.revision, feedback: "Too loud: make it calmer and more serious, softer colours" });
    await generateFigmaScreens(run, { ItemId: "brief1", PrototypeJson: prev.json });
    const request = mocks.runner.mock.calls[0][0];
    expect(request.system).toContain("STYLE MARKER quiet-ledger");
    expect(request.system).toContain("Changed for this revision: the feedback asks for a different look, so Field Bright gives way to Quiet Ledger.");
    expect(JSON.parse(request.prompt).instructions).toContain("apply it with the newly chosen style direction");
    expect(JSON.parse(String((update.mock.calls[0][2] as { PrototypeJson: string }).PrototypeJson)).style).toEqual({ styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: "They ask for a calmer, more serious look." });
  });

  it("draws a resumed job in the direction it recorded, without choosing again", async () => {
    const dir = path.join(root, "figma-screens", "job1");
    fs.mkdirSync(dir, { recursive: true });
    const p = projectRows();
    fs.writeFileSync(path.join(dir, "started.json"), JSON.stringify({ source: factoryDesignSource(designIntentOf(p)), jobId: "job1", artifactVersion: 2 }));
    fs.writeFileSync(path.join(dir, "native-frame-receipt.json"), JSON.stringify({ projectUrl: "https://www.figma.com/design/abc/Ledgerly", nodeIds: ["3:2"] }));
    fs.writeFileSync(path.join(dir, "design-style.json"), JSON.stringify(choice({ styleId: "field-bright", styleName: "Field Bright", reason: "Recorded earlier." })));
    mocks.runner.mockImplementation(figmaResult(dir));
    const { run } = fakeRun(p);
    await generateFigmaScreens(run, { ItemId: "brief1" });
    expect(ai).not.toHaveBeenCalled();
    expect(mocks.runner.mock.calls[0][0].system).toContain("STYLE MARKER field-bright");
    expect(mocks.runner.mock.calls[0][0].system).toContain("RESUME EXISTING FRAMES");
  });

  it("fails before any design work when the release lacks the house principles", async () => {
    setDesignSkillDir(writeSkillTree(path.join(root, "broken"), { principles: false }));
    const { run, update } = fakeRun(projectRows());
    await expect(generateFigmaScreens(run, { ItemId: "brief1" })).rejects.toMatchObject({ code: "design.principlesMissing" });
    expect(mocks.runner).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------------- what people see

describe("What MADP produced", () => {
  it("lists each design job's brief as \"Design brief\" with its style direction, served by the outputs route", async () => {
    const project = path.join(root, "projects", "ws-1", "p-1");
    const job = path.join(project, "artifacts", "figma-screens", "job1");
    fs.mkdirSync(job, { recursive: true });
    fs.writeFileSync(path.join(project, "project.json"), JSON.stringify({ projectId: "p-1", workspaceId: "ws-1", name: "Ledgerly" }));
    fs.writeFileSync(path.join(job, "design-brief.md"), "# Design brief: Ledgerly\n");
    fs.writeFileSync(path.join(job, "design-style.json"), JSON.stringify(choice()));
    fs.writeFileSync(path.join(job, "design-master.md"), "Design master");
    const m = await writeProjectOutputs(project);
    const item = m.sections.find((s) => s.id === "planning")?.items.find((i) => i.title === "Design brief");
    expect(item).toMatchObject({ path: "figma-screens/job1/design-brief.md", kind: "md", status: "info", group: "Screen designs",
      summary: "What the business analyst gave the designer: the product, its users, every requirement and the style direction (Quiet Ledger)." });
    const artifacts = path.join(project, "artifacts");
    const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, "outputs.json"), "utf8"));
    expect(listedFile(artifacts, manifest, "figma-screens/job1/design-brief.md")).toBe(path.join(artifacts, "figma-screens", "job1", "design-brief.md"));
    expect(listedFile(artifacts, manifest, "figma-screens/job1/design-style.json")).toBeNull();
  });
});

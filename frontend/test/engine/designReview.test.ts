// The design review inside design.generate: the designer runs on the strongest model at high effort; every exported
// screen is scored against a rubric from the house principles, the chosen style and the recipes' common mistakes; the
// screens below the bar are polished in the same Figma file and checked again (at most two rounds, stopping early);
// a review that cannot be completed keeps the first drawing and says so; only Figma failing fails the job.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRun } from "../../server/local/engine/run";
import { JobFailure, JobGone } from "../../server/local/engine/run";
import { designIntentOf, factoryDesignSource, type DesignRows } from "../../src/domain/factoryDesign";

const mocks = vi.hoisted(() => ({ runner: vi.fn(), provider: vi.fn(() => "claude"), config: {} as Record<string, unknown> }));
vi.mock("../../server/local/engine/ai/makeRunner.ts", () => ({ makeRunner: () => mocks.runner, makeRunnerBinary: () => "/usr/bin/claude", makeRunnerProvider: mocks.provider }));
vi.mock("../../server/local/engine/ai/figmaConfig.ts", async (original) => ({
  ...await original<typeof import("../../server/local/engine/ai/figmaConfig")>(),
  figmaEngineConfig: () => mocks.config, reserveFigmaIteration: vi.fn(),
  assertFigmaWriteAvailable: vi.fn(), claimFigmaWrite: vi.fn(), finishFigmaWrite: vi.fn(),
}));
vi.mock("../../server/local/engine/ai/figmaUpload.ts", () => ({ startFigmaUploadBridge: () => () => {} }));
import {
  brandColourOf, commonMistakes, COUNTS, designQualityBar, onBrandHue, parseReview, polishInstructions, polishRequest, POLISH_FIGMA_FAILURE, REJECTED_ANCHOR,
  restraintSection, REVIEW_CRITERIA, REVIEW_SCALE, REVIEW_STEPS, reviewBatches, reviewRubric, reviewSection, reviewSystem, ReviewRejected, runDesignReview,
  writeReviewSection, type ReviewLoop, type ReviewScreen,
} from "../../server/local/engine/kinds/scope/designReview";
import { drawingTimeoutMs, generateFigmaScreens, polishTimeoutMs } from "../../server/local/engine/kinds/scope/figmaScreens";
import { setDesignSkillDir } from "../../server/local/engine/kinds/scope/designKit";
import { PRINCIPLES_MARKER, writeSkillTree } from "./designSkillFixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==", "base64");
/** A valid export whose bytes differ per version (bytes after IEND are kept by the export checks). */
const png = (tag: string) => Buffer.concat([PNG, Buffer.from(tag)]);
const ALL = (n: number) => Object.fromEntries(REVIEW_CRITERIA.map((c) => [c.id, n])) as Record<string, number>;
const fix = { kind: "change", criterion: "composition", where: "the form card", what: "Open up the card", how: "32 px between the groups, 24 px padding" };
const ZERO = Object.fromEntries(COUNTS.map((c) => [c.id, 0])) as Record<string, number>;
/** One screen of a review answer: ships when every score is 8 or more. */
const entry = (file: string, scores: Record<string, number>, fixes: unknown[] = [], extra: Record<string, unknown> = {}) =>
  ({ file, verdict: "", counts: ZERO, accent: "#0E5A6B", onBrand: true, scores, ship: Object.values(scores).every((v) => v >= 8), fixes, ...extra });
const AI_WORDS = /\b(AI|A\.I\.|artificial intelligence|LLM|language model|chatbot|agent)\b/i;

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "design-review-")); vi.clearAllMocks(); mocks.provider.mockReturnValue("claude"); mocks.config = {}; });
afterEach(() => { setDesignSkillDir(null); fs.rmSync(root, { recursive: true, force: true }); });

// ------------------------------------------------------------------------------------------------- configuration

describe("the designer's time limits", () => {
  it("gives the drawing an hour on Claude (or the operator's limit) and each polish round half of it", () => {
    expect(drawingTimeoutMs({}, "claude")).toBe(3_600_000);
    expect(drawingTimeoutMs({}, "codex")).toBe(900_000);
    expect(drawingTimeoutMs({ timeoutMinutes: 90 }, "claude")).toBe(5_400_000);
    expect(polishTimeoutMs(3_600_000)).toBe(1_800_000);
    expect(polishTimeoutMs(900_000)).toBe(600_000);
  });
});

// ------------------------------------------------------------------------------------------------- the rubric

const RECIPE = `---
id: sign-in
name: Sign-in and account
applies_to: ["sign-in"]
---

# Sign-in and account

## Phone (390 px)
- One column, a brand strip on top.

## Common mistakes
- Raw server text ("401 Unauthorized") or revealing whether an account exists.
- Password rules shown only after
  a failed attempt.
- A stock photo with filler copy.
`;

describe("the review rubric", () => {
  it("reads every item of a recipe's common mistakes, including those that go on over the next line", () => {
    expect(commonMistakes(RECIPE)).toEqual([
      'Raw server text ("401 Unauthorized") or revealing whether an account exists.',
      "Password rules shown only after a failed attempt.",
      "A stock photo with filler copy.",
    ]);
    expect(commonMistakes("# No mistakes section\n\n- a list item\n")).toEqual([]);
  });
  it("holds the nine criteria with the bar, the house principles, the chosen style and the recipes' common mistakes", () => {
    const rubric = reviewRubric({ principles: `# House design principles\n\n${PRINCIPLES_MARKER}`, style: { name: "Still Water", file: "styles/still-water.md", text: "STYLE TEXT teal #077367" },
      recipes: [{ name: "Sign-in and account", text: RECIPE }, { name: "No mistakes", text: "# Nothing\n" }] });
    for (const c of REVIEW_CRITERIA) expect(rubric).toContain(`**${c.name}** (\`${c.id}\`)`);
    expect(REVIEW_CRITERIA.map((c) => c.id)).toEqual(["colour", "composition", "typography", "space", "hierarchy", "consistency", "content", "craft", "accessibility"]);
    expect(rubric).toContain('A screen passes only when every criterion scores 8 or more out of 10 AND the overall verdict "would it ship, exactly as it is, in a top design-led product?" is yes.');
    expect(rubric).toContain(PRINCIPLES_MARKER);
    expect(rubric).toContain("## The chosen style direction: Still Water (styles/still-water.md)");
    expect(rubric).toContain("STYLE TEXT teal #077367");
    expect(rubric).toContain("### Sign-in and account\n- Raw server text");
    expect(rubric).not.toContain("### No mistakes");
    // no criterion asks to fill space or add richness any more
    expect(REVIEW_CRITERIA.find((c) => c.id === "space")!.check).toMatch(/Whitespace that frames the focal point is good space, never a defect/);
    expect(rubric).not.toMatch(/fills its whole height|Depth and layering|signature elements/);
  });
  it("writes the calibrated scale with its anchors, the owner's rejected 4/10 design and skeptical scoring rules", () => {
    const rubric = reviewRubric({ principles: "# House design principles\n", recipes: [] });
    expect(REVIEW_SCALE.map((l) => l.split(":")[0])).toEqual(["9-10", "7-8", "5-6", "3-4", "1-2"]);
    for (const l of REVIEW_SCALE) expect(rubric).toContain(`- ${l}`);
    expect(rubric).toMatch(/- 9-10: indistinguishable from a top design-led product: calm, spacious, crisp type, a restrained harmonious palette, one clear focal point, nothing extra/);
    expect(rubric).toMatch(/- 7-8: good, but with visible clutter or weak hierarchy/);
    expect(rubric).toMatch(/- 5-6: clean but generic .* OR busy/);
    expect(rubric).toMatch(/- 3-4: congested, a muddy palette, heavy weights, small cramped text/);
    expect(rubric).toMatch(/- 1-2: broken/);
    expect(rubric).toContain(`### The 4/10 anchor\n\n${REJECTED_ANCHOR}`);
    expect(REJECTED_ANCHOR).toMatch(/berry gradient hero.*sun-gold disc/);
    expect(REJECTED_ANCHOR).toMatch(/cut off with an ellipsis/);
    expect(rubric).toContain("Default to skepticism");
    expect(rubric).toContain("Whitespace is not a defect");
    expect(rubric).toContain("Richness never earns a point");
    // the counted limits, each with its criterion
    for (const c of COUNTS) expect(rubric).toContain(`\`${c.id}\``);
    expect(rubric).toContain("`supportHues` (colour harmony and restraint, limit 1)");
    expect(rubric).toContain("`nestedBoxes` (composition, whitespace and congestion, limit 0)");
    // the owner's four complaints are their own criteria
    expect(REVIEW_CRITERIA.slice(0, 4).map((c) => c.name)).toEqual(["Colour harmony and restraint", "Composition, whitespace and congestion", "Typography", "Space optimisation"]);
    expect(REVIEW_CRITERIA.find((c) => c.id === "composition")!.check).toMatch(/No box inside a box.*Nothing truncated/);
    expect(REVIEW_CRITERIA.find((c) => c.id === "typography")!.check).toMatch(/weights mostly regular and medium/);
    expect(REVIEW_CRITERIA.find((c) => c.id === "colour")!.check).toMatch(/neutral canvas, one primary accent .* at most one support hue/);
  });
  it("lifts the principles' restraint section, in full, above the criteria and does not repeat it", () => {
    const section = "## 2. Super stylish: restraint with intent (the bar)\n- At most 4 blocks on a phone screen.\n- Weights 400 and 500; 600 only for the title.\n\n### Colour\n- One support hue.";
    const principles = `# House design principles\n\nIntro.\n\n## 1. Launch quality\n- Real.\n\n${section}\n\n## 3. Truthful screens\n- True.\n`;
    expect(restraintSection(principles)).toEqual({ section, rest: "# House design principles\n\nIntro.\n\n## 1. Launch quality\n- Real.\n\n## 3. Truthful screens\n- True." });
    const rubric = reviewRubric({ principles, recipes: [] });
    expect(rubric).toContain(section);
    expect(rubric.indexOf(section)).toBeLessThan(rubric.indexOf("## House principles (PRINCIPLES.md)"));
    expect(rubric.split("Super stylish")).toHaveLength(2);
    expect(rubric).toContain("## 3. Truthful screens");
    expect(restraintSection("# P\n\n## 1. Other\n").section).toBeNull();
  });
  it("reads the brief's brand colour and judges an accent by its hue family", () => {
    expect(brandColourOf(["Our brand colour is deep teal #0F766E (setup)", "Logo in white"])).toEqual({ hex: "#0F766E", name: "deep teal", said: "Our brand colour is deep teal #0F766E (setup)" });
    expect(brandColourOf(["The brand colour is deep teal (Q4)"])).toMatchObject({ hex: null, name: "deep teal" });
    expect(brandColourOf(["We have no brand colours yet (Q4)"])).toBeNull();
    expect(brandColourOf(["Use calm colours for older patients"])).toBeNull();
    expect(onBrandHue("#0B5C56", "#0F766E")).toBe(true);
    expect(onBrandHue("#14B8A6", "#0F766E")).toBe(true);
    expect(onBrandHue("#AB285C", "#0F766E")).toBe(false);
    expect(onBrandHue("#2A2A2A", "#111111")).toBe(true);
    expect(onBrandHue("#0F766E", "#111111")).toBe(false);
    const rubric = reviewRubric({ principles: "# P", recipes: [], brand: brandColourOf(["Brand colour deep teal #0F766E"]) });
    expect(rubric).toContain("The brief names the brand colour: deep teal #0F766E");
    expect(rubric).toContain("fails colour harmony (at most 4)");
    expect(reviewRubric({ principles: "# P", recipes: [] })).toContain("The brief names no brand colour");
  });
  it("makes the reviewer a skeptical director who lists removals and merges before changes and never adds decoration", () => {
    const system = reviewSystem("# Screen review rubric", null);
    expect(system).toContain("demanding senior design director");
    expect(system).toContain("Default to skepticism");
    expect(system.indexOf("REMOVE")).toBeLessThan(system.indexOf("MERGE"));
    expect(system.indexOf("MERGE")).toBeLessThan(system.indexOf("CHANGE"));
    expect(system).toContain("Never suggest adding a decorative element");
    expect(system).toContain("never fill whitespace");
  });
  it("tells the designer the same bar before drawing", () => {
    const bar = designQualityBar();
    for (const c of REVIEW_CRITERIA) expect(bar).toContain(c.name);
    expect(bar).toContain("8 or more on each");
    expect(bar).toContain("would it ship, exactly as it is, in a top design-led product?");
    expect(bar).toContain("restraint with intent");
    expect(bar).not.toMatch(/flat white boxes/);
  });
});

// ------------------------------------------------------------------------------------------------- the answer

const screens = (n: number, w = 390): ReviewScreen[] => Array.from({ length: n }, (_, i) => ({ name: `Screen ${i + 1}`, nodeId: `1:${i + 1}`, file: `screen-${i + 1}.png`, width: w, height: 844, bytes: 2000 }));

describe("a review answer", () => {
  const expected = screens(2);
  it("is read per screen by its file name, with its scores, verdict and fixes", () => {
    const r = parseReview({ screens: [
      { ...entry("./screen-2.png", ALL(9)), verdict: "  Ready  to ship. " },
      { ...entry("screen-1.png", { ...ALL(9), composition: 6 }, [fix, { kind: "change", criterion: "nonsense", where: "x", what: "y", how: "z" }, { kind: "change", criterion: "space", where: "", what: "y", how: "z" }]), verdict: "Busy." },
      { ...entry("screen-1.png", ALL(1)), verdict: "a second entry is ignored" },
    ] }, expected);
    expect(r.map((x) => x.file)).toEqual(["screen-1.png", "screen-2.png"]);
    expect(r[0]).toMatchObject({ name: "Screen 1", nodeId: "1:1", verdict: "Busy.", fixes: [fix], ship: false, breaches: [] });
    expect(r[0].scores.composition).toBe(6);
    expect(r[1].verdict).toBe("Ready to ship.");
  });
  it("is refused when a screen is missing, a score is not a whole number from 1 to 10, or a weak screen has no usable fix", () => {
    const ok = entry("screen-2.png", ALL(9));
    expect(() => parseReview({ screens: [ok] }, expected)).toThrow(new ReviewRejected("no review for screen-1.png"));
    expect(() => parseReview(null, expected)).toThrow(ReviewRejected);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", scores: { ...ALL(9), craft: 11 } }] }, expected)).toThrow(/craft is not a score from 1 to 10/);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", scores: { ...ALL(9), craft: 7.5 } }] }, expected)).toThrow(/craft/);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", scores: { ...ALL(9), content: undefined } }] }, expected)).toThrow(/content/);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", scores: { ...ALL(9), space: 5 }, fixes: [{ kind: "change", criterion: "space", where: "", what: "", how: "" }] }] }, expected))
      .toThrow(/below the bar without fixes/);
    // the new parts of the answer are required
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", ship: undefined }] }, expected)).toThrow(/screen-1.png: no ship verdict/);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", counts: { ...ZERO, nestedBoxes: -1 } }] }, expected)).toThrow(/nestedBoxes is not a count/);
    expect(() => parseReview({ screens: [ok, { ...ok, file: "screen-1.png", scores: { ...ALL(9), depth: 9, colour: undefined } }] }, expected)).toThrow(/colour is not a score/);
  });
  it("fails a screen the director would not ship, even with every score at the bar", () => {
    const [r] = parseReview({ screens: [entry("screen-1.png", ALL(8), [fix], { ship: false })] }, screens(1));
    expect(r.ship).toBe(false);
    expect(() => parseReview({ screens: [entry("screen-1.png", ALL(9), [], { ship: false })] }, screens(1))).toThrow(/below the bar without fixes/);
    const [ok] = parseReview({ screens: [entry("screen-1.png", ALL(8))] }, screens(1));
    expect(ok.ship).toBe(true);
  });
  it("caps the criterion of a broken counted limit and brings a removal fix for it", () => {
    const [r] = parseReview({ screens: [entry("screen-1.png", ALL(9), [], { ship: true, counts: { ...ZERO, supportHues: 4, nestedBoxes: 2, truncatedTexts: 1, blocks: 7 } })] }, screens(1));
    expect(r.scores).toMatchObject({ colour: 6, composition: 6, typography: 9 });
    expect(r.ship).toBe(false);
    expect(r.breaches).toEqual(["4 support hues (limit 1): colour harmony at most 6", "2 boxes inside another box (limit 0): composition at most 6", "1 truncated text (limit 0): composition at most 6"]);
    expect(r.fixes.map((f) => [f.kind, f.criterion])).toEqual([["remove", "colour"], ["remove", "composition"], ["change", "composition"]]);
    // parsing the recorded review again changes nothing
    expect(parseReview({ screens: [r] }, screens(1))[0]).toEqual(r);
  });
  it("orders the fixes remove, merge, change, add, and drops a decorative addition", () => {
    const f = (kind: string, criterion: string, what: string) => ({ kind, criterion, where: "x", what, how: "y" });
    const [r] = parseReview({ screens: [entry("screen-1.png", { ...ALL(9), space: 5 }, [
      f("change", "typography", "weights"), f("add", "space", "fill the band with a card"), f("merge", "composition", "two cards"),
      f("add", "content", "the required 6-week limit"), f("remove", "colour", "icon bubbles"),
    ])] }, screens(1));
    expect(r.fixes.map((x) => x.what)).toEqual(["icon bubbles", "two cards", "weights", "the required 6-week limit"]);
  });
  it("fails colour harmony when the primary accent is not the brief's brand colour", () => {
    const brand = brandColourOf(["Our brand colour is deep teal #0F766E"]);
    const [berry] = parseReview({ screens: [entry("screen-1.png", ALL(9), [], { accent: "#AB285C", onBrand: true })] }, screens(1), { brand });
    expect(berry.scores.colour).toBe(4);
    expect(berry.ship).toBe(false);
    expect(berry.breaches).toEqual(["primary accent #AB285C is not the brand colour deep teal #0F766E: colour harmony at most 4"]);
    expect(berry.fixes[0]).toMatchObject({ kind: "change", criterion: "colour" });
    expect(berry.fixes[0].how).toContain("Make deep teal #0F766E the primary accent");
    // a shade of the brand colour passes; the reviewer's own "not on brand" fails a brand named without a hex
    expect(parseReview({ screens: [entry("screen-1.png", ALL(9), [], { accent: "#0B5C56" })] }, screens(1), { brand })[0]).toMatchObject({ ship: true, breaches: [] });
    const named = brandColourOf(["The brand colour is deep teal"]);
    expect(parseReview({ screens: [entry("screen-1.png", ALL(9), [], { accent: "#AB285C", onBrand: false })] }, screens(1), { brand: named })[0].scores.colour).toBe(4);
    // no brand colour named: any accent
    expect(parseReview({ screens: [entry("screen-1.png", ALL(9), [], { accent: "#AB285C" })] }, screens(1))[0].ship).toBe(true);
  });
});

describe("review batches", () => {
  it("reviews every screen in one call when they fit, else 16 per call with up to 4 others for consistency", () => {
    const few = screens(19);
    expect(reviewBatches(few, [])).toEqual([{ score: few, reference: [] }]);
    const all = [...screens(30), ...screens(2, 1440).map((s, i) => ({ ...s, file: `desk-${i}.png`, nodeId: `9:${i}` }))];
    const batches = reviewBatches(all, []);
    expect(batches.map((b) => b.score.length)).toEqual([16, 16]);
    for (const b of batches) {
      expect(b.score.length + b.reference.length).toBeLessThanOrEqual(20);
      expect(b.reference.length).toBe(4);
      expect(b.reference.some((r) => b.score.includes(r))).toBe(false);
    }
    // the first batch (phone screens only) sees a desktop screen for consistency
    expect(batches[0].reference.some((r) => r.width === 1440)).toBe(true);
  });
});

describe("the polish instructions", () => {
  it("simplify first: removals and merges, then spacing, typography and colour; keep style and brand; re-export calmer", () => {
    const brand = brandColourOf(["Brand colour deep teal #0F766E"]);
    const text = polishInstructions({ projectUrl: "https://www.figma.com/design/abc/Praxis", round: 1, brand });
    const at = (s: string) => { const i = text.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    expect(at("2. Remove and merge first")).toBeLessThan(at("3. Then spacing, typography and colour"));
    expect(at("3. Then spacing, typography and colour")).toBeLessThan(at("4. Keep the chosen style direction and the brand colour"));
    expect(at("4. Keep the chosen style direction")).toBeLessThan(at("5. Re-export the frame"));
    expect(text).toContain("every screen must end calmer, with fewer elements, fewer colours and fewer boxes than it started with, never more");
    expect(text).toContain("it must be calmer, not busier");
    expect(text).toContain("Never add a decorative element");
    expect(text).toContain("The brief's brand colour deep teal #0F766E is the primary accent of every screen");
    expect(polishInstructions({ projectUrl: "u", round: 1 })).not.toContain("The brief's brand colour");
    const [r] = parseReview({ screens: [entry("screen-1.png", { ...ALL(9), typography: 6 }, [
      { kind: "change", criterion: "typography", where: "titles", what: "lighter", how: "500" }, { kind: "remove", criterion: "colour", where: "rows", what: "icon bubbles", how: "delete" },
    ])] }, screens(1));
    const asked = JSON.parse(polishRequest({ directory: "/d", projectUrl: "u", round: 1, screens: [r], others: [], brand }));
    expect(asked.screens[0].fixes.map((f: { kind: string }) => f.kind)).toEqual(["remove", "change"]);
    expect(asked).toMatchObject({ brandColour: "deep teal #0F766E", bar: 8 });
  });
});

// ------------------------------------------------------------------------------------------------- the loop

function loopFixture(n = 3) {
  const dir = path.join(root, "job");
  fs.mkdirSync(dir, { recursive: true });
  const list = screens(n);
  for (const s of list) fs.writeFileSync(path.join(dir, s.file), png("drawn"));
  fs.writeFileSync(path.join(dir, "design-master.md"), "# Design master\n\nTokens and layout.\n");
  fs.writeFileSync(path.join(dir, "result.json"), '{"recorded":true}');
  const steps: string[] = [];
  const reviews: { round: number; score: string[]; reference: string[] }[] = [];
  const polishes: { round: number; screens: string[]; others: string[] }[] = [];
  /** Scores per file per review round; a file not listed scores 9 everywhere. */
  const plan: Record<number, Record<string, Record<string, number>>> = {};
  const loop: ReviewLoop = {
    dir, screens: list, rubric: "# Screen review rubric\n",
    review: vi.fn(async ({ round, score, reference }: Parameters<ReviewLoop["review"]>[0]) => {
      reviews.push({ round, score: score.map((s) => s.file), reference: reference.map((s) => s.file) });
      return { screens: score.map((s) => {
        const scores = { ...ALL(9), ...(plan[round]?.[s.file] ?? {}) };
        const weak = Object.values(scores).some((v) => v < 8);
        return { ...entry(s.file, scores, weak ? [fix] : []), verdict: weak ? "Busy." : "Ready." };
      }) };
    }),
    polish: vi.fn(async ({ round, screens: failing, others }: Parameters<ReviewLoop["polish"]>[0]) => {
      polishes.push({ round, screens: failing.map((s) => s.file), others: others.map((s) => s.file) });
      for (const s of failing) fs.writeFileSync(path.join(dir, s.file), png(`polished-${round}`));
      return { error: null, screens: failing.map((s) => ({ file: s.file, changes: ["Lifted the card"], notes: "" })) };
    }),
    step: vi.fn(async (_p: number, m: string) => { steps.push(m); }),
    log: vi.fn(),
    stopped: (e) => e instanceof JobGone,
    final: (e) => e instanceof JobFailure && e.code === "ai.capacity",
    now: () => "2026-11-08T00:00:00Z",
  };
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  return { dir, list, loop, steps, reviews, polishes, plan, read };
}

describe("the review and polish loop", () => {
  it("saves a design that passes on its first review without polishing", async () => {
    const t = loopFixture();
    const state = await runDesignReview(t.loop);
    expect(state).toMatchObject({ status: "done", outcome: "passed", polishes: [] });
    expect(t.steps).toEqual([REVIEW_STEPS.reviewing]);
    expect(t.polishes).toEqual([]);
    expect(t.reviews).toEqual([{ round: 1, score: ["screen-1.png", "screen-2.png", "screen-3.png"], reference: [] }]);
    expect(t.read("review-1.json").scored).toHaveLength(3);
    expect(t.read("design-review.json").final.every((f: { passed: boolean }) => f.passed)).toBe(true);
    expect(fs.readFileSync(path.join(t.dir, "review-rubric.md"), "utf8")).toBe("# Screen review rubric\n");
  });

  it("polishes only the screens below the bar, checks only those again with the others as reference, and stops once all pass", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-1.png": { space: 4, composition: 5 }, "screen-3.png": { colour: 7 } };
    const state = await runDesignReview(t.loop);
    expect(state.outcome).toBe("passed");
    expect(t.polishes).toEqual([{ round: 1, screens: ["screen-1.png", "screen-3.png"], others: ["screen-2.png"] }]);
    expect(t.reviews[1]).toEqual({ round: 2, score: ["screen-1.png", "screen-3.png"], reference: ["screen-2.png"] });
    expect(t.steps).toEqual([REVIEW_STEPS.reviewing, REVIEW_STEPS.polishing(2), REVIEW_STEPS.checking(2)]);
    expect(t.read("polish-1.json")).toMatchObject({ round: 1, screens: ["screen-1.png", "screen-3.png"], changed: ["screen-1.png", "screen-3.png"], note: null });
    // the exports before the polish are kept
    expect(fs.readFileSync(path.join(t.dir, "polish-1-before", "screen-1.png"))).toEqual(png("drawn"));
    expect(state.final.map((f) => f.round)).toEqual([2, 1, 2]);
  });

  it("stops after two polish rounds with a final check and reports a screen still below the bar in the design master", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-2.png": { composition: 5 } };
    t.plan[2] = { "screen-2.png": { composition: 6 } };
    t.plan[3] = { "screen-2.png": { composition: 7 } };
    const state = await runDesignReview(t.loop);
    expect(state.outcome).toBe("belowBar");
    expect(t.polishes.map((p) => p.round)).toEqual([1, 2]);
    expect(t.reviews.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(t.steps).toEqual([REVIEW_STEPS.reviewing, REVIEW_STEPS.polishing(1), REVIEW_STEPS.checking(1), REVIEW_STEPS.polishing(1), REVIEW_STEPS.final]);
    expect(state.final[1]).toMatchObject({ passed: false, lowest: { id: "composition", score: 7 }, round: 3, openFixes: [fix] });
    for (const f of ["review-1.json", "review-2.json", "review-3.json", "polish-1.json", "polish-2.json"]) expect(fs.existsSync(path.join(t.dir, f))).toBe(true);
    writeReviewSection(t.dir, reviewSection(state, { styleName: "Still Water" }));
    const master = fs.readFileSync(path.join(t.dir, "design-master.md"), "utf8");
    expect(master).toMatch(/^# Design master\n\nTokens and layout\.\n\n<!-- design-review -->\n## Design review/);
    expect(master).toContain("the Still Water style direction");
    expect(master).toContain("Result: 2 of 3 screens are at the bar after 2 polish rounds; 1 is still below it");
    expect(master).toContain("### Still below the bar");
    expect(master).toContain("- **Screen 2** (screen-2.png, frame 1:2; lowest: composition, whitespace and congestion 7; would not ship): Busy.");
    expect(master).toContain("  - Composition (change), the form card: Open up the card 32 px between the groups");
    expect(master).toContain("| Screen | Colour | Composition | Type | Space | Focus | Consistency | Content | Finish | Access | Ships | Lowest |");
    expect(master).toContain("would ship it in a top design-led product");
    // written again on a resumed job, the section is replaced, not repeated
    writeReviewSection(t.dir, reviewSection(state, { styleName: "Still Water" }));
    expect(fs.readFileSync(path.join(t.dir, "design-master.md"), "utf8").match(/## Design review/g)).toHaveLength(1);
  });

  it("keeps the first drawing and says so when the review cannot be completed (after one more try)", async () => {
    const t = loopFixture();
    (t.loop.review as ReturnType<typeof vi.fn>).mockResolvedValue({ screens: [] });
    const state = await runDesignReview(t.loop);
    expect(state.outcome).toBe("reviewUnavailable");
    expect(t.loop.review).toHaveBeenCalledTimes(2);
    expect(t.loop.polish).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(t.dir, "screen-1.png"))).toEqual(png("drawn"));
    expect(state.notes).toEqual(["The review could not be completed (its answer could not be used: no review for screen-1.png), so the screens are shown as first drawn, without scores."]);
    expect(reviewSection(state)).toContain("Result: not reviewed.");
    // out of capacity: no second try
    const c = loopFixture();
    (c.loop.review as ReturnType<typeof vi.fn>).mockRejectedValue(new JobFailure("Out of capacity.", "ai.capacity"));
    fs.rmSync(path.join(c.dir, "design-review.json"));
    expect((await runDesignReview(c.loop)).notes[0]).toContain("the design runner was out of capacity");
    expect(c.loop.review).toHaveBeenCalledTimes(1);
  });

  it("keeps the earlier scores, marked, when the check after polishing cannot be completed", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-1.png": { craft: 6 } };
    const review = t.loop.review as ReturnType<typeof vi.fn>;
    const first = review.getMockImplementation() as (o: { round: number }) => Promise<unknown>;
    review.mockImplementation(async (o: { round: number }) => (o.round === 1 ? first(o) : Promise.reject(new Error("Claude CLI failed"))));
    const state = await runDesignReview(t.loop);
    expect(state.outcome).toBe("finalCheckUnavailable");
    expect(state.final[0]).toMatchObject({ round: 1, polishedSince: true, passed: false });
    expect(reviewSection(state)).toContain("| Screen 1 (polished after scoring) |");
  });

  it("fails the job plainly when Figma fails during a polish, and a resumed job goes on with that polish without reviewing again", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-1.png": { hierarchy: 5 } };
    const polish = t.loop.polish as ReturnType<typeof vi.fn>;
    const works = polish.getMockImplementation()!;
    polish.mockResolvedValueOnce({ error: "Figma tools failed: use_figma returned 429 (plan limit)", screens: [] });
    const failure = await runDesignReview(t.loop).catch((e) => e);
    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: "design.figmaPolishFailed", message: POLISH_FIGMA_FAILURE });
    expect(failure.message).not.toMatch(AI_WORDS);
    expect(fs.existsSync(path.join(t.dir, "polish-1.json"))).toBe(false);
    polish.mockImplementation(works);
    const state = await runDesignReview(t.loop);
    expect(state.outcome).toBe("passed");
    expect(t.reviews.map((r) => r.round)).toEqual([1, 2]);
    expect(polish).toHaveBeenCalledTimes(2);
    // a finished review is answered as recorded, without any call
    await runDesignReview(t.loop);
    expect(polish).toHaveBeenCalledTimes(2);
    expect(t.reviews).toHaveLength(2);
  });

  it("goes on when a polish session stops early, checking only the screens it re-exported", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-1.png": { composition: 5 }, "screen-2.png": { composition: 5 } };
    (t.loop.polish as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(t.dir, "screen-1.png"), png("half"));
      throw new Error("timed out after 1800 s");
    });
    const state = await runDesignReview(t.loop);
    expect(t.read("polish-1.json")).toMatchObject({ changed: ["screen-1.png"], note: "Polishing round 1 stopped before it finished (it ran out of time); the screens it had exported by then are kept." });
    expect(t.reviews[1]).toMatchObject({ round: 2, score: ["screen-1.png"] });
    // screen-2 was not re-exported: it keeps its scores and goes into the second round
    expect(t.polishes[0]).toEqual({ round: 2, screens: ["screen-2.png"], others: ["screen-1.png", "screen-3.png"] });
    expect(state.outcome).toBe("passed");
  });

  it("puts back a broken export and any handoff file the polish session changed", async () => {
    const t = loopFixture();
    t.plan[1] = { "screen-1.png": { composition: 5 } };
    (t.loop.polish as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(t.dir, "screen-1.png"), "not a png");
      fs.writeFileSync(path.join(t.dir, "result.json"), "{}");
      fs.writeFileSync(path.join(t.dir, "screen-2.png"), png("other"));
      fs.appendFileSync(path.join(t.dir, "design-master.md"), "Shadow tokens updated.\n");
      return { error: null, screens: [] };
    });
    await runDesignReview(t.loop);
    expect(fs.readFileSync(path.join(t.dir, "screen-1.png"))).toEqual(png("polished-2"));
    expect(t.read("polish-1.json")).toMatchObject({ changed: [], restored: expect.arrayContaining(["result.json", "screen-2.png", "screen-1.png"]) });
    expect(fs.readFileSync(path.join(t.dir, "result.json"), "utf8")).toBe('{"recorded":true}');
    expect(fs.readFileSync(path.join(t.dir, "screen-2.png"))).toEqual(png("drawn"));
    expect(fs.readFileSync(path.join(t.dir, "design-master.md"), "utf8")).toContain("Shadow tokens updated.");
  });

  it("stops at once for a stopped job", async () => {
    const t = loopFixture();
    (t.loop.review as ReturnType<typeof vi.fn>).mockRejectedValue(new JobGone("stopped"));
    await expect(runDesignReview(t.loop)).rejects.toBeInstanceOf(JobGone);
    expect(t.loop.review).toHaveBeenCalledTimes(1);
  });

  it("tells people each step in plain words", () => {
    const lines = [REVIEW_STEPS.drawing, REVIEW_STEPS.reviewing, REVIEW_STEPS.polishing(1), REVIEW_STEPS.polishing(4), REVIEW_STEPS.checking(4), REVIEW_STEPS.final, POLISH_FIGMA_FAILURE];
    expect(lines.slice(0, 6)).toEqual(["Drawing the screens", "Reviewing every screen against the brief and the house principles", "Polishing 1 screen", "Polishing 4 screens", "Checking the 4 polished screens", "Final check"]);
    for (const l of lines) expect(l).not.toMatch(AI_WORDS);
  });
});

// ------------------------------------------------------------------------------------------------- the design job

function project(): DesignRows {
  const project = { ItemId: "project1", Name: "Praxis Seeblick", Goal: "Patients book physio appointments on their phones", TargetUsers: "Patients on phones", RepoMode: "new" };
  const requirements = [{ ItemId: "r1", Key: "R1", Title: "Book on the phone", Text: "Patients book on their mobile phone.", Status: "draft", AcceptanceCriteria: ["A patient books a time"] }];
  return { project, objective: () => null, requirements: () => requirements, rows: () => [] } as unknown as DesignRows;
}

function jobFixture() {
  setDesignSkillDir(writeSkillTree(root));
  const p = project();
  const dir = path.join(root, "figma-screens", "job1");
  const steps: string[] = [];
  const update = vi.fn(async (..._args: unknown[]) => {});
  const putFile = vi.fn(async (..._args: unknown[]) => "artifact1");
  const run = { id: "job1", attempt: 1, projectId: "project1", workspaceId: "ws1", input: { source: factoryDesignSource(designIntentOf(p)) }, p,
    signal: new AbortController().signal, folder: () => ({ artifacts: root }), step: vi.fn(async (_n: number, m?: string) => { if (m) steps.push(m); }),
    now: () => new Date("2026-11-08T00:00:00Z"), iso: () => "2026-11-08T00:00:00Z", check: vi.fn(), log: vi.fn(), putFile, update,
  } as unknown as JobRun;
  const drawing = { projectUrl: "https://www.figma.com/design/abc/Praxis", error: null,
    screens: [{ name: "Phone 01 - Sign in", nodeId: "2:2", file: "phone-01-sign-in.png", requirementKeys: ["R1"] }, { name: "Phone 02 - Choose a time", nodeId: "3:62", file: "phone-02-time.png", requirementKeys: ["R1"] }],
    coverage: [{ key: "R1", screens: ["2:2", "3:62"], criteria: ["AC1"], noScreenReason: null }] };
  mocks.runner.mockImplementation(async (req: any) => {
    if (req.images) {
      const files = req.images.filter((i: any) => !/reference only/.test(i.label)).map((i: any) => i.label.split(":")[0]);
      const round = req.prompt.startsWith("Review these screens") ? 1 : 2;
      return { screens: files.map((file: string) => entry(file, { ...ALL(9), ...(round === 1 && file === "phone-01-sign-in.png" ? { space: 4, composition: 5 } : {}) }, [fix])) };
    }
    if (req.schema.properties.coverage) {
      fs.mkdirSync(dir, { recursive: true });
      for (const s of drawing.screens) fs.writeFileSync(path.join(dir, s.file), png("drawn"));
      fs.writeFileSync(path.join(dir, "ux-plan.md"), "UX plan");
      fs.writeFileSync(path.join(dir, "design-master.md"), "# Design master");
      return drawing;
    }
    for (const s of JSON.parse(req.prompt).screens) fs.writeFileSync(path.join(dir, s.file), png("polished"));
    return { error: null, screens: [{ file: "phone-01-sign-in.png", changes: ["Brand area and sticky action"], notes: "" }] };
  });
  return { run, dir, steps, update, putFile };
}

describe("design.generate with the review", () => {
  beforeEach(() => {
    mocks.config = { mcpConfig: "/srv/figma.json", maxBudgetUsd: 25, maxTurns: 200, model: "opus", modelSet: false, effort: "high" };
  });

  it("draws on the strongest model at high effort, reviews every PNG, polishes the weak screen in the same file and saves the result", async () => {
    const t = jobFixture();
    await generateFigmaScreens(t.run, { ItemId: "brief1" });
    const calls = mocks.runner.mock.calls.map(([req]) => req);
    const [draw, review1, polish, review2] = calls;
    expect(calls).toHaveLength(4);
    // the drawing: model, effort, limits, an hour, and the quality bar
    expect(draw.makeSession).toMatchObject({ mcpConfig: "/srv/figma.json", model: "opus", effort: "high", maxBudgetUsd: 25, maxTurns: 200 });
    expect(draw.timeoutMs).toBe(3_600_000);
    expect(draw.system).toContain(designQualityBar());
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, "started.json"), "utf8"))).toMatchObject({ designReview: 1, artifactVersion: 2 });
    // the review: no session (no tools, no Figma), every PNG attached, the same model and effort, the rubric and brief
    expect(review1.makeSession).toBeUndefined();
    expect(review1).toMatchObject({ model: "opus", effort: "high" });
    expect(review1.images.map((i: any) => i.label)).toEqual(["phone-01-sign-in.png: Phone 01 - Sign in (frame 2:2, 1 x 1)", "phone-02-time.png: Phone 02 - Choose a time (frame 3:62, 1 x 1)"]);
    expect(review1.system).toContain("You are a demanding senior design director");
    expect(review1.system).toContain("### The 4/10 anchor");
    expect(review1.system).toContain("The brief names no brand colour");
    expect(review1.system).toContain(PRINCIPLES_MARKER);
    expect(review1.system).toContain("## The chosen style direction: Quiet Ledger");
    expect(review1.system).toContain("# Design brief: Praxis Seeblick");
    expect(review1.schema.properties.screens.items.properties.scores.required).toEqual(REVIEW_CRITERIA.map((c) => c.id));
    // the polish: the same Figma session settings, the recorded file, only the weak screen with its fixes
    expect(polish.makeSession).toMatchObject({ directory: t.dir, mcpConfig: "/srv/figma.json", model: "opus", effort: "high", maxBudgetUsd: 25, maxTurns: 200 });
    expect(polish.timeoutMs).toBe(1_800_000);
    expect(polish.system).toContain("Work only in the recorded Figma file https://www.figma.com/design/abc/Praxis");
    expect(polish.system).toContain("so its node id stays the same");
    expect(polish.system).toContain("2. Remove and merge first");
    expect(polish.system).toContain(PRINCIPLES_MARKER);
    const asked = JSON.parse(polish.prompt);
    expect(asked.screens).toEqual([expect.objectContaining({ file: "phone-01-sign-in.png", nodeId: "2:2", fixes: [fix] })]);
    expect(asked.otherScreens).toEqual([{ name: "Phone 02 - Choose a time", nodeId: "3:62", file: "phone-02-time.png" }]);
    // the check: the polished screen, the other as reference
    expect(review2.images.map((i: any) => i.label)).toEqual(["phone-01-sign-in.png: Phone 01 - Sign in (frame 2:2, 1 x 1)", "phone-02-time.png: Phone 02 - Choose a time (frame 3:62, 1 x 1), reference only: do not score"]);
    // what people saw
    expect(t.steps).toEqual(expect.arrayContaining([REVIEW_STEPS.drawing, REVIEW_STEPS.reviewing, REVIEW_STEPS.polishing(1), REVIEW_STEPS.checking(1)]));
    for (const s of t.steps) expect(s).not.toMatch(AI_WORDS);
    // the saved revision carries the polished export and the review in its design master
    const artifact = JSON.parse(Buffer.from(t.putFile.mock.calls[0][2] as Uint8Array).toString());
    expect(Buffer.from(artifact.screens[0].png, "base64")).toEqual(png("polished"));
    expect(artifact.designMaster).toContain("## Design review");
    expect(artifact.designMaster).toContain("Result: all 2 screens are at the bar after 1 polish round.");
    expect(artifact.coverage).toEqual([{ key: "R1", screens: ["2:2", "3:62"], criteria: ["A patient books a time"], noScreenReason: null }]);
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, "design-review.json"), "utf8"))).toMatchObject({ outcome: "passed", status: "done" });
    expect(t.update).toHaveBeenCalledTimes(1);
  });

  it("saves the first drawing, reported as not reviewed, when the review fails", async () => {
    const t = jobFixture();
    const draw = mocks.runner.getMockImplementation()!;
    mocks.runner.mockImplementation(async (req: any) => (req.images ? Promise.reject(new Error("Claude CLI failed")) : draw(req)));
    await generateFigmaScreens(t.run, { ItemId: "brief1" });
    expect(mocks.runner.mock.calls.filter(([req]) => req.images)).toHaveLength(2);
    expect(mocks.runner.mock.calls.filter(([req]) => req.makeSession && !req.schema.properties.coverage)).toHaveLength(0);
    const artifact = JSON.parse(Buffer.from(t.putFile.mock.calls[0][2] as Uint8Array).toString());
    expect(Buffer.from(artifact.screens[0].png, "base64")).toEqual(png("drawn"));
    expect(artifact.designMaster).toContain("The review could not be completed (the design runner stopped early), so the screens are shown as first drawn");
    expect(t.update).toHaveBeenCalledTimes(1);
  });

  it("fails plainly, saving nothing, when Figma fails during the polish", async () => {
    const t = jobFixture();
    const works = mocks.runner.getMockImplementation()!;
    mocks.runner.mockImplementation(async (req: any) => (req.makeSession && !req.schema.properties.coverage ? { error: "Figma tools failed: get_screenshot is unavailable", screens: [] } : works(req)));
    await expect(generateFigmaScreens(t.run, { ItemId: "brief1" })).rejects.toMatchObject({ code: "design.figmaPolishFailed", message: POLISH_FIGMA_FAILURE });
    expect(t.update).not.toHaveBeenCalled();
    expect(t.putFile).not.toHaveBeenCalled();
  });

  it("reports another runner's design as not reviewed, without review calls", async () => {
    mocks.provider.mockReturnValue("codex");
    const t = jobFixture();
    await generateFigmaScreens(t.run, { ItemId: "brief1" });
    expect(mocks.runner).toHaveBeenCalledTimes(1);
    expect(mocks.runner.mock.calls[0][0].makeSession.model).toBeUndefined();
    expect(fs.readFileSync(path.join(t.dir, "design-master.md"), "utf8")).toContain("Not reviewed: the screen review and polishing run with the Claude designer");
  });
});

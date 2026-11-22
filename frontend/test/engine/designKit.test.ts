// The screen designer's house material: the front matter of the style directions and screen recipes, the default
// direction styles/README.md names, the recipes for a product, and a plain failure when the release lacks the house
// principles or the style directions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStyleOf, loadDesignKit, parseFrontmatter, selectRecipes } from "../../server/local/engine/kinds/scope/designKit";
import { PRINCIPLES_MARKER, STYLE_FIELD, STYLE_LEDGER, writeSkillTree } from "./designSkillFixture";
import { designJobFailureMessage } from "../../src/components/design/makeDesignState";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "design-kit-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("front matter", () => {
  it("reads quoted scalars, flow lists with quoted commas, block lists and trailing comments", () => {
    const fm = parseFrontmatter(STYLE_LEDGER)!;
    expect(fm.data).toEqual({
      id: "quiet-ledger", name: "Quiet Ledger", summary: "A calm back-office look on warm paper with a petrol accent: exact, unhurried.",
      use_when: ["accounting and invoicing", "finance teams, on desktop"], avoid_when: ["consumer apps on phones", "playful, youth audiences"], density: "dense-but-airy",
    });
    expect(fm.body).toContain("STYLE MARKER quiet-ledger");
    expect(fm.body).not.toContain("use_when");
  });
  it("reads folded blocks, bare flow items and empty lists", () => {
    expect(parseFrontmatter(STYLE_FIELD)!.data).toEqual({ id: "field-bright", name: "Field Bright", summary: "A sturdy high-visibility look for crews outdoors.",
      use_when: ["field service", "dispatch, scheduling"], avoid_when: [], density: "balanced" });
  });
  it("reads Windows line ends, a byte order mark, escapes, comment lines and flow lists over several lines", () => {
    const fm = parseFrontmatter('﻿---\r\n# a comment\r\nid: a\r\nname: "Say \\"hi\\""\r\napplies_to: [\r\n  "list",\r\n  table ]\r\n---\r\nbody')!;
    expect(fm.data).toEqual({ id: "a", name: 'Say "hi"', applies_to: ["list", "table"] });
    expect(fm.body).toBe("body");
  });
  it("answers null for a file without front matter", () => {
    expect(parseFrontmatter("# Just a heading\n")).toBeNull();
  });
  it("finds the default direction in the README's front matter or on a line that says default", () => {
    const ids = ["still-water", "still", "cobalt-grid"];
    expect(defaultStyleOf("---\ndefault: cobalt-grid\n---\n# Styles\n", ids)).toBe("cobalt-grid");
    expect(defaultStyleOf("# Styles\n\n- `cobalt-grid`: analytics\n\n**Default:** `still-water` (the balanced default).\n", ids)).toBe("still-water");
    expect(defaultStyleOf("# Styles\n\nNo default here.\n", ids)).toBeNull();
  });
});

describe("the skill tree", () => {
  it("loads the skill, the principles, every style direction and recipe, and the README's default", () => {
    const kit = loadDesignKit(writeSkillTree(root));
    expect(kit.principles).toContain(PRINCIPLES_MARKER);
    expect(kit.styles.map((s) => s.id)).toEqual(["field-bright", "quiet-ledger"]);
    expect(kit.styles.find((s) => s.id === "quiet-ledger")).toMatchObject({ name: "Quiet Ledger", density: "dense-but-airy", useWhen: ["accounting and invoicing", "finance teams, on desktop"], file: "styles/quiet-ledger.md" });
    expect(kit.recipes.map((r) => [r.id, r.appliesTo])).toEqual([["app-shell", ["shell", "navigation", "all"]], ["boards", ["board", "calendar", "timeline"]], ["list-pages", ["list", "table", "records"]]]);
    expect(kit.defaultStyleId).toBe("quiet-ledger");
    expect(kit.problems).toEqual([]);
  });
  it("takes the first direction, and says so, when the README names no default", () => {
    const kit = loadDesignKit(writeSkillTree(root, { readme: null }));
    expect(kit.defaultStyleId).toBe("field-bright");
    expect(kit.problems).toEqual(["styles/README.md is missing"]);
  });
  it.each([
    [{ skill: false }, "design.figmaSkillMissing", /SKILL\.md/],
    [{ principles: false }, "design.principlesMissing", /PRINCIPLES\.md/],
    [{ styles: false as const }, "design.stylesMissing", /styles/],
    [{ styles: "readme-only" as const }, "design.stylesMissing", /no readable style direction/],
  ])("fails plainly when the release lacks part of the tree: %j", (options, code, message) => {
    let failure: any;
    try { loadDesignKit(writeSkillTree(root, options)); } catch (e) { failure = e; }
    expect(failure).toMatchObject({ code });
    expect(failure.message).toMatch(message);
    expect(failure.message).toMatch(/Deploy the matching engine skill tree/);
  });
  it.each(["design.figmaSkillMissing", "design.principlesMissing", "design.stylesMissing"])("tells people plainly that %s stopped the design", (code) => {
    expect(designJobFailureMessage({ errorCode: code, message: "" })).toBe("The designer's house guides are missing from the engine, so no design was started. The engine owner must install the matching engine release.");
  });
  it("loads the engine's own skill tree", () => {
    const kit = loadDesignKit();
    expect(kit.principles.length).toBeGreaterThan(500);
    expect(kit.styles.length).toBeGreaterThan(0);
    expect(kit.styles.map((s) => s.id)).toContain(kit.defaultStyleId);
    for (const s of kit.styles) expect(s.name && s.summary && s.useWhen.length && s.avoidWhen.length, s.file).toBeTruthy();
    for (const r of kit.recipes) expect(r.appliesTo.length, r.file).toBeGreaterThan(0);
  });
});

describe("recipes for a product", () => {
  const recipes = () => loadDesignKit(writeSkillTree(root)).recipes;
  it("gives every recipe when they fit the budget together", () => {
    expect(selectRecipes(recipes(), "anything").map((r) => r.id)).toEqual(["app-shell", "boards", "list-pages"]);
  });
  it("gives the recipes for every screen and those whose screen kinds the product names when they do not", () => {
    const all = recipes();
    const budget = all.reduce((n, r) => n + Buffer.byteLength(r.text), 0) - 1;
    expect(selectRecipes(all, "Finance managers see the list of waiting invoices in tables", budget).map((r) => r.id)).toEqual(["app-shell", "list-pages"]);
    expect(selectRecipes(all, "A calendar of shifts", budget).map((r) => r.id)).toEqual(["app-shell", "boards"]);
  });
});

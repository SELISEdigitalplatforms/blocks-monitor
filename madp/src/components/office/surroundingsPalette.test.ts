import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Color } from "three";
import { describe, expect, it } from "vitest";
import {
  BRAND_SHARE_MAX, BRAND_TOKENS, NEUTRAL_TOKENS, RECIPES, SKY_KEYS, cssTriplet, surroundingsPalette,
  type SurroundingsKey, type SurroundingsToken,
} from "./surroundingsPalette";

/** the "R G B" tokens of a CSS block (selector text exactly as written), e.g. ".factory-office" */
function block(css: string, selector: string): Map<string, Color> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  const out = new Map<string, Color>();
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out.set(m[1], new Color(+m[2] / 255, +m[3] / 255, +m[4] / 255));
  return out;
}

const officeCss = readFileSync(fileURLToPath(new URL("./office.css", import.meta.url)), "utf8");
const appCss = readFileSync(fileURLToPath(new URL("../../styles/index.css", import.meta.url)), "utf8");

/** the theme's real token values, read the way palette.ts tokenColor reads them (r, g, b = the sRGB token / 255) */
function themeTokens(dark: boolean) {
  const office = new Map([...block(officeCss, ".factory-office"), ...(dark ? block(officeCss, '[data-theme="dark"] .factory-office') : [])]);
  const app = new Map([...block(appCss, ":root"), ...(dark ? block(appCss, '[data-theme="dark"]') : [])]);
  return (name: SurroundingsToken): Color => {
    const c = name.startsWith("c-") ? app.get(name) : office.get(name);
    if (!c) throw new Error(`token --${name} is not defined`);
    return c;
  };
}

const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe("the stage's surroundings", () => {
  it("are made of the theme's neutrals, with the brand tint only in the sky and only a small share of it", () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const [key, [a, b, t]] of Object.entries(recipe) as [SurroundingsKey, readonly [SurroundingsToken, SurroundingsToken, number]][]) {
        for (const tok of [a, b]) expect([...NEUTRAL_TOKENS, ...BRAND_TOKENS]).toContain(tok);
        const brand = (tok: SurroundingsToken) => (BRAND_TOKENS as readonly string[]).includes(tok);
        const share = (brand(a) ? 1 - t : 0) + (brand(b) ? t : 0);
        if (share > 0) expect(SKY_KEYS).toContain(key);
        expect(share).toBeLessThanOrEqual(BRAND_SHARE_MAX);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it("mix the real tokens of both themes (every token they use exists)", () => {
    for (const dark of [false, true]) {
      const tok = themeTokens(dark);
      const p = surroundingsPalette(tok, dark);
      const [a, b, t] = RECIPES[dark ? "dark" : "light"].zenith;
      expect(p.zenith.r).toBeCloseTo(tok(a).r + (tok(b).r - tok(a).r) * t, 6);
      expect(p.zenith.b).toBeCloseTo(tok(a).b + (tok(b).b - tok(a).b) * t, 6);
    }
  });

  it("read as daylight in the light theme: a haze below white (the walls stand out), the ground a step darker, quiet lines", () => {
    const p = surroundingsPalette(themeTokens(false), false);
    expect(luma(p.horizon)).toBeLessThan(0.97);
    expect(luma(p.glow)).toBeGreaterThan(luma(p.horizon));
    expect(luma(p.ground)).toBeLessThan(luma(p.horizon));
    expect(luma(p.zenith)).toBeLessThan(luma(p.horizon));
    expect(luma(p.shade)).toBeLessThan(luma(p.ground));
    const lines = luma(p.ground) - luma(p.line);
    expect(lines).toBeGreaterThan(0.05);
    expect(lines).toBeLessThan(0.25);
  });

  it("read as night in the dark theme: a dark zenith over a faint glow at the horizon, a dark ground with quiet lines", () => {
    const p = surroundingsPalette(themeTokens(true), true);
    expect(luma(p.zenith)).toBeLessThan(luma(p.horizon));
    expect(luma(p.glow)).toBeGreaterThan(luma(p.horizon));
    expect(luma(p.ground)).toBeLessThan(luma(p.horizon));
    expect(luma(p.shade)).toBeLessThan(luma(p.ground));
    const lines = luma(p.line) - luma(p.ground);
    expect(lines).toBeGreaterThan(0.03);
    expect(lines).toBeLessThan(0.15);
  });

  it("hand CSS the same colours as R G B triplets", () => {
    expect(cssTriplet(new Color(1, 0.5, 0))).toBe("255 128 0");
    expect(cssTriplet(new Color(1.2, -0.1, 0.2))).toBe("255 0 51");
  });
});

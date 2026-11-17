/** The stage's surroundings (Surroundings.tsx draws them): a sky, the haze at the horizon and an endless ground with a
 *  fine grid, made only of the office theme's own tokens (office.css): its neutrals, and in the sky a small share of
 *  the brand tint. No other colour. Light theme: calm daylight; dark theme: night. Pure (three's Color only), no DOM. */

import { Color } from "three";

/** the tokens the surroundings may use: the theme's neutrals ... */
export const NEUTRAL_TOKENS = ["surface", "surface-2", "surface-3", "line", "line-strong", "floor", "ink-3", "c-stage"] as const;
/** ... and its brand tint, only in the sky and only a small share */
export const BRAND_TOKENS = ["brand-300", "brand-500"] as const;
export const BRAND_SHARE_MAX = 0.35;

export type SurroundingsToken = (typeof NEUTRAL_TOKENS)[number] | (typeof BRAND_TOKENS)[number];
/** token a, mixed towards token b by t (in sRGB, like CSS color-mix) */
export type Mix = readonly [SurroundingsToken, SurroundingsToken, number];

export interface SurroundingsRecipe {
  /** straight up */
  zenith: Mix;
  /** the haze at the horizon; the far ground dissolves into it */
  horizon: Mix;
  /** the horizon on the side the light comes from (DayNight's sun or moon) */
  glow: Mix;
  /** the ground the office stands on */
  ground: Mix;
  /** the ground's grid lines */
  line: Mix;
  /** the soft shade the office casts around its plinth */
  shade: Mix;
}

export type SurroundingsKey = keyof SurroundingsRecipe;
export const SKY_KEYS: readonly SurroundingsKey[] = ["zenith", "horizon", "glow"];

export const RECIPES: Readonly<Record<"light" | "dark", SurroundingsRecipe>> = {
  // daylight: a pale sky with a touch of the brand tint, a soft haze below the white of the walls (so they stand out
  // against it), brighter on the side the sun shines from, and a light grey ground that fades into the haze
  light: {
    zenith: ["surface-3", "brand-300", 0.32],
    horizon: ["surface-3", "brand-300", 0.12],
    glow: ["surface-2", "surface-2", 0],
    ground: ["surface-3", "line-strong", 0.5],
    line: ["line-strong", "ink-3", 0.2],
    shade: ["line-strong", "ink-3", 0.3],
  },
  // night: the stage's own dark overhead, a faint brand-tinted haze low on the horizon (stronger on the moon's side), a
  // dark ground with quiet lines
  dark: {
    zenith: ["c-stage", "floor", 0.2],
    horizon: ["surface-3", "brand-300", 0.22],
    glow: ["surface-3", "brand-500", 0.3],
    ground: ["floor", "surface", 0.25],
    line: ["line", "line-strong", 0.35],
    shade: ["floor", "c-stage", 0.75],
  },
};

export type SurroundingsPalette = Record<SurroundingsKey, Color>;

/** where the stage's light (DayNight's sun, or moon at night) shines from: the glowing side of the sky, and the side the
 *  office's shade on the ground leans away from */
export const SUN_AT: readonly [number, number, number] = [10, 18, 8];

/** The surroundings' colours for a theme. `token` reads a "R G B" token as a Color whose r, g, b are the token's own
 *  sRGB values (palette.ts tokenColor); the mixes stay in sRGB, so the shader writes them unchanged. */
export function surroundingsPalette(token: (name: SurroundingsToken) => Color, dark: boolean): SurroundingsPalette {
  const recipe = RECIPES[dark ? "dark" : "light"];
  const out = {} as SurroundingsPalette;
  for (const key of Object.keys(recipe) as SurroundingsKey[]) {
    const [a, b, t] = recipe[key];
    out[key] = token(a).clone().lerp(token(b), t);
  }
  return out;
}

/** "R G B" (0-255) for a CSS custom property used as rgb(var(--name)) */
export function cssTriplet(c: Color): string {
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `${ch(c.r)} ${ch(c.g)} ${ch(c.b)}`;
}

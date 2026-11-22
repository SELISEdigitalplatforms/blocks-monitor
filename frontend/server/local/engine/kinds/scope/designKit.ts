// The screen designer's house material (engine/selise-madp/MADP/skills/figma-screen-design/):
//
//   SKILL.md            how the designer plans, draws, exports and hands over (always)
//   PRINCIPLES.md       the house design principles: the quality bar every product meets (always)
//   styles/<id>.md      style directions; YAML front matter: id, name, summary, use_when, avoid_when, density.
//                       styles/README.md names the default direction (the closest general fit)
//   recipes/<id>.md     screen recipes; front matter: id, name, applies_to (the screen kinds it serves)
//
// Read fresh for every design job, so a deployed skill tree is used at once. A release without SKILL.md, PRINCIPLES.md
// or any readable style direction fails the job plainly before any design work starts. No YAML dependency: the front
// matter is read by a small parser for the forms these files use (plain and quoted scalars, block and flow lists,
// folded or literal blocks, comments).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JobFailure } from "../../run.ts";

const SKILL_DIR = fileURLToPath(new URL("../../../../../../engine/selise-madp/MADP/skills/figma-screen-design/", import.meta.url));
let dirOverride: string | null = null;
/** Points the loader at another skill tree (tests); null restores the engine's own. */
export function setDesignSkillDir(dir: string | null): void { dirOverride = dir; }
export const designSkillDir = (): string => dirOverride ?? SKILL_DIR;

// ------------------------------------------------------------------------------------------------- front matter

export type FrontValue = string | string[];
export interface Frontmatter { data: Record<string, FrontValue>; body: string }

const unquote = (raw: string): string => {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
};
/** A plain scalar without its trailing comment (" # ..."); a quoted one is kept whole. */
function stripComment(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    const q = s[0];
    for (let i = 1; i < s.length; i++) {
      if (q === '"' && s[i] === "\\") { i++; continue; }
      if (s[i] === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        return s.slice(0, i + 1);
      }
    }
    return s;
  }
  const at = s.search(/\s#/);
  return (at >= 0 ? s.slice(0, at) : s).trim();
}
/** The items of a flow list body ("a, 'b, c', \"d\""), quotes respected. */
function flowItems(inner: string): string[] {
  const out: string[] = [];
  let cur = "", quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (quote === '"' && c === "\\") { cur += inner[++i] ?? ""; continue; }
      if (c === quote) { if (quote === "'" && inner[i + 1] === "'") { cur += inner[++i]; continue; } quote = null; }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ",") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => unquote(x)).filter((x) => x !== "");
}

/** The front matter between the first two "---" lines and the text after it; null when the file has none. */
export function parseFrontmatter(text: string): Frontmatter | null {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return null;
  const lines = (m[1] ?? "").split("\n");
  const data: Record<string, FrontValue> = {};
  const indented = (l: string | undefined) => l !== undefined && (/^\s+\S/.test(l) || l.trim() === "");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const km = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(line);
    if (!km) continue;
    const key = km[1];
    let rest = (km[2] ?? "").trim();
    if (/^[|>][+-]?$/.test(rest)) {
      const literal = rest.startsWith("|");
      const block: string[] = [];
      while (i + 1 < lines.length && indented(lines[i + 1])) block.push(lines[++i].trim());
      while (block.length && block[block.length - 1] === "") block.pop();
      data[key] = literal ? block.join("\n") : block.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (rest.startsWith("[")) {
      while (!/\]\s*(?:#.*)?$/.test(rest) && i + 1 < lines.length) rest += ` ${lines[++i].trim()}`;
      const close = rest.lastIndexOf("]");
      data[key] = flowItems(rest.slice(1, close >= 0 ? close : undefined));
      continue;
    }
    rest = stripComment(rest);
    if (rest === "") {
      const items: string[] = [], text: string[] = [];
      while (i + 1 < lines.length && (indented(lines[i + 1]) || /^-(?:\s|$)/.test(lines[i + 1]))) {
        const next = lines[++i];
        if (/^#/.test(next.trim()) || next.trim() === "") continue;
        const item = /^\s*-(?:\s+(.*))?$/.exec(next);
        if (item) items.push(unquote(stripComment(item[1] ?? "")));
        else if (items.length) items[items.length - 1] = `${items[items.length - 1]} ${unquote(stripComment(next))}`.trim();
        else text.push(stripComment(next));
      }
      data[key] = items.length ? items.filter((x) => x !== "") : text.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    let value = unquote(rest);
    // a plain scalar may go on over indented lines
    if (!/^["']/.test(rest)) while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*-\s/.test(lines[i + 1])) value = `${value} ${stripComment(lines[++i])}`.trim();
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}
const textOf = (v: FrontValue | undefined): string => (Array.isArray(v) ? v.join(", ") : (v ?? "")).trim();
const listOf = (v: FrontValue | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);

// ------------------------------------------------------------------------------------------------- the kit

export interface DesignStyle {
  id: string; name: string; summary: string; useWhen: string[]; avoidWhen: string[]; density: string;
  /** The whole file as written (front matter included): it is what the designer reads. */
  text: string; file: string;
}
export interface DesignRecipe { id: string; name: string; appliesTo: string[]; text: string; file: string }
export interface DesignKit {
  dir: string;
  skill: string;
  principles: string;
  styles: DesignStyle[];
  recipes: DesignRecipe[];
  /** The direction styles/README.md names as the default (the closest general fit). */
  defaultStyleId: string;
  /** What could not be read (a style without an id, a README naming no default …), for the job's log. */
  problems: string[];
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const read = (file: string): string | null => {
  try { const st = fs.statSync(file); return st.isFile() ? fs.readFileSync(file, "utf8").replace(/^﻿/, "") : null; } catch { return null; }
};
const markdownFiles = (dir: string): string[] | null => {
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md") && n.toLowerCase() !== "readme.md").sort((a, b) => a.localeCompare(b));
  } catch { return null; }
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The default style id styles/README.md names: a "default" key in its front matter, else the first known style id on
 *  a line that says "default". */
export function defaultStyleOf(readme: string, ids: readonly string[]): string | null {
  const fm = parseFrontmatter(readme);
  for (const key of ["default", "default_style", "default_id", "defaultStyle"]) {
    const v = textOf(fm?.data[key]);
    if (v && ids.includes(v)) return v;
  }
  for (const line of (fm ? fm.body : readme).split("\n")) {
    if (!/default/i.test(line)) continue;
    const hits = ids.map((id) => ({ id, at: line.search(new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRe(id)}(?![A-Za-z0-9_-])`, "i")) }))
      .filter((h) => h.at >= 0).sort((a, b) => a.at - b.at || b.id.length - a.id.length);
    if (hits.length) return hits[0].id;
  }
  return null;
}

/** The skill tree, or a JobFailure naming what the release is missing. */
export function loadDesignKit(dir: string = designSkillDir()): DesignKit {
  const skill = read(path.join(dir, "SKILL.md"));
  if (!skill?.trim()) throw new JobFailure("The designer release is missing figma-screen-design/SKILL.md. Deploy the matching engine skill tree.", "design.figmaSkillMissing");
  const principles = read(path.join(dir, "PRINCIPLES.md"));
  if (!principles?.trim()) throw new JobFailure("The designer release is missing figma-screen-design/PRINCIPLES.md (the house design principles). Deploy the matching engine skill tree.", "design.principlesMissing");
  const problems: string[] = [];
  const styleDir = path.join(dir, "styles");
  const styleFiles = markdownFiles(styleDir);
  if (!styleFiles) throw new JobFailure("The designer release is missing figma-screen-design/styles (the style directions). Deploy the matching engine skill tree.", "design.stylesMissing");
  const styles: DesignStyle[] = [];
  for (const name of styleFiles) {
    const text = read(path.join(styleDir, name));
    const fm = text ? parseFrontmatter(text) : null;
    const id = textOf(fm?.data.id) || name.replace(/\.md$/i, "");
    if (!text || !fm || !ID.test(id)) { problems.push(`styles/${name}: no readable front matter`); continue; }
    if (styles.some((s) => s.id === id)) { problems.push(`styles/${name}: the id ${id} is used twice`); continue; }
    styles.push({ id, name: textOf(fm.data.name) || id, summary: textOf(fm.data.summary), useWhen: listOf(fm.data.use_when),
      avoidWhen: listOf(fm.data.avoid_when), density: textOf(fm.data.density), text: text.trim(), file: `styles/${name}` });
  }
  if (!styles.length) throw new JobFailure("The designer release has no readable style direction in figma-screen-design/styles. Deploy the matching engine skill tree.", "design.stylesMissing");
  const readme = read(path.join(styleDir, "README.md")) ?? "";
  let defaultStyleId = defaultStyleOf(readme, styles.map((s) => s.id));
  if (!defaultStyleId) {
    problems.push(readme ? "styles/README.md names no known default style" : "styles/README.md is missing");
    defaultStyleId = styles[0].id;
  }
  const recipeDir = path.join(dir, "recipes");
  const recipeFiles = markdownFiles(recipeDir);
  if (!recipeFiles) problems.push("recipes/ is missing");
  const recipes: DesignRecipe[] = [];
  for (const name of recipeFiles ?? []) {
    const text = read(path.join(recipeDir, name));
    const fm = text ? parseFrontmatter(text) : null;
    const id = textOf(fm?.data.id) || name.replace(/\.md$/i, "");
    if (!text || !fm || !ID.test(id) || recipes.some((r) => r.id === id)) { problems.push(`recipes/${name}: not readable`); continue; }
    recipes.push({ id, name: textOf(fm.data.name) || id, appliesTo: listOf(fm.data.applies_to), text: text.trim(), file: `recipes/${name}` });
  }
  return { dir, skill, principles: principles.trim(), styles, recipes, defaultStyleId, problems };
}

// ------------------------------------------------------------------------------------------------- recipes

/** Every recipe applies at once (all, any, *). */
const UNIVERSAL = new Set(["all", "any", "*", "every", "always"]);
export const bytesOf = (s: string): number => Buffer.byteLength(s, "utf8");
export const RECIPES_MAX_BYTES = 60_000;

/** How many of a recipe's screen kinds the product's words name ("list", "tables", "sign-in" …). */
function kindHits(recipe: DesignRecipe, words: string): number {
  let n = 0;
  for (const raw of recipe.appliesTo) {
    const k = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!k) continue;
    if (UNIVERSAL.has(raw.trim().toLowerCase())) { n += 100; continue; }
    const forms = [k, `${k}s`, `${k}es`, ...(k.endsWith("y") ? [`${k.slice(0, -1)}ies`] : [])];
    if (forms.some((f) => words.includes(` ${f} `))) n++;
  }
  return n;
}

/** The recipes for the designer: all of them when they fit the budget together, else those whose screen kinds the
 *  product's words name (the ones for every screen first, then by how many kinds match) while they fit. Catalogue
 *  order is kept. */
export function selectRecipes(recipes: readonly DesignRecipe[], productWords: string, maxBytes = RECIPES_MAX_BYTES): DesignRecipe[] {
  const total = recipes.reduce((n, r) => n + bytesOf(r.text), 0);
  if (total <= maxBytes) return [...recipes];
  const words = ` ${productWords.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const ranked = recipes.map((r, i) => ({ r, i, hits: kindHits(r, words) })).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || a.i - b.i);
  const chosen = new Set<DesignRecipe>();
  let used = 0;
  for (const x of ranked) {
    const b = bytesOf(x.r.text);
    if (used + b > maxBytes) continue;
    chosen.add(x.r);
    used += b;
  }
  return recipes.filter((r) => chosen.has(r));
}

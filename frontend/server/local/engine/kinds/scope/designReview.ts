// The design review: inside design.generate, after the designer has drawn the screens and exported their PNGs, and
// before the design is shown to anyone.
//
//   1. Review. One call per batch of screens with the exported PNGs attached and no tools at all (the reviewer gets
//      the pictures, the rubric and the brief, nothing else). A demanding design director counts what is on every
//      screen (support hues, boxes inside boxes, truncated texts, blocks), scores it 1-10 on nine criteria
//      (REVIEW_CRITERIA) against a scale calibrated to the owner's taste (REVIEW_SCALE, with the rejected 4/10 design
//      as an anchor), and says whether it would ship in a top design-led product. Fixes come as removals and merges
//      first, then changes. The counted limits and the brief's brand colour are enforced here, in code.
//   2. Polish. A designer session on the same Figma file (same MCP config, model and effort as the drawing) applies
//      the fixes in place to every screen that did not pass, removals first, and exports those frames again over
//      their PNGs. The screen must end calmer, never busier. The other screens and the job's handoff files stay as
//      they are (restored if the session touched them).
//   3. Check. The polished screens are reviewed again, the others go along as reference for consistency. At most
//      MAX_POLISH_ROUNDS polish rounds; the loop stops as soon as every screen passes.
//
// A screen passes only with REVIEW_BAR or more on every criterion AND a yes to "would it ship in a top design-led
// product". Every step is recorded in the job folder (review-rubric.md, review-1.json, polish-1.json, review-2.json …,
// and design-review.json with the final scores), so a resumed job goes on where it stopped and never pays twice for a
// step. The design is saved whatever the scores: a screen still below the bar is reported in design-master.md. The
// only failure is Figma itself failing during a polish (design.figmaPolishFailed, a plain message); a review that
// cannot be completed keeps the screens as drawn and says so in design-master.md.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { JobFailure } from "../../run.ts";
import type { AiImage } from "../../ai/claude.ts";

// ------------------------------------------------------------------------------------------------- the rubric

export const REVIEW_BAR = 8;
export const MAX_POLISH_ROUNDS = 2;
export const REVIEW_STATE_FILE = "design-review.json";
export const REVIEW_RUBRIC_FILE = "review-rubric.md";
const SECTION_START = "<!-- design-review -->";
const SECTION_END = "<!-- /design-review -->";

/** The criteria, the owner's four complaints first (colour, composition, typography, space). */
export const REVIEW_CRITERIA = [
  { id: "colour", label: "Colour", name: "Colour harmony and restraint",
    check: "A neutral canvas, one primary accent (the brief's brand colour when it names one), at most one support hue, and status colours only on status indicators. Tints only where they carry meaning (selected, status, the one focal element), never to decorate rows, icons, avatars or sections. Fails with a rainbow of tinted icon circles, multi-coloured pills, avatars or categories, a decorative second highlight, loud saturated bands or muddy low-contrast tints; fails at once when the brief names a brand colour and the screen's primary accent is another colour." },
  { id: "composition", label: "Composition", name: "Composition, whitespace and congestion",
    check: "Few, clearly separated groups with generous, consistent gaps; count the blocks (cards, bands, panels, groups) and their nesting. No box inside a box (a card in a card, a tinted panel in a card, a card overlapping a band, a summary card inside the sticky bar). Nothing truncated, cut off with an ellipsis or hidden under a sticky bar. Fails when the screen feels congested: many blocks competing, tight gaps, every row carrying an icon bubble, a pill and a coloured meta line." },
  { id: "typography", label: "Type", name: "Typography",
    check: "One family, a clear scale with few sizes (title, section, body, caption), weights mostly regular and medium; semibold or bold only for the page title, the one key figure and button labels. Comfortable body size (16 px on phone, 14-16 px on desktop) and line height, 45-75 characters per line for running text, captions muted but not tiny. Fails with bold headings and labels everywhere, many sizes, cramped line heights or small grey text doing important work." },
  { id: "space", label: "Space", name: "Space optimisation",
    check: "The frame is used well: content sized and placed for the frame, no cramming of many small things into part of it, no dead half (an empty half beside crammed content on desktop, an unanchored float on phone). Whitespace that frames the focal point is good space, never a defect: a phone screen does not have to be filled to the bottom. Fails when things are crammed, or when the layout wastes half the frame." },
  { id: "hierarchy", label: "Focus", name: "Focal point and hierarchy",
    check: "One clear focal point the eye lands on first (the thing the person came for) and one obvious primary action; everything else visibly steps down in size, weight and colour. Fails when two or more things shout (a hero band, a filled card and a coloured chart at once), or nothing leads." },
  { id: "consistency", label: "Consistency", name: "Consistency across screens",
    check: "The same components, spacing, radii, shadows, icon family, colours and words for the same thing on every screen; top bars and navigation identical; the same fact reads the same everywhere; true to the chosen style direction's type and shapes, with the brand colour first." },
  { id: "content", label: "Content", name: "Content realism",
    check: "Domain-correct fictional content in the brief's language and regional formats: names, amounts, dates and statuses that tell a believable story, with a long name and varied states where they matter, never padded with extra rows or explanations. Never lorem ipsum, the words demo, mock, sample, test or placeholder, raw error text, or AI or magic wording and sparkle icons." },
  { id: "craft", label: "Finish", name: "Craft and alignment",
    check: "Spacing on the 8 px grid, consistent padding, aligned edges and baselines, icons centred in their containers, buttons on one baseline, touch targets at least 44 px. Nothing clipped, overlapping or wrapping awkwardly." },
  { id: "accessibility", label: "Access", name: "Accessibility",
    check: "WCAG AA contrast (4.5:1 for body text, 3:1 for large text, input outlines and icons that carry meaning), body text at least 14 px on desktop and 16 px on phone, colour never the only signal (an icon or a word with it), visible focus where a focused state is shown." },
] as const;
export type CriterionId = (typeof REVIEW_CRITERIA)[number]["id"];
const CRITERION_IDS: readonly string[] = REVIEW_CRITERIA.map((c) => c.id);

/** The progress lines people see while the design job works (plain steps, no "AI" wording). */
export const REVIEW_STEPS = {
  drawing: "Drawing the screens",
  reviewing: "Reviewing every screen against the brief and the house principles",
  polishing: (n: number) => `Polishing ${n} screen${n === 1 ? "" : "s"}`,
  checking: (n: number) => `Checking the ${n} polished screen${n === 1 ? "" : "s"}`,
  final: "Final check",
} as const;
const REVIEW_PROGRESS = [70, 80, 92];
const POLISH_PROGRESS = [74, 86];

/** The scale, calibrated to the owner's taste. */
export const REVIEW_SCALE = [
  "9-10: indistinguishable from a top design-led product: calm, spacious, crisp type, a restrained harmonious palette, one clear focal point, nothing extra. You cannot name a single thing to remove.",
  "7-8: good, but with visible clutter or weak hierarchy. 8 is the lowest pass: one small, local flaw on that criterion and nothing to remove; 7: the clutter or weak hierarchy shows at a glance.",
  "5-6: clean but generic (a template look with no point of view) OR busy (too many blocks, colours or weights competing).",
  "3-4: congested, a muddy palette, heavy weights, small cramped text (the 4/10 anchor below).",
  "1-2: broken: clipped, overlapping, unreadable, mostly empty, or missing what the screen is for.",
] as const;

/** The design the owner rated 4/10 (a lenient review had scored it about 8): the anchor for 3-4. */
export const REJECTED_ANCHOR = "A clinic booking design the owner rated 4/10, which a lenient review had scored about 8. On the phone screens: a saturated berry gradient hero with a decorative sun-gold disc behind the status bar; berry, gold, teal, green, sky blue, lavender and amber on one screen (a differently tinted icon circle in front of every row, initials avatars in four tints, status pills in three colours); a pill card inside the tinted header, a selected card holding its own avatar stack and pill, a list card under it and a summary card in the sticky bar, so five or more blocks compete on a 390 px screen; most titles and labels semibold or bold; every row stacked as a bold name, a grey subtitle and a coloured 14 px meta line; the list running under the sticky bar; a card added only to fill a gap. On desktop: KPI cards overlapping a gradient hero band, a coloured icon bubble before every card title, three chart colours plus status green and gold, 13-14 px labels packed into every card, names cut off with an ellipsis in the schedule ('Peter Oder…', 'Markus Arn…'). Each part was tidy; together they were congested, loud and cheap-looking. Anything like it scores 3-4 on colour, composition, typography and space, and would not ship.";

/** What the reviewer counts on every screen; a count over its limit caps the criterion it belongs to (in code). */
export const COUNTS = [
  { id: "supportHues", criterion: "colour", limit: 1, what: "hues other than the neutrals, the primary accent (with its shades and tints) and status colours used only on status indicators: decorative or category tints of icon circles, avatars, pills, sections, charts and highlights each count" },
  { id: "nestedBoxes", criterion: "composition", limit: 0, what: "drawn containers (filled, tinted, bordered or shadowed boxes) inside another drawn container or overlapping a band; rows of one list, pills, tags, avatars, buttons and inputs do not count" },
  { id: "truncatedTexts", criterion: "composition", limit: 0, what: "texts cut off with an ellipsis, clipped by an edge or hidden under a sticky bar" },
  { id: "blocks", criterion: "composition", limit: null, what: "distinct content blocks (cards, bands, panels, separated groups), not counting the top bar, the navigation and the sticky action bar; judged against the house principles' limits" },
] as const;
export type CountId = (typeof COUNTS)[number]["id"];

/** Kinds of fix, in the order the polish applies them; "add" only where something required is missing. */
export const FIX_KINDS = ["remove", "merge", "change", "add"] as const;
export type FixKind = (typeof FIX_KINDS)[number];
const ADD_ALLOWED: readonly string[] = ["content", "accessibility"];

/** The brand colour the brief names (a hex, or a colour named as the brand's). */
export interface BrandColour { hex: string | null; name: string | null; said: string }
const COLOUR_NAME = /\b((?:deep|dark|light|bright|soft|warm|cool|pale|muted|royal|navy|forest|sky|ocean|petrol)\s+)?(teal|turquoise|cyan|aqua|blue|navy|cobalt|azure|indigo|violet|purple|lilac|lavender|plum|magenta|pink|rose|berry|raspberry|burgundy|maroon|wine|red|crimson|scarlet|coral|orange|amber|ochre|gold|golden|yellow|lime|olive|green|emerald|mint|sage|petrol|brown|bronze|copper|beige|sand|black|charcoal|graphite|grey|gray|silver)\b/i;
const BRANDISH = /\b(brand(?:ing|ed)?|corporate|company colou?rs?|logo|primary colou?r|house colou?rs?)\b/i;
const NEGATED = /\b(no|not|without|none|don't|do not|haven't|have not)\b[^.]*\b(brand|colou?rs?|logo)\b/i;
const HEX = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i;
export function normalHex(v: unknown): string | null {
  const m = typeof v === "string" ? /^\s*#?([0-9a-f]{6}|[0-9a-f]{3})\s*$/i.exec(v) : null;
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toUpperCase()}`;
}
/** The brand colour among the brief's brand lines (facts.brand): a hex on a brand line first, then any hex, then a
 *  colour named on a line about the brand; null when the brief names none. */
export function brandColourOf(lines: readonly string[]): BrandColour | null {
  const usable = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !NEGATED.test(l));
  const hexLine = usable.find((l) => HEX.test(l) && BRANDISH.test(l)) ?? usable.find((l) => HEX.test(l));
  if (hexLine) {
    const hex = normalHex(HEX.exec(hexLine)![0]);
    const name = COLOUR_NAME.exec(hexLine);
    return { hex, name: name ? name[0].toLowerCase() : null, said: hexLine.slice(0, 280) };
  }
  const named = usable.find((l) => BRANDISH.test(l) && COLOUR_NAME.test(l));
  return named ? { hex: null, name: COLOUR_NAME.exec(named)![0].toLowerCase(), said: named.slice(0, 280) } : null;
}
export const brandLabel = (b: BrandColour): string => [b.name, b.hex].filter(Boolean).join(" ") || b.said;

function lab(hex: string): { l: number; a: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), bl = lin(n & 255);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl), z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}
/** True when the accent is the brand colour or one of its shades (same hue family in CIELAB; a neutral brand colour
 *  wants a neutral accent of similar lightness). */
export function onBrandHue(accent: string, brand: string): boolean {
  const p = lab(accent), q = lab(brand);
  const cp = Math.hypot(p.a, p.b), cq = Math.hypot(q.a, q.b);
  if (cq < 12) return cp < 15 && Math.abs(p.l - q.l) < 30;
  if (cp < 12) return false;
  let d = Math.abs(Math.atan2(p.b, p.a) - Math.atan2(q.b, q.a)) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d <= 30;
}

/** The house principles' "Super stylish: restraint with intent" section as written (null when there is none), and
 *  the principles without it. */
export function restraintSection(principles: string): { section: string | null; rest: string } {
  const lines = principles.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && /super stylish/i.test(l));
  if (start < 0) return { section: null, rest: principles.trim() };
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level);
  if (end < 0) end = lines.length;
  return { section: lines.slice(start, end).join("\n").trim(), rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim() };
}

/** The items of a recipe's "Common mistakes" section (an item may go on over the next lines). */
export function commonMistakes(text: string): string[] {
  const m = /^##[ \t]+Common mistakes[ \t]*$/im.exec(text.replace(/\r\n?/g, "\n"));
  if (!m) return [];
  const rest = text.replace(/\r\n?/g, "\n").slice(m.index + m[0].length);
  const end = rest.search(/^#{1,2}\s/m);
  const items: string[] = [];
  for (const raw of (end >= 0 ? rest.slice(0, end) : rest).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) items.push(item[1].trim());
    else if (items.length) items[items.length - 1] = `${items[items.length - 1]} ${line}`;
  }
  return items.filter(Boolean);
}

export interface RubricSource {
  principles: string;
  style?: { name: string; file: string; text: string } | null;
  recipes: readonly { name: string; text: string }[];
  /** The brand colour the brief names (brandColourOf), if any. */
  brand?: BrandColour | null;
}

const capOf = (bar: number) => Math.max(1, bar - 2);
const brandCapOf = (bar: number) => Math.max(1, bar - 4);
const passRule = (bar: number) => `A screen passes only when every criterion scores ${bar} or more out of 10 AND the overall verdict "would it ship, exactly as it is, in a top design-led product?" is yes.`;

/** The rubric the reviewer scores against (also written to review-rubric.md): the gate, the calibrated scale with its
 *  4/10 anchor, the counted limits, the brand colour, the criteria, then the house principles' restraint section,
 *  the rest of the principles, the chosen style direction and the recipes' common mistakes, as written. */
export function reviewRubric(src: RubricSource, bar = REVIEW_BAR): string {
  const mistakes = src.recipes.map((r) => ({ name: r.name, items: commonMistakes(r.text) })).filter((r) => r.items.length);
  const { section, rest } = restraintSection(src.principles);
  const cap = capOf(bar), brandCap = brandCapOf(bar);
  return [
    "# Screen review rubric",
    "",
    passRule(bar),
    "",
    "## The scale (calibrated to the owner's taste)",
    "",
    ...REVIEW_SCALE.map((s) => `- ${s}`),
    "",
    "### The 4/10 anchor",
    "",
    REJECTED_ANCHOR,
    "",
    "### How to score",
    "",
    "- Default to skepticism. Every point above 5 is earned by something you can see; when torn between two scores, give the lower. Score what is on the screen, not what was intended.",
    "- Every extra element costs. Richness never earns a point: more cards, bands, tints, pills, icon bubbles, avatars, charts, shadows or illustrations make a screen busier, not better.",
    "- Whitespace is not a defect. Calm space that frames the focal point is good design; never ask to fill it.",
    "- A 9 or 10 needs that you cannot name a single thing to remove. A screen you would not ship scores below the bar on the criteria that hold it back.",
    "",
    "## Counted limits (checked in code)",
    "",
    "Count these on every screen and report them in counts. A count over its limit caps its criterion at " + `${cap}, whatever the score you give.`,
    "",
    ...COUNTS.map((c) => `- \`${c.id}\` (${REVIEW_CRITERIA.find((x) => x.id === c.criterion)!.name.toLowerCase()}${c.limit === null ? "" : `, limit ${c.limit}`}): ${c.what}.`),
    "",
    "## The brand colour",
    "",
    src.brand
      ? `The brief names the brand colour: ${brandLabel(src.brand)} ("${src.brand.said}"). It must be the primary accent of every screen (primary buttons, selected states, links, focus, progress, the hero), with shades derived from it. A screen whose primary accent is another colour fails colour harmony (at most ${brandCap}), whatever else is right. Report the accent you see in \`accent\` as a hex and set \`onBrand\` to false when it is not the brand colour.`
      : "The brief names no brand colour: the style direction's accent is the primary accent. Report the accent you see in `accent` and set `onBrand` to true.",
    "",
    "## Criteria",
    "",
    ...REVIEW_CRITERIA.map((c, i) => `${i + 1}. **${c.name}** (\`${c.id}\`): ${c.check}`),
    "",
    ...(section ? ["## The house principles' restraint limits (PRINCIPLES.md, as written)", "", "These limits decide colour, composition, typography and space.", "", section, ""] : []),
    "## House principles (PRINCIPLES.md)",
    "",
    "Every screen meets these, whatever the style direction. Where anything below asks for richness (bands, tinted containers, pills, avatars, charts, depth), it counts only within the scale, the counted limits and restraint above.",
    "",
    rest,
    "",
    ...(src.style ? [`## The chosen style direction: ${src.style.name} (${src.style.file})`, "", "Judge consistency with its type, shapes and character; the brand colour wins over its accent, and the limits above win over its decoration.", "", src.style.text.trim(), ""] : []),
    ...(mistakes.length ? ["## Common mistakes from the screen recipes", "", "Check every screen against these.", "",
      ...mistakes.flatMap((r) => [`### ${r.name}`, ...r.items.map((i) => `- ${i}`), ""])] : []),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** The quality bar the designer reads before drawing and while polishing: the same gate, scale and criteria. */
export function designQualityBar(bar = REVIEW_BAR): string {
  return `Quality bar: before anyone sees the design, a demanding design director reviews every exported screen. ${passRule(bar)} ${REVIEW_SCALE[0]} A congested screen (many tinted boxes, many hues, bold text everywhere, small cramped labels, cards inside cards) scores 3-4. The criteria, each 1-10 with ${bar} or more on each: ${REVIEW_CRITERIA.map((c) => `${c.name} (${c.check})`).join(" ")} Counted on every screen: at most 1 support hue besides the neutral canvas and the primary accent (the brief's brand colour when it names one), no box inside a box, no truncated text. Design for restraint with intent: fewer, larger, calmer elements; whitespace is part of the design; every element earns its place.`;
}

/** The reviewer's system prompt: the role, how to answer, the rubric and the brief. */
export function reviewSystem(rubric: string, brief: string | null, bar = REVIEW_BAR): string {
  return [
    "You are a demanding senior design director at a design-led product studio. Before a client sees a design, you decide whether each screen would ship in a top design-led product (the calibre of Linear, Stripe, Airbnb or Apple, for the standard, never to copy their look): calm, spacious, crisp type, a restrained harmonious palette, one clear focal point, nothing extra. Default to skepticism. You do not round scores up to be kind; a lenient review once scored a congested design 8 that the owner rated 4 (the anchor in the rubric).",
    "Each screen is an exported PNG, labelled with its file name. For every screen you are asked to score, in this order:",
    "1. counts: count supportHues, nestedBoxes, truncatedTexts and blocks as the rubric defines them. accent: the hex of the primary accent you see (primary button, selected state, links, progress), or null. onBrand: false when the brief names a brand colour and the primary accent is not it (or one of its shades), else true.",
    `2. scores: every criterion of the rubric from 1 to 10 against the calibrated scale. ship: true only when you would ship this screen exactly as it is in a top design-led product; when in doubt, false.`,
    `3. fixes, for every criterion below ${bar} and for anything that stops ship: subtract first. List what to REMOVE (decoration, duplicate information, extra tints, icon bubbles, pills, dividers, borders, shadows, a box around a box), then what to MERGE (related blocks into one, two lines into one), then what to CHANGE (spacing, size, weight, colour, alignment). Never suggest adding a decorative element (a card, band, illustration, pill, icon bubble, avatar, chart, gradient, shadow or colour) to raise a score, and never fill whitespace: an empty area is fixed by re-composing (larger type, more generous spacing, a better anchor). A fix of kind "add" is allowed only for content the brief requires that the screen lacks (content) or a non-colour signal WCAG needs (accessibility).`,
    "Each fix has: kind (remove, merge, change or add), criterion (its id), where (the region or element of that screen), what (the change), how (in exact design terms: sizes in px, type size and weight, the style direction's colour tokens with their hex values, the component to use). Order the fixes: removals, merges, changes, then additions; at most 8 per screen. Never ask for a feature, screen or requirement the brief does not support.",
    "verdict: one plain sentence saying what holds the screen back most, or why it ships.",
    "",
    rubric.trim(),
    ...(brief ? ["", "## The design brief", "", "What the screens must show and for whom; judge content and realism against it.", "", brief.trim()] : []),
  ].join("\n");
}

const SCORES_SCHEMA = { type: "object", additionalProperties: false, required: [...CRITERION_IDS], properties: Object.fromEntries(CRITERION_IDS.map((id) => [id, { type: "integer" }])) };
const COUNTS_SCHEMA = { type: "object", additionalProperties: false, required: COUNTS.map((c) => c.id), properties: Object.fromEntries(COUNTS.map((c) => [c.id, { type: "integer" }])) };
export const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["screens"], properties: {
    screens: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "counts", "accent", "onBrand", "scores", "ship", "verdict", "fixes"], properties: {
      file: { type: "string" }, counts: COUNTS_SCHEMA, accent: { type: ["string", "null"] }, onBrand: { type: "boolean" },
      scores: SCORES_SCHEMA, ship: { type: "boolean" }, verdict: { type: "string" },
      fixes: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "criterion", "where", "what", "how"], properties: {
        kind: { type: "string", enum: [...FIX_KINDS] }, criterion: { type: "string", enum: [...CRITERION_IDS] }, where: { type: "string" }, what: { type: "string" }, how: { type: "string" },
      } } },
    } } },
  },
} as const;
export const POLISH_SCHEMA = {
  type: "object", additionalProperties: false, required: ["error", "screens"], properties: {
    error: { type: ["string", "null"] },
    screens: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "changes", "notes"], properties: {
      file: { type: "string" }, changes: { type: "array", items: { type: "string" } }, notes: { type: "string" },
    } } },
  },
} as const;

// ------------------------------------------------------------------------------------------------- the answers

export interface ReviewScreen { name: string; nodeId: string; file: string; width?: number; height?: number; bytes?: number }
export interface ScreenFix { kind: FixKind; criterion: CriterionId; where: string; what: string; how: string }
export interface ScreenReview {
  file: string; name: string; nodeId: string; scores: Record<CriterionId, number>; verdict: string; fixes: ScreenFix[];
  /** Would ship exactly as it is in a top design-led product. */
  ship: boolean;
  accent: string | null; onBrand: boolean;
  counts: Record<CountId, number>;
  /** The counted limits and the brand check this screen broke (each caps its criterion, here in code). */
  breaches: string[];
}

/** A review answer that cannot be used (a screen missing, a score out of range, a weak screen without fixes). */
export class ReviewRejected extends Error {
  constructor(message: string) { super(message); this.name = "ReviewRejected"; }
}
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const baseName = (f: string): string => path.posix.basename(f.trim().replace(/\\/g, "/"));
/** A screen is below the bar when any criterion scores under it, or the director would not ship it. */
export const belowBar = (r: Pick<ScreenReview, "scores"> & { ship?: boolean }, bar = REVIEW_BAR): boolean => r.ship === false || REVIEW_CRITERIA.some((c) => r.scores[c.id] < bar);
export const lowestOf = (r: Pick<ScreenReview, "scores">): { id: CriterionId; score: number } =>
  REVIEW_CRITERIA.map((c) => ({ id: c.id as CriterionId, score: r.scores[c.id] })).reduce((a, b) => (b.score < a.score ? b : a));
/** Fixes in the order the polish applies them: removals, merges, changes, additions. */
export const orderedFixes = (fixes: readonly ScreenFix[]): ScreenFix[] =>
  fixes.map((f, i) => ({ f, i })).sort((a, b) => FIX_KINDS.indexOf(a.f.kind) - FIX_KINDS.indexOf(b.f.kind) || a.i - b.i).map((x) => x.f);

/** The counted limits and the brand check, enforced: each breach caps its criterion and brings its own fix. */
function enforce(r: Omit<ScreenReview, "breaches">, brand: BrandColour | null, bar: number): { scores: Record<CriterionId, number>; fixes: ScreenFix[]; breaches: string[] } {
  const scores = { ...r.scores };
  const fixes: ScreenFix[] = [];
  const breaches: string[] = [];
  const cap = (id: CriterionId, to: number) => { scores[id] = Math.min(scores[id], to); };
  const hues = r.counts.supportHues, nested = r.counts.nestedBoxes, cut = r.counts.truncatedTexts;
  if (hues > 1) {
    cap("colour", capOf(bar)); breaches.push(`${hues} support hues (limit 1): colour harmony at most ${capOf(bar)}`);
    fixes.push({ kind: "remove", criterion: "colour", where: "the whole screen", what: `${hues} support hues besides the neutrals and the primary accent; the limit is 1.`,
      how: "Keep the neutral canvas, the primary accent and at most one support hue: set decorative tints (icon circles, avatars, category pills, section backgrounds, chart series) to neutral or to the accent's own tint, and keep status colours only on status indicators." });
  }
  if (nested > 0) {
    cap("composition", capOf(bar)); breaches.push(`${nested} box${nested === 1 ? "" : "es"} inside another box (limit 0): composition at most ${capOf(bar)}`);
    fixes.push({ kind: "remove", criterion: "composition", where: "the whole screen", what: `${nested} container${nested === 1 ? " sits" : "s sit"} inside another container or overlap a band.`,
      how: "Remove the inner container: keep its content on the parent surface, separated by spacing or a divider. A card never sits in a card, in a tinted panel or over a band." });
  }
  if (cut > 0) {
    cap("composition", capOf(bar)); breaches.push(`${cut} truncated text${cut === 1 ? "" : "s"} (limit 0): composition at most ${capOf(bar)}`);
    fixes.push({ kind: "change", criterion: "composition", where: "the whole screen", what: `${cut} text${cut === 1 ? " is" : "s are"} cut off.`,
      how: "Give each cut-off text the room it needs: fewer columns or wider ones, a second line, or a shorter label; nothing ends in an ellipsis or hides under the sticky bar." });
  }
  const offBrand = brand && (r.onBrand === false || (brand.hex && r.accent && !onBrandHue(r.accent, brand.hex)));
  if (brand && offBrand) {
    cap("colour", brandCapOf(bar)); breaches.push(`primary accent ${r.accent ?? "seen"} is not the brand colour ${brandLabel(brand)}: colour harmony at most ${brandCapOf(bar)}`);
    fixes.push({ kind: "change", criterion: "colour", where: "the primary accent: primary buttons, selected states, links, focus, progress, the hero",
      what: `The primary accent${r.accent ? ` ${r.accent}` : ""} is not the brief's brand colour ${brandLabel(brand)}.`,
      how: `Make ${brandLabel(brand)} the primary accent everywhere the current accent appears, with hover, pressed and tint shades derived from it; darken the shade used for text until it passes WCAG AA. Keep the style's structure, type and shapes.` });
  }
  return { scores, fixes, breaches };
}

/** The reviews of the expected screens from a review answer; throws ReviewRejected when it cannot be used. The
 *  counted limits and the brand colour are enforced here (each breach caps its criterion), and the fixes come in the
 *  polish order (removals, merges, changes, additions); an "add" is kept only for content or accessibility. */
export function parseReview(raw: unknown, expected: readonly Pick<ReviewScreen, "file" | "name" | "nodeId">[], o: { bar?: number; brand?: BrandColour | null } = {}): ScreenReview[] {
  const bar = o.bar ?? REVIEW_BAR, brand = o.brand ?? null;
  const list = raw && typeof raw === "object" && Array.isArray((raw as { screens?: unknown }).screens) ? (raw as { screens: unknown[] }).screens : null;
  if (!list) throw new ReviewRejected("the answer names no screens");
  const byFile = new Map<string, Record<string, unknown>>();
  for (const e of list) {
    if (!e || typeof e !== "object" || typeof (e as { file?: unknown }).file !== "string") continue;
    const f = baseName((e as { file: string }).file);
    if (!byFile.has(f)) byFile.set(f, e as Record<string, unknown>);
  }
  return expected.map((s) => {
    const e = byFile.get(s.file);
    if (!e) throw new ReviewRejected(`no review for ${s.file}`);
    const given = e.scores && typeof e.scores === "object" ? e.scores as Record<string, unknown> : {};
    const scores = {} as Record<CriterionId, number>;
    for (const c of REVIEW_CRITERIA) {
      const v = given[c.id];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10) throw new ReviewRejected(`${s.file}: ${c.id} is not a score from 1 to 10`);
      scores[c.id] = v;
    }
    const countsGiven = e.counts && typeof e.counts === "object" ? e.counts as Record<string, unknown> : {};
    const counts = {} as Record<CountId, number>;
    for (const c of COUNTS) {
      const v = countsGiven[c.id];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 999) throw new ReviewRejected(`${s.file}: ${c.id} is not a count`);
      counts[c.id] = v;
    }
    if (typeof e.ship !== "boolean") throw new ReviewRejected(`${s.file}: no ship verdict`);
    const given_fixes: ScreenFix[] = (Array.isArray(e.fixes) ? e.fixes : []).flatMap((f): ScreenFix[] => {
      const x = f && typeof f === "object" ? f as Record<string, unknown> : {};
      const kind = (FIX_KINDS as readonly string[]).includes(String(x.kind)) ? x.kind as FixKind : "change";
      const fix = { kind, criterion: x.criterion as CriterionId, where: text(x.where, 300), what: text(x.what, 600), how: text(x.how, 900) };
      if (kind === "add" && !ADD_ALLOWED.includes(String(x.criterion))) return [];
      return CRITERION_IDS.includes(String(x.criterion)) && fix.where && fix.what && fix.how ? [fix] : [];
    });
    const review = { file: s.file, name: s.name, nodeId: s.nodeId, scores, verdict: text(e.verdict, 400), fixes: given_fixes,
      ship: e.ship, accent: normalHex(e.accent), onBrand: e.onBrand !== false, counts };
    const enforced = enforce(review, brand, bar);
    const seen = new Set<string>();
    const fixes = orderedFixes([...enforced.fixes, ...given_fixes]).filter((f) => { const k = JSON.stringify(f); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 12);
    const out: ScreenReview = { ...review, scores: enforced.scores, fixes, ship: review.ship && !enforced.breaches.length, breaches: enforced.breaches };
    if (belowBar(out, bar) && !fixes.length) throw new ReviewRejected(`${s.file} is below the bar without fixes`);
    return out;
  });
}

export interface PolishAnswer { error: string | null; screens: { file: string; changes: string[]; notes: string }[] }
export function parsePolish(raw: unknown): PolishAnswer {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const error = typeof r.error === "string" && r.error.trim() ? r.error.trim().slice(0, 600) : null;
  const screens = (Array.isArray(r.screens) ? r.screens : []).flatMap((s) => {
    const x = s && typeof s === "object" ? s as Record<string, unknown> : {};
    return typeof x.file === "string" ? [{ file: baseName(x.file), changes: (Array.isArray(x.changes) ? x.changes : []).map((c) => text(c, 400)).filter(Boolean).slice(0, 20), notes: text(x.notes, 600) }] : [];
  });
  return { error, screens };
}

/** A polish error that means the Figma tools themselves failed (the job then fails plainly). */
const FIGMA_FAILED = /^\s*Figma (?:tools failed|capability unavailable)\b|MCP.*(?:limit|allowance)|Starter.plan|rate.?limit/i;
export const POLISH_FIGMA_FAILURE = "Figma stopped working while the screens were being polished, so this design was not saved yet. The screens drawn so far are kept in the Figma file; run the design again once Figma works and it carries on from where it stopped.";

/** What the designer does in a polish round: removals and merges first, then spacing, typography and colour; the
 *  style and the brand colour kept; every screen re-exported, calmer than before. */
export function polishInstructions(o: { projectUrl: string; round: number; brand?: BrandColour | null; bar?: number }): string {
  const bar = o.bar ?? REVIEW_BAR;
  return `You are the product designer of this product, polishing the screens you drew. A demanding design director reviewed every exported screen against the design brief, the house principles, the chosen style direction and the screen recipes. ${passRule(bar)} The screens in "screens" did not pass; each comes with its counts, its breaches of the counted limits and the director's fixes, ordered remove, merge, change, add. This is polishing round ${o.round}. Polishing simplifies: every screen must end calmer, with fewer elements, fewer colours and fewer boxes than it started with, never more.
Use only the official Figma MCP for remote design operations. Never access credentials, publish a website, install packages, use unrelated servers or call Blocks APIs. Use the already installed curl only to download the PNG URLs that get_screenshot returns.
Work only in the recorded Figma file ${o.projectUrl}. Do not create a new file, page or top-level frame. Never delete, replace, rename or move a listed frame: change what is inside it, so its node id stays the same. Leave the screens in "otherScreens" untouched; they are the reference for consistency, so reuse their components, colours, type, spacing, radii and icons.
Before using use_figma, read its official skill with ReadMcpResourceTool (skill://figma/figma-use/SKILL.md; ListMcpResourcesTool lists the skills) and follow it; load fonts before editing text.
For each listed screen, one at a time:
1. Look at its PNG in the working directory and inspect the frame's current structure in one batched use_figma read.
2. Remove and merge first: apply every fix of kind "remove", then every "merge". Delete decoration, extra tints, icon bubbles, pills, dividers, borders and shadows that carry no meaning; take every box out of its box; fold duplicate or related information into one place. Content the brief requires stays (move, merge or restyle it, never drop it), so the screen's requirement coverage does not change.
3. Then spacing, typography and colour: apply every "change" fix. Generous, consistent gaps on the 8 px grid; a few clear sizes with weights mostly regular and medium; the neutral canvas, the primary accent and at most one support hue; nothing truncated. Apply an "add" fix only as written (required content or a non-colour signal), in its quietest form.
4. Keep the chosen style direction and the brand colour: do not switch style, typeface or accent.${o.brand ? ` The brief's brand colour ${brandLabel(o.brand)} is the primary accent of every screen (shades derived from it); where a screen uses another accent, change it to the brand colour.` : ""} Never add a decorative element (a card, band, illustration, pill, icon bubble, avatar, chart, gradient, shadow or colour) to raise a score or to fill space: an empty area is fixed by re-composing (larger type, more generous spacing, a better anchor), never by filling it.
5. Re-export the frame: get_screenshot with the fileKey and the frame's nodeId (maxDimension 2048), then download its PNG URL with curl over the same file name in the working directory. Compare the new PNG with the old: it must be calmer, not busier (fewer blocks, fewer hues, nothing nested, nothing cut off). If it got busier, undo what you added. Correct anything clipped, overlapping or misaligned before moving to the next screen.
If a fix contradicts the brief or a house principle, follow the brief and the principle and say so in that screen's notes. If you change a token or component that design-master.md or design-tokens.json describes, update that line there; do not change any other file in the working directory.
If a Figma tool fails (a missing capability, a permission, a rate or plan limit), stop and return error starting with "Figma tools failed:" and what failed; otherwise error is null. Return, for each screen you worked on, its file, what you changed (removals first) and any notes.
${designQualityBar(bar)}`;
}

/** The polish session's prompt: the screens that did not pass with their fixes in the polish order. */
export function polishRequest(o: { directory: string; projectUrl: string; round: number; screens: readonly ScreenReview[]; others: readonly ReviewScreen[]; brand?: BrandColour | null; bar?: number }): string {
  return JSON.stringify({ directory: o.directory, projectUrl: o.projectUrl, round: o.round, bar: o.bar ?? REVIEW_BAR, brandColour: o.brand ? brandLabel(o.brand) : null,
    screens: o.screens.map((r) => ({ name: r.name, nodeId: r.nodeId, file: r.file, scores: r.scores, ship: r.ship, counts: r.counts, breaches: r.breaches, verdict: r.verdict, fixes: orderedFixes(r.fixes) })),
    otherScreens: o.others.map((s) => ({ name: s.name, nodeId: s.nodeId, file: s.file })),
    handoff: ["design-brief.md", "ux-plan.md", "design-master.md"] });
}

// ------------------------------------------------------------------------------------------------- the files

export interface PngInfo { bytes: Buffer; width: number; height: number }
/** An exported screen as the export checks accept it (a plain PNG file up to 5 MB), or null. */
export function pngInfo(file: string): PngInfo | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size < 24 || st.size > 5 * 1024 * 1024) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 1 || width > 20000 || height < 1 || height > 100000) return null;
    return { bytes, width, height };
  } catch { return null; }
}
const hashOf = (file: string): string | null => { try { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch { return null; } };
const readJson = (file: string): any => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const writeJson = (file: string, data: unknown): void => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** The screen's picture for the reviewer, labelled with its file name. */
export function reviewImages(dir: string, score: readonly ReviewScreen[], reference: readonly ReviewScreen[]): AiImage[] {
  const image = (s: ReviewScreen, ref: boolean): AiImage[] => {
    const png = pngInfo(path.join(dir, s.file));
    return png ? [{ mimeType: "image/png", data: png.bytes, label: `${s.file}: ${s.name} (frame ${s.nodeId}, ${png.width} x ${png.height})${ref ? ", reference only: do not score" : ""}` }] : [];
  };
  return [...score.flatMap((s) => image(s, false)), ...reference.flatMap((s) => image(s, true))];
}

/** What the reviewer is asked in one call. */
export function reviewPrompt(o: { round: number; score: readonly ReviewScreen[]; reference: readonly ReviewScreen[]; bar?: number }): string {
  const bar = o.bar ?? REVIEW_BAR;
  const view = (s: ReviewScreen) => ({ file: s.file, name: s.name, frame: s.nodeId, size: s.width && s.height ? `${s.width} x ${s.height}` : undefined });
  return [
    o.round === 1 ? "Review these screens of the first drawing." : `These screens were polished after the previous review; judge them as they are now (review ${o.round}).`,
    `For each of them: count, score every criterion, decide ship, then give the fixes (removals and merges first) that bring every criterion below ${bar} up to ${bar} and make it shippable:`,
    JSON.stringify(o.score.map(view)),
    o.reference.length ? `\nAlso attached, for reference only (do not score them): ${JSON.stringify(o.reference.map(view))}. Use them to judge consistency across screens.` : "",
    "\nAnswer with exactly one entry per screen to score, keyed by its file name.",
  ].filter(Boolean).join("\n");
}

/** The batches the screens are reviewed in: all of them in one call when they fit (at most 20 pictures and 12 MB),
 *  else up to 16 screens to score per call with up to 4 others as reference for consistency. */
export function reviewBatches<T extends ReviewScreen>(score: readonly T[], others: readonly T[], o: { maxImages?: number; maxBytes?: number } = {}): { score: T[]; reference: T[] }[] {
  const maxImages = o.maxImages ?? 20, maxBytes = o.maxBytes ?? 12 * 1024 * 1024;
  const size = (list: readonly T[]) => list.reduce((n, s) => n + (s.bytes ?? 0), 0);
  if (score.length + others.length <= maxImages && size(score) + size(others) <= maxBytes) return [{ score: [...score], reference: [...others] }];
  const per = Math.max(1, maxImages - 4);
  const batches: { score: T[]; reference: T[] }[] = [];
  let cur: T[] = [];
  for (const s of score) {
    if (cur.length && (cur.length >= per || size([...cur, s]) > maxBytes * 0.75)) { batches.push({ score: cur, reference: [] }); cur = []; }
    cur.push(s);
  }
  if (cur.length) batches.push({ score: cur, reference: [] });
  const pool = [...others, ...score];
  for (const b of batches) {
    const rest = pool.filter((s) => !b.score.includes(s));
    // one of each frame width first (phone and desktop), then the rest, while they fit
    const widths = new Set<number | undefined>();
    const ordered = [...rest.filter((s) => (widths.has(s.width) ? false : (widths.add(s.width), true))), ...rest];
    for (const s of ordered) {
      if (b.reference.length >= maxImages - b.score.length || b.reference.length >= 4) break;
      if (b.reference.includes(s) || size([...b.score, ...b.reference, s]) > maxBytes) continue;
      b.reference.push(s);
    }
  }
  return batches;
}

/** The job's own files, kept as they are around a polish session: it may change only the PNGs it polishes, the
 *  design master and the design tokens. Anything else it changed or removed is put back; the answer names them. */
function guardFiles(dir: string, editable: ReadonlySet<string>): () => string[] {
  const kept = new Map<string, Buffer>();
  for (const name of fs.readdirSync(dir)) {
    if (editable.has(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (st.isFile() && !st.isSymbolicLink() && st.size <= 6 * 1024 * 1024) kept.set(name, fs.readFileSync(file));
    } catch { /* gone meanwhile */ }
  }
  return () => {
    const restored: string[] = [];
    for (const [name, bytes] of kept) {
      const file = path.join(dir, name);
      let same = false;
      try { const st = fs.lstatSync(file); same = st.isFile() && !st.isSymbolicLink() && fs.readFileSync(file).equals(bytes); } catch { /* removed */ }
      if (same) continue;
      try { fs.rmSync(file, { force: true, recursive: true }); fs.writeFileSync(file, bytes); restored.push(name); } catch { /* reported by the export checks */ }
    }
    return restored;
  };
}

// ------------------------------------------------------------------------------------------------- the loop

export interface ReviewLoop {
  /** The job's design folder (the PNGs, the handoff files and the review records). */
  dir: string;
  /** The exported screens, in the design's order. */
  screens: readonly ReviewScreen[];
  /** The rubric (written to review-rubric.md). */
  rubric: string;
  /** The brand colour the brief names: every screen's primary accent must be it (enforced in parseReview). */
  brand?: BrandColour | null;
  /** One review call for a batch: answers its raw JSON (checked here). */
  review(o: { round: number; score: readonly ReviewScreen[]; reference: readonly ReviewScreen[] }): Promise<unknown>;
  /** One polish session: answers its raw JSON. */
  polish(o: { round: number; screens: readonly ScreenReview[]; others: readonly ReviewScreen[] }): Promise<unknown>;
  step(progress: number, message: string): Promise<void>;
  log(line: string): void;
  /** True for a stopped job: rethrown as it is. */
  stopped(error: unknown): boolean;
  /** True for an error worth no second try (out of AI capacity). */
  final?(error: unknown): boolean;
  bar?: number;
  maxPolishRounds?: number;
  now?: () => string;
}

export type ReviewOutcomeKind = "passed" | "belowBar" | "reviewUnavailable" | "finalCheckUnavailable" | "notReviewed";
export interface FinalScore {
  file: string; name: string; nodeId: string;
  scores: Record<CriterionId, number> | null;
  lowest: { id: CriterionId; score: number } | null;
  average: number | null;
  passed: boolean | null;
  /** The director would ship it in a top design-led product (part of passing). */
  ship: boolean | null;
  /** Counted limits or the brand check it broke. */
  breaches: string[];
  /** The review the scores come from. */
  round: number | null;
  /** Polished after those scores were given (the check after polishing could not be completed). */
  polishedSince: boolean;
  verdict: string;
  openFixes: ScreenFix[];
}
export interface ReviewState {
  version: 1;
  status: "running" | "done";
  outcome: ReviewOutcomeKind | null;
  bar: number;
  maxPolishRounds: number;
  reviews: { round: number; file: string; scored: string[]; below: string[] }[];
  polishes: { round: number; file: string; screens: string[]; changed: string[]; restored: string[]; note: string | null }[];
  final: FinalScore[];
  notes: string[];
}

/** Why a step stopped, in plain words for the design master (the job's log keeps the runner's own message). */
function plainReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof ReviewRejected) return `its answer could not be used: ${m}`;
  if (e instanceof JobFailure && e.code === "ai.capacity") return "the design runner was out of capacity";
  if (/timed out/i.test(m)) return "it ran out of time";
  return "the design runner stopped early";
}

/** The recorded review of a round, when it covers the screens to score. */
function recordedReview(file: string, score: readonly ReviewScreen[], bar: number, brand: BrandColour | null): ScreenReview[] | null {
  const r = readJson(file);
  if (!r || !Array.isArray(r.scored)) return null;
  try { return parseReview({ screens: r.scored }, score, { bar, brand }); } catch { return null; }
}

async function reviewRound(loop: ReviewLoop, round: number, score: readonly ReviewScreen[], bar: number): Promise<ScreenReview[]> {
  const others = loop.screens.filter((s) => !score.includes(s));
  const out: ScreenReview[] = [];
  for (const batch of reviewBatches(score, others)) {
    let failure: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        out.push(...parseReview(await loop.review({ round, score: batch.score, reference: batch.reference }), batch.score, { bar, brand: loop.brand ?? null }));
        failure = null;
        break;
      } catch (e) {
        if (loop.stopped(e)) throw e;
        failure = e;
        loop.log(`design review ${round}: attempt ${attempt} not usable (${(e instanceof Error ? e.message : String(e)).slice(0, 300)})`);
        if (loop.final?.(e)) break;
      }
    }
    if (failure) throw failure;
  }
  return out;
}

interface PolishRecord { round: number; at: string; screens: string[]; changed: string[]; restored: string[]; note: string | null; answer: PolishAnswer | null }

async function polishRound(loop: ReviewLoop, round: number, failing: readonly ScreenReview[], now: () => string): Promise<PolishRecord> {
  const files = failing.map((r) => r.file);
  // the PNGs as they were before this round (an interrupted round keeps its first copies: the true "before")
  const before = path.join(loop.dir, `polish-${round}-before`);
  fs.mkdirSync(before, { recursive: true });
  for (const f of files) if (!fs.existsSync(path.join(before, f)) && pngInfo(path.join(loop.dir, f))) fs.copyFileSync(path.join(loop.dir, f), path.join(before, f));
  const hashes = new Map(files.map((f) => [f, hashOf(path.join(before, f))]));
  const restore = guardFiles(loop.dir, new Set([...files, "design-master.md", "design-tokens.json", "provider-error.log"]));
  let answer: PolishAnswer | null = null;
  let note: string | null = null;
  try {
    answer = parsePolish(await loop.polish({ round, screens: failing, others: loop.screens.filter((s) => !files.includes(s.file)) }));
  } catch (e) {
    if (loop.stopped(e)) { restore(); throw e; }
    loop.log(`design polish ${round}: stopped (${(e instanceof Error ? e.message : String(e)).slice(0, 300)})`);
    note = `Polishing round ${round} stopped before it finished (${plainReason(e)}); the screens it had exported by then are kept.`;
  }
  const restored = restore();
  if (restored.length) loop.log(`design polish ${round}: put back ${restored.join(", ")}`);
  // every polished PNG must still pass the export checks; a broken one goes back to its drawing
  const changed: string[] = [];
  const reverted: string[] = [];
  for (const f of files) {
    const file = path.join(loop.dir, f);
    if (!pngInfo(file)) {
      if (pngInfo(path.join(before, f))) { fs.rmSync(file, { force: true, recursive: true }); fs.copyFileSync(path.join(before, f), file); reverted.push(f); }
      continue;
    }
    if (hashOf(file) !== hashes.get(f)) changed.push(f);
  }
  if (reverted.length) loop.log(`design polish ${round}: ${reverted.length} export(s) were not valid PNGs and went back to the previous export`);
  if (answer?.error && FIGMA_FAILED.test(answer.error)) {
    loop.log(`design polish ${round}: Figma failed (${answer.error.slice(0, 300)})`);
    throw new JobFailure(POLISH_FIGMA_FAILURE, "design.figmaPolishFailed");
  }
  if (answer?.error) note = `Polishing round ${round} reported: ${answer.error.replace(/\s+/g, " ").slice(0, 300)}`;
  return { round, at: now(), screens: files, changed, restored: [...restored, ...reverted], note, answer };
}

/** Reviews every screen, polishes those below the bar and checks them again (see the top of this file). Answers the
 *  recorded state (design-review.json); a finished state is answered as it is, without any new call. */
export async function runDesignReview(loop: ReviewLoop): Promise<ReviewState> {
  const bar = loop.bar ?? REVIEW_BAR;
  const max = loop.maxPolishRounds ?? MAX_POLISH_ROUNDS;
  const now = loop.now ?? (() => new Date().toISOString());
  const stateFile = path.join(loop.dir, REVIEW_STATE_FILE);
  const recorded = readJson(stateFile) as ReviewState | null;
  if (recorded?.version === 1 && recorded.status === "done") return recorded;
  const state: ReviewState = { version: 1, status: "running", outcome: null, bar, maxPolishRounds: max, reviews: [], polishes: [], final: [], notes: [] };
  const save = () => writeJson(stateFile, state);
  save();
  fs.writeFileSync(path.join(loop.dir, REVIEW_RUBRIC_FILE), loop.rubric);

  const latest = new Map<string, { review: ScreenReview; round: number }>();
  const polishedSince = new Set<string>();
  let toScore: ReviewScreen[] = [...loop.screens];
  let outcome: ReviewOutcomeKind = "passed";
  for (let round = 1; ; round++) {
    if (toScore.length) {
      const file = `review-${round}.json`;
      let scored = recordedReview(path.join(loop.dir, file), toScore, bar, loop.brand ?? null);
      if (!scored) {
        await loop.step(REVIEW_PROGRESS[Math.min(round, REVIEW_PROGRESS.length) - 1],
          round === 1 ? REVIEW_STEPS.reviewing : round > max ? REVIEW_STEPS.final : REVIEW_STEPS.checking(toScore.length));
        try { scored = await reviewRound(loop, round, toScore, bar); }
        catch (e) {
          if (loop.stopped(e)) throw e;
          const why = plainReason(e);
          state.notes.push(round === 1
            ? `The review could not be completed (${why}), so the screens are shown as first drawn, without scores.`
            : `The check after polishing round ${round - 1} could not be completed (${why}); the scores of the screens polished in that round are from before it.`);
          outcome = round === 1 ? "reviewUnavailable" : "finalCheckUnavailable";
          break;
        }
        const below = scored.filter((r) => belowBar(r, bar)).map((r) => r.file);
        writeJson(path.join(loop.dir, file), { round, at: now(), bar, scored, reference: loop.screens.filter((s) => !toScore.includes(s)).map((s) => s.file), below });
      }
      for (const r of scored) { latest.set(r.file, { review: r, round }); polishedSince.delete(r.file); }
      state.reviews.push({ round, file, scored: scored.map((r) => r.file), below: scored.filter((r) => belowBar(r, bar)).map((r) => r.file) });
      save();
    }
    const failing = loop.screens.map((s) => latest.get(s.file)?.review).filter((r): r is ScreenReview => !!r && belowBar(r, bar));
    if (!failing.length) { outcome = "passed"; break; }
    if (round > max) { outcome = "belowBar"; break; }
    const file = `polish-${round}.json`;
    let record = readJson(path.join(loop.dir, file)) as PolishRecord | null;
    if (!record || record.round !== round || !Array.isArray(record.changed)) {
      await loop.step(POLISH_PROGRESS[Math.min(round, POLISH_PROGRESS.length) - 1], REVIEW_STEPS.polishing(failing.length));
      record = await polishRound(loop, round, failing, now);
      writeJson(path.join(loop.dir, file), record);
    }
    for (const f of record.changed) polishedSince.add(f);
    state.polishes.push({ round, file, screens: record.screens, changed: record.changed, restored: record.restored ?? [], note: record.note ?? null });
    if (record.note) state.notes.push(record.note);
    save();
    // only what the round changed is checked again; an unchanged screen keeps its scores (and may be polished again)
    toScore = loop.screens.filter((s) => record!.changed.includes(s.file));
  }
  state.final = loop.screens.map((s): FinalScore => {
    const hit = latest.get(s.file);
    if (!hit) return { file: s.file, name: s.name, nodeId: s.nodeId, scores: null, lowest: null, average: null, passed: null, ship: null, breaches: [], round: null, polishedSince: false, verdict: "", openFixes: [] };
    const values = REVIEW_CRITERIA.map((c) => hit.review.scores[c.id]);
    const passed = !belowBar(hit.review, bar);
    return { file: s.file, name: s.name, nodeId: s.nodeId, scores: hit.review.scores, lowest: lowestOf(hit.review), average: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
      passed, ship: hit.review.ship, breaches: hit.review.breaches ?? [], round: hit.round, polishedSince: polishedSince.has(s.file), verdict: hit.review.verdict, openFixes: passed ? [] : hit.review.fixes };
  });
  state.outcome = outcome;
  state.status = "done";
  save();
  loop.log(`design review: ${outcome}; ${state.final.filter((f) => f.passed).length} of ${state.final.length} screen(s) at the bar after ${state.polishes.length} polish round(s)`);
  return state;
}

/** The state recorded for a design whose runner has no review (another runner than Claude). */
export function notReviewedState(screens: readonly ReviewScreen[], why: string): ReviewState {
  return { version: 1, status: "done", outcome: "notReviewed", bar: REVIEW_BAR, maxPolishRounds: MAX_POLISH_ROUNDS, reviews: [], polishes: [],
    final: screens.map((s) => ({ file: s.file, name: s.name, nodeId: s.nodeId, scores: null, lowest: null, average: null, passed: null, ship: null, breaches: [], round: null, polishedSince: false, verdict: "", openFixes: [] })),
    notes: [why] };
}

// ------------------------------------------------------------------------------------------------- the design master

/** The "Design review" section of design-master.md: how the screens were reviewed, the final scores per screen, and
 *  every screen still below the bar with its open fixes. */
export function reviewSection(state: ReviewState, o: { styleName?: string | null } = {}): string {
  const bar = state.bar;
  const out: string[] = [SECTION_START, "## Design review", ""];
  if (state.outcome === "notReviewed") {
    out.push(...state.notes, "", SECTION_END);
    return out.join("\n");
  }
  out.push(`Before this design was shown, every screen was reviewed against the design brief, the house principles${o.styleName ? `, the ${o.styleName} style direction` : ""} and the screen recipes' common mistakes (${REVIEW_RUBRIC_FILE}), on ${REVIEW_CRITERIA.length} criteria scored 1 to 10 against a strict, calibrated scale. A screen passes when every criterion reaches ${bar} and the director would ship it in a top design-led product; screens that did not were polished in Figma (removals first) and checked again, at most ${state.maxPolishRounds} times.`, "");
  const scored = state.final.filter((f) => f.scores);
  const passed = scored.filter((f) => f.passed).length;
  const rounds = state.polishes.length;
  if (state.outcome === "reviewUnavailable") out.push("Result: not reviewed.");
  else if (state.outcome === "passed") out.push(`Result: all ${scored.length} screens are at the bar${rounds ? ` after ${rounds} polish round${rounds === 1 ? "" : "s"}` : " as first drawn"}.`);
  else out.push(`Result: ${passed} of ${state.final.length} screens are at the bar after ${rounds} polish round${rounds === 1 ? "" : "s"}; ${state.final.length - passed} ${state.final.length - passed === 1 ? "is" : "are"} still below it (listed below).`);
  for (const r of state.reviews) {
    const p = state.polishes.find((x) => x.round === r.round);
    out.push(`- Review ${r.round}: ${r.scored.length} screen${r.scored.length === 1 ? "" : "s"} scored, ${r.below.length} below the bar.`);
    if (p) out.push(`- Polishing round ${p.round}: ${p.screens.length} screen${p.screens.length === 1 ? "" : "s"} polished, ${p.changed.length} export${p.changed.length === 1 ? "" : "s"} changed.`);
  }
  for (const n of state.notes) out.push(`- ${n}`);
  if (scored.length) {
    out.push("", `| Screen | ${REVIEW_CRITERIA.map((c) => c.label).join(" | ")} | Ships | Lowest |`, `|---|${REVIEW_CRITERIA.map(() => "---").join("|")}|---|---|`);
    for (const f of state.final) {
      if (!f.scores) { out.push(`| ${f.name} | ${REVIEW_CRITERIA.map(() => "-").join(" | ")} | - | not scored |`); continue; }
      out.push(`| ${f.name}${f.polishedSince ? " (polished after scoring)" : ""} | ${REVIEW_CRITERIA.map((c) => String(f.scores![c.id] ?? "-")).join(" | ")} | ${f.ship === false ? "no" : f.ship ? "yes" : "-"} | ${f.lowest!.score}${f.passed ? "" : " (below)"} |`);
    }
  }
  const open = state.final.filter((f) => f.passed === false);
  if (open.length) {
    out.push("", "### Still below the bar", "");
    for (const f of open) {
      const low = f.lowest ? (REVIEW_CRITERIA.find((c) => c.id === f.lowest!.id)?.name ?? f.lowest.id).toLowerCase() : "";
      out.push(`- **${f.name}** (${f.file}, frame ${f.nodeId}; lowest: ${low} ${f.lowest?.score ?? ""}${f.ship === false ? "; would not ship" : ""}): ${f.verdict || "below the bar"}`);
      for (const b of f.breaches ?? []) out.push(`  - Limit: ${b}`);
      for (const x of f.openFixes.slice(0, 6)) out.push(`  - ${REVIEW_CRITERIA.find((c) => c.id === x.criterion)?.label ?? x.criterion}${x.kind ? ` (${x.kind})` : ""}, ${x.where}: ${x.what} ${x.how}`);
    }
  }
  out.push("", `Every review is kept next to this file (${state.reviews.map((r) => r.file).join(", ") || "none"}; the final scores in ${REVIEW_STATE_FILE}).`, SECTION_END);
  return out.join("\n");
}

/** design-master.md with its review section written (replaced when the job wrote it before). */
export function writeReviewSection(dir: string, section: string): void {
  const file = path.join(dir, "design-master.md");
  let master = "";
  try { master = fs.readFileSync(file, "utf8"); } catch { return; }
  const start = master.indexOf(SECTION_START), end = master.indexOf(SECTION_END);
  const body = start >= 0 && end > start ? `${master.slice(0, start).trimEnd()}\n\n${section}${master.slice(end + SECTION_END.length)}` : `${master.trimEnd()}\n\n${section}\n`;
  fs.writeFileSync(file, body);
}

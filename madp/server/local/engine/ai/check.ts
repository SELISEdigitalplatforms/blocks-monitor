// Checks for Claude's answers: plain strings within the record limits, lists, choices, and none of the words that
// would make the work look staged. Pure.

/** Words the visible text never uses. */
export const STAGED = /\b(demo|demos|mock|mocked|mockup|sample|samples|prototype|prototypes|dummy|placeholder|lorem|ipsum|simulated|simulation|fake|test data|test version|test account|example data)\b/i;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function obj(v: unknown): Record<string, unknown> | null {
  return isObj(v) ? v : null;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Note, document and answer tags of a prompt ("[N1]", "[D3]", "[A2]") that slipped into visible text (feature tags
 *  are named by the scope planners, see kinds/scope/ai.ts untag). */
const TAGS = /\s*\[(?:N|D|A)\d+\]/g;

/** A trimmed one-paragraph string of at least `min` characters, cut at `max` on a word; null when unusable. */
export function text(v: unknown, max: number, min = 2): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(TAGS, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
  if (t.length < min || STAGED.test(t)) return null;
  return cut(t, max);
}

/** Like text, but keeps the line breaks (Markdown bodies). */
export function markdown(v: unknown, max: number, min = 2): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(TAGS, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length < min || STAGED.test(t)) return null;
  return cut(t, max);
}

function cut(t: string, max: number): string {
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const at = head.lastIndexOf(" ");
  return `${(at > max * 0.6 ? head.slice(0, at) : head).replace(/[,;:\s]+$/, "")}…`;
}

/** The usable strings of a list (at most `items`, each at most `max` characters, repeats left out). */
export function texts(v: unknown, items: number, max: number, min = 2): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const t = text(x, max, min);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= items) break;
  }
  return out;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function number(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/** JSON-schema pieces. */
export const S = {
  str: (description?: string) => ({ type: "string", ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: "number", ...(description ? { description } : {}) }),
  enum: (values: readonly string[], description?: string) => ({ type: "string", enum: [...values], ...(description ? { description } : {}) }),
  list: (items: object, maxItems?: number, description?: string) => ({ type: "array", items, ...(maxItems ? { maxItems } : {}), ...(description ? { description } : {}) }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false }),
};

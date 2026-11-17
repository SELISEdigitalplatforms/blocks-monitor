// Small text helpers the engine's writers share: deterministic choice, slugs, sentences, lists and the bullet lines of
// the business notes. No I/O.
import { hashOf, rand, type Rand } from "../../../seed/core/rng.ts";

export { hashOf, rand, type Rand };

/** A lowercase key: letters, digits and dashes, starting with a letter or digit (Requirement.Key, Feature.Key, slugs). */
export function slugOf(text: string, max = 40): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "item";
}

/** A slug that is not in `taken` (adds -2, -3, …); the result is added to `taken`. */
export function uniqueSlug(text: string, taken: Set<string>, max = 40): string {
  const base = slugOf(text, max - 3);
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base}-${i}`;
  taken.add(s);
  return s;
}

export const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const lower = (s: string): string => (s && !/^[A-Z]{2,}/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Ends the text with one full stop (keeps ? and !). */
export function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  return /[.!?]$/.test(t) ? cap(t) : `${cap(t)}.`;
}

/** Ends the text with one question mark. */
export function question(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/[.!:;,]+$/, "");
  return t.endsWith("?") ? cap(t) : `${cap(t)}?`;
}

/** "a, b and c". */
export function listOf(items: readonly string[], word = "and"): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} ${word} ${xs[xs.length - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Cuts at a word boundary and adds an ellipsis when the text is longer than max. */
export function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

/** Plain text of a markdown body: no headings marks, emphasis or links. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bullet and paragraph lines of a markdown note, without list marks; headings are dropped. */
export function linesOf(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) continue;
    const text = plain(line.replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, ""));
    if (text.length >= 8) out.push(text);
  }
  return out;
}

/** Splits a brief into its statements (sentences and "; " parts). */
export function statementsOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((s) => s.trim().replace(/[.;]+$/, ""))
    .filter((s) => s.length >= 12);
}

/** Lower-case word set (letters only, 3+ chars) for overlap scores. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"));
  }
  return out;
}

/** How many words two texts share. */
export function overlap(a: string | Set<string>, b: string | Set<string>): number {
  const A = typeof a === "string" ? wordsOf(a) : a;
  const B = typeof b === "string" ? wordsOf(b) : b;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n;
}

const STOP = new Set(
  "the and for with that this from into onto they them their there then than when what which who whom whose will would should could can cannot must may might shall have has had not but are was were been being our ours your yours its it's per via also only just more most less very each every any all some such own one two three out off over under about after before again once here why how where while until upon same other others".split(
    " ",
  ),
);

/** Picks n distinct items, deterministic for the Rand. */
export function pickSome<T>(r: Rand, list: readonly T[], n: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(r.next() * pool.length), 1)[0]!);
  return out;
}

/** A stable choice for a key (same key, same item) without a Rand. */
export function choose<T>(key: string, list: readonly T[]): T {
  return list[hashOf(key) % list.length]!;
}

/** The first name of a display name. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

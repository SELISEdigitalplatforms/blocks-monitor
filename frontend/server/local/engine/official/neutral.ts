// Neutral text in a product's repository. Two things the Factory hands the official lanes end up there: the lane's
// task (its agents write the code, the comments and the texts from it) and the commit's subject and body (`--title`,
// `--summary`). Neither may carry what is internal to the people who order the work: internal codenames (the name of
// a product being matched, for example), people's names and e-mail addresses, planning notes ("Why: ... parity",
// priorities), the wording of the task itself, or tool and AI trailers.
//
// The terms are the engine host's private terms (MF_PRIVATE_TERMS_FILE, one per line, "#" for comments: the same file
// the engine's privacy guard reads, server/blocks/engineWorker/privacy.ts) and the built-in codenames below, matched
// case-insensitively as whole words. In a lane's task a built-in codename becomes a neutral stand-in, so the agents
// still understand the work, and a private term is left out together with the words that only point at it; a planning
// note is left out. In a commit, a sentence that names any of them is left out, and a title loses the words.
// Pure, apart from reading the terms file.
import fs from "node:fs";

/** Internal codenames that never reach a product's code, texts or history. */
export const CODENAMES: readonly string[] = ["AGIS"];

/** What a built-in codename becomes in a lane's task (the wording the product itself uses for it). */
export const STAND_IN = "the previous software";

/** The rule every lane's agents get with the task (build.ts describeWork, "Ground rules"). */
export const NEUTRAL_RULE =
  "No internal codenames, people's names or e-mail addresses, and no text of this task (its notes, references or wording) in code comments, strings, file names or commit messages: they describe what the product does.";

export interface Terms {
  /** The built-in codenames: a neutral stand-in in a lane's task. */
  codenames: readonly string[];
  /** The engine host's private terms (people's names, e-mail addresses, logins, other codenames): left out. */
  private: readonly string[];
}

let cache: { file: string; stamp: string; terms: string[] } | null = null;

/** The host's private terms file, read the way the privacy guard reads it (lines of at least 3 characters, "#" lines
 *  skipped), again when the file changes; none when there is no file or it cannot be read. */
function fileTerms(env: NodeJS.ProcessEnv): string[] {
  const file = String(env.MF_PRIVATE_TERMS_FILE ?? "").trim();
  if (!file) return [];
  let stamp: string;
  try {
    const st = fs.statSync(file);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return [];
  }
  if (cache && cache.file === file && cache.stamp === stamp) return cache.terms;
  let terms: string[] = [];
  try {
    terms = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 3 && !l.startsWith("#"));
  } catch {
    terms = [];
  }
  cache = { file, stamp, terms };
  return terms;
}

/** The built-in codenames and the host's private terms (each term once, compared case-insensitively). */
export function privateTerms(env: NodeJS.ProcessEnv = process.env): Terms {
  const seen = new Set(CODENAMES.map((t) => t.toLowerCase()));
  const own: string[] = [];
  for (const t of fileTerms(env)) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    own.push(t);
  }
  return { codenames: [...CODENAMES], private: own };
}

// ------------------------------------------------------------------ patterns

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** A word or term matched in any letter case (built by hand: with the "i" flag, \p{Ll} below would match capitals). */
function anyCase(s: string): string {
  let out = "";
  for (const c of s) {
    if (/\s/.test(c)) {
      if (!out.endsWith("\\s+")) out += "\\s+";
      continue;
    }
    const l = c.toLowerCase();
    const u = c.toUpperCase();
    out += l !== u && l.length === 1 && u.length === 1 ? `[${l}${u}]` : esc(c);
  }
  return out;
}

/** A term as a whole word: no letter or digit before it (or a camel-case start: "loadAGIS"), no lower-case letter or
 *  digit after it ("AGISExport" is the term, "Magistrat" and "MAGISTRAT" are not). */
const whole = (alt: string): string => `(?:(?<![\\p{L}\\p{N}_])|(?<=\\p{Ll})(?=\\p{Lu}))(?:${alt})(?![\\p{Ll}\\p{N}_])`;

const alternation = (terms: readonly string[]): string =>
  [...terms]
    .filter((t) => t.trim())
    .sort((a, b) => b.length - a.length)
    .map(anyCase)
    .join("|");

const words = (ws: string[]): string => ws.map(anyCase).join("|");
// the words that only point at a term ("as in AGIS", "parity with AGIS", "the AGIS")
const POINTER = `(?:(?:${words(["just", "exactly"])})\\s+)?(?:${words(["as in", "as on", "as with", "like", "as", "from", "in", "of", "with", "than", "vs.", "vs", "versus", "per", "to", "into", "for", "on", "at", "via", "see", "cf.", "compare", "parity with", "feature parity with"])})`;
const POSSESSIVE = "(?:['’]s|['’](?![\\p{L}]))?";
const PARITY_AFTER = `(?:\\s+(?:${words(["feature parity", "parity"])})(?![\\p{L}]))?`;

interface TermPatterns {
  /** Any term (a test). */
  any: RegExp;
  /** A parenthesis that names a term: left out as a whole. */
  paren: RegExp;
  /** A term with the words that only point at it: left out. */
  pointed: RegExp;
  /** A built-in codename (with "the" before it and "parity" after it): the stand-in. */
  codename: RegExp | null;
  /** A built-in codename alone (in code). */
  codeword: RegExp | null;
  /** Any term alone. */
  bare: RegExp;
  /** A private term that starts a sentence ("Anna wants ...", "Anna: keep ..."). */
  lead: RegExp | null;
}

const memo = new Map<string, TermPatterns | null>();

function patternsOf(t: Terms): TermPatterns | null {
  const key = `${t.codenames.join("\u0000")}\u0001${t.private.join("\u0000")}`;
  if (memo.has(key)) return memo.get(key)!;
  const all = alternation([...t.codenames, ...t.private]);
  let p: TermPatterns | null = null;
  if (all) {
    const term = whole(all);
    const code = alternation(t.codenames);
    const own = alternation(t.private);
    p = {
      any: new RegExp(term, "u"),
      paren: new RegExp(`\\s*[(\\[][^()\\[\\]]*?${term}[^()\\[\\]]*?[)\\]]`, "gu"),
      pointed: new RegExp(`(?:(?<![\\p{L}])${POINTER}\\s+(?:${anyCase("the")}\\s+)?)?${term}${POSSESSIVE}${PARITY_AFTER}`, "gu"),
      codename: code ? new RegExp(`(?:(?<![\\p{L}])${anyCase("the")}\\s+)?${whole(code)}(['’]s)?${PARITY_AFTER}`, "gu") : null,
      codeword: code ? new RegExp(whole(code), "gu") : null,
      bare: new RegExp(term, "gu"),
      lead: own ? new RegExp(`(^\\s*(?:[-*+]\\s+|\\d+\\.\\s+|>\\s*)?|[.!?]\\s+)${whole(own)}(['’]s)?(\\s*:\\s*|\\s+(?=\\p{L}))`, "gu") : null,
    };
  }
  if (memo.size > 50) memo.clear();
  memo.set(key, p);
  return p;
}

/** True when the text names a codename or a private term. */
export function namesTerm(text: string, t: Terms): boolean {
  const p = patternsOf(t);
  return !!p && p.any.test(text);
}

/** One line put back together after words were taken out of it: no double spaces, no space before punctuation, no
 *  empty brackets, no punctuation left at its start (a list marker or heading stays) or doubled. */
function tidyLine(line: string): string {
  const m = /^(\s*(?:[-*+]\s+|#{1,6}\s+|>\s*|\d+\.\s+)?)(.*)$/.exec(line)!;
  const body = m[2]!
    .replace(/[(\[]\s*[)\]]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;]+(?=\s*[.!?]|\s*$)/g, "")
    .replace(/:(?=\s*[.!?,;])/g, "")
    .replace(/^[\s,;:.\-–]+/, "")
    .trim();
  return body ? `${m[1]}${body}` : "";
}

/** The text without any term: a parenthesis naming one is left out, and so is a term with the words that only point
 *  at it ("as in", "parity with", "the"). */
export function withoutTerms(text: string, t: Terms): string {
  const p = patternsOf(t);
  if (!p || !p.any.test(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!p.any.test(line)) return line;
      const out = tidyLine(line.replace(p.paren, "").replace(p.pointed, ""));
      return out || null;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}

// ------------------------------------------------------------------ planning notes

// "Why: AGIS parity, priority Must", "Priority: Should", "Requested by: ...": the label of a planning note
const NOTE_LABEL = /^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\*\*|__)?(?:why|reason|rationale|priority|prio|moscow|source|origin|parity|requested by|asked by|reported by|raised by|reporter)(?:\*\*|__)?\s*[:–-]/i;
// a MoSCoW priority ("priority Must", "Must-have"): capitals, so "the priority must be shown" is product text
const MOSCOW = /\b[Pp]riority\s*[:=]?\s*(?:Must|Should|Could|Won['’]?t)\b|\bMoSCoW\b|\b(?:Must|Should|Could)[- ]have\b/;
const PARITY = /\bparity\b/i;

/** A sentence that is a planning note of the people who ordered the work, not a part of the product: a labelled note
 *  about parity, priority or a term ("Why: AGIS parity, priority Must"), or a MoSCoW priority. */
export function isPlanningNote(sentence: string, t: Terms): boolean {
  if (MOSCOW.test(sentence)) return true;
  return NOTE_LABEL.test(sentence) && (PARITY.test(sentence) || /\bpriorit/i.test(sentence) || namesTerm(sentence, t));
}

/** A line's sentences (split after ". ", "! ", "? "). */
const sentencesOf = (line: string): string[] => line.split(/(?<=[.!?])\s+(?=\S)/);

// ------------------------------------------------------------------ the lane's task

/** `word` in the letter case of `like` ("AGIS" -> "LEGACY", "Agis" -> "Legacy", "agis" -> "legacy"). */
const caseLike = (word: string, like: string): string =>
  like === like.toUpperCase() && like !== like.toLowerCase() ? word.toUpperCase() : /^\p{Lu}/u.test(like) ? word[0]!.toUpperCase() + word.slice(1) : word;

// a line's list marker, heading or quote
const MARKER = /^(\s*(?:[-*+]\s+|#{1,6}\s+|>\s*|\d+\.\s+)?)/;

/** A lane's task as its agents may read it (pure). Markdown structure (headings, lists, paragraphs) stays.
 *  - a planning note is left out ("Why: AGIS parity, priority Must");
 *  - a line or a parenthesis that only points at a term is left out ("- AGIS parity", "(as in AGIS)");
 *  - a built-in codename becomes the neutral stand-in ("as in the previous software"), in code "legacy";
 *  - a private term is left out with the words that only point at it; one that starts a sentence becomes "The team". */
export function scrubTask(text: string, t: Terms): string {
  const p = patternsOf(t);
  const lines: string[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    let line = raw;
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
    } else if (fenced) {
      if (p && p.any.test(line)) {
        if (p.codeword) line = line.replace(p.codeword, (m) => caseLike("legacy", m));
        line = line.replace(p.bare, "");
      }
    } else if (line.trim()) {
      const marker = MARKER.exec(line)![1]!;
      const all = sentencesOf(line.slice(marker.length));
      const kept = all.filter((s, i) => !isPlanningNote(i === 0 ? `${marker}${s}` : s, t));
      if (!kept.length) continue;
      if (kept.length < all.length) line = `${marker}${kept.join(" ")}`;
      if (p && p.any.test(line)) {
        if (!/#/.test(marker) && !/[\p{L}\p{N}]/u.test(line.slice(marker.length).replace(p.pointed, ""))) continue;
        line = line.replace(/\s*[(\[]([^()\[\]]*)[)\]]/g, (m, inner: string) => (p.any.test(inner) && !/[\p{L}\p{N}]/u.test(inner.replace(p.pointed, "")) ? "" : m));
        if (p.codename) {
          line = line.replace(p.codename, (m: string, poss: string | undefined, at: number, whole: string) => {
            const start = /(?:^|[.!?:]\s+)$/.test(whole.slice(0, at)) || MARKER.exec(whole)![1]!.length === at;
            const word = start || /^The\s/.test(m) ? STAND_IN[0]!.toUpperCase() + STAND_IN.slice(1) : STAND_IN;
            return `${word}${poss ? "'s" : ""}`;
          });
        }
        // a person who starts a sentence becomes "the team" ("Anna wants ..."), a "Name:" in front is left out
        if (p.lead) line = line.replace(p.lead, (_m, pre: string, poss: string | undefined, sep: string) => (sep.includes(":") ? pre : `${pre}The team${poss ? "'s" : ""} `));
        line = tidyLine(line.replace(p.paren, "").replace(p.pointed, ""));
        if (!line) continue;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ a commit's body

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const MENTION = /(?:^|\s)@[\w-]+/;
const PEOPLE = /\b(?:asked|requested|reported|raised|suggested|proposed|wanted|approved|decided|signed off)\s+by\b|\b(?:the\s+)?(?:owner|client|ceo|cto|management|manager|boss|team lead|product owner|po|pm)\s+(?:asked|wants|wanted|requested|said|says|wrote|decided|approved|needs)\b/i;
const TOOLS = /\b(?:MADP|Claude|Anthropic|Codex|ChatGPT|GPT(?:-?\d[\w.]*)?|OpenAI|Gemini|Copilot|LLMs?|prompts?|AI[- ]generated|quick lane|feature lane|change requests?|acceptance criteri\w*|co-authored-by)\b/i;
const REFS = /\b(?:CR|FX)-\d+\b/;
// words to the developer, not about the product ("You are ...", "Please ...", "Make sure ...")
const INSTRUCTION = /^(?:you\s+(?:are|must|should|need|have to|will be)\b|please\b|implement\b|make sure\b|ensure that\b|do not\b|don['’]t\b|never\b|always\b|read\b|follow\b|note\s*:|important\s*:|todo\b|task\s*:)/i;
const WHY_LABEL = /^(?:why|reason|because)\s*:\s*/i;

/** True when a sentence may go into a commit body: it names no term, person, tool, internal reference or planning note,
 *  and it is about the product, not an instruction to a developer. */
export function isProductSentence(sentence: string, t: Terms): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (namesTerm(s, t) || isPlanningNote(s, t) || PARITY.test(s) || /\bpriorit/i.test(s)) return false;
  if (EMAIL.test(s) || MENTION.test(s) || PEOPLE.test(s) || TOOLS.test(s) || REFS.test(s)) return false;
  return !INSTRUCTION.test(s);
}

/** A sentence for a commit body: a parenthesis that names a person, a term, a tool or a reference is left out, and so
 *  is a "Why:" label; null when what is left is not about the product. */
export function productSentence(sentence: string, t: Terms): string | null {
  let s = sentence.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (isProductSentence(inner, t) ? m : "")).trim();
  if (WHY_LABEL.test(s)) {
    s = s.replace(WHY_LABEL, "");
    s = s ? s[0]!.toUpperCase() + s.slice(1) : s;
  }
  s = s.replace(/\s+([.,;:!?])/g, "$1").trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  return isProductSentence(s, t) ? s : null;
}

/** A text of a change's record in the product repo (build.ts changeRecordOf, the engine's docs/changes/<id>.md):
 *  the task's own scrubbing (scrubTask: codenames become the stand-in, private terms and planning notes are left out),
 *  then every sentence that names a person ("asked by", "the owner wants") is left out, and e-mail addresses and
 *  @mentions go. Unlike a commit body it keeps the product's words for its own process ("acceptance criteria",
 *  change codes): the record IS the change's documentation (pure). */
export function recordText(text: string, t: Terms): string {
  const kept = scrubTask(text, t)
    .split("\n")
    .map((line) => {
      const marker = MARKER.exec(line)![1]!;
      const all = sentencesOf(line.slice(marker.length));
      const ok = all.filter((s) => !PEOPLE.test(s));
      return ok.length ? `${marker}${ok.join(" ")}` : "";
    })
    .join("\n");
  return kept
    .replace(new RegExp(EMAIL.source, "g"), "")
    .replace(/(^|\s)@[\w-]+(?:\.[\w-]+)*/g, "$1")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when a text is a brief or a prompt rather than a description of a change: several markdown headings, a code
 *  block, or longer than a description of a change would be. Such a text never becomes a commit body. */
export function isBrief(text: string): boolean {
  const headings = text.split("\n").filter((l) => /^\s*#{1,6}\s/.test(l)).length;
  return headings >= 2 || /^\s*```/m.test(text) || text.trim().length > 1500;
}

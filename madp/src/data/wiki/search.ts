// Pure, deterministic wiki search and answers (no network, no React).
import { WIKI_GROUPS, type WikiGroup, type WikiPage } from "@/data/wiki/types";
import { sectionsOf, type WikiSection } from "@/data/wiki/markdown";

const STOP = new Set(
  ("a an the is are was be do does did how what when where why who whom which can could should would will i me my we our you your it its of to in on at for from by with and or if this that there get gets").split(" "),
);

const SYNONYMS: Record<string, string[]> = {
  price: ["prices", "priced", "pricing", "pricelist", "pricelists"],
  vat: ["tax", "taxes", "mwst"],
  round: ["rounded", "rounding", "rounds", "rappen"],
  cutoff: ["cutoffs", "deadline", "deadlines"],
  repeat: ["repeats", "repeated", "repeating", "reorder", "reorders", "reordered", "reordering"],
  delivery: ["deliveries", "deliver", "delivers", "delivered", "delivering"],
  order: ["orders", "ordered", "ordering"],
  calculate: ["calculates", "calculated", "calculating", "calculation", "calculations", "compute", "computed"],
  check: ["checks", "checked", "checking"],
  pass: ["passes", "passed", "passing"],
  sign: ["signs", "signed", "signing", "signin", "login"],
  change: ["changes", "changed", "changing"],
  fix: ["fixes", "fixed", "fixing"],
  release: ["releases", "released", "releasing"],
  day: ["days"],
  customer: ["customers"],
};

const CANON = new Map<string, string>();
for (const [canon, words] of Object.entries(SYNONYMS)) for (const w of words) CANON.set(w, canon);

const TOKEN_RE = /\d+(?:[:.,]\d+)*|\p{L}+/gu;

export function tokenize(text: string): string[] {
  const s = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/(\p{L})-+(?=\p{L})/gu, "$1");
  const out: string[] = [];
  for (const raw of s.match(TOKEN_RE) ?? []) {
    if (STOP.has(raw)) continue;
    let t = CANON.get(raw) ?? raw;
    if (t === raw && /^\p{L}+$/u.test(t) && t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    out.push(t);
  }
  return out;
}

export interface WikiHit {
  slug: string;
  title: string;
  group: WikiGroup;
  sectionId: string;
  heading: string;
  snippet: string;
  score: number;
}

interface Scored {
  page: WikiPage;
  section: WikiSection;
  score: number;
  matched: Set<string>;
}

const groupIndex = (g: WikiGroup) => {
  const i = WIKI_GROUPS.findIndex((x) => x.id === g);
  return i < 0 ? WIKI_GROUPS.length : i;
};

function scoreAll(pages: WikiPage[], terms: string[]): Scored[] {
  const out: Scored[] = [];
  for (const page of pages) {
    const title = new Set(tokenize(page.title));
    for (const section of sectionsOf(page)) {
      const heading = new Set(tokenize(section.heading));
      const counts = new Map<string, number>();
      for (const t of tokenize(section.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
      let score = 0;
      const matched = new Set<string>();
      for (const term of terms) {
        let s = 0;
        if (title.has(term)) s += 4 + (section.id === "" ? 2 : 0);
        if (heading.has(term)) s += 4;
        s += Math.min(counts.get(term) ?? 0, 3);
        if (s > 0) {
          score += s;
          matched.add(term);
        }
      }
      if (matched.size === 0) continue;
      score += 3 * (matched.size - 1);
      out.push({ page, section, score, matched });
    }
  }
  return out;
}

const byRank = (a: Scored, b: Scored) =>
  b.score - a.score ||
  groupIndex(a.page.group) - groupIndex(b.page.group) ||
  a.page.order - b.page.order ||
  a.page.slug.localeCompare(b.page.slug) ||
  a.section.id.localeCompare(b.section.id);

const distinct = (xs: string[]) => Array.from(new Set(xs));

function snippetOf(text: string, query: string, heading: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return heading;
  const first = matchRanges(flat, query)[0];
  const SIZE = 160;
  if (!first) return flat.length > SIZE ? flat.slice(0, SIZE).trimEnd() + "…" : flat;
  if (flat.length <= SIZE) return flat;
  let start = Math.max(0, first[0] - 50);
  const end = Math.min(flat.length, start + SIZE);
  start = Math.max(0, end - SIZE);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

export function searchWiki(pages: WikiPage[], query: string, limit = 20): WikiHit[] {
  const terms = distinct(tokenize(query));
  if (terms.length === 0) return [];
  const best = new Map<string, Scored>();
  for (const s of scoreAll(pages, terms).sort(byRank)) if (!best.has(s.page.slug)) best.set(s.page.slug, s);
  return Array.from(best.values())
    .sort(byRank)
    .slice(0, Math.max(0, limit))
    .map((s) => ({
      slug: s.page.slug,
      title: s.page.title,
      group: s.page.group,
      sectionId: s.section.id,
      heading: s.section.heading,
      snippet: snippetOf(s.section.text, query, s.section.heading),
      score: s.score,
    }));
}

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:[:.,-][\p{L}\p{M}\p{N}]+)*/gu;

export function matchRanges(text: string, query: string): [number, number][] {
  const terms = new Set(tokenize(query).filter((t) => t.length >= 2));
  if (terms.size === 0) return [];
  const out: [number, number][] = [];
  for (const m of text.matchAll(WORD_RE)) {
    if (tokenize(m[0]).some((t) => terms.has(t))) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

export interface WikiCitation {
  n: number;
  slug: string;
  sectionId: string;
  pageTitle: string;
  heading: string;
}
export interface WikiAnswerParagraph {
  text: string;
  cites: number[];
}
export interface WikiAnswer {
  question: string;
  found: boolean;
  paragraphs: WikiAnswerParagraph[];
  citations: WikiCitation[];
}

function pickSentences(text: string, terms: string[]): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  const ranked = sentences.map((s, i) => {
    const toks = new Set(tokenize(s));
    return { s, i, n: terms.filter((t) => toks.has(t)).length };
  });
  const hits = ranked.filter((r) => r.n > 0);
  const pool = hits.length ? hits : ranked;
  return pool
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.s)
    .join(" ");
}

export function answerFromWiki(pages: WikiPage[], question: string, maxSections = 3): WikiAnswer {
  const q = question.trim();
  const empty: WikiAnswer = { question: q, found: false, paragraphs: [], citations: [] };
  const terms = distinct(tokenize(q));
  if (terms.length === 0) return empty;
  const scored = scoreAll(pages, terms).sort(byRank);
  if (scored.length === 0) return empty;
  const floor = 0.4 * scored[0].score;
  const perPage = new Map<string, number>();
  const paragraphs: WikiAnswerParagraph[] = [];
  const citations: WikiCitation[] = [];
  for (const s of scored) {
    if (paragraphs.length >= maxSections) break;
    if (s.score < floor) break;
    if ((perPage.get(s.page.slug) ?? 0) >= 2) continue;
    const text = pickSentences(s.section.text, terms);
    if (!text) continue;
    perPage.set(s.page.slug, (perPage.get(s.page.slug) ?? 0) + 1);
    const n = citations.length + 1;
    citations.push({ n, slug: s.page.slug, sectionId: s.section.id, pageTitle: s.page.title, heading: s.section.heading });
    paragraphs.push({ text, cites: [n] });
  }
  return { question: q, found: paragraphs.length > 0, paragraphs, citations };
}

const QUESTION_WORDS = new Set("how what why when where who which can does do is are should will".split(" "));

const QUESTION_VERBS = new Set(
  "is are was were do does did can could should will would happens happen works work changes change gets get calculates calculated".split(" "),
);

export function isQuestion(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  const words = t.split(/\s+/);
  if (!QUESTION_WORDS.has(words[0].toLowerCase())) return false;
  return words.length >= 3 || (words.length >= 2 && QUESTION_VERBS.has(words[1].toLowerCase()));
}

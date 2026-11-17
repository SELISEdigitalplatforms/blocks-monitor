import { slugify, type WikiGroup, type WikiPage } from "./types";

/** A parsed block of the wiki's markdown subset; text keeps its inline markdown. */
export type MdBlock =
  | { type: "heading"; level: 2 | 3; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "callout"; tone: "note" | "warning"; text: string };

/** An inline token. */
export type MdInline =
  | { type: "text" | "strong" | "em" | "code"; text: string }
  | { type: "link"; text: string; href: string };

/** One heading-delimited part of a page, as searched. */
export interface WikiSection {
  slug: string;
  pageTitle: string;
  group: WikiGroup;
  id: string;
  heading: string;
  text: string;
}

const FENCE = "```";
const HEADING = /^(#{1,6}) +(.*)$/;
const UL = /^[-*] +(.*)$/;
const OL = /^\d+[.)] +(.*)$/;
const SEPARATOR = /^[|\s:-]*-{3}[|\s:-]*$/;

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  if (line.startsWith(FENCE) || HEADING.test(line) || UL.test(line) || OL.test(line) || line.startsWith(">")) return true;
  return line.startsWith("|") && next !== undefined && next.includes("|") && SEPARATOR.test(next);
}

/** Parses the wiki's markdown subset into blocks; never throws. */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith(FENCE)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== FENCE) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const text = h[2].trim();
      const base = slugify(plainText(text));
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      blocks.push({ type: "heading", level: h[1].length <= 2 ? 2 : 3, text, id: n > 1 ? `${base}-${n}` : base });
      i++;
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      const re = ul ? UL : OL;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) {
          items.push(m[1].trim());
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered: !ul, items });
      continue;
    }
    if (line.startsWith("|") && lines[i + 1] !== undefined && lines[i + 1].includes("|") && SEPARATOR.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) {
        const r = cells(lines[i]).slice(0, head.length);
        while (r.length < head.length) r.push("");
        rows.push(r);
        i++;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) parts.push(lines[i++].replace(/^> ?/, ""));
      let text = parts.join(" ").trim();
      let tone: "note" | "warning" = "note";
      if (text.startsWith("Warning:")) {
        tone = "warning";
        text = text.slice(8).trim();
      } else if (text.startsWith("Note:")) text = text.slice(5).trim();
      blocks.push({ type: "callout", tone, text });
      continue;
    }
    const parts: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) parts.push(lines[i++].trim());
    blocks.push({ type: "paragraph", text: parts.join(" ") });
  }
  return blocks;
}

/** Splits inline markdown (code, strong, em, links) into tokens; unmatched markers stay text. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.type === "text") last.text += buf;
      else out.push({ type: "text", text: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    } else if (c === "*" || (c === "_" && !/[A-Za-z0-9]/.test(text[i - 1] ?? ""))) {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1 && !/\s/.test(text[i + 1]) && !/\s/.test(text[end - 1])) {
        flush();
        out.push({ type: "em", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (c === "[") {
      const close = text.indexOf("](", i + 1);
      const label = close > i ? text.slice(i + 1, close) : "";
      const end = close > i ? text.indexOf(")", close + 2) : -1;
      if (label && !/[[\]]/.test(label) && end > close + 2) {
        flush();
        out.push({ type: "link", text: label, href: text.slice(close + 2, end) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** The inline tokens' text joined. */
export function plainText(text: string): string {
  return parseInline(text).map((t) => t.text).join("");
}

/** Splits a page into an intro section plus one section per level-2/3 heading. */
export function sectionsOf(page: Pick<WikiPage, "slug" | "title" | "group" | "bodyMd">): WikiSection[] {
  const base = { slug: page.slug, pageTitle: page.title, group: page.group };
  const sections: WikiSection[] = [];
  let lines: string[] = [];
  let cur: WikiSection = { ...base, id: "", heading: page.title, text: "" };
  const close = () => {
    sections.push({ ...cur, text: lines.join("\n") });
    lines = [];
  };
  for (const b of parseMarkdown(page.bodyMd)) {
    if (b.type === "heading") {
      close();
      cur = { ...base, id: b.id, heading: plainText(b.text), text: "" };
    } else if (b.type === "paragraph" || b.type === "callout") lines.push(plainText(b.text));
    else if (b.type === "list") for (const it of b.items) lines.push(plainText(it));
    else if (b.type === "table")
      for (const r of [b.head, ...b.rows]) lines.push(r.map(plainText).join(" · "));
    else lines.push(b.text);
  }
  close();
  return sections;
}

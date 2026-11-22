// The text of a shared document, by its type: Markdown and plain text as they are, an e-mail's subject and body
// (quoted-printable, base64 and multipart bodies too, without the signature), a spreadsheet export's rows, and a PDF's
// text (its content streams, Flate-compressed or not, line by line; larger type becomes "## " headings). Images and
// office files give no text here: the agent files them by their name and type. No I/O.
import { inflateSync } from "node:zlib";

export type SourceType = "markdown" | "text" | "email" | "table" | "pdf" | "none";

export interface ReadText {
  type: SourceType;
  /** Markdown-like text: "## " headings, "- " items, paragraphs. */
  text: string;
  /** A spreadsheet export's rows (header first). */
  rows?: string[][];
  /** An e-mail's subject. */
  subject?: string;
}

const extOf = (name: string): string => (/\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1] ?? "").toLowerCase();
const utf8 = (b: Uint8Array): string => new TextDecoder("utf-8", { fatal: false }).decode(b).replace(/^﻿/, "");

export function readDocument(name: string, mime: string, bytes: Uint8Array | null): ReadText {
  if (!bytes || bytes.length === 0) return { type: "none", text: "" };
  const ext = extOf(name);
  const m = mime.toLowerCase();
  try {
    if (ext === "md" || ext === "markdown" || m === "text/markdown") return { type: "markdown", text: utf8(bytes) };
    if (ext === "eml" || m === "message/rfc822") return readEmail(utf8(bytes));
    if (ext === "csv" || ext === "tsv" || m === "text/csv") {
      const rows = parseCsv(utf8(bytes), ext === "tsv" ? "\t" : undefined);
      return { type: "table", text: rows.map((r) => r.join(" · ")).join("\n"), rows };
    }
    if (ext === "pdf" || m === "application/pdf") return { type: "pdf", text: pdfText(bytes) };
    if (ext === "txt" || ext === "text" || m.startsWith("text/plain")) return { type: "text", text: utf8(bytes) };
  } catch {
    return { type: "none", text: "" };
  }
  return { type: "none", text: "" };
}

// ------------------------------------------------------------------------------------------------- e-mail

function decodeQp(s: string): string {
  const bytes: number[] = [];
  const src = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "=" && /^[0-9A-F]{2}$/i.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of new TextEncoder().encode(c)) bytes.push(b);
    }
  }
  return utf8(Uint8Array.from(bytes));
}

function splitHead(raw: string): { headers: Record<string, string>; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const at = text.indexOf("\n\n");
  const head = at < 0 ? text : text.slice(0, at);
  const body = at < 0 ? "" : text.slice(at + 2);
  const headers: Record<string, string> = {};
  let last = "";
  for (const line of head.split("\n")) {
    if (/^\s/.test(line) && last) headers[last] += ` ${line.trim()}`;
    else {
      const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (m) {
        last = m[1]!.toLowerCase();
        headers[last] = m[2]!;
      }
    }
  }
  return { headers, body };
}

function partText(headers: Record<string, string>, body: string): string {
  const type = (headers["content-type"] ?? "text/plain").toLowerCase();
  const enc = (headers["content-transfer-encoding"] ?? "").toLowerCase().trim();
  const boundary = /boundary="?([^";]+)"?/i.exec(headers["content-type"] ?? "")?.[1];
  if (type.startsWith("multipart/") && boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
    const read = parts.map((p) => splitHead(p.replace(/^\n/, "")));
    const plain = read.find((p) => (p.headers["content-type"] ?? "text/plain").toLowerCase().startsWith("text/plain"));
    const any = plain ?? read.find((p) => (p.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/"));
    return any ? partText(any.headers, any.body) : "";
  }
  let text = enc === "quoted-printable" ? decodeQp(body) : enc === "base64" ? utf8(Uint8Array.from(Buffer.from(body.replace(/\s+/g, ""), "base64"))) : body;
  if (type.startsWith("text/html")) text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return text;
}

/** Lines that close an e-mail: from here on it is the signature or an earlier message. */
const SIGN_OFF = /^(kind regards|best regards|regards|best|many thanks|thanks|thank you|cheers|freundliche grüsse|mit freundlichen grüssen|liebe grüsse|merci|cordialement|--\s*)[,!.]?\s*$/i;
const QUOTED = /^(>|on .+ wrote:$|-{2,}\s*original message|from: )/i;

export function readEmail(raw: string): ReadText {
  const { headers, body } = splitHead(raw);
  const text = partText(headers, body).replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (SIGN_OFF.test(t) || QUOTED.test(t)) break;
    out.push(line);
  }
  // the greeting says nothing about the product
  while (out.length && (/^(hello|hi|dear|hallo|guten tag|grüezi|bonjour)\b.*[,!]?\s*$/i.test(out[0]!.trim()) || !out[0]!.trim())) out.shift();
  return { type: "email", text: out.join("\n").trim(), subject: (headers.subject ?? "").trim() };
}

// ------------------------------------------------------------------------------------------------- csv

export function parseCsv(text: string, sep?: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const d = sep ?? ([",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === d) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------------------------------------- pdf

/** WinAnsi bytes 0x80–0x9f that differ from Latin-1. */
const WIN_ANSI: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
};

function pdfLiteral(src: string, at: number): { text: string; end: number } {
  // src[at] === "("
  let depth = 1;
  let out = "";
  let i = at + 1;
  while (i < src.length && depth > 0) {
    const c = src[i]!;
    if (c === "\\") {
      const n = src[i + 1] ?? "";
      if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1))![0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
        continue;
      }
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (n === "\r" || n === "\n") { i += n === "\r" && src[i + 2] === "\n" ? 3 : 2; continue; }
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) break; }
    out += c;
    i++;
  }
  return { text: [...out].map((ch) => WIN_ANSI[ch.charCodeAt(0)] ?? ch).join(""), end: i + 1 };
}

interface PdfLine { text: string; size: number; x: number }

/** The text lines of one content stream: each BT…ET block's strings, with its font size and x position. */
function streamLines(content: string): PdfLine[] {
  const out: PdfLine[] = [];
  const blocks = content.split(/\bBT\b/).slice(1);
  let size = 10;
  for (const raw of blocks) {
    const block = raw.split(/\bET\b/)[0] ?? "";
    const tf = [...block.matchAll(/\/[A-Za-z0-9]+\s+([\d.]+)\s+Tf/g)].pop();
    if (tf) size = Number(tf[1]) || size;
    const td = /([\d.-]+)\s+([\d.-]+)\s+T[dm]\b/.exec(block) ?? /[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)\s+Tm/.exec(block);
    const x = td ? Number(td[1]) : 0;
    let text = "";
    for (let i = 0; i < block.length; i++) {
      if (block[i] === "(") {
        const lit = pdfLiteral(block, i);
        text += lit.text;
        i = lit.end - 1;
      }
    }
    if (text.trim()) out.push({ text: text.replace(/\s+/g, " ").trim(), size, x });
  }
  return out;
}

/** The text of a PDF as Markdown-like lines (empty when it has no readable text, e.g. a scan). */
export function pdfText(bytes: Uint8Array): string {
  const src = Buffer.from(bytes).toString("latin1");
  if (!src.startsWith("%PDF")) return "";
  const lines: PdfLine[] = [];
  const re = /<<((?:(?!>>)[\s\S])*?)>>\s*stream\r?\n/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const dict = m[1] ?? "";
    if (/\/(Subtype\s*\/Image|Type\s*\/XObject|Type\s*\/Metadata|Length1)/.test(dict)) continue;
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    let body = src.slice(start, end).replace(/\r?\n$/, "");
    if (/\/FlateDecode/.test(dict)) {
      try {
        body = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    if (!/\bBT\b/.test(body)) continue;
    lines.push(...streamLines(body));
    re.lastIndex = end;
  }
  if (lines.length === 0) return "";
  const body = [...lines].map((l) => l.size).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 10;
  const out: string[] = [];
  let prev: PdfLine | null = null;
  for (const l of lines) {
    const heading = l.size >= body + 1.5 && l.text.length < 90;
    const bullet = /^[•·▪●◦-]\s+/.test(l.text);
    const text = l.text.replace(/^[•·▪●◦]\s+/, "");
    // a wrapped line goes on with the line before it (same size, the line before ran to the wrap width)
    const goesOn = prev && !heading && !bullet && Math.abs(prev.size - l.size) < 0.2 && prev.text.length >= 55 && out.length > 0 && !/^#/.test(out[out.length - 1]!);
    if (goesOn) out[out.length - 1] += ` ${text}`;
    else if (heading) out.push("", `## ${text}`);
    else if (bullet) out.push(`- ${text}`);
    else out.push(text);
    prev = l;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

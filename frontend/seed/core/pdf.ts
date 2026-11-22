// A small, valid PDF 1.4 writer (Helvetica, WinAnsi) for the seeded documents: offers, order forms, audit checklists,
// meeting minutes. Text is wrapped and paged; a letterhead band carries the issuing company.

export interface PdfSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { head: string[]; rows: string[][]; widths?: number[] };
}

export interface PdfDoc {
  /** Company on the letterhead. */
  issuer: string;
  /** Letterhead colour, hex without '#'. */
  color?: string;
  title: string;
  subtitle?: string;
  meta?: [string, string][];
  sections: PdfSection[];
  footer?: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const BODY = 10;
const LEAD = 14;

// Unicode → WinAnsi for the characters outside Latin-1 that business texts use.
const WIN: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };

function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    let code = WIN[ch] ?? ch.charCodeAt(0);
    if (code > 255) code = 0x3f;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}

/** Approximate Helvetica advance widths (per 1000 em) for wrapping. */
function widthOf(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if ("il.,:;'!|".includes(ch)) w += 260;
    else if ("ftjrI() -".includes(ch)) w += 330;
    else if ("mwMW".includes(ch)) w += 830;
    else if (ch >= "A" && ch <= "Z") w += 680;
    else if (ch >= "0" && ch <= "9") w += 556;
    else w += 520;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

function wrap(s: string, size: number, max: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next, size, bold) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function rgb(hexColor: string): string {
  const v = hexColor.replace("#", "");
  return [0, 2, 4].map((i) => (parseInt(v.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
}

export function makePdf(doc: PdfDoc, issued: Date): Uint8Array {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const width = PAGE_W - 2 * MARGIN;

  const newPage = (): void => {
    ops = [];
    pages.push(ops);
    ops.push(`${rgb(doc.color ?? "334155")} rg 0 ${PAGE_H - 64} ${PAGE_W} 64 re f`);
    ops.push(`BT /F2 13 Tf 1 1 1 rg ${MARGIN} ${PAGE_H - 40} Td (${pdfText(doc.issuer)}) Tj ET`);
    y = PAGE_H - 64 - 36;
  };
  const need = (h: number): void => {
    if (y - h < MARGIN + 30) newPage();
  };
  const text = (s: string, x: number, size: number, bold = false, gray = 0.12): void => {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} ${gray} ${gray} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
  };

  newPage();
  for (const l of wrap(doc.title, 18, width, true)) {
    need(24);
    text(l, MARGIN, 18, true);
    y -= 24;
  }
  if (doc.subtitle) {
    for (const l of wrap(doc.subtitle, 11, width)) {
      need(16);
      text(l, MARGIN, 11, false, 0.35);
      y -= 16;
    }
  }
  y -= 6;
  for (const [k, v] of doc.meta ?? []) {
    need(LEAD);
    text(`${k}:`, MARGIN, BODY, true, 0.3);
    text(v, MARGIN + 110, BODY, false);
    y -= LEAD;
  }
  y -= 8;
  for (const sec of doc.sections) {
    if (sec.heading) {
      need(LEAD * 3);
      y -= 6;
      text(sec.heading, MARGIN, 12, true);
      y -= 18;
    }
    for (const p of sec.paragraphs ?? []) {
      for (const l of wrap(p, BODY, width)) {
        need(LEAD);
        text(l, MARGIN, BODY);
        y -= LEAD;
      }
      y -= 6;
    }
    for (const b of sec.bullets ?? []) {
      const lines = wrap(b, BODY, width - 14);
      lines.forEach((l, i) => {
        need(LEAD);
        if (i === 0) text("•", MARGIN, BODY);
        text(l, MARGIN + 14, BODY);
        y -= LEAD;
      });
    }
    if (sec.bullets?.length) y -= 6;
    if (sec.table) {
      const cols = sec.table.head.length;
      const widths = sec.table.widths ?? Array.from({ length: cols }, () => 1 / cols);
      const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? MARGIN) + w * width], [MARGIN]);
      need(LEAD * 2);
      ops.push(`0.93 0.94 0.95 rg ${MARGIN} ${(y - 4).toFixed(1)} ${width} ${LEAD + 2} re f`);
      sec.table.head.forEach((h, i) => text(h, xs[i]! + 4, 9, true, 0.3));
      y -= LEAD + 4;
      for (const row of sec.table.rows) {
        need(LEAD);
        row.forEach((cell, i) => {
          const max = (widths[i] ?? 0) * width - 8;
          let s = cell;
          while (s.length > 1 && widthOf(s, 9) > max) s = s.slice(0, -1);
          text(s === cell ? s : `${s.slice(0, -1)}…`, xs[i]! + 4, 9);
        });
        ops.push(`0.88 0.89 0.9 RG 0.5 w ${MARGIN} ${(y - 4).toFixed(1)} m ${MARGIN + width} ${(y - 4).toFixed(1)} l S`);
        y -= LEAD;
      }
      y -= 8;
    }
  }

  // footers with page numbers
  const stamp = issued.toISOString().slice(0, 10).split("-").reverse().join(".");
  pages.forEach((p, i) => {
    const foot = `${doc.footer ?? doc.issuer} · ${stamp} · Page ${i + 1} of ${pages.length}`;
    p.push(`BT /F1 8 Tf 0.45 0.45 0.45 rg ${MARGIN} 32 Td (${pdfText(foot)}) Tj ET`);
  });

  // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page + content pairs
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((p, i) => {
    const stream = p.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  const info = objects.length + 1;
  const ascii = (v: string) => pdfText(v.replace(/[–—]/g, "-").replace(/€/g, "EUR").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[•…]/g, "."));
  objects.push(`<< /Title (${ascii(doc.title)}) /Producer (${ascii(doc.issuer)}) >>`);

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

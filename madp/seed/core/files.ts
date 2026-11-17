// Real file bytes for the seeded documents: PDFs, e-mails (.eml), text notes, CSV sheets and PNG images.
import type { Clock, When } from "./clock";
import { render, type ImageSpec } from "./draw";
import { makePdf, type PdfDoc } from "./pdf";

export type Person = [name: string, email: string];

export type FileSpec =
  | ({ type: "pdf"; name: string; issued?: When } & PdfDoc)
  | { type: "eml"; name: string; from: Person; to: Person[]; cc?: Person[]; at: When; subject: string; body: string }
  | { type: "text"; name: string; mime: "text/plain" | "text/markdown" | "text/csv"; text: string }
  | { type: "png"; name: string; image: ImageSpec };

/** Attachment.Kind / DocFile.Kind values (src/domain/feedback.ts attachmentKind). */
export type FileKind = "email" | "notes" | "pdf" | "sheet" | "image";

export interface MadeFile {
  name: string;
  mime: string;
  ext: string;
  kind: FileKind;
  bytes: Uint8Array;
  width?: number;
  height?: number;
}

const enc = new TextEncoder();

function rfc2822(iso: string): string {
  const d = new Date(iso);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${day}, ${d.getUTCDate()} ${mon} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

const addr = ([name, email]: Person): string => `${name} <${email}>`;

function eml(spec: Extract<FileSpec, { type: "eml" }>, clock: Clock): Uint8Array {
  const at = clock.at(spec.at);
  const domain = spec.from[1].split("@")[1] ?? "mail.local";
  const id = `${Date.parse(at).toString(36)}.${spec.subject.length}${spec.body.length}@${domain}`;
  const head = [
    `From: ${addr(spec.from)}`,
    `To: ${spec.to.map(addr).join(", ")}`,
    ...(spec.cc?.length ? [`Cc: ${spec.cc.map(addr).join(", ")}`] : []),
    `Date: ${rfc2822(at)}`,
    `Subject: ${spec.subject}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return enc.encode(`${head.join("\r\n")}\r\n\r\n${spec.body.replace(/\r?\n/g, "\r\n")}\r\n`);
}

export function makeFile(spec: FileSpec, clock: Clock): MadeFile {
  switch (spec.type) {
    case "pdf":
      return {
        name: spec.name,
        mime: "application/pdf",
        ext: "pdf",
        kind: "pdf",
        bytes: makePdf(spec, new Date(clock.at(spec.issued ?? "-0d"))),
      };
    case "eml":
      return { name: spec.name, mime: "message/rfc822", ext: "eml", kind: "email", bytes: eml(spec, clock) };
    case "text": {
      const ext = spec.mime === "text/csv" ? "csv" : spec.mime === "text/markdown" ? "md" : "txt";
      return { name: spec.name, mime: spec.mime, ext, kind: spec.mime === "text/csv" ? "sheet" : "notes", bytes: enc.encode(spec.text) };
    }
    case "png": {
      const { canvas, width, height } = render(spec.image);
      return { name: spec.name, mime: "image/png", ext: "png", kind: "image", bytes: canvas.png(), width, height };
    }
  }
}

/** The safe stored name the upload ops derive from a display name (functions/_lib/storage.ts normaliseFileName). */
export function storedNameOf(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
  return `${base}.${ext}`;
}

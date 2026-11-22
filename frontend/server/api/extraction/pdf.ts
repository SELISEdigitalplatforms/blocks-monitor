/** Text-based PDF extraction with real page boundaries. OCR is a separate processor.
 *  pdf-parse runs in a child process started from this release (engine/isolated/pdf.mjs): pdfjs-dist keeps state for
 *  the whole process on globalThis, so it is never loaded into the engine worker, which keeps one process across
 *  installs. */
import { runIsolated } from "../../local/engine/isolated/host.ts";
import type { PdfText } from "../../local/engine/isolated/pdf.mjs";

export interface PdfExtractionResult {
  pages: { pageNumber: number; text: string; isScanned: boolean }[];
  totalPages: number;
}

export type PdfErrorCode = "pdf_invalid" | "pdf_parser_unavailable" | "pdf_password_required" | "pdf_ocr_required" | "pdf_limit_exceeded" | "pdf_parse_failed";

export class PdfExtractionError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string) { super(message); this.code = code; }
}

export const MAX_PDF_PAGES = 200;
export const MAX_PDF_TEXT_CHARS = 90_000;
/** Past this the PDF reader's helper is stopped and the file reported unreadable. */
export const PDF_READ_LIMIT_MS = 5 * 60_000;

/** The plain failure for an error of the PDF reader (its child process). */
export function pdfReadFailure(error: unknown): PdfExtractionError {
  if (error instanceof PdfExtractionError) return error;
  const e = error as { name?: unknown; code?: unknown } | null;
  if (e?.code === "pdf_parser_unavailable") {
    return new PdfExtractionError("pdf_parser_unavailable", "PDF text extraction is unavailable on this server. Install the frontend's declared pdf-parse dependency and restart the development server.");
  }
  if (e?.name === "PasswordException") {
    return new PdfExtractionError("pdf_password_required", "This PDF is password-protected. Upload an unlocked copy for analysis.");
  }
  return new PdfExtractionError("pdf_parse_failed", "The PDF could not be read. It may be damaged or use an unsupported format; export a fresh, unlocked PDF and retry.");
}

export async function extractPdf(buffer: Buffer, _fileName: string): Promise<PdfExtractionResult> {
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw new PdfExtractionError("pdf_invalid", "This file is not a valid PDF. Export it as a PDF and try again.");
  }
  try {
    const result = await runIsolated<PdfText>("pdf", "text", { data: Uint8Array.from(buffer), maxPages: MAX_PDF_PAGES }, { timeoutMs: PDF_READ_LIMIT_MS });
    if (result.pages === null) throw new PdfExtractionError("pdf_limit_exceeded", `This PDF exceeds the ${MAX_PDF_PAGES}-page extraction limit. Split it into smaller PDFs.`);
    const pages = result.pages.map(page => ({ pageNumber: page.num, text: page.text.trim(), isScanned: !page.text.trim() }));
    if (!pages.length) throw new PdfExtractionError("pdf_invalid", "This PDF contains no readable pages.");
    const empty = pages.filter(page => !page.text);
    if (empty.length) {
      throw new PdfExtractionError("pdf_ocr_required", `PDF pages ${empty.slice(0, 12).map(p => p.pageNumber).join(", ")}${empty.length > 12 ? ", …" : ""} have no extractable text (blank or scanned). OCR is not configured. Upload a text-based PDF or remove blank pages.`);
    }
    if (pages.reduce((length, page) => length + page.text.length, 0) > MAX_PDF_TEXT_CHARS) {
      throw new PdfExtractionError("pdf_limit_exceeded", "This PDF contains too much text for one extraction. Split it into smaller PDFs so no content is silently omitted.");
    }
    return { pages, totalPages: result.total };
  } catch (error) {
    throw pdfReadFailure(error);
  }
}

export function pdfToMarkdown(result: PdfExtractionResult, fileName: string): string {
  return [`# ${fileName}\n`, `> ${result.totalPages} pages\n`, ...result.pages.map(page => `\n## Page ${page.pageNumber}\n\n${page.text}`)].join("\n");
}

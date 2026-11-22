// pdf-parse runs in a child process (server/local/engine/isolated/pdf.mjs, see host.ts): its part is checked here with a
// stand-in for pdf-parse, the plain failures of extractPdf with real files and the reader's errors.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPdf, type PdfLib } from "../../server/local/engine/isolated/pdf.mjs";
import { extractPdf, MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS, pdfReadFailure } from "../../server/api/extraction/pdf.ts";
import { textPdf } from "./pdfFixture";

const mocks = vi.hoisted(() => ({ info: vi.fn(), text: vi.fn(), destroy: vi.fn() }));
const lib = { PDFParse: class {
  getInfo = mocks.info;
  getText = mocks.text;
  destroy = mocks.destroy;
} } as unknown as PdfLib;
afterEach(() => vi.resetAllMocks());

describe("PDF parser failure boundaries", () => {
  it("reports password protection and still releases the parser", async () => {
    mocks.info.mockRejectedValue(Object.assign(new Error("private details"), { name: "PasswordException" }));
    const error = await readPdf(lib, new Uint8Array(8), MAX_PDF_PAGES).catch((e: unknown) => e);
    expect((error as Error).name).toBe("PasswordException");
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    const shown = pdfReadFailure(error);
    expect(shown).toMatchObject({ code: "pdf_password_required" });
    expect(shown.message).not.toContain("private details");
  });
  it("rejects excessive page counts before extracting every page", async () => {
    mocks.info.mockResolvedValue({ total: MAX_PDF_PAGES + 1 });
    await expect(readPdf(lib, new Uint8Array(8), MAX_PDF_PAGES)).resolves.toEqual({ total: MAX_PDF_PAGES + 1, pages: null });
    expect(mocks.text).not.toHaveBeenCalled(); expect(mocks.destroy).toHaveBeenCalledTimes(1);
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Page ${i + 1}`);
    await expect(extractPdf(textPdf(pages), "large.pdf")).rejects.toMatchObject({ code: "pdf_limit_exceeded" });
  });
  it("does not silently truncate oversized extracted text", async () => {
    mocks.info.mockResolvedValue({ total: 1 });
    mocks.text.mockResolvedValue({ total: 1, pages: [{ num: 1, text: "x".repeat(90_001) }] });
    await expect(readPdf(lib, new Uint8Array(8), MAX_PDF_PAGES)).resolves.toEqual({ total: 1, pages: [{ num: 1, text: "x".repeat(90_001) }] });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    // 35 full pages of 46 lines of 60 characters: more text than one extraction takes
    const page = Array.from({ length: 46 }, () => "x".repeat(60)).join("\n");
    expect(35 * 46 * 60).toBeGreaterThan(MAX_PDF_TEXT_CHARS);
    await expect(extractPdf(textPdf(Array.from({ length: 35 }, () => page)), "large.pdf")).rejects.toMatchObject({ code: "pdf_limit_exceeded" });
    // and 30 such pages (under the limit) are read whole
    const read = await extractPdf(textPdf(Array.from({ length: 30 }, () => page)), "fits.pdf");
    expect(read.pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0)).toBe(30 * 46 * 60);
  });
  it("releases the parser when reading the text fails, and says plainly what is missing", async () => {
    mocks.info.mockResolvedValue({ total: 1 });
    mocks.text.mockRejectedValue(new Error("bad xref"));
    await expect(readPdf(lib, new Uint8Array(8), MAX_PDF_PAGES)).rejects.toThrow("bad xref");
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(pdfReadFailure(new Error("bad xref"))).toMatchObject({ code: "pdf_parse_failed" });
    expect(pdfReadFailure(Object.assign(new Error("pdf-parse could not be loaded"), { code: "pdf_parser_unavailable" }))).toMatchObject({ code: "pdf_parser_unavailable" });
    expect(pdfReadFailure(new Error("The pdf helper ended (signal SIGKILL)"))).toMatchObject({ code: "pdf_parse_failed" });
  });
});

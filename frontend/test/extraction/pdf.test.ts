import { describe, expect, it } from "vitest";
import { extractPdf, pdfToMarkdown } from "../../server/api/extraction/pdf.ts";
import { textPdf } from "./pdfFixture";

describe("real PDF text parser", () => {
  it("extracts the real text and page references from a two-page PDF", async () => {
    const result = await extractPdf(textPdf(["The system must allow project creation.", "Owners must approve releases before deployment."]), "test.pdf");
    expect(result.totalPages).toBe(2);
    expect(result.pages.map(p => p.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0].text).toContain("project creation");
    expect(result.pages[1].text).toContain("approve releases");
    const markdown = pdfToMarkdown(result, "test.pdf");
    expect(markdown).toContain("## Page 1"); expect(markdown).toContain("## Page 2");
    expect(markdown).not.toContain("## Page 3");
  });
  it("does not mistake a short text page for a scan", async () => {
    const result = await extractPdf(textPdf(["Hi"]), "short.pdf");
    expect(result.pages[0].text).toBe("Hi");
    expect(result.pages[0].isScanned).toBe(false);
  });
  it("reports empty or scanned pages explicitly instead of normalizing placeholders", async () => {
    await expect(extractPdf(textPdf(["A valid text page", ""]), "mixed.pdf")).rejects.toMatchObject({ code: "pdf_ocr_required" });
  });
  it("rejects a non-PDF before invoking the parser", async () => {
    await expect(extractPdf(Buffer.from("Not PDF"), "fake.pdf")).rejects.toMatchObject({ code: "pdf_invalid" });
  });
  it("returns a safe actionable error for a damaged PDF", async () => {
    await expect(extractPdf(Buffer.from("%PDF-1.4\nbroken"), "damaged.pdf")).rejects.toMatchObject({ code: "pdf_parse_failed" });
  });
});

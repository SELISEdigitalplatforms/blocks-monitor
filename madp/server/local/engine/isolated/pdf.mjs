// The text of a PDF through pdf-parse, run in a child process (host.ts, child.mjs): pdfjs-dist keeps its worker
// handler and the @napi-rs/canvas classes on globalThis for the whole process, so a copy loaded into the engine worker
// by a later release would run on the first release's handler (another pdfjs version: no PDF can be read).
//
//   text   { data, maxPages } -> { total, pages: [{ num, text }] }, or pages null when there are more than maxPages
//          (the text is not extracted then). A file pdf-parse cannot open throws its own error (PasswordException ...);
//          a missing pdf-parse throws code pdf_parser_unavailable. api/extraction/pdf.ts makes those plain.

/** The page count first, then (within the limit) the text of every page; the parser is always released. */
export async function readPdf(lib, data, maxPages) {
  const parser = new lib.PDFParse({ data, isEvalSupported: false, stopAtErrors: true });
  try {
    const info = await parser.getInfo();
    if (info.total > maxPages) return { total: info.total, pages: null };
    const result = await parser.getText({ pageJoiner: "" });
    return { total: result.total, pages: result.pages.map((page) => ({ num: page.num, text: page.text })) };
  } finally {
    await parser.destroy();
  }
}

export const handlers = {
  async text({ data, maxPages }) {
    let lib;
    try {
      lib = await import("pdf-parse");
    } catch {
      throw Object.assign(new Error("pdf-parse could not be loaded"), { code: "pdf_parser_unavailable" });
    }
    // a copy of its own (the parser may take the buffer over)
    return readPdf(lib, Uint8Array.from(data), maxPages);
  },
};

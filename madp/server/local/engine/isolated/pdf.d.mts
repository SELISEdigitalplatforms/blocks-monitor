// Types of pdf.mjs (plain JavaScript, run by child.mjs in a child process).

export interface PdfText {
  total: number;
  /** null: more pages than maxPages (their text was not extracted) */
  pages: { num: number; text: string }[] | null;
}

/** The parts of pdf-parse that readPdf uses. */
export interface PdfLib {
  PDFParse: new (o: { data: Uint8Array; isEvalSupported: boolean; stopAtErrors: boolean }) => {
    getInfo(): Promise<{ total: number }>;
    getText(o: { pageJoiner: string }): Promise<{ total: number; pages: { num: number; text: string }[] }>;
    destroy(): Promise<void>;
  };
}

export function readPdf(lib: PdfLib, data: Uint8Array, maxPages: number): Promise<PdfText>;
export const handlers: { text(p: { data: Uint8Array; maxPages: number }): Promise<PdfText> };

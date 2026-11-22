/** Print setup for "Download PDF": only the report prints, on A4, in the light theme, with a clean file name.
 *  The print copy is a separate render (see PrintCopy in ShowcaseReport), hidden on screen. */
import { useEffect } from "react";

export const PRINT_ROOT_CLASS = "showcase-print-root";

/** A4 portrait, 12 mm side margins: 186 mm = 703 CSS px of width. The copy is laid out at 900 px and zoomed to fit;
 *  10 mm top and bottom leave 277 mm (1047 px) per page for the two pages: the story, then the proof. */
export const PRINT_CSS = `
@media screen {
  .${PRINT_ROOT_CLASS} { display: none !important; }
}
@media print {
  @page { size: A4 portrait; margin: 10mm 12mm; }
  html, body, #root { height: auto !important; min-height: 0 !important; background: none !important; }
  body > *:not(.${PRINT_ROOT_CLASS}) { display: none !important; }
  .${PRINT_ROOT_CLASS} {
    display: block !important;
    width: 900px;
    zoom: 0.775;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .${PRINT_ROOT_CLASS} *, .${PRINT_ROOT_CLASS} *::before, .${PRINT_ROOT_CLASS} *::after {
    animation: none !important;
    transition: none !important;
  }
  .${PRINT_ROOT_CLASS} .sc-keep { break-inside: avoid; page-break-inside: avoid; }
  .${PRINT_ROOT_CLASS} .sc-break { break-before: page; page-break-before: always; }
}
`;

/** While printing: switch to the light theme (a shared PDF is never dark) and name the PDF after the report. */
export function usePrintPrep(fileTitle: string) {
  useEffect(() => {
    const root = document.documentElement;
    let restore: { title: string; theme: string | undefined } | null = null;
    const before = () => {
      if (restore) return;
      restore = { title: document.title, theme: root.dataset.theme };
      document.title = fileTitle;
      if (root.dataset.theme === "dark") root.dataset.theme = "light";
    };
    const after = () => {
      if (!restore) return;
      document.title = restore.title;
      if (restore.theme === "dark") root.dataset.theme = "dark";
      restore = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      after();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [fileTitle]);
}

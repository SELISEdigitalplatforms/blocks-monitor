/** Print setup for "Download page as PDF": only the page copy prints, on A4, in the light theme (see usePrintPrep). */
import { useEffect } from "react";

export const WIKI_PRINT_CLASS = "wiki-print-root";

export const WIKI_PRINT_CSS = `
@media screen {
  .${WIKI_PRINT_CLASS} { display: none !important; }
}
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body, #root { height: auto !important; min-height: 0 !important; background: none !important; }
  body > *:not(.${WIKI_PRINT_CLASS}) { display: none !important; }
  .${WIKI_PRINT_CLASS} {
    display: block !important;
    width: 900px;
    zoom: 0.775;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .${WIKI_PRINT_CLASS} *, .${WIKI_PRINT_CLASS} *::before, .${WIKI_PRINT_CLASS} *::after {
    animation: none !important;
    transition: none !important;
  }
  .${WIKI_PRINT_CLASS} h2, .${WIKI_PRINT_CLASS} h3, .${WIKI_PRINT_CLASS} table, .${WIKI_PRINT_CLASS} pre {
    break-inside: avoid; page-break-inside: avoid;
  }
}
`;

/** While printing: switch to the light theme (a shared PDF is never dark) and name the PDF after the page. */
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

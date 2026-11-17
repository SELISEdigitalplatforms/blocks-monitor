/** "Download PDF" for the scope document: the share dialog calls requestScopePdf(); the Blocks print host
 *  (blocks/BlocksScopePrint) renders the copy from the records on screen. The job store lives in printJob.ts. */
import { requestScopePdf, type PdfJob } from "./printJob";

export { requestScopePdf };
export type { PdfJob };

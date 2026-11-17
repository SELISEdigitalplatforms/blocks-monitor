/** The PDF job store behind "Download PDF" on the scope page. Legacy-free, so the Blocks path and the share dialog use the
 *  same store: a share dialog calls requestScopePdf(); the print host mounted on the scope page renders the copy. */
import { create } from "zustand";

export type PdfJob = { type: "scope" } | { type: "screens" } | { type: "screen"; screenId: string };

export const usePdfJob = create<{ job: PdfJob | null }>(() => ({ job: null }));

/** Ask the scope page to print this item; the host renders the copy and opens the print dialog. */
export function requestScopePdf(job: PdfJob): void {
  usePdfJob.setState({ job });
}

export function clearScopePdf(): void {
  usePdfJob.setState({ job: null });
}

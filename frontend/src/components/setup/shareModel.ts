/** "Share what you already have": the pure rules (which folder the documents go to, how far each upload is). */
import type { DocFolderRecord } from "@/blocks/projects/records";
import { t } from "@/i18n";

/** Every shared document is filed here (top level of the project's documents). The folder's stored name: stays English. */
export const CLIENT_DOCS_FOLDER = "Client documents";

/** The active top-level folder with this name (case and outer spaces ignored), or null. */
export function findTopFolder(folders: readonly Pick<DocFolderRecord, "id" | "name" | "parentId" | "status">[], name: string): string | null {
  const want = name.trim().toLowerCase();
  const hit = folders.find((f) => f.parentId === "" && f.status !== "deleting" && f.name.trim().toLowerCase() === want);
  return hit?.id ?? null;
}

export type SharePhase = "queued" | "checking" | "uploading" | "verifying" | "done" | "failed";

/** How far one upload is, as steps of the small per-file bar (4 = filed). */
export const PHASE_STEPS = 4;
export function phaseStep(phase: SharePhase): number {
  switch (phase) {
    case "queued": return 0;
    case "checking": return 1;
    case "uploading": return 2;
    case "verifying": return 3;
    case "done": return 4;
    default: return 0;
  }
}

/** What a person reads next to the file. */
export function phaseText(phase: SharePhase): string {
  switch (phase) {
    case "queued": return t("shell.setup.share.phase.waiting", "Waiting…");
    case "checking": return t("shell.setup.share.phase.checking", "Checking…");
    case "uploading": return t("shell.setup.share.phase.uploading", "Uploading…");
    case "verifying": return t("shell.setup.share.phase.almostThere", "Almost there…");
    case "done": return t("shell.setup.share.phase.filed", "Filed");
    default: return t("shell.setup.share.phase.notUploaded", "Not uploaded");
  }
}

export const isBusy = (phase: SharePhase): boolean => phase === "queued" || phase === "checking" || phase === "uploading" || phase === "verifying";

/** The window's own summary of its uploads. */
export function shareSummary(items: readonly { phase: SharePhase }[]): { total: number; done: number; busy: number; failed: number } {
  let done = 0, busy = 0, failed = 0;
  for (const i of items) {
    if (i.phase === "done") done++;
    else if (i.phase === "failed") failed++;
    else busy++;
  }
  return { total: items.length, done, busy, failed };
}

/** The window's words for a new product and for an existing one. */
export function shareWording(existing: boolean): { title: string; text: string; examples: string; doneTitle: string } {
  return existing
    ? {
        title: t("shell.setup.share.existingTitle", "Share your existing documentation"),
        text: t("shell.setup.share.existingText", "Manuals, requirement documents, release notes, e-mails, spreadsheets, screenshots of today's product. Anything that explains how it works and what should change."),
        examples: t("shell.setup.share.existingExamples", "User guides, requirement documents, change requests, e-mails, exports, screenshots"),
        doneTitle: t("shell.setup.share.existingDoneTitle", "Your documentation is filed"),
      }
    : {
        title: t("shell.setup.share.newTitle", "Share what you already have"),
        text: t("shell.setup.share.newText", "Briefs, requirement documents, e-mails, spreadsheets, sketches or photos of a whiteboard. Anything that helps us understand your idea."),
        examples: t("shell.setup.share.newExamples", "Any format: documents, e-mails, spreadsheets, images"),
        doneTitle: t("shell.setup.share.newDoneTitle", "Your documents are filed"),
      };
}

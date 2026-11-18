/** Pure: the short labels and values of the Project setup chips ("Material 8"), the saved answers behind them and how
 *  they open (edit while in setup, the saved answers read-only afterwards). No React.
 *  The setup asks only About, Code and Material (owner, 08.11.2026): the goal and the end users are elicited by the
 *  business analyst in Business Analysis, who asks back when the description does not make them clear. So the
 *  checklist's "goal" item is never a chip, never counts towards the setup being complete and never blocks the hand-over. */
import { BRIEF_TITLE, briefAbout, parseTestEnv, testEnvText, type ChecklistId, type ChecklistItem } from "../../domain/projectBrief";
import type { StepChip } from "../step/StepFrame";
import { codeHomeOf, type StartAnswers } from "../../domain/guidedStart";
import { repoConnected } from "../../domain/projectType";
import { t } from "@/madp/i18n";

/** The checklist items Project Setup shows: About, Code, Material (not the goal and users, see above). */
export type SetupChipId = Exclude<ChecklistId, "goal">;
export const SETUP_CHIP_IDS: readonly SetupChipId[] = ["about", "where", "share"];

/** Read at render time: each label is looked up in the current language when it is read. */
export const SETUP_CHIP_LABEL: Record<SetupChipId, string> = {
  get about() { return t("analysis.business.chip.about", "About"); },
  get where() { return t("analysis.business.chip.code", "Code"); },
  get share() { return t("analysis.business.chip.material", "Material"); },
};

export const isSetupChipId = (id: ChecklistId): id is SetupChipId => (SETUP_CHIP_IDS as readonly ChecklistId[]).includes(id);

/** The checklist items Project Setup shows and counts (its chips, "Ready for analysis", what is still open). */
export function setupPageItems(items: readonly ChecklistItem[]): (ChecklistItem & { id: SetupChipId })[] {
  return items.filter((it): it is ChecklistItem & { id: SetupChipId } => isSetupChipId(it.id));
}

export interface SetupFacts {
  existing: boolean;
  repoSaved: boolean;
  repoName: string;
  sharedCount: number;
}

/** The short value after a chip's label, or "" for none. */
export function setupChipValue(id: SetupChipId, f: SetupFacts): string {
  switch (id) {
    case "where": return f.repoSaved ? f.repoName : "";
    case "share": return f.sharedCount > 0 ? String(f.sharedCount) : "";
    default: return "";
  }
}

/** What the client shared: every ready file and every note with text, besides the "Project brief" note (the guided
 *  start writes it from the answers). The Share window files into "Client documents", and the business agent then sorts
 *  material into its own folders (Meetings & calls, E-mails, …), so the count must not depend on one folder. The scratch
 *  pad counts once it has text (`scratchHasText`). */
export function sharedCount(
  data: { notes: readonly { id: string; isProjectBrief?: boolean }[]; files: readonly { status: string }[]; scratch: { id: string } | null } | undefined,
  scratchHasText: boolean,
): number {
  if (!data) return 0;
  return sharedNoteCount(data, scratchHasText) + data.files.filter((f) => f.status === "ready").length;
}

/** The notes among what the client shared (see sharedCount): every note besides the Project brief, the scratch pad
 *  once it has text. Business Analysis counts the notes beside the files it read by this same rule. */
export function sharedNoteCount(
  data: { notes: readonly { id: string; isProjectBrief?: boolean }[]; scratch: { id: string } | null },
  scratchHasText: boolean,
): number {
  return data.notes.filter((n) => !n.isProjectBrief && (n.id !== data.scratch?.id || scratchHasText)).length;
}

/* ── what was entered: the values behind the chips, and how the chips open ─────────────────────────────────── */

/** English source texts (the windows show them in the current language through the functions below). */
export const NOT_ANSWERED = "Not answered yet";
/** The one line of a chip's window once it only shows the saved answers. */
export const READ_ONLY_MOVED_ON = "Saved at setup · read-only now that the project has moved on";
export const READ_ONLY_NO_RIGHTS = "Saved answers · read-only: changing them needs edit rights for the project setup";
/** The Code window after the setup while a new product's code can still be moved to GitHub (until the build starts). */
export const CODE_STILL_OPEN = "Saved at setup · GitHub can still be connected until the build starts";

/** The About window of an existing product attached as it is live: its profile, which the server keeps fixed once the
 *  project is past its setup step (project.setup answers project.setupLocked), so it is shown, not offered for editing. */
export const READ_ONLY_LIVE = "The product's profile · read-only: it came to the Factory as a live product. Documenting it from its code and documents fills it in";

/** The texts above in the current language (read at render time). */
export const notAnsweredText = (): string => t("analysis.business.notAnswered", "Not answered yet");
export const codeStillOpenText = (): string => t("analysis.business.codeStillOpen", "Saved at setup · GitHub can still be connected until the build starts");
const readOnlyMovedOnText = (): string => t("analysis.business.readOnlyMovedOn", "Saved at setup · read-only now that the project has moved on");
const readOnlyNoRightsText = (): string => t("analysis.business.readOnlyNoRights", "Saved answers · read-only: changing them needs edit rights for the project setup");
const readOnlyLiveText = (): string => t("analysis.business.readOnlyLive", "The product's profile · read-only: it came to the Factory as a live product. Documenting it from its code and documents fills it in");

/** An existing product attached to the Factory as it is live: never handed over to the analysis, and past the setup
 *  step (it came in at a later step). An existing product still in its setup is not one: it is being set up. */
export function liveProductAttached(p: { existing?: boolean; type?: string; step: string; handedOverAt: string | null | undefined }): boolean {
  const existing = p.existing ?? p.type === "brownfield";
  return existing && !p.handedOverAt && p.step !== "business";
}

/** How the chips open: "edit" = today's windows (guided questions, Code, Share material); "read" = the saved answers. */
export type SetupChipMode = { kind: "edit" } | { kind: "read"; note: string };

/** Edit while the project is in its setup step and the person may edit it (the only time the server's project.setup
 *  accepts the answers); otherwise the saved answers, read-only, with the reason. */
export function setupChipMode(i: { canEdit: boolean; step: string; handedOverAt: string | null | undefined; existing?: boolean }): SetupChipMode {
  const movedOn = i.step !== "business" || Boolean(i.handedOverAt);
  if (i.canEdit && !movedOn) return { kind: "edit" };
  if (liveProductAttached({ existing: i.existing === true, step: i.step, handedOverAt: i.handedOverAt })) return { kind: "read", note: readOnlyLiveText() };
  return { kind: "read", note: movedOn ? readOnlyMovedOnText() : readOnlyNoRightsText() };
}

/** Where a value came from: the answers (Project record / guided start), the Project brief note, the Scratch pad, or
 *  what the business agent found in the material. */
export type ValueSource = "answers" | "brief" | "scratch" | "agent";
export interface SourcedText { text: string; source: ValueSource | null }
const none: SourcedText = { text: "", source: null };

/** Where the code lives, as the Code window shows it. */
export type CodeHomeView =
  | { home: "github"; owner: string; name: string; branch: string; visibility: string; existingRepo: boolean }
  | { home: "factory" }
  | { home: "create" }
  | { home: "pick" }
  | { home: "none" };

export interface SetupValues {
  existing: boolean;
  name: string;
  description: SourcedText;
  website: string;
  code: CodeHomeView;
  /** New product: the SELISE Blocks project it builds on ("" = none). */
  blocksProjectRef: string;
  /* existing product: where it runs and how */
  appUrl: string;
  testEnv: string;
  runInstructions: string;
}

/** The saved answers the chips stand for (no React): the Project record's fields first, then the guided start's
 *  answers, the Project brief note and the Scratch pad. The checklist's ticks are made from these same values, so a
 *  ticked chip always opens a value. */
export interface SetupValuesInput {
  project: {
    name: string; type: string; websiteUrl: string;
    repoOwner: string; repoName: string; repoBranch: string; repoVisibility: string; repoExisting: boolean;
    appUrl: string; testEnv: string; runInstructions: string; blocksProjectRef: string;
  };
  answers: StartAnswers;
  /** The Project brief note's text ("" while it loads or when there is none). */
  briefBody: string;
  scratchText: string;
}

export function setupValues(i: SetupValuesInput): SetupValues {
  const p = i.project;
  const a = i.answers;
  const existing = p.type === "brownfield";
  const about = briefAbout(i.briefBody);
  const description: SourcedText = a.description.trim() ? { text: a.description.trim(), source: "answers" }
    : about ? { text: about, source: "brief" }
    : i.scratchText.trim() ? { text: i.scratchText.trim(), source: "scratch" } : none;
  let code: CodeHomeView;
  if (repoConnected(p)) {
    code = { home: "github", owner: p.repoOwner, name: p.repoName, branch: p.repoBranch, visibility: p.repoVisibility, existingRepo: existing || p.repoExisting };
  } else if (existing) {
    code = { home: "none" };
  } else {
    const home = codeHomeOf(a);
    code = { home: home === "existing" ? "pick" : home };
  }
  return {
    existing,
    name: p.name.trim(),
    description,
    website: (p.websiteUrl || (existing ? a.website : "")).trim(),
    code,
    blocksProjectRef: existing ? "" : p.blocksProjectRef.trim(),
    appUrl: existing ? (p.appUrl || a.appUrl).trim() : "",
    testEnv: existing ? testEnvText(parseTestEnv(p.testEnv)) : "",
    runInstructions: existing ? (p.runInstructions || a.runInstructions).trim() : "",
  };
}

/** The Code chip is done once the code has a home: a saved repository, MADP Factory, or a new repository to create. */
export const codeHomeDone = (c: CodeHomeView): boolean => c.home === "github" || c.home === "factory" || c.home === "create";

/** One shared item of the Material window: the same notes and files `sharedCount` counts. */
export interface SharedItem { kind: "note" | "file"; id: string; title: string; folderName: string; sizeBytes: number; mime: string; scratch: boolean }

export function sharedItems(
  data: {
    notes: readonly { id: string; title: string; folderId: string; isProjectBrief?: boolean }[];
    files: readonly { id: string; name: string; folderId: string; status: string; sizeBytes: number; mime: string }[];
    folders: readonly { id: string; name: string }[];
    scratch: { id: string } | null;
  } | undefined,
  scratchHasText: boolean,
): SharedItem[] {
  if (!data) return [];
  const folder = (id: string) => (id ? data.folders.find((f) => f.id === id)?.name ?? "" : "");
  const notes = data.notes
    .filter((n) => !n.isProjectBrief && (n.id !== data.scratch?.id || scratchHasText))
    .map((n): SharedItem => {
      const scratch = n.id === data.scratch?.id;
      return { kind: "note", id: n.id, title: scratch ? t("analysis.business.scratchPad", "Scratch pad") : n.title.trim() || t("analysis.business.untitledNote", "Untitled note"), folderName: folder(n.folderId), sizeBytes: 0, mime: "", scratch };
    });
  const files = data.files
    .filter((f) => f.status === "ready")
    .map((f): SharedItem => ({ kind: "file", id: f.id, title: f.name, folderName: folder(f.folderId), sizeBytes: f.sizeBytes, mime: f.mime, scratch: false }));
  return [...notes, ...files];
}

/** The Project brief note (pinned): the one the guided start wrote, else a top-level note with its title. */
export function briefIdOf(data: { notes: readonly { id: string; title: string; folderId: string; isScratch: boolean; isProjectBrief?: boolean }[] } | undefined): string | null {
  if (!data) return null;
  const top = data.notes.filter((n) => !n.folderId && !n.isScratch);
  return (top.find((n) => n.isProjectBrief) ?? top.find((n) => n.title.trim() === BRIEF_TITLE))?.id ?? null;
}

/** The step frame's chips (without icons): About, Code, Material (a "goal" item is left out). Every chip opens at any
 *  stage: in "edit" mode today's window, in "read" mode the saved answers. An open chip in "read" mode invites with
 *  "view", never "add". */
export function setupChipList(items: readonly ChecklistItem[], facts: SetupFacts, mode: SetupChipMode, open: (id: SetupChipId) => void): StepChip[] {
  const read = mode.kind === "read";
  return setupPageItems(items).map((it): StepChip => ({
    id: it.id,
    label: SETUP_CHIP_LABEL[it.id],
    state: it.done ? "done" : "todo",
    value: setupChipValue(it.id, facts) || undefined,
    title: read ? `${it.label} · ${it.detail} · ${t("analysis.business.chip.seeSaved", "see what was saved")}` : `${it.label} · ${it.detail}`,
    onClick: () => open(it.id),
    // the chips still open after the sign-off: they show what was saved
    editableAfterSignOff: true,
    ...(read ? { todoLabel: t("analysis.business.chip.view", "view") } : {}),
  }));
}

/** What a chip opens: in "edit" mode the guided start's question (About), the Code window or Share material; in "read"
 *  mode always the saved answers of that chip. */
export type SetupChipTarget = { open: "guided"; step: "about" } | { open: "code" } | { open: "share" } | { open: "answers"; id: SetupChipId };

export function setupChipTarget(id: SetupChipId, mode: SetupChipMode): SetupChipTarget {
  if (mode.kind === "read") return { open: "answers", id };
  if (id === "about") return { open: "guided", step: id };
  return id === "where" ? { open: "code" } : { open: "share" };
}

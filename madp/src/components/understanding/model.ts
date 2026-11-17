/** "Project understanding" on the step standard (STEP-STANDARD.md): the business analyst shows what was read from your
 *  project setup and your files; you confirm or set aside what was found, let the business analyst settle what
 *  disagrees, then confirm. Pure: the page, its chips and its tests read the same state. Plain words only. */
import { t } from "@/i18n";
import type { Brief, BriefFile, BriefQuestion, BriefRequirement, FileState } from "./briefApi";

/** Read at render time: each word is looked up in the current language. */
export const ROLE_LINE = {
  get who() { return t("analysis.understanding.roleWho", "Business analyst"); },
  get delivers() { return t("analysis.understanding.roleDelivers", "What we read from your project setup and files"); },
  get you() { return t("analysis.understanding.roleYou", "check it, confirm or set aside what we found, then confirm"); },
};

/** One of two texts by count: the singular for exactly one. */
const byCount = (n: number, one: string, many: string) => (n === 1 ? one : many);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/* ── files ─────────────────────────────────────────────────────────────────── */

const KNOWN: readonly FileState[] = ["pending", "processing", "ready", "failed", "unsupported", "not_read"];
export const fileState = (s: string): FileState => ((KNOWN as readonly string[]).includes(s) ? (s as FileState) : "pending");

export interface FileCounts { total: number; read: number; reading: number; notRead: number; failed: number; unsupported: number }

export function fileCounts(files: readonly Pick<BriefFile, "status">[]): FileCounts {
  const c: FileCounts = { total: files.length, read: 0, reading: 0, notRead: 0, failed: 0, unsupported: 0 };
  for (const f of files) {
    const s = fileState(f.status);
    if (s === "ready") c.read += 1;
    else if (s === "processing" || s === "pending") c.reading += 1;
    else if (s === "not_read") c.notRead += 1;
    else if (s === "failed") c.failed += 1;
    else c.unsupported += 1;
  }
  return c;
}

/** Why a file could not be read, in plain words (never the technical cause). */
export function readError(code: string | undefined): string {
  switch (code) {
    case "pdf_invalid": return t("analysis.understanding.pdfInvalid", "This isn't a readable PDF. Save it as a PDF again and upload it.");
    case "pdf_password_required": return t("analysis.understanding.pdfPassword", "This PDF is password-protected. Upload an unlocked copy.");
    case "pdf_ocr_required": return t("analysis.understanding.pdfOcr", "Some pages are scanned pictures without text. Upload a text-based PDF.");
    case "pdf_limit_exceeded": return t("analysis.understanding.pdfTooLong", "This PDF is too long to read in one go. Split it into smaller files.");
    case "pdf_parse_failed": return t("analysis.understanding.pdfParseFailed", "This PDF couldn't be opened. Save a fresh copy and try again.");
    default: return t("analysis.understanding.readFailed", "Something went wrong while reading it. Try again.");
  }
}

export type WordTone = "success" | "accent" | "neutral" | "warning" | "danger";

/** One file's line: its status word, a short detail and its action. */
export function fileWords(f: BriefFile, busy: boolean): { label: string; tone: WordTone; detail: string; action: "read" | "retry" | null } {
  if (busy) return { label: t("analysis.understanding.fileReading", "Reading…"), tone: "accent", detail: "", action: null };
  switch (fileState(f.status)) {
    case "ready": {
      const found = f.requirementCount ?? 0;
      const detail = f.summary?.trim() ? clip(f.summary.trim(), 180)
        : found ? byCount(found,
          t("analysis.understanding.requirementsFoundOne", "1 requirement found"),
          t("analysis.understanding.requirementsFoundMany", "{count} requirements found", { count: found }))
        : f.observationCount ? byCount(f.observationCount,
          t("analysis.understanding.pointsNotedOne", "1 point noted"),
          t("analysis.understanding.pointsNotedMany", "{count} points noted", { count: f.observationCount }))
        : t("analysis.understanding.nothingNew", "Nothing new to note");
      return { label: t("analysis.understanding.fileRead", "Read"), tone: "success", detail, action: null };
    }
    case "processing": return { label: t("analysis.understanding.fileReading", "Reading…"), tone: "accent", detail: "", action: null };
    case "pending": return { label: t("analysis.understanding.fileWaiting", "Waiting to be read"), tone: "neutral", detail: "", action: null };
    case "not_read": return { label: t("analysis.understanding.fileNotRead", "Not read yet"), tone: "warning", detail: "", action: "read" };
    case "failed": return { label: t("analysis.understanding.fileFailed", "Couldn't read it"), tone: "danger", detail: readError(f.errorCode), action: "retry" };
    case "unsupported": return {
      label: t("analysis.understanding.fileUnsupported", "Can't read this kind of file"), tone: "neutral",
      detail: t("analysis.understanding.analystCanOpen", "Your business analyst can still open it."), action: null,
    };
  }
}

/* ── what we understood ────────────────────────────────────────────────────── */

export interface UnderstoodLine { key: string; label: string; text: string; missing?: boolean }

export function understoodLines(o: { existing: boolean; about: string; goal: string; users: string; outOfScope: readonly string[] }): UnderstoodLine[] {
  const out: UnderstoodLine[] = [];
  if (o.about.trim()) out.push({ key: "about", label: t("analysis.understanding.inShort", "In short"), text: clip(o.about.trim(), 320) });
  // The same labels as "What we understood" on Understanding your project.
  const goal = t("analysis.understanding.goal", "Goal");
  const forWho = t("analysis.understanding.for", "For");
  const notAnswered = t("analysis.understanding.notAnsweredYet", "Not answered yet");
  out.push(o.goal.trim()
    ? { key: "goal", label: goal, text: clip(o.goal.trim(), 260) }
    : { key: "goal", label: goal, text: notAnswered, missing: true });
  out.push(o.users.trim()
    ? { key: "users", label: forWho, text: clip(o.users.trim(), 200) }
    : { key: "users", label: forWho, text: notAnswered, missing: true });
  const left = o.outOfScope.map((x) => x.trim()).filter(Boolean);
  if (left.length) out.push({ key: "out", label: t("analysis.understanding.notIncluded", "Not included"), text: clip(left.join(" · "), 220) });
  return out;
}

/* ── requirements, conflicts, questions ────────────────────────────────────── */

export function requirementCounts(b: Pick<Brief, "features" | "rejectedRequirements">) {
  let confirmed = 0;
  let proposed = 0;
  for (const f of b.features) {
    confirmed += f.confirmedRequirements.length;
    proposed += f.proposedRequirements.length;
  }
  return { confirmed, proposed, setAside: b.rejectedRequirements?.length ?? 0 };
}

/** The source name the brief gives your own guided-start answers. */
export const OWN_SETUP = "Your project setup";

/** Only from your own project setup: changed there, not set aside here. */
export const ownWordsOnly = (r: Pick<BriefRequirement, "sources">): boolean => Boolean(r.sources?.length) && r.sources!.every((n) => n === OWN_SETUP);

/** Where a requirement comes from, in plain words. */
export function requirementSource(r: Pick<BriefRequirement, "sources" | "basis">): string {
  const names = (r.sources ?? []).filter(Boolean).map((n) => (n === OWN_SETUP ? t("analysis.understanding.ownSetupLower", "your project setup") : n));
  const list = names.length > 2 ? t("analysis.understanding.namesAndMore", "{names} and {count} more", { names: names.slice(0, 2).join(", "), count: names.length - 2 })
    : names.length === 2 ? t("analysis.understanding.namesTwo", "{first} and {second}", { first: names[0], second: names[1] })
    : names[0] ?? "";
  const from = names.length ? t("analysis.understanding.fromSources", "From {sources}", { sources: list }) : t("analysis.understanding.fromMaterial", "From your material");
  if (r.basis === "confirmed") return [from, t("analysis.understanding.confirmedByYou", "confirmed by you")].join(" · ");
  if (r.basis === "inferred") return [from, t("analysis.understanding.suggestedCheck", "suggested, please check")].join(" · ");
  return from;
}

/** The questions that are really still open for the next step: your files' questions (the start questions you
 *  skipped show as "Not answered yet" in What we understood instead). */
export function openQuestions(questions: readonly BriefQuestion[]): BriefQuestion[] {
  return questions.filter((q) => q.kind !== "basics" && !q.key?.startsWith("basics:"));
}

/* ── the frame: status, primary, chips, agent line ─────────────────────────── */

export type ChipState = "done" | "todo" | "attention" | "info";
export type NowChipKey = "basics" | "files" | "review" | "conflicts" | "questions";
export interface NowChip { key: NowChipKey; label: string; value: string; state: ChipState; todoLabel?: string }

export interface NowInput {
  canEdit: boolean;
  confirmed: boolean;
  goal: boolean;
  users: boolean;
  files: FileCounts;
  /** A file is being read on request right now (this browser). */
  retrying: boolean;
  proposed: number;
  confirmedRequirements: number;
  conflictsOpen: number;
  conflicts: number;
  questions: number;
  /** What it must do, found in the project setup (its must-haves and the business agent's findings), beside the files. */
  fromSetup?: number;
}

export interface NowState {
  status: string;
  tone: "done" | "progress" | "waiting" | "attention";
  primary: { label: string; disabled: boolean; reason?: string };
  chips: NowChip[];
  agent: { text: string; working: boolean; progress: number | null };
}

export function understandingNow(i: NowInput): NowState {
  const reading = i.retrying || i.files.reading > 0;
  const basicsDone = i.goal && i.users;
  const unread = i.files.notRead + i.files.failed;

  const chips: NowChip[] = [
    {
      key: "basics", label: t("analysis.understanding.chipBasics", "Goal & users"),
      value: basicsDone ? "" : !i.goal && !i.users ? t("analysis.understanding.chipMissing", "missing")
        : i.goal ? t("analysis.understanding.chipUsersMissing", "users missing") : t("analysis.understanding.chipGoalMissing", "goal missing"),
      state: basicsDone ? "done" : "attention", todoLabel: t("analysis.understanding.todoAdd", "add"),
    },
    {
      key: "files", label: t("analysis.understanding.chipFiles", "Files"),
      value: i.files.total === 0 ? t("analysis.understanding.chipNoneShared", "none shared")
        : t("analysis.understanding.chipFilesRead", "{read} of {total} read", { read: i.files.read, total: i.files.total }),
      state: reading ? "info" : i.files.total === 0 ? "info" : unread > 0 ? "attention" : "done",
      todoLabel: t("analysis.understanding.todoRead", "read"),
    },
    {
      key: "review", label: t("analysis.understanding.chipToCheck", "To check"),
      value: i.proposed ? String(i.proposed) : i.confirmedRequirements ? t("analysis.understanding.chipAllChecked", "all checked")
        : i.fromSetup ? t("analysis.understanding.chipNothingNew", "nothing new") : t("analysis.understanding.chipNothingYet", "nothing yet"),
      state: i.proposed ? "todo" : i.confirmedRequirements ? "done" : "info", todoLabel: t("analysis.understanding.todoReview", "review"),
    },
  ];
  if (i.conflicts > 0) {
    chips.push({
      key: "conflicts", label: t("analysis.understanding.chipDisagreements", "Disagreements"),
      value: i.conflictsOpen ? String(i.conflictsOpen) : t("analysis.understanding.chipSettled", "settled"),
      state: i.conflictsOpen ? "attention" : "done", todoLabel: t("analysis.understanding.todoSettle", "settle"),
    });
  }
  chips.push({ key: "questions", label: t("analysis.understanding.chipQuestions", "Open questions"), value: String(i.questions), state: "info" });

  const progress = i.files.total ? Math.round((100 * i.files.read) / i.files.total) : null;
  const agent = reading
    ? { text: t("analysis.understanding.agentReading", "Reading your files · {read} of {total} read", { read: i.files.read, total: i.files.total }), working: true, progress }
    : i.files.total === 0
      ? { text: t("analysis.understanding.agentSetupOnly", "Read your project setup answers. Share documents in Project setup and they are read here too."), working: false, progress: null }
      : unread > 0
        ? { text: `${unreadLead(i.files.read)}. ${unreadLine(unread, !(i.confirmed || !i.canEdit))}.`, working: false, progress: null }
        : {
          text: byCount(i.files.total,
            t("analysis.understanding.agentAllReadOne", "Read your project setup answers and the file."),
            t("analysis.understanding.agentAllReadMany", "Read your project setup answers and all {count} files.", { count: i.files.total })),
          working: false, progress: null,
        };

  if (i.confirmed) {
    return { status: t("analysis.understanding.statusConfirmed", "Confirmed"), tone: "done", primary: { label: confirmLabel(), disabled: true }, chips, agent };
  }
  const reason = !i.canEdit ? t("analysis.understanding.reasonTeamOnly", "Only the project team can confirm this step.")
    : reading ? t("analysis.understanding.reasonWaitReading", "Wait until your files are read.")
    : i.conflictsOpen ? byCount(i.conflictsOpen,
      t("analysis.understanding.reasonSettleOne", "Settle 1 disagreement first."),
      t("analysis.understanding.reasonSettleMany", "Settle {count} disagreements first.", { count: i.conflictsOpen }))
    : undefined;
  const status = reading ? t("analysis.understanding.statusReading", "Reading your files…")
    : i.conflictsOpen ? byCount(i.conflictsOpen,
      t("analysis.understanding.statusToSettleOne", "1 thing to settle"),
      t("analysis.understanding.statusToSettleMany", "{count} things to settle", { count: i.conflictsOpen }))
    : i.proposed ? byCount(i.proposed,
      t("analysis.understanding.statusToCheckOne", "1 requirement to check"),
      t("analysis.understanding.statusToCheckMany", "{count} requirements to check", { count: i.proposed }))
    : i.files.notRead ? byCount(i.files.notRead,
      t("analysis.understanding.statusNotReadOne", "1 file not read yet"),
      t("analysis.understanding.statusNotReadMany", "{count} files not read yet", { count: i.files.notRead }))
    : i.files.failed ? byCount(i.files.failed,
      t("analysis.understanding.statusFailedOne", "1 file couldn't be read"),
      t("analysis.understanding.statusFailedMany", "{count} files couldn't be read", { count: i.files.failed }))
    : t("analysis.understanding.statusReady", "Ready to confirm");
  const tone = reading ? "progress" : i.conflictsOpen || i.proposed || unread ? "attention" : "done";
  return { status, tone, primary: { label: confirmLabel(), disabled: Boolean(reason), reason }, chips, agent };
}

const confirmLabel = () => t("analysis.understanding.confirmUnderstanding", "Confirm understanding");

/** "Read 2 files and your project setup answers" (the agent line's first sentence, without its full stop). */
function unreadLead(read: number): string {
  if (!read) return t("analysis.understanding.agentReadSetup", "Read your project setup answers");
  return byCount(read,
    t("analysis.understanding.agentReadFilesOne", "Read 1 file and your project setup answers"),
    t("analysis.understanding.agentReadFilesMany", "Read {count} files and your project setup answers", { count: read }));
}

/** "1 file still to read: use the button next to it" (without its full stop). */
function unreadLine(unread: number, hint: boolean): string {
  if (hint) {
    return byCount(unread,
      t("analysis.understanding.agentStillToReadHintOne", "1 file still to read: use the button next to it"),
      t("analysis.understanding.agentStillToReadHintMany", "{count} files still to read: use the button next to it", { count: unread }));
  }
  return byCount(unread,
    t("analysis.understanding.agentStillToReadOne", "1 file still to read"),
    t("analysis.understanding.agentStillToReadMany", "{count} files still to read", { count: unread }));
}

/* ── what the project setup found ──────────────────────────────────────────── */

export interface SetupFinding { key: string; text: string; source: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "What it should do" from the project setup: its saved must-haves, then what the business agent found in the
 *  material and nobody ignored, without the ones the brief already lists (same words) or said twice. */
export function setupFindings(o: {
  mustHaves: readonly { text: string }[];
  found: readonly { id: string; text: string; status: string; sourceName: string }[];
  inBrief: readonly string[];
}): SetupFinding[] {
  const seen = new Set(o.inBrief.map(norm));
  const out: SetupFinding[] = [];
  const add = (key: string, text: string, source: string) => {
    const clean = text.trim();
    const n = norm(clean);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ key, text: clean, source });
  };
  o.mustHaves.forEach((m, i) => add(`setup:${i}`, m.text, t("analysis.understanding.fromSetup", "From your project setup")));
  for (const f of o.found) {
    if (f.status === "ignored") continue;
    add(`found:${f.id}`, f.text, f.sourceName.trim()
      ? t("analysis.understanding.foundInBy", "Found in {source} by your business analyst", { source: f.sourceName.trim() })
      : t("analysis.understanding.foundInMaterial", "Found in your material by your business analyst"));
  }
  return out;
}

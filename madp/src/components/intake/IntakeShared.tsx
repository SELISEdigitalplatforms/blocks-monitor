/** Shared pieces of the three project steps (Brief, Requirements & objective, Scope confirmation): the step header, the attachment rows, icons
 *  and sizes, file types, form fields, the GitHub mark, and where the shared journey
 *  stands, so every step opens in the right state (open, done, or too early). */
import type { ReactNode } from "react";
import {
  Camera, CircleAlert, CircleCheck, ExternalLink, File, FileArchive, FileMusic, FileSpreadsheet, FileText, FileType,
  FileVideoCamera, Image, Mail, NotepadText, Presentation, Quote, X, type LucideIcon,
} from "lucide-react";
import { flowIndex, type JourneyState } from "@/data/journey";
import { cn } from "@/lib/cn";
import { Avatar, Bar, PageHeader } from "@/ui/kit";
import { getCulture, t, useT } from "@/i18n";
import type { DraftItem, RequestInfo } from "./IntakeDraft";

/** The three steps of a new project: Business, Requirements & objective, Scope confirmation. Product sanitization (its
 *  own page) sits between Business and Requirements & objective. WIZARD_SLUGS are their routes, /p/:id/<slug>. */
export const wizardSteps = (): string[] => [
  t("shell.intake.steps.setup", "Project setup"),
  t("shell.intake.steps.requirements", "Goals & requirements"),
  t("shell.intake.steps.scope", "Scope & success"),
];
export const WIZARD_SLUGS = ["business", "requirements", "scope"] as const;

/** What kind of file an attachment is. */
export type MaterialKind =
  | "email" | "notes" | "pdf" | "doc" | "sheet" | "slides" | "image" | "photo" | "audio" | "video" | "archive" | "other";

/** What a sent brief gives the factory to cite: the ids of its attachments and your brief. */
export interface SentMaterial { items: ReadonlySet<string>; words: string }

/** The micro-label style of the kit Label, for labels that must stay inline (field labels, list headings). */
export const LABEL = "text-[12px] font-medium uppercase tracking-wider text-ink3";

/** One layout for the steps (Business, Requirements & objective, Scope confirmation): the page, and a 340 px column for the step's action, sticky beside the page from lg
 *  up and first under the header below it (as on the scope page), so the action is in reach without scrolling. */
export const STEP_GRID = "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]";
export const STEP_ASIDE = "min-w-0 max-lg:order-first lg:sticky lg:top-[calc(var(--project-nav-h,var(--topbar-h,0px))_+_1.5rem)] lg:self-start";

/** A quiet header button (Back): the surface fill keeps it visible on the canvas, so blue stays the one
 *  strong action on the screen. */
export const QUIET_BTN = "!bg-surface shadow-card hover:!bg-line dark:border dark:border-line";

/** A key (Ctrl, V, Enter): outlined, so it reads as a key on white and on grey alike. */
export const KBD = "rounded-md bg-surface2 px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink2 ring-1 ring-inset ring-line";

/** Scrolling in script follows the reduced-motion setting too (the CSS rule only covers animations). */
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The step header: the page header (the project navigation is drawn once by the project layout). viewing and at are
 *  kept for the callers. */
export function IntakeHeader({ eyebrow, title, subtitle, actions }: {
  viewing: number; at: number; eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
}) {
  return (
    <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={actions} />
  );
}

/** The organisation and the project, as on every project page. */
export function wizardEyebrow(name: string, org: string | undefined) {
  return [org?.trim() ?? "", name.trim()].filter(Boolean).join(" · ") || t("shell.titles.newProject", "New project");
}

/** Where the journey is in the three steps: 0 = business, 1 = requirements & objective (the objective is part of this
 *  step), 2 = scope confirmation, 3 = all three done. A paused project counts where it resumes; every other status
 *  (building, live, delivered, or off the flow) is past these steps. */
export function wizardAt(j: JourneyState): number {
  const s = j.status === "paused" && j.resumeTo ? j.resumeTo : j.status;
  if (flowIndex(s) < 0) return 3;
  switch (s) {
    case "intake": return 0;
    case "understanding":
    case "objective": return 1;
    case "scope": return 2;
    default: return 3;
  }
}

/** "Thu 22 Oct, 10:02" from an ISO time ("Do., 22. Okt., 10:02" in German) */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const locale = getCulture() === "de-CH" ? "de-CH" : "en-GB";
  const day = d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

/** The first name of a contact like "First Last, Role". */
export const firstNameOf = (contact: string) => contact.trim().split(/[\s,]+/)[0] ?? "";

/* ── attachments ──────────────────────────────────────────────────────────── */

const KIND_ICON: Record<MaterialKind, LucideIcon> = {
  email: Mail, notes: NotepadText, pdf: FileText, doc: FileType, sheet: FileSpreadsheet, slides: Presentation,
  image: Image, photo: Camera, audio: FileMusic, video: FileVideoCamera, archive: FileArchive, other: File,
};

/** The name of a kind of file. */
export function kindLabel(kind: MaterialKind): string {
  switch (kind) {
    case "email": return t("shell.intake.kind.email", "Email");
    case "notes": return t("shell.intake.kind.notes", "Notes");
    case "pdf": return t("shell.intake.kind.pdf", "PDF document");
    case "doc": return t("shell.intake.kind.doc", "Word document");
    case "sheet": return t("shell.intake.kind.sheet", "Spreadsheet");
    case "slides": return t("shell.intake.kind.slides", "Slides");
    case "image": return t("shell.intake.kind.image", "Image");
    case "photo": return t("shell.intake.kind.photo", "Photo");
    case "audio": return t("shell.intake.kind.audio", "Voice note");
    case "video": return t("shell.intake.kind.video", "Video");
    case "archive": return t("shell.intake.kind.archive", "Archive");
    default: return t("shell.intake.kind.other", "File");
  }
}

/** What reading means for each kind of file, while the factory reads it. */
function kindReading(kind: MaterialKind): string {
  switch (kind) {
    case "email": return t("shell.intake.reading.email", "Reading the email");
    case "notes": return t("shell.intake.reading.notes", "Reading the notes");
    case "pdf": return t("shell.intake.reading.pdf", "Reading the pages");
    case "doc": return t("shell.intake.reading.doc", "Reading the document");
    case "sheet": return t("shell.intake.reading.sheet", "Reading the table");
    case "slides": return t("shell.intake.reading.slides", "Reading the slides");
    case "image": return t("shell.intake.reading.image", "Reading the image");
    case "photo": return t("shell.intake.reading.photo", "Reading the photo");
    case "audio": return t("shell.intake.reading.audio", "Transcribing the voice note");
    case "video": return t("shell.intake.reading.video", "Transcribing the video");
    case "archive": return t("shell.intake.reading.archive", "Opening the archive");
    default: return t("shell.intake.reading.other", "Reading the file");
  }
}

/** What was read, once a file is read. */
function kindReadNote(kind: MaterialKind): string {
  switch (kind) {
    case "email": return t("shell.intake.readNote.email", "Read · 1 email");
    case "notes": return t("shell.intake.readNote.notes", "Read · text");
    case "pdf":
    case "doc": return t("shell.intake.readNote.textAndTables", "Read · text and tables");
    case "sheet": return t("shell.intake.readNote.sheet", "Read · table");
    case "slides": return t("shell.intake.readNote.slides", "Read · slides and notes");
    case "image": return t("shell.intake.readNote.image", "Read · text in the image");
    case "photo": return t("shell.intake.readNote.photo", "Read · text in the photo");
    case "audio":
    case "video": return t("shell.intake.readNote.transcribed", "Transcribed");
    case "archive": return t("shell.intake.readNote.archive", "Opened and read");
    default: return t("shell.intake.readNote.other", "Read");
  }
}

const KIND_EFFORT: Record<MaterialKind, number> = {
  email: 1.1, notes: 0.7, pdf: 1.1, doc: 1.0, sheet: 1.0, slides: 1.1, image: 0.9, photo: 1.1, audio: 1.4, video: 1.5, archive: 1.2, other: 0.8,
};

export const readingText = (i: DraftItem) => kindReading(i.kind);
export const readNote = (i: DraftItem) => kindReadNote(i.kind);
export const effort = (i: DraftItem) => KIND_EFFORT[i.kind];

/** The kind's icon on a soft tile; without a size it is 32 px on phones and 40 px from sm up. */
export function MaterialIcon({ kind, size, className }: { kind: MaterialKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind] ?? File;
  return (
    <span aria-hidden style={size ? { width: size, height: size } : undefined}
      className={cn("grid shrink-0 place-items-center rounded-[12px] bg-surface2 text-ink2 transition-colors", !size && "h-8 w-8 sm:h-10 sm:w-10", className)}>
      <Icon size={size ? Math.round(size * 0.45) : 18} strokeWidth={1.75} />
    </span>
  );
}

/** One attachment: icon, name, what was read (or the reading progress), size, Open and Remove.
 *  The rows of one list keep the same slots (openSlot = some row in the list can be opened), so sizes and buttons line
 *  up whatever each row offers. While reading, the status takes the size's place at the end of the row. */
export function ItemRow({ item, index, progress, onOpen, onRemove, openSlot = Boolean(onOpen) }: {
  item: DraftItem; index: number; progress?: number; onOpen?: () => void; onRemove?: () => void; openSlot?: boolean;
}) {
  useT();
  const readNow = progress !== undefined && progress >= 1;
  const slot = "grid h-8 w-8 shrink-0 place-items-center rounded-full [@media(hover:none)]:h-10 [@media(hover:none)]:w-10";
  const iconBtn = cn(slot, "text-ink3 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50");
  return (
    <li style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
      className="group flex items-center gap-3 rounded-block px-3 py-3 transition-colors animate-rise hover:bg-surface2 sm:gap-4">
      <MaterialIcon kind={item.kind} className="group-hover:bg-surface" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[14px] font-medium leading-snug [overflow-wrap:anywhere]" title={item.name}>{item.name}</div>
        {progress !== undefined ? (
          <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1" role="progressbar" aria-label={t("shell.intake.item.reading", "Reading {name}", { name: item.name })}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <Bar value={progress * 100} tone={readNow ? "success" : "accent"} className="h-1.5" />
            </div>
            <span className="truncate text-[12px] text-ink3 sm:w-52 sm:shrink-0 sm:text-right">
              {readNow ? readNote(item) : progress > 0 ? `${readingText(item)}…` : t("shell.intake.item.waiting", "Waiting")}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[12px] text-ink3">
            <span className="sm:hidden">{fmtBytes(item.size)} · </span>{item.read ? item.readNote ?? item.meta : item.meta}
          </div>
        )}
      </div>
      {progress === undefined && <span className="num hidden shrink-0 text-[13px] text-ink3 sm:block">{fmtBytes(item.size)}</span>}
      {onOpen ? (
        <button type="button" aria-label={t("shell.intake.item.open", "Open {name}", { name: item.name })} title={t("common.actions.open", "Open")} onClick={onOpen} className={iconBtn}>
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>
      ) : openSlot && (
        <span aria-hidden className={slot} />
      )}
      {item.read || readNow ? (
        <span className={slot}><CircleCheck size={19} strokeWidth={1.75} className="text-success animate-rise" aria-label={t("shell.intake.item.read", "Read")} /></span>
      ) : onRemove ? (
        <button type="button" aria-label={t("shell.intake.item.remove", "Remove {name}", { name: item.name })} title={t("common.actions.remove", "Remove")} onClick={onRemove} className={iconBtn}>
          <X size={15} strokeWidth={1.75} />
        </button>
      ) : (
        <span aria-hidden className={slot} />
      )}
    </li>
  );
}

/** The organisation (initials, name, key contact, industry, region) and the project name of a sent brief. The
 *  organisation is stored as request.client, its region in client.city. */
export function ProjectSummary({ request }: { request: RequestInfo }) {
  useT();
  const org = request.client;
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar initials={initialsOf(org.name)} size={42} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-medium">{org.name || t("shell.intake.summary.organisation", "Organisation")}</div>
          <div className="mt-0.5 line-clamp-2 text-[13px] text-ink3">{[org.contact, org.industry, org.city].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="mt-4 rounded-block bg-surface2 px-4 py-3">
        <div className={LABEL}>{t("shell.intake.summary.projectName", "Project name")}</div>
        <div className="mt-1 text-[15px] font-medium [overflow-wrap:anywhere]">{request.name || t("shell.search.untitledProject", "Untitled project")}</div>
      </div>
    </>
  );
}

/** A form field: its micro-label (with "optional" or a tag) above the control; the whole label is clickable. */
export function Field({ label, optional, tag, className, children }: {
  label: string; optional?: boolean; tag?: ReactNode; className?: string; children: ReactNode;
}) {
  useT();
  return (
    <label className={cn("block min-w-0", className)}>
      <span className={cn(LABEL, "mb-1.5 flex min-h-[22px] items-center gap-2")}>
        {label}
        {optional && <span className="font-normal normal-case tracking-normal">{t("common.status.optional", "optional")}</span>}
        {tag && <span className="ml-auto normal-case tracking-normal">{tag}</span>}
      </span>
      {children}
    </label>
  );
}

/** The GitHub mark, drawn inline as lucide has none; it takes the text colour; callers give the accessible name in text. */
export function GithubMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Your brief as written in step 1, quoted under its label. */
export function BriefQuote({ words, className }: { words: string; className?: string }) {
  useT();
  return (
    <figure className={className}>
      <figcaption className={cn(LABEL, "mb-1.5")}>{t("shell.intake.brief", "Brief")}</figcaption>
      <blockquote className="flex gap-3 rounded-block bg-surface2 px-4 py-3.5 text-[14px] leading-relaxed">
        <Quote size={16} strokeWidth={1.75} className="mt-1 shrink-0 text-ink3" aria-hidden />
        <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{words}</span>
      </blockquote>
    </figure>
  );
}

export function kindFromFile(f: { name: string; type: string }): MaterialKind {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const mime = f.type.toLowerCase();
  if (["eml", "msg", "mbox"].includes(ext) || mime === "message/rfc822") return "email";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf", "pages"].includes(ext)) return "doc";
  if (["xls", "xlsx", "xlsm", "csv", "ods", "numbers"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "slides";
  if (["jpg", "jpeg", "heic", "heif"].includes(ext)) return "photo";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || ["m4a", "mp3", "wav", "ogg", "aac"].includes(ext)) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["txt", "md", "rtf"].includes(ext) || mime.startsWith("text/")) return "notes";
  return "other";
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const initialsOf = (name: string) =>
  name.replace(/\b(AG|GmbH|SA|Ltd|Inc)\b/g, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

/** A refused journey action, in the store's own words (lastError). */
export function IntakeRefusal({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-block bg-danger-soft px-4 py-3 text-[13px] leading-snug text-danger animate-rise">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
      <span><span className="font-medium">{title}</span> {text}</span>
    </div>
  );
}

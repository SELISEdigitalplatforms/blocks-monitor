/** Icons of the Business tree: one per folder kind, the scratch pad, notes and file families. */
import { CalendarDays, File, FileAudio, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Folder, Lightbulb, Mail, NotebookPen, Presentation, Users, type LucideIcon } from "lucide-react";

export const SCRATCH_ICON: LucideIcon = NotebookPen;
export const NOTE_ICON: LucideIcon = FileText;

const FOLDER_ICON: Record<string, LucideIcon> = {
  meeting: Users, presentation: Presentation, event: CalendarDays, ideation: Lightbulb, other: Folder,
};

export function folderKindIcon(kind: string): LucideIcon {
  return FOLDER_ICON[kind] ?? Folder;
}

const BY_EXT: Record<string, LucideIcon> = {
  pdf: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage,
  txt: FileType, md: FileType, csv: FileType,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, ods: FileSpreadsheet,
  ppt: Presentation, pptx: Presentation, odp: Presentation,
  doc: FileText, docx: FileText, odt: FileText,
  eml: Mail, msg: Mail,
  mp3: FileAudio, m4a: FileAudio, wav: FileAudio,
  mp4: FileVideo, mov: FileVideo,
};

export function fileIconFor(file: { name: string; mime: string }): LucideIcon {
  const dot = file.name.lastIndexOf(".");
  const hit = dot >= 0 ? BY_EXT[file.name.slice(dot + 1).toLowerCase()] : undefined;
  if (hit) return hit;
  const m = file.mime.toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (m.startsWith("audio/")) return FileAudio;
  if (m.startsWith("video/")) return FileVideo;
  if (m.startsWith("text/")) return FileType;
  if (m === "application/pdf") return FileText;
  if (m === "message/rfc822") return Mail;
  return File;
}

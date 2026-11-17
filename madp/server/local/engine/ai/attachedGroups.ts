// The files people attached, grouped by what they belong to (the answer to one question, one chat message, the change
// request itself), for one AI step: the pictures Claude is shown (at most 4 in all, in order) and the prompt section
// that names every file under its group, with the same picture numbers. Documents are quoted within a shared budget.
// Pure; the files come from ai/attachments.ts attachmentsOf. No groups with files: no pictures and "".
import type { AiImage } from "./claude.ts";
import type { AttachedFile } from "./attachments.ts";

export interface FileGroup {
  /** What the files belong to, as the prompt says it ("With the answer to “How do refunds work?”"). */
  where: string;
  files: readonly AttachedFile[];
}

export interface GroupedFiles {
  images: AiImage[];
  /** The prompt section ("" when no group has a file). */
  block: string;
}

const MAX_PICTURES = 4;
const TEXT_BUDGET = 18_000;

/** One plain line of text, at most `max` characters. */
export function oneLine(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** The pictures and the prompt section of the grouped files (pure). */
export function groupedFiles(groups: readonly FileGroup[], heading = "Files the person attached"): GroupedFiles {
  const used = groups.filter((g) => g.files.length > 0);
  if (!used.length) return { images: [], block: "" };
  const images: AiImage[] = [];
  let budget = TEXT_BUDGET;
  const parts = used.map((g) => {
    const where = g.where.replace(/[.:]\s*$/, "");
    const lines = g.files.map((f) => {
      if (f.kind === "image" && f.image) {
        if (images.length < MAX_PICTURES) {
          images.push({ mimeType: f.mime, data: f.image, label: `${f.name}, ${where.charAt(0).toLowerCase()}${where.slice(1)}` });
          return `- ${f.name}: a picture (Picture ${images.length} above). Look at it closely and follow it.`;
        }
        return `- ${f.name}: a picture that could not be shown here (only ${MAX_PICTURES} pictures are shown at a time).`;
      }
      if (f.kind === "document" && f.text) {
        if (budget < 200) return `- ${f.name}: a document, left out here because the other files are long already.`;
        const text = f.text.length > budget ? `${f.text.slice(0, budget)}\n[…the rest of the file is left out]` : f.text;
        budget -= text.length;
        return `- ${f.name}:\n"""\n${text}\n"""`;
      }
      return `- ${f.name} (${f.mime || "file"}): could not be read as text or a picture.`;
    });
    return `${where}:\n${lines.join("\n")}`;
  });
  return { images, block: `${heading}:\n${parts.join("\n\n")}` };
}

/** The question id an Attachment's Meta names ({"questionId":"q2"}), or "" (Meta is optional JSON text). */
export function questionIdOf(meta: unknown): string {
  if (typeof meta !== "string" || !meta.trim().startsWith("{")) return "";
  try {
    const id = (JSON.parse(meta) as { questionId?: unknown }).questionId;
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

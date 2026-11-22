// The files people attach while they talk to the team (a comment, an answer to a question, a change request, a chat
// message, feedback on a preview), as the engine's AI steps see them. Every such file is an Attachment row
// (OwnerType + OwnerId, Status "ready", bytes in Blocks Storage under FileId). A job asks for the files of its owners;
// each file is downloaded once, kept in the project folder's inputs/ (the same index as the shared documents), and
// answered as text (documents) or as a picture Claude looks at (PNG, JPEG, WebP, GIF). Never throws: a file that
// cannot be read is listed by name only.
import type { Row } from "../../../../functions/_lib/gateway";
import { str } from "../context.ts";
import type { JobRun } from "../run.ts";
import { readDocument } from "../kinds/setup/read.ts";
import { AI_IMAGE_TYPES, type AiImage } from "./claude.ts";

/** The owner kinds a file can be attached to (Attachment.OwnerType). */
export const ATTACHMENT_OWNERS = {
  comment: "feedback-comment",
  clarification: "clarification",
  changeRequest: "change-request",
  chat: "agent-chat",
  ticket: "ticket",
} as const;

export interface AttachedFile {
  /** The Attachment's ItemId. */
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  /** "image" (Claude sees it), "document" (its text is in `text`) or "other" (name only). */
  kind: "image" | "document" | "other";
  /** The text of a document (clipped), "" otherwise. */
  text: string;
  /** The bytes of a picture, null otherwise. */
  image: Uint8Array | null;
  /** The copy in the project folder's inputs/ (null without folders or when it could not be kept). */
  path: string | null;
}

const MAX_IMAGE_BYTES = 4_500_000;
const MAX_TEXT = 6_000;
const MAX_FILES = 8;

/** The ready attachments of these owners, oldest first. */
export function attachmentRows(run: JobRun, ownerType: string, ownerIds: readonly string[]): Row[] {
  const ids = new Set(ownerIds.filter(Boolean));
  if (!ids.size) return [];
  return run.p
    .rows("Attachment")
    .filter((a) => str(a.OwnerType) === ownerType && ids.has(str(a.OwnerId)) && str(a.Status) === "ready" && str(a.FileId))
    .sort((a, b) => str(a.CreatedDate).localeCompare(str(b.CreatedDate)));
}

const isImage = (mime: string) => (AI_IMAGE_TYPES as readonly string[]).includes(mime.toLowerCase());

function mimeOf(row: Row): string {
  const m = str(row.Mime).toLowerCase();
  if (m) return m;
  const ext = (str(row.FileName).split(".").pop() ?? "").toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", md: "text/markdown", txt: "text/plain", csv: "text/csv" } as Record<string, string>)[ext] ?? "";
}

/** Keeps the bytes in inputs/ (once per file); answers the path or null. */
async function keep(run: JobRun, row: Row, mime: string, bytes: Uint8Array): Promise<string | null> {
  try {
    const dir = run.folder().inputs;
    const [{ copyInputs, inputFileName }, path] = await Promise.all([import("../../../engine-context/inputs.ts"), import("node:path")]);
    const id = str(row.ItemId);
    await copyInputs({
      inputsDir: dir,
      files: [{ ref: `Attachment:${id}`, name: str(row.FileName) || "file", mime, storageObjectId: str(row.FileId), sizeBytes: bytes.length }],
      readFile: async () => bytes,
      log: (l) => run.log(l),
    });
    return path.join(dir, inputFileName(id, str(row.FileName) || "file"));
  } catch {
    return null;
  }
}

/** The files of these owners, read for an AI step (at most 8, pictures up to 4.5 MB each). */
export async function attachmentsOf(run: JobRun, ownerType: string, ownerIds: readonly string[]): Promise<AttachedFile[]> {
  const rows = attachmentRows(run, ownerType, ownerIds).slice(0, MAX_FILES);
  const out: AttachedFile[] = [];
  for (const row of rows) {
    const mime = mimeOf(row);
    const base: AttachedFile = {
      id: str(row.ItemId), ownerType, ownerId: str(row.OwnerId), name: str(row.FileName) || "file", mime,
      sizeBytes: typeof row.SizeBytes === "number" ? row.SizeBytes : 0, kind: "other", text: "", image: null, path: null,
    };
    try {
      const bytes = await run.readFile(str(row.FileId));
      if (!bytes || !bytes.length) {
        out.push(base);
        continue;
      }
      base.sizeBytes = bytes.length;
      base.path = await keep(run, row, mime, bytes);
      if (isImage(mime)) {
        if (bytes.length <= MAX_IMAGE_BYTES) {
          base.kind = "image";
          base.image = bytes;
        }
      } else {
        let text = readDocument(base.name, mime, bytes).text;
        if (!text.trim() && /\.docx$/i.test(base.name)) {
          try {
            const { extractDocx } = await import("../../../api/extraction/docx.ts");
            const md = (await extractDocx(Buffer.from(bytes), base.name)).markdown;
            text = md.startsWith("[DOCX:") ? "" : md;
          } catch {
            text = "";
          }
        }
        if (text.trim()) {
          base.kind = "document";
          base.text = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[…the rest of the file is left out]` : text;
        }
      }
    } catch (e) {
      run.log(`attachments: ${base.name} not read (${e instanceof Error ? e.message.slice(0, 100) : "error"})`);
    }
    out.push(base);
  }
  return out;
}

/** The pictures among the files, labelled for the prompt ("Picture 1: hero.png, attached to …"). */
export function imagesOf(files: readonly AttachedFile[], where = ""): AiImage[] {
  return files
    .filter((f) => f.kind === "image" && f.image)
    .slice(0, 4)
    .map((f) => ({ mimeType: f.mime, data: f.image!, label: `${f.name}${where ? `, ${where}` : ""}` }));
}

/** The prompt section about the files: pictures are shown above the prompt, documents are quoted. "" when none. */
export function attachmentsBlock(files: readonly AttachedFile[], heading = "Files the person attached"): string {
  if (!files.length) return "";
  let picture = 0;
  const lines = files.map((f) => {
    if (f.kind === "image") return `- ${f.name}: a picture (Picture ${++picture} above). Look at it closely and follow it.`;
    if (f.kind === "document") return `- ${f.name}:\n"""\n${f.text}\n"""`;
    return `- ${f.name} (${f.mime || "file"}): could not be read as text or a picture.`;
  });
  return `${heading}:\n${lines.join("\n")}`;
}

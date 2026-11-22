// What a project says about itself, as one compact text for a prompt, made from the project's context (the snapshot the
// job's context hook refreshed before the writer ran, server/engine-context): the context version first, the guided
// start and setup answers, the brief, then the client's answers and decisions (ai/answers.ts: they override the
// documents, so they come before them), the notes and (when asked) the text of the shared files, then a digest of the
// context blocks the job's kind needs (engine-context/digest.ts KIND_BLOCKS), newest first, within a budget. Notes,
// files and answers carry a tag ([N1], [F1], [A1]) so an answer can say where a point came from.
// The records shown are noted for the job's trace. Kept short on purpose: every character is a token of the owner's
// subscription.
import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../../../functions/_lib/gateway";
import { CONSTRAINT_LABEL, type ConstraintKind } from "../../../../src/domain/setupDetails";
import { str } from "../context.ts";
import type { JobRun } from "../run.ts";
import { readDocument } from "../kinds/setup/read.ts";
import { contextDir, contextOf, noteContextUsed } from "../../../engine-context/hooks.ts";
import { KIND_BLOCKS, contextDigest, contextHeader } from "../../../engine-context/digest.ts";
import type { FileItem } from "../../../engine-context/snapshot.ts";
import { factsLine } from "../../../engine-context/facts.ts";
import { ATTACHMENT_OWNERS, attachmentsOf } from "./attachments.ts";
import { groupedFiles, oneLine, type FileGroup } from "./attachedGroups.ts";
import type { AiImage } from "./claude.ts";
import { answersBlock, type AnswerTag } from "./answers.ts";

export interface SourceTag {
  type: "doc-note" | "doc-file";
  id: string;
  by: string;
  name: string;
}

export interface Material {
  text: string;
  /** "N1" / "F1" -> the note or file. */
  sources: Map<string, SourceTag>;
  /** The pictures people attached to their answers (`answerFiles`), to pass to the AI call with the text. */
  images: AiImage[];
  /** "A1" -> the answer or decision (ai/answers.ts): the client's answers, cited like the notes and files. */
  answers: Map<string, AnswerTag>;
}

const clipText = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")} …`);

/** Headings of the sections a clipped file keeps whatever its length: what is left out of the first release and the
 *  key numbers and rules (amounts, schedules, the currency), which often come last in a brief. */
const KEEP_HEADING = /^\s*(?:#{1,4}\s*|\d{1,2}[.)]\s*)?(?:not (?:in|part of|included in) (?:the )?(?:first|initial|1st) (?:release|version)|out of scope|not in scope|not included|what we leave out|exclusions?|later releases?|key (?:numbers|facts|rules|figures)|numbers and rules|business rules|fees and payouts)\b[^\n]{0,40}$/i;
/** A line that starts another section ("5. Key numbers", "## Users", "Contact: …"). */
const NEXT_SECTION = /^\s*(?:#{1,4}\s+\S|\d{1,2}[.)]\s+[A-Z]|[A-Z][\w -]{1,30}:\s)/;

/** The sections after `from` that KEEP_HEADING names, each up to the next section (pure). */
export function keptSections(text: string, from = 0): string[] {
  const lines = text.slice(from).split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!KEEP_HEADING.test(lines[i]!)) continue;
    const body: string[] = [lines[i]!.trim()];
    for (let j = i + 1; j < lines.length && !NEXT_SECTION.test(lines[j]!) && !/^## Page \d+/.test(lines[j]!); j++) body.push(lines[j]!);
    out.push(body.join("\n").trim());
  }
  return out;
}

/** A file's text within `max` characters: the start, plus the out-of-scope and key-number sections the cut would
 *  lose (pure). */
export function clipKeeping(s: string, max: number): string {
  if (s.length <= max) return s;
  const kept = keptSections(s, Math.floor(max * 0.6)).join("\n\n").slice(0, Math.floor(max * 0.45));
  if (!kept) return clipText(s, max);
  return `${clipText(s, Math.max(200, max - kept.length - 4))}\n\n${kept}`;
}
const fold = (s: string): string => s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const idOf = (ref: string): string => ref.slice(ref.indexOf(":") + 1);

/** The text of a shared file (Markdown, text, e-mail, CSV, PDF; Word through the extraction reader), or "". */
export async function fileText(run: JobRun, f: Row): Promise<string> {
  const name = str(f.Name);
  const bytes = await run.readFile(str(f.StorageObjectId));
  const read = readDocument(name, str(f.Mime), bytes);
  if (read.text.trim()) return read.text;
  if (bytes && /\.docx$/i.test(name)) {
    try {
      const { extractDocx } = await import("../../../api/extraction/docx.ts");
      const md = (await extractDocx(Buffer.from(bytes), name)).markdown;
      return md.startsWith("[DOCX:") ? "" : md;
    } catch {
      return "";
    }
  }
  return "";
}

/** What the brief's extraction read from a file (artifacts/brief/sources/<id>/full-text.md or description.md), or "". */
function extractedText(kbDir: string | null, f: FileItem): string {
  const sourceId = f.extraction?.sourceId;
  if (!kbDir || !sourceId || f.extraction?.status !== "ready") return "";
  for (const name of ["full-text.md", "description.md"]) {
    try {
      const t = fs.readFileSync(path.join(kbDir, "sources", sourceId, name), "utf8");
      if (t.trim()) return t;
    } catch {
      /* not there */
    }
  }
  return "";
}

/** The whole text of the project's notes and shared files (no budget, no clipping), for the pure readers of the
 *  material (the out-of-scope list, the project facts). Files: the brief's extraction, else the file itself. */
export async function materialTexts(run: JobRun): Promise<string[]> {
  const ctx = await contextOf(run);
  const kb = contextDir(run);
  const out = ctx.sections.sources.notes.map((n) => `${n.title}\n${n.body}`);
  for (const f of ctx.sections.sources.files.filter((x) => x.ready).slice(0, 6)) {
    const t = extractedText(kb, f) || (await fileText(run, { Name: f.name, Mime: f.mime, StorageObjectId: f.storageObjectId }).catch(() => ""));
    if (t.trim()) out.push(fold(t));
  }
  return out;
}

export interface MaterialOptions {
  /** Read the shared files' text (else only their names). */
  files?: boolean;
  /** Only these notes / files (a job's refs). */
  noteIds?: readonly string[];
  fileIds?: readonly string[];
  /** Leave out the answered questions and decisions. */
  noAnswers?: boolean;
  /** Read the files people attached to their answers: documents are quoted after the questions, pictures are answered
   *  in `images` (the caller passes them to the AI call, which numbers them as the text does). */
  answerFiles?: boolean;
  /** Characters of notes and files together. */
  budget?: number;
  /** Characters of one file's text (default 3500); a longer file keeps its out-of-scope and key-number sections. */
  fileMax?: number;
  /** Characters of the context digest of the job's kind (default 2500; 0 leaves it out). */
  contextBudget?: number;
}

export async function projectMaterial(run: JobRun, o: MaterialOptions = {}): Promise<Material> {
  const ctx = await contextOf(run);
  const kb = contextDir(run);
  const b = ctx.sections.basics;
  const out: string[] = [];
  const used: string[] = [];
  const sources = new Map<string, SourceTag>();
  const images: AiImage[] = [];
  const line = (label: string, v: string) => { if (v.trim()) out.push(`${label}: ${fold(v)}`); };

  out.push(contextHeader(ctx));
  line("Product name", b.name || "the project");
  line("Client", [b.client, b.industry, b.region].filter(Boolean).join(", "));
  out.push(`Kind of work: ${b.existing ? `changes to an existing product${b.repoName ? ` (code in ${b.repoName})` : ""}` : "a new product, built from scratch"}`);
  line("Description", b.description);
  line("Goal", b.goal);
  line("Who uses it", b.targetUsers);
  if (b.mustHaves.length) out.push(`Must-haves:\n${b.mustHaves.map((m) => `- [${m.priority}] ${fold(m.text)}`).join("\n")}`);
  if (b.workflows.length) out.push(`Key workflows:\n${b.workflows.map((w) => `- ${fold(w)}`).join("\n")}`);
  if (b.exclusions.length) out.push(`Not included:\n${b.exclusions.map((w) => `- ${fold(w)}`).join("\n")}`);
  if (b.constraints.length) out.push(`Constraints:\n${b.constraints.map((c) => `- ${CONSTRAINT_LABEL[c.kind as ConstraintKind] ?? c.kind}: ${fold(c.text)}`).join("\n")}`);
  line("What should change", [b.intendedChanges, b.changeTags.join(", ")].filter(Boolean).join(" — "));
  line("Who approves the result", b.approvalOwnerName);
  // amounts in the project's own currency; never a home-region default (engine-context/currency.ts)
  out.push(b.currency
    ? `Currency: ${b.currency} (the one the material uses: every price, fee and amount is in ${b.currency})`
    : "Currency: none named in the material (write amounts without assuming a country's currency)");
  // the tax, payout and country facts the material states (engine-context/facts.ts): every text uses the same ones
  const facts = factsLine({ ...(b.facts ?? {}), currency: undefined });
  if (facts) out.push(`Project facts (the client's answers first, then the material; use exactly these): ${facts}`);

  // the client's answers and decisions, before the notes and files they override (ai/answers.ts)
  let answers = new Map<string, AnswerTag>();
  if (!o.noAnswers) {
    const answered = ctx.sections.clarifications.filter((c) => str(c.answer).trim() || c.status === "deferred").slice(-40);
    // the files people attached to their answers, each named under its question (never throws; none: no change)
    const files = o.answerFiles && answered.length ? await attachmentsOf(run, ATTACHMENT_OWNERS.clarification, answered.map((c) => idOf(c.ref))) : [];
    const filesOf = (c: { ref: string }) => files.filter((f) => f.ownerId === idOf(c.ref));
    const named = (c: { ref: string }) => {
      const own = filesOf(c);
      return own.length ? `\n  Files attached to this answer: ${own.map((f) => f.name).join(", ")} (see below)` : "";
    };
    const block = answersBlock(ctx, { extra: (ref) => named({ ref }) });
    if (block.text) out.push(block.text);
    used.push(...block.used);
    answers = block.tags;
    if (files.length) {
      const groups: FileGroup[] = answered.map((c) => ({ where: `With the answer to the question "${oneLine(str(c.question), 160)}"`, files: filesOf(c) }));
      const g = groupedFiles(groups, "Files the client attached to their answers (part of the answer, read them like the answer itself)");
      if (g.block) out.push(g.block);
      images.push(...g.images);
      used.push(...files.map((f) => `Attachment:${f.id}`));
    }
  }

  let budget = o.budget ?? 9000;
  const notes = ctx.sections.sources.notes.filter((n) => !o.noteIds?.length || o.noteIds.includes(idOf(n.ref)));
  notes.forEach((n, i) => {
    const tag = `N${i + 1}`;
    sources.set(tag, { type: "doc-note", id: idOf(n.ref), by: n.by, name: n.title || "a note" });
    used.push(n.ref);
    const body = budget > 200 ? clipText(fold(n.body), Math.min(2500, budget)) : "";
    budget -= body.length;
    out.push(`[${tag}] Note "${n.title || "untitled"}"${body ? `:\n${body}` : ""}`);
  });
  const files = ctx.sections.sources.files.filter((f) => f.ready && (!o.fileIds?.length || o.fileIds.includes(idOf(f.ref))));
  for (const [i, f] of files.entries()) {
    const tag = `F${i + 1}`;
    sources.set(tag, { type: "doc-file", id: idOf(f.ref), by: f.by, name: f.name });
    used.push(f.ref);
    let body = "";
    if (o.files && budget > 400 && i < 4) {
      const raw = extractedText(kb, f) || (await fileText(run, { Name: f.name, Mime: f.mime, StorageObjectId: f.storageObjectId }));
      body = clipKeeping(fold(raw), Math.min(o.fileMax ?? 3500, budget));
      budget -= body.length;
    }
    out.push(`[${tag}] File "${f.name}"${body ? `:\n${body}` : ""}`);
  }

  const blocks = KIND_BLOCKS[run.kind] ?? [];
  const contextBudget = o.contextBudget ?? 2500;
  if (blocks.length && contextBudget > 0) {
    const d = contextDigest(ctx, { blocks, budget: contextBudget });
    const nl = d.text.indexOf("\n");
    const body = nl < 0 ? "" : d.text.slice(nl + 1).trim(); // the version is already the first line
    if (d.refs.length && body) {
      out.push(`More from the project context, newest first:\n${body}`);
      used.push(...d.refs);
    }
  }
  noteContextUsed(run, used);
  return { text: out.join("\n\n"), sources, images, answers };
}

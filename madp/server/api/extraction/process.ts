/**
 * Reading one file: the parser for its type (PDF, Word, spreadsheet, text, image) and the AI runner's normalisation
 * into grouped findings (normalize.ts, aiRunner.ts). One function, used by:
 *   - the MADP engine's file.extract job (server/local/engine/kinds/extract.ts) — the only place it runs in the app,
 *     local mode (in-process engine) and Blocks mode (the engine worker on the engine host) alike;
 *   - the local-only HTTP route POST /api/extraction/:fileId/process (brief/routes.ts, local knowledge base).
 * It never writes anything itself: saveExtraction() writes the result into a knowledge base.
 */
import { createHash } from "node:crypto";
import { isCapacityError } from "./claudeCapacity.ts";
import { PdfExtractionError } from "./pdf.ts";
import type { NormalizedFindings } from "./normalize.ts";
import type { ExtractionResult, KbKey } from "../knowledgeBase.ts";

export interface SourceFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export type SourceStatus = "ready" | "failed" | "unsupported";

export interface SourceReading {
  result: ExtractionResult & { status: SourceStatus };
  findings: NormalizedFindings;
  /** Plain reason when the file could not be read (status failed or unsupported). */
  error?: string;
  errorCode?: string;
}

/** The first 16 hex characters of the bytes' SHA-256 (the knowledge base's content hash). */
export const contentHashOf = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** Reads one file and normalises what it says. Never throws for a file that cannot be read: the answer says why. */
export async function readSource(file: SourceFile, deps: { callAI?: (prompt: string, opts?: Record<string, unknown>) => Promise<string> } = {}): Promise<SourceReading> {
  const { fileId, fileName, mimeType, bytes } = file;
  const contentHash = contentHashOf(bytes);
  let extractedText = "";
  let sourceType = "document";
  let extractionError: string | undefined;
  let extractionErrorCode: string | undefined;
  let pages: number | undefined;

  try {
    if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      sourceType = "pdf";
      const { extractPdf, pdfToMarkdown } = await import("./pdf.ts");
      const result = await extractPdf(bytes, fileName);
      extractedText = pdfToMarkdown(result, fileName);
      pages = result.totalPages;
    } else if (mimeType.startsWith("image/")) {
      sourceType = "image";
      extractedText = "Analyze the attached image directly. Transcribe meaningful visible text into observations with image-region references; describe controls, diagrams, and relationships. Distinguish visible facts from inferred requirements. Do not invent business rules.";
    } else if (mimeType.includes("wordprocessingml") || fileName.endsWith(".docx")) {
      sourceType = "docx";
      const { extractDocx, docxToMarkdown } = await import("./docx.ts");
      const result = await extractDocx(bytes, fileName);
      extractedText = docxToMarkdown(result);
    } else if (mimeType.includes("spreadsheetml") || mimeType === "text/csv" || fileName.endsWith(".xlsx") || fileName.endsWith(".csv")) {
      sourceType = "spreadsheet";
      const { extractSpreadsheet } = await import("./spreadsheet.ts");
      const result = await extractSpreadsheet(bytes, fileName, mimeType);
      extractedText = result.markdown;
    } else if (mimeType.startsWith("text/") || fileName.endsWith(".md") || fileName.endsWith(".txt") || fileName.endsWith(".json")) {
      sourceType = "text";
      extractedText = `# ${fileName}\n\n${bytes.toString("utf-8")}`;
    } else {
      sourceType = "unsupported";
      extractedText = `# ${fileName}\n\n> Unsupported file type: ${mimeType}. Manual review required.\n`;
    }
  } catch (err) {
    extractionError = err instanceof Error ? err.message : "File extraction failed.";
    if (err instanceof PdfExtractionError) extractionErrorCode = err.code;
  }
  if (/^\[(?:DOCX|Spreadsheet): [^\n]*content extraction unavailable/.test(extractedText)) extractionError = "This document requires an unavailable parser.";

  // Normalise through the AI runner (claude/codex/aider/generic): structured, grouped findings.
  const { normalizeExtraction, FINDINGS_SCHEMA } = await import("./normalize.ts");
  const callAI = deps.callAI ?? (await import("./aiRunner.ts")).callAI;
  let findings: NormalizedFindings;
  if (extractedText && sourceType !== "unsupported" && !extractionError) {
    try {
      findings = await normalizeExtraction(
        extractedText, fileId, sourceType, fileName, pages,
        (prompt) => callAI(prompt, {
          outputSchema: FINDINGS_SCHEMA,
          ...(sourceType === "image" ? { image: { buffer: bytes, mimeType } } : {}),
        }),
      );
      if (sourceType === "image") {
        extractedText = `# ${fileName}\n\n${findings.summary}\n\n` + findings.observations.map((o) => `- [${o.id}] (${o.location}) ${o.text}`).join("\n");
      }
    } catch (err) {
      extractionError = err instanceof Error ? err.message : "Normalization failed.";
      // out of AI capacity (claudeCapacity.ts): the job fails with its own code, so it can be started again later
      if (isCapacityError(err)) extractionErrorCode = err.code;
      findings = {
        sourceId: fileId, sourceType, fileName,
        summary: `${sourceType}: ${fileName} (${(bytes.length / 1024).toFixed(1)} KB)`,
        observations: [], candidateRequirements: [], openQuestions: [],
        warnings: [extractionError],
      };
    }
  } else {
    findings = {
      sourceId: fileId, sourceType, fileName,
      summary: sourceType === "unsupported" ? `Unsupported: ${fileName}` : `${sourceType}: ${fileName}`,
      observations: [], candidateRequirements: [], openQuestions: [],
      warnings: extractionError ? [extractionError] : sourceType === "unsupported" ? [`Unsupported file type: ${mimeType}`] : [],
    };
  }

  const status: SourceStatus = extractionError ? "failed" : sourceType === "unsupported" ? "unsupported" : "ready";
  return {
    result: {
      sourceId: fileId, sourceType, fileName, mimeType,
      summary: findings.summary,
      contentHash,
      extractedText,
      findingsJson: findings,
      status,
      pages,
      ...(extractionErrorCode ? { errorCode: extractionErrorCode, errorMessage: extractionError } : {}),
    },
    findings,
    ...(extractionError ? { error: extractionError } : status === "unsupported" ? { error: `Unsupported file type: ${mimeType}` } : {}),
    ...(extractionErrorCode ? { errorCode: extractionErrorCode } : {}),
  };
}

/** Writes a reading into the knowledge base of `key` (sources/<fileId>/ and the manifest). */
export async function saveExtraction(key: KbKey, reading: SourceReading): Promise<void> {
  const { writeSourceExtraction, updateManifest } = await import("../knowledgeBase.ts");
  writeSourceExtraction(key, reading.result);
  updateManifest(key);
}

/** What the engine publishes to Blocks Storage for one reading (one JSON object per reading; the job row points at it).
 *  The brief on any web server is built from these, never from a folder on that server. */
export interface PublishedReading {
  schema: 1;
  sourceId: string;
  sourceType: string;
  fileName: string;
  mimeType: string;
  status: SourceStatus;
  summary: string;
  contentHash: string;
  pages: number | null;
  extractedAt: string;
  errorCode?: string;
  errorMessage?: string;
  findings: NormalizedFindings;
}

export function publishedReading(reading: SourceReading, at: string): PublishedReading {
  const r = reading.result;
  return {
    schema: 1,
    sourceId: r.sourceId,
    sourceType: r.sourceType,
    fileName: r.fileName,
    mimeType: r.mimeType,
    status: r.status,
    summary: r.summary,
    contentHash: r.contentHash,
    pages: r.pages ?? null,
    extractedAt: at,
    ...(r.errorCode ? { errorCode: r.errorCode, errorMessage: r.errorMessage } : {}),
    findings: reading.findings,
  };
}

/** Reads a published reading back (null for anything that is not one). */
export function parsePublishedReading(raw: unknown): PublishedReading | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<PublishedReading>;
  if (v.schema !== 1 || typeof v.sourceId !== "string" || !v.findings || typeof v.findings !== "object") return null;
  if (v.status !== "ready" && v.status !== "failed" && v.status !== "unsupported") return null;
  return v as PublishedReading;
}

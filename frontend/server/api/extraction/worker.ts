/**
 * Extraction Worker — background processor for uploaded files.
 *
 * Triggered on doc.file.commit. Downloads the file from Blocks Storage,
 * extracts content by type, normalizes into findings, and writes to the
 * project knowledge base.
 *
 * Pipeline: download → extract → normalize → write to knowledge base → update status
 */
import { createHash } from "node:crypto";
import { extractPdf, pdfToMarkdown } from "./pdf.ts";
import { extractImage, imageToMarkdown } from "./image.ts";
import { extractDocx, docxToMarkdown } from "./docx.ts";
import { extractSpreadsheet } from "./spreadsheet.ts";
import { normalizeExtraction, type NormalizedFindings } from "./normalize.ts";
import { writeSourceExtraction, type ExtractionResult } from "../knowledgeBase.ts";

export const PIPELINE_VERSION = "1.0";

export interface FileToExtract {
  fileId: string;
  /** The project's workspace: the knowledge base lives in the project's engine folder (knowledgeBase.ts). */
  workspaceId: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageObjectId: string;
}

export interface ExtractionCallbacks {
  /** Download file bytes from Blocks Storage. */
  downloadFile: (storageObjectId: string) => Promise<Buffer>;
  /** Call Claude API with a text prompt. */
  callClaude: (prompt: string) => Promise<string>;
  /** Call Claude Vision API with an image. */
  callClaudeVision: (prompt: string, imageBase64: string, imageMimeType: string) => Promise<string>;
  /** Update the AttachmentExtraction record in Data Gateway. */
  updateStatus: (fileId: string, status: string, extra?: Record<string, unknown>) => Promise<void>;
  /** Log a message. */
  log: (message: string) => void;
}

/** Process a single file: extract → normalize → write to knowledge base. */
export async function processFile(file: FileToExtract, cb: ExtractionCallbacks): Promise<NormalizedFindings | null> {
  const { fileId, projectId, fileName, mimeType, storageObjectId } = file;
  cb.log(`[extraction] Processing ${fileName} (${mimeType})`);

  try {
    await cb.updateStatus(fileId, "processing");

    // 1. Download file bytes
    const buffer = await cb.downloadFile(storageObjectId);
    const contentHash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);

    // 2. Extract by type
    let extractedText: string;
    let pages: number | undefined;
    const sourceType = mimeTypeToSourceType(mimeType, fileName);

    switch (sourceType) {
      case "pdf": {
        const result = await extractPdf(buffer, fileName);
        extractedText = pdfToMarkdown(result, fileName);
        pages = result.totalPages;
        break;
      }
      case "image": {
        const result = await extractImage(buffer, mimeType, fileName, cb.callClaudeVision);
        extractedText = imageToMarkdown(result, fileName);
        break;
      }
      case "docx": {
        const result = await extractDocx(buffer, fileName);
        extractedText = docxToMarkdown(result);
        pages = undefined;
        break;
      }
      case "spreadsheet": {
        const result = await extractSpreadsheet(buffer, fileName, mimeType);
        extractedText = result.markdown;
        pages = result.totalSheets;
        break;
      }
      case "text": {
        extractedText = `# ${fileName}\n\n${buffer.toString("utf-8")}`;
        break;
      }
      default: {
        await cb.updateStatus(fileId, "unsupported", { ErrorCode: "unsupported_type", ErrorMessage: `MIME type ${mimeType} is not supported` });
        cb.log(`[extraction] Unsupported: ${fileName} (${mimeType})`);
        return null;
      }
    }

    // 3. Normalize into structured findings
    cb.log(`[extraction] Normalizing ${fileName}...`);
    const findings = await normalizeExtraction(
      extractedText, fileId, sourceType, fileName, pages, cb.callClaude
    );

    // 4. Write to knowledge base
    const kbResult: ExtractionResult = {
      sourceId: fileId,
      sourceType,
      fileName,
      mimeType,
      summary: findings.summary,
      pages,
      contentHash,
      extractedText,
      findingsJson: findings,
    };
    writeSourceExtraction({ workspaceId: file.workspaceId, projectId }, kbResult);

    // 5. Update status in Data Gateway
    await cb.updateStatus(fileId, "ready", {
      ContentHash: contentHash,
      PipelineVersion: PIPELINE_VERSION,
      Summary: findings.summary,
      PageCount: pages ?? 0,
      ProcessedAt: new Date().toISOString(),
      FindingsJson: JSON.stringify(findings).length < 50_000 ? JSON.stringify(findings) : "",
    });

    cb.log(`[extraction] ✓ ${fileName}: ${findings.observations.length} observations, ${findings.candidateRequirements.length} candidate requirements`);
    return findings;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await cb.updateStatus(fileId, "failed", { ErrorCode: "extraction_error", ErrorMessage: message });
    cb.log(`[extraction] ✗ ${fileName}: ${message}`);
    return null;
  }
}

/** Map MIME type to our source type categories. */
function mimeTypeToSourceType(mimeType: string, fileName: string): string {
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword" || fileName.endsWith(".docx") || fileName.endsWith(".doc")) return "docx";
  if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel" || mimeType === "text/csv" || fileName.endsWith(".xlsx") || fileName.endsWith(".xls") || fileName.endsWith(".csv")) return "spreadsheet";
  if (mimeType.startsWith("text/") || fileName.endsWith(".md") || fileName.endsWith(".txt") || fileName.endsWith(".json")) return "text";
  return "unsupported";
}

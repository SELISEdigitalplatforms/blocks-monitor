/**
 * Knowledge Base Writer — writes extracted content and the project brief to the project's own engine folder.
 *
 * Location (DEMO-SCOPE-31.10.md, "Engine folder layout on this PC"):
 *   <MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/artifacts/brief/
 *     form-answers.json   the guided start's answers        sources/<fileId>/   one file's extraction
 *     brief.json, brief.md the merged project brief         manifest.json       every file's status
 *     decisions.json      your decisions on the brief       notes/
 * MF_ENGINE_ROOT defaults to madp-factory-work/engine-root next to the repository. Nothing is written into the
 * repository's engine folder. Both ids are checked before any path is made.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { extractionStatus } from "../../src/domain/extractionStatus.ts";
import { kbKey, type KbKey } from "./brief/access.ts";

export type { KbKey };

/** madp-factory-work/engine-root next to the repository (frontend/server/api → ../../../../madp-factory-work). */
const DEFAULT_ENGINE_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "madp-factory-work", "engine-root");

/** The engine root: MF_ENGINE_ROOT, or the default next to the repository. Read on every call. */
export function engineRoot(): string {
  const v = String(process.env.MF_ENGINE_ROOT ?? "").trim();
  return v ? resolve(v) : DEFAULT_ENGINE_ROOT;
}

function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

/** Persist the current attempt before a parser or model is awaited; retain prior artifacts privately. */
export function startSourceExtraction(key: KbKey, source: { sourceId: string; fileName: string; mimeType: string; contentHash: string }): void {
  const sourceDir = join(kbDir(key), "sources", source.sourceId.replace(/[^a-zA-Z0-9-]/g, "-"));
  mkdirSync(sourceDir, { recursive: true });
  writeJson(join(sourceDir, "meta.json"), { ...source, sourceType: "pending", status: "processing", startedAt: new Date().toISOString(), observationCount: 0, pipelineVersion: "1.0" });
  updateManifest(key);
}

/** THE location of a project's knowledge base (brief.json, brief.md, manifest.json, form-answers.json, decisions.json,
 *  sources/, notes/): <MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/artifacts/brief. Both ids are checked
 *  (^[A-Za-z0-9_-]{1,64}$, UUIDs lower-cased) before the path is made; throws on an invalid id. Pure: makes nothing.
 *  Every reader and writer (this module, the brief routes, the project-brief MCP server via --kb-dir) uses it. */
export function knowledgeBaseDir(workspaceId: string, projectId: string): string {
  const k = kbKey(workspaceId, projectId);
  return join(engineRoot(), "projects", k.workspaceId, k.projectId, "artifacts", "brief");
}

/** The project's knowledge-base folder (knowledgeBaseDir), created with its sources/ and notes/ if needed. */
export function kbDir(key: KbKey): string {
  const dir = knowledgeBaseDir(key.workspaceId, key.projectId);
  mkdirSync(join(dir, "sources"), { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  return dir;
}

// ── Source file writes ───────────────────────────────────────────────────────

export interface ExtractionResult {
  sourceId: string;
  sourceType: string;
  fileName: string;
  mimeType: string;
  summary: string;
  pages?: number;
  contentHash: string;
  extractedText: string;        // full text / description markdown
  findingsJson: object;         // schema-validated findings
  status?: "ready" | "failed" | "unsupported";
  errorCode?: string;
  errorMessage?: string;
}

/** Write extraction results for one file to the knowledge base. */
export function writeSourceExtraction(key: KbKey, result: ExtractionResult): void {
  const dir = kbDir(key);
  const slug = result.sourceId.replace(/[^a-zA-Z0-9-]/g, "-");
  const sourceDir = join(dir, "sources", slug);
  mkdirSync(sourceDir, { recursive: true });

  // Publish artifacts before terminal metadata so readers never see ready with old findings.
  const textFileName = result.sourceType === "image" ? "description.md" : "full-text.md";
  writeFileSync(join(sourceDir, textFileName), result.extractedText, "utf-8");
  writeJson(join(sourceDir, "extraction.json"), result.findingsJson);
  const observations = (result.findingsJson as { observations?: unknown[] }).observations;
  writeJson(join(sourceDir, "meta.json"), {
    sourceId: result.sourceId,
    sourceType: result.sourceType,
    fileName: result.fileName,
    mimeType: result.mimeType,
    summary: result.summary,
    pages: result.pages ?? null,
    contentHash: result.contentHash,
    extractedAt: new Date().toISOString(),
    pipelineVersion: "1.0",
    status: result.status || "ready",
    ...(result.errorCode ? { errorCode: result.errorCode, errorMessage: result.errorMessage } : {}),
    observationCount: (result.status || "ready") === "ready" && Array.isArray(observations) ? observations.length : 0,
  });

  // Update manifest
  updateManifest(key);
}

/** Remove a source extraction (when file is deleted). */
export function removeSourceExtraction(key: KbKey, sourceId: string): void {
  const slug = sourceId.replace(/[^a-zA-Z0-9-]/g, "-");
  const sourceDir = join(kbDir(key), "sources", slug);
  if (existsSync(sourceDir)) {
    rmSync(sourceDir, { recursive: true });
  }
  updateManifest(key);
}

// ── Notes ────────────────────────────────────────────────────────────────────

/** Write a user note to the knowledge base. */
export function writeNote(key: KbKey, noteId: string, title: string, bodyMd: string, isProjectBrief: boolean): void {
  const dir = kbDir(key);
  const fileName = isProjectBrief ? "project-brief.md" : `note-${noteId}.md`;
  const content = `# ${title}\n\n${bodyMd}`;
  writeFileSync(join(dir, "notes", fileName), content, "utf-8");
}

// ── Form answers ─────────────────────────────────────────────────────────────

/** Write structured form/wizard answers to the knowledge base (only when they changed). */
export function writeFormAnswers(key: KbKey, answers: object): void {
  const path = join(kbDir(key), "form-answers.json");
  const next = JSON.stringify(answers, null, 2);
  if (existsSync(path) && readFileSync(path, "utf-8") === next) return;
  writeJson(path, answers);
}

/** The saved form/wizard answers ({} when none were saved). */
export function readFormAnswers(key: KbKey): Record<string, unknown> {
  const path = join(kbDir(key), "form-answers.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

// ── Your decisions on the brief ──────────────────────────────────────────────

/** What the person decided on the Project understanding step: requirements confirmed or set aside, conflicts handed
 *  to the product manager, and the step's confirmation. Keys are the brief's stable item keys. */
export interface BriefDecisions {
  requirements: Record<string, "confirmed" | "rejected">;
  conflicts: Record<string, string>;
  confirmedAt?: string;
  confirmedByUserId?: string;
}

export function readDecisions(key: KbKey): BriefDecisions {
  const path = join(kbDir(key), "decisions.json");
  const empty: BriefDecisions = { requirements: {}, conflicts: {} };
  if (!existsSync(path)) return empty;
  try {
    const d = JSON.parse(readFileSync(path, "utf-8")) as Partial<BriefDecisions>;
    return {
      requirements: d.requirements && typeof d.requirements === "object" ? d.requirements : {},
      conflicts: d.conflicts && typeof d.conflicts === "object" ? d.conflicts : {},
      ...(typeof d.confirmedAt === "string" ? { confirmedAt: d.confirmedAt } : {}),
      ...(typeof d.confirmedByUserId === "string" ? { confirmedByUserId: d.confirmedByUserId } : {}),
    };
  } catch { return empty; }
}

/** Writes decisions.json only when the decisions changed, so the file's time says when one was last made (the brief
 *  is synced before every job and in the worker's periodic refresh). */
export function writeDecisions(key: KbKey, decisions: BriefDecisions): void {
  const path = join(kbDir(key), "decisions.json");
  if (existsSync(path) && readFileSync(path, "utf-8") === JSON.stringify(decisions, null, 2)) return;
  writeJson(path, decisions);
}

// ── Manifest ─────────────────────────────────────────────────────────────────

/** Rebuild the manifest from the sources/ directory. */
export function updateManifest(key: KbKey): void {
  const dir = kbDir(key);
  const sourcesDir = join(dir, "sources");
  if (!existsSync(sourcesDir)) return;

  const sources: object[] = [];
  for (const entry of readdirSync(sourcesDir)) {
    const metaPath = join(sourcesDir, entry, "meta.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const hasExtraction = existsSync(join(sourcesDir, entry, "extraction.json"));
        const findings = hasExtraction ? JSON.parse(readFileSync(join(sourcesDir, entry, "extraction.json"), "utf8")) : undefined;
        const status = extractionStatus(meta, findings);
        sources.push({ ...meta, status, observationCount: status === "ready" ? findings?.observations?.length || 0 : 0 });
      } catch { /* skip malformed */ }
    }
  }

  writeJson(join(dir, "manifest.json"), { sources, updatedAt: new Date().toISOString() });
}

// ── Brief ────────────────────────────────────────────────────────────────────

/** Write the merged project brief to the knowledge base. */
export function writeBrief(key: KbKey, brief: object): void {
  const dir = kbDir(key);
  writeJson(join(dir, "brief.json"), brief);

  // Also write a markdown version for agents that prefer it
  writeFileSync(join(dir, "brief.md"), briefToMarkdown(brief), "utf-8");
}

/** Read the current brief. Returns null if not built yet. */
export function readBrief(key: KbKey): object | null {
  const path = join(kbDir(key), "brief.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

/** Check if the brief is stale by comparing input fingerprints. */
export function isBriefStale(key: KbKey, currentFingerprint: string): boolean {
  const brief = readBrief(key) as { inputFingerprint?: string } | null;
  if (!brief) return true;
  return brief.inputFingerprint !== currentFingerprint;
}

/** Compute fingerprint from form answers hash + extraction content hashes. */
export function computeFingerprint(formAnswers: object, extractionHashes: string[]): string {
  const formHash = createHash("sha256").update(JSON.stringify(formAnswers)).digest("hex").slice(0, 12);
  const sortedHashes = [...extractionHashes].sort().join(",");
  return createHash("sha256").update(`${formHash}:${sortedHashes}`).digest("hex").slice(0, 16);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function briefToMarkdown(brief: any): string {
  const lines: string[] = [];
  lines.push(`# ${brief.project?.name || "Project Brief"}`);
  // a plain line, not a quote: readers show a quote as a "Note" box, and this line is no note
  lines.push(`\n_Version ${brief.version || 1} — Generated ${brief.generatedAt || new Date().toISOString()}_`);

  if (brief.project?.problem) {
    lines.push(`\n## Problem\n${brief.project.problem}`);
  }
  if (brief.project?.desiredOutcome) {
    lines.push(`\n## Desired Outcome\n${brief.project.desiredOutcome}`);
  }
  if (brief.targetUsers?.length) {
    lines.push(`\n## Target Users`);
    for (const u of brief.targetUsers) {
      lines.push(`- **${u.persona}**: ${u.description}`);
    }
  }
  if (brief.features?.length) {
    lines.push(`\n## Features`);
    for (const f of brief.features) {
      lines.push(`\n### ${f.name}`);
      if (f.confirmedRequirements?.length) {
        lines.push(`\n**Confirmed:**`);
        for (const r of f.confirmedRequirements) {
          lines.push(`- ${r.description} [${r.sourceRefs?.join(", ")}]`);
        }
      }
      if (f.proposedRequirements?.length) {
        lines.push(`\n**Proposed (needs confirmation):**`);
        for (const r of f.proposedRequirements) {
          lines.push(`- ${r.description} *(${r.basis})* [${r.sourceRefs?.join(", ")}]`);
        }
      }
      if (f.openQuestions?.length) {
        lines.push(`\n**Open Questions:**`);
        for (const q of f.openQuestions) {
          lines.push(`- ${typeof q === "string" ? q : q.question}`);
        }
      }
    }
  }
  if (brief.conflicts?.length) {
    lines.push(`\n## Conflicts`);
    for (const c of brief.conflicts) {
      lines.push(`- ⚠️ ${c.description} [${c.sources?.join(", ")}]`);
    }
  }
  if (brief.openQuestions?.length) {
    lines.push(`\n## Open Questions`);
    for (const q of brief.openQuestions) {
      const question = typeof q === "string" ? q : q.question;
      lines.push(`- ${question}`);
    }
  }
  if (brief.constraints?.length) {
    lines.push(`\n## Constraints`);
    for (const c of brief.constraints) {
      lines.push(`- **${c.kind}**: ${c.text}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Brief + Extraction API routes.
 *
 * Registered on the Vite dev server middleware alongside existing routes. With a `BriefAccess` (Blocks mode) every
 * route first reads the project as the signed-in person (access.ts): no session = 401, a project the person cannot
 * read = 404. Blocks mode works on Blocks alone, wherever this server runs: the MADP engine's readings of the files
 * (file.extract jobs and the readings they published to Storage), people's decisions (ProjectAnswer rows, written
 * through project.brief.decide as the signed-in person); nothing is read from or written to a folder on this server,
 * and no parser or AI runner runs here. Without one (local mode) the routes work on the local knowledge base.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { blocksBrief, blocksBriefInputs, buildBrief, briefInputs, ensureBrief, type ProjectBrief, type ReadingLoader } from "./builder.ts";
import { kbKey, readProjectFacts, LOCAL_WORKSPACE, type CallerOp, type CallerReads, type KbKey, type ProjectFacts } from "./access.ts";
import { CONFLICT_TO_PM as PM_TEXT, isBriefDecision, type BriefDecisionKind } from "../../../src/domain/briefDecisions.ts";
import { kbDir, readBrief, readDecisions, writeDecisions, updateManifest, startSourceExtraction } from "../knowledgeBase.ts";
import { extractionSummary } from "../../../src/domain/extractionStatus.ts";
import { existsSync, readFileSync } from "node:fs";

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;
export type BriefRoute = { method: string; pattern: RegExp; handler: Handler };

/** Blocks mode: read the project as the signed-in person; the engine's published readings (Blocks Storage); people's
 *  decisions written through the project function as the signed-in person (project.brief.decide). */
export interface BriefAccess {
  reads: CallerReads;
  /** Loads one published reading by its Storage object id (one the caller's own job read pointed at). */
  readings?: ReadingLoader;
  /** Runs one project op as the signed-in caller. */
  callOp?: CallerOp;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: IncomingMessage, max = 16_384): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

const activeExtractions = new Set<string>();
export const CONFLICT_TO_PM = PM_TEXT;
const noReadings: ReadingLoader = async () => null;

/** The brief + extraction routes; `access` = Blocks mode (null = local knowledge base only). */
export function createBriefRoutes(access: BriefAccess | null): BriefRoute[] {
  const table: BriefRoute[] = [];
  function route(method: string, path: string, handler: Handler): void {
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    table.push({ method: method.toUpperCase(), pattern, handler });
  }
  /** The project's facts as the caller (Blocks; null in local mode) and its knowledge-base key; answers any refusal
   *  itself (400 bad id, 401 not signed in, 404 not a project the caller can read). */
  async function gate(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<{ facts: ProjectFacts | null; key: KbKey } | null> {
    let key: KbKey;
    try { key = kbKey(LOCAL_WORKSPACE, projectId); } catch { json(res, { error: "invalid_project" }, 400); return null; }
    if (!access) return { facts: null, key };
    const r = await readProjectFacts(access.reads, req, res, key.projectId);
    if (!r.ok) { json(res, { error: r.error }, r.status); return null; }
    try { key = kbKey(r.facts.workspaceId, r.facts.id); } catch { json(res, { error: "invalid_project" }, 400); return null; }
    return { facts: r.facts, key };
  }

  // ── Trigger extraction for a single file ─────────────────────────────────

  /** Local mode only (the local knowledge base; the route tests): reads one file on the request. In the app every file
   *  is read by the MADP engine — committing an upload (doc.file.commit) or asking again (doc.file.extract) queues a
   *  file.extract job — so in Blocks mode this route never runs a parser or an AI runner on the web server. */
  route("POST", "/api/extraction/:fileId/process", async (req, res, _p) => {
  if (access) {
    for await (const _chunk of req) { /* drain the body */ }
    return json(res, { extracted: false, error: "engine_reads_files", message: "Files are read by the MADP engine. Use \"Read again\" on the file." }, 410);
  }
  // Parse multipart FormData — file bytes + metadata fields
  const { fileBuffer, fields } = await parseMultipart(req);
  const projectId = fields.projectId || "";
  const fileId = fields.fileId || "";
  const fileName = fields.fileName || fileId;
  const mimeType = fields.mimeType || "application/octet-stream";

  if (!projectId || !fileId) return json(res, { error: "projectId and fileId required" }, 400);
  const allowed = await gate(req, res, projectId);
  if (!allowed) return;

  const pid = allowed.key;

  // Processing needs real bytes; a placeholder is not a queued extraction job.
  if (!fileBuffer || fileBuffer.length === 0) {
    return json(res, { extracted: false, error: "file_bytes_required" }, 400);
  }

  const key = `${pid.workspaceId}/${pid.projectId}:${fileId}`;
  if (activeExtractions.has(key)) return json(res, { extracted: false, status: "processing", error: "This file is already being analyzed." }, 409);
  activeExtractions.add(key);
  try {
    const { readSource, saveExtraction, contentHashOf } = await import("../extraction/process.ts");
    startSourceExtraction(pid, { sourceId: fileId, fileName, mimeType, contentHash: contentHashOf(fileBuffer) });
    const reading = await readSource({ fileId, fileName, mimeType, bytes: fileBuffer });
    await saveExtraction(pid, reading);
    const status = reading.result.status;
    const failed = status === "failed";
    json(res, {
      extracted: status === "ready", fileId, projectId, sourceType: reading.result.sourceType, status,
      ...(failed && reading.error ? { error: reading.error } : {}),
      ...(reading.errorCode ? { errorCode: reading.errorCode } : {}),
      observations: reading.findings.observations.length,
      candidateRequirements: reading.findings.candidateRequirements.length,
    }, failed ? 422 : status === "unsupported" ? 415 : 200);
  } finally {
    activeExtractions.delete(key);
  }
});

  /** The current brief. Blocks: built in memory from Blocks alone (the caller's rows, the engine's published
   *  readings); nothing on this server's disk. Local: the knowledge base, rebuilt whenever an input changed. */
  async function currentBrief(allowed: { facts: ProjectFacts | null; key: KbKey }): Promise<ProjectBrief> {
    if (access && allowed.facts) return blocksBrief(allowed.facts, access.readings ?? noReadings);
    return ensureBrief(allowed.key, allowed.facts);
  }

  /** Blocks: writes one decision as the signed-in person; answers an HTTP status on refusal, null when saved. */
  async function saveDecision(req: IncomingMessage, res: ServerResponse, facts: ProjectFacts, kind: BriefDecisionKind, key: string, value: string | null): Promise<number | null> {
    if (!access?.callOp) return 503;
    const r = await access.callOp(req, res, "project.brief.decide", { projectId: facts.id, kind, ...(key ? { key } : {}), value }).catch(() => ({ ok: false as const, status: 503, code: "unavailable" }));
    return r.ok ? null : r.status;
  }

  // ── Extraction status ────────────────────────────────────────────────────

  route("GET", "/api/extraction/:projectId/status", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    if (access && allowed.facts) {
      // the engine's readings (file.extract jobs), as the caller read them
      const inputs = await blocksBriefInputs(allowed.facts, access.readings ?? noReadings);
      const sources = inputs.sources.map((src) => ({
        sourceId: src.fileId, fileName: src.name, status: src.status,
        observationCount: src.findings?.observations?.length ?? 0,
        ...(src.errorCode ? { errorCode: src.errorCode, errorMessage: src.errorMessage } : {}),
      }));
      return json(res, { sources, ...extractionSummary(sources) });
    }
    // Refresh older manifests whose file-existence heuristic incorrectly marked failures ready.
    updateManifest(allowed.key);
    const manifestPath = join(kbDir(allowed.key), "manifest.json");
    if (!existsSync(manifestPath)) return json(res, { sources: [], status: "empty" });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const sources = (manifest.sources || []) as { sourceId?: string; status: string }[];
    json(res, { sources, ...extractionSummary(sources) });
  });

  route("GET", "/api/extraction/:fileId/findings", (_req, res, _p) => {
    json(res, { error: "Use /api/brief/:projectId to get findings via the brief" }, 400);
  });

  // ── Brief ───────────────────────────────────────────────────────────────────

  /** The current brief: rebuilt first whenever an input changed (answers, files, readings, decisions). */
  route("GET", "/api/brief/:projectId", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    try {
      json(res, { brief: await currentBrief(allowed) });
    } catch (err) {
      json(res, { error: "build_failed", message: err instanceof Error ? err.message : "build failed" }, 500);
    }
  });

  route("GET", "/api/brief/:projectId/status", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    const blocks = Boolean(access && allowed.facts);
    const brief = blocks ? await currentBrief(allowed) : readBrief(allowed.key) as ProjectBrief | null;
    if (!brief) return json(res, { status: "empty", version: 0 });
    const stale = !blocks && brief.inputFingerprint !== briefInputs(allowed.key, allowed.facts).fingerprint;
    json(res, {
      status: stale ? "stale" : "ready",
      version: brief.version,
      generatedAt: brief.generatedAt,
      featureCount: brief.features?.length || 0,
      conflictCount: brief.conflicts?.length || 0,
      openQuestionCount: brief.openQuestions?.length || 0,
      confirmed: Boolean(brief.confirmedAt),
    });
  });

  route("POST", "/api/brief/:projectId/build", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    try {
      const brief = access && allowed.facts ? await currentBrief(allowed) : buildBrief(allowed.key, allowed.facts);
      json(res, { built: true, version: brief.version, featureCount: brief.features.length });
    } catch (err) {
      json(res, { error: "build_failed", message: err instanceof Error ? err.message : "build failed" }, 500);
    }
  });

  /** Your decision on one item: a requirement confirmed / set aside (null = undo), a conflict handed to the product
   *  manager (null = undo). Answers with the rebuilt brief. Blocks: a ProjectAnswer row (project.brief.decide). */
  route("POST", "/api/brief/:projectId/decision", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    const body = await readJsonBody(req);
    if (!body) return json(res, { error: "invalid_input" }, 400);
    const { kind, key, value } = body as { kind?: unknown; key?: unknown; value?: unknown };
    if ((kind !== "requirement" && kind !== "conflict") || !isBriefDecision(kind, key, value)) return json(res, { error: "invalid_input" }, 400);
    const k = key as string;
    const v = value as string | null;
    const facts = allowed.facts;
    const decisions = access && facts ? facts.blocks!.decisions : readDecisions(allowed.key);
    if (kind === "requirement") {
      if (v === null) delete decisions.requirements[k];
      else decisions.requirements[k] = v as "confirmed" | "rejected";
    } else {
      if (v === null) delete decisions.conflicts[k];
      else decisions.conflicts[k] = CONFLICT_TO_PM;
    }
    if (access && facts) {
      const refused = await saveDecision(req, res, facts, kind, k, v);
      if (refused) return json(res, { error: refused === 403 ? "forbidden" : refused === 401 ? "unauthenticated" : "unavailable" }, refused);
    } else {
      writeDecisions(allowed.key, decisions);
    }
    json(res, { saved: true, brief: await currentBrief(allowed) });
  });

  // ── Your confirmation ────────────────────────────────────────────────────────

  /** "Confirm understanding": records who confirmed and when (Blocks: a ProjectAnswer row; the engine writes it into
   *  the project's knowledge base on the engine host). The product manager's own work is the engine job the hand-over
   *  queued (EngineJob sanitization.assist, run by the engine worker); the page makes sure it exists. Nothing is
   *  written into the repository's engine folder and no local engine command is started from here. */
  route("POST", "/api/brief/:projectId/confirm", async (req, res, p) => {
    const allowed = await gate(req, res, p.projectId);
    if (!allowed) return;
    const current = await currentBrief(allowed);
    if (current.conflicts.some(c => !c.resolution)) return json(res, { confirmed: false, error: "conflicts_open" }, 409);
    const at = new Date().toISOString();
    const facts = allowed.facts;
    if (access && facts) {
      const refused = await saveDecision(req, res, facts, "confirm", "", "confirmed");
      if (refused) return json(res, { confirmed: false, error: refused === 403 ? "forbidden" : refused === 401 ? "unauthenticated" : "unavailable" }, refused);
      facts.blocks!.decisions = { ...facts.blocks!.decisions, confirmedAt: at, confirmedByUserId: facts.userId };
    } else {
      const decisions = readDecisions(allowed.key);
      writeDecisions(allowed.key, {
        ...decisions, confirmedAt: at,
        ...(facts?.userId ? { confirmedByUserId: facts.userId } : {}),
      });
    }
    json(res, { confirmed: true, brief: await currentBrief(allowed) });
  });

  return table;
}

/** Local mode (and the route tests): the knowledge base alone. */
export const briefRoutes: BriefRoute[] = createBriefRoutes(null);

/** Parse multipart FormData from a request. Returns file buffer + string fields. */
async function parseMultipart(req: IncomingMessage): Promise<{ fileBuffer: Buffer | null; fields: Record<string, string> }> {
  const contentType = req.headers["content-type"] || "";

  // JSON body (no file bytes)
  if (contentType.includes("application/json")) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    return { fileBuffer: null, fields: body };
  }

  // Multipart form data
  if (!contentType.includes("multipart/form-data")) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return { fileBuffer: null, fields: {} };
  }

  const boundary = contentType.split("boundary=")[1]?.trim();
  if (!boundary) return { fileBuffer: null, fields: {} };

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);

  const fields: Record<string, string> = {};
  let fileBuffer: Buffer | null = null;

  // Simple multipart parser
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(raw, boundaryBuf).slice(1); // skip preamble

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.subarray(0, headerEnd).toString("utf-8");
    const body = part.subarray(headerEnd + 4);
    // Trim trailing \r\n
    const trimmed = body.subarray(0, body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a ? body.length - 2 : body.length);

    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (headers.includes("filename=")) {
      fileBuffer = Buffer.from(trimmed);
    } else {
      fields[name] = trimmed.toString("utf-8");
    }
  }

  return { fileBuffer, fields };
}

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(delimiter, start);
    if (idx < 0) { parts.push(buf.subarray(start)); break; }
    parts.push(buf.subarray(start, idx));
    start = idx + delimiter.length;
  }
  return parts;
}

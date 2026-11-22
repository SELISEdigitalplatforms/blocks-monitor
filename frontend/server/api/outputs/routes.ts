/**
 * "What MADP produced": the project's outputs as the engine wrote them in its project folder
 * (<MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/artifacts/, server/engine-context/outputs.ts).
 *
 *   GET /api/outputs/:projectId                          artifacts/outputs.json (the index; 404 when there is none yet)
 *   GET /api/outputs/:projectId/file?path=<p>[&download=1]   one file the index lists, inline or as a download
 *
 * Served by this app server, which reads the engine root of the same host (as the brief routes do). In Blocks mode the
 * project is read as the signed-in person first (the host's caller reads): a project they cannot read answers 404, and
 * only that project's own folder is ever opened. Only files the index lists are served, from inside artifacts/; HTML is
 * sandboxed (no script runs on the app's origin).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { kbKey, readProjectFacts, LOCAL_WORKSPACE, type CallerReads, type KbKey } from "../brief/access.ts";
import { engineRoot } from "../knowledgeBase.ts";
import { scrub, scrubFile } from "../../blocks/engineWorker/privacy.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;
export interface OutputRoute { method: string; pattern: RegExp; handler: Handler }

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const MAX_BYTES = 20 * 1024 * 1024;

function json(res: ServerResponse, data: unknown, status = 200): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}

/** The artifacts/ folder of one project (both ids checked). */
export function artifactsDir(key: KbKey, root = engineRoot()): string {
  return join(root, "projects", key.workspaceId, key.projectId, "artifacts");
}

/** The index of a project's outputs, or null. */
export function readManifest(dir: string): { generated?: string[]; sections?: { items?: { path?: string }[] }[] } & Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(join(dir, "outputs.json"), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ReturnType<typeof readManifest>) : null;
  } catch {
    return null;
  }
}

/** The file at `rel` when the index lists it and it lies inside the artifacts folder; else null. */
export function listedFile(dir: string, manifest: NonNullable<ReturnType<typeof readManifest>>, rel: string): string | null {
  if (typeof rel !== "string" || !rel || rel.length > 400 || rel.includes("\0") || rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) return null;
  const listed = new Set<string>([...(manifest.generated ?? []), ...(manifest.sections ?? []).flatMap((s) => (s.items ?? []).map((i) => String(i.path ?? "")))]);
  if (!listed.has(rel)) return null;
  const base = resolve(dir);
  const abs = resolve(base, rel);
  return abs.startsWith(base + sep) ? abs : null;
}

/** The outputs routes; `access` = Blocks mode (null = the local engine folder of the local workspace). */
export function createOutputRoutes(access: { reads: CallerReads } | null): OutputRoute[] {
  const table: OutputRoute[] = [];
  const route = (method: string, path: string, handler: Handler) => table.push({ method, pattern: new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler });

  async function gate(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<KbKey | null> {
    let key: KbKey;
    try { key = kbKey(LOCAL_WORKSPACE, projectId); } catch { json(res, { error: "invalid_project" }, 400); return null; }
    if (!access) return key;
    const r = await readProjectFacts(access.reads, req, res, key.projectId);
    if (!r.ok) { json(res, { error: r.error }, r.status); return null; }
    try { return kbKey(r.facts.workspaceId, r.facts.id); } catch { json(res, { error: "invalid_project" }, 400); return null; }
  }

  route("GET", "/api/outputs/:projectId", async (req, res, p) => {
    const key = await gate(req, res, p.projectId);
    if (!key) return;
    const m = readManifest(artifactsDir(key));
    if (!m || m.projectId !== key.projectId) return json(res, { error: "not_found" }, 404);
    // the engine's privacy guard: no accounts, logins or design-tool links in what the app shows
    json(res, scrub(m));
  });

  route("GET", "/api/outputs/:projectId/file", async (req, res, p) => {
    const key = await gate(req, res, p.projectId);
    if (!key) return;
    const dir = artifactsDir(key);
    const m = readManifest(dir);
    if (!m || m.projectId !== key.projectId) return json(res, { error: "not_found" }, 404);
    const q = new URL(req.url ?? "", "http://x").searchParams;
    const rel = q.get("path") ?? "";
    const file = listedFile(dir, m, rel);
    if (!file) return json(res, { error: "not_found" }, 404);
    let body: Buffer;
    try {
      if (statSync(file).size > MAX_BYTES) return json(res, { error: "too_large" }, 413);
      body = readFileSync(file);
    } catch {
      return json(res, { error: "not_found" }, 404);
    }
    const name = rel.split("/").pop()!.replace(/[^A-Za-z0-9._-]/g, "_");
    const type = TYPES[extname(file).toLowerCase()] ?? "text/plain; charset=utf-8";
    // the engine's privacy guard: text outputs are scrubbed of accounts, logins and design-tool links
    body = Buffer.from(scrubFile(type, body));
    const headers: Record<string, string | number> = {
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // a page of the outputs (a screen design, the index) never runs a script on the app's origin
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; font-src data:",
      "Content-Disposition": `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
    };
    res.writeHead(200, headers);
    res.end(body);
  });

  return table;
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CallerOp } from "./brief/access.ts";
import { DESIGN_PREVIEW_HEADERS } from "../security/designPreview.ts";

export function createDesignPreviewRoutes(callOp?: CallerOp) {
  const gallery = { method: "GET", pattern: /^\/api\/design-preview\/(?<projectId>[A-Za-z0-9_-]{1,64})\/(?<revision>[a-f0-9]{64})$/,
    async handler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const result = callOp ? await callOp(req, res, "designBrief.preview", params) : { ok: false as const, status: 503 };
      if (!result.ok) { res.writeHead(result.status, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); res.end("Design preview is unavailable."); return; }
      const data = result.data as { html?: unknown };
      if (typeof data.html !== "string") { res.writeHead(503); res.end("Design preview is unavailable."); return; }
      res.writeHead(200, DESIGN_PREVIEW_HEADERS); res.end(data.html);
    },
  };
  return [gallery, { method: 'GET', pattern: /^\/api\/design-preview\/(?<projectId>[A-Za-z0-9_-]{1,64})\/(?<revision>[a-f0-9]{64})\/screens$/,
    async handler(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const result = callOp ? await callOp(req, res, 'designBrief.preview', params) : { ok: false as const, status: 503 };
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      if (!result.ok) { res.writeHead(result.status, headers); res.end(JSON.stringify({ error: 'Preview unavailable' })); return; }
      const data = result.data as { screens?: unknown; revision?: unknown };
      if (!Array.isArray(data.screens)) { res.writeHead(404, headers); res.end(JSON.stringify({ error: 'Screen exports unavailable' })); return; }
      res.writeHead(200, headers); res.end(JSON.stringify({ screens: data.screens, revision: data.revision }));
    },
  }];
}

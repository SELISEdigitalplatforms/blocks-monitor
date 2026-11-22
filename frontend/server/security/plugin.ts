import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { resolveAppOrigin } from "../fnHost/appOrigin.ts";
import {
  buildCsp,
  CSP_NONCE_PLACEHOLDER,
  cspModeOf,
  DEFAULT_BLOCKS_API_URL,
  HTML_SECURITY_HEADERS,
  needsWasm,
  newNonce,
  STORAGE_ORIGINS,
  type CspResult,
} from "./csp.ts";

// CSP and security headers for the dev server (serve only, never test or build).
const applies: Plugin["apply"] = (_, env) => env.command === "serve" && env.mode !== "test";

type Req = IncomingMessage;
type Res = ServerResponse;

const headerText = (v: unknown): string => (Array.isArray(v) ? v.join(",") : v == null ? "" : String(v));

export function createSecurityMiddleware(o: { csp: (nonce: string) => CspResult }) {
  return (req: Req, res: Res, next: () => void): void => {
    res.setHeader("x-content-type-options", "nosniff");
    if ((req.method === "GET" || req.method === "HEAD") && headerText(req.headers.accept).includes("text/html")) {
      delete req.headers["if-none-match"];
    }

    const origWriteHead = res.writeHead.bind(res) as (...a: unknown[]) => Res;
    const origWrite = res.write.bind(res) as (...a: unknown[]) => boolean;
    const origEnd = res.end.bind(res) as (...a: unknown[]) => Res;
    let mode: "undecided" | "html" | "pass" | "done" = "undecided";
    const chunks: Buffer[] = [];

    const decide = (): void => {
      if (mode !== "undecided") return;
      const type = headerText(res.getHeader("content-type")).toLowerCase();
      mode = type.includes("text/html") && !res.getHeader("content-encoding") ? "html" : "pass";
    };
    const toBuffer = (c: unknown, enc?: unknown): Buffer =>
      Buffer.isBuffer(c) ? c : typeof c === "string" ? Buffer.from(c, typeof enc === "string" ? (enc as BufferEncoding) : "utf8") : Buffer.from(c as Uint8Array);

    res.writeHead = ((status: number, ...rest: unknown[]) => {
      if (mode === "done") return origWriteHead(status, ...rest);
      const hdrs = rest.find((r) => r && typeof r === "object") as Record<string, number | string | string[]> | undefined;
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) res.setHeader(k, v);
      decide();
      if (mode === "html") {
        res.statusCode = status;
        return res;
      }
      return origWriteHead(status, ...rest);
    }) as typeof res.writeHead;

    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      decide();
      if (mode !== "html") return origWrite(chunk, ...rest);
      if (chunk != null) chunks.push(toBuffer(chunk, rest[0]));
      const cb = rest.find((r) => typeof r === "function") as (() => void) | undefined;
      cb?.();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      decide();
      if (mode !== "html") return origEnd(chunk, ...rest);
      mode = "done";
      if (chunk != null && typeof chunk !== "function") chunks.push(toBuffer(chunk, rest[0]));
      const nonce = newNonce();
      const body = Buffer.from(Buffer.concat(chunks).toString("utf8").split(CSP_NONCE_PLACEHOLDER).join(nonce), "utf8");
      const csp = o.csp(nonce);
      res.setHeader(csp.header, csp.value);
      for (const [k, v] of Object.entries(HTML_SECURITY_HEADERS)) res.setHeader(k, v);
      res.setHeader("cache-control", "no-store");
      res.removeHeader("etag");
      res.setHeader("content-length", body.length);
      return origEnd(req.method === "HEAD" ? undefined : body);
    }) as typeof res.end;

    next();
  };
}

export function mfSecurityHeaders({ root }: { root: string }): Plugin {
  let env: Record<string, string> = {};
  let pkg: Parameters<typeof needsWasm>[0] = {};
  return {
    name: "mf-security-headers",
    apply: applies,
    config(_, { mode }) {
      env = loadEnv(mode, root, ["VITE_", "MF_"]);
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      } catch {
        pkg = {};
      }
      return { html: { cspNonce: CSP_NONCE_PLACEHOLDER } };
    },
    configureServer(server) {
      const https = Boolean(server.config.server.https);
      const port = server.config.server.port ?? 5300;
      const resolved = resolveAppOrigin({ env: { ...env, ...process.env }, port, https });
      if (!resolved.ok) server.config.logger.error(`[csp] ${resolved.error}`);
      const appOrigin = resolved.ok ? resolved.origin : `${https ? "https" : "http"}://localhost:${port}`;
      const wasm = needsWasm(pkg);
      const reportOnly = cspModeOf(env) === "report-only";
      const blocksApiOrigin = env.VITE_BLOCKS_API_URL || DEFAULT_BLOCKS_API_URL;
      const hubUrl = env.VITE_MF_NOTIFIER_HUB_URL || null;
      // Added directly (not in a returned hook), so it runs before Vite's own middlewares.
      server.middlewares.use(
        createSecurityMiddleware({
          csp: (nonce) => buildCsp({ nonce, https, appOrigin, blocksApiOrigin, storageOrigins: STORAGE_ORIGINS, wasm, reportOnly, hubUrl }),
        }),
      );
    },
  };
}

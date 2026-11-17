import type { IncomingMessage, ServerResponse } from "node:http";
import { CSP_NONCE_PLACEHOLDER, HTML_SECURITY_HEADERS, newNonce, type CspResult } from "./csp.ts";

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

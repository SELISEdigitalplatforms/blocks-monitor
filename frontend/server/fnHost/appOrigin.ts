import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

type Env = Record<string, string | undefined>;

export type AppOrigin =
  | { ok: true; origin: string; host: string; hostname: string; secure: boolean }
  | { ok: false; error: string };

// The app's one origin: http://localhost:<port> by default, https only when the dev server serves https.
export function resolveAppOrigin(o: { env: Env; port: number; https: boolean }): AppOrigin {
  const scheme = o.https ? "https" : "http";
  const raw = (o.env.MF_APP_ORIGIN ?? "").trim();
  if (!raw) return { ok: true, origin: `${scheme}://localhost:${o.port}`, host: `localhost:${o.port}`, hostname: "localhost", secure: o.https };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `MF_APP_ORIGIN is not a valid URL (expected ${scheme}://localhost:${o.port})` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "MF_APP_ORIGIN must start with http:// or https://" };
  if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#") || (url.pathname !== "/" && url.pathname !== "")) {
    return { ok: false, error: "MF_APP_ORIGIN must be a bare origin without credentials, path, query or fragment" };
  }
  if (url.protocol !== `${scheme}:`) {
    return { ok: false, error: `MF_APP_ORIGIN protocol ${url.protocol.slice(0, -1)} does not match the server (${scheme}; https needs MF_DEV_HTTPS=1)` };
  }
  const urlPort = url.port || (url.protocol === "https:" ? "443" : "80");
  if (urlPort !== String(o.port)) return { ok: false, error: `MF_APP_ORIGIN port ${urlPort} does not match the server port ${o.port}` };
  return { ok: true, origin: url.origin, host: url.host, hostname: url.hostname, secure: o.https };
}

// https is optional: only with MF_DEV_HTTPS=1 and the certificate from `npm run cert`.
export function devHttpsOptions(o: { root: string; env: Env }): { key: Buffer; cert: Buffer } | undefined {
  if (o.env.MF_DEV_HTTPS !== "1") return undefined;
  const keyFile = path.join(o.root, ".cert", "dev-key.pem");
  const certFile = path.join(o.root, ".cert", "dev-cert.pem");
  try {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  } catch {
    throw new Error("MF_DEV_HTTPS=1 needs .cert/dev-key.pem and .cert/dev-cert.pem. Run `npm run cert` first, or unset MF_DEV_HTTPS to use http://localhost.");
  }
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

// 127.0.0.1 and [::1] on the app port are sent to the app origin (cookies and CSRF checks are per origin).
export function createLoopbackRedirect(o: { appOrigin: string }) {
  const app = new URL(o.appOrigin);
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const hostHeader = String(req.headers.host ?? "").toLowerCase();
    const url = req.url ?? "";
    const m = /^(\[::1\]|[^:/\[\]]+)(?::(\d+))?$/.exec(hostHeader);
    const port = m ? m[2] || (app.protocol === "https:" ? "443" : "80") : "";
    const appPort = app.port || (app.protocol === "https:" ? "443" : "80");
    const redirect =
      (req.method === "GET" || req.method === "HEAD") &&
      !!m &&
      LOOPBACK.has(m[1]) &&
      port === appPort &&
      hostHeader !== app.host.toLowerCase() &&
      url.startsWith("/") &&
      !url.startsWith("//") &&
      !url.startsWith("/\\");
    if (!redirect) return next();
    res.statusCode = 308;
    res.setHeader("location", o.appOrigin + url);
    res.setHeader("cache-control", "no-store");
    res.end();
  };
}

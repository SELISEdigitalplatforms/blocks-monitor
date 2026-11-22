// The Factory's texts in one language without a sign-in: GET /api/public/i18n/<culture> (every module) and
// GET /api/public/i18n/<culture>/<module> (one), for the language switch on every page, the landing page and the sign-in
// card included. The texts come from SELISE Blocks Localization (UILM, GetCloudUilmFile) read with the host's service
// identity; the answer is the dictionary only ({ ok, data: { culture, texts } }, keys "<module>.<name>"), never a token,
// an id or an upstream error. Limited per address like the other public routes; each module's dictionary is kept for
// five minutes (a failed read for half a minute), so a busy page costs UILM at most one read per module and language in
// that time. A module that cannot be read is left out (the app keeps its bundled texts for it); when none can be read
// the answer is 503 and the app keeps the bundled texts.
import type { IncomingMessage, ServerResponse } from "node:http";
import { I18N_MODULES, UILM_KEY, isAppCulture, isI18nModule, type AppCulture as Culture, type I18nModule } from "../../src/i18n/modules.ts";
import { createIpLimiter } from "./loginLimiter.ts";
import { SECURITY_HEADERS } from "./middleware.ts";

export const I18N_PER_MINUTE = 120;
export const I18N_WINDOW_MS = 60_000;
export const I18N_CACHE_MS = 5 * 60_000;
export const I18N_FAILURE_CACHE_MS = 30_000;
/** Bounds on what one module may bring (a runaway dictionary never reaches the browser whole). */
export const I18N_MAX_KEYS = 5000;
export const I18N_MAX_TEXT = 4000;

type Next = (err?: unknown) => void;

/** Reads one module's dictionary for one culture from UILM (flat: name → text). */
export type ReadModule = (module: I18nModule, culture: Culture) => Promise<Record<string, unknown>>;

export interface PublicI18nDeps {
  /** null: this host has no UILM (the local adapter): every answer is an empty dictionary. */
  read: ReadModule | null;
  now?(): number;
  log?(line: string): void;
  /** The app's host: a request for another host is a 404 (as the other public routes). */
  expectedHost?: string;
  perMinute?: number;
  cacheMs?: number;
  failureCacheMs?: number;
}

const json = (body: unknown) => JSON.stringify(body);

/** The module's texts with their module prefix: string values only, valid key names, bounded. */
export function prefixed(module: I18nModule, dict: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [name, value] of Object.entries(dict ?? {})) {
    if (n >= I18N_MAX_KEYS) break;
    if (typeof value !== "string" || !value.trim() || value.length > I18N_MAX_TEXT || !UILM_KEY.test(name)) continue;
    // a key pushed with its module prefix by mistake still lands on the same app key
    const key = name.startsWith(`${module}.`) ? name : `${module}.${name}`;
    out[key] = value;
    n++;
  }
  return out;
}

export function createPublicI18nHandler(deps: PublicI18nDeps) {
  const now = deps.now ?? Date.now;
  const limiter = createIpLimiter({ limit: deps.perMinute ?? I18N_PER_MINUTE, windowMs: I18N_WINDOW_MS, now });
  const cacheMs = deps.cacheMs ?? I18N_CACHE_MS;
  const failureMs = deps.failureCacheMs ?? I18N_FAILURE_CACHE_MS;
  const cache = new Map<string, { at: number; texts: Record<string, string> | null }>();
  const inflight = new Map<string, Promise<Record<string, string> | null>>();

  /** One module in one culture: cached, one read at a time (callers arriving meanwhile share it); null = unreadable. */
  function moduleTexts(module: I18nModule, culture: Culture): Promise<Record<string, string> | null> {
    const id = `${culture}|${module}`;
    const t = now();
    const hit = cache.get(id);
    if (hit && t - hit.at < (hit.texts ? cacheMs : failureMs)) return Promise.resolve(hit.texts);
    let pending = inflight.get(id);
    if (!pending) {
      const read = deps.read;
      pending = (read ? read(module, culture).then((d) => prefixed(module, d)) : Promise.resolve({}))
        .catch(() => null)
        .then((texts) => {
          cache.set(id, { at: now(), texts });
          return texts;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    return pending;
  }

  return async function publicI18n(req: IncomingMessage, res: ServerResponse, _next?: Next): Promise<void> {
    const started = now();
    const send = (status: number, body: string, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(req.method === "HEAD" ? "" : body);
      try {
        deps.log?.(`[i18n] ${status} ${Math.max(0, now() - started)}ms`);
      } catch {
        /* a log failure must not break the request */
      }
    };
    const notFound = () => send(404, json({ ok: false, error: { code: "not_found" } }));
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(405, json({ ok: false, error: { code: "invalid_input" } }), { allow: "GET, HEAD" });
      }
      const verdict = limiter.take(req.socket?.remoteAddress ?? "-");
      if (!verdict.ok) return send(429, json({ ok: false, error: { code: "rate_limited" } }), { "retry-after": String(verdict.retryAfterS) });
      if (deps.expectedHost !== undefined) {
        const h = req.headers.host ?? req.headers[":authority"];
        if ((Array.isArray(h) ? h[0] : h) !== deps.expectedHost) return notFound();
      }
      // Mounted at /api/public/i18n: "/<culture>" or "/<culture>/<module>" (a query is ignored).
      const parts = (req.url ?? "/").split("?")[0].split("#")[0].split("/").filter(Boolean);
      if (parts.length < 1 || parts.length > 2) return notFound();
      const culture = decodeURIComponent(parts[0]);
      if (!isAppCulture(culture)) return notFound();
      if (parts.length === 2 && !isI18nModule(parts[1])) return notFound();
      const modules: readonly I18nModule[] = parts.length === 2 ? [parts[1] as I18nModule] : I18N_MODULES;
      const answers = await Promise.all(modules.map((m) => moduleTexts(m, culture)));
      if (answers.every((a) => a === null)) return send(503, json({ ok: false, error: { code: "unavailable" } }), { "retry-after": "30" });
      const texts: Record<string, string> = Object.assign({}, ...answers.filter(Boolean));
      return send(200, json({ ok: true, data: { culture, texts } }), {
        "cache-control": `public, max-age=${Math.round(cacheMs / 1000)}`,
      });
    } catch {
      return send(503, json({ ok: false, error: { code: "unavailable" } }));
    }
  };
}

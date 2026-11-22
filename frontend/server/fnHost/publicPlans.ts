// The plan catalogue without a sign-in: GET /api/public/plans, for the pricing page (the landing page's Pricing section
// and /pricing). No session, no cookies read, no arguments. The same answer as the billing.plans.public op
// (functions/billing/ops/plansPublic.ts): the active plans with their public fields only. Limited per address like the
// other public route (server/fnHost/publicShare.ts); the answer is kept for a minute, so a busy landing page costs the
// data gateway at most one read pair a minute. Any failure is a 503: the page then says the plans couldn't be loaded and
// offers to try again (it has no plans or prices of its own).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RawGateway } from "../../functions/_lib/gateway";
import { readPublicPlans } from "../../functions/billing/ops/plansPublic";
import type { UtilitiesAccess } from "../../src/domain/blocksUtilities";
import { createIpLimiter } from "./loginLimiter";
import { SECURITY_HEADERS } from "./middleware";

export const PLANS_PER_MINUTE = 60;
export const PLANS_WINDOW_MS = 60_000;
export const PLANS_CACHE_MS = 60_000;

type Next = (err?: unknown) => void;

export interface PublicPlansDeps {
  raw: Pick<RawGateway, "findAll">;
  /** Blocks Utilities on the service identity (the catalogue when billing.source is "blocks-utilities"). */
  utilities?: UtilitiesAccess | null;
  now?(): number;
  log?(line: string): void;
  /** The app's host: a request for another host is a 404 (as the share route). */
  expectedHost?: string;
  perMinute?: number;
  cacheMs?: number;
}

const json = (body: unknown) => JSON.stringify(body);

export function createPublicPlansHandler(deps: PublicPlansDeps) {
  const now = deps.now ?? Date.now;
  const limiter = createIpLimiter({ limit: deps.perMinute ?? PLANS_PER_MINUTE, windowMs: PLANS_WINDOW_MS, now });
  const cacheMs = deps.cacheMs ?? PLANS_CACHE_MS;
  let cached: { at: number; body: string } | null = null;
  let inflight: Promise<string> | null = null;

  /** One read at a time; callers that arrive while it runs share it. */
  function load(): Promise<string> {
    const t = now();
    if (cached && t - cached.at < cacheMs) return Promise.resolve(cached.body);
    if (!inflight) {
      inflight = readPublicPlans(deps.raw, deps.utilities ?? null)
        .then((plans) => {
          const body = json({ ok: true, data: { plans } });
          cached = { at: now(), body };
          return body;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  return async function publicPlans(req: IncomingMessage, res: ServerResponse, _next?: Next): Promise<void> {
    const started = now();
    const send = (status: number, body: string, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(req.method === "HEAD" ? "" : body);
      try {
        deps.log?.(`[plans] ${status} ${Math.max(0, now() - started)}ms`);
      } catch {
        /* a log failure must not break the request */
      }
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(405, json({ ok: false, error: { code: "invalid_input" } }), { allow: "GET, HEAD" });
      }
      const verdict = limiter.take(req.socket?.remoteAddress ?? "-");
      if (!verdict.ok) return send(429, json({ ok: false, error: { code: "rate_limited" } }), { "retry-after": String(verdict.retryAfterS) });
      if (deps.expectedHost !== undefined) {
        const h = req.headers.host ?? req.headers[":authority"];
        if ((Array.isArray(h) ? h[0] : h) !== deps.expectedHost) return send(404, json({ ok: false, error: { code: "not_found" } }));
      }
      // Mounted at /api/public/plans: only the route itself (a query is ignored), nothing below it.
      const path = (req.url ?? "/").split("?")[0].split("#")[0];
      if (path !== "/" && path !== "") return send(404, json({ ok: false, error: { code: "not_found" } }));
      return send(200, await load());
    } catch {
      return send(503, json({ ok: false, error: { code: "unavailable" } }));
    }
  };
}

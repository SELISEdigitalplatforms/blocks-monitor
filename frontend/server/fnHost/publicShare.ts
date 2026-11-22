// Host A's one public endpoint: GET /api/public/share/<token>. No session, no cookies, no same-origin rules.
// The token is hashed (SHA-256) and looked up by hash; only the shared item's display data is answered.
// Every miss (unknown, malformed, expired, revoked, item gone, wrong host) is the same 404, byte for byte.
// The local host builds the handler in the functions' module graph (server/local/backend.ts) with the local gateway.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RawGateway } from "../../functions/_lib/gateway";
import { f } from "../../functions/_lib/filter";
import type { FilesService } from "../../functions/_lib/storage";
import {
  SHARE_LINK_FIELDS,
  SHARE_LINK_SCHEMA,
  SHARE_LINK_URL_TTL_SECONDS,
  TOKEN_PATTERN,
  hashShareToken,
  isLive,
  isPassiveMime,
  sameHash,
  type PublicShareAnswer,
} from "../../functions/project/ops/shareLinks/contract";
import { publicItemOf, readSharedItem } from "../../functions/project/ops/shareLinks/items";
import { SECURITY_HEADERS } from "./middleware";

export const SHARE_PER_MINUTE = 30;
export const SHARE_WINDOW_MS = 60_000;
export const SHARE_MAX_KEYS = 10_000;
const FALLBACK_NAME = "A MADP Factory member";
const DUMMY_HASH = "0".repeat(64);
const NOT_FOUND = JSON.stringify({ ok: false, error: { code: "not_found" } });

type Next = (err?: unknown) => void;
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface PublicShareDeps {
  raw: Pick<RawGateway, "find" | "update">;
  files: Pick<FilesService, "downloadUrl" | "info">;
  now?(): number;
  log?(line: string): void;
  expectedHost?: string;
  perMinute?: number;
}

export function createPublicShareHandler(deps: PublicShareDeps) {
  const now = deps.now ?? Date.now;
  const limit = deps.perMinute ?? SHARE_PER_MINUTE;
  const hits = new Map<string, number[]>();

  function rateLimited(ip: string): boolean {
    const t = now();
    const list = (hits.get(ip) ?? []).filter((x) => x > t - SHARE_WINDOW_MS);
    const blocked = list.length >= limit;
    // Every request counts, also a refused one, so a flood stays refused while it lasts.
    list.push(t);
    if (list.length > limit * 2) list.splice(0, list.length - limit * 2);
    hits.delete(ip);
    hits.set(ip, list);
    if (hits.size > SHARE_MAX_KEYS) {
      for (const [k, v] of hits) if (!v.some((x) => x > t - SHARE_WINDOW_MS)) hits.delete(k);
      while (hits.size > SHARE_MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    }
    return blocked;
  }

  return async function publicShare(req: IncomingMessage, res: ServerResponse, _next?: Next): Promise<void> {
    const started = now();
    const send = (status: number, body: string, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      res.setHeader("x-robots-tag", "noindex, nofollow");
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(req.method === "HEAD" ? "" : body);
      try {
        deps.log?.(`[share] ${status} ${Math.max(0, now() - started)}ms`);
      } catch {
        /* a log failure must not break the request */
      }
    };
    const notFound = () => send(404, NOT_FOUND);
    const warn = (what: string) => {
      try {
        deps.log?.(`[share] warn ${what}`);
      } catch {
        /* ignore */
      }
    };

    try {
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, JSON.stringify({ ok: false, error: { code: "invalid_input" } }), { allow: "GET, HEAD" });
      if (rateLimited(req.socket?.remoteAddress ?? "-")) {
        return send(429, JSON.stringify({ ok: false, error: { code: "rate_limited" } }), { "retry-after": "60" });
      }
      if (deps.expectedHost !== undefined) {
        const h = req.headers.host ?? req.headers[":authority"];
        if ((Array.isArray(h) ? h[0] : h) !== deps.expectedHost) return notFound();
      }
      const path = (req.url ?? "").split("?")[0].split("#")[0];
      const m = /^\/([^/]*)$/.exec(path);
      const token = m ? m[1] : "";
      // Always hashed, also a wrong format, so every miss costs the same.
      const hash = hashShareToken(token);
      if (!m || !TOKEN_PATTERN.test(token)) return notFound();

      // Round 1.
      const found = await deps.raw.find(SHARE_LINK_SCHEMA, { where: f.eq("TokenHash", hash), fields: SHARE_LINK_FIELDS, page: 1, pageSize: 1 });
      const row = found.items[0];
      if (!row) {
        sameHash(DUMMY_HASH, hash);
        return notFound();
      }
      const t = now();
      if (!sameHash(str(row.TokenHash), hash) || !isLive(row, new Date(t))) return notFound();
      const projectId = str(row.ProjectId);
      const workspaceId = str(row.WorkspaceId);

      // Round 2.
      const [shared, project, account] = await Promise.all([
        readSharedItem(deps.raw as RawGateway, { itemType: str(row.ItemType), itemRef: str(row.ItemRef), projectId, workspaceId } as never),
        deps.raw.find("Project", { where: f.eq("ItemId", projectId), fields: ["ItemId", "WorkspaceId", "Status"], page: 1, pageSize: 1 }),
        deps.raw.find("Account", { where: f.eq("UserId", str(row.CreatedByUserId)), fields: ["ItemId", "DisplayName"], page: 1, pageSize: 1 }),
      ]);
      const proj = project.items[0];
      if (!shared || !proj || str(proj.Status) === "deleting" || str(proj.WorkspaceId) !== workspaceId) return notFound();
      const made = publicItemOf(str(row.ItemType) as never, shared as never);
      if (!made) return notFound();
      const draft = made.item as unknown as Rec;
      const sharedByName = str(account.items[0]?.DisplayName).trim() || FALLBACK_NAME;

      // Round 3.
      const nowIso = new Date(t).toISOString();
      const bump = deps.raw
        .update(SHARE_LINK_SCHEMA, str(row.ItemId), { ViewCount: (Number(row.ViewCount) || 0) + 1, LastViewedAt: nowIso })
        .catch(() => warn("view count not updated"));
      let item: Rec = draft;
      if (made.fileId) {
        const d = rec(draft.file);
        const [dl, info] = await Promise.all([
          deps.files.downloadUrl(made.fileId),
          str(d.mime) && Number.isFinite(Number(d.sizeBytes)) && d.sizeBytes !== undefined ? Promise.resolve(null) : deps.files.info(made.fileId),
          bump,
        ]);
        const mime = str(d.mime) || str(info?.mime);
        const cap = t + SHARE_LINK_URL_TTL_SECONDS * 1000;
        const storageExp = dl.expiresAt ? Date.parse(dl.expiresAt) : NaN;
        const expMs = Number.isFinite(storageExp) ? Math.min(storageExp, cap) : cap;
        item = {
          ...draft,
          file: {
            name: str(d.name) || str(info?.name),
            mime,
            sizeBytes: d.sizeBytes !== undefined ? Number(d.sizeBytes) || 0 : (info?.sizeBytes ?? 0),
            url: dl.url,
            urlExpiresAt: new Date(expMs).toISOString(),
            inline: isPassiveMime(mime),
          },
        };
      } else {
        await bump;
      }
      const answer = { ok: true, data: { sharedByName, expiresAt: str(row.ExpiresAt), item } } as unknown as PublicShareAnswer;
      return send(200, JSON.stringify(answer));
    } catch {
      return send(503, JSON.stringify({ ok: false, error: { code: "unavailable" } }));
    }
  };
}

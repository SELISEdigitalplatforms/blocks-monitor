import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { checkBranch, checkNewRepo } from "../../src/domain/projectType.ts";
import type { GithubCredentialStore } from "./githubStore.ts";
import { createIpLimiter } from "../fnHost/loginLimiter.ts";
import { readBody, SECURITY_HEADERS } from "../fnHost/middleware.ts";
import { CSP_NONCE_PLACEHOLDER } from "../security/csp.ts";
import { OpError } from "../../functions/_lib/errors.ts";

type Identity = { userId: string; sid: string };
export interface GithubRepositorySelection { owner: string; name: string; branch: string; kind: "existing" | "new"; visibility?: string; allowEmpty?: boolean }
export class GithubFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const disconnected = { connected: false, login: null, connectedAt: null };

export function createGithubIntegration(o: {
  origin: string; clientId: string; clientSecret: string; store: GithubCredentialStore;
  identity(req: IncomingMessage, res: ServerResponse): Promise<Identity | null>;
  fetch?: typeof fetch; now?: () => number;
}) {
  const fetcher = o.fetch ?? globalThis.fetch;
  const now = o.now ?? Date.now;
  const origin = new URL(o.origin);
  const redirectUri = `${origin.origin}/api/github/callback`;
  const pending = new Map<string, { userId: string; sid: string; expires: number }>();
  const limit = createIpLimiter({ limit: 120, windowMs: 60_000 });
  async function github(path: string, token: string, method = "GET", body?: unknown) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "MADP-Factory" },
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!response.ok) throw new GithubFailure([401, 403, 404, 422].includes(response.status) ? response.status : 502, response.status === 401 ? "github_reauthorization_required" : "github_access_unavailable");
    return response.json() as Promise<unknown>;
  }
  async function credential(userId: string) {
    const saved = await o.store.get(userId);
    if (!saved) throw new GithubFailure(409, "github_not_connected");
    return saved;
  }
  function send(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    res.setHeader("referrer-policy", "no-referrer");
    res.end(JSON.stringify(body));
  }
  function callbackPage(res: ServerResponse, success: boolean) {
    res.statusCode = success ? 200 : 400;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.end(`<!doctype html><html><head><title>GitHub connection</title></head><body><p>${success ? "GitHub connected. You can close this window and return to MADP Factory." : "GitHub could not be connected. Close this window and try again from MADP Factory."}</p>${success ? `<script nonce="${CSP_NONCE_PLACEHOLDER}">window.close();</script>` : ""}</body></html>`);
  }
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || "/", origin);
    if (!url.pathname.startsWith("/api/github/")) return next();
    void (async () => {
      const callback = url.pathname === "/api/github/callback";
      const host = String(req.headers[":authority"] ?? req.headers.host ?? "");
      if (host !== origin.host) return send(res, 403, { error: "forbidden" });
      if (!callback && req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return send(res, 403, { error: "forbidden" });
      if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      if (req.method === "POST" && (req.headers.origin !== origin.origin || !String(req.headers["content-type"] ?? "").startsWith("application/json"))) return send(res, 403, { error: "forbidden" });
      if (!limit.take(req.socket?.remoteAddress ?? "").ok) return send(res, 429, { error: "rate_limited" });
      const identity = await o.identity(req, res);
      if (!identity) return send(res, 401, { error: "unauthenticated" });
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        const raw = await readBody(req, 4096, 5_000);
        if (typeof raw === "string") return send(res, 413, { error: "invalid_input" });
        try { body = rec(JSON.parse(raw.toString("utf8"))); } catch { return send(res, 400, { error: "invalid_input" }); }
        if (body.userId !== undefined && body.userId !== identity.userId) return send(res, 403, { error: "forbidden" });
      }
      if (callback && req.method === "GET") {
        const state = url.searchParams.get("state") ?? "";
        const attempt = pending.get(state);
        // Reject without consuming another session's attempt. Consume our own
        // attempt before exchanging the one-time code, including provider denial.
        if (!attempt || attempt.expires <= now() || attempt.userId !== identity.userId || attempt.sid !== identity.sid) return callbackPage(res, false);
        pending.delete(state);
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.has("error")) return callbackPage(res, false);
        try {
          const response = await fetcher("https://github.com/login/oauth/access_token", {
            method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code, redirect_uri: redirectUri }),
            signal: AbortSignal.timeout(15_000), redirect: "error",
          });
          if (!response.ok) throw new Error();
          const tokens = rec(await response.json());
          if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.error) throw new Error();
          const profile = rec(await github("/user", tokens.access_token));
          if (typeof profile.login !== "string" || !profile.login) throw new Error();
          await o.store.save(identity.userId, { token: tokens.access_token, login: profile.login, connectedAt: new Date(now()).toISOString() });
          return callbackPage(res, true);
        } catch { return callbackPage(res, false); }
      }
      if (url.pathname === "/api/github/connect" && req.method === "POST") {
        if (!o.clientId || !o.clientSecret) return send(res, 503, { error: "github_not_configured" });
        for (const [state, value] of pending) if (value.expires <= now() || value.userId === identity.userId) pending.delete(state);
        if (pending.size >= 1000) return send(res, 429, { error: "rate_limited" });
        const state = randomBytes(32).toString("hex");
        pending.set(state, { ...identity, expires: now() + 10 * 60_000 });
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.search = new URLSearchParams({ client_id: o.clientId, redirect_uri: redirectUri, scope: "repo read:user", state }).toString();
        return send(res, 200, { url: authorize.toString() });
      }
      const match = /^\/api\/github\/(status|disconnect|repos|branches)\/([^/]+)(?:\/([^/]+)\/([^/]+))?$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: "not_found" });
      if (decodeURIComponent(match[2]) !== identity.userId && match[2] !== "_probe") return send(res, 403, { error: "forbidden" });
      const action = match[1];
      if ((action === "disconnect" ? "POST" : "GET") !== req.method) return send(res, 405, { error: "method_not_allowed" });
      if (action === "disconnect") {
        for (const [state, attempt] of pending) if (attempt.userId === identity.userId) pending.delete(state);
        await o.store.disconnect(identity.userId);
        return send(res, 200, disconnected);
      }
      const saved = await o.store.get(identity.userId);
      if (action === "status") {
        if (!saved) return send(res, 200, disconnected);
        try { await github("/user", saved.token); }
        catch (error) {
          if (error instanceof GithubFailure && error.status === 401) { await o.store.disconnect(identity.userId); return send(res, 200, disconnected); }
          throw error;
        }
        return send(res, 200, { connected: true, login: saved.login, connectedAt: saved.connectedAt });
      }
      if (!saved) return send(res, 409, { error: "github_not_connected" });
      if (action === "repos") {
        const repos = await github("/user/repos?sort=updated&per_page=100&type=all", saved.token);
        if (!Array.isArray(repos)) throw new Error();
        return send(res, 200, { repos: repos.map((value) => {
          const row = rec(value);
          return { owner: rec(row.owner).login, name: row.name, fullName: row.full_name, private: row.private,
            defaultBranch: row.default_branch, updatedAt: row.pushed_at || row.updated_at, description: row.description || "" };
        }) });
      }
      if (action === "branches" && match[3] && match[4]) {
        const owner = encodeURIComponent(decodeURIComponent(match[3]));
        const name = encodeURIComponent(decodeURIComponent(match[4]));
        const [values, repo] = await Promise.all([github(`/repos/${owner}/${name}/branches?per_page=100`, saved.token), github(`/repos/${owner}/${name}`, saved.token)]);
        if (!Array.isArray(values)) throw new Error();
        return send(res, 200, { branches: values.map((value) => ({ name: rec(value).name, isDefault: rec(value).name === rec(repo).default_branch })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) });
      }
      return send(res, 404, { error: "not_found" });
    })().catch((error: unknown) => send(res, error instanceof GithubFailure ? error.status : 503, { error: error instanceof GithubFailure ? error.code : "github_unavailable" }));
  };
  return {
    handle,
    async verifyRepository(userId: string, repo: GithubRepositorySelection, requestKey?: string) {
      try {
        const saved = await credential(userId);
        if (repo.kind === "new") {
          if (repo.owner.toLowerCase() !== saved.login.toLowerCase()) throw new OpError("forbidden");
          if (!requestKey || !checkNewRepo(repo.owner, repo.name, repo.visibility ?? "").ok || !checkBranch(repo.branch).ok) throw new OpError("invalid_input");
          // Personal-account repositories cannot have GitHub Enterprise's internal visibility.
          if (repo.visibility !== "private") throw new OpError("invalid_input", "project.repoVisibilityInvalid");
          const marker = `MADP project ${createHmac("sha256", o.clientSecret).update(`${userId}:${requestKey}`).digest("hex")}`;
          const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
          let found: Record<string, unknown> | null = null;
          try { found = rec(await github(path, saved.token)); }
          catch (error) { if (!(error instanceof GithubFailure && error.status === 404)) throw error; }
          if (!found) {
            try {
              found = rec(await github("/user/repos", saved.token, "POST", { name: repo.name, private: true, auto_init: true, description: marker }));
            } catch (error) {
              // A retry can follow a successful creation whose response was lost. Never adopt
              // a name collision unless it carries this operation's unforgeable recovery marker.
              if (!(error instanceof GithubFailure && error.status === 422)) throw error;
              found = rec(await github(path, saved.token));
            }
          }
          if (found.description !== marker || found.private !== true) throw new OpError("conflict", "project.repoNameTaken");
          const defaultBranch = typeof found.default_branch === "string" ? found.default_branch : "";
          if (!defaultBranch) throw new OpError("unavailable");
          if (defaultBranch !== repo.branch) {
            const base = rec(await github(`${path}/branches/${encodeURIComponent(defaultBranch)}`, saved.token));
            const sha = rec(base.commit).sha;
            if (typeof sha !== "string" || !sha) throw new OpError("unavailable");
            try { await github(`${path}/git/refs`, saved.token, "POST", { ref: `refs/heads/${repo.branch}`, sha }); }
            catch (error) {
              if (!(error instanceof GithubFailure && error.status === 422)) throw error;
              await github(`${path}/branches/${encodeURIComponent(repo.branch)}`, saved.token);
            }
            await github(path, saved.token, "PATCH", { default_branch: repo.branch });
          }
        } else {
          await github(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, saved.token);
          const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
          try { await github(`${path}/branches/${encodeURIComponent(repo.branch)}`, saved.token); }
          catch (error) {
            if (!(repo.allowEmpty && error instanceof GithubFailure && error.status === 404)) throw error;
            const branches = await github(`${path}/branches?per_page=1`, saved.token);
            // A new product can start in an empty prepared repository. Its first
            // build creates the selected branch; a typo in a populated repo fails.
            if (!Array.isArray(branches) || branches.length !== 0) throw error;
          }
        }
      } catch (error) {
        if (error instanceof OpError) throw error;
        throw new OpError(error instanceof GithubFailure && (error.status === 403 || error.status === 409) ? "forbidden" : "unavailable");
      }
    },
  };
}

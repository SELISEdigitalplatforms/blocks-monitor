/**
 * GitHub OAuth backend — handles the OAuth flow and GitHub API calls.
 *
 * Flow:
 *   1. Frontend calls POST /api/github/connect → backend returns GitHub authorize URL
 *   2. User logs in on GitHub → GitHub redirects to /api/github/callback with code
 *   3. Backend exchanges code for access token, stores it per user
 *   4. Frontend calls GET /api/github/repos → backend fetches from GitHub API
 *
 * Env vars (in .env.local):
 *   GITHUB_CLIENT_ID     — from GitHub OAuth App settings
 *   GITHUB_CLIENT_SECRET  — from GitHub OAuth App settings
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const FRONTEND_ROOT = resolve(import.meta.dirname, "..", "..");
const DATA_DIR = join(FRONTEND_ROOT, "data");

// Load .env.local into process.env (server-side — Vite only loads VITE_* for the browser)
const envLocalPath = join(FRONTEND_ROOT, ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
const GITHUB_API = "https://api.github.com";
const GITHUB_AUTH = "https://github.com/login/oauth";

// ── DB ───────────────────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;
function db(): DatabaseSync {
  if (!_db) {
    mkdirSync(DATA_DIR, { recursive: true });
    _db = new DatabaseSync(join(DATA_DIR, "engine.db"));
    _db.exec(`
      CREATE TABLE IF NOT EXISTS GithubConnection (
        userId TEXT PRIMARY KEY,
        accessToken TEXT NOT NULL,
        login TEXT NOT NULL,
        connectedAt TEXT NOT NULL
      )
    `);
  }
  return _db;
}

// ── GitHub API helpers ───────────────────────────────────────────────────────

async function githubFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MADP-Factory/1.0",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

function clientId(): string {
  return process.env.GITHUB_CLIENT_ID || "";
}

function clientSecret(): string {
  return process.env.GITHUB_CLIENT_SECRET || "";
}

/** The callback URL — uses MF_APP_ORIGIN when set, otherwise localhost. */
function callbackUrl(_req?: IncomingMessage): string {
  if (process.env.MF_APP_ORIGIN) {
    return `${process.env.MF_APP_ORIGIN}/api/github/callback`;
  }
  const port = process.env.FACTORY_PORT || "5310";
  return `http://localhost:${port}/api/github/callback`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export const githubRoutes: { method: string; pattern: RegExp; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler): void {
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
  githubRoutes.push({ method: method.toUpperCase(), pattern, handler });
}

// ── POST /api/github/connect — start OAuth flow ─────────────────────────────

route("POST", "/api/github/connect", async (req, res) => {
  const body = JSON.parse(await readBody(req) || "{}");
  const userId = body.userId as string;
  if (!userId) return json(res, { error: "userId required" }, 400);

  const cid = clientId();
  if (!cid) {
    return json(res, { error: "GITHUB_CLIENT_ID not configured. Set it in .env.local" }, 500);
  }

  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
  const url = `${GITHUB_AUTH}/authorize?client_id=${cid}&redirect_uri=${encodeURIComponent(callbackUrl(req))}&scope=repo,read:user&state=${state}`;

  json(res, { url, state });
});

// ── GET /api/github/callback — OAuth callback ───────────────────────────────

route("GET", "/api/github/callback", async (req, res) => {
  const url = new URL(req.url || "", `http://localhost:${process.env.FACTORY_PORT || "5310"}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>Missing code or state. Close this window and try again.</h2>");
    return;
  }

  // Decode state to get userId
  let userId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    userId = parsed.userId;
  } catch {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>Invalid state. Close this window and try again.</h2>");
    return;
  }

  // Exchange code for access token
  const tokenRes = await fetch(`${GITHUB_AUTH}/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: callbackUrl(req),
    }),
  });

  const tokenData = await tokenRes.json() as Record<string, unknown>;
  const accessToken = tokenData.access_token as string;

  if (!accessToken) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>GitHub auth failed: ${tokenData.error_description || tokenData.error || "unknown"}</h2>`);
    return;
  }

  // Get the user's GitHub login
  const user = await githubFetch("/user", accessToken) as { login: string };
  const login = user.login;
  const connectedAt = new Date().toISOString();

  // Store the connection
  db().prepare(`
    INSERT OR REPLACE INTO GithubConnection (userId, accessToken, login, connectedAt)
    VALUES (?, ?, ?, ?)
  `).run(userId, accessToken, login, connectedAt);

  // Redirect back to the app origin
  const redirectOrigin = process.env.MF_APP_ORIGIN || `http://localhost:${process.env.FACTORY_PORT || "5310"}`;
  res.writeHead(302, {
    Location: `${redirectOrigin}/dashboard?github=connected`,
  });
  res.end();
});

// ── GET /api/github/status/:userId — connection status ───────────────────────

route("GET", "/api/github/status/:userId", (_req, res, p) => {
  const row = db().prepare("SELECT login, connectedAt FROM GithubConnection WHERE userId = ?").get(p.userId) as
    { login: string; connectedAt: string } | undefined;

  if (!row) return json(res, { connected: false, login: null, connectedAt: null });
  json(res, { connected: true, login: row.login, connectedAt: row.connectedAt });
});

// ── POST /api/github/disconnect/:userId — remove connection ──────────────────

route("POST", "/api/github/disconnect/:userId", (_req, res, p) => {
  db().prepare("DELETE FROM GithubConnection WHERE userId = ?").run(p.userId);
  json(res, { connected: false, login: null, connectedAt: null });
});

// ── GET /api/github/repos/:userId — list repos ──────────────────────────────

route("GET", "/api/github/repos/:userId", async (_req, res, p) => {
  const row = db().prepare("SELECT accessToken, login FROM GithubConnection WHERE userId = ?").get(p.userId) as
    { accessToken: string; login: string } | undefined;

  if (!row) return json(res, { error: "not_connected" }, 401);

  try {
    const repos = await githubFetch("/user/repos?sort=updated&per_page=50&type=all", row.accessToken) as any[];
    json(res, {
      repos: repos.map(r => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        description: r.description || "",
      })),
    });
  } catch (e: any) {
    json(res, { error: e.message }, 502);
  }
});

// ── GET /api/github/branches/:userId/:owner/:name — list branches ────────────

route("GET", "/api/github/branches/:userId/:owner/:name", async (_req, res, p) => {
  const row = db().prepare("SELECT accessToken FROM GithubConnection WHERE userId = ?").get(p.userId) as
    { accessToken: string } | undefined;

  if (!row) return json(res, { error: "not_connected" }, 401);

  try {
    const [branches, repo] = await Promise.all([
      githubFetch(`/repos/${p.owner}/${p.name}/branches?per_page=100`, row.accessToken) as Promise<any[]>,
      githubFetch(`/repos/${p.owner}/${p.name}`, row.accessToken) as Promise<any>,
    ]);
    const defaultBranch = repo.default_branch;
    json(res, {
      branches: branches.map(b => ({
        name: b.name,
        isDefault: b.name === defaultBranch,
      })).sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)),
    });
  } catch (e: any) {
    json(res, { error: e.message }, 502);
  }
});

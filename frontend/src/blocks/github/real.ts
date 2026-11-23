/**
 * Real GitHub connection — talks to the backend API which handles OAuth and GitHub API calls.
 *
 * Replaces the preview placeholder (./preview.ts) when GITHUB_CLIENT_ID is configured.
 * The backend stores the access token; the frontend never sees it.
 */
import type { GithubBranch, GithubConnection, GithubRepo, GithubSource } from "./types";

const API = "/api/github";
const DISCONNECTED: GithubConnection = { connected: false, login: null, connectedAt: null };

/** Get the access token: OIDC session first, then genesis-os shell store. */
function getToken(): string | undefined {
  // OIDC session token (from Blocks IAM login)
  try {
    const raw = sessionStorage.getItem("madp-oidc-session-v1");
    if (raw) {
      const data = JSON.parse(raw) as { accessToken?: string; expiresAtMs?: number };
      if (data.accessToken && data.expiresAtMs && data.expiresAtMs > Date.now()) return data.accessToken;
    }
  } catch { /* ignore */ }
  // Genesis-os shell token
  try {
    const store = (window as unknown as Record<string, unknown>).__GENESIS_AUTH_STORE__;
    if (store && typeof store === "object" && "getState" in store) {
      return (store as { getState: () => Record<string, unknown> }).getState().accessToken as string | undefined;
    }
  } catch { /* ignore */ }
  return undefined;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    headers,
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const realGithub: GithubSource = {
  preview: false,
  manageAccessUrl: "https://github.com/settings/installations",

  async status(viewer): Promise<GithubConnection> {
    return api<GithubConnection>(`/status/${viewer.userId}`);
  },

  async connect(viewer): Promise<GithubConnection> {
    // Open synchronously during the click, before the backend await, to avoid popup blockers.
    const popup = window.open("about:blank", "github-oauth", "width=600,height=700,popup=yes");
    if (!popup) throw new Error("Allow popups to connect GitHub, then try again.");
    try {
      const { url } = await api<{ url: string }>("/connect", { method: "POST", body: JSON.stringify({ userId: viewer.userId }) });
      const target = new URL(url);
      if (target.origin !== "https://github.com" || target.pathname !== "/login/oauth/authorize") throw new Error("Invalid GitHub authorization URL.");
      popup.location.href = url;
    } catch (error) { popup.close(); throw error; }
    // COOP can sever the popup handle during GitHub navigation. Its .closed
    // property is not proof that consent finished; poll the authenticated backend.
    return new Promise<GithubConnection>((resolve, reject) => {
      let busy = false;
      const finish = (result?: GithubConnection, error?: unknown) => {
        window.clearInterval(interval); window.clearTimeout(timeout);
        try { popup.close(); } catch { /* cross-origin/COOP handle */ }
        if (error) reject(error); else resolve(result ?? DISCONNECTED);
      };
      const interval = window.setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const status = await api<GithubConnection>(`/status/${encodeURIComponent(viewer.userId)}`);
          if (status.connected) finish(status);
        } catch (error) { finish(undefined, error); }
        finally { busy = false; }
      }, 1500);
      const timeout = window.setTimeout(() => finish(DISCONNECTED), 5 * 60 * 1000);
    });
  },

  async disconnect(viewer): Promise<GithubConnection> {
    return api<GithubConnection>(`/disconnect/${viewer.userId}`, { method: "POST" });
  },

  async repos(viewer): Promise<GithubRepo[]> {
    const { repos } = await api<{ repos: GithubRepo[] }>(`/repos/${viewer.userId}`);
    return repos;
  },

  async branches(viewer, owner, name): Promise<GithubBranch[]> {
    const { branches } = await api<{ branches: GithubBranch[] }>(`/branches/${viewer.userId}/${owner}/${name}`);
    return branches;
  },
};

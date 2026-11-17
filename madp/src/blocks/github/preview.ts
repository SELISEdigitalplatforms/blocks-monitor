/**
 * ─── PLACEHOLDER ───────────────────────────────────────────────────────────────────────────────────────────────────
 * The PREVIEW GitHub connection: a click-through stand-in until the real GitHub App backend exists. It talks to no
 * GitHub at all. Connecting just succeeds after a short pause and is remembered per signed-in person in this browser
 * (localStorage when it works, memory otherwise); the login comes from the person's name; the repositories and
 * branches are invented below. ALL fake data lives in this one file.
 *
 * To go live: implement GithubSource (./types.ts) against the backend's GitHub App endpoints, point `github` in
 * ./index.ts at it, and delete this file. The screens and hooks stay as they are.
 * ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import type { GithubBranch, GithubConnection, GithubRepo, GithubSource, GithubViewer } from "./types";

const KEY = "madp-factory-github-preview-v1:";
const memory = new Map<string, { login: string; connectedAt: string }>();
const DISCONNECTED: GithubConnection = { connected: false, login: null, connectedAt: null };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function load(userId: string): { login: string; connectedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(KEY + userId);
    if (raw) {
      const v = JSON.parse(raw) as { login?: unknown; connectedAt?: unknown };
      if (typeof v.login === "string" && typeof v.connectedAt === "string") return { login: v.login, connectedAt: v.connectedAt };
    }
  } catch { /* storage blocked: fall back to memory */ }
  return memory.get(userId) ?? null;
}

function save(userId: string, v: { login: string; connectedAt: string } | null) {
  if (v) memory.set(userId, v);
  else memory.delete(userId);
  try {
    if (v) window.localStorage.setItem(KEY + userId, JSON.stringify(v));
    else window.localStorage.removeItem(KEY + userId);
  } catch { /* storage blocked: memory still holds it for this tab */ }
}

/** A plausible GitHub login from the person's name (or e-mail): letters, digits and single hyphens, at most 39 characters. */
export function previewLogin(viewer: Pick<GithubViewer, "name" | "email">): string {
  const from = viewer.name.trim() || viewer.email.split("@")[0] || "";
  const login = from.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/, "");
  return login || "madp-user";
}

const DAY = 86_400_000;

/** The invented repositories, relative to now. */
const REPOS: readonly { name: string; private: boolean; defaultBranch: string; daysAgo: number; description: string; branches: string[] }[] = [
  { name: "customer-portal", private: true, defaultBranch: "main", daysAgo: 0.2, description: "Self-service portal for customers: orders, invoices and support.", branches: ["develop", "feat/checkout-redesign", "release/2.4"] },
  { name: "billing-service", private: true, defaultBranch: "main", daysAgo: 2, description: "Invoicing, payments and dunning API.", branches: ["develop", "fix/vat-rounding"] },
  { name: "mobile-app", private: true, defaultBranch: "develop", daysAgo: 6, description: "iOS and Android app (React Native).", branches: ["main", "release/1.9", "feat/offline-mode"] },
  { name: "partner-api", private: true, defaultBranch: "main", daysAgo: 13, description: "REST API for integration partners.", branches: ["v1", "feat/webhooks"] },
  { name: "marketing-site", private: false, defaultBranch: "main", daysAgo: 24, description: "Public website and blog.", branches: ["preview"] },
  { name: "data-pipeline", private: true, defaultBranch: "master", daysAgo: 47, description: "Nightly exports to the data warehouse.", branches: ["staging"] },
  { name: "design-tokens", private: false, defaultBranch: "main", daysAgo: 96, description: "Shared colours, type and spacing.", branches: [] },
];

function connectedLogin(viewer: GithubViewer): string {
  const c = load(viewer.userId);
  if (!c) throw new Error("GitHub is not connected.");
  return c.login;
}

export const previewGithub: GithubSource = {
  preview: true,
  manageAccessUrl: "https://github.com/settings/installations",

  async status(viewer) {
    const c = load(viewer.userId);
    return c ? { connected: true, login: c.login, connectedAt: c.connectedAt } : DISCONNECTED;
  },

  async connect(viewer) {
    await wait(900);
    const c = { login: previewLogin(viewer), connectedAt: new Date().toISOString() };
    save(viewer.userId, c);
    return { connected: true, ...c };
  },

  async disconnect(viewer) {
    await wait(300);
    save(viewer.userId, null);
    return DISCONNECTED;
  },

  async repos(viewer): Promise<GithubRepo[]> {
    const login = connectedLogin(viewer);
    await wait(450);
    const now = Date.now();
    return REPOS.map((r) => ({
      owner: login, name: r.name, fullName: `${login}/${r.name}`, private: r.private, defaultBranch: r.defaultBranch,
      updatedAt: new Date(now - r.daysAgo * DAY).toISOString(), description: r.description,
    }));
  },

  async branches(viewer, owner, name): Promise<GithubBranch[]> {
    const login = connectedLogin(viewer);
    await wait(250);
    const r = REPOS.find((x) => x.name === name);
    if (!r || owner !== login) return [];
    return [{ name: r.defaultBranch, isDefault: true }, ...r.branches.map((b) => ({ name: b, isDefault: false }))];
  },
};

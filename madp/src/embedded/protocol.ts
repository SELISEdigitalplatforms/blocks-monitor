export interface BlocksRepository {
  itemId: string;
  repoName: string;
  repoUrl: string;
}

export interface BlocksShellContext {
  type: "blocks:context";
  version: 1;
  project: {
    itemId: string;
    tenantId: string;
    tenantGroupId: string;
    name: string;
    environment: string;
  };
  repositories: BlocksRepository[];
  theme: "light" | "dark";
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2048;

/** Context is presentation and association data; it never grants MADP permissions. */
export function parseShellContext(value: unknown): BlocksShellContext | null {
  if (!record(value) || value.type !== "blocks:context" || value.version !== 1 || !record(value.project)) return null;
  const p = value.project;
  if (![p.itemId, p.tenantId, p.tenantGroupId, p.name, p.environment].every(text) || !p.tenantId || !p.itemId) return null;
  if (value.theme !== "light" && value.theme !== "dark") return null;
  if (!Array.isArray(value.repositories) || value.repositories.length > 5000) return null;
  const repositories: BlocksRepository[] = [];
  for (const repo of value.repositories) {
    if (!record(repo) || !text(repo.itemId) || !text(repo.repoName) || !text(repo.repoUrl)) return null;
    repositories.push({ itemId: repo.itemId, repoName: repo.repoName, repoUrl: repo.repoUrl });
  }
  return { type: "blocks:context", version: 1, project: p as unknown as BlocksShellContext["project"], repositories, theme: value.theme };
}

/** Only this document's API is proxied; storage upload URLs and other origins remain untouched. */
export function embeddedApiUrl(raw: string, origin: string): string {
  let target: URL;
  try { target = new URL(raw, origin); } catch { return raw; }
  if (target.origin !== origin || !(target.pathname === "/api" || target.pathname.startsWith("/api/"))) return raw;
  return `${origin}/madp-api${target.pathname}${target.search}${target.hash}`;
}

export function navigateBlocks(destination: "projects" | "repositories"): void {
  if (window.parent !== window) window.parent.postMessage({ type: "madp:navigate", version: 1, destination }, window.location.origin);
}

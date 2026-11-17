import { createHash, createHmac, randomBytes } from "node:crypto";
import { OpError } from "../../functions/_lib/errors.ts";

export interface RepositoryIdentity { tenantId: string; userId: string }
export interface RepositorySelection { owner: string; name: string; branch: string; kind: "existing" | "new" }
export interface RepositoryCredential { username: string; token: string; repository: string; connectionId: string; expiresAt: string | null }
export interface RepositoryEnvironment { env: Record<string, string>; redact(text: string): string }
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const safePart = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const safeUserId = (v: string) => typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);

export function repositoryBrokerUrl(raw: string | undefined): URL | null {
  try {
    const url = new URL(raw || "");
    if (url.username || url.password || url.hash || url.search || url.pathname !== "/internal/madp/repositories") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))) return null;
    return url;
  } catch { return null; }
}

/** Shared server/worker client. Only the trusted broker ever reads the Blocks connection credential. */
export function createRepositoryBroker(env: Record<string, string | undefined>, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const endpoint = repositoryBrokerUrl(env.MF_BLOCKS_REPOSITORY_URL);
  const key = env.MF_BLOCKS_REPOSITORY_KEY || "";
  const fetcher = options.fetch || globalThis.fetch;
  const configured = Boolean(endpoint && Buffer.byteLength(key) >= 32);
  async function request(identity: RepositoryIdentity, repository: string, branch: string, operation: "verify" | "branches" | "credential"): Promise<Record<string, unknown>> {
    if (!configured) throw new OpError("not_configured");
    if (!safePart(identity.tenantId) || !safeUserId(identity.userId) || !repositoryPattern.test(repository) || repository.split("/").some(p => p === "." || p === "..") || !branch || branch.length > 255) throw new OpError("forbidden");
    const body = JSON.stringify({ v: 1, issuedAt: Math.floor((options.now?.() ?? Date.now()) / 1000), nonce: randomBytes(16).toString("hex"), ...identity, repository, branch, operation });
    const hash = createHash("sha256").update(body).digest("hex");
    const signature = createHmac("sha256", key).update(`POST\n${endpoint!.pathname}${endpoint!.search}\n${hash}`).digest("base64url");
    let response: Response;
    try {
      response = await fetcher(endpoint!, { method: "POST", headers: { "content-type": "application/json", "x-madp-worker-signature": signature }, body,
        redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    } catch { throw new OpError("unavailable"); }
    if (!response.ok) throw new OpError(response.status === 403 ? "forbidden" : response.status === 503 ? "not_configured" : "unavailable");
    let answer: unknown;
    try { answer = await response.json(); } catch { throw new OpError("unavailable"); }
    if (!record(answer) || answer.ok !== true || !record(answer.data)) throw new OpError("unavailable");
    return answer.data;
  }
  async function credential(identity: RepositoryIdentity, repository: string, branch: string): Promise<RepositoryCredential> {
    const value = await request(identity, repository, branch, "credential");
    if (typeof value.username !== "string" || !/^[^:\s\x00-\x1f\x7f]{1,256}$/.test(value.username) || typeof value.token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value.token)
      || value.repository !== repository || typeof value.connectionId !== "string") throw new OpError("unavailable");
    const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : null;
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= (options.now?.() ?? Date.now()))) throw new OpError("forbidden");
    return { username: value.username, token: value.token, repository, connectionId: value.connectionId, expiresAt };
  }
  return {
    configured,
    async verifyRepository(identity: RepositoryIdentity, repo: RepositorySelection): Promise<void> {
      if (repo.kind !== "existing") throw new OpError("forbidden");
      await request(identity, `${repo.owner}/${repo.name}`, repo.branch, "verify");
    },
    async branches(identity: RepositoryIdentity, repository: string, branch: string): Promise<string[]> {
      const value = await request(identity, repository, branch, "branches");
      if (!Array.isArray(value.branches) || value.branches.some(b => !record(b) || typeof b.name !== "string")) throw new OpError("unavailable");
      return value.branches.map(b => String((b as Record<string, unknown>).name));
    },
    credential,
    async environmentFor(identity: RepositoryIdentity, repository: string, branch: string): Promise<RepositoryEnvironment> {
      const saved = await credential(identity, repository, branch);
      const basic = Buffer.from(`${saved.username}:${saved.token}`).toString("base64");
      // Git/gh inherit credentials for this child only. No token in argv, remote URLs, project rows, or files.
      return { env: {
        GH_TOKEN: saved.token, GITHUB_TOKEN: saved.token, GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: `http.https://github.com/${repository}/.extraheader`, GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
        GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "", GIT_CONFIG_KEY_2: "credential.interactive", GIT_CONFIG_VALUE_2: "false",
      }, redact: text => text.split(saved.token).join("[redacted]").split(basic).join("[redacted]") };
    },
  };
}

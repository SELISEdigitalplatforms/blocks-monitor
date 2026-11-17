import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRepositoryBroker, repositoryBrokerUrl } from "./repositories.ts";

const endpoint = "https://blocks.example.test/internal/madp/repositories";
const key = "test-only-repository-key-00000000000000000";
const identity = { tenantId: "D0123456789abcdef0123456789abcdef", userId: "provider|person" };
const repo = { owner: "company", name: "portal", branch: "dev", kind: "existing" as const };
const env = { MF_BLOCKS_REPOSITORY_URL: endpoint, MF_BLOCKS_REPOSITORY_KEY: key };
const answer = (data: unknown, status = 200) => new Response(JSON.stringify({ ok: status === 200, data }), { status, headers: { "content-type": "application/json" } });

describe("private Blocks repository client", () => {
  it("signs exact operation, path, body, identity and a one-use nonce without cookies", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      const raw = String(options?.body);
      const body = JSON.parse(raw);
      expect(body).toMatchObject({ v: 1, operation: "verify", repository: "company/portal", branch: "dev", ...identity });
      expect(body.nonce).toMatch(/^[a-f0-9]{32}$/);
      const hash = createHash("sha256").update(raw).digest("hex");
      const signed = createHmac("sha256", key).update(`POST\n/internal/madp/repositories\n${hash}`).digest("base64url");
      expect(new Headers(options?.headers).get("x-madp-worker-signature")).toBe(signed);
      expect(new Headers(options?.headers).has("authorization")).toBe(false);
      expect(options?.credentials).toBe("omit");
      expect(options?.redirect).toBe("error");
      return answer({ repository: "company/portal", branch: "dev" });
    });
    await createRepositoryBroker(env, { fetch: fetcher }).verifyRepository(identity, repo);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never falls back to MADP OAuth or host credentials when integration is absent", async () => {
    const fetcher = vi.fn();
    await expect(createRepositoryBroker({}, { fetch: fetcher }).verifyRepository(identity, repo)).rejects.toMatchObject({ code: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects new repositories and non-private HTTP targets before any request", async () => {
    const fetcher = vi.fn();
    await expect(createRepositoryBroker(env, { fetch: fetcher }).verifyRepository(identity, { ...repo, kind: "new" })).rejects.toMatchObject({ code: "forbidden" });
    for (const url of ["http://public.example.test/internal/madp/repositories", "https://u:p@blocks.test/internal/madp/repositories", "https://blocks.test/other"]) expect(repositoryBrokerUrl(url)).toBeNull();
    expect(repositoryBrokerUrl("http://127.0.0.1:5001/internal/madp/repositories")).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns only child-scoped auth and removes secrets from captured output", async () => {
    const token = "test-provider-token-00000000000000000";
    const broker = createRepositoryBroker(env, { fetch: vi.fn(async () => answer({ username: "x-access-token", token, repository: "company/portal", connectionId: "connected-repo", expiresAt: null })) });
    const before = process.env.GH_TOKEN;
    const result = await broker.environmentFor(identity, "company/portal", "dev");
    expect(result.env.GH_TOKEN).toBe(token);
    expect(result.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/company/portal/.extraheader");
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    expect(result.redact(`${token} ${basic}`)).toBe("[redacted] [redacted]");
    expect(process.env.GH_TOKEN).toBe(before);
  });
  it("refuses mismatched repositories, expired credentials and malformed usernames", async () => {
    for (const change of [{ repository: "other/repo" }, { expiresAt: "2000-01-01T00:00:00Z" }, { username: "bad:username" }]) {
      const broker = createRepositoryBroker(env, { fetch: vi.fn(async () => answer({ username: "x-access-token", token: "test-token", repository: "company/portal", connectionId: "repo", expiresAt: null, ...change })) });
      await expect(broker.credential(identity, "company/portal", "dev")).rejects.toBeDefined();
    }
  });
  it("does not disclose provider error bodies", async () => {
    const broker = createRepositoryBroker(env, { fetch: vi.fn(async () => new Response("sensitive provider body", { status: 403 })) });
    await expect(broker.verifyRepository(identity, repo)).rejects.toMatchObject({ code: "forbidden", message: "forbidden" });
  });
});

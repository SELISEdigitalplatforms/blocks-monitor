import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createGithubIntegration } from "../../server/blocks/github";
import { encryptGithubToken, decryptGithubToken, githubTokenKey } from "../../server/blocks/githubCrypto";
import type { GithubCredentialStore, GithubCredential } from "../../server/blocks/githubStore";

const origin = "https://factory.example.org:5310";
function fixture() {
  let time = 1_000;
  const values = new Map<string, GithubCredential>();
  const store: GithubCredentialStore = {
    get: vi.fn(async (user) => values.get(user) ?? null),
    save: vi.fn(async (user, value) => { values.set(user, value); }),
    disconnect: vi.fn(async (user) => { values.delete(user); }),
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "github-server-secret" });
    if (url === "https://api.github.com/user") return Response.json({ login: "octo-test" });
    if (url.includes("/branches/main")) return Response.json({ name: "main" });
    if (url.includes("/branches")) return Response.json([{ name: "main" }]);
    if (url.includes("/repos/octo-test/product")) return Response.json({ name: "product", default_branch: "main" });
    if (url.includes("/user/repos")) return Response.json([{ owner: { login: "octo-test" }, name: "product", full_name: "octo-test/product", private: true, default_branch: "main" }]);
    return Response.json({}, { status: 404 });
  });
  const integration = createGithubIntegration({ origin, clientId: "public-id", clientSecret: "server-secret", store, fetch: fetcher, now: () => time,
    identity: async (req) => req.headers["x-test-user"] === "none" ? null : { userId: String(req.headers["x-test-user"] ?? "user-1"), sid: String(req.headers["x-test-session"] ?? "sid-1") },
  });
  async function request(path: string, method = "GET", body: unknown = {}, headers: Record<string, string> = {}) {
    const req = Readable.from(method === "POST" ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
    Object.assign(req, { url: `/api/github${path}`, method, headers: { host: new URL(origin).host, origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, socket: { remoteAddress: "127.0.0.1" } });
    return await new Promise<{ status: number; text: string; json: () => any }>((resolve) => {
      const responseHeaders = new Map<string, unknown>();
      const res = { statusCode: 200, setHeader: (key: string, value: unknown) => responseHeaders.set(key, value),
        end: (value: unknown) => { const text = String(value); resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }); },
      } as unknown as ServerResponse;
      integration.handle(req, res, () => resolve({ status: 404, text: "", json: () => null }));
    });
  }
  async function authorize() {
    const result = await request("/connect", "POST", { userId: "user-1" });
    const url = new URL(result.json().url);
    return url.searchParams.get("state")!;
  }
  return { store, values, fetcher, request, authorize, integration, advance: () => { time += 11 * 60_000; } };
}

describe("GitHub authenticated backend", () => {
  it("allows an empty existing repository only for a new product, without creating a branch", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    f.fetcher.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/branches/main')) return Response.json({}, { status: 404 });
      if (url.endsWith('/branches?per_page=1')) return Response.json([]);
      return Response.json({ name: 'product' });
    });
    const repo = { kind: 'existing' as const, owner: 'octo-test', name: 'product', branch: 'main' };
    await expect(f.integration.verifyRepository('user-1', repo)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.integration.verifyRepository('user-1', { ...repo, allowEmpty: true })).resolves.toBeUndefined();
    expect(f.fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    f.fetcher.mockImplementation(async (input) => String(input).endsWith('/branches/main')
      ? Response.json({}, { status: 404 }) : Response.json([{ name: 'master' }]));
    await expect(f.integration.verifyRepository('user-1', { ...repo, allowEmpty: true })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it("uses the HTTPS app origin for authorization and the token exchange callback", async () => {
    const f = fixture();
    const result = await f.request("/connect", "POST", { userId: "user-1" });
    expect(result.status).toBe(200);
    const url = new URL(result.json().url);
    expect(url.searchParams.get("client_id")).toBe("public-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/github/callback`);
    const state = url.searchParams.get("state")!;
    expect((await f.request(`/callback?code=test-code&state=${state}`)).status).toBe(200);
    const exchange = f.fetcher.mock.calls.find(([input]) => String(input) === "https://github.com/login/oauth/access_token");
    expect(JSON.parse(String(exchange?.[1]?.body))).toMatchObject({ redirect_uri: `${origin}/api/github/callback` });
  });

  it("creates a private repository immediately and recovers the same operation without duplicating it", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    let created: Record<string, unknown> | null = null;
    f.fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/user/repos") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ name: "project-name", private: true, auto_init: true });
        created = { ...body, default_branch: "main" };
        return Response.json(created, { status: 201 });
      }
      return created ? Response.json(created) : Response.json({}, { status: 404 });
    });
    const repo = { kind: "new" as const, owner: "octo-test", name: "project-name", branch: "main", visibility: "private" };
    await f.integration.verifyRepository("user-1", repo, "project:project.create:request-1");
    await f.integration.verifyRepository("user-1", repo, "project:project.create:request-1");
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await expect(f.integration.verifyRepository("user-1", repo, "project:project.create:different-request")).rejects.toMatchObject({ code: "conflict" });
  });

  it("never adopts a name collision or creates an internal repository in a personal account", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    const repo = { kind: "new" as const, owner: "octo-test", name: "product", branch: "main", visibility: "private" };
    await expect(f.integration.verifyRepository("user-1", repo, "request-1")).rejects.toMatchObject({ code: "conflict" });
    await expect(f.integration.verifyRepository("user-1", { ...repo, visibility: "internal" }, "request-1")).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("initializes the requested branch when the account default is different", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    f.fetcher.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/user/repos")) return Response.json({ ...JSON.parse(String(init?.body)), default_branch: "master" }, { status: 201 });
      if (url.endsWith("/branches/master")) return Response.json({ commit: { sha: "commit-sha" } });
      if (init?.method === "POST" || init?.method === "PATCH") return Response.json({});
      return Response.json({}, { status: 404 });
    });
    await f.integration.verifyRepository("user-1", { kind: "new", owner: "octo-test", name: "new-product", branch: "main", visibility: "private" }, "request-1");
    expect(f.fetcher).toHaveBeenCalledWith("https://api.github.com/repos/octo-test/new-product/git/refs", expect.objectContaining({ method: "POST", body: JSON.stringify({ ref: "refs/heads/main", sha: "commit-sha" }) }));
    expect(f.fetcher).toHaveBeenCalledWith("https://api.github.com/repos/octo-test/new-product", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ default_branch: "main" }) }));
  });

  it("recovers a concurrent creation response only with the same operation marker", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    let created: Record<string, unknown> | null = null;
    f.fetcher.mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        created = { ...JSON.parse(String(init.body)), default_branch: "main" };
        return Response.json({}, { status: 422 });
      }
      return created ? Response.json(created) : Response.json({}, { status: 404 });
    });
    await expect(f.integration.verifyRepository("user-1", { kind: "new", owner: "octo-test", name: "new-product", branch: "main", visibility: "private" }, "request-1")).resolves.toBeUndefined();
  });

  it("rejects anonymous, cross-origin, forged-user and mismatched host requests", async () => {
    const f = fixture();
    expect((await f.request("/status/user-1", "GET", {}, { "x-test-user": "none" })).status).toBe(401);
    expect((await f.request("/status/user-2")).status).toBe(403);
    expect((await f.request("/connect", "POST", { userId: "user-2" })).status).toBe(403);
    expect((await f.request("/connect", "POST", {}, { origin: "https://evil.example.org" })).status).toBe(403);
    expect((await f.request("/status/user-1", "GET", {}, { host: "evil.example.org" })).status).toBe(403);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("binds random OAuth state to the verified user/session and consumes it only once", async () => {
    const f = fixture();
    const state = await f.authorize();
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    const wrong = await f.request(`/callback?code=code&state=${state}`, "GET", {}, { "x-test-session": "other-session" });
    expect(wrong.status).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
    const success = await f.request(`/callback?code=code&state=${state}`);
    expect(success.status).toBe(200);
    expect(success.text).not.toContain("github-server-secret");
    expect(f.store.save).toHaveBeenCalledWith("user-1", expect.objectContaining({ login: "octo-test", token: "github-server-secret" }));
    expect((await f.request(`/callback?code=code&state=${state}`)).status).toBe(400);
    expect(f.store.save).toHaveBeenCalledOnce();
    const status = await f.request("/status/user-1");
    expect(status.json()).toMatchObject({ connected: true, login: "octo-test" });
    expect(status.text).not.toContain("github-server-secret");
  });
  it("rejects expired/forged state and denial without exchanging a code", async () => {
    const f = fixture();
    const state = await f.authorize();
    f.advance();
    expect((await f.request(`/callback?code=code&state=${state}`)).status).toBe(400);
    expect((await f.request("/callback?code=code&state=forged")).status).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("disconnect removes credentials and invalidates outstanding OAuth attempts", async () => {
    const f = fixture();
    const state = await f.authorize();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    expect((await f.request("/disconnect/user-1", "POST")).json().connected).toBe(false);
    expect(f.values.has("user-1")).toBe(false);
    expect((await f.request(`/callback?state=${state}&code=code`)).status).toBe(400);
  });
  it("validates existing repositories and branches using only that user's credentials", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    await f.integration.verifyRepository("user-1", { kind: "existing", owner: "octo-test", name: "product", branch: "main" });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await expect(f.integration.verifyRepository("user-2", { kind: "existing", owner: "octo-test", name: "product", branch: "main" })).rejects.toThrow();
    await expect(f.integration.verifyRepository("user-1", { kind: "new", owner: "someone-else", name: "product", branch: "main" })).rejects.toThrow();
  });
  it("does not leak provider errors or tokens on upstream failure", async () => {
    const f = fixture();
    f.values.set("user-1", { login: "octo-test", token: "secret", connectedAt: "now" });
    f.fetcher.mockResolvedValueOnce(Response.json({ message: "sensitive provider response" }, { status: 500 }));
    const response = await f.request("/repos/user-1");
    expect(response.status).toBe(502);
    expect(response.text).not.toContain("sensitive provider response");
    expect(response.text).not.toContain("secret");
  });
});

describe("encrypted Gateway GitHub credentials", () => {
  it("uses random nonces, authenticates ciphertext and binds it to tenant/user", () => {
    const key = githubTokenKey("ab".repeat(32))!;
    const first = encryptGithubToken(key, "factory", "user-1", "not-a-real-github-token");
    expect(first).not.toContain("not-a-real-github-token");
    expect(encryptGithubToken(key, "factory", "user-1", "not-a-real-github-token")).not.toBe(first);
    expect(decryptGithubToken(key, "factory", "user-1", first)).toBe("not-a-real-github-token");
    expect(() => decryptGithubToken(key, "factory", "user-2", first)).toThrow();
    expect(() => decryptGithubToken(key, "other-factory", "user-1", first)).toThrow();
    expect(() => decryptGithubToken(key, "factory", "user-1", first.replace("v1.", "v2."))).toThrow();
    expect(githubTokenKey("short")).toBeNull();
  });
});

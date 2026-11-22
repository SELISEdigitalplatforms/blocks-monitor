import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BlocksApiError } from "@seliseblocks/client";

const sdk = vi.hoisted(() => ({
  redirectToProvider: vi.fn(), callback: vi.fn(), userInfo: vi.fn(), logout: vi.fn(), logoutAll: vi.fn(), recover: vi.fn(),
}));
vi.mock("../../src/blocks/client", () => ({ blocks: { auth: { ...sdk, idp: sdk } } }));
vi.mock("../../src/blocks/config", () => ({ hostedLoginEnabled: () => true, blocksConfig: () => ({ oidcUrl: "https://iam.seliseblocks.com" }) }));

const origin = "https://dbsaun.slsblx.com:5310";
const callback = `${origin}/login/callback?code=one-time&state=iam-state`;
const key = "madp-factory-oidc-attempt-v1";
let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  store = new Map();
  vi.stubGlobal("window", { location: { origin, protocol: "https:" } });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  sdk.redirectToProvider.mockResolvedValue(undefined);
  sdk.callback.mockResolvedValue({ isSuccess: true });
  sdk.userInfo.mockResolvedValue({ sub: "u", email: "user@example.org" });
  sdk.logout.mockResolvedValue({ isSuccess: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("hosted OIDC flow", () => {
  it("starts through the SDK and stores only an internal return path and timestamp", async () => {
    const { startHostedLogin } = await import("../../src/blocks/oidc");
    await startHostedLogin("//evil.example");
    expect(sdk.redirectToProvider).toHaveBeenCalledOnce();
    expect(JSON.parse(store.get(key)!)).toEqual({ returnTo: "/dashboard", at: expect.any(Number) });
  });
  it("clears the pending attempt if initiate fails", async () => {
    sdk.redirectToProvider.mockRejectedValueOnce(new Error("offline"));
    const { startHostedLogin } = await import("../../src/blocks/oidc");
    await expect(startHostedLogin()).rejects.toThrow();
    expect(store.has(key)).toBe(false);
  });
  it("does not start on plain HTTP", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5310", protocol: "http:" } });
    const { startHostedLogin } = await import("../../src/blocks/oidc");
    await expect(startHostedLogin()).rejects.toThrow("HTTPS");
    expect(sdk.redirectToProvider).not.toHaveBeenCalled();
  });
  it("exchanges a code once under repeated callback mounts and validates the live session", async () => {
    const { startHostedLogin, completeHostedLogin } = await import("../../src/blocks/oidc");
    await startHostedLogin("/p/one/scope");
    expect(await Promise.all([completeHostedLogin(callback), completeHostedLogin(callback)])).toEqual(["/p/one/scope", "/p/one/scope"]);
    expect(sdk.callback).toHaveBeenCalledOnce();
    expect(sdk.userInfo).toHaveBeenCalledOnce();
    expect(store.has(key)).toBe(false);
  });
  it("rejects an unsolicited callback without invoking IAM", async () => {
    const { completeHostedLogin } = await import("../../src/blocks/oidc");
    await expect(completeHostedLogin(callback)).rejects.toThrow();
    expect(sdk.callback).not.toHaveBeenCalled();
  });
  it("rejects stale attempts", async () => {
    store.set(key, JSON.stringify({ at: Date.now() - 11 * 60 * 1000 }));
    const { completeHostedLogin } = await import("../../src/blocks/oidc");
    await expect(completeHostedLogin(callback)).rejects.toThrow();
    expect(sdk.callback).not.toHaveBeenCalled();
  });
  it("refuses callback success if the session cookie did not land", async () => {
    const { startHostedLogin, completeHostedLogin } = await import("../../src/blocks/oidc");
    await startHostedLogin();
    sdk.userInfo.mockResolvedValueOnce({ isSuccess: false });
    await expect(completeHostedLogin(callback)).rejects.toThrow();
  });
  it("refuses provider errors", async () => {
    const { startHostedLogin, completeHostedLogin } = await import("../../src/blocks/oidc");
    await startHostedLogin();
    await expect(completeHostedLogin(`${origin}/login/callback?error=access_denied`)).rejects.toThrow();
    expect(sdk.callback).not.toHaveBeenCalled();
  });
});

describe("session adapter", () => {
  it("restores the existing profile contract from live IAM", async () => {
    const { hostedAuthCall } = await import("../../src/blocks/oidc");
    expect(await hostedAuthCall("GET", "session")).toMatchObject({ status: 200, body: { ok: true, data: { profile: { userId: "u", isSuperAdmin: false } } } });
  });
  it("preserves 401 versus network failure", async () => {
    const { hostedAuthCall } = await import("../../src/blocks/oidc");
    sdk.userInfo.mockRejectedValueOnce(new BlocksApiError(401, "Unauthorized", null));
    expect((await hostedAuthCall("GET", "session"))?.status).toBe(401);
    sdk.userInfo.mockRejectedValueOnce(new TypeError("offline"));
    expect(await hostedAuthCall("GET", "session")).toBeNull();
  });
  it("blocks local password login and uses SDK logout", async () => {
    const { hostedAuthCall } = await import("../../src/blocks/oidc");
    expect((await hostedAuthCall("POST", "login", { password: "anything" }))?.status).toBe(410);
    expect((await hostedAuthCall("POST", "logout"))?.status).toBe(200);
    expect(sdk.logout).toHaveBeenCalledOnce();
  });
  it("accepts a hosted activation link but refuses an untrusted link", async () => {
    const { hostedAuthCall } = await import("../../src/blocks/oidc");
    expect(await hostedAuthCall("POST", "link/parse", { link: "https://iam.seliseblocks.com/oidc/activate/?code=one-time" }))
      .toMatchObject({ status: 200, body: { data: { kind: "activation", code: "one-time" } } });
    expect((await hostedAuthCall("POST", "link/parse", { link: "https://evil.example/activate?code=one-time" }))?.status).toBe(400);
  });
});

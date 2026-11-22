import { describe, expect, it, vi } from "vitest";
import { createBlocksIam, readIamUser } from "../../server/blocks/iam";

const env = { apiUrl: "https://blocksapi.example.org", tenant: "test-tenant", clientId: "server-client", clientSecret: "server-only" };
const user = { itemId: "user-1", email: "user@example.org", firstName: "User", roles: [], permissions: [], active: true, organizationId: "org-1" };
const inactiveUser = { ...user, active: false };

describe("embedded SDK adapter", () => {
  it("maps the verified IAM envelope and organization", () => {
    expect(readIamUser({ data: user, errors: null })).toMatchObject({ itemId: user.itemId, active: true, organizationId: "org-1" });
    expect(() => readIamUser({ data: { roles: ["mf-super-admin"] } })).toThrow();
  });
  it("uses the real SDK login payload and never provisions a user", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/login")) {
        expect(JSON.parse(String(options?.body))).toEqual({ username: "user@example.org", password: "entered-password" });
        return Response.json({ access_token: "opaque-access", refresh_token: "opaque-refresh", expires_in: 900 });
      }
      if (path.endsWith("/iam/me")) return Response.json({ data: user, errors: null });
      throw new Error("Unexpected API call");
    });
    const iam = createBlocksIam(env, fetcher);
    expect(await iam.login(" USER@example.org ", "entered-password")).toMatchObject({ ok: true, tokens: { userId: user.itemId, refreshToken: "opaque-refresh" } });
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("signup"))).toBe(true);
  });
  it("does not treat a security challenge as successful login", async () => {
    const iam = createBlocksIam(env, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ isSuccess: false, errors: ["MFA verification required"] })));
    expect(await iam.login("user@example.org", "entered-password")).toEqual({ ok: false, reason: "extra-step" });
  });
  it("identity comes only from IAM: an active tenant user passes with no app-schema involvement", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: user, errors: null }));
    const iam = createBlocksIam(env, fetcher);
    await expect(iam.me("opaque-access")).resolves.toMatchObject({ itemId: user.itemId, email: user.email });
    // Only the IAM identity endpoint is consulted; no Data Gateway reads.
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).pathname.endsWith("/iam/me"))).toBe(true);
  });
  it("refuses a deactivated IAM identity", async () => {
    const iam = createBlocksIam(env, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: inactiveUser, errors: null })));
    await expect(iam.me("opaque-access")).rejects.toMatchObject({ status: 401 });
  });
});

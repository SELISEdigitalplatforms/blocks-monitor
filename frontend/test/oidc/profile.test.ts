import { describe, expect, it } from "vitest";
import { oidcReturnTo, profileFromOidc } from "../../src/blocks/oidcProfile";

describe("live OIDC profile mapping", () => {
  it("maps IAM claims without granting unassigned roles", () => {
    expect(profileFromOidc({ sub: "user-1", email: "user@example.org", given_name: "Alex", family_name: "Lee" }))
      .toEqual({ userId: "user-1", email: "user@example.org", firstName: "Alex", lastName: "Lee", displayName: "Alex Lee", roles: [], permissions: [], isSuperAdmin: false });
  });
  it("maps nested IAM records and only trusts the exact super-admin role", () => {
    expect(profileFromOidc({ isSuccess: true, data: { itemId: "u", email: "a@b.co", roles: ["admin", 5] } })?.isSuperAdmin).toBe(false);
    expect(profileFromOidc({ sub: "u", email: "a@b.co", roles: ["mf-super-admin"] })?.isSuperAdmin).toBe(true);
  });
  it.each([null, {}, { sub: "u" }, { sub: "u", email: "a@b.co", active: false },
    { sub: "u", email: "a@b.co", isSuccess: false }, { sub: "u", email: "a@b.co", errors: ["denied"] }])("refuses absent or rejected identity: %j", (claims) => {
    expect(profileFromOidc(claims)).toBeNull();
  });
});

describe("OIDC return paths", () => {
  it("preserves an internal project path and query", () => {
    expect(oidcReturnTo("/p/project-1/scope?tab=screens#review")).toBe("/p/project-1/scope?tab=screens#review");
  });
  it.each([null, "https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%2f%2fevil.example", "/login/callback?code=x", "/sign-in", "/sign-up", "/bad%", "/\n/evil"])("rejects unsafe or looping return paths: %s", (path) => {
    expect(oidcReturnTo(path)).toBe("/dashboard");
  });
});

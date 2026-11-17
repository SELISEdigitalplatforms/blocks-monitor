import { describe, expect, it } from "vitest";
import { embeddedApiUrl, parseShellContext } from "./protocol";
import { githubRepository } from "./github";
import { parseShellBootstrap } from "./bootstrapContract";

const origin = "https://blocks.example.test";
const context = {
  type: "blocks:context", version: 1,
  project: { itemId: "project-record", tenantId: "tenant-id", tenantGroupId: "group", name: "Customer portal", environment: "dev" },
  repositories: [{ itemId: "repo-record", repoName: "portal", repoUrl: "https://github.com/company/portal" }],
  theme: "light",
};

describe("Blocks context contract", () => {
  it("retains distinct project record and tenant identifiers", () => {
    const parsed = parseShellContext(context);
    expect(parsed?.project.itemId).toBe("project-record");
    expect(parsed?.project.tenantId).toBe("tenant-id");
    expect(parsed?.repositories).toHaveLength(1);
  });
  it("rejects malformed or incompatible messages", () => {
    expect(parseShellContext({ ...context, version: 2 })).toBeNull();
    expect(parseShellContext({ ...context, project: { ...context.project, tenantId: "" } })).toBeNull();
    expect(parseShellContext({ ...context, repositories: [{ itemId: "x", repoName: "x" }] })).toBeNull();
    expect(parseShellContext({ ...context, theme: "system" })).toBeNull();
  });
});

describe("MADP API isolation", () => {
  it("rewrites relative and absolute same-origin API requests with query strings", () => {
    expect(embeddedApiUrl("/api/auth/session", origin)).toBe(`${origin}/madp-api/api/auth/session`);
    expect(embeddedApiUrl(`${origin}/api/brief/id?revision=2`, origin)).toBe(`${origin}/madp-api/api/brief/id?revision=2`);
  });
  it("leaves external storage, SDK requests, and already proxied paths alone", () => {
    for (const raw of ["https://storage.example.test/api/object?signature=abc", "https://blocksapi.example.test/api/data", "/madp-api/api/auth/session", "/apiary/image", "/madp/assets/page.js"]) {
      expect(embeddedApiUrl(raw, origin)).toBe(raw);
    }
  });
});

describe("Blocks repository mapping", () => {
  it("accepts connected GitHub URLs and SSH references", () => {
    expect(githubRepository(context.repositories[0])).toEqual({ owner: "company", name: "portal" });
    expect(githubRepository({ itemId: "r", repoName: "portal", repoUrl: "git@github.com:company/portal.git" })).toEqual({ owner: "company", name: "portal" });
  });
  it("does not reinterpret another provider as GitHub", () => {
    expect(githubRepository({ itemId: "r", repoName: "company/portal", repoUrl: "https://gitlab.com/company/portal" })).toBeNull();
    expect(githubRepository({ itemId: "r", repoName: "portal", repoUrl: "https://github.com.attacker.test/company/portal" })).toBeNull();
  });
});

describe("server identity bootstrap", () => {
  const response = { ok: true, data: { tenantId: "tenant-a", profile: { userId: "verified-user", roles: [], permissions: ["view"], isSuperAdmin: false },
    workspace: { id: "workspace-a" }, member: { userId: "verified-user", permissions: ["view"] }, customRole: { permissions: ["view"] },
    project: { id: "real-project-id", workspaceId: "workspace-a", blocksProjectRef: "tenant-a" } } };
  it("accepts the server-owned identity and database identifiers", () => {
    expect(parseShellBootstrap(response, "tenant-a")?.project.id).toBe("real-project-id");
  });
  it("rejects malformed, elevated and another-tenant responses", () => {
    expect(parseShellBootstrap(response, "tenant-b")).toBeNull();
    expect(parseShellBootstrap({ ok: true, data: {} }, "tenant-a")).toBeNull();
    expect(parseShellBootstrap({ ...response, data: { ...response.data, profile: { ...response.data.profile, isSuperAdmin: true } } }, "tenant-a")).toBeNull();
  });
});

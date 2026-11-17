import { createHash, createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAssertionVerifier, type ShellIdentity } from "./assertion";
import { createShellOnboarding } from "./onboarding";
import { shellPermissions } from "./permissions";
import { enforceShellFunction, scopeReads, shellRequestId } from "./scope";
import { toGatewayFilter } from "../../functions/_lib/filter";
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import { createFunction } from "../../functions/_lib/router";
import { defineOp } from "../../functions/_lib/registry";
import { v } from "../../functions/_lib/validate";
import { createProjectActionLane, setProjectKind } from "./projectKind";

const key = "0123456789abcdef0123456789abcdef";
const now = 1_800_000_000_000;
const identity = (tenantId = "D11111111111111111111111111111111", userId = "provider|person"): ShellIdentity => ({
  v: 1, iat: now / 1000, exp: now / 1000 + 45, nonce: randomUUID().replaceAll("-", ""), userId, tenantId,
  email: "person@example.test", displayName: "Project member", roles: ["admin"], permissions: [],
});
function headers(claims: ShellIdentity, method = "POST", path = "/api/data", body = Buffer.from("{}")) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const hash = createHash("sha256").update(body).digest("hex");
  return { "x-madp-context": encoded, "x-madp-body-sha256": hash,
    "x-madp-signature": createHmac("sha256", key).update(`${method}\n${path}\n${hash}\n${encoded}`).digest("base64url") };
}

describe("signed Genesis assertions", () => {
  it("preserves the verified identity namespace and consumes each nonce once", () => {
    const claims = identity(); const signed = headers(claims); const verify = createAssertionVerifier(key, () => now);
    expect(verify("POST", "/api/data", signed, Buffer.from("{}")).userId).toBe("provider|person");
    expect(() => verify("POST", "/api/data", signed, Buffer.from("{}"))).toThrow("replayed_assertion");
  });
  it("binds method, path and exact body bytes and rejects expired assertions", () => {
    const claims = identity(); const signed = headers(claims);
    const verify = createAssertionVerifier(key, () => now);
    expect(() => verify("GET", "/api/data", signed, Buffer.from("{}"))).toThrow("invalid_assertion");
    expect(() => verify("POST", "/api/fn/project", signed, Buffer.from("{}"))).toThrow("invalid_assertion");
    expect(() => verify("POST", "/api/data", signed, Buffer.from('{"op":"delete"}'))).toThrow("invalid_assertion");
    expect(() => createAssertionVerifier(key, () => now + 46_000)("POST", "/api/data", signed, Buffer.from("{}"))).toThrow("expired_assertion");
  });
});

describe("permission mapping", () => {
  it("does not infer administration or writes from generic roles", () => {
    expect(shellPermissions({ roles: ["admin", "owner", "mf-super-admin"], permissions: [] })).toEqual(["view"]);
    const write = shellPermissions({ roles: [], permissions: ["blocks-monitor::monitor::write"] }, ["blocks-monitor::monitor::write"]);
    expect(write).toContain("project.edit");
    expect(write).not.toContain("members.manage");
    expect(write).not.toContain("project.create");
    expect(write).not.toContain("project.delete");
    expect(shellPermissions({ roles: [], permissions: ["design.edit"] })).toEqual(["design.edit", "view"]);
  });
});

function memoryGateway() {
  const rows = new Map<string, Row[]>();
  const writes: string[] = [];
  const matches = (row: Row, filter: Record<string, unknown>): boolean => Object.entries(filter).every(([k, v]) => {
    if (k === "$and") return (v as Record<string, unknown>[]).every((p) => matches(row, p));
    if (v && typeof v === "object") { const wanted = v as { $eq?: unknown; $in?: unknown[] }; return (wanted.$eq === undefined || row[k] === wanted.$eq) && (!wanted.$in || wanted.$in.includes(row[k])); }
    return row[k] === v;
  });
  const raw = {
    async find(schema, options) { const filter = toGatewayFilter(options.where); const items = (rows.get(schema) ?? []).filter((r) => filter && matches(r, filter)); return { items: items.map((r) => ({ ...r })), totalCount: items.length }; },
    async get(schema, id) { return (rows.get(schema) ?? []).find((r) => r.ItemId === id) ?? null; },
    async findAll(schema, options) { const filter = toGatewayFilter(options.where); return (rows.get(schema) ?? []).filter((r) => filter && matches(r, filter)); },
    async insert(schema, row) {
      writes.push(schema); const list = rows.get(schema) ?? [];
      if (list.some((r) => r.RequestKey === row.RequestKey)) return { created: false, itemId: null };
      const itemId = randomUUID(); list.push({ ...row, ItemId: itemId, CreatedDate: new Date(now).toISOString() }); rows.set(schema, list);
      return { created: true, itemId };
    },
    async update(schema, id, patch) { Object.assign((rows.get(schema) ?? []).find((r) => r.ItemId === id)!, patch); },
    async updateMany(schema, where, patch) { const filter = toGatewayFilter(where); const selected = (rows.get(schema) ?? []).filter((r) => filter && matches(r, filter)); selected.forEach((r) => Object.assign(r, patch)); return { matched: selected.length }; },
  } as RawGateway;
  return { raw, rows, writes };
}

describe("idempotent project metadata import", () => {
  it("uses actual gateway ItemIds and never creates a Blocks tenant or owner", async () => {
    const { raw, rows, writes } = memoryGateway(); const onboard = createShellOnboarding(raw, () => now);
    const first = await onboard(identity()); const second = await onboard(identity());
    expect(first.projectId).toBe(second.projectId);
    expect(first.workspaceId).toBe(first.workspace.ItemId);
    expect(first.workspace.WorkspaceId).toBe(first.workspace.ItemId);
    expect(rows.get("Project")).toHaveLength(1);
    expect(rows.get("Membership")).toHaveLength(1);
    expect(first.membership.RoleKey).not.toBe("owner");
    expect([...new Set(writes)].sort()).toEqual(["Membership", "Project", "Workspace", "WorkspaceRole"]);
  });
  it("keeps concurrent imports unique and separates selected project tenants", async () => {
    const { raw, rows } = memoryGateway(); const onboard = createShellOnboarding(raw, () => now);
    const [a, b] = await Promise.all([onboard(identity()), onboard(identity(undefined, "another-user"))]);
    expect(a.projectId).toBe(b.projectId);
    const c = await onboard(identity("D22222222222222222222222222222222"));
    expect(c.projectId).not.toBe(a.projectId); expect(c.workspaceId).not.toBe(a.workspaceId);
    expect(rows.get("Project")).toHaveLength(2);
  });
  it("preserves an existing membership and applies only current signed permissions", async () => {
    const { raw, rows } = memoryGateway(); const onboard = createShellOnboarding(raw, () => now);
    const first = await onboard(identity());
    Object.assign(rows.get("Membership")![0], { RequestKey: "old-madp-membership", RoleKey: "owner" });
    const second = await onboard(identity());
    expect(second.membership.RoleKey).toBe("owner");
    expect(second.permissions).toEqual(["view"]);
    expect(second.projectId).toBe(first.projectId);
  });
});

describe("project isolation", () => {
  const scope = { workspaceId: "workspace-a", projectId: "project-a", identity: identity() };
  const catalog = new Map([["Project", new Set(["WorkspaceId", "ItemId"])], ["DocNote", new Set(["WorkspaceId", "ProjectId", "ItemId"])], ["AiAccount", new Set(["ItemId"])]]);
  it("adds server-owned scope and rejects foreign IDs and platform schemas", () => {
    const read = { schema: "DocNote", fields: ["ItemId"], pageNo: 1, pageSize: 10 };
    expect(scopeReads([read], catalog, scope)[0].filter).toContainEqual({ field: "ProjectId", op: "eq", value: "project-a" });
    expect(() => scopeReads([{ ...read, filter: [{ field: "ProjectId", op: "eq", value: "project-b" }] }], catalog, scope)).toThrow("scope_mismatch");
    expect(() => scopeReads([{ ...read, schema: "AiAccount" }], catalog, scope)).toThrow("schema_not_allowed");
    expect(() => enforceShellFunction({ op: "project.update", scope: "project" }, { projectId: "project-b" }, scope)).toThrow("scope_mismatch");
    expect(() => enforceShellFunction({ op: "workspace.create", scope: "self" }, {}, scope)).toThrow("operation_not_allowed");
  });
  it("does not join or replay an operation ID from another project or actor", () => {
    const a = shellRequestId("project-a", "user-a", "same-request");
    expect(shellRequestId("project-a", "user-a", "same-request")).toBe(a);
    expect(shellRequestId("project-b", "user-a", "same-request")).not.toBe(a);
    expect(shellRequestId("project-a", "user-b", "same-request")).not.toBe(a);
  });
});

describe("function router with current shell authority", () => {
  it("denies stale owner writes and foreign project anchors while allowing the selected project read", async () => {
    const { raw, rows } = memoryGateway();
    rows.set("Workspace", [{ ItemId: "workspace-a", WorkspaceId: "workspace-a", Status: "active" }, { ItemId: "workspace-b", WorkspaceId: "workspace-b", Status: "active" }]);
    rows.set("Membership", [{ ItemId: "membership-a", WorkspaceId: "workspace-a", UserId: "provider|person", Status: "active", RoleKey: "owner" }, { ItemId: "membership-b", WorkspaceId: "workspace-b", UserId: "provider|person", Status: "active", RoleKey: "owner" }]);
    rows.set("Project", [{ ItemId: "project-a", WorkspaceId: "workspace-a", Status: "active" }, { ItemId: "project-b", WorkspaceId: "workspace-b", Status: "active" }]);
    rows.set("DocNote", [{ ItemId: "foreign-note", ProjectId: "project-b", WorkspaceId: "workspace-b" }]);
    const router = createFunction({ name: "project", aclSchemas: [], ops: [
      defineOp({ op: "shell.read", kind: "view", scope: "project", permission: "view", args: v.object({ projectId: v.id() }), handler: async () => ({ allowed: true }) }),
      defineOp({ op: "shell.edit", kind: "view", scope: "project", permission: "project.edit", args: v.object({ projectId: v.id() }), handler: async () => ({ elevated: true }) }),
      defineOp({ op: "shell.anchor", kind: "view", scope: "project", permission: "view", projectFrom: { schema: "DocNote", arg: "noteId" }, args: v.object({ noteId: v.id() }), handler: async () => ({ leaked: true }) }),
    ] }, { rawGateway: () => raw, gatewayDeadline: null });
    const context = { context: { tenantId: "factory-tenant", userId: "provider|person", email: "person@example.test", roles: [], isAuthenticated: true, identitySource: "iam" },
      shellScope: { workspaceId: "workspace-a", projectId: "project-a", permissions: ["view" as const] },
      env: { BLOCKS_API_URL: "https://api.example.test", BLOCKS_TENANT: "factory-tenant", SVC_CLIENT_ID: "test-client", SVC_CLIENT_SECRET: "synthetic-test-secret" } };
    const invoke = (op: string, args: Record<string, unknown>) => router.dispatch({ method: "POST", path: "/project", query: {}, headers: {}, body: { op, args, requestId: randomUUID() } }, context);
    expect((await invoke("shell.read", { projectId: "project-a" })).statusCode).toBe(200);
    expect((await invoke("shell.edit", { projectId: "project-a" })).statusCode).toBe(403);
    expect((await invoke("shell.anchor", { noteId: "foreign-note" })).statusCode).toBe(403);
    expect((await invoke("shell.read", { projectId: "project-b" })).statusCode).toBe(403);
  });
});

describe("initial product kind selection", () => {
  const scope = { workspaceId: "workspace-a", projectId: "project-a", identity: identity(), permissions: ["view", "project.edit"] as ("view" | "project.edit")[] };
  const setup = () => {
    const memory = memoryGateway();
    memory.rows.set("Project", [{ ItemId: "project-a", WorkspaceId: "workspace-a", CreatedByUserId: "original-creator", Name: "Portal", Stage: "business", Status: "active", RepoMode: "new", BlocksProjectRef: "existing-blocks-tenant", RepoOwner: "company", RepoName: "portal", RepoBranch: "main" }]);
    return memory;
  };
  it("changes only product metadata and preserves the tenant and repository", async () => {
    const { raw, rows } = setup(); const before = { ...rows.get("Project")![0] };
    const answer = await setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" });
    expect(answer.RepoMode).toBe("existing");
    expect(rows.get("Project")![0]).toEqual({ ...before, RepoMode: "existing", UpdatedByUserId: scope.identity.userId });
    expect((await setProjectKind(raw, scope, { projectId: "project-a", kind: "greenfield" })).RepoMode).toBe("new");
  });
  it("rejects read-only callers, wrong projects, unsupported kinds and additional fields", async () => {
    const { raw } = setup();
    await expect(setProjectKind(raw, { ...scope, permissions: ["view"] }, { projectId: "project-a", kind: "brownfield" })).rejects.toThrow("forbidden");
    await expect(setProjectKind(raw, scope, { projectId: "project-b", kind: "brownfield" })).rejects.toThrow("scope_mismatch");
    await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "greyfield" })).rejects.toThrow("invalid_product_kind");
    await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield", BlocksProjectRef: "another-tenant" })).rejects.toThrow("invalid_product_kind");
  });
  it("locks the choice after hand-over or while any project job is active", async () => {
    const { raw, rows } = setup(); const project = rows.get("Project")![0];
    project.Stage = "analysis";
    await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" })).rejects.toThrow("product_kind_locked");
    project.Stage = "business"; project.BusinessHandedOverAt = new Date(now).toISOString();
    await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" })).rejects.toThrow("product_kind_locked");
    project.BusinessHandedOverAt = "";
    for (const status of ["queued", "claimed", "running"]) {
      rows.set("EngineJob", [{ ItemId: "job", WorkspaceId: "workspace-a", ProjectId: "project-a", Status: status }]);
      await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" })).rejects.toThrow("project_work_active");
    }
    rows.get("EngineJob")![0].Status = "succeeded";
    expect((await setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" })).RepoMode).toBe("existing");
  });
  it("serializes the choice with a hand-over command for the same project", async () => {
    const { raw, rows } = setup(); const lane = createProjectActionLane();
    let finish!: () => void; const gate = new Promise<void>((resolve) => { finish = resolve; });
    const handover = lane("project-a", async () => { await gate; rows.get("Project")![0].Stage = "analysis"; });
    const change = lane("project-a", () => setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" }));
    finish(); await handover;
    await expect(change).rejects.toThrow("product_kind_locked");
  });
  it("refuses a cross-host hand-over that wins between the job check and conditional update", async () => {
    const { raw, rows } = setup(); const originalFind = raw.find;
    raw.find = async (schema, options) => {
      const answer = await originalFind(schema, options);
      if (schema === "EngineJob") rows.get("Project")![0].Stage = "analysis";
      return answer;
    };
    await expect(setProjectKind(raw, scope, { projectId: "project-a", kind: "brownfield" })).rejects.toThrow("product_kind_locked");
    expect(rows.get("Project")![0].RepoMode).toBe("new");
  });
});

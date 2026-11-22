import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A ready tenant syncs the project's registry (registryWriter.ts, through engineBridge's paths): into a temporary
// folder here, never into engine/selise-madp/MADP/projects of the repository.
const paths = vi.hoisted(() => ({ projectsDir: "", artifactsDir: "" }));
vi.mock("../../server/api/engineBridge.ts", () => ({ paths }));
import { createProvisioner, provisioningName, type ProvisioningRow, type ProvisioningStore } from "../../server/blocks/provisioning";
import { createProvisioningCli, tenantFromCli } from "../../server/blocks/provisioningCli";

let root = "";
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-provisioning-"));
  paths.projectsDir = path.join(root, "projects");
  paths.artifactsDir = path.join(root, "artifacts");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ID = "887d4e76-ffcb-42e5-80ad-f90f77f8d266";
const tenant = { tenantId: "D177a8535d9e94f9d8909569ff6c98b0f", domain: "https://product.example.org", environment: "dev" as const };
function fixture(initial: ProvisioningRow = {}) {
  let row: ProvisioningRow = { ItemId: ID, Name: "A product", Status: "active", BlocksProvisioningStatus: "pending", ...initial };
  const store: ProvisioningStore = {
    list: vi.fn(async () => [structuredClone(row)]),
    get: vi.fn(async () => structuredClone(row)),
    change: vi.fn(async (previous, patch) => {
      if (["BlocksProjectRef", "BlocksProvisioningStatus", "BlocksProvisioningName", "BlocksProvisioningAt"].some((key) => row[key] !== previous[key])) return false;
      row = { ...row, ...patch };
      return true;
    }),
  };
  const cli = { preview: vi.fn(async (_name: string) => undefined), create: vi.fn(async (_name: string) => tenant), find: vi.fn(async (_name: string) => null as typeof tenant | null) };
  return { store, cli, row: () => row };
}

describe("main-account tenant provisioner", () => {
  it("previews, atomically claims, creates once, and persists the tenant/domain", async () => {
    const f = fixture();
    const worker = createProvisioner(f.store, f.cli);
    await Promise.all([worker.enqueue(ID), worker.enqueue(ID)]);
    expect(f.cli.preview).toHaveBeenCalledOnce();
    expect(f.cli.create).toHaveBeenCalledExactlyOnceWith(provisioningName(f.row()));
    expect(f.row()).toMatchObject({ BlocksProjectRef: tenant.tenantId, BlocksProjectDomain: tenant.domain, BlocksProvisioningStatus: "ready" });
    expect(f.store.change).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(paths.projectsDir, "a-product.yml"), "utf8")).toContain(`tenant_id: "${tenant.tenantId}"`);
  });
  it("two hosts competing for the same pending project cannot both create", async () => {
    const f = fixture();
    await Promise.all([createProvisioner(f.store, f.cli).enqueue(ID), createProvisioner(f.store, f.cli).enqueue(ID)]);
    expect(f.cli.create).toHaveBeenCalledOnce();
  });
  it("preview failure never claims or creates and is safe to retry", async () => {
    const f = fixture();
    f.cli.preview.mockRejectedValueOnce(new Error("expired account"));
    const worker = createProvisioner(f.store, f.cli);
    await expect(worker.enqueue(ID)).rejects.toThrow();
    expect(f.row().BlocksProvisioningStatus).toBe("pending");
    expect(f.cli.create).not.toHaveBeenCalled();
    await worker.enqueue(ID);
    expect(f.cli.create).toHaveBeenCalledOnce();
  });
  it("uncertain creation is reconciled, never automatically resubmitted", async () => {
    const f = fixture();
    f.cli.create.mockRejectedValueOnce(new Error("timeout"));
    const worker = createProvisioner(f.store, f.cli);
    await worker.enqueue(ID);
    expect(f.row().BlocksProvisioningStatus).toBe("needs-reconciliation");
    await worker.enqueue(ID);
    expect(f.cli.create).toHaveBeenCalledOnce();
    expect(f.row().BlocksProvisioningStatus).toBe("needs-reconciliation");
    f.cli.find.mockResolvedValueOnce(tenant);
    await worker.enqueue(ID);
    expect(f.row().BlocksProjectRef).toBe(tenant.tenantId);
    expect(f.cli.create).toHaveBeenCalledOnce();
  });
  it("recovers a tenant when the ready-state Gateway write failed", async () => {
    const f = fixture();
    const original = f.store.change;
    let fail = true;
    f.store.change = async (row, patch) => {
      if (patch.BlocksProvisioningStatus === "ready" && fail) { fail = false; throw new Error("Gateway unavailable"); }
      return original(row, patch);
    };
    await createProvisioner(f.store, f.cli).enqueue(ID);
    f.cli.find.mockResolvedValueOnce(tenant);
    await createProvisioner(f.store, f.cli).enqueue(ID);
    expect(f.row().BlocksProvisioningStatus).toBe("ready");
    expect(f.cli.create).toHaveBeenCalledOnce();
  });
  it("never creates a Blocks project for an existing product: it stays pending until an operator links it", async () => {
    const f = fixture({ RepoMode: "existing" });
    const worker = createProvisioner(f.store, f.cli);
    await worker.enqueue(ID);
    await worker.scan();
    expect(f.cli.preview).not.toHaveBeenCalled();
    expect(f.cli.create).not.toHaveBeenCalled();
    expect(f.store.change).not.toHaveBeenCalled();
    expect(f.row()).toMatchObject({ BlocksProvisioningStatus: "pending" });
    expect(f.row().BlocksProjectRef).toBeUndefined();
  });
  it("never reconciles a stale attempt into an existing product either", async () => {
    const f = fixture({ RepoMode: "existing", BlocksProvisioningStatus: "needs-reconciliation", BlocksProvisioningName: "MADP stored name" });
    f.cli.find.mockResolvedValue(tenant);
    await createProvisioner(f.store, f.cli).scan();
    expect(f.cli.find).not.toHaveBeenCalled();
    expect(f.row().BlocksProjectRef).toBeUndefined();
  });
  it("a restart does not resubmit a stale creating attempt", async () => {
    const f = fixture({ BlocksProvisioningStatus: "creating", BlocksProvisioningName: "MADP stored name", BlocksProvisioningAt: "2020-01-01T00:00:00.000Z" });
    f.cli.find.mockResolvedValueOnce(tenant);
    await createProvisioner(f.store, f.cli).scan();
    expect(f.cli.find).toHaveBeenCalledWith("MADP stored name");
    expect(f.cli.create).not.toHaveBeenCalled();
    expect(f.row().BlocksProvisioningStatus).toBe("ready");
  });
  it.each([{ BlocksProjectRef: tenant.tenantId }, { Status: "deleting" }, { BlocksProvisioningStatus: null }, { BlocksProvisioningStatus: "creating", BlocksProvisioningAt: new Date().toISOString() }])("never provisions linked, deleting, legacy or live-inflight projects: %j", async (initial) => {
    const f = fixture(initial);
    await createProvisioner(f.store, f.cli).enqueue(ID);
    expect(f.cli.preview).not.toHaveBeenCalled();
    expect(f.cli.create).not.toHaveBeenCalled();
  });
});

describe("CLI boundary", () => {
  it("requires an explicit account and only accepts verified development results", () => {
    expect(() => createProvisioningCli("")).toThrow();
    expect(() => createProvisioningCli("default; echo unsafe")).toThrow();
    expect(tenantFromCli({ ...tenant, verified: true })).toEqual(tenant);
    for (const bad of [{ ...tenant, verified: false }, { ...tenant, verified: true, domain: "http://example.org" }, { ...tenant, verified: true, environment: "prod" }]) expect(() => tenantFromCli(bad)).toThrow();
  });
  it("rejects shell metacharacters before launching a creation command", async () => {
    const run = vi.fn();
    const cli = createProvisioningCli("default", run as never);
    await expect(cli.preview("Product & echo unsafe")).rejects.toThrow();
    await expect(cli.create("Product'; echo unsafe")).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("parses actual grouped projects-list results without treating shared/other environments as a match", async () => {
    const run = vi.fn(async () => ({ stdout: JSON.stringify([{ projects: [{ name: "Exact", ...tenant, applications: [{ domain: tenant.domain }] }] }]) }));
    const cli = createProvisioningCli("default", run as never);
    expect(await cli.find("Exact")).toEqual(tenant);
    expect(await cli.find("Missing")).toBeNull();
  });
  it("never adopts a shared project from another owner's account", async () => {
    const run = vi.fn(async () => ({ stdout: JSON.stringify([{ isShared: true, projects: [{ name: "Exact", ...tenant, applications: [{ domain: tenant.domain }] }] }]) }));
    expect(await createProvisioningCli("default", run as never).find("Exact")).toBeNull();
  });
});

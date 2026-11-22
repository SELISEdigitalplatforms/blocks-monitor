import type { ProvisionedTenant } from "./provisioningCli.ts";
import { syncProjectRegistry } from "../api/registryWriter.ts";

export const PROVISIONING_FIELDS = ["ItemId", "Name", "Status", "WorkspaceId", "CreatedByUserId", "BlocksProjectRef", "BlocksProjectDomain", "BlocksProvisioningStatus", "BlocksProvisioningName", "BlocksProvisioningAt", "BlocksProvisioningError", "RepoMode"];
export type ProvisioningRow = Record<string, unknown>;
export interface ProvisioningStore {
  list(): Promise<ProvisioningRow[]>;
  get(id: string): Promise<ProvisioningRow | null>;
  /** Atomic compare-and-set. Unknown/failed Gateway results must throw, never count as a claim. */
  change(row: ProvisioningRow, patch: ProvisioningRow): Promise<boolean>;
}
interface Cli {
  preview(name: string): Promise<void>;
  create(name: string): Promise<ProvisionedTenant>;
  find(name: string): Promise<ProvisionedTenant | null>;
  /** After the project is saved ready: MF_BLOCKS_PROJECT_MEMBERS become its members (provisioningMembers.ts). */
  addMembers?(tenant: ProvisionedTenant): Promise<void>;
}

export function provisioningName(row: ProvisioningRow): string {
  const id = String(row.ItemId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("provisioning_invalid_project");
  const label = String(row.Name ?? "Project").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, " ").trim().slice(0, 45) || "Project";
  return `MADP ${label} ${id}`;
}

/** A brownfield project (Project.RepoMode "existing", src/domain/projectType.ts): its Blocks project exists already. */
export const isExistingProduct = (row: ProvisioningRow): boolean => row.RepoMode === "existing";

/** One serialized worker per host; Gateway CAS arbitrates across hosts/restarts. */
export function createProvisioner(store: ProvisioningStore, cli: Cli, now = Date.now) {
  let queue = Promise.resolve();
  let stopped = false;
  async function saveReady(row: ProvisioningRow, tenant: ProvisionedTenant) {
    const patch = {
      BlocksProjectRef: tenant.tenantId, BlocksProjectDomain: tenant.domain,
      BlocksProvisioningStatus: "ready", BlocksProvisioningError: "", BlocksProvisioningAt: new Date(now()).toISOString(),
    };
    if (!await store.change(row, patch)) throw new Error("provisioning_save_conflict");
    try { syncProjectRegistry({ ...row, ...patch }); } catch {}
  }
  // Best effort and only once the project is saved ready: a failure here never changes its provisioning state.
  async function addMembers(tenant: ProvisionedTenant) {
    try { await cli.addMembers?.(tenant); } catch {}
  }
  async function run(id: string) {
    let row = await store.get(id);
    if (!row || row.Status !== "active" || row.BlocksProjectRef) return;
    // An existing product already has its Blocks tenant: it is never given a new one. It stays as it is until an
    // operator links it (frontend/scripts/attach-existing-product.mjs).
    if (isExistingProduct(row)) return;
    const status = row.BlocksProvisioningStatus;
    if (status === "creating" || status === "needs-reconciliation") {
      // Do not reconcile a live creation running on another host. Never issue
      // another create for an uncertain attempt, even when list returns no match.
      const started = Date.parse(String(row.BlocksProvisioningAt));
      if (status === "creating" && (!Number.isFinite(started) || now() - started < 600_000)) return;
      if (typeof row.BlocksProvisioningName !== "string" || !row.BlocksProvisioningName) return;
      const tenant = await cli.find(row.BlocksProvisioningName);
      if (tenant) {
        await saveReady(row, tenant);
        await addMembers(tenant);
      }
      return;
    }
    if (status !== "pending") return;
    const name = provisioningName(row);
    // All preflight work happens before claiming an attempt. Preview failure is
    // safe to retry; after a claim no path is allowed to resubmit creation.
    await cli.preview(name);
    const at = new Date(now()).toISOString();
    const claim = { BlocksProvisioningStatus: "creating", BlocksProvisioningName: name, BlocksProvisioningAt: at, BlocksProvisioningError: "" };
    if (!await store.change(row, claim)) return;
    row = { ...row, ...claim };
    let tenant: ProvisionedTenant;
    try {
      tenant = await cli.create(name);
      await saveReady(row, tenant);
    } catch {
      await store.change(row, { BlocksProvisioningStatus: "needs-reconciliation", BlocksProvisioningError: "Creation could not be confirmed. Reconciliation is required; do not create another tenant." });
      return;
    }
    await addMembers(tenant);
  }
  const enqueue = (id: string) => {
    if (stopped) return Promise.resolve();
    const task = queue.then(() => run(id));
    // Keep worker errors out of HTTP responses/logs; persistent attempt state is authoritative.
    queue = task.catch(() => undefined);
    return task;
  };
  let scanning = false;
  return {
    enqueue,
    async scan() {
      if (stopped || scanning) return;
      scanning = true;
      try { for (const row of await store.list()) { if (stopped) break; await enqueue(String(row.ItemId)); } }
      finally { scanning = false; }
    },
    async stop() { stopped = true; await queue; },
  };
}

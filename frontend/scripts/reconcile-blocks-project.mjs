// Operator-only attachment/recovery tool. Never creates a cloud project.
import { createServer, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const id = args[args.indexOf("--project-id") + 1];
const name = args[args.indexOf("--os-name") + 1];
if (!args.includes("--project-id") || !args.includes("--os-name") || !/^[0-9a-f-]{36}$/i.test(id) || !name) {
  console.error("Usage: node scripts/reconcile-blocks-project.mjs --project-id <id> --os-name <exact OS name> [--apply]");
  process.exit(1);
}
const env = { ...loadEnv("development", root, ""), ...process.env };
const server = await createServer({ configFile: false, root, envDir: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
try {
  const { createProvisioningStore } = await server.ssrLoadModule("/server/blocks/provisioningStore.ts");
  const { createProvisioningCli } = await server.ssrLoadModule("/server/blocks/provisioningCli.ts");
  const store = createProvisioningStore(env, env.VITE_BLOCKS_API_URL);
  const row = await store.get(id);
  if (!row || row.Status !== "active") throw new Error("Project not active or accessible");
  const tenant = await createProvisioningCli(env.MF_BLOCKS_PROVISIONING_ACCOUNT || "default").find(name);
  if (!tenant || (row.BlocksProjectRef && row.BlocksProjectRef !== tenant.tenantId)) throw new Error("Tenant missing or conflicting attachment");
  const patch = { BlocksProjectRef: tenant.tenantId, BlocksProjectDomain: tenant.domain,
    BlocksProvisioningName: name, BlocksProvisioningStatus: "ready", BlocksProvisioningError: "", BlocksProvisioningAt: new Date().toISOString() };
  console.log(JSON.stringify({ dryRun: !args.includes("--apply"), projectId: id, patch }));
  if (args.includes("--apply")) {
    if (!await store.change(row, patch)) throw new Error("Concurrent change; attachment not applied");
    const saved = await store.get(id);
    if (saved?.BlocksProjectRef !== tenant.tenantId || saved?.BlocksProjectDomain !== tenant.domain || saved?.BlocksProvisioningStatus !== "ready") throw new Error("Attachment could not be verified");
    console.log(JSON.stringify({ verified: true, projectId: id, tenantId: saved.BlocksProjectRef, domain: saved.BlocksProjectDomain, status: saved.BlocksProvisioningStatus }));
  }
} catch {
  console.error("Reconciliation failed. Check the Gateway configuration and operator CLI session; no new tenant was created.");
  process.exitCode = 1;
} finally { await server.close(); }

// Move the Factory's roles, permissions and grants into Blocks IAM (server/iam/migrate): IAM permissions per Factory
// permission key, mf-platform-/mf-org-/mf-tpl- roles with their permissions, one IAM organization per workspace (linked
// through Workspace.IamOrganizationId), and every person's platform-wide and per-organization role grants.
// Without --apply it only prints the plan (a dry run reads IAM and the Data Gateway and writes nothing but the local
// report under data/iam-migrate/). --apply runs permissions -> roles -> organizations -> organization grants -> link
// (Workspace.IamOrganizationId, only once every member's grant went through) -> platform grants; a rerun only does what
// is left. It never switches rbac.source. --prune also takes away Factory roles IAM holds that the Factory no longer gives.
//
//   node scripts/iam-migrate.mjs [--dry-run | --apply] [--only <step>[,<step>]] [--prune] [--report <file>] [--env-file <file>]
//
// The service identity comes from MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET (environment, .env or
// --env-file). The TypeScript is loaded through a middleware-mode Vite server (no port), like the backfills.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";
const { createServer } = await import("vite");
const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  appType: "custom",
  cacheDir: path.join(root, ".vite-cache", "iam-migrate"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
try {
  const { migrateMain, runMain } = await server.ssrLoadModule("/server/iam/migrate/main.ts");
  process.exitCode = await runMain(() => migrateMain(process.argv.slice(2), root));
} finally {
  await server.close();
}

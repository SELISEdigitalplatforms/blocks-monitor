// Sync only the web host's settings; never upload engine or developer credentials.
import { loadEnv } from "vite";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const apply = process.argv.slice(2);
if (apply.some((arg) => arg !== "--yes") || apply.length > 1) throw new Error("Usage: node scripts/sync-factory-release.mjs [--yes]");
const root = fileURLToPath(new URL("..", import.meta.url));
const env = loadEnv("production", root, "");
const tenant = "D9c1e01c294f04d9e8af59b5caf80ebcb";
if (env.MF_BLOCKS_TENANT !== tenant) throw new Error("Local service identity must target MADP Factory dev");
const names = ["MF_BLOCKS_TENANT", "MF_SVC_CLIENT_ID", "MF_SVC_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "MF_GITHUB_TOKEN_KEY", "MF_FACTORY_DESIGN_WORKER_ID", "MF_FIGMA_DESIGN_WORKER_ID", "MF_EXTRACTION_WORKER_ID"];
for (const name of names.slice(0, 3)) if (!env[name]) throw new Error(`Missing local setting: ${name}`);
const values = {
  MF_APP_ORIGIN: "https://dbsaun-dwflm.slsblx.com",
  VITE_BLOCKS_API_URL: env.VITE_BLOCKS_API_URL || "https://api.seliseblocks.com",
  VITE_BLOCKS_PROJECT_KEY: tenant,
  ...Object.fromEntries(names.filter((name) => env[name]).map((name) => [name, env[name]])),
};
// A short-lived dotenv file is required by the CLI; its values never reach stdout.
const dir = mkdtempSync(path.join(tmpdir(), "factory-release-"));
const file = path.join(dir, "release.env");
try {
  for (const value of Object.values(values)) {
    if (/[\r\n\0]/.test(value)) throw new Error("Release settings must be single-line values");
  }
  writeFileSync(file, Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  const args = ["release", "secrets", "sync", "--repo", "1f68600b-9be7-4d10-9071-de752f923dbf", "--account", "default", "--project", tenant,
    "--file", file, apply.length ? "--yes" : "--dry-run", "--json"];
  const result = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-Command", `& blocks.cmd ${args.map((arg) => `'${arg.replaceAll("'", "''")}'`).join(" ")}`], { stdio: "inherit", env: { ...process.env, BLOCKS_STRICT_FLAGS: "1" } })
    : spawnSync("blocks", args, { stdio: "inherit", env: { ...process.env, BLOCKS_STRICT_FLAGS: "1" } });
  if (result.error) throw new Error("Could not start the Blocks CLI");
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(file, { force: true });
  rmdirSync(dir);
}

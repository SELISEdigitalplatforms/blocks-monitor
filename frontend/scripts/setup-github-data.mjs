// Isolated CLI migration: only GithubConnection and its service-only policies.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = new URL("..", import.meta.url);
const stage = await mkdtemp(join(process.platform === "win32" ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir(), "github-schema-"));
await mkdir(join(stage, "blocks", "data", "schemas"), { recursive: true });
await copyFile(new URL("blocks/data/schemas/GithubConnection.json", root), join(stage, "blocks", "data", "schemas", "GithubConnection.json"));
await copyFile(new URL("blocks/data/migrations/github-rules.json", root), join(stage, "blocks", "data", "rules.json"));
const flag = process.argv.includes("--apply") ? "--yes" : "--dry-run";
const argv = ["data", "sync", "--account", "default", "--project", "D9c1e01c294f04d9e8af59b5caf80ebcb", flag, "--json"];
const windows = process.platform === "win32";
const script = `& blocks.cmd data sync --account default --project D9c1e01c294f04d9e8af59b5caf80ebcb ${flag} --json; exit $LASTEXITCODE`;
try {
  const { stdout } = await promisify(execFile)(windows ? "powershell.exe" : "blocks", windows ? ["-NoProfile", "-NonInteractive", "-Command", script] : argv,
    { cwd: stage, env: { ...process.env, BLOCKS_STRICT_FLAGS: "1" }, timeout: 120_000, maxBuffer: 2_000_000 });
  console.log(stdout);
} catch {
  console.error("GitHub schema migration did not complete. Inspect CLI status before retrying; never store credentials until service-only policies are live.");
  process.exitCode = 1;
}

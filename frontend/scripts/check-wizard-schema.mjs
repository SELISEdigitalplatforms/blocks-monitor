// Read-only check of the dashboard wizard and immediate Project setup contracts.
// Account/tenant selection is explicit; the CLI owns all credentials.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
const args = process.argv.slice(2);
const account = args.includes("--account") ? args[args.indexOf("--account") + 1] : "default";
const project = args.includes("--project") ? args[args.indexOf("--project") + 1] : "D9c1e01c294f04d9e8af59b5caf80ebcb";
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(account) || !/^[a-zA-Z0-9]{1,64}$/.test(project)) throw new Error("Invalid account or project selection");
const windows = process.platform === "win32";
try {
  const { stdout } = await promisify(execFile)(windows ? "powershell.exe" : "blocks", windows
    ? ["-NoProfile", "-NonInteractive", "-Command", "& blocks.cmd data schema list --account $env:WIZARD_AUDIT_ACCOUNT --project $env:WIZARD_AUDIT_PROJECT --json; exit $LASTEXITCODE"]
    : ["data", "schema", "list", "--account", account, "--project", project, "--json"],
  { env: { ...process.env, BLOCKS_STRICT_FLAGS: "1", WIZARD_AUDIT_ACCOUNT: account, WIZARD_AUDIT_PROJECT: project }, windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
  const result = JSON.parse(stdout);
  if (result.isSuccess !== true || result.errors?.length || !Array.isArray(result.data?.items)) throw new Error("Invalid schema response");
  const contracts = ["Project", "DocNote", "DocFolder", "DocFile", "AuditEvent", "Operation", "EngineJob", "ProjectAnswer"];
  const checks = [];
  for (const name of contracts) {
    const local = JSON.parse(await readFile(new URL(`../blocks/data/schemas/${name}.json`, import.meta.url), "utf8"));
    const live = result.data.items.find((schema) => schema.schemaName === name);
    const missing = [], mismatched = [];
    for (const field of local.fields) {
      const actual = live?.fields?.find((value) => value.name === field.name);
      if (!actual) missing.push(field.name);
      else if (actual.type !== field.type || Boolean(actual.isArray) !== Boolean(field.isArray)) mismatched.push(field.name);
    }
    checks.push({ schema: name, present: Boolean(live), missing, mismatched });
  }
  const ok = checks.every((check) => check.present && !check.missing.length && !check.mismatched.length);
  console.log(JSON.stringify({ ok, scope: "Dashboard wizard creation and immediate setup/material reads; not downstream engine execution or GitHub OAuth", checks }, null, 2));
  if (!ok) process.exitCode = 1;
} catch {
  // Do not print child-process errors: they can contain raw account/API diagnostics.
  console.error("Wizard schema audit failed. Check the CLI session and Factory project access.");
  process.exitCode = 1;
}

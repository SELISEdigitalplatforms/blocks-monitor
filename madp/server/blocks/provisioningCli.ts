import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serializedBlocks } from "./cliQueue.ts";
import { addProjectMembers, neutralCwd, projectMembers, provisioningStore, type ExecRun, type MembersDeps } from "./provisioningMembers.ts";

const exec = promisify(execFile);
export interface ProvisionedTenant { tenantId: string; domain: string; environment: "dev" }
type Json = Record<string, unknown>;
const rec = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};

export function tenantFromCli(value: unknown): ProvisionedTenant {
  const result = rec(value);
  if (result.verified !== true || typeof result.tenantId !== "string" || !/^D[0-9a-f]{32}$/i.test(result.tenantId)) throw new Error("provisioning_unconfirmed");
  const domain = typeof result.domain === "string" ? result.domain : "";
  const url = new URL(domain);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || result.environment !== "dev") throw new Error("provisioning_unconfirmed");
  return { tenantId: result.tenantId, domain: url.origin, environment: "dev" };
}

export interface ProvisioningCliOptions {
  /** The people made members of every project it creates (MF_BLOCKS_PROJECT_MEMBERS; provisioningMembers.ts). */
  members?: string[];
  /** The account's CLI login store (the engine's BLOCKS_CONFIG_DIR, else the CLI's default store). */
  store?: string;
  log?: (line: string) => void;
  fetch?: MembersDeps["fetch"];
  now?: MembersDeps["now"];
}

/** An explicit operator-selected CLI account; never the Factory caller's token. */
export function createProvisioningCli(account: string, run = exec, o: ProvisioningCliOptions = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(account)) throw new Error("provisioning_account_required");
  const store = o.store ?? provisioningStore();
  const members = o.members ?? projectMembers();
  const log = o.log ?? ((line: string) => console.log(line));
  let queue = Promise.resolve();
  const call = (args: string[]): Promise<unknown> => {
    const task = queue.then(() => serializedBlocks(async () => {
      const argv = [...args, "--account", account, "--json"];
      // Windows .cmd entry points require a command interpreter. Pass all dynamic
      // values as encoded JSON, never interpolate names or ids into shell syntax.
      const windows = process.platform === "win32";
      const encoded = Buffer.from(JSON.stringify(argv), "utf8").toString("base64");
      const script = `$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); & blocks.cmd @a; exit $LASTEXITCODE`;
      try {
        // never in the engine's own folder: a blocks.json there (the Factory's own project) would make `projects list`
        // start a project session in this store, which leaves it without the account session provisioning needs
        const { stdout } = await run(windows ? "powershell.exe" : "blocks", windows ? ["-NoProfile", "-NonInteractive", "-Command", script] : argv, {
          cwd: neutralCwd(store), windowsHide: true, timeout: 180_000, maxBuffer: 1_048_576,
          // the store named explicitly (the CLI's own default unless the engine sets BLOCKS_CONFIG_DIR), so these calls
          // and addMembers always use the same sign-in
          env: { ...process.env, BLOCKS_CONFIG_DIR: store, BLOCKS_STRICT_FLAGS: "1" },
        });
        return JSON.parse(String(stdout));
      } catch {
        // Child-process errors contain stdout/stderr and may include sensitive account data.
        throw new Error("provisioning_cli_failed");
      }
    }));
    queue = task.then(() => undefined, () => undefined);
    return task;
  };
  return {
    async preview(name: string) {
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,99}$/.test(name)) throw new Error("provisioning_invalid_name");
      const result = rec(await call(["projects", "create", name, "--dry-run"]));
      const request = rec(result.request);
      if (result.dryRun !== true || request.name !== name || request.isAcceptBlocksTerms !== true || request.isUseBlocksExclusively !== true) throw new Error("provisioning_preview_failed");
    },
    async create(name: string) {
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,99}$/.test(name)) throw new Error("provisioning_invalid_name");
      return tenantFromCli(await call(["projects", "create", name, "--yes"]));
    },
    async find(name: string): Promise<ProvisionedTenant | null> {
      const value = await call(["projects", "list"]);
      const root = rec(value);
      const rows = Array.isArray(value) ? value : root.projects;
      if (!Array.isArray(rows)) throw new Error("provisioning_unconfirmed");
      const projects = rows.filter((group) => rec(group).isShared !== true).flatMap((group) => Array.isArray(rec(group).projects) ? rec(group).projects as unknown[] : [group]).map(rec);
      const matches = projects.filter((row) => row.name === name && row.environment === "dev" && row.isDisabled !== true);
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw new Error("provisioning_ambiguous");
      const row = matches[0];
      const apps = Array.isArray(row.applications) ? row.applications.map(rec) : [];
      if (apps.length !== 1) throw new Error("provisioning_unconfirmed");
      return tenantFromCli({ verified: true, tenantId: row.tenantId, domain: apps[0].domain, environment: "dev" });
    },
    /** Best effort, once the project is saved ready: the configured people become its members. Never throws. */
    async addMembers(tenant: ProvisionedTenant): Promise<void> {
      if (!members.length) return;
      await addProjectMembers(
        { tenant: tenant.tenantId, label: `new project ${tenant.tenantId.slice(0, 7)}`, account, store, members },
        { log: (line) => log(`[engine] ${line}`), run: run as unknown as ExecRun, fetch: o.fetch, now: o.now },
      );
    },
  };
}

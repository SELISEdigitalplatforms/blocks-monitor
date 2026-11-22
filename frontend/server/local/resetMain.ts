// The reset itself (run by reset.mjs in the functions' module graph): wipe, seed, print the sign-in accounts.
import fs from "node:fs";
import path from "node:path";
import { DATA_TABLES, inTransaction } from "./db.ts";
import { IAM_SUPER_ADMIN_ROLE } from "./iam/store.ts";
import { LOCAL_ORIGIN, initRuntime, type LocalRuntime } from "./runtime.ts";
import { createSeedTarget, iamRolesOf, type SeedSummary, type SeedTarget, type SeedUser } from "./seedTarget.ts";

/** Until frontend/seed exists: the platform's first super admin, nothing else. */
const FIRST_ADMIN: SeedUser = {
  key: "platform-admin",
  email: "platform.admin@madp-factory.local",
  displayName: "Platform Admin",
  password: "Factory-2026!",
  platformRoles: ["mf-super-admin"],
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function wipe(rt: LocalRuntime): void {
  inTransaction(rt.db, () => {
    for (const t of DATA_TABLES) rt.db.exec(`DELETE FROM ${t}`);
  });
  fs.rmSync(rt.paths.filesDir, { recursive: true, force: true });
  fs.mkdirSync(rt.paths.filesDir, { recursive: true });
  rt.store.reload();
}

export async function reset(o: { root: string }): Promise<void> {
  const rt = initRuntime({ root: o.root, appOrigin: LOCAL_ORIGIN, log: () => undefined });
  wipe(rt);
  const now = new Date();
  const base = createSeedTarget(rt, now);
  const accounts: SeedUser[] = [];
  const target: SeedTarget = {
    ...base,
    async createUser(u) {
      const made = await base.createUser(u);
      accounts.push(u);
      return made;
    },
  };

  let summary: SeedSummary;
  const seedEntry = path.join(o.root, "seed", "index.ts");
  if (fs.existsSync(seedEntry)) {
    // A variable specifier: the seed may not exist yet, so nothing resolves it before this line runs.
    const entry = "/seed/index.ts";
    const seed = (await import(/* @vite-ignore */ entry)) as { seedAll(t: SeedTarget): Promise<SeedSummary> };
    summary = await seed.seedAll(target);
  } else {
    await target.createUser(FIRST_ADMIN);
    summary = { users: 1, workspaces: 0, projects: 0, rows: 0, files: 0 };
  }

  const rows = rt.store.schemaNames().reduce((n, s) => n + rt.store.rows(s).length, 0);
  console.log(
    `\nMADP Factory store reset: ${plural(summary.users, "person", "people")}, ${plural(summary.workspaces, "workspace")}, ${plural(summary.projects, "project")}, ${plural(rows, "row")}, ${plural(base.storedFiles(), "file")}.`,
  );
  console.log(`Sign in at ${LOCAL_ORIGIN}\n`);
  const width = Math.max(...accounts.map((a) => a.email.length), 5);
  const deactivated = new Set(
    rt.store
      .rows("Account")
      .filter((r) => r.Status === "deactivated" && typeof r.Email === "string")
      .map((r) => String(r.Email).toLowerCase()),
  );
  for (const a of accounts) {
    const admin = iamRolesOf(a.platformRoles).includes(IAM_SUPER_ADMIN_ROLE) ? "  super admin" : "";
    const off = deactivated.has(a.email.toLowerCase()) ? "  (deactivated: sign-in refused)" : "";
    console.log(`  ${a.email.padEnd(width)}  ${a.password.padEnd(16)}  ${a.displayName}${admin}${off}`);
  }
  console.log("");
}

// Command entries of scripts/iam-migrate.mjs and scripts/iam-parity.mjs (loaded through a middleware-mode Vite server).
// Credentials come from the environment (MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID, MF_SVC_CLIENT_SECRET, VITE_BLOCKS_API_URL),
// the app's .env files, or --env-file; no value is ever printed or written to a report.
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { createRawGateway, type RawGateway } from "../../../functions/_lib/gateway";
import { createIamAdmin } from "../../../functions/_lib/iamAdmin";
import { defaultSdk } from "../../../functions/_lib/sdk";
import { serviceClient, serviceTokens } from "../../../functions/_lib/serviceToken";
import type { FnEnv } from "../../../functions/_lib/env";
import { IAM_PARITY_KEY, createLinkWriter, createMigrationPort, factoryUserIds, readFactorySnapshot, readIamSnapshot, recordParity } from "./adapter";
import { applyPlan, errorText, type IamAdminPort } from "./apply";
import { computeParity, describeParity } from "./parity";
import { STEPS, describePlan, isStep, planCounts, planMigration, type Step } from "./plan";

export interface Wiring {
  raw: RawGateway;
  port: IamAdminPort;
}

function argOf(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? "" : "";
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** The service identity's settings; null (with the reason printed) when one is missing. */
export function serviceEnv(argv: readonly string[], root: string, log: (l: string) => void): FnEnv | null {
  const file = argOf(argv, "--env-file");
  if (file && !fs.existsSync(file)) {
    log(`--env-file ${file} does not exist`);
    return null;
  }
  const e = { ...loadEnv("development", root, ""), ...(file ? readEnvFile(file) : {}), ...process.env } as Record<string, string | undefined>;
  const env: FnEnv = {
    apiUrl: (e.VITE_BLOCKS_API_URL || e.BLOCKS_API_URL || "https://blocksapi.slsblx.com").replace(/\/+$/, ""),
    tenant: e.MF_BLOCKS_TENANT || e.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: e.MF_SVC_CLIENT_ID || "",
    clientSecret: e.MF_SVC_CLIENT_SECRET || "",
  };
  if (!env.tenant || !env.clientId || !env.clientSecret) {
    log("MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET are needed (environment, the app's .env, or --env-file <bridge.env>).");
    return null;
  }
  return env;
}

/** The live wiring: the Data Gateway and IAM, both as the platform's service identity. */
export function liveWiring(env: FnEnv): Wiring {
  const tokens = serviceTokens(env, defaultSdk);
  const client = serviceClient(env, defaultSdk, tokens);
  return {
    raw: createRawGateway({ env, sdk: defaultSdk, tokens, batch: false }),
    port: createMigrationPort(createIamAdmin({ client }), client),
  };
}

const linkedOrgIds = (f: { workspaces: { iamOrganizationId: string | null }[] }): string[] =>
  f.workspaces.map((w) => w.iamOrganizationId).filter((x): x is string => !!x);

function stepsOf(argv: readonly string[]): Step[] | string {
  const only = argOf(argv, "--only");
  if (!only) return [...STEPS];
  const asked = only.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = asked.filter((s) => !isStep(s));
  if (bad.length || !asked.length) return `--only takes ${STEPS.join(", ")} (comma separated); got ${only}`;
  return STEPS.filter((s) => asked.includes(s));
}

function writeReport(file: string, body: unknown, log: (l: string) => void) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  log(`report: ${file}`);
}

const USAGE_MIGRATE =
  "Usage: node scripts/iam-migrate.mjs [--dry-run | --apply] [--only permissions,roles,organizations,grants,link] [--prune] [--report <file>] [--env-file <file>]";

/** iam-migrate: prints the plan; with --apply carries it out and writes a JSON report. */
export async function migrateMain(argv: string[], root: string, o: { wiring?: Wiring; log?: (l: string) => void; now?: () => Date } = {}): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const now = o.now ?? (() => new Date());
  if (argv.includes("--help")) {
    log(USAGE_MIGRATE);
    return 0;
  }
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    log("--apply and --dry-run exclude each other");
    return 1;
  }
  const steps = stepsOf(argv);
  if (typeof steps === "string") {
    log(steps);
    return 1;
  }
  let wiring = o.wiring;
  if (!wiring) {
    const env = serviceEnv(argv, root, log);
    if (!env) return 1;
    wiring = liveWiring(env);
  }
  const startedAt = now().toISOString();
  const factory = await readFactorySnapshot(wiring.raw);
  const prune = argv.includes("--prune");
  // Every IAM user: today's super admins (and, for --prune, grants the Factory rows no longer name) are found there.
  const iam = await readIamSnapshot(wiring.port, factoryUserIds(factory), { allUsers: true, organizationIds: linkedOrgIds(factory) });
  const plan = planMigration(factory, iam, { prune });
  for (const line of describePlan(plan)) log(line);
  const counts = planCounts(plan);
  const reportFile =
    argOf(argv, "--report") || path.join(root, "data", "iam-migrate", `${apply ? "apply" : "plan"}-${startedAt.replace(/[:.]/g, "-")}.json`);
  const base = {
    kind: "iam-migrate",
    mode: apply ? "apply" : "dry-run",
    steps,
    startedAt,
    factory: {
      platformRoles: factory.platformRoles.length,
      activeAssignments: factory.assignments.length,
      workspaces: factory.workspaces.length,
      workspaceRoles: factory.workspaceRoles.length,
      memberships: factory.memberships.length,
      workspaceLinkFieldReady: factory.workspaceLinkFieldReady,
    },
    iam: { permissions: iam.permissions.length, roles: iam.roles.length, organizations: iam.organizations.length, multiOrgEnabled: iam.multiOrgEnabled, users: Object.keys(iam.access).length },
    counts,
    plan,
  };
  if (!apply) {
    log(`dry run: nothing written to IAM or the Factory (add --apply). ${JSON.stringify(counts)}`);
    writeReport(reportFile, base, log);
    return 0;
  }
  log(`applying: ${steps.join(" -> ")}`);
  const result = await applyPlan(plan, wiring.port, createLinkWriter(wiring.raw), { steps, log });
  writeReport(reportFile, { ...base, finishedAt: now().toISOString(), result }, log);
  log(`${result.actions.length - result.failed - result.skipped} done, ${result.failed} failed, ${result.skipped} skipped`);
  return result.failed ? 1 : 0;
}

const USAGE_PARITY = "Usage: node scripts/iam-parity.mjs [--verbose] [--all-users] [--report <file>] [--no-record] [--env-file <file>]";

/** iam-parity: every person x organization (and platform): old resolver vs IAM. Exit 1 while any difference is left. */
export async function parityMain(argv: string[], root: string, o: { wiring?: Wiring; log?: (l: string) => void; now?: () => Date } = {}): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const now = o.now ?? (() => new Date());
  if (argv.includes("--help")) {
    log(USAGE_PARITY);
    return 0;
  }
  let wiring = o.wiring;
  if (!wiring) {
    const env = serviceEnv(argv, root, log);
    if (!env) return 1;
    wiring = liveWiring(env);
  }
  const factory = await readFactorySnapshot(wiring.raw);
  const iam = await readIamSnapshot(wiring.port, factoryUserIds(factory), { allUsers: argv.includes("--all-users"), organizationIds: linkedOrgIds(factory) });
  const result = computeParity(factory, iam);
  for (const line of describeParity(result, { verbose: argv.includes("--verbose") })) log(line);
  const at = now().toISOString();
  const file = argOf(argv, "--report") ? path.resolve(argOf(argv, "--report")) : "";
  if (file) writeReport(file, { kind: "iam-parity", at, differences: result.differences.length, checks: result.rows.length, result }, log);
  // The screens show the last check (PlatformSetting iam.parity); --no-record leaves it as it is.
  if (!argv.includes("--no-record")) {
    const mismatches = result.differences.length;
    await recordParity(wiring.raw, { at, ok: mismatches === 0, mismatches, ...(file ? { url: file } : {}) });
    log(`recorded in PlatformSetting ${IAM_PARITY_KEY}`);
  }
  return result.differences.length ? 1 : 0;
}

/** Runs an entry and turns a thrown error into a plain line and exit code 1. */
export async function runMain(main: () => Promise<number>, log: (l: string) => void = (l) => console.error(l)): Promise<number> {
  try {
    return await main();
  } catch (e) {
    log(`stopped: ${errorText(e)}`);
    return 1;
  }
}

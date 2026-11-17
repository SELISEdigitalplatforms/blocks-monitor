// The operator's attach command: an EXISTING product (its official MADP registry, its GitHub repos, its Blocks dev
// tenant) becomes a Factory product on the engine host, so the Factory develops it through the official lanes like a
// product it made itself. Dry run by default: it prints the plan and writes nothing. With --yes it
//   1. clones every repo from GitHub (branch dev, plain `git clone`) into <project folder>/madp/<name>-<key>;
//   2. runs `npm ci` in each clone;
//   3. writes the engine host's registry (hostRegistry.ts), checked by the official validator first;
//   4. writes factory.json {name, org, existing: true, data: true, setup: {<every repo>: true}, url}, which tells
//      ensureApp (app.ts) to use the registry as it is;
//   5. in the Factory's data: links the project to the product's Blocks dev tenant (compare-and-set while it has none)
//      and, with --live-url, records the product as live (Project.Stage "release", one dev Release row), so the
//      Release page offers "Request a change".
// Every step can run again: a clone of the same repo is kept, factory.json of the same product is rewritten, a project
// already linked to the same tenant and a dev Release already there are left as they are.
// No secrets are read or printed: the CLI login, GitHub login and Factory service identity stay where they are.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { deployOrder, hostRegistry, parseRegistry, type HostRegistry, type RegistryRepo } from "./hostRegistry.ts";
import { madpPython, officialHome, productStoreRoot, stableOfficialHome } from "./home.ts";
import { acceptanceLines, choicesOf, onboardRegistry, recheckProduct, writeReport, writeValidatedRegistry } from "./onboarding.ts";

/** The engine user's own Blocks CLI (npm -g --prefix ~/.local), where its `blocks login` lives; "" when absent. */
export function engineCli(home = os.homedir()): string {
  const f = path.join(home, ".local", "lib", "node_modules", "@seliseblocks", "cli-os", "bin", "run.js");
  return fs.existsSync(f) ? f : "";
}

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.parseInt(String(v ?? ""), 10) || 0);

/** A Factory project id (build/paths.ts ID_RE): it is also the last folder of the project's engine folder. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^[0-9]+\.[0-9]+(\.[0-9]+)?$/;

export interface AttachOptions {
  /** The Blocks CLI the lanes run (absolute run.js); default: the engine's own (engineCli). */
  cliRunJs?: string;
  projectId: string;
  /** The Factory project's engine folder (<engine root>/projects/<workspace>/<project id>). */
  projectFolder: string;
  /** The product's official MADP registry (YAML). */
  registryFile: string;
  devTenant: string;
  /** The web app's dev address (factory.json url; the address the Factory checks after each build). */
  webUrl: string;
  /** Record the product as live in the Factory (Stage "release", one dev Release row) with this address. */
  liveUrl?: string;
  /** The live version (default: the web repo's package.json version, else 1.0.0). */
  liveVersion?: string;
  authorName?: string;
  authorEmail?: string;
  commitTrailer?: string;
  withStage?: boolean;
  stageCliConfigDir?: string;
  stageCliCwd?: string;
  engineHome?: string;
  /** Where the repos are cloned from (default https://github.com). */
  gitBase?: string;
  yes?: boolean;
  /** Onboarding (onboarding.ts): run the live tests too (default off: they run against the live environment). */
  allowLiveTests?: boolean;
  /** Onboarding: failing checks (`<repo>.<kind>.<name>`) kept in the engine gate; the rest are left out. */
  keep?: string[];
  leaveOut?: string[];
}

export interface Exec {
  (cmd: string, args: string[], o: { cwd?: string; input?: string; timeoutMs: number; env?: Record<string, string> }): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** The Factory's data the command reads and writes (the Data Gateway, as the engine's service identity). */
export interface FactoryData {
  project(projectId: string): Promise<Row | null>;
  releases(projectId: string): Promise<Row[]>;
  /** Compare-and-set on the project row as read (provisioningStore's ClaimFactoryProvisioning): true when it changed. */
  link(row: Row, patch: Row): Promise<boolean>;
  insertRelease(row: Row): Promise<{ created: boolean; itemId: string | null }>;
  updateProject(itemId: string, patch: Row): Promise<void>;
}

export interface FactoryRows {
  /** The link to the Blocks dev tenant (null: linked already). */
  link: Row | null;
  /** The project's move to the Release step (null: there already, or not asked). */
  stage: Row | null;
  /** The dev Release row (null: one exists, or not asked). */
  release: Row | null;
  /** Where the product's code lives, for the project's Code step (null: recorded already). Never overwrites what the
   *  product's people filled in. */
  code: Row | null;
  problems: string[];
  notes: string[];
}

/** The project's Code step from the product's repositories (pure): the main repository (the web one, else the only
 *  or first one) with its branch, the dev address as its web address and safe test version, and a note naming every
 *  repository. Fields already filled in stay as they are; null when the code is recorded already. */
export function codeRows(p: Row, repos: Array<Pick<RegistryRepo, "key" | "repo" | "branch" | "role">>, webUrl: string): Row | null {
  if (text(p.RepoOwner) && text(p.RepoName) && text(p.RepoBranch)) return null;
  const main = repos.find((r) => r.role === "web") ?? repos[0];
  const m = main ? /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/.exec(main.repo) : null;
  if (!main || !m) return null;
  const out: Row = { RepoProvider: "github", RepoOwner: m[1]!, RepoName: m[2]!, RepoBranch: main.branch || "dev", RepoMode: "existing" };
  if (!text(p.AppUrl) && webUrl) out.AppUrl = webUrl;
  if (!text(p.TestEnv) && webUrl) out.TestEnv = JSON.stringify({ available: "yes", url: webUrl, accessHow: "The development environment on SELISE Blocks; MADP releases every change there first." });
  if (!text(p.RunInstructions)) {
    const list = repos.map((r) => `${r.role === "api" ? "API" : r.role === "web" ? "web app" : r.key}: ${r.repo} (branch ${r.branch || "dev"})`).join("; ");
    out.RunInstructions = `Built and released by MADP with the official MADP engine. Repositories: ${list}.`;
  }
  return out;
}

/** What the command writes in the Factory's data for this project (pure). */
export function factoryRows(o: {
  projectId: string;
  project: Row | null;
  releases: Row[];
  devTenant: string;
  webUrl: string;
  live?: { url: string; version: string; at: string };
  /** The product's repositories (from its registry): the main one is recorded on the project. */
  repos?: Array<Pick<RegistryRepo, "key" | "repo" | "branch" | "role">>;
}): FactoryRows {
  const out: FactoryRows = { link: null, stage: null, release: null, code: null, problems: [], notes: [] };
  const p = o.project;
  if (!p) {
    out.problems.push(`The Factory has no project ${o.projectId}.`);
    return out;
  }
  if (text(p.RepoMode) !== "existing") out.notes.push(`The Factory project is not marked as an existing product (RepoMode "${text(p.RepoMode) || "new"}").`);
  const ref = text(p.BlocksProjectRef);
  if (!ref) {
    out.link = { BlocksProjectRef: o.devTenant, BlocksProjectDomain: o.webUrl, BlocksProvisioningStatus: "ready", BlocksProvisioningError: "" };
  } else if (ref !== o.devTenant) {
    out.problems.push("The Factory project is already linked to another Blocks project; it is never re-linked.");
  } else if (text(p.BlocksProjectDomain) !== o.webUrl) {
    out.notes.push("The Factory project is linked to this Blocks project already; its recorded address stays as it is.");
  }
  out.code = codeRows(p, o.repos ?? [], o.webUrl);
  if (!o.live) return out;
  const stage = text(p.Stage);
  if (stage === "paused" || stage === "abandoned") out.problems.push(`The Factory project is ${stage}; resume it before it is recorded as live.`);
  else if (stage !== "release") out.stage = { Stage: "release", Rev: num(p.Rev) + 1 };
  const dev = o.releases.filter((r) => text(r.Environment) === "dev");
  if (dev.length > 0) {
    out.notes.push(`A dev release is recorded already (${dev.map((r) => text(r.Version)).filter(Boolean).join(", ") || "no version"}); none is added.`);
  } else {
    const by = text(p.CreatedByUserId);
    out.release = {
      ProjectId: o.projectId,
      WorkspaceId: text(p.WorkspaceId),
      ReaderIds: Array.isArray(p.ReaderIds) ? p.ReaderIds.filter((x) => typeof x === "string") : [],
      CreatedByUserId: by,
      UpdatedByUserId: by,
      Environment: "dev",
      Version: o.live.version,
      Url: o.live.url,
      Status: "released",
      ChangeRequestIds: [],
      ReleasedAt: o.live.at,
      ReleasedByUserId: by,
      EngineJobId: "",
      RequestKey: `factory:attach:${o.projectId}:release:dev`,
    };
  }
  return out;
}

export interface AttachPlan {
  projectId: string;
  /** <project folder>/madp */
  dir: string;
  host: HostRegistry;
  org: string;
  repos: Array<RegistryRepo & { remote: string; present: boolean }>;
  state: Row;
  data: FactoryRows | null;
  /** Things that stop the command (nothing is written while there is one). */
  problems: string[];
  notes: string[];
}

/** Runs a command without a shell (the default Exec). */
export const runCommand: Exec = (cmd, args, o) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...o.env, GIT_TERMINAL_PROMPT: "0", PYTHONDONTWRITEBYTECODE: "1", NO_COLOR: "1" } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
    if (o.input !== undefined) child.stdin?.end(o.input);
  });

/** The last lines of a tool's error output, with any credentials in addresses taken out. */
const tailOf = (s: string, n = 3): string =>
  s
    .replace(/(https?:\/\/)[^@\s/]+@/g, "$1")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-n)
    .join(" | ")
    .slice(0, 400);

function readJson(file: string): Row | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
  } catch {
    return null;
  }
}

/** The clone's origin (null when the folder is not a git repo). */
async function originOf(exec: Exec, repo: string): Promise<string | null> {
  if (!fs.existsSync(path.join(repo, ".git"))) return null;
  const r = await exec("git", ["-C", repo, "remote", "get-url", "origin"], { timeoutMs: 30_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}
const sameRemote = (a: string, b: string): boolean => a.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase() === b.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();

/** The official validator on a registry text, without the path checks (nothing is written). */
async function validateText(exec: Exec, engineHome: string, yml: string): Promise<string[]> {
  const code = [
    "import sys, yaml",
    "from MADP.orchestrator.primitives.project_registry import validate",
    "problems = validate(yaml.safe_load(sys.stdin.read()), check_paths=False)",
    "print('\\n'.join(problems))",
    "sys.exit(1 if problems else 0)",
  ].join("\n");
  const r = await exec(madpPython(), ["-B", "-c", code], { cwd: engineHome, input: yml, timeoutMs: 60_000 });
  if (r.code === 0) return [];
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim());
  return lines.length ? lines.map((l) => `registry: ${l}`) : [`The official validator did not run (${tailOf(r.stderr)}).`];
}

/** The web repo's package.json version (the clone must exist), else "". */
function packageVersion(repos: RegistryRepo[]): string {
  const web = repos.find((r) => r.role === "web") ?? repos.find((r) => r.key === "web") ?? repos[0];
  const v = web ? text(readJson(path.join(web.path, "package.json"))?.version).replace(/[-+].*$/, "") : "";
  return VERSION.test(v) ? v : "";
}

/** The plan: what would be cloned, installed and written, and anything that stops it. Reads only. */
export async function planAttach(o: AttachOptions, deps: { exec?: Exec; data?: FactoryData | null; now?: () => Date } = {}): Promise<AttachPlan> {
  const exec = deps.exec ?? runCommand;
  const problems: string[] = [];
  const notes: string[] = [];
  if (!PROJECT_ID.test(o.projectId)) throw new Error("The Factory project id is not valid (letters, digits, - and _).");
  const folder = path.resolve(o.projectFolder);
  if (path.basename(folder) !== o.projectId) throw new Error("The project folder is not this project's engine folder (its last folder must be the project id).");
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) problems.push("The project folder does not exist on the engine host yet (the Factory makes it with the project's first job).");
  const webUrl = (text(o.webUrl) || text(o.liveUrl)).replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(webUrl)) throw new Error("The web dev address must be an https address.");
  if (o.liveUrl !== undefined && !/^https:\/\/[^\s/]+/.test(text(o.liveUrl))) throw new Error("The live address must be an https address.");
  if (o.liveVersion !== undefined && !VERSION.test(text(o.liveVersion))) throw new Error("The live version must look like 1.2.3.");
  // written into the product's registry: the name that stays (through the release link), not a release folder
  const engineHome = path.resolve(o.engineHome || stableOfficialHome());
  const dir = path.join(folder, "madp");
  let source: string;
  try {
    source = fs.readFileSync(o.registryFile, "utf8");
  } catch {
    throw new Error("The registry file cannot be read.");
  }
  const envPaths = o.withStage && (o.stageCliConfigDir || o.stageCliCwd) ? { stg: { cliConfigDir: o.stageCliConfigDir, cliCwd: o.stageCliCwd } } : undefined;
  const host = hostRegistry(source, {
    dir,
    devTenant: o.devTenant,
    engineHome,
    author: { name: o.authorName, email: o.authorEmail },
    commitTrailer: o.commitTrailer,
    withStage: o.withStage === true,
    envPaths,
    cliRunJs: o.cliRunJs || engineCli(),
    // each environment signs in to Blocks in the product's own store (blocksLogin.ts), never the engine's default one
    blocksStores: productStoreRoot(),
  });
  notes.push(...host.notes);
  problems.push(...(await validateText(exec, engineHome, host.yaml)));

  // the product's folder: never another product's state, never a half-made new product
  const state = readJson(path.join(dir, "factory.json"));
  if (state && (state.existing !== true || text(state.name) !== host.name)) {
    problems.push("This project already has a MADP product on the engine host (madp/factory.json); attaching never replaces it.");
  }
  if (!state && fs.existsSync(host.file)) problems.push(`The engine host has a registry ${path.basename(host.file)} for this project without its state; it is never overwritten.`);

  const gitBase = (o.gitBase || "https://github.com").replace(/\/+$/, "");
  const repos: AttachPlan["repos"] = [];
  for (const r of host.repos) {
    const remote = `${gitBase}/${r.repo}.git`;
    let present = false;
    if (fs.existsSync(r.path) && fs.readdirSync(r.path).length > 0) {
      const origin = await originOf(exec, r.path);
      if (origin && sameRemote(origin, remote)) present = true;
      else problems.push(`The folder for ${r.key} (${path.basename(r.path)}) exists and is not a clone of ${r.repo}.`);
    }
    repos.push({ ...r, remote, present });
  }
  const org = deployOrder(host.repos)[0]!.repo.split("/")[0]!;
  if (new Set(host.repos.map((r) => r.repo.split("/")[0])).size > 1) notes.push(`The repos are in more than one GitHub owner; the product's owner is recorded as ${org}.`);
  const nextState: Row = { name: host.name, org, existing: true, data: true, setup: Object.fromEntries(host.repos.map((r) => [r.key, true])), url: webUrl };

  // the Factory's data
  let data: FactoryRows | null = null;
  if (deps.data) {
    const now = (deps.now ?? (() => new Date()))();
    const version = text(o.liveVersion) || packageVersion(host.repos) || "1.0.0";
    const [project, releases] = await Promise.all([deps.data.project(o.projectId), deps.data.releases(o.projectId)]);
    data = factoryRows({
      projectId: o.projectId,
      project,
      releases,
      devTenant: o.devTenant,
      webUrl,
      repos: host.repos,
      ...(o.liveUrl ? { live: { url: text(o.liveUrl).replace(/\/+$/, ""), version, at: now.toISOString() } } : {}),
    });
    if (o.liveUrl && !o.liveVersion && !packageVersion(host.repos)) notes.push("The live version is 1.0.0 unless the web repo's package.json names one (read after the clone) or --live-version is given.");
    problems.push(...data.problems);
    notes.push(...data.notes);
  } else {
    notes.push("The Factory's data was not read (no service identity): the project is not linked to its Blocks project and not recorded as live.");
  }
  return { projectId: o.projectId, dir, host, org, repos, state: nextState, data, problems, notes };
}

/** The plan in plain lines (no secrets: the registry holds none, and rows hold ids, addresses and versions only). */
export function describePlan(plan: AttachPlan, o: { yes: boolean }): string[] {
  const out: string[] = [
    `${o.yes ? "Attaching" : "Plan (dry run, nothing is written)"}: ${plan.host.name} to Factory project ${plan.projectId}`,
    `  engine folder: ${plan.dir}`,
    "  repositories:",
    ...plan.repos.map((r) => `    ${r.key}: ${r.repo} (branch ${r.branch}) -> ${r.path}${r.present ? " [cloned already]" : " [git clone, then npm ci]"}`),
    `  registry: ${plan.host.file} (environments: ${plan.host.environments.join(", ")})`,
    `  factory.json: ${JSON.stringify(plan.state)}`,
  ];
  if (plan.data) {
    out.push("  Factory data:");
    out.push(plan.data.link ? `    Project ${plan.projectId}, only while it has no Blocks project: ${JSON.stringify(plan.data.link)}` : "    the project's Blocks link: as it is");
    if (plan.data.stage) out.push(`    Project ${plan.projectId}: ${JSON.stringify(plan.data.stage)}`);
    if (plan.data.release) out.push(`    new Release row: ${JSON.stringify(plan.data.release)}`);
    out.push(plan.data.code ? `    the project's code (Code step): ${JSON.stringify(plan.data.code)}` : "    the project's code: recorded already");
  }
  if (plan.notes.length) out.push("  notes:", ...plan.notes.map((n) => `    - ${n}`));
  if (plan.problems.length) out.push("  STOPPED, nothing is written:", ...plan.problems.map((p) => `    - ${p}`));
  return out;
}

export interface AttachResult {
  plan: AttachPlan;
  /** True when every step ran (only with --yes and no problems). */
  done: boolean;
}

/** The command: dry run unless `yes`. Answers the plan and whether it was carried out. */
export async function attachExisting(o: AttachOptions, deps: { exec?: Exec; data?: FactoryData | null; log?: (line: string) => void; now?: () => Date } = {}): Promise<AttachResult> {
  const exec = deps.exec ?? runCommand;
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const plan = await planAttach(o, deps);
  for (const line of describePlan(plan, { yes: o.yes === true })) log(line);
  if (!o.yes || plan.problems.length > 0) return { plan, done: false };
  if (!deps.data || !plan.data) throw new Error("Linking the Factory project to its Blocks project needs the Factory's service identity (MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID, MF_SVC_CLIENT_SECRET); nothing was written.");

  fs.mkdirSync(plan.dir, { recursive: true });
  for (const r of plan.repos) {
    if (r.present) continue;
    log(`git clone ${r.repo} (branch ${r.branch})`);
    const c = await exec("git", ["clone", "--branch", r.branch, r.remote, r.path], { timeoutMs: 20 * 60_000 });
    if (c.code !== 0) throw new Error(`git clone of ${r.repo} failed (${tailOf(c.stderr)}).`);
  }
  for (const r of plan.repos) {
    const head = await exec("git", ["-C", r.path, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 30_000 });
    if (head.stdout.trim() !== r.branch) throw new Error(`The clone of ${r.repo} is not on branch ${r.branch}.`);
    if (!fs.existsSync(path.join(r.path, "package-lock.json"))) throw new Error(`${r.repo} has no package-lock.json, which npm ci needs.`);
    log(`npm ci in ${path.basename(r.path)}`);
    const i = await exec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: r.path, timeoutMs: 30 * 60_000 });
    if (i.code !== 0) throw new Error(`npm ci in ${path.basename(r.path)} failed (${tailOf(i.stderr)}).`);
  }

  // choices recorded by an earlier attach or re-check stay (onboarding.choices of the host registry)
  let earlier: Row = {};
  try {
    earlier = (parseRegistry(fs.readFileSync(plan.host.file, "utf8")).onboarding ?? {}) as Row;
  } catch {
    /* first attach */
  }

  // the registry: checked by the official validator (paths included) before it takes its place
  const check = path.join(plan.dir, `.${plan.host.name}.attach.yml`);
  fs.writeFileSync(check, plan.host.yaml);
  const engineHome = path.resolve(o.engineHome || officialHome());
  const v = await exec(madpPython(), ["-B", "-m", "MADP.orchestrator.primitives.project_registry", check], { cwd: engineHome, timeoutMs: 60_000 });
  if (v.code !== 0) {
    fs.rmSync(check, { force: true });
    throw new Error(`The official validator refused the engine host's registry: ${tailOf(v.stdout, 8)}`);
  }
  fs.renameSync(check, plan.host.file);
  log(`wrote ${plan.host.file}`);
  const stateFile = path.join(plan.dir, "factory.json");
  fs.writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(plan.state, null, 2)}\n`);
  fs.renameSync(`${stateFile}.tmp`, stateFile);
  log(`wrote ${stateFile}`);

  // onboarding (onboarding.ts): each repo's gate once on the pristine dev branch, the real languages, the report
  {
    const onboarded = await onboardRegistry({ ...plan.host.data, ...(earlier.choices ? { onboarding: { choices: earlier.choices } } : {}) }, {
      exec, productDir: plan.dir, allowLiveTests: o.allowLiveTests, choices: choicesOf(o.keep, o.leaveOut), notRunnable: plan.host.leftOut, now: deps.now, log,
    });
    const problems = await writeValidatedRegistry(exec, engineHome, plan.host.file, onboarded.data);
    if (problems.length) throw new Error(`The official validator refused the onboarded registry: ${problems.join("; ")}`);
    writeReport(plan.dir, onboarded.report);
    log(`onboarding: ${onboarded.report.summary}`);
    for (const a of onboarded.report.attention) log(`  ! ${a}`);
    for (const l of acceptanceLines(onboarded.report.acceptance)) log(l);
  }

  // the Factory's data: the link (compare-and-set), the dev release, the Release step
  {
    const data = deps.data;
    let rows = plan.data;
    if (o.liveUrl && rows.release && !o.liveVersion) {
      // the version from the web repo's package.json, now that the clone is there
      const version = packageVersion(plan.host.repos);
      if (version) rows = { ...rows, release: { ...rows.release, Version: version } };
    }
    if (rows.link) {
      const project = await data.project(o.projectId);
      if (!project) throw new Error(`The Factory has no project ${o.projectId}.`);
      const ref = text(project.BlocksProjectRef);
      if (ref && ref !== o.devTenant) throw new Error("The Factory project was linked to another Blocks project meanwhile; it is never re-linked.");
      if (!ref) {
        if (!(await data.link(project, rows.link))) throw new Error("The Factory project changed while it was being linked; run the command again.");
        log(`linked Factory project ${o.projectId} to its Blocks dev project`);
      }
    }
    if (rows.release) {
      const now = await data.releases(o.projectId);
      if (now.some((r) => text(r.Environment) === "dev")) log("a dev release is recorded already; none is added");
      else {
        await data.insertRelease(rows.release);
        log(`recorded the dev release ${String(rows.release.Version)}`);
      }
    }
    if (rows.stage) {
      await data.updateProject(o.projectId, rows.stage);
      log("moved the Factory project to its Release step");
    }
    if (rows.code) {
      await data.updateProject(o.projectId, rows.code);
      log(`recorded the product's code: ${String(rows.code.RepoOwner)}/${String(rows.code.RepoName)} (branch ${String(rows.code.RepoBranch)})`);
    }
  }
  return { plan, done: true };
}

/** The command line (frontend/scripts/attach-existing-product.mjs). */
export function attachOptions(argv: string[]): AttachOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      "project-id": { type: "string" },
      "project-folder": { type: "string" },
      registry: { type: "string" },
      "dev-tenant": { type: "string" },
      "web-url": { type: "string" },
      "live-url": { type: "string" },
      "live-version": { type: "string" },
      "author-name": { type: "string" },
      "author-email": { type: "string" },
      "commit-trailer": { type: "string" },
      "with-stage": { type: "boolean" },
      "stage-cli-config-dir": { type: "string" },
      "stage-cli-cwd": { type: "string" },
      "engine-home": { type: "string" },
      "cli-run-js": { type: "string" },
      "git-base": { type: "string" },
      yes: { type: "boolean" },
      "allow-live-tests": { type: "boolean" },
      keep: { type: "string", multiple: true },
      "leave-out": { type: "string", multiple: true },
    },
  });
  const need = (k: "project-id" | "project-folder" | "registry" | "dev-tenant"): string => {
    const v = text(values[k]);
    if (!v) throw new Error(`--${k} is required.`);
    return v;
  };
  if (!text(values["web-url"]) && !text(values["live-url"])) throw new Error("--web-url (or --live-url) is required.");
  return {
    projectId: need("project-id"),
    projectFolder: need("project-folder"),
    registryFile: need("registry"),
    devTenant: need("dev-tenant"),
    webUrl: text(values["web-url"]) || text(values["live-url"]),
    ...(values["live-url"] !== undefined ? { liveUrl: text(values["live-url"]) } : {}),
    ...(values["live-version"] !== undefined ? { liveVersion: text(values["live-version"]) } : {}),
    authorName: values["author-name"],
    authorEmail: values["author-email"],
    commitTrailer: values["commit-trailer"],
    withStage: values["with-stage"] === true,
    stageCliConfigDir: values["stage-cli-config-dir"],
    stageCliCwd: values["stage-cli-cwd"],
    engineHome: values["engine-home"],
    cliRunJs: values["cli-run-js"],
    gitBase: values["git-base"],
    yes: values.yes === true,
    allowLiveTests: values["allow-live-tests"] === true,
    keep: values.keep ?? [],
    leaveOut: values["leave-out"] ?? [],
  };
}

export const ATTACH_USAGE = [
  "node scripts/attach-existing-product.mjs --project-id <id> --project-folder <engine folder of the project>",
  "  --registry <official registry .yml> --dev-tenant <D + 32 hex> --web-url <https dev address>",
  "  [--live-url <https dev address> [--live-version <x.y.z>]] [--author-name <name> --author-email <e-mail>]",
  "  [--commit-trailer <line>] [--with-stage [--stage-cli-config-dir <dir>] [--stage-cli-cwd <dir>]]",
  "  [--engine-home <official engine folder>] [--cli-run-js <Blocks CLI run.js; default the engine's own>]",
  "  [--allow-live-tests] [--keep <repo>.<kind>.<check>]... [--leave-out <repo>.<kind>.<check>]... [--yes]",
  "Dry run unless --yes. With --yes each repo's checks run once on its dev branch (onboarding report: madp/ONBOARDING.md).",
].join("\n");

/** The command's entry: exit code 0 done (or a clean plan), 1 stopped, 2 usage. */
export async function attachMain(argv: string[], deps: { data?: FactoryData | null; exec?: Exec; log?: (line: string) => void } = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  let o: AttachOptions;
  try {
    o = attachOptions(argv);
  } catch (e) {
    log(`${e instanceof Error ? e.message : String(e)}\n${ATTACH_USAGE}`);
    return 2;
  }
  try {
    const r = await attachExisting(o, { ...deps, log });
    if (r.plan.problems.length > 0) return 1;
    if (o.yes) log(`Done: ${r.plan.host.name} is attached; the Factory's builds and changes for this project run the official lanes on it.`);
    return 0;
  } catch (e) {
    log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

// ------------------------------------------------------------------ the re-check (onboarding.ts)

export const RECHECK_USAGE = [
  "node scripts/recheck-product.mjs --project-folder <engine folder of the project>",
  "  [--allow-live-tests] [--keep <repo>.<kind>.<check>]... [--leave-out <repo>.<kind>.<check>]... [--engine-home <dir>]",
  "Runs the product's checks again on its dev branch, keeps the choices made, rewrites the registry and the report.",
].join("\n");

/** The re-check command's entry: exit code 0 done, 1 stopped, 2 usage. */
export async function recheckMain(argv: string[], deps: { exec?: Exec; log?: (line: string) => void; now?: () => Date } = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  let values: Record<string, unknown>;
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      options: {
        "project-folder": { type: "string" },
        "allow-live-tests": { type: "boolean" },
        keep: { type: "string", multiple: true },
        "leave-out": { type: "string", multiple: true },
        "engine-home": { type: "string" },
      },
    }).values;
    if (!text(values["project-folder"])) throw new Error("--project-folder is required.");
  } catch (e) {
    log(`${e instanceof Error ? e.message : String(e)}\n${RECHECK_USAGE}`);
    return 2;
  }
  try {
    const r = await recheckProduct(path.join(path.resolve(text(values["project-folder"])), "madp"), {
      exec: deps.exec ?? runCommand,
      engineHome: path.resolve(text(values["engine-home"]) || officialHome()),
      allowLiveTests: values["allow-live-tests"] === true,
      choices: choicesOf(values.keep as string[] | undefined, values["leave-out"] as string[] | undefined),
      now: deps.now,
      log,
    });
    log(`onboarding: ${r.summary}`);
    for (const a of r.attention) log(`  ! ${a}`);
    for (const l of acceptanceLines(r.acceptance)) log(l);
    return 0;
  } catch (e) {
    log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

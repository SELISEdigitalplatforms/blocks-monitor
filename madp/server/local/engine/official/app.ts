// A Factory product on the official MADP engine: its registry entry, its repositories and their Blocks Release setup,
// all in the product's own folder (<project folder>/madp). Set up once, on the first build; every later build, change
// and promotion runs the official lanes against this registry. The repositories are whatever the registry lists: a
// new product has one (`madp new-app --layout unified`: React screens and the Node server in one repo, one
// deployment), an older one api + web, an existing product the repos the operator attached (attach.ts).
//
// The steps the official engine prescribes for a NEW product, in order (MADP/orchestrator/cli/new_app.py):
//   1. an OIDC client for the web app's login (the same public PKCE client `blocks new web` creates);
//   2. `madp new-app --layout unified --yes --create-github --deploy`: scaffold, GitHub repo, first push, registry,
//      Blocks data sync, then it checks the repo is linked to Blocks Release. Linking is portal-only (the Blocks CLI
//      has no command), so a new product stops there once with plain instructions;
//   3. after the link: `blocks release setup <org/repo>` for each repo (API-role repos first), as new-app says.
// An EXISTING product (factory.json `existing: true`) is used as it is: no new-app, data sync, release setup or OIDC.
// A product the Factory's former template builder made (before 05.11.2026) is onboarded as an existing one-repo product
// first (legacy.ts), never through new-app.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { blocksProjectId } from "../../../blocks/projectIdentity.ts";
import { dirsOf } from "../build/jobKit.ts";
import { JobFailure, type JobRun } from "../run.ts";
import { GIT_AUTHOR, NAME_RE, cliOf, deployOrder, devTenantOf, parseRegistry, registryRepos, shownRepo, tenantPattern, type RegistryRepo } from "./hostRegistry.ts";
import { officialHome } from "./home.ts";
import { ensureBlocksSession, ensureRegistryStores, releaseAccount, storeEnv, storeOf } from "./blocksLogin.ts";
import { productStore } from "./home.ts";
import { laneFailure, runLane } from "./madp.ts";
import { legacyProduct, onboardLegacy } from "./legacy.ts";

/** The one-repo layout when the installed official engine offers it (new_app.py `--layout`), else its default: the
 *  Factory and the official engine can be updated in either order without breaking a new product's set-up. */
export function layoutArgs(home = officialHome()): string[] {
  try {
    return fs.readFileSync(path.join(home, "MADP", "orchestrator", "cli", "new_app.py"), "utf8").includes('"--layout"') ? ["--layout", "unified"] : [];
  } catch {
    return [];
  }
}

export { GIT_AUTHOR };

const exec = promisify(execFile);
type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export interface OfficialApp {
  /** The registry name (lower-case id). */
  name: string;
  /** The product's MADP folder (registry, repos, reports, logs). */
  dir: string;
  /** The registry file the lanes get as --project. */
  registry: string;
  org: string;
  /** The registry's repos: key -> local clone (one `app` repo for a new product, api + web for older ones, any keys
   *  for an existing product). */
  repos: Record<string, string>;
  tenant: string;
  /** The web app's address on dev. */
  url: string;
}

export interface State {
  name?: string;
  org?: string;
  oidcClientId?: string;
  /** The first deployment of each repo is done (by repo key). */
  setup?: Record<string, boolean>;
  /** The template's data:sync ran (schemas pushed, every table locked to the API's service role). */
  data?: boolean;
  url?: string;
  /** An existing product the operator attached (attach.ts): its registry and repos are used as they are. */
  existing?: boolean;
  /** A product of the Factory's former template builder, onboarded as an existing one-repo product (legacy.ts). */
  legacy?: boolean;
  /** The official engine's first deploy of a former product's dev commit (firstDeploy.ts). */
  firstDeploy?: { commit: string; at: string };
}

/** The registry name of a product: its name in lower case, plus the start of its id so two products never meet. */
export function appName(projectName: string, projectId: string): string {
  const slug = projectName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  const id = projectId.replace(/[^a-f0-9]/gi, "").toLowerCase().slice(0, 6) || "app";
  const base = /^[a-z]/.test(slug) ? slug : `app-${slug}`.replace(/-+$/, "");
  return `${base.length >= 2 ? base : "app"}-${id}`.replace(/--+/g, "-");
}

export const appDir = (run: JobRun): string => path.join(dirsOf(run).root, "madp");

export function readState(dir: string): State {
  try {
    return rec(JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8"))) as State;
  } catch {
    return {};
  }
}
export function writeState(dir: string, s: State): void {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "factory.json");
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  fs.renameSync(`${f}.tmp`, f);
}

/** The registry file: its data and repos. A file the engine cannot read fails in plain words. */
function readRegistry(file: string): { data: Row; repos: RegistryRepo[] } {
  try {
    const data = parseRegistry(fs.readFileSync(file, "utf8"));
    const repos = registryRepos(data);
    if (repos.length > 0 && repos.every((r) => r.path && /^[^/\s]+\/[^/\s]+$/.test(r.repo))) return { data, repos };
  } catch {
    /* below */
  }
  throw new JobFailure("The product's MADP registry cannot be read. Ask the engine team to repair it, then start it again.", "madp.registry");
}

const cliEnv = (): NodeJS.ProcessEnv => ({ ...process.env, BLOCKS_STRICT_FLAGS: "1", BLOCKS_NO_UPDATE_CHECK: "1", GIT_TERMINAL_PROMPT: "0" });

/** The product environment's Blocks sign-in: its own login store and the account the lanes use (blocksLogin.ts). */
interface Session {
  store: string;
  account: string;
}

/** The official Blocks CLI: the registry's copy (cli.run_js in the product's repo, as the lanes run it), else `blocks`
 *  on PATH, in the product's own login store. Output is JSON; failures never carry the CLI's output (it can hold
 *  account details). */
async function blocksCli(args: string[], o: { cli?: { runJs: string; cwd: string }; tenant: string; session: Session; timeoutMs?: number }): Promise<Row> {
  const runJs = o.cli?.runJs ?? "";
  const [bin, argv] = runJs && fs.existsSync(runJs) ? [process.execPath, [runJs, ...args]] : ["blocks", args];
  try {
    const { stdout } = await exec(bin, [...argv, "--project", o.tenant, "--account", o.session.account, "--json"], {
      cwd: o.cli?.cwd && fs.existsSync(o.cli.cwd) ? o.cli.cwd : undefined,
      env: storeEnv(o.session.store),
      timeout: o.timeoutMs ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const s = String(stdout);
    const start = s.indexOf("{");
    return start >= 0 ? rec(JSON.parse(s.slice(start, s.lastIndexOf("}") + 1))) : {};
  } catch {
    throw new JobFailure(`A Blocks step of the product set-up did not go through (${args.slice(0, 3).join(" ")}). Start it again in a few minutes; if it fails again, ask the engine team to look into it.`, "madp.blocks_cli");
  }
}

/** The web app's login client: one already registered for this address, else a new public PKCE client with the
 *  settings `blocks new web` uses (dry run first, then the change). Answers its client id. */
async function ensureOidcClient(tenant: string, domain: string, name: string, session: Session): Promise<string> {
  const redirect = `${domain.replace(/\/+$/, "")}/login/callback`;
  const listed = await blocksCli(["auth", "oidc-clients", "list"], { tenant, session });
  const rows = (Array.isArray(listed.oIDCClientCredentials) ? listed.oIDCClientCredentials : []).map(rec);
  const own = rows.find((r) => (Array.isArray(r.redirectUris) ? r.redirectUris : []).includes(redirect)) ?? (rows.length === 1 ? rows[0] : undefined);
  const known = own ? text(own.clientId) || text(own.itemId) : "";
  if (known) return known;
  const args = [
    "auth", "oidc-clients", "save",
    "--client-display-name", name,
    "--client-type", "public",
    "--redirect-uris", `${redirect},http://localhost:5173/login/callback`,
    "--require-pkce", "--register-as-identity-provider", "--auto-redirect", "--active",
    "--scope", "openid profile",
  ];
  await blocksCli([...args, "--dry-run"], { tenant, session });
  const made = await blocksCli([...args, "--yes"], { tenant, session });
  const id = findClientId(made);
  if (!id) throw new JobFailure("Blocks did not return the new login client's id.", "madp.oidc_client");
  return id;
}

/** The client id in a save response (never its secret). */
export function findClientId(v: unknown, depth = 0): string {
  const r = rec(v);
  for (const key of ["clientId", "client_id"]) if (text(r[key])) return text(r[key]);
  if (depth < 4) {
    for (const value of Object.values(r)) {
      const hit = findClientId(value, depth + 1);
      if (hit) return hit;
    }
  }
  return depth === 0 ? text(rec(r.data).itemId) || text(r.itemId) : "";
}

async function githubLogin(): Promise<string> {
  const fromEnv = String(process.env.MF_MADP_GITHUB_ORG ?? "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await exec("gh", ["api", "user", "--jq", ".login"], { env: cliEnv(), timeout: 30_000 });
    const login = String(stdout).trim();
    if (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login)) return login;
  } catch {
    /* below */
  }
  throw new JobFailure("The engine host has no GitHub login for the product repositories (gh auth login).", "madp.github_login");
}

/** The one portal step, naming exactly the registry's repositories (pure). A repository in the GitHub account MADP
 *  Factory keeps the code in is named "MADP Factory's repository <name>", never with that account (shownRepo); one the
 *  project's own record names (`projectOwner`, Project.RepoOwner) keeps its owner/name. */
export function linkMessage(repos: Array<Pick<RegistryRepo, "repo" | "branch">>, projectOwner = ""): string {
  const names = repos.map((r) => shownRepo(r.repo, projectOwner));
  const branches = [...new Set(repos.map((r) => r.branch || "dev"))];
  const whose = names.some((n) => !n.includes("/")) ? "MADP Factory's" : "the";
  const which =
    names.length === 1 ? `${whose} repository ${names[0]}` : `${whose} repositories ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `One step in the Blocks portal is needed: in this product's Blocks project, open Release and add ${which} (branch "${branches.join('", "')}"). Then start the build again.`;
}
/** The owner of the project's own repository record (Project.RepoOwner), "" when it names none. */
export const projectRepoOwner = (run: Pick<JobRun, "p">): string => text(run.p.project.RepoOwner).trim();
const linkFailure = (run: JobRun, repos: RegistryRepo[]) => new JobFailure(linkMessage(repos, projectRepoOwner(run)), "madp.link_repos");

/** The template's own data:sync (scripts/data-sync.mjs): schemas, rules that lock every table to the service role,
 *  reload. Its output can name account details, so a failure says only what stopped. */
async function dataSync(repo: string, apply: boolean, session: Session): Promise<void> {
  try {
    await exec("npm", ["run", "data:sync", ...(apply ? ["--", "--yes"] : [])], { cwd: repo, env: { ...storeEnv(session.store), GIT_TERMINAL_PROMPT: "0" }, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    throw new JobFailure("Setting up the product's data did not go through. Start it again; if it fails again, ask the engine team to look into it.", "madp.data_sync");
  }
}

/** The registry with the dev environment's Blocks tenant (the official deploy refuses one without it): unchanged when
 *  it names one, null when the file has no plain `environments: / dev: / branch: dev` block to add it to (pure). */
export function withDevTenant(yml: string, tenant: string): string | null {
  const block = /^environments:\n((?:[ \t]+.*\n|\n)*)/m.exec(yml);
  if (!block) return null;
  if (/^\s+dev:\s*\n(?:\s{4,}.*\n)*?\s+tenant_id:/m.test(block[1]!)) return yml;
  const dev = /^([ \t]+)dev:\s*\n([ \t]+)branch: dev\s*\n/m.exec(block[0]);
  if (!dev) return null;
  const fixed = block[0].replace(dev[0], `${dev[0]}${dev[2]}tenant_id: ${tenant}\n`);
  return yml.replace(block[0], fixed);
}

/** The web address in a release JSON: url / appUrl / domain, else the first https address in it. */
export function urlIn(v: Row): string {
  for (const key of ["url", "appUrl", "applicationUrl", "domain"]) if (/^https:\/\//.test(text(v[key]))) return text(v[key]);
  const m = /https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"]*)?/i.exec(JSON.stringify(v));
  return m ? m[0] : "";
}

const reposOf = (repos: RegistryRepo[]): Record<string, string> => Object.fromEntries(repos.map((r) => [r.key, r.path]));
const repoLabel = (r: RegistryRepo, count: number): string =>
  count === 1 ? "the app" : r.role === "api" ? "the API" : r.role === "web" ? "the web app" : `the ${r.key} repository`;

/** An existing product the operator attached (attach.ts): its registry and clones as they are. Nothing is set up. */
export function existingApp(dir: string, state: State): OfficialApp {
  const incomplete = (what: string) => new JobFailure(`The existing product's set-up on the engine host is incomplete (${what}). Ask the engine team to complete it, then start it again.`, "madp.registry");
  const name = text(state.name);
  if (!NAME_RE.test(name)) throw incomplete("no registry name");
  const registry = path.join(dir, `${name}.yml`);
  if (!fs.existsSync(registry)) throw incomplete("no registry");
  const { data, repos } = readRegistry(registry);
  for (const r of repos) if (!fs.existsSync(path.join(r.path, ".git"))) throw incomplete(`the ${r.key} repository is missing`);
  const tenant = devTenantOf(data);
  if (!tenantPattern("dev").test(tenant)) throw incomplete("no dev tenant");
  const dev = rec(rec(data.environments).dev);
  const web = repos.find((r) => r.role === "web") ?? repos[0]!;
  const healthUrl = registryHealth(data, web.key)[0] ?? "";
  const url = [text(state.url), text(rec(dev.urls).web), /^https:\/\/[^/\s]+/.exec(healthUrl)?.[0] ?? ""].find((u) => /^https:\/\/\S+/.test(u)) ?? "";
  return { name, dir, registry, org: text(state.org) || deployOrder(repos)[0]!.repo.split("/")[0]!, repos: reposOf(repos), tenant, url: url.replace(/\/+$/, "") };
}

const registryHealth = (data: Row, key: string): string[] =>
  (Array.isArray(rec(rec(data.repos)[key]).health) ? (rec(rec(data.repos)[key]).health as unknown[]) : []).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));

/** An existing product (attached, or a former template builder's product after its onboarding): the registry with every
 *  environment's own login store (registries attached before every product had its own Blocks sign-in get them now),
 *  then the dev environment's session in its store (people connect it on the product's page when it has none). */
async function existingWithSession(run: JobRun, dir: string, state: State, step: (pct: number, line: string) => Promise<void>): Promise<OfficialApp> {
  const registry = path.join(dir, `${text(state.name)}.yml`);
  if (NAME_RE.test(text(state.name)) && fs.existsSync(registry)) ensureRegistryStores(registry, text(state.name));
  const app = existingApp(dir, state);
  const { data } = readRegistry(app.registry);
  await ensureBlocksSession(run, { product: run.p.name, name: app.name, env: "dev", data, tenant: app.tenant }, { step, pct: 4 });
  return app;
}

/** The product on the official engine, set up when needed, with its dev environment signed in to Blocks in its own
 *  login store (blocksLogin.ts: people connect it on the product's page when it has no session). `step` reports
 *  progress. */
export async function ensureApp(run: JobRun, step: (pct: number, line: string) => Promise<void>): Promise<OfficialApp> {
  const dir = appDir(run);
  fs.mkdirSync(dir, { recursive: true });
  const state = readState(dir);
  if (state.existing === true) return existingWithSession(run, dir, state, step);

  const name = state.name || appName(run.p.name, run.projectId);
  const tenant = blocksProjectId(run.p.project);
  const domain = text(run.p.project.BlocksProjectDomain).replace(/\/+$/, "");
  if (!/^https:\/\//.test(domain)) throw new JobFailure("The product's Blocks project has no address yet.", "blocks.project_not_ready");
  // a former template builder's product (legacy.ts): an existing one-repo product, never new-app; then the same
  // stores and Blocks sign-in as every existing product, so its first lane runs in its own session
  const legacy = await legacyProduct(run, dir, state as Row, name);
  if (legacy) {
    await onboardLegacy(run, dir, name, legacy, step);
    return existingWithSession(run, dir, readState(dir), step);
  }
  const registry = path.join(dir, `${name}.yml`);
  const org = state.org || (await githubLogin());
  const appOf = (repos: RegistryRepo[], url: string): OfficialApp => ({ name, dir, registry, org, tenant, repos: reposOf(repos), url });
  writeState(dir, { ...state, name, org });

  if (!fs.existsSync(registry)) {
    // the product's own Blocks sign-in comes first: the login client, new-app and its data step all need it
    const session: Session = { store: productStore(name, "dev"), account: releaseAccount() };
    await ensureBlocksSession(run, { product: run.p.name, name, env: "dev", data: {}, tenant }, { step, pct: 4 });
    await step(6, "Setting up the product with the official MADP engine: the login client, the repository on GitHub and the Blocks data.");
    const oidc = state.oidcClientId || (await ensureOidcClient(tenant, domain, name, session));
    writeState(dir, { ...readState(dir), oidcClientId: oidc });
    const r = await runLane(run, [
      "new-app", name,
      ...layoutArgs(),
      "--github-org", org,
      "--dir", dir,
      "--projects-dir", dir,
      "--tenant-id", tenant,
      "--app-domain", domain,
      "--oidc-client-id", oidc,
      "--title", run.p.name.slice(0, 80),
      "--author-name", GIT_AUTHOR.name,
      "--author-email", GIT_AUTHOR.email,
      "--yes", "--create-github", "--deploy",
    ], { projectDir: dir, label: "new-app", timeoutMs: 45 * 60_000, blocksConfigDir: session.store });
    // the registry new-app wrote names the product's own store, so every later lane signs in there
    if (fs.existsSync(registry)) ensureRegistryStores(registry, name);
    if (r.code === 0) {
      const { repos } = readRegistry(registry);
      writeState(dir, { ...readState(dir), data: true, setup: Object.fromEntries(repos.map((x) => [x.key, true])) });
      return appOf(repos, domain);
    }
    // new-app's data step is the one before the link check: when the registry is written and the run stopped only at
    // the link, the data is set up too
    if (fs.existsSync(registry) && /release-linked/.test(r.tail.join("\n"))) writeState(dir, { ...readState(dir), data: true });
    if (fs.existsSync(registry) && /not linked to blocks release/i.test(r.tail.join("\n"))) throw linkFailure(run, readRegistry(registry).repos);
    throw laneFailure("Setting up the product", r);
  }

  // registries written before new-app recorded the tenant: add it, so the lanes can deploy
  const yml = fs.readFileSync(registry, "utf8");
  const fixed = withDevTenant(yml, tenant);
  if (fixed === null) throw new JobFailure("The product's MADP registry has no dev environment the engine can complete. Ask the engine team to add it, then start it again.", "madp.registry");
  if (fixed !== yml) fs.writeFileSync(registry, fixed);
  // registries written before every product had its own Blocks sign-in: add the stores
  ensureRegistryStores(registry, name);
  const { data, repos } = readRegistry(registry);
  const app = appOf(repos, state.url || domain);
  const cli = cliOf(data);
  const session: Session = { store: storeOf(data, name, "dev"), account: releaseAccount(data) };
  await ensureBlocksSession(run, { product: run.p.name, name, env: "dev", data, tenant }, { step, pct: 4 });
  if (!readState(dir).data) {
    // a set-up that stopped before its data step: the template's own data:sync (dry run, then the change), in the repo
    // that has it
    const holder = deployOrder(repos).find((x) => fs.existsSync(path.join(x.path, "scripts", "data-sync.mjs")));
    if (!holder) throw new JobFailure("The product's repository has no data set-up script. Ask the engine team to add one, then start it again.", "madp.data_sync");
    await step(8, "Setting up the product's data: every table locked to the API's service identity.");
    await dataSync(holder.path, false, session);
    await dataSync(holder.path, true, session);
    writeState(dir, { ...readState(dir), data: true });
  }
  const done = readState(dir).setup ?? {};
  if (repos.every((x) => done[x.key])) return app;
  // after the portal link: the first deploy of each repo, API-role repos first (MADP's own instruction from new-app)
  const listed = await blocksCli(["release", "repos", "list"], { cli, tenant, session });
  const linked = JSON.stringify(listed).toLowerCase();
  if (!repos.every((x) => linked.includes(x.repo.toLowerCase()))) throw linkFailure(run, repos);
  for (const [i, x] of deployOrder(repos).entries()) {
    if (done[x.key]) continue;
    const shown = shownRepo(x.repo, projectRepoOwner(run));
    await step(Math.min(18, 10 + i * 6), `First deployment of ${repoLabel(x, repos.length)} on Blocks (${shown}).`);
    await blocksCli(["release", "setup", x.repo, "--dry-run"], { cli, tenant, session });
    const res = await blocksCli(["release", "setup", x.repo, "--wait", "--yes"], { cli, tenant, session, timeoutMs: 30 * 60_000 });
    const verdict = text(res.verdict).toLowerCase();
    if (verdict && verdict !== "succeeded") throw new JobFailure(`The first deployment of ${shown} ended "${verdict}".`, "madp.first_deploy");
    const url = x.role === "web" || repos.length === 1 ? urlIn(res) : "";
    const now = readState(dir);
    writeState(dir, { ...now, setup: { ...now.setup, [x.key]: true }, ...(url ? { url } : {}) });
    if (url) app.url = url;
  }
  return app;
}

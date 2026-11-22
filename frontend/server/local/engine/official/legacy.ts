// A product the Factory's former template builder made (before 05.11.2026) on the official MADP engine. Such a product
// has one GitHub repo (React + Vite, RepoProvider "github", RepoOwner/RepoName), a ready Blocks project and maybe a
// preview or Release row, but no official registry; the engine host may still hold the builder's clone (<project
// folder>/repo) or a half-made `madp new-app` attempt. It is onboarded as an EXISTING one-repo product (key `app`, role
// web) the way attached products are (attach.ts, onboarding.ts): clone, install, registry (validated), its checks once
// on the pristine dev branch, its languages, the onboarding report, factory.json `existing: true`. Never `new-app`.
// A half-made new-app folder or registry is moved aside with a time stamp, never deleted. Commits the former builder
// made only in its clone on the engine host (<project folder>/repo) are pushed to GitHub as branch dev first (a plain
// push, never forced), so the built code is never lost.
import fs from "node:fs";
import path from "node:path";
import { dirsOf } from "../build/jobKit.ts";
import { JobFailure, type JobRun } from "../run.ts";
import { engineCli, runCommand, type Exec } from "./attach.ts";
import { GIT_AUTHOR, NAME_RE, shownRepo } from "./hostRegistry.ts";
import { officialHome } from "./home.ts";
import { onboardRegistry, writeReport, writeValidatedRegistry } from "./onboarding.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const GITHUB_PART = /^[A-Za-z0-9_.-]+$/;

export interface LegacyProduct {
  /** GitHub owner/repo. */
  repo: string;
  /** The branch to clone (dev when the repo has it). */
  branch: string;
  /** Why it is a former template builder's product, in plain words (for the job log). */
  why: string;
  /** A registry a failed new-app attempt left (moved aside before the onboarding). */
  halfMadeRegistry: boolean;
}

export interface LegacyDeps {
  exec?: Exec;
  /** Where the repo is cloned from (default MF_MADP_GIT_BASE, else https://github.com). */
  gitBase?: string;
  engineHome?: string;
  /** The Blocks CLI the lanes run (default: the engine user's own, attach.ts engineCli). */
  cliRunJs?: string;
  now?: () => Date;
}

/** Where product repos are cloned from: MF_MADP_GIT_BASE (e.g. a GitHub Enterprise address), else https://github.com. */
const gitBaseOf = (deps: LegacyDeps): string => (deps.gitBase || String(process.env.MF_MADP_GIT_BASE ?? "").trim() || "https://github.com").replace(/\/+$/, "");

/** owner/repo of a GitHub remote address, else "". */
export function githubRepoOf(remote: string): string {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : "";
}

function rowsOf(run: JobRun, schema: string): Row[] {
  try {
    return typeof run.p.rows === "function" ? run.p.rows(schema) : [];
  } catch {
    return [];
  }
}

/** The branches of the remote: null when the repository does not exist (or cannot be read), else its heads. GitHub
 *  being out of reach is an error, so a former product is never mistaken for a new one. */
async function remoteHeads(exec: Exec, remote: string): Promise<string[] | null> {
  const r = await exec("git", ["ls-remote", "--heads", remote], { timeoutMs: 60_000 });
  if (r.code === 0) return r.stdout.split(/\r?\n/).map((l) => /refs\/heads\/(.+)$/.exec(l.trim())?.[1] ?? "").filter(Boolean);
  if (/not found|does not exist|could not read Username|not appear to be a git repository|Authentication failed/i.test(r.stderr)) return null;
  throw new JobFailure("GitHub could not be reached to check the product's repository. Start the build again in a few minutes.", "madp.github_unreachable");
}

const pickBranch = (heads: string[], wanted: string): string =>
  heads.includes("dev") ? "dev" : wanted && heads.includes(wanted) ? wanted : heads.includes("main") ? "main" : heads.includes("master") ? "master" : heads[0] ?? "dev";

/** A former template builder's product, or null (a new product, or one already on the engine). Reads only. */
export async function legacyProduct(run: JobRun, dir: string, state: Row, name: string, deps: LegacyDeps = {}): Promise<LegacyProduct | null> {
  if (state.existing === true) return null;
  const exec = deps.exec ?? runCommand;
  const registry = path.join(dir, `${name}.yml`);
  const setup = rec(state.setup);
  // a registry new-app wrote for a product that was never deployed: half-made, unless it is a new product (below)
  const halfMadeRegistry = fs.existsSync(registry) && !Object.values(setup).some((v) => v === true);
  if (fs.existsSync(registry) && !halfMadeRegistry) return null;
  const p = run.p.project;
  const oldRepo = dirsOf(run).repo;
  let fromClone = "";
  if (fs.existsSync(path.join(oldRepo, ".git"))) {
    const o = await exec("git", ["-C", oldRepo, "remote", "get-url", "origin"], { timeoutMs: 30_000 });
    fromClone = o.code === 0 ? githubRepoOf(o.stdout) : "";
  }
  const owner = text(p.RepoOwner);
  const repoName = text(p.RepoName) || text(p.RepoExisting);
  const fromFields = text(p.RepoProvider) === "github" && GITHUB_PART.test(owner) && GITHUB_PART.test(repoName) ? `${owner}/${repoName}` : "";
  const repo = fromFields || fromClone;
  if (!repo) return null;
  const built = rowsOf(run, "Release").length > 0 || rowsOf(run, "Preview").length > 0;
  const offline = fromClone ? "the engine host has the former builder's clone" : built ? "the Factory has its earlier previews or releases" : "";
  // a new product that stopped at the portal step has a registry but nothing built: never a former product
  if (halfMadeRegistry && !offline) return null;
  if (!offline && p.BlocksProvisioningStatus !== "ready") return null;
  const gitBase = gitBaseOf(deps);
  const heads = await remoteHeads(exec, `${gitBase}/${repo}.git`);
  // an empty repository with the former builder's clone: its work is pushed as dev at the onboarding (pushBuilderWork)
  if (heads === null || (heads.length === 0 && !fromClone)) {
    if (offline) throw new JobFailure(`The product's repository ${shownRepo(repo, owner)} cannot be read on GitHub. Ask the engine team to give the engine access to it, then start it again.`, "madp.legacy_repo");
    return null;
  }
  return { repo, branch: pickBranch(heads, text(p.RepoBranch)), why: offline || "its GitHub repository exists with code", halfMadeRegistry };
}

/** The checks of a one-repo React app, as `madp project add` proposes them (pure of writes). */
export function detectChecks(repoPath: string): { verify: Row[]; fast_verify: Row[] } {
  let pkg: Row = {};
  try {
    pkg = rec(JSON.parse(fs.readFileSync(path.join(repoPath, "package.json"), "utf8")));
  } catch {
    /* none */
  }
  const scripts = rec(pkg.scripts);
  const hasTs = !!rec(pkg.devDependencies).typescript || !!rec(pkg.dependencies).typescript;
  const tsconfig = ["tsconfig.app.json", "tsconfig.json"].find((f) => fs.existsSync(path.join(repoPath, f)));
  const tsc = ["node", "node_modules/typescript/bin/tsc", "--noEmit", "-p", tsconfig ?? "tsconfig.json"];
  const verify: Row[] = [];
  const fast: Row[] = [];
  if (hasTs && tsconfig) {
    verify.push({ name: "typecheck", argv: tsc });
    fast.push({ name: "typecheck-incremental", argv: [...tsc, "--incremental", "--tsBuildInfoFile", "node_modules/.cache/madp/app.tsbuildinfo"] });
  }
  if (text(scripts.build)) verify.push({ name: "build", argv: ["npm", "run", "build"] });
  return { verify, fast_verify: fast };
}

/** The engine host's registry of a former product (pure). */
export function legacyRegistry(o: { name: string; repoPath: string; repo: string; tenant: string; url: string; cliRunJs: string; description: string; checks: { verify: Row[]; fast_verify: Row[] } }): Row {
  const app: Row = { path: o.repoPath, repo: o.repo, branch: "dev", role: "web", keywords: ["ui", "page", "screen", "button", "form", "api"], verify: o.checks.verify };
  if (o.checks.fast_verify.length) app.fast_verify = o.checks.fast_verify;
  if (/^https:\/\//.test(o.url)) app.health = [`${o.url.replace(/\/+$/, "")}/`];
  return {
    project: o.name,
    description: o.description,
    standards: { profile: "selise-blocks-app" },
    default_env: "dev",
    environments: { dev: { branch: "dev", tenant_id: o.tenant, ...(/^https:\/\//.test(o.url) ? { urls: { web: o.url } } : {}) } },
    git: { author_name: GIT_AUTHOR.name, author_email: GIT_AUTHOR.email, commit_trailer: "" },
    cli: { run_js: o.cliRunJs, cwd: o.repoPath, deploy_timeout: 1500, poll_interval: 2, env: { BLOCKS_STRICT_FLAGS: "1", BLOCKS_NO_UPDATE_CHECK: "1" } },
    repos: { app },
  };
}

/** The former builder's commits that GitHub does not have (its clone <project folder>/repo, whose origin is the
 *  product's repo), pushed as branch dev before the onboarding clones the repo: a plain push, never forced, that makes
 *  dev or moves it forward when dev is part of the builder's work. A dev branch with other work stops it in plain words
 *  and nothing is pushed. GitHub's branches are read into the clone's own `refs/madp/github/*` (its branches and work
 *  stay as they are). Answers whether it pushed, and the report's notes. */
export async function pushBuilderWork(run: JobRun, exec: Exec, oldRepo: string, remote: string, repo: string): Promise<{ pushed: boolean; notes: string[] }> {
  const none = { pushed: false, notes: [] as string[] };
  if (!fs.existsSync(path.join(oldRepo, ".git"))) return none;
  // the repository as people read it: never the GitHub account MADP Factory keeps the code in (shownRepo)
  const shown = shownRepo(repo, text(rec(run.p.project).RepoOwner));
  const git = (...args: string[]) => exec("git", ["-C", oldRepo, ...args], { timeoutMs: 10 * 60_000 });
  const origin = await git("remote", "get-url", "origin");
  if (origin.code !== 0 || githubRepoOf(origin.stdout).toLowerCase() !== repo.toLowerCase()) {
    run.log(`legacy onboarding: the former builder's clone names ${origin.code === 0 ? githubRepoOf(origin.stdout) || "another remote" : "no origin"}, not ${repo}; left as it is`);
    return none;
  }
  if ((await git("rev-parse", "--verify", "--quiet", "HEAD^{commit}")).code !== 0) return none;
  const dirty = (await git("status", "--porcelain")).stdout.trim() !== "";
  const dirtyNote = dirty ? ["The former builder's copy on the engine host also has changes that were never committed; they stay there and were not pushed."] : [];
  const fetched = await git("fetch", "--quiet", "--no-tags", "--prune", remote, "+refs/heads/*:refs/madp/github/*");
  if (fetched.code !== 0) throw new JobFailure("GitHub could not be reached to compare the product's repository with the former builder's work. Start the build again in a few minutes.", "madp.github_unreachable");
  const ahead = Number((await git("rev-list", "--count", "HEAD", "--not", "--glob=refs/madp/github/*")).stdout.trim()) || 0;
  if (ahead === 0) return { pushed: false, notes: dirtyNote };
  const hasDev = (await git("rev-parse", "--verify", "--quiet", "refs/madp/github/dev")).code === 0;
  if (hasDev && (await git("merge-base", "--is-ancestor", "refs/madp/github/dev", "HEAD")).code !== 0) {
    run.log(`legacy onboarding: the former builder's clone has ${ahead} commit(s) GitHub does not have, and ${repo} dev is not part of them; nothing pushed`);
    throw new JobFailure(
      `The former builder's copy of ${shown} on the engine host has work that GitHub does not have, and the repository's dev branch on GitHub has other work. Nothing was pushed or changed; the engine team must bring the two together first.`,
      "madp.legacy_unpushed",
    );
  }
  if ((await git("push", remote, "HEAD:refs/heads/dev")).code !== 0) {
    throw new JobFailure("The former builder's work could not be pushed to GitHub as branch dev. Nothing was lost: it is still on the engine host. Start it again; if it fails again, ask the engine team to push it.", "madp.legacy_push");
  }
  run.log(`legacy onboarding: pushed ${ahead} commit(s) of the former builder's clone to ${repo} dev`);
  return {
    pushed: true,
    notes: [
      `${ahead === 1 ? "1 commit" : `${ahead} commits`} of the former builder that were only on the engine host ${ahead === 1 ? "was" : "were"} pushed to GitHub as branch "dev"${hasDev ? "" : " (a new branch)"}. In the product's Blocks project, Release must list ${shown} on branch "dev".`,
      ...dirtyNote,
    ],
  };
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

/** Moves a path aside (`<path>.set-aside-<time>`), never deletes it. Answers the new name or "". */
function setAside(p: string, now: Date): string {
  if (!fs.existsSync(p)) return "";
  let to = `${p}.set-aside-${stamp(now)}`;
  for (let i = 2; fs.existsSync(to); i += 1) to = `${p}.set-aside-${stamp(now)}-${i}`;
  fs.renameSync(p, to);
  return to;
}

/** Onboards the former product: answers the factory.json state ensureApp then uses (existing: true). */
export async function onboardLegacy(run: JobRun, dir: string, name: string, legacy: LegacyProduct, step: (pct: number, line: string) => Promise<void>, deps: LegacyDeps = {}): Promise<Row> {
  const exec = deps.exec ?? runCommand;
  const now = (deps.now ?? (() => new Date()))();
  if (!NAME_RE.test(name)) throw new JobFailure("The product's MADP name is not valid. Ask the engine team to correct it, then start it again.", "madp.registry");
  const p = run.p.project;
  const tenant = text(p.BlocksProjectRef);
  if (p.BlocksProvisioningStatus !== "ready" || !/^D[0-9a-f]{32}$/i.test(tenant)) throw new JobFailure("The product's Blocks project is not ready, so it cannot be set up on the MADP engine yet.", "blocks.project_not_ready");
  const url = text(p.BlocksProjectDomain).replace(/\/+$/, "");
  // the repository as people read it: never the GitHub account MADP Factory keeps the code in (shownRepo)
  const shown = shownRepo(legacy.repo, text(p.RepoOwner));
  await step(6, `Setting up the repository ${shown} on the official MADP engine: its code, its checks and its languages.`);
  fs.mkdirSync(dir, { recursive: true });

  // what a failed new-app attempt left: moved aside, never deleted
  const notes: string[] = [];
  for (const left of [path.join(dir, name), ...(legacy.halfMadeRegistry ? [path.join(dir, `${name}.yml`)] : [])]) {
    const to = setAside(left, now);
    if (to) {
      notes.push(`An unfinished earlier set-up (${path.basename(left)}) was moved aside to ${path.basename(to)}.`);
      run.log(`legacy onboarding: moved ${path.basename(left)} aside to ${path.basename(to)}`);
    }
  }

  // the former builder's work that only its clone on the engine host has goes to GitHub first, as branch dev
  const gitBase = gitBaseOf(deps);
  const remote = `${gitBase}/${legacy.repo}.git`;
  const builder = await pushBuilderWork(run, exec, dirsOf(run).repo, remote, legacy.repo);
  notes.push(...builder.notes);

  // the clone (kept when it is one of this repo already), branch dev
  const repoPath = path.join(dir, `${name}-app`);
  const git = (...args: string[]) => exec("git", ["-C", repoPath, ...args], { timeoutMs: 10 * 60_000 });
  let kept = false;
  if (fs.existsSync(repoPath)) {
    const o = fs.existsSync(path.join(repoPath, ".git")) ? await git("remote", "get-url", "origin") : null;
    kept = o?.code === 0 && o.stdout.trim().replace(/\.git$/, "").toLowerCase() === remote.replace(/\.git$/, "").toLowerCase();
    if (!kept) notes.push(`A folder in the way (${path.basename(repoPath)}) was moved aside to ${path.basename(setAside(repoPath, now))}.`);
  }
  if (!fs.existsSync(repoPath)) {
    const c = await exec("git", ["clone", "--branch", builder.pushed ? "dev" : legacy.branch, remote, repoPath], { timeoutMs: 20 * 60_000 });
    if (c.code !== 0) throw new JobFailure(`The product's repository ${shown} could not be copied to the engine host. Start it again in a few minutes; if it fails again, ask the engine team to look into it.`, "madp.legacy_clone");
  } else if (kept && builder.pushed) {
    // a clone of an earlier attempt takes the pushed work (fast-forward only)
    const synced = (await git("fetch", "--quiet", "origin")).code === 0 && (await git("checkout", "--quiet", "dev")).code === 0 && (await git("merge", "--ff-only", "--quiet", "origin/dev")).code === 0;
    if (!synced) throw new JobFailure("The product's copy on the engine host could not take the former builder's work from its dev branch. Ask the engine team to bring the copy up to date, then start it again.", "madp.legacy_branch");
  }
  const head = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
  if (head !== "dev") {
    // Blocks deploys the branch named after the environment: dev, made from the product's branch (a plain push, never forced)
    const has = (await git("rev-parse", "--verify", "--quiet", "refs/heads/dev")).code === 0;
    if ((await git(...(has ? ["checkout", "dev"] : ["checkout", "-b", "dev"]))).code !== 0) throw new JobFailure("The product's dev branch could not be made. Start it again; if it fails again, ask the engine team to look into it.", "madp.legacy_branch");
    if ((await git("push", "origin", "dev")).code !== 0) throw new JobFailure("The product's dev branch could not be pushed to GitHub. Start it again; if it fails again, ask the engine team to look into it.", "madp.legacy_branch");
    notes.push(`The repository had no dev branch; MADP made one from ${head} and pushed it. In the product's Blocks project, Release must list ${shown} on branch "dev".`);
  }
  const lock = fs.existsSync(path.join(repoPath, "package-lock.json"));
  const install = await exec("npm", lock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: repoPath, timeoutMs: 30 * 60_000 });
  if (install.code !== 0) throw new JobFailure("Installing the product's packages on the engine host did not go through. Start it again in a few minutes; if it fails again, ask the engine team to look into it.", "madp.legacy_install");

  // the registry (validated with its paths), then the onboarding checks on the pristine dev branch
  const checks = detectChecks(repoPath);
  if (checks.verify.length === 0) throw new JobFailure("The product's repository has no type check or build script the engine can run.", "madp.legacy_checks");
  const cliRunJs = deps.cliRunJs || engineCli() || path.join(repoPath, "node_modules", "@seliseblocks", "cli-os", "bin", "run.js");
  if (!fs.existsSync(cliRunJs)) throw new JobFailure("The engine host has no Blocks CLI for the product's deployments. Ask the engine team to install it, then start it again.", "madp.blocks_cli");
  const engineHome = path.resolve(deps.engineHome || officialHome());
  const file = path.join(dir, `${name}.yml`);
  const data = legacyRegistry({ name, repoPath, repo: legacy.repo, tenant, url, cliRunJs, description: `${run.p.name.slice(0, 80)} (made by the MADP Factory before 05.11.2026)`, checks });
  const problems = await writeValidatedRegistry(exec, engineHome, file, data);
  if (problems.length) {
    run.log(`legacy onboarding: registry refused: ${problems.join("; ").slice(0, 600)}`);
    throw new JobFailure("The product's MADP registry could not be completed. Ask the engine team to complete it, then start it again.", "madp.registry");
  }
  await step(12, "Checking the product's code once on its dev branch, as it is.");
  const onboarded = await onboardRegistry(data, { exec, productDir: dir, now: deps.now, log: (l) => run.log(l) });
  const again = await writeValidatedRegistry(exec, engineHome, file, onboarded.data);
  if (again.length) throw new JobFailure("The product's MADP registry could not be completed. Ask the engine team to complete it, then start it again.", "madp.registry");
  writeReport(dir, { ...onboarded.report, notes: [...notes, ...onboarded.report.notes] });
  const state: Row = { name, org: legacy.repo.split("/")[0]!, existing: true, legacy: true, data: true, setup: { app: true }, url };
  fs.writeFileSync(path.join(dir, "factory.json.tmp"), `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(path.join(dir, "factory.json.tmp"), path.join(dir, "factory.json"));
  run.log(`legacy onboarding: ${legacy.repo} (${legacy.why}): ${onboarded.report.summary}`);
  await step(16, `The repository ${shown} is set up on the official MADP engine. ${onboarded.report.summary}`);
  return state;
}

// The official MADP registry (MADP/projects/<name>.yml, format MADP/projects/_template.yml) of a product on the engine
// host, and how an existing product's registry becomes one.
//
// An existing product (brownfield) already has an official registry, written for the operator's own machine: its repos
// are clones there, its checks may name scripts in the operator's copy of the engine, its git author is a person and
// its environments reach STAGE. `hostRegistry` turns that file into the registry the engine host runs the lanes with:
// the repos are the engine host's clones in <project folder>/madp, the checks point at the host's engine, the author is
// the Factory's, only dev is reachable unless STAGE is asked for, and nothing from the operator's machine (home paths,
// CLI session folders, secrets files, the data folder, the full-pipeline section) is carried over unless given again.
// Everything here is pure (no file system), so the operator's attach command and the tests share it.
import path from "node:path";
import YAML from "yaml";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The Factory's git identity on every product commit the engine host makes. */
export const GIT_AUTHOR = { name: "MADP Factory", email: "engine@madp-factory.local" } as const;

/** The registry's `project` id (project_registry.py `_ID_RE`). */
export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,39}$/;
const GITHUB_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ENV_NAMES = new Set(["dev", "test", "stg", "iat", "prod"]);
/** A Blocks tenant id of an environment: its initial in upper case and the 32-hex tenant-group id. */
export const tenantPattern = (env: string): RegExp => new RegExp(`^${(env[0] ?? "d").toUpperCase()}[0-9a-f]{32}$`);

// ------------------------------------------------------------------ reading a registry

/** A registry's YAML, read the way the official engine reads it (PyYAML: YAML 1.1). */
export function parseRegistry(yml: string): Row {
  const data: unknown = YAML.parse(yml, { version: "1.1" });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The registry is not a YAML mapping.");
  return data as Row;
}

/** A registry as YAML the official engine reads back unchanged (strings such as "on" or "no" stay strings). */
export const registryYaml = (data: Row): string => YAML.stringify(data, { version: "1.1", lineWidth: 0 });

export interface RegistryRepo {
  /** The repo key (`--target`): api, web, app, ... */
  key: string;
  path: string;
  /** GitHub org/repo, as Blocks Release knows it. */
  repo: string;
  branch: string;
  /** api | web | other | "" */
  role: string;
}

/** The registry's repositories, in registry order. */
export function registryRepos(data: Row): RegistryRepo[] {
  return Object.entries(rec(data.repos)).map(([key, v]) => {
    const r = rec(v);
    return { key, path: text(r.path), repo: text(r.repo), branch: text(r.branch) || "dev", role: text(r.role) };
  });
}

/** A repository ("owner/name") as people read it in the app. The owner is named only when the project's own record
 *  names it (Project.RepoOwner: the team's repository, shown on the project's page anyway). Any other owner is the
 *  GitHub account MADP Factory keeps the product's code in (MF_MADP_GITHUB_ORG, else the engine host's `gh` login),
 *  which can be a person's own account and is never shown: such a repository is named by its name alone (pure). */
export function shownRepo(repo: string, projectOwner = ""): string {
  const slash = repo.indexOf("/");
  if (slash < 0) return repo;
  const own = projectOwner.trim().toLowerCase();
  return own && repo.slice(0, slash).toLowerCase() === own ? repo : repo.slice(slash + 1);
}

/** The order the lanes deploy in: API-role repos first, then the rest in registry order. */
export const deployOrder = (repos: RegistryRepo[]): RegistryRepo[] => [...repos.filter((r) => r.role === "api"), ...repos.filter((r) => r.role !== "api")];

/** The dev environment's Blocks tenant ("" when the registry has none). */
export const devTenantOf = (data: Row): string => text(rec(rec(data.environments).dev).tenant_id);

/** The official Blocks CLI the lanes run (cli.run_js, cli.cwd). */
export const cliOf = (data: Row): { runJs: string; cwd: string } => ({ runJs: text(rec(data.cli).run_js), cwd: text(rec(data.cli).cwd) });

// ------------------------------------------------------------------ an existing product's registry on the engine host

export interface HostRegistryOptions {
  /** The product's MADP folder on the engine host: <project folder>/madp (absolute). */
  dir: string;
  /** The Blocks tenant of dev: D + 32 hex. */
  devTenant: string;
  /** The official engine's folder on the engine host: checks that run the operator's copy of the engine use this one. */
  engineHome: string;
  /** The git author of every commit (default: the Factory's). */
  author?: { name?: string; email?: string };
  /** An extra line under every commit message (default: none). */
  commitTrailer?: string;
  /** Keep the registry's other environments (stg, prod, ...). Default: dev only, STAGE stays locked. */
  withStage?: boolean;
  /** The product's data folder on the engine host (work_dir), when it needs one. */
  workDir?: string;
  /** Per environment, the CLI session folders and release secrets files on the engine host. */
  envPaths?: Record<string, { cliConfigDir?: string; cliCwd?: string; secretsFiles?: Record<string, string> }>;
  /** Per repo key, the release secrets dotenv on the engine host (secrets_file). */
  secretsFiles?: Record<string, string>;
  /** The Blocks CLI the lanes run (absolute run.js): the engine's own copy, where its login lives. Default: the copy in
   *  the product's CLI repo. A product that pins an older CLI must not run it against the engine's login (an older CLI
   *  rewrites the login store in its own format, and the engine's account login is lost). */
  cliRunJs?: string;
  /** The folder of the products' own Blocks login stores on the engine host (home.ts productStoreRoot): every attached
   *  environment without a given cliConfigDir signs in to Blocks in <blocksStores>/<name>-<env>, never in the engine's
   *  default store (one store keeps one project session; another product's call would evict it). */
  blocksStores?: string;
}

export interface HostRegistry {
  name: string;
  /** <dir>/<name>.yml */
  file: string;
  yaml: string;
  data: Row;
  /** The repos at their engine-host paths, in registry order. */
  repos: RegistryRepo[];
  /** The repo whose node_modules holds the official Blocks CLI. */
  cliRepo: string;
  environments: string[];
  /** What was left out or needs the operator, in plain words (keys only, never the values). */
  notes: string[];
  /** The checks left out because they name a path on the operator's machine (for the onboarding report). */
  leftOut: Array<{ repo: string; kind: string; name: string; reason: string }>;
}

const isAbsolute = (p: string): boolean => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p);
const trimSep = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An exact path, only where a path can end (end, separator, quote or space). */
const pathRe = (p: string): RegExp => new RegExp(`${escapeRe(p)}(?=$|[\\\\/\\s"'])`, "g");

/** A folder of the engine: <root>/MADP/<orchestrator|scripts|profiles|config|projects>/... */
const ENGINE_PART = /MADP[\\/](?:orchestrator|scripts|profiles|config|projects)[\\/]/g;

/** The engine folders a string names: the absolute part before "MADP/..." (quoted paths may hold spaces). */
function engineRoots(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(ENGINE_PART)) {
    const at = m.index ?? 0;
    const from = Math.max(s.lastIndexOf('"', at), s.lastIndexOf("'", at)) + 1;
    const span = s.slice(from, at);
    let start = -1;
    for (let j = 0; j < span.length; j += 1) {
      if ((j === 0 || /[\s=]/.test(span[j - 1]!)) && isAbsolute(span.slice(j))) {
        start = j;
        break;
      }
    }
    if (start >= 0) {
      const root = trimSep(span.slice(start));
      if (root && isAbsolute(root)) out.push(root);
    }
  }
  return out;
}

/** Every string in a value, with where it is (for the leftover guard). */
function strings(v: unknown, at: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof v === "string") out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, at ? `${at}.${k}` : k, out);
  return out;
}

/** The longest folder every given absolute path shares, when it is at least two folders deep (e.g. a home folder). */
function sharedBase(paths: string[]): string {
  const split = paths.map((p) => p.replace(/\\/g, "/").split("/").filter(Boolean));
  if (split.length === 0) return "";
  const first = split[0]!;
  let n = 0;
  while (n < first.length && split.every((s) => s[n] === first[n])) n += 1;
  if (n < 2) return "";
  const lead = paths[0]!.startsWith("/") ? "/" : "";
  return `${lead}${first.slice(0, n).join("/")}`;
}

const HOME_PATTERNS = [/\/home\/[^/\s"']+/, /\/Users\/[^/\s"']+/, /[A-Za-z]:[\\/]Users[\\/]/i, /\/root\//];

/** The engine-host registry of an existing product (pure). Throws, in plain words, when the source cannot be used. */
export function hostRegistry(sourceYaml: string, o: HostRegistryOptions): HostRegistry {
  const src = parseRegistry(sourceYaml);
  const notes: string[] = [];
  const leftOut: HostRegistry["leftOut"] = [];
  const name = text(src.project);
  if (!NAME_RE.test(name)) throw new Error("The registry has no valid `project` id (lower-case a-z, 0-9, . _ -).");
  if (!isAbsolute(o.dir)) throw new Error("The product's MADP folder must be an absolute path.");
  if (!isAbsolute(o.engineHome)) throw new Error("The official engine's folder must be an absolute path.");
  if (!tenantPattern("dev").test(o.devTenant)) throw new Error("The dev tenant id must be D followed by 32 lower-case hex digits.");
  if (o.blocksStores !== undefined && !isAbsolute(o.blocksStores)) throw new Error("The folder of the products' Blocks sign-ins must be an absolute path.");
  const dir = trimSep(o.dir);
  const engineHome = trimSep(o.engineHome);
  const file = path.join(dir, `${name}.yml`);

  // the repos and where they go on the engine host
  const srcRepos = Object.entries(rec(src.repos));
  if (srcRepos.length === 0) throw new Error("The registry has no repos.");
  for (const [key, spec] of srcRepos) {
    if (!KEY_RE.test(key)) throw new Error(`The repo key "${key.slice(0, 40)}" cannot name a folder.`);
    if (!GITHUB_RE.test(text(rec(spec).repo))) throw new Error(`repos.${key}.repo must be a GitHub org/repo.`);
  }
  const hostPath = (key: string): string => path.join(dir, `${name}-${key}`);
  const srcCli = cliOf(src);
  const oldPaths = srcRepos.map(([key, spec]) => [key, trimSep(text(rec(spec).path))] as const);
  const inside = (p: string, base: string): boolean => !!base && (p === base || p.startsWith(`${base}/`) || p.startsWith(`${base}\\`));
  const cliRepo =
    oldPaths.find(([, p]) => inside(srcCli.runJs, p) || inside(trimSep(srcCli.cwd), p))?.[0] ??
    srcRepos.find(([, s]) => text(rec(s).role) === "api")?.[0] ??
    srcRepos.find(([k]) => k === "api")?.[0] ??
    srcRepos[0]![0];

  // every absolute path of the source: what the operator's machine looks like (none of it may reach the host registry)
  const srcEnvs = rec(src.environments);
  const operatorPaths = [
    ...oldPaths.map(([, p]) => p),
    srcCli.runJs, srcCli.cwd, text(src.work_dir), text(rec(src.pipeline).work_root),
    ...srcRepos.map(([, s]) => text(rec(s).secrets_file)),
    ...Object.values(srcEnvs).flatMap((e) => [text(rec(e).cli_config_dir), text(rec(e).cli_cwd), ...Object.values(rec(rec(e).secrets_files)).map(text)]),
  ].map(trimSep).filter(isAbsolute);
  const base = sharedBase(operatorPaths);

  // the operator's copy of the engine, as the checks name it
  const roots = new Set<string>();
  for (const [, spec] of srcRepos) {
    for (const kind of ["verify", "fast_verify", "live_test", "post_deploy"]) {
      for (const step of list(rec(spec)[kind])) for (const a of list(rec(step).argv)) if (typeof a === "string") engineRoots(a).forEach((r) => roots.add(r));
    }
  }
  const standards = rec(src.standards);
  engineRoots(text(standards.file)).forEach((r) => roots.add(r));

  const swaps: Array<[string, string]> = [
    ...oldPaths.filter(([, p]) => isAbsolute(p)).map(([key, p]) => [p, hostPath(key)] as [string, string]),
    ...(isAbsolute(srcCli.cwd) ? [[trimSep(srcCli.cwd), hostPath(cliRepo)] as [string, string]] : []),
    ...[...roots].filter((r) => r !== engineHome).map((r) => [r, engineHome] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length);
  const rewrite = (s: string): string => {
    // one pass per source path, longest first; a replaced part is never matched again
    const marks: string[] = [];
    let out = s;
    for (const [from, to] of swaps) {
      out = out.replace(pathRe(from), () => {
        marks.push(to);
        return `\u0000${marks.length - 1}\u0000`;
      });
    }
    return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => marks[Number(i)]!);
  };
  /** True when a string still names the operator's machine (after the host's own folders are taken out). */
  const operatorLeft = (s: string): boolean => {
    // the host's own paths: the product folder, the official engine, its data folder, the Blocks stores, and the engine's
    // own Blocks CLI (cliRunJs: where its login lives, under the engine user's home)
    const hostPaths = [dir, engineHome, ...(o.workDir ? [o.workDir] : []), ...(o.blocksStores ? [trimSep(o.blocksStores)] : []), ...(o.cliRunJs && isAbsolute(o.cliRunJs) ? [o.cliRunJs] : [])];
    const bare = hostPaths.reduce((acc, p) => acc.split(p).join(""), s);
    return (
      (!!base && bare.includes(base)) ||
      operatorPaths.some((p) => bare.includes(p)) ||
      HOME_PATTERNS.some((re) => re.test(bare))
    );
  };

  // the checks of a repo: paths re-pointed, `--project <name>` given as the host registry's file
  const steps = (key: string, kind: string, raw: unknown): Row[] => {
    const out: Row[] = [];
    for (const [i, s] of list(raw).entries()) {
      const step = rec(s);
      const stepName = text(step.name) || `#${i + 1}`;
      const argv = list(step.argv).map((a) => (typeof a === "string" ? rewrite(a) : a));
      for (let j = 0; j < argv.length; j += 1) {
        if (argv[j] === "--project" && argv[j + 1] === name) argv[j + 1] = file;
        else if (argv[j] === `--project=${name}`) argv[j] = `--project=${file}`;
      }
      const cwd = text(step.cwd) ? rewrite(text(step.cwd)) : "";
      if ([...argv, cwd].some((a) => typeof a === "string" && operatorLeft(a))) {
        notes.push(`repos.${key}.${kind} "${stepName}" was left out: it names a path on the operator's machine. Add it again with a path on the engine host.`);
        leftOut.push({ repo: key, kind, name: stepName, reason: "it names a file on another machine" });
        continue;
      }
      if (argv.some((a) => typeof a === "string" && /(?:^|[\s=/"'])\.env\b/.test(a))) {
        notes.push(`repos.${key}.${kind} "${stepName}" reads a .env file, which is not in git: place it in the engine host's clone before the first build, or that check fails.`);
      }
      out.push({ name: stepName, argv, ...(cwd ? { cwd } : {}) });
    }
    return out;
  };

  const repos: Row = {};
  const hostRepos: RegistryRepo[] = [];
  for (const [key, raw] of srcRepos) {
    const spec = rec(raw);
    const role = text(spec.role) || (key === "api" || key === "web" ? key : "");
    const branch = text(spec.branch) || "dev";
    const verify = steps(key, "verify", spec.verify);
    if (verify.length === 0) throw new Error(`repos.${key}.verify has no check the engine host can run (each names a path on the operator's machine or none is given).`);
    const out: Row = { path: hostPath(key), repo: text(spec.repo), branch, ...(role ? { role } : {}) };
    const keywords = list(spec.keywords).filter((k): k is string => typeof k === "string");
    if (keywords.length) out.keywords = keywords;
    out.verify = verify;
    for (const kind of ["fast_verify", "live_test"]) {
      if (spec[kind] === undefined) continue;
      const kept = steps(key, kind, spec[kind]);
      if (kept.length) out[kind] = kept;
    }
    const health = list(spec.health).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    if (health.length) out.health = health;
    const iso = rec(spec.isolation);
    const isolation: Row = {};
    for (const k of ["links", "copy"]) {
      const kept = list(iso[k]).filter((x): x is string => typeof x === "string" && !!x.trim() && !isAbsolute(x) && !x.split(/[\\/]/).includes(".."));
      if (kept.length) isolation[k] = kept;
    }
    if (Object.keys(isolation).length) out.isolation = isolation;
    const secrets = text(o.secretsFiles?.[key]);
    if (secrets) out.secrets_file = secrets;
    else if (text(spec.secrets_file)) notes.push(`repos.${key}.secrets_file was left out (a file on the operator's machine).`);
    if (spec.post_deploy !== undefined) notes.push(`repos.${key}.post_deploy was left out: the Factory's lanes run without post-deploy commands.`);
    for (const k of Object.keys(spec)) {
      // acceptance: its test accounts live in a folder of the operator's machine; the onboarding suggests the section
      // again with the engine host's folder and turns it on only once that folder exists (onboarding.ts)
      if (k === "acceptance") notes.push(`repos.${key}.acceptance was left out: its test accounts are on the operator's machine. The onboarding suggests it again and turns it on once the accounts are on the engine host.`);
      else if (!["path", "repo", "branch", "role", "keywords", "verify", "fast_verify", "live_test", "health", "isolation", "secrets_file", "post_deploy"].includes(k)) {
        notes.push(`repos.${key}.${k} was left out.`);
      }
    }
    repos[key] = out;
    hostRepos.push({ key, path: hostPath(key), repo: text(spec.repo), branch, role });
  }

  // environments: dev with the operator's tenant; the others only when asked for
  if (!srcEnvs.dev) throw new Error("The registry has no dev environment.");
  const included = Object.keys(srcEnvs).filter((n) => n === "dev" || o.withStage === true);
  for (const n of Object.keys(srcEnvs)) {
    if (!included.includes(n)) notes.push(`environments.${n} was left out: only dev is reachable unless the product is attached with STAGE (--with-stage).`);
  }
  const environments: Row = {};
  for (const n of included) {
    if (!ENV_NAMES.has(n)) throw new Error(`environments.${n} is not a Blocks environment (dev, test, stg, iat, prod).`);
    const spec = rec(srcEnvs[n]);
    const tenant = n === "dev" ? o.devTenant : text(spec.tenant_id);
    if (tenant && !tenantPattern(n).test(tenant)) throw new Error(`environments.${n}.tenant_id must be ${n[0]!.toUpperCase()} followed by 32 lower-case hex digits.`);
    const out: Row = { branch: text(spec.branch) || n, ...(tenant ? { tenant_id: tenant } : {}) };
    if (typeof spec.explicit_only === "boolean") out.explicit_only = spec.explicit_only;
    const from = text(spec.promote_from);
    if (from && included.includes(from)) out.promote_from = from;
    else if (from) notes.push(`environments.${n}.promote_from was left out: ${from} is not attached.`);
    const urls = Object.fromEntries(Object.entries(rec(spec.urls)).filter(([, u]) => typeof u === "string" && /^https?:\/\//.test(u)));
    if (Object.keys(urls).length) out.urls = urls;
    const health = Object.fromEntries(
      Object.entries(rec(spec.health))
        .filter(([rk]) => rk in repos)
        .map(([rk, us]) => [rk, list(us).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))]),
    );
    if (Object.keys(health).length) out.health = health;
    const given = o.envPaths?.[n] ?? {};
    for (const [key, value] of [["cli_config_dir", given.cliConfigDir], ["cli_cwd", given.cliCwd]] as const) {
      if (text(value)) {
        if (!isAbsolute(text(value))) throw new Error(`environments.${n}.${key} must be an absolute path on the engine host.`);
        out[key] = text(value);
      } else if (key === "cli_config_dir" && o.blocksStores) {
        // the product's own Blocks sign-in for this environment (people connect it on the product's page)
        out[key] = path.join(trimSep(o.blocksStores), `${name}-${n}`);
      } else if (text(spec[key])) {
        notes.push(`environments.${n}.${key} was left out (a folder on the operator's machine)${key === "cli_config_dir" ? `: ${n} then runs under the engine host's default Blocks login` : ""}.`);
      }
    }
    const secrets = Object.fromEntries(Object.entries(given.secretsFiles ?? {}).filter(([rk, p]) => rk in repos && !!text(p)));
    if (Object.keys(secrets).length) out.secrets_files = secrets;
    else if (Object.keys(rec(spec.secrets_files)).length) notes.push(`environments.${n}.secrets_files were left out (files on the operator's machine).`);
    environments[n] = out;
  }

  // the Factory's git identity, the official CLI of the engine host's clone
  const author = { name: text(o.author?.name) || GIT_AUTHOR.name, email: text(o.author?.email) || GIT_AUTHOR.email };
  if (!author.email.includes("@")) throw new Error("The git author's e-mail must contain @.");
  const srcCliRow = rec(src.cli);
  const cliEnv: Row = {};
  for (const [k, v] of Object.entries(rec(srcCliRow.env))) {
    const value = v === null || v === undefined ? "" : String(v);
    if (k === "BLOCKS_CONFIG_DIR" && o.blocksStores) notes.push("cli.env.BLOCKS_CONFIG_DIR was left out: each environment signs in with its own store (cli_config_dir).");
    else if (operatorLeft(rewrite(value))) notes.push(`cli.env.${k} was left out (a path on the operator's machine).`);
    else cliEnv[k] = rewrite(value);
  }
  cliEnv.BLOCKS_STRICT_FLAGS = "1";
  cliEnv.BLOCKS_NO_UPDATE_CHECK = "1";
  const posInt = (v: unknown, d: number): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : d);
  const cli: Row = {
    run_js: o.cliRunJs && isAbsolute(o.cliRunJs) ? o.cliRunJs : path.join(hostPath(cliRepo), "node_modules", "@seliseblocks", "cli-os", "bin", "run.js"),
    cwd: hostPath(cliRepo),
    deploy_timeout: posInt(srcCliRow.deploy_timeout, 1500),
    poll_interval: posInt(srcCliRow.poll_interval, 2),
    env: cliEnv,
  };

  const data: Row = { project: name };
  if (text(src.description)) data.description = text(src.description);
  if (o.workDir) {
    if (!isAbsolute(o.workDir)) throw new Error("The data folder (work_dir) must be an absolute path on the engine host.");
    data.work_dir = o.workDir;
  } else if (text(src.work_dir)) {
    notes.push("work_dir was left out (the operator's data folder).");
  }
  if (Object.keys(standards).length) {
    const out: Row = {};
    if (text(standards.profile)) out.profile = text(standards.profile);
    const f = rewrite(text(standards.file));
    if (f && !operatorLeft(f)) out.file = f;
    else if (f) notes.push("standards.file was left out (a file on the operator's machine).");
    if (Object.keys(out).length) data.standards = out;
  }
  const rules = list(src.agent_rules).filter((r): r is string => typeof r === "string" && !!r.trim());
  const keptRules = rules.filter((r) => !operatorLeft(r));
  if (keptRules.length < rules.length) notes.push(`${rules.length - keptRules.length} of the agent_rules were left out: they name paths on the operator's machine.`);
  if (keptRules.length) data.agent_rules = keptRules;
  if (src.localization !== undefined) data.localization = src.localization;
  // live debugging on dev, the change records in the repos and the parallel streams' merge-friendly files (plain
  // settings; the engine validates them)
  for (const k of ["live_debug", "change_records", "streams"]) if (src[k] !== undefined) data[k] = src[k];
  data.default_env = "dev";
  data.environments = environments;
  data.git = { author_name: author.name, author_email: author.email, commit_trailer: o.commitTrailer ?? "" };
  data.cli = cli;
  data.repos = repos;
  if (src.pipeline !== undefined) notes.push("pipeline was left out: the Factory runs the quick and feature lanes, not the full pipeline.");
  for (const k of Object.keys(src)) {
    if (!["project", "description", "work_dir", "standards", "agent_rules", "localization", "live_debug", "change_records", "streams", "default_env", "environments", "deploy", "git", "cli", "repos", "pipeline"].includes(k)) {
      notes.push(`${k} was left out.`);
    }
  }

  // the guard: nothing of the operator's machine reaches the engine host's registry
  const leak = strings(data, "").find(([, s]) => operatorLeft(s));
  if (leak) throw new Error(`The engine host's registry would name a path on the operator's machine (${leak[0]}).`);

  return { name, file, yaml: hostYaml(data), data, repos: hostRepos, cliRepo, environments: included, notes, leftOut };
}

/** The engine host's registry file of a product: the header, then the data (the attach command, onboarding.ts). */
export const hostYaml = (data: Row): string =>
  [
    "# MADP registry of a product on the MADP Factory's engine host (written by the Factory's attach or onboarding step).",
    "# Format: MADP/projects/_template.yml of the official engine. The repos are the engine host's clones.",
    "",
  ].join("\n") + registryYaml(data);

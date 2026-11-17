// What product.document reads about a live product on the engine host, read-only: the product's registry in its MADP
// folder (<project folder>/madp: description, the owner's rules, repositories, environments with their branches and
// addresses, languages), the repositories' FILE MAP (official/fileMap.ts productCode), the module candidates (the
// folders and route files people use), the data tables (blocks/data/schemas), the repositories' own documents
// (README.md, docs/*.md), the existing design system (token CSS, theme lists, typefaces) and git facts (each
// environment branch's head commit and version, version tags, when each module first appeared).
//
// Read-only on the code: the only commands are `git ls-files`, `git log`, `git show <ref>:<file>`, `git rev-parse` and
// `git for-each-ref` (no fetch, no checkout, no optional locks), and files are read, never written. Nothing here
// throws: a source that cannot be read is left out, and the plan says what was left empty.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ExistingDesignSystem, LiveCommit, LiveEnvironment } from "../../../../../src/domain/liveProduct";
import { parseYaml, productCode, type MapEntry } from "../../official/fileMap.ts";
import { slugOf } from "../../text.ts";

const exec = promisify(execFile);
type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── git, read-only ──────────────────────────────────────────────────────────────────────────────────────────────────

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", LC_ALL: "C" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) delete env[k];
  return env;
}

/** A read-only git command's output, or null when it fails. */
export async function gitRead(dir: string, args: string[], timeoutMs = 30_000): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-c", "core.fsmonitor=false", "--no-pager", ...args], { cwd: dir, env: gitEnv(), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
    return stdout;
  } catch {
    return null;
  }
}

const HEX40 = /^[0-9a-f]{40}$/;

/** The commit a branch points at on this host's copy: origin's branch first (what the remote holds as the clone last
 *  saw it), else the local branch; null when neither exists. */
export async function branchHead(dir: string, branch: string): Promise<{ ref: string; commit: string; at: string } | null> {
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..")) return null;
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const out = await gitRead(dir, ["log", "-1", "--format=%H%x1f%cI", ref, "--"]);
    const [commit, at] = (out ?? "").trim().split("\x1f");
    if (commit && HEX40.test(commit)) return { ref, commit, at: at ?? "" };
  }
  return null;
}

/** The version a package.json says at a ref ("1.2.3", or "" when there is none or it is not a version). */
export async function versionAt(dir: string, ref: string): Promise<string> {
  const out = await gitRead(dir, ["show", `${ref}:package.json`]);
  if (!out) return "";
  try {
    const v = str(rec(JSON.parse(out)).version).replace(/[-+].*$/, "");
    return /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(v) ? v : "";
  } catch {
    return "";
  }
}

/** The tracked paths matching the pathspecs (git ls-files). */
async function tracked(dir: string, specs: string[]): Promise<string[]> {
  const out = await gitRead(dir, ["ls-files", "-z", "--", ...specs], 60_000);
  return (out ?? "").split("\0").map((p) => p.trim()).filter(Boolean);
}

const MAX_READ = 300_000;
function readSmall(dir: string, rel: string, max = MAX_READ): string {
  try {
    const file = path.join(dir, ...rel.split("/"));
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > max) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// ── the registry ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RegistryFacts {
  name: string;
  description: string;
  agentRules: string[];
  /** repository key -> its branch, role and GitHub name ("owner/name") */
  repos: Record<string, { branch: string; role: string; repo: string }>;
  /** environment -> its branch and web address, as the registry names them */
  environments: Partial<Record<LiveEnvironment, { branch: string; url: string }>>;
  /** the languages the product is translated into ("en-US", "de-CH") */
  languages: string[];
}

const ENV_NAMES: Record<string, LiveEnvironment> = { dev: "dev", development: "dev", stg: "stage", stage: "stage", staging: "stage", prod: "production", production: "production" };

/** The registry's facts (pure over its YAML text). */
export function registryFacts(yml: string): RegistryFacts | null {
  let data: Row;
  try {
    data = rec(parseYaml(yml));
  } catch {
    return null;
  }
  const repos: RegistryFacts["repos"] = {};
  for (const [key, v] of Object.entries(rec(data.repos))) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue;
    const r = rec(v);
    repos[key] = { branch: str(r.branch), role: str(r.role), repo: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(str(r.repo)) ? str(r.repo) : "" };
  }
  const environments: RegistryFacts["environments"] = {};
  for (const [name, v] of Object.entries(rec(data.environments))) {
    const env = ENV_NAMES[name.toLowerCase()];
    if (!env) continue;
    const e = rec(v);
    const urls = rec(e.urls);
    const url = [str(urls.web), str(e.url), ...Object.values(urls).map(str)].find((u) => /^https:\/\/[^\s/]+/.test(u)) ?? "";
    environments[env] = { branch: str(e.branch), url: url.replace(/\/+$/, "") };
  }
  const loc = rec(data.localization);
  const languages = list(loc.cultures).map(str).filter((c) => /^[a-z]{2}(-[A-Za-z]{2})?$/.test(c));
  if (!languages.length && str(loc.source)) languages.push(str(loc.source));
  return {
    name: str(data.project),
    description: str(data.description),
    agentRules: list(data.agent_rules).map(str).filter(Boolean),
    repos,
    environments,
    languages,
  };
}

// ── module candidates ───────────────────────────────────────────────────────────────────────────────────────────────

/** One part of a module candidate: a folder of pages or a route file. */
export interface CandidatePart {
  repo: string;
  /** relative to the repository ("src/pages/sales", "src/routes/sales.ts") */
  path: string;
  kind: "dir" | "file";
  /** the file names in it (a folder), at most 14 */
  files: string[];
  lines: number;
}

export interface ModuleCandidate {
  /** a slug ("sales", "accounting-close") */
  key: string;
  parts: CandidatePart[];
}

/** Where the screens and routes of a repository live, by role, in the order they are looked for. */
const WEB_BASES = ["src/pages", "src/routes", "src/app/routes", "src/views", "src/screens", "src/features", "src/modules", "app", "pages", "src/app"];
const API_BASES = ["src/modules", "src/features", "src/routes", "src/api", "src/handlers", "src/controllers", "src"];
/** Folders that are the code's plumbing, not a part of the product people use. */
const PLUMBING = new Set([
  "lib", "libs", "utils", "util", "common", "shared", "types", "type", "config", "configs", "middleware", "middlewares", "test", "tests",
  "__tests__", "__mocks__", "i18n", "locales", "styles", "assets", "components", "hooks", "store", "stores", "scripts", "generated",
  "helpers", "core", "db", "migrations", "fixtures", "mocks", "server", "http", "app", "layouts", "layout", "context", "providers",
  "services", "models", "schemas", "constants", "public", "static", "routes", "pages", "api", "ui", "icons", "images", "fonts",
]);
const MAX_CANDIDATES = 60;
const MAX_FILES_SHOWN = 14;
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|cs|java|kt|rb|php|rs)$/i;
const NOT_A_ROUTE = /(^index|\.test|\.spec|\.d)\.[a-z]+$/i;

/** The module candidates of one repository's map entries (pure): the first-level folders of its screens base (web) or
 *  its modules base (api and the rest), and the route files of a routes folder, plumbing folders left out. */
export function candidatesOf(repo: string, role: string, entries: readonly MapEntry[]): CandidatePart[] {
  const bases = role === "web" ? WEB_BASES : role === "api" ? API_BASES : [...WEB_BASES.slice(0, 5), ...API_BASES];
  const out: CandidatePart[] = [];
  const seen = new Set<string>();
  const add = (p: CandidatePart) => {
    if (seen.has(p.path)) return;
    seen.add(p.path);
    out.push(p);
  };
  // folders: the first base with at least two folders of its own
  for (const base of bases) {
    const below = new Map<string, MapEntry[]>();
    for (const e of entries) {
      if (!(e.dir === base || e.dir.startsWith(`${base}/`)) || e.dir === base) continue;
      const first = e.dir.slice(base.length + 1).split("/")[0]!;
      if (!first || PLUMBING.has(first.toLowerCase()) || first.startsWith("_") || first.startsWith(".")) continue;
      const g = below.get(first);
      if (g) g.push(e);
      else below.set(first, [e]);
    }
    const dirs = [...below.entries()].filter(([, files]) => files.some((f) => CODE_FILE.test(f.name)));
    if (dirs.length < 2) continue;
    for (const [name, files] of dirs) {
      add({ repo, path: `${base}/${name}`, kind: "dir", files: files.filter((f) => CODE_FILE.test(f.name)).map((f) => f.name).slice(0, MAX_FILES_SHOWN), lines: files.reduce((s, f) => s + f.lines, 0) });
    }
    break;
  }
  // route files: a routes folder of one file per route group (src/routes/sales.ts)
  for (const base of ["src/routes", "routes", "src/api/routes", "src/http/routes"]) {
    const files = entries.filter((e) => e.dir === base && CODE_FILE.test(e.name) && !NOT_A_ROUTE.test(e.name));
    if (files.length < 2) continue;
    for (const f of files) add({ repo, path: `${base}/${f.name}`, kind: "file", files: [], lines: f.lines });
    break;
  }
  return out;
}

/** The parts of every repository merged by key into candidates, at most 60, the biggest kept (pure). */
export function mergeCandidates(parts: readonly CandidatePart[]): ModuleCandidate[] {
  const by = new Map<string, ModuleCandidate>();
  for (const p of parts) {
    const leaf = p.path.split("/").pop()!.replace(/\.[a-z]+$/i, "");
    const key = slugOf(leaf.replace(/([a-z0-9])([A-Z])/g, "$1-$2"), 40);
    const c = by.get(key);
    if (c) c.parts.push(p);
    else by.set(key, { key, parts: [p] });
  }
  const all = [...by.values()];
  if (all.length <= MAX_CANDIDATES) return all;
  const size = (c: ModuleCandidate) => c.parts.reduce((s, p) => s + p.lines, 0);
  const keep = new Set([...all].sort((a, b) => size(b) - size(a)).slice(0, MAX_CANDIDATES).map((c) => c.key));
  return all.filter((c) => keep.has(c.key));
}

// ── the design system ───────────────────────────────────────────────────────────────────────────────────────────────

const TOKEN_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const SIZE = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/;
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** A CSS colour value as #rrggbb: #rgb, #rrggbb, "R G B" triplets (Tailwind alpha style) and rgb()/rgba(); else "". */
export function colorOf(value: string): string {
  const v = value.trim().replace(/\s*\/\*.*?\*\/\s*/g, "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return `#${m[1]!.split("").map((c) => c + c).join("")}`.toLowerCase();
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v);
  if (m) return `#${m[1]!}`.toLowerCase();
  m = /^(?:rgba?\(\s*)?(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)?$/i.exec(v);
  if (m && (v.startsWith("rgb") || /^\d/.test(v))) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return "";
}

/** The custom properties of the first `:root` block of a stylesheet (pure). */
export function rootProperties(css: string): Array<[string, string]> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const m = /(^|[},\s])(:root\b[^{]*)\{([^}]*)\}/m.exec(clean);
  if (!m) return [];
  const out: Array<[string, string]> = [];
  for (const d of m[3]!.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) out.push([d[1]!.toLowerCase(), d[2]!.trim()]);
  return out;
}

/** "@fontsource-variable/plus-jakarta-sans" -> "Plus Jakarta Sans" (pure). */
export function fontOfPackage(name: string): string {
  const m = /^@fontsource(?:-variable)?\/([a-z0-9-]+)$/.exec(name);
  return m ? m[1]!.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ") : "";
}

/** The first family of a font-family value ("'Inter Variable', system-ui" -> "Inter Variable"), "" for a generic one. */
function familyOf(value: string): string {
  const first = value.split(",")[0]!.trim().replace(/^['"]|['"]$/g, "").trim();
  return /^(system-ui|sans-serif|serif|monospace|inherit|initial|ui-sans-serif|ui-serif|ui-monospace|-apple-system|var\(.*\))$/i.test(first) || !/^[A-Za-z][A-Za-z0-9 -]{1,60}$/.test(first) ? "" : first;
}

/** A theme list (a JSON array of {id?, name, a colour}) as themes, or [] (pure). */
export function themesOf(json: string): ExistingDesignSystem["themes"] {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return [];
  }
  const items = Array.isArray(v) ? v : list(rec(v).themes);
  const out: ExistingDesignSystem["themes"] = [];
  for (const it of items) {
    const t = rec(it);
    const name = str(t.name) || str(t.label);
    const color = [t.signature, t.color, t.primary, t.accent, t.from, t.brand].map((c) => colorOf(str(c))).find(Boolean) ?? "";
    if (name && color && name.length <= 40) out.push({ id: slugOf(str(t.id) || name, 40), name, color });
    if (out.length >= 40) break;
  }
  return out;
}

/** The existing design system of the product's web repositories, or null when none is found. */
export async function designSystemOf(repos: readonly { key: string; role: string; dir: string }[]): Promise<ExistingDesignSystem | null> {
  const webs = [...repos.filter((r) => r.role === "web"), ...repos.filter((r) => r.role !== "web" && r.role !== "api")];
  for (const r of webs) {
    const paths = await tracked(r.dir, ["*.css", "*.scss", "*theme*.json", "*token*.json", "package.json"]);
    const css = paths
      .filter((p) => /\.(css|scss)$/i.test(p) && !/node_modules|dist\/|\.min\.|generated/i.test(p))
      .sort((a, b) => Number(/token|variables|theme/i.test(b)) - Number(/token|variables|theme/i.test(a)) || a.length - b.length)
      .slice(0, 4);
    const themeFiles = paths.filter((p) => /\.json$/i.test(p) && /theme|token/i.test(path.basename(p)) && !/node_modules|dist\/|generated|public\//i.test(p)).slice(0, 3);
    const files: string[] = [];
    const colors: Record<string, string> = {};
    const radius: Record<string, string> = {};
    const fonts: string[] = [];
    let dark = false;
    for (const f of css) {
      const body = readSmall(r.dir, f);
      if (!body) continue;
      let used = false;
      for (const [name, value] of rootProperties(body)) {
        if (!TOKEN_NAME.test(name)) continue;
        if (/radius|rounded/.test(name) && SIZE.test(value) && Object.keys(radius).length < 16) {
          radius[name] = value;
          used = true;
          continue;
        }
        if (/font/.test(name) && !/size|weight/.test(name)) {
          const fam = familyOf(value);
          if (fam && !fonts.includes(fam)) fonts.push(fam);
          continue;
        }
        const c = colorOf(value);
        if (c && Object.keys(colors).length < 48) {
          colors[name] = c;
          used = true;
        }
      }
      if (/\[data-theme=["']?dark|\.dark\b|prefers-color-scheme:\s*dark/.test(body)) dark = true;
      if (used) files.push(f);
    }
    const themes: ExistingDesignSystem["themes"] = [];
    for (const f of themeFiles) {
      const found = themesOf(readSmall(r.dir, f));
      if (found.length) {
        themes.push(...found.slice(0, 40 - themes.length));
        files.push(f);
      }
    }
    const pkg = rec((() => {
      try {
        return JSON.parse(readSmall(r.dir, "package.json") || "{}") as unknown;
      } catch {
        return {};
      }
    })());
    for (const dep of Object.keys({ ...rec(pkg.dependencies), ...rec(pkg.devDependencies) })) {
      const fam = fontOfPackage(dep);
      if (fam && !fonts.includes(fam)) fonts.push(fam);
    }
    if (!Object.keys(colors).length && !themes.length) continue;
    return {
      provider: "existing-system",
      version: 1,
      repo: r.key,
      files: [...new Set(files)],
      themes,
      colors,
      fonts: fonts.slice(0, 8),
      modes: dark ? ["light", "dark"] : ["light"],
      radius,
    };
  }
  return null;
}

// ── the repositories' own documents and data tables ─────────────────────────────────────────────────────────────────

export interface RepoDocument {
  repo: string;
  path: string;
  /** the start of the document (at most 1500 characters for a README, 500 for the others) */
  excerpt: string;
}

async function documentsOf(repo: string, dir: string): Promise<RepoDocument[]> {
  const paths = await tracked(dir, ["README.md", "docs/*.md", "docs/**/*.md"]);
  const order = paths.filter((p) => !/node_modules|audit\//i.test(p)).sort((a, b) => Number(b === "README.md") - Number(a === "README.md") || a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, 8);
  return order.map((p) => {
    const body = readSmall(dir, p, 400_000).replace(/\r\n/g, "\n").replace(/```[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const max = p === "README.md" ? 1500 : 500;
    return { repo, path: p, excerpt: body.length <= max ? body : `${body.slice(0, max).replace(/\s+\S*$/, "")} …` };
  }).filter((d) => d.excerpt);
}

async function tablesOf(dir: string): Promise<string[]> {
  const paths = await tracked(dir, ["blocks/data/schemas/*.json"]);
  return paths.map((p) => path.basename(p, ".json")).filter((n) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(n)).sort().slice(0, 200);
}

// ── everything together ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RepoFacts {
  key: string;
  role: string;
  dir: string;
  /** "owner/name" on GitHub, from the registry ("" when it names none) */
  repo: string;
  branch: string;
  entries: MapEntry[] | null;
  files: number;
  lines: number;
  firstCommitAt: string;
}

export interface EnvironmentFacts {
  environment: LiveEnvironment;
  branch: string;
  url: string;
  version: string;
  commits: LiveCommit[];
}

export interface ProductSources {
  /** the registry name */
  name: string;
  description: string;
  agentRules: string[];
  languages: string[];
  repos: RepoFacts[];
  /** the FILE MAP of every repository */
  map: string;
  candidates: ModuleCandidate[];
  tables: string[];
  documents: RepoDocument[];
  design: ExistingDesignSystem | null;
  environments: EnvironmentFacts[];
  tags: { repo: string; name: string; commit: string; at: string }[];
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The product's factory.json: an attached live product says existing: true. */
export function productState(madpDir: string): { existing: boolean; name: string; url: string } {
  try {
    const s = rec(JSON.parse(fs.readFileSync(path.join(madpDir, "factory.json"), "utf8")));
    return { existing: s.existing === true, name: str(s.name), url: /^https:\/\/[^\s/]+/.test(str(s.url)) ? str(s.url).replace(/\/+$/, "") : "" };
  } catch {
    return { existing: false, name: "", url: "" };
  }
}

/** Reads every source of the product in its MADP folder; null when the folder has no registry or no repository here.
 *  `devUrl` is the project's own dev address (factory.json url, else the Project row's). */
export async function readProductSources(madpDir: string, o: { name?: string; devUrl?: string } = {}): Promise<ProductSources | null> {
  if (!isDir(madpDir)) return null;
  const code = await productCode(madpDir, { name: o.name, maxChars: 14_000 });
  if (!code) return null;
  const reg = registryFacts(readSmall(madpDir, `${code.name}.yml`, 1_000_000)) ?? { name: code.name, description: code.description, agentRules: code.agentRules, repos: {}, environments: {}, languages: [] };
  const dirOf = (key: string): string => {
    const own = path.join(madpDir, `${code.name}-${key}`);
    return isDir(own) ? own : "";
  };
  // productCode found each repository (the registry's path, else <name>-<key>); its dir is not returned, so find it again
  const registryPaths = (() => {
    try {
      const data = rec(parseYaml(readSmall(madpDir, `${code.name}.yml`, 1_000_000)));
      return Object.fromEntries(Object.entries(rec(data.repos)).map(([k, v]) => [k, str(rec(v).path)]));
    } catch {
      return {} as Record<string, string>;
    }
  })();
  const repos: RepoFacts[] = [];
  for (const r of code.repos) {
    const own = registryPaths[r.key] ? (path.isAbsolute(registryPaths[r.key]!) ? registryPaths[r.key]! : path.resolve(madpDir, registryPaths[r.key]!)) : "";
    const dir = [own, dirOf(r.key)].find((d) => d && isDir(d));
    if (!dir) continue;
    const meta = reg.repos[r.key];
    const branch = meta?.branch || "dev";
    const head = await branchHead(dir, branch);
    const roots = head ? await gitRead(dir, ["log", "--max-parents=0", "--format=%cI", head.ref, "--"]) : null;
    const firstCommitAt = (roots ?? "").split("\n").map((l) => l.trim()).filter(Boolean).sort()[0] ?? "";
    repos.push({
      key: r.key, role: r.role || meta?.role || "", dir, repo: meta?.repo ?? "", branch, entries: r.entries,
      files: r.entries?.length ?? 0, lines: r.entries?.reduce((s, e) => s + e.lines, 0) ?? 0, firstCommitAt,
    });
  }
  if (!repos.length) return null;

  const candidates = mergeCandidates(repos.flatMap((r) => (r.entries ? candidatesOf(r.key, r.role, r.entries) : [])));
  const tables = [...new Set((await Promise.all(repos.filter((r) => r.role !== "web").map((r) => tablesOf(r.dir)))).flat())].sort();
  const documents = (await Promise.all(repos.map((r) => documentsOf(r.key, r.dir)))).flat();
  const design = await designSystemOf(repos);

  // the environments: the registry's, plus a stage branch the repositories have when the registry names no stage
  const main = repos.find((r) => r.role === "web") ?? repos[0]!;
  const envs: Array<{ environment: LiveEnvironment; branch: string; url: string }> = [];
  const devReg = reg.environments.dev;
  envs.push({ environment: "dev", branch: devReg?.branch || main.branch, url: devReg?.url || o.devUrl || "" });
  for (const env of ["stage", "production"] as const) {
    const e = reg.environments[env];
    if (e) envs.push({ environment: env, branch: e.branch, url: e.url });
  }
  if (!reg.environments.stage) {
    for (const b of ["stg", "stage", "staging"]) {
      if (await branchHead(main.dir, b)) {
        envs.push({ environment: "stage", branch: b, url: "" });
        break;
      }
    }
  }
  const environments: EnvironmentFacts[] = [];
  for (const e of envs) {
    const commits: LiveCommit[] = [];
    let version = "";
    for (const r of repos) {
      const branch = e.environment === "dev" ? reg.repos[r.key]?.branch || e.branch : e.branch;
      const head = branch ? await branchHead(r.dir, branch) : null;
      commits.push({ repo: r.key, commit: head?.commit ?? "", at: head?.at ?? "" });
      if (r === main && head) version = await versionAt(r.dir, head.ref);
    }
    environments.push({ environment: e.environment, branch: e.branch, url: e.url, version, commits });
  }

  const tags: ProductSources["tags"] = [];
  for (const r of repos) {
    const out = await gitRead(r.dir, ["for-each-ref", "--sort=-creatordate", "--count=40", "--format=%(refname:short)%1f%(objectname)%1f%(creatordate:iso-strict)", "refs/tags"]);
    for (const line of (out ?? "").split("\n")) {
      const [name, commit, at] = line.trim().split("\x1f");
      if (name && /^v?\d+\.\d+/.test(name)) tags.push({ repo: r.key, name, commit: commit ?? "", at: at ?? "" });
    }
  }

  return {
    name: code.name,
    description: reg.description || code.description,
    agentRules: reg.agentRules.length ? reg.agentRules : code.agentRules,
    languages: reg.languages,
    repos,
    map: code.map,
    candidates,
    tables,
    documents,
    design,
    environments,
    tags: tags.slice(0, 40),
  };
}

/** When each module's parts first appeared on the repository's main branch (the earliest commit that added a file in
 *  them); "" when git does not say. Read-only; at most four git commands at once. */
export async function firstSeen(sources: Pick<ProductSources, "repos">, modules: readonly { key: string; parts: readonly { repo: string; path: string }[] }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const jobs = modules.flatMap((m) => m.parts.map((p) => ({ key: m.key, ...p })));
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const j = jobs[next++]!;
      const r = sources.repos.find((x) => x.key === j.repo);
      if (!r) continue;
      const head = await branchHead(r.dir, r.branch);
      if (!head) continue;
      const log = await gitRead(r.dir, ["log", "--diff-filter=A", "--format=%cI", head.ref, "--", j.path]);
      const first = (log ?? "").split("\n").map((l) => l.trim()).filter(Boolean).sort()[0] ?? "";
      if (first && (!out.get(j.key) || first < out.get(j.key)!)) out.set(j.key, first);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, lane));
  return out;
}

// Onboarding a product onto the official MADP engine, the same way for every product (attached, former template
// builder's, re-checked later): each repo's gate runs ONCE on the pristine dev branch (fast_verify, verify; live_test
// only when it is explicitly allowed, never against a live environment by default), the product's real languages are
// read from its dictionary files, and the result is an onboarding report for the product's people.
//
// A check that fails on the untouched dev branch would stop every build of the product at "the checks" for a reason
// the build did not cause. Each failing check is therefore one of two choices, recorded in the engine host's registry
// (top-level `onboarding:`, which the official engine ignores) with its reason:
//   - "leave-out" (the default): the check is left out of the engine gate, flagged prominently in the report;
//   - "keep": the check stays in the gate and the product must fix it first (builds stop at the checks until then).
// A repo keeps at least one verify step (the official registry requires one): when every verify step fails, they stay.
// A re-check (recheckProduct) runs the left-out checks again, so a check the product fixed comes back by itself.
//
// Nothing here prints a secret: the report's reasons are plain classifications; the short detail kept for the engine
// team has addresses' credentials, tokens and home folders taken out, and is never shown on a page.
import fs from "node:fs";
import path from "node:path";
import type { Exec } from "./attach.ts";
import { hostYaml, parseRegistry } from "./hostRegistry.ts";
import { acceptanceSecretsDir, acceptanceSecretsRoot, madpPython } from "./home.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type CheckKind = "fast_verify" | "verify" | "live_test";
export const CHECK_KINDS: readonly CheckKind[] = ["fast_verify", "verify", "live_test"];
export type Choice = "keep" | "leave-out";

export interface CheckStep {
  name: string;
  argv: string[];
  cwd?: string;
}

export interface CheckOutcome {
  /** `<repo>.<kind>.<name>`: what a choice names. */
  id: string;
  repo: string;
  kind: CheckKind;
  name: string;
  result: "pass" | "fail" | "not-run";
  /** Why it failed or did not run, in plain words ("" when it passed). */
  reason: string;
  /** The last lines of its output, redacted (for the engine team; never on a page). */
  detail: string;
  seconds: number;
  /** In the engine gate after the decision. */
  inGate: boolean;
  /** The decision in plain words. */
  decision: string;
  step: CheckStep;
}

export interface Languages {
  repo: string;
  dir: string;
  /** The cultures the registry named before. */
  declared: string[];
  /** The cultures the dictionary files have. */
  found: string[];
  source: string;
  /** The registry's cultures were corrected to the files'. */
  changed: boolean;
  /** False: the registry has no localization section (found only, nothing written). */
  inRegistry: boolean;
}

export interface OnboardingReport {
  schema: "madp-onboarding/1";
  product: string;
  checkedAt: string;
  liveTests: "off" | "on";
  repos: Array<{ key: string; repo: string; branch: string; commit: string }>;
  checks: Array<Omit<CheckOutcome, "step" | "detail"> & { detail: string }>;
  /** Checks left out before they could run (they name a file on another machine). */
  notRunnable: Array<{ repo: string; kind: string; name: string; reason: string }>;
  languages: Languages | null;
  /** Checking each change on dev with the product's own live tests (absent in reports before 05.11.2026). */
  acceptance?: AcceptanceFinding[];
  /** What needs the product's people, most important first. */
  attention: string[];
  notes: string[];
  summary: string;
}

// ------------------------------------------------------------------ the checks of a registry

const isKind = (k: string): k is CheckKind => (CHECK_KINDS as readonly string[]).includes(k);
const stepOf = (v: unknown): CheckStep | null => {
  const s = rec(v);
  const argv = list(s.argv).filter((a): a is string => typeof a === "string" && a !== "");
  if (!text(s.name) || argv.length === 0) return null;
  return { name: text(s.name), argv, ...(text(s.cwd) ? { cwd: text(s.cwd) } : {}) };
};

/** Every check of the registry's repos: the ones in the gate, then the ones an earlier onboarding left out (pure). */
export function registryChecks(data: Row): Array<{ repo: string; kind: CheckKind; step: CheckStep }> {
  const out: Array<{ repo: string; kind: CheckKind; step: CheckStep }> = [];
  const seen = new Set<string>();
  const add = (repo: string, kind: CheckKind, step: CheckStep | null) => {
    if (!step || seen.has(`${repo}.${kind}.${step.name}`)) return;
    seen.add(`${repo}.${kind}.${step.name}`);
    out.push({ repo, kind, step });
  };
  const repos = rec(data.repos);
  for (const [key, spec] of Object.entries(repos)) for (const kind of CHECK_KINDS) for (const s of list(rec(spec)[kind])) add(key, kind, stepOf(s));
  for (const x of list(rec(data.onboarding).left_out)) {
    const r = rec(x);
    const kind = text(r.kind);
    if (text(r.repo) in repos && isKind(kind)) add(text(r.repo), kind, stepOf(r));
  }
  return out;
}

/** Output with credentials, tokens and home folders taken out, its last meaningful lines only. */
export function redact(s: string, n = 2): string {
  return s
    .replace(/(https?:\/\/)[^@\s/]+@/g, "$1")
    .replace(/\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|authorization)[A-Za-z0-9_]*)\s*[:=]\s*\S+/gi, "$1=…")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]+)/g, "…")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "…")
    .replace(/(?:\/home|\/Users)\/[^/\s"']+/g, "~")
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi, "~")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(npm (ERR|error)! (A complete log|\s*$)|at |node:internal)/.test(l))
    .slice(-n)
    .join(" | ")
    .slice(0, 240);
}

/** Why a check failed, in plain words (pure). */
export function plainReason(step: CheckStep, r: { code: number; stdout: string; stderr: string; timedOut?: boolean }, repoPath: string, timeoutMs: number): string {
  const out = `${r.stderr}\n${r.stdout}`;
  const program = path.basename(step.argv[0] ?? "");
  if (r.timedOut) return `it did not finish within ${Math.max(1, Math.round(timeoutMs / 60_000))} minutes`;
  if (r.code === 127 || new RegExp(`spawn ${program.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ENOENT|command not found`).test(out)) return `the program "${program}" is not installed on the engine host`;
  const env = [...step.argv, step.cwd ?? ""].some((a) => /(?:^|[\s=/"'])\.env(?:\.[A-Za-z]+)?\b/.test(a));
  if ((env && !fs.existsSync(path.join(repoPath, ".env"))) || /\.env: (?:not found|No such file)|ENOENT[^\n]*\.env\b/.test(out)) return "it needs a .env file, which is not in git";
  const missing = /(?:Cannot find module|No such file or directory|can't open file|ENOENT[^'"\n]*)\s*['"]?((?:\/|[A-Za-z]:[\\/])[^'"\s:]+)/.exec(out)?.[1] ?? "";
  if (missing && !missing.startsWith(repoPath)) return "it names a file that is not on the engine host";
  if (/Cannot find module|MODULE_NOT_FOUND/.test(out)) return "a file or package it needs is missing in the repository";
  const i18n = /i18n|uilm|locali[sz]|translation/i.test(`${step.name} ${step.argv.join(" ")}`);
  if (i18n) return "the language files do not match (missing, extra or empty keys)";
  const ts = out.match(/error TS\d+/g)?.length ?? 0;
  if (ts > 0) return `the type check found ${ts === 1 ? "1 error" : `${ts} errors`}`;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|ETIMEDOUT|socket hang up/.test(out)) return "it could not reach a service it needs";
  if (/\b(\d+) (?:failed|failing)\b/.test(out)) return `${/\b(\d+) (?:failed|failing)\b/.exec(out)![1]} of its tests failed`;
  return `it failed (exit code ${r.code})`;
}

export interface RunChecksOptions {
  exec: Exec;
  /** The product's MADP folder: reports the engine's own check scripts write go to its reports/ (the official engine
   *  stays read-only), as in a lane (madp.ts). */
  productDir?: string;
  /** Run live_test steps too (default off: they run against the live environment). */
  allowLiveTests?: boolean;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** Each repo's gate once, on the pristine dev branch of the engine host's clone. Files a check wrote are stashed (never
 *  deleted), so the clone is pristine again for the lanes. */
export async function runChecks(data: Row, o: RunChecksOptions): Promise<{ outcomes: CheckOutcome[]; repos: OnboardingReport["repos"]; notes: string[] }> {
  const timeoutMs = o.timeoutMs ?? 20 * 60_000;
  const outcomes: CheckOutcome[] = [];
  const repos: OnboardingReport["repos"] = [];
  const notes: string[] = [];
  const all = registryChecks(data);
  const env = o.productDir
    ? { MADP_PROJECT_DIR: o.productDir, ...Object.fromEntries(["uilm", "feature", "quick", "promote"].map((k) => [`MADP_${k.toUpperCase()}_REPORT_DIR`, path.join(o.productDir!, "reports", k)])) }
    : undefined;
  for (const [key, raw] of Object.entries(rec(data.repos))) {
    const spec = rec(raw);
    const repoPath = text(spec.path);
    const branch = text(spec.branch) || "dev";
    const git = (...args: string[]) => o.exec("git", ["-C", repoPath, ...args], { timeoutMs: 60_000 });
    const head = await git("rev-parse", "--abbrev-ref", "HEAD");
    const commit = (await git("rev-parse", "--short", "HEAD")).stdout.trim();
    repos.push({ key, repo: text(spec.repo), branch, commit });
    const status = (await git("status", "--porcelain")).stdout.trim();
    const pristine = head.code === 0 && head.stdout.trim() === branch && status === "";
    const mine = all.filter((c) => c.repo === key);
    for (const c of mine) {
      const base = { id: `${key}.${c.kind}.${c.step.name}`, repo: key, kind: c.kind, name: c.step.name, step: c.step, detail: "", seconds: 0, inGate: false, decision: "" };
      if (!pristine) {
        outcomes.push({ ...base, result: "not-run", reason: `the engine host's copy is not on a clean "${branch}" branch, so it was not checked now` });
        continue;
      }
      if (c.kind === "live_test" && o.allowLiveTests !== true) {
        outcomes.push({ ...base, result: "not-run", reason: "live tests are off: they run against the live development environment" });
        continue;
      }
      o.log?.(`check ${base.id}`);
      const started = Date.now();
      const r = await o.exec(c.step.argv[0]!, c.step.argv.slice(1), { cwd: path.resolve(repoPath, c.step.cwd ?? ""), timeoutMs, ...(env ? { env } : {}) });
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const timedOut = r.code !== 0 && Date.now() - started >= timeoutMs * 0.98;
      outcomes.push(r.code === 0
        ? { ...base, result: "pass", reason: "", seconds }
        : { ...base, result: "fail", reason: plainReason(c.step, { ...r, timedOut }, repoPath, timeoutMs), detail: redact(`${r.stderr}\n${r.stdout}`), seconds });
    }
    if (pristine && mine.length > 0 && (await git("status", "--porcelain")).stdout.trim() !== "") {
      // a check wrote files git does not ignore: kept in a stash (git stash list), the clone is pristine again
      await git("-c", "user.name=MADP Factory", "-c", "user.email=engine@madp-factory.local", "stash", "push", "--include-untracked", "-m", "madp onboarding: files the checks wrote");
      notes.push(`The checks of ${key} wrote files that git does not ignore; they were put aside (git stash) so the copy stays clean.`);
    }
  }
  return { outcomes, repos, notes };
}

/** The decision for each check (pure): a passing check is in the gate; a failing one is left out unless the product's
 *  people chose to keep it; a check that did not run keeps its place; a repo keeps at least one verify step. */
export function decide(outcomes: CheckOutcome[], o: { choices?: Record<string, Choice>; inGateBefore?: Set<string> } = {}): { outcomes: CheckOutcome[]; attention: string[] } {
  const attention: string[] = [];
  const out = outcomes.map((c): CheckOutcome => {
    if (c.result === "pass") return { ...c, inGate: true, decision: "in the engine's checks: it passes" };
    if (c.result === "not-run") {
      if (c.kind === "live_test" && /live tests are off/.test(c.reason)) return { ...c, inGate: false, decision: `left out: ${c.reason}` };
      const before = o.inGateBefore?.has(c.id) ?? true;
      return { ...c, inGate: before, decision: before ? "in the engine's checks as before (not checked now)" : "left out as before (not checked now)" };
    }
    if (o.choices?.[c.id] === "keep") return { ...c, inGate: true, decision: `kept by choice: builds stop at the checks until the product fixes it (${c.reason})` };
    return { ...c, inGate: false, decision: `left out of the engine's checks: ${c.reason}` };
  });
  for (const repo of [...new Set(out.map((c) => c.repo))]) {
    const verify = out.filter((c) => c.repo === repo && c.kind === "verify");
    if (verify.length > 0 && !verify.some((c) => c.inGate)) {
      for (const c of verify) {
        c.inGate = true;
        c.decision = `kept: every check of ${repo} needs at least one step, so builds stop at the checks until the product fixes it (${c.reason})`;
      }
      attention.push(`Every build check of ${repo} fails on its dev branch as it is now, so builds of ${repo} stop at the checks until the product fixes them: ${[...new Set(verify.map((c) => c.reason))].join("; ")}.`);
    }
  }
  for (const c of out) {
    if (c.result !== "fail") continue;
    if (!c.inGate) attention.push(`The check "${c.name}" of ${c.repo} fails on its dev branch as it is now (${c.reason}). It is left out of the engine's checks; the product's team can fix it and choose to keep it.`);
    else if (o.choices?.[c.id] === "keep") attention.push(`The check "${c.name}" of ${c.repo} fails on its dev branch (${c.reason}) and was kept: builds stop at the checks until the product fixes it.`);
  }
  return { outcomes: out, attention };
}

/** The registry with the decided checks in the gate and the rest recorded under `onboarding.left_out` (pure). */
export function applyChecks(data: Row, outcomes: CheckOutcome[], meta: { checkedAt: string; liveTests: "off" | "on"; choices?: Record<string, Choice> }): Row {
  const next: Row = structuredClone(data);
  const repos = rec(next.repos);
  for (const [key, raw] of Object.entries(repos)) {
    const spec = rec(raw);
    for (const kind of CHECK_KINDS) {
      const steps = outcomes.filter((c) => c.repo === key && c.kind === kind && c.inGate).map((c) => ({ ...c.step }));
      if (steps.length) spec[kind] = steps;
      else delete spec[kind];
    }
  }
  const leftOut = outcomes.filter((c) => !c.inGate).map((c) => ({ repo: c.repo, kind: c.kind, ...c.step, reason: c.reason }));
  const choices = Object.fromEntries(Object.entries(meta.choices ?? {}).filter(([id]) => outcomes.some((c) => c.id === id)));
  next.onboarding = { checked_at: meta.checkedAt, live_tests: meta.liveTests, ...(Object.keys(choices).length ? { choices } : {}), left_out: leftOut };
  return next;
}

// ------------------------------------------------------------------ languages

/** A UILM culture code (project_registry.py _CULTURE_RE). */
const CULTURE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** Where a product without a localization section usually keeps its dictionaries. */
const LOCALE_DIRS = ["src/i18n/locales", "src/locales", "src/i18n", "public/locales", "locales", "src/assets/i18n", "i18n"];

/** The cultures of `<dir>/<module>.<culture>.json` files, with how many files each has. */
function culturesIn(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const spelled = new Map<string, string>();
  for (const f of files) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith(".json")) continue;
    const stem = f.name.slice(0, -5);
    const at = stem.lastIndexOf(".");
    if (at < 1) continue;
    const culture = stem.slice(at + 1);
    if (!CULTURE_RE.test(culture)) continue;
    const key = culture.toLowerCase();
    if (!spelled.has(key)) spelled.set(key, culture);
    const c = spelled.get(key)!;
    out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

/** The product's real languages from its dictionary files (pure of writes). */
export function detectLanguages(data: Row): Languages | null {
  const repos = rec(data.repos);
  const loc = rec(data.localization);
  if (data.localization !== undefined && text(loc.repo) in repos && text(loc.dir)) {
    const repo = text(loc.repo);
    const dir = text(loc.dir);
    const declared = list(loc.cultures).map((c) => String(c));
    const counts = culturesIn(path.join(text(rec(repos[repo]).path), dir));
    const found = [...counts.keys()];
    if (found.length === 0) return { repo, dir, declared, found, source: text(loc.source), changed: false, inRegistry: true };
    const lower = new Set(found.map((c) => c.toLowerCase()));
    const declaredSource = text(loc.source);
    const source = lower.has(declaredSource.toLowerCase())
      ? found.find((c) => c.toLowerCase() === declaredSource.toLowerCase())!
      : [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const ordered = [
      source,
      ...declared.map((d) => found.find((c) => c.toLowerCase() === d.toLowerCase())).filter((c): c is string => !!c && c !== source),
      ...found.filter((c) => c !== source && !declared.some((d) => d.toLowerCase() === c.toLowerCase())).sort(),
    ];
    const same = ordered.length === declared.length && ordered.every((c) => declared.some((d) => d.toLowerCase() === c.toLowerCase())) && source === declaredSource;
    return { repo, dir, declared, found: ordered, source, changed: !same, inRegistry: true };
  }
  for (const [repo, spec] of Object.entries(repos)) {
    for (const dir of LOCALE_DIRS) {
      const counts = culturesIn(path.join(text(rec(spec).path), dir));
      if (counts.size === 0) continue;
      const found = [...counts.keys()].sort();
      const source = found.find((c) => /^en(-|$)/i.test(c)) ?? found[0]!;
      return { repo, dir, declared: [], found: [source, ...found.filter((c) => c !== source)], source, changed: false, inRegistry: false };
    }
  }
  return null;
}

/** The registry with the languages its files really have (pure; unchanged when nothing differs or no section). */
export function applyLanguages(data: Row, l: Languages | null): Row {
  if (!l || !l.inRegistry || !l.changed) return data;
  return { ...data, localization: { ...rec(data.localization), source: l.source, cultures: l.found } };
}

// ------------------------------------------------------------------ checking each change on dev (acceptance)
//
// A repo with a fixtures script and live test files that take the dev address as an argument can have every change
// checked on dev after its deploy (the official registry's `repos.<key>.acceptance:`, MADP/QUICK-LANE.md "Live
// acceptance"). Onboarding suggests the section (dry run: the report holds it) and writes it into the registry only
// when the repo's test accounts are already on the engine host (home.ts acceptanceSecretsDir) and the registry knows
// the address the tests need; never otherwise, because then every build would stop at the preflight.

export interface AcceptanceFinding {
  repo: string;
  /** The fixtures script, repo-relative. */
  fixtures: string;
  /** How many live test files were found. */
  tests: number;
  /** on: written into the registry now; suggested: found, not on yet (see reason); configured: the registry had it
   *  already; configured-missing: the registry has it, but its test accounts are not on the engine host. */
  state: "on" | "suggested" | "configured" | "configured-missing";
  /** In plain words, why it is not on ("" when it is). */
  reason: string;
  /** The test accounts' folder on the engine host (secrets_dir): for the engine team, never on a page. */
  secretsDir: string;
  /** The registry section: what is written (on) or would be (suggested). */
  section: Row;
}

const FIXTURE_FILES = ["test/fixtures.mjs", "test/fixtures.js", "tests/fixtures.mjs", "tests/fixtures.js"];
const RUNNER_NAME = /^(run[-_]?all|runner|live[-_]?(suites?|gate|guard))\b/i;

/** The repo's fixtures script and live test files (scripts in the same folder that read the base address from their
 *  arguments and call it), the other files of that folder (helpers, runners) to leave out; null when it has none. */
export function findLiveTests(repoPath: string): { fixtures: string; dir: string; ext: string; tests: string[]; others: string[] } | null {
  const fixtures = FIXTURE_FILES.find((f) => fs.existsSync(path.join(repoPath, f)));
  if (!fixtures) return null;
  const dir = path.posix.dirname(fixtures);
  const ext = path.posix.extname(fixtures);
  let names: string[];
  try {
    names = fs.readdirSync(path.join(repoPath, dir)).filter((n) => n.endsWith(ext)).sort();
  } catch {
    return null;
  }
  const tests: string[] = [];
  const others: string[] = [];
  for (const n of names) {
    const rel = `${dir}/${n}`;
    if (rel === fixtures) continue;
    let body = "";
    try {
      const file = path.join(repoPath, rel);
      if (fs.statSync(file).isFile() && fs.statSync(file).size <= 400_000) body = fs.readFileSync(file, "utf8");
    } catch {
      /* unreadable: not a test */
    }
    const helper = /^\s*export\s/m.test(body);
    const live = /process\.argv/.test(body) && (/\bfetch\s*\(/.test(body) || /startsWith\(\s*["'`]http/.test(body) || /https?:\/\//.test(body));
    if (live && !helper && !RUNNER_NAME.test(n)) tests.push(rel);
    else others.push(rel);
  }
  return tests.length ? { fixtures, dir, ext, tests, others } : null;
}

/** True when the lanes can resolve `{<name>_url}` on dev (acceptance_ops.resolve_url): environments.dev.urls, else
 *  pipeline.urls, else a health URL of the repo with that key or role. */
export function devUrlKnown(data: Row, name: string): boolean {
  const dev = rec(rec(data.environments).dev);
  if (/^https?:\/\//.test(text(rec(dev.urls)[name]))) return true;
  const pl = rec(data.pipeline);
  if ((text(pl.env) || "dev") === "dev" && /^https?:\/\//.test(text(rec(pl.urls)[name]))) return true;
  return Object.entries(rec(data.repos)).some(([key, spec]) => {
    if (key !== name && text(rec(spec).role) !== name) return false;
    const health = list(rec(dev.health)[key]).length ? list(rec(dev.health)[key]) : list(rec(spec).health);
    return health.some((u) => /^https?:\/\/[^/\s]+/.test(text(u)));
  });
}

/** The acceptance findings of a registry's repos on the engine host (reads the clones; writes nothing). */
export function suggestAcceptance(data: Row, o: { secretsDirOf: (repo: string) => string }): AcceptanceFinding[] {
  const out: AcceptanceFinding[] = [];
  for (const [key, raw] of Object.entries(rec(data.repos))) {
    const spec = rec(raw);
    const isDir = (p: string) => !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
    if (spec.acceptance !== undefined) {
      const sd = text(rec(spec.acceptance).secrets_dir);
      const missing = !!sd && !isDir(sd);
      out.push({ repo: key, fixtures: text(list(rec(rec(spec.acceptance).fixtures).argv)[1]), tests: 0, state: missing ? "configured-missing" : "configured", reason: missing ? "its test accounts are not on the engine host" : "", secretsDir: sd, section: rec(spec.acceptance) });
      continue;
    }
    const found = findLiveTests(text(spec.path));
    if (!found) continue;
    const role = text(spec.role);
    const name = role === "api" || role === "web" ? role : /^[a-z][a-z0-9_]*$/.test(key) ? key : "api";
    const url = `{${name}_url}`;
    const secretsDir = o.secretsDirOf(key);
    const section: Row = {
      envs: ["dev"],
      fixtures: { argv: ["node", found.fixtures, url], timeout: 900 },
      tests: { argv: ["node", "{file}", url], files: [`${found.dir}/*${found.ext}`], exclude: [found.fixtures, ...found.others], max_files: 8, timeout: 900 },
      secrets_dir: secretsDir,
      links: ["node_modules"],
    };
    const reasons = [
      ...(isDir(secretsDir) ? [] : ["its test accounts are not on the engine host yet"]),
      ...(devUrlKnown(data, name) ? [] : [`the product's settings have no development address for ${name === "web" ? "the web app" : name === "api" ? "the API" : name}`]),
    ];
    out.push({ repo: key, fixtures: found.fixtures, tests: found.tests.length, state: reasons.length ? "suggested" : "on", reason: reasons.join(", and "), secretsDir, section });
  }
  return out;
}

/** The findings for the operator's console (attach, re-check): what is on, and for a suggestion what to put where. */
export function acceptanceLines(findings: AcceptanceFinding[] = []): string[] {
  return findings.map((f) =>
    f.state === "on" ? `  acceptance ${f.repo}: on (${plural(f.tests, "live test file")}, fixtures ${f.fixtures}, test accounts from ${f.secretsDir})`
      : f.state === "configured" ? `  acceptance ${f.repo}: on (as configured)`
        : f.state === "configured-missing" ? `  ! acceptance ${f.repo}: configured, but ${f.secretsDir} is missing: every build stops at the preflight until it exists`
          : `  acceptance ${f.repo}: suggested (${plural(f.tests, "live test file")}, fixtures ${f.fixtures}), not on: ${f.reason}. Put the files the tests read as .local/ (the QA accounts) in ${f.secretsDir}, then re-check; the section is in onboarding.json.`,
  );
}

/** The registry with the acceptance sections that can run now (pure). */
export function applyAcceptance(data: Row, findings: AcceptanceFinding[]): Row {
  const on = findings.filter((f) => f.state === "on");
  if (on.length === 0) return data;
  const next: Row = structuredClone(data);
  const repos = rec(next.repos);
  for (const f of on) rec(repos[f.repo]).acceptance = structuredClone(f.section);
  return next;
}

// ------------------------------------------------------------------ the report

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The onboarding of a registry: checks, decisions, languages, checking changes on dev (the registry is in place;
 *  nothing is written here). */
export async function onboardRegistry(data: Row, o: RunChecksOptions & { choices?: Record<string, Choice>; notRunnable?: OnboardingReport["notRunnable"]; now?: () => Date; acceptanceRoot?: string }): Promise<{ data: Row; report: OnboardingReport }> {
  const checkedAt = (o.now ?? (() => new Date()))().toISOString();
  const choices = { ...(rec(rec(data.onboarding).choices) as Record<string, Choice>), ...(o.choices ?? {}) };
  const inGateBefore = new Set(registryChecks({ repos: data.repos }).map((c) => `${c.repo}.${c.kind}.${c.step.name}`));
  const ran = await runChecks(data, o);
  const decided = decide(ran.outcomes, { choices, inGateBefore });
  const liveTests = o.allowLiveTests === true ? "on" : "off";
  const languages = detectLanguages(data);
  const acceptance = suggestAcceptance(data, { secretsDirOf: (repo) => acceptanceSecretsDir(text(data.project), "dev", repo, o.acceptanceRoot ?? acceptanceSecretsRoot()) });
  const next = applyAcceptance(applyLanguages(applyChecks(data, decided.outcomes, { checkedAt, liveTests, choices }), languages), acceptance);
  const attention = [...decided.attention];
  for (const f of acceptance) {
    if (f.state === "configured-missing") attention.push(`Each change of ${f.repo} is set to be checked on the development environment, but its test accounts are not on the engine host, so builds stop before they start until the engine team puts them there.`);
  }
  const notRunnable = o.notRunnable ?? [];
  for (const x of notRunnable) attention.push(`The check "${x.name}" of ${x.repo} was left out: ${x.reason}. The engine team can add it again with a file on the engine host.`);
  if (languages?.changed) attention.push(`The product has ${plural(languages.found.length, "language")} in its files (${languages.found.join(", ")}); its settings named ${languages.declared.length ? languages.declared.join(", ") : "none"}. The engine now uses the files' languages.`);
  const notes = [...ran.notes];
  if (liveTests === "off" && decided.outcomes.some((c) => c.kind === "live_test")) notes.push("Live tests are off for development: they run against the live environment. They can be switched on when they run against a test copy.");
  if (languages && !languages.inRegistry) notes.push(`Language files were found (${languages.found.join(", ")} in ${languages.repo}); the engine's language tools stay off until the product's settings name them.`);
  const passed = decided.outcomes.filter((c) => c.result === "pass").length;
  const failed = decided.outcomes.filter((c) => c.result === "fail").length;
  const ran2 = decided.outcomes.filter((c) => c.result !== "not-run").length;
  const summary = ran2 === 0
    ? "No check ran."
    : `${passed} of ${plural(ran2, "check")} passed on the dev branch as it is${failed ? `; ${plural(failed, "check")} failed and ${failed === 1 ? "needs" : "need"} the product's team` : ""}.`;
  const report: OnboardingReport = {
    schema: "madp-onboarding/1",
    product: text(data.project),
    checkedAt,
    liveTests,
    repos: ran.repos,
    checks: decided.outcomes.map(({ step: _s, ...c }) => c),
    notRunnable,
    languages,
    acceptance,
    attention,
    notes,
    summary,
  };
  return { data: next, report };
}

const KIND_WORD: Record<CheckKind, string> = { fast_verify: "quick check", verify: "build check", live_test: "live test" };

/** The report in the words the product's people read (no paths, no commands, no output). */
export function reportMarkdown(r: OnboardingReport): string {
  const out: string[] = [`# ${r.product} on the MADP engine`, "", `_Checked ${r.checkedAt.replace("T", " ").slice(0, 16)} UTC on the dev branch as it is, before MADP changed anything._`, "", r.summary, ""];
  if (r.attention.length) out.push("## Needs your team", "", ...r.attention.map((a) => `- **${a}**`), "");
  out.push("## Checks", "", "| Repository | Check | Kind | Result | In the engine's checks |", "|---|---|---|---|---|");
  for (const c of r.checks) {
    const result = c.result === "pass" ? "Passed" : c.result === "fail" ? `Failed: ${c.reason}` : `Not run: ${c.reason}`;
    out.push(`| ${c.repo} | ${c.name} | ${KIND_WORD[c.kind]} | ${result} | ${c.inGate ? "Yes" : "No"}: ${c.decision} |`);
  }
  for (const x of r.notRunnable) out.push(`| ${x.repo} | ${x.name} | ${KIND_WORD[x.kind as CheckKind] ?? x.kind} | Not run: ${x.reason} | No |`);
  out.push("");
  if (r.checks.some((c) => c.result === "fail")) {
    out.push("### Your choice for each failing check", "", "- **Leave it out** (what MADP did): builds and changes go on; the check is listed here until it passes. Once the product's team fixes it, the next check puts it back by itself.", "- **Keep it**: the check stays in the engine's checks, and builds stop at the checks until the product's team fixes it. Tell the engine team which checks to keep.", "");
  }
  out.push("## Languages", "");
  if (!r.languages) out.push("No language files were found.", "");
  else if (!r.languages.inRegistry) out.push(`Language files were found for ${r.languages.found.join(", ")}; the engine's language tools stay off until they are named in the product's settings.`, "");
  else if (r.languages.found.length === 0) out.push(`The product's settings name ${r.languages.declared.join(", ")}, but no language files were found.`, "");
  else out.push(`${plural(r.languages.found.length, "language")}: ${r.languages.found.join(", ")} (source: ${r.languages.source})${r.languages.changed ? `. The settings named ${r.languages.declared.join(", ") || "none"} before and were corrected from the files.` : "."}`, "");
  if (r.acceptance?.length) {
    out.push("## Checking each change on the development environment", "", "After a change is deployed to dev, MADP can prepare the test data and run the change's own live tests there, like a user. When they do not pass, the change stays deployed and is marked as needing attention.", "");
    for (const f of r.acceptance) {
      const what = f.tests ? ` (${plural(f.tests, "live test file")} found)` : "";
      const line =
        f.state === "on" ? "on: every change is checked this way from now on"
          : f.state === "configured" ? "on, as the product's settings say"
            : f.state === "configured-missing" ? "set up, but its test accounts are not on the engine host, so builds stop before they start"
              : `available, not on yet: ${f.reason}`;
      out.push(`- **${f.repo}**${what}: ${line}.`);
    }
    out.push("");
  }
  if (r.notes.length) out.push("## Notes", "", ...r.notes.map((n) => `- ${n}`), "");
  return `${out.join("\n")}\n`;
}

export const REPORT_FILE = "onboarding.json";

/** The report next to the registry (`onboarding.json`, `ONBOARDING.md`); "What MADP produced" shows it. */
export function writeReport(dir: string, r: OnboardingReport): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of [[REPORT_FILE, `${JSON.stringify(r, null, 2)}\n`], ["ONBOARDING.md", reportMarkdown(r)]] as const) {
    fs.writeFileSync(path.join(dir, `${f}.tmp`), body);
    fs.renameSync(path.join(dir, `${f}.tmp`), path.join(dir, f));
  }
}

export function readReport(dir: string): OnboardingReport | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, REPORT_FILE), "utf8")) as OnboardingReport;
    return r && r.schema === "madp-onboarding/1" && Array.isArray(r.checks) ? r : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ writing a registry, the re-check

/** Writes the registry only after the official validator (paths included) accepted it; answers its problems. */
export async function writeValidatedRegistry(exec: Exec, engineHome: string, file: string, data: Row): Promise<string[]> {
  const check = path.join(path.dirname(file), `.${path.basename(file, ".yml")}.check.yml`);
  fs.writeFileSync(check, hostYaml(data));
  const v = await exec(madpPython(), ["-B", "-m", "MADP.orchestrator.primitives.project_registry", check], { cwd: engineHome, timeoutMs: 60_000 });
  if (v.code !== 0) {
    fs.rmSync(check, { force: true });
    const lines = v.stdout.split(/\r?\n/).filter((l) => /^\s*[-•✗]|:/.test(l) && !/✓/.test(l)).slice(0, 8);
    return lines.length ? lines.map((l) => l.trim()) : ["the official validator did not accept the registry"];
  }
  fs.renameSync(check, file);
  return [];
}

/** Parses `--keep id` / `--leave-out id` lists into choices (later wins). */
export function choicesOf(keep: string[] = [], leaveOut: string[] = []): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const id of keep) if (id.trim()) out[id.trim()] = "keep";
  for (const id of leaveOut) if (id.trim()) out[id.trim()] = "leave-out";
  return out;
}

/** Runs the onboarding again on a product already on the engine host (`<project folder>/madp`): its left-out checks
 *  too, the people's choices kept, the registry rewritten (validated) and the report renewed. */
export async function recheckProduct(dir: string, o: RunChecksOptions & { engineHome: string; choices?: Record<string, Choice>; now?: () => Date }): Promise<OnboardingReport> {
  let state: Row;
  try {
    state = rec(JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8")));
  } catch {
    throw new Error("This folder has no MADP product (madp/factory.json).");
  }
  const name = text(state.name);
  const file = path.join(dir, `${name}.yml`);
  if (!name || !fs.existsSync(file)) throw new Error("The product's registry is not on the engine host.");
  const data = parseRegistry(fs.readFileSync(file, "utf8"));
  const before = readReport(dir);
  const { data: next, report } = await onboardRegistry(data, { productDir: dir, ...o, notRunnable: before?.notRunnable ?? [] });
  const problems = await writeValidatedRegistry(o.exec, o.engineHome, file, next);
  if (problems.length) throw new Error(`The official validator refused the updated registry: ${problems.join("; ")}`);
  writeReport(dir, report);
  return report;
}

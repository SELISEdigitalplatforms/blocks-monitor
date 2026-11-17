// Translations after a deploy. A product whose registry has a `localization:` section overlays its screen texts from
// SELISE Blocks Localization (UILM) at runtime ("Blocks wins"), so a text the lane changed in the repo is only visible
// once the dictionary is synced. After every successful build or change lane this file runs the official uilm lane
// (MADP/QUICK-LANE.md, `madp uilm`) for exactly the modules whose dictionary files the lane's commits changed:
//
//   1. the modules: `git diff-tree` of the lane's commits in the localization repo; a file `<dir>/<module>.<culture>.json`
//      (with `parts: merge` also `<module>-<part>.<culture>.json`) belongs to <module>. Modules a sync could not finish
//      earlier (`uilm.json` "pending") are added, so the next build retries them by itself;
//   2. the plan: `madp uilm --modules … --json` (check, login, tenant languages, validate, push --dry-run). It reads the
//      dictionaries as the lane committed and deployed them (`--repo-path`: a copy of the dictionary folder at the
//      lane's last commit), never a working tree someone may be editing. `--baseline-path` is a copy of the folder
//      before the lane's commits (the previous deployed commit; the deployed one when the lane changed nothing in
//      this repo): problems the check finds there too were there before and do not stop the sync, so a module with
//      old problems still gets its new texts. A module with NEW problems (the lane brought them in) is held back,
//      its problems go to the job log and to the record (uilm.json "problems", kept until a check no longer finds
//      them) so the next change can fix them, and the plan runs again for the other modules;
//   3. the safety comparison: `madp uilm --pull` into a second scratch copy reads what Blocks holds. A key whose Blocks
//      value differs from the repo, or a key only Blocks has, that this work did not change and that never was the
//      repo's own value (git history of the module's files) is a text edited in the portal: nothing is pushed, the job
//      stays done and people get a plain note to pull first;
//   4. otherwise the push: `madp uilm --modules … --yes` (push per culture, then generate-uilm-file).
//
// Every call runs in the product's own Blocks login store (the dev environment's cli_config_dir as BLOCKS_CONFIG_DIR;
// MF_BLOCKS_RELEASE_ACCOUNT comes from the engine's environment or the registry's cli.env, as for every lane) and
// writes its report to <product>/reports/uilm. A failure never undoes the deploy: it answers a plain line, keeps the
// modules pending for the next build and logs the command the engine team can run. Nothing here prints a secret: the
// lane's output stays in the product's lane log.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { storeOf } from "./blocksLogin.ts";
import { parseRegistry, registryRepos } from "./hostRegistry.ts";
import { runLane, type LaneOptions, type LaneResult } from "./madp.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const exec = promisify(execFile);

/** The line on the tickets and in the job's message when the texts went to Blocks. */
export const SYNCED_LINE = "Texts synced to Blocks Localization.";

// ------------------------------------------------------------------ the registry's localization (pure)

export interface Localization {
  /** The registry's repo key that holds the dictionaries. */
  repo: string;
  /** The dictionary folder, relative to that repo ("src/i18n/locales"). */
  dir: string;
  source: string;
  cultures: string[];
  parts: "separate" | "merge";
}

const cleanDir = (d: string): string => d.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");

/** The registry's `localization:` section, or null when it has none (or one the official lane would refuse) (pure). */
export function localizationOf(data: Row): Localization | null {
  if (data.localization === undefined || data.localization === null) return null;
  const l = rec(data.localization);
  const repo = text(l.repo);
  const dir = cleanDir(text(l.dir));
  if (!repo || !dir || !(repo in rec(data.repos))) return null;
  const cultures = (Array.isArray(l.cultures) ? l.cultures : []).map((c) => String(c).trim()).filter(Boolean);
  return { repo, dir, source: text(l.source) || cultures[0] || "", cultures, parts: text(l.parts) === "merge" ? "merge" : "separate" };
}

const PART_STEM = /^([^.-]+)-([^.]+)$/;
const PART_NAME = /^[a-z][A-Za-z0-9]*$/;

/** A dictionary file name's module, part and culture by the official lane's rules (i18n_ops.classify), or null (pure). */
export function dictionaryName(file: string, parts: Localization["parts"]): { module: string; part: string; culture: string } | null {
  const name = path.posix.basename(file.replace(/\\/g, "/"));
  if (!/\.json$/i.test(name)) return null;
  const stem = name.slice(0, -5);
  const at = stem.lastIndexOf(".");
  if (at <= 0 || at === stem.length - 1) return null;
  const base = stem.slice(0, at);
  const culture = stem.slice(at + 1);
  if (parts !== "merge" || !base.includes("-")) return { module: base, part: "", culture };
  const m = PART_STEM.exec(base);
  if (!m || !PART_NAME.test(m[2]!)) return null;
  return { module: m[1]!, part: m[2]!, culture };
}

/** The modules whose dictionaries the changed files (repo-relative paths) touch, part files under their module (pure). */
export function changedModules(files: string[], loc: Localization): string[] {
  const out = new Set<string>();
  const dir = cleanDir(loc.dir);
  for (const f of files) {
    const p = cleanDir(f);
    if (path.posix.dirname(p) !== dir) continue;
    const n = dictionaryName(p, loc.parts);
    if (n) out.add(n.module);
  }
  return [...out].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** Nested objects to "a.b.c" keys, as the official lane flattens them; only string values count (pure). */
export function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(rec(obj))) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === "string") out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------------ the safety comparison (pure)

/** One pulled file of `madp uilm --pull --json` (uilm_sync.py facts["pulls"]). */
export interface PulledFile {
  module: string;
  culture: string;
  file: string;
  added: string[];
  changed: Array<{ key: string; local: string; remote: string }>;
}

export interface PortalEdit {
  module: string;
  culture: string;
  key: string;
  /** "changed": Blocks has another value; "only-in-blocks": the repo has no such key. */
  kind: "changed" | "only-in-blocks";
}

export interface SafetyInput {
  pulls: PulledFile[];
  /** The value Blocks holds for a key the repo lacks (read from the pulled copy). */
  remoteValue: (module: string, culture: string, key: string) => string | undefined;
  /** True when this work changed (or added, or removed) the key in that culture. */
  changedByWork: (module: string, culture: string, key: string) => boolean;
  /** Every value the repo ever had for the key in that culture (its git history). */
  repoValues: (module: string, culture: string, key: string) => Promise<Set<string>>;
}

/** Blocks UILM answers "[ KEY MISSING ]" for a key that has no text in a culture (also after a save that replaced a
 *  key's cultures instead of merging them, BLK-31): no text at all, never a portal edit, never written to the repo. */
export const UILM_MISSING_PLACEHOLDER = /^\s*\[\s*KEY[\s_-]*MISSING\s*\]\s*$/i;
export const isUilmPlaceholder = (v: string): boolean => UILM_MISSING_PLACEHOLDER.test(v);

/** The texts Blocks holds that a push would overwrite and that neither this work nor the repo ever wrote: edits made
 *  in the portal. A Blocks value that was the repo's own earlier (a change synced late) is safe to overwrite; a blank
 *  value or the missing-key placeholder is no text, so a push only fills it. */
export async function portalEdits(i: SafetyInput): Promise<PortalEdit[]> {
  const out: PortalEdit[] = [];
  const seen = new Set<string>();
  for (const p of i.pulls) {
    const check = async (key: string, remote: string | undefined, kind: PortalEdit["kind"]) => {
      const id = `${p.module}\u0000${p.culture}\u0000${key}`;
      if (seen.has(id) || remote === undefined || !remote.trim() || isUilmPlaceholder(remote)) return;
      seen.add(id);
      if (i.changedByWork(p.module, p.culture, key)) return;
      if ((await i.repoValues(p.module, p.culture, key)).has(remote)) return;
      out.push({ module: p.module, culture: p.culture, key, kind });
    };
    for (const c of p.changed) await check(c.key, c.remote, "changed");
    for (const k of p.added) await check(k, i.remoteValue(p.module, p.culture, k), "only-in-blocks");
  }
  return out;
}

// ------------------------------------------------------------------ the lines people read (pure)

/** "profile", "profile and sales", "profile, sales and 3 more". */
export function moduleList(modules: string[]): string {
  const shown = modules.slice(0, 3);
  const rest = modules.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export const portalLine = (modules: string[]): string =>
  `The new texts are deployed, but Blocks Localization has texts edited in the portal for ${moduleList(modules)}; they were kept until the engine team takes them in.`;

export const failedLine = (modules: string[]): string =>
  `The new texts are deployed, but syncing them to Blocks Localization did not go through${modules.length ? ` for ${moduleList(modules)}` : ""}, so the app may still show the old texts. The next build syncs them again; if it does not, ask the engine team to look into it.`;

export const problemsLine = (modules: string[], n: number): string =>
  `The new texts are deployed, but this change brought ${n === 1 ? "1 text problem" : `${n} text problems`} into ${moduleList(modules)}, so they did not go to Blocks Localization yet; the next build syncs them again.`;

// ------------------------------------------------------------------ the dictionary check's problems (pure)

/** One problem of the uilm lane's check (`--json` problems / new_problems / known_problems; i18n_ops.Problem). */
export interface DictProblem {
  kind: string;
  module: string;
  culture: string;
  key: string;
  message: string;
}

export const problemsOf = (v: unknown): DictProblem[] =>
  (Array.isArray(v) ? v : [])
    .map(rec)
    .map((p) => ({ kind: text(p.kind), module: text(p.module), culture: text(p.culture), key: text(p.key), message: text(p.message) }))
    .filter((p) => p.kind);

/** "settings.de-CH placeholder: 'x' placeholders differ: en-US {count} vs de-CH {}", as the uilm report writes it. */
export const problemLine = (p: DictProblem): string => `${[p.module, p.culture].filter(Boolean).join(".") || "-"} ${p.kind}: ${p.message}`;

/** The problems a change brought into a module and nobody fixed yet (uilm.json "problems"). */
export interface OpenProblems {
  at: string;
  job: string;
  lines: string[];
}

/** The record's open problems after a run: for every module the check covered, the recorded problems it still finds
 *  plus the new ones; a module without any is dropped; modules the run did not check keep theirs (pure). */
export function openProblems(prev: Record<string, OpenProblems>, checked: Map<string, DictProblem[]>, fresh: DictProblem[], at: { at: string; job: string }): Record<string, OpenProblems> {
  const out = { ...prev };
  for (const [m, now] of checked) {
    const still = new Set(now.map(problemLine));
    const keep = (prev[m]?.lines ?? []).filter((l) => still.has(l));
    const add = [...new Set(fresh.filter((p) => p.module === m).map(problemLine))].filter((l) => !keep.includes(l));
    const lines = [...keep, ...add].slice(0, 100);
    if (!lines.length) delete out[m];
    else out[m] = add.length || !prev[m] ? { at: at.at, job: at.job, lines } : { ...prev[m]!, lines };
  }
  return out;
}

export type TextsStatus = "none" | "synced" | "portal-edits" | "failed";

export interface TextsOutcome {
  status: TextsStatus;
  modules: string[];
  /** The line for the tickets and the job ("" when there was nothing to sync). */
  line: string;
  /** The texts edited in the portal (portal-edits). */
  edits?: PortalEdit[];
  /** The modules that did reach Blocks although others were held back (portal edits, new problems). */
  synced?: string[];
  /** The uilm report's file name (the report itself is in <product>/reports/uilm). */
  report?: string;
  /** The dictionary problems this work brought in (problemLine), for the modules held back for them. */
  problems?: string[];
}

/** The job's message with the texts' line: the whole message when it fits, else the short one with the line (pure). */
export function withTexts(message: string, t: Pick<TextsOutcome, "status" | "line">, short: string, max = 200): string {
  if (t.status === "none" || !t.line) return message;
  const full = `${message.trim()} ${t.line}`;
  if (full.length <= max) return full;
  const brief = `${short.trim()} ${t.line}`;
  return brief.length <= max ? brief : `${brief.slice(0, max - 1).trimEnd()}…`;
}

// ------------------------------------------------------------------ git (read-only)

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repo, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return String(stdout);
}

async function tryGit(repo: string, args: string[]): Promise<string | null> {
  try {
    return await git(repo, args);
  } catch {
    return null;
  }
}

/** The lane's commits (7–40 hex, as the lanes report them) that are commits of this repo, newest first. */
export async function commitsIn(repo: string, shas: string[]): Promise<string[]> {
  const full: string[] = [];
  for (const s of new Set(shas.filter((x) => /^[0-9a-f]{7,40}$/i.test(x)))) {
    const hit = (await tryGit(repo, ["rev-parse", "--verify", "--quiet", `${s}^{commit}`]))?.trim();
    if (hit && !full.includes(hit)) full.push(hit);
  }
  if (full.length <= 1) return full;
  // newest first: the commit with the most of the others among its ancestors
  const below = new Map<string, number>();
  for (const c of full) {
    let n = 0;
    for (const other of full) if (other !== c && (await tryGit(repo, ["merge-base", "--is-ancestor", other, c])) !== null) n += 1;
    below.set(c, n);
  }
  return [...full].sort((a, b) => below.get(b)! - below.get(a)!);
}

/** The files the commits changed (repo-relative). */
async function filesOf(repo: string, commits: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const c of commits) {
    const list = await git(repo, ["diff-tree", "--root", "-r", "--no-commit-id", "--name-only", "-z", c]);
    for (const f of list.split("\0")) if (f) out.add(f);
  }
  return [...out];
}

interface Blob {
  name: string;
  oid: string;
}

/** The dictionary folder's files at a revision (directly in the folder, as the lane reads it). */
async function dictionaryFiles(repo: string, rev: string, loc: Localization): Promise<Blob[]> {
  if (!rev) return [];
  const raw = await tryGit(repo, ["ls-tree", "-z", rev, "--", `${loc.dir}/`]);
  if (!raw) return [];
  const out: Blob[] = [];
  for (const entry of raw.split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (!m) continue;
    const name = path.posix.basename(m[2]!);
    if (dictionaryName(name, loc.parts)) out.push({ name, oid: m[1]! });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const blob = (repo: string, oid: string): Promise<string> => git(repo, ["cat-file", "blob", oid]);

/** A module's merged flat dictionary of one culture at a revision: the main file first, then the parts by name. */
async function dictionaryAt(repo: string, rev: string, loc: Localization, module: string, culture: string, files?: Blob[]): Promise<Record<string, string>> {
  const all = files ?? (await dictionaryFiles(repo, rev, loc));
  const mine = all
    .map((b) => ({ b, n: dictionaryName(b.name, loc.parts)! }))
    .filter((x) => x.n.module === module && x.n.culture === culture)
    .sort((a, b) => Number(a.n.part !== "") - Number(b.n.part !== "") || a.b.name.localeCompare(b.b.name));
  const out: Record<string, string> = {};
  for (const { b } of mine) {
    try {
      Object.assign(out, flatten(JSON.parse((await blob(repo, b.oid)).replace(/^﻿/, ""))));
    } catch {
      /* an unreadable file: the lane's check reports it */
    }
  }
  return out;
}

/** Writes the dictionary folder at `rev` to <root>/<dir> (the lane's --repo-path); answers the modules it has. */
async function snapshot(repo: string, rev: string, loc: Localization, root: string): Promise<string[]> {
  const files = await dictionaryFiles(repo, rev, loc);
  const dir = path.join(root, ...loc.dir.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), await blob(repo, f.oid));
  return [...new Set(files.map((f) => dictionaryName(f.name, loc.parts)!.module))];
}

/** How many earlier revisions of a module's files the safety comparison reads. */
const HISTORY_REVISIONS = 80;

// ------------------------------------------------------------------ the record (uilm.json in the product folder)

interface Pending {
  /** "problems": the work brought new dictionary problems into the module (see "problems"). */
  reason: "failed" | "portal-edits" | "problems";
  at: string;
  job: string;
}

interface Record_ {
  schema: "madp-uilm-after-deploy/1";
  pending: Record<string, Pending>;
  /** Dictionary problems changes brought in, per module, until a check no longer finds them. */
  problems?: Record<string, OpenProblems>;
  last?: { at: string; job: string; status: TextsStatus; modules: string[]; report?: string; edits?: PortalEdit[]; problems?: string[] };
}

const recordFile = (app: Pick<OfficialApp, "dir">): string => path.join(app.dir, "uilm.json");

export function readRecord(app: Pick<OfficialApp, "dir">): Record_ {
  try {
    const r = rec(JSON.parse(fs.readFileSync(recordFile(app), "utf8")));
    const problems = rec(r.problems) as Record<string, OpenProblems>;
    return {
      schema: "madp-uilm-after-deploy/1",
      pending: rec(r.pending) as Record<string, Pending>,
      ...(Object.keys(problems).length ? { problems } : {}),
      ...(r.last ? { last: r.last as Record_["last"] } : {}),
    };
  } catch {
    return { schema: "madp-uilm-after-deploy/1", pending: {} };
  }
}

function writeRecord(app: Pick<OfficialApp, "dir">, r: Record_): void {
  fs.mkdirSync(app.dir, { recursive: true });
  const f = recordFile(app);
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(r, null, 2)}\n`);
  fs.renameSync(`${f}.tmp`, f);
}

// ------------------------------------------------------------------ the sync

export type LaneRunner = (run: JobRun, args: string[], o: LaneOptions) => Promise<LaneResult>;

export interface SyncOptions {
  /** The line people read while it runs (the job's step). */
  step?: (pct: number, line: string) => Promise<void>;
  pct?: number;
  /** The official lane runner (tests give a fake one). */
  lane?: LaneRunner;
}

/** `madp uilm`'s exit code when its check (or `blocks localization validate`) found problems (uilm_sync.EXIT). */
const CHECK_FAILED = 5;

/** The lane's JSON document on stdout (`--json`), or {}. */
export function laneJson(stdout: string): Row {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  try {
    return rec(JSON.parse(stdout.slice(start, end + 1)));
  } catch {
    return {};
  }
}

const pulledFiles = (doc: Row): PulledFile[] =>
  (Array.isArray(doc.pulls) ? doc.pulls : []).map(rec).map((p) => ({
    module: text(p.module),
    culture: text(p.culture),
    file: text(p.file),
    added: (Array.isArray(p.added) ? p.added : []).filter((k): k is string => typeof k === "string"),
    changed: (Array.isArray(p.changed) ? p.changed : []).map(rec).map((c) => ({ key: text(c.key), local: String(c.local ?? ""), remote: String(c.remote ?? "") })).filter((c) => c.key),
  }));

/** A module's merged dictionary of one culture in a scratch copy (what the pull wrote there). */
function copiedDictionary(root: string, loc: Localization, module: string, culture: string): Record<string, string> {
  const dir = path.join(root, ...loc.dir.split("/"));
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return {};
  }
  const mine = names
    .map((name) => ({ name, n: dictionaryName(name, loc.parts) }))
    .filter((x) => x.n && x.n.module === module && x.n.culture === culture)
    .sort((a, b) => Number(a.n!.part !== "") - Number(b.n!.part !== "") || a.name.localeCompare(b.name));
  const out: Record<string, string> = {};
  for (const x of mine) {
    try {
      Object.assign(out, flatten(JSON.parse(fs.readFileSync(path.join(dir, x.name), "utf8").replace(/^﻿/, ""))));
    } catch {
      /* unreadable */
    }
  }
  return out;
}

/** After a successful build or change lane: the changed modules' texts to Blocks Localization (see the top of this
 *  file). Never throws for a sync problem (the deploy stands); a stopped job still stops. */
export async function syncTexts(run: JobRun, app: OfficialApp, work: { commits: string[] }, o: SyncOptions = {}): Promise<TextsOutcome> {
  const none: TextsOutcome = { status: "none", modules: [], line: "" };
  let data: Row;
  try {
    data = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  } catch {
    return none;
  }
  const loc = localizationOf(data);
  if (!loc) return none;
  const repo = registryRepos(data).find((r) => r.key === loc.repo)?.path ?? "";
  if (!repo || !fs.existsSync(path.join(repo, ".git"))) {
    run.log(`uilm after deploy: the localization repo "${loc.repo}" is not on the engine host; nothing synced`);
    return none;
  }
  const record = readRecord(app);
  let modules: string[] = [];
  let tried: string[] = [];
  const scratch: string[] = [];
  const lane = o.lane ?? runLane;
  const step = async (line: string) => {
    if (o.step) await o.step(o.pct ?? 95, line);
  };
  // what the dictionary checks found: every problem per module checked, and the ones this work brought in
  const checked = new Map<string, DictProblem[]>();
  const fresh: DictProblem[] = [];
  const noteProblems = (doc: Row) => {
    if (!Array.isArray(doc.problems)) return;
    for (const m of (Array.isArray(doc.modules) ? doc.modules : []).map((x) => String(x))) checked.set(m, []);
    for (const p of problemsOf(doc.problems)) checked.get(p.module)?.push(p);
    for (const p of problemsOf(doc.new_problems)) if (!fresh.some((q) => problemLine(q) === problemLine(p))) fresh.push(p);
  };
  const finish = (out: TextsOutcome, held: Record<string, Pending["reason"]> = {}): TextsOutcome => {
    const pending = { ...record.pending };
    for (const m of [...out.modules, ...(out.synced ?? [])]) delete pending[m];
    if (out.status === "failed" || out.status === "portal-edits") for (const m of out.modules) held[m] ??= out.status;
    for (const [m, reason] of Object.entries(held)) pending[m] = { reason, at: run.iso(), job: run.id };
    const problems = openProblems(record.problems ?? {}, checked, fresh, { at: run.iso(), job: run.id });
    try {
      writeRecord(app, {
        schema: "madp-uilm-after-deploy/1",
        pending,
        ...(Object.keys(problems).length ? { problems } : {}),
        last: {
          at: run.iso(),
          job: run.id,
          status: out.status,
          modules: out.modules,
          ...(out.report ? { report: out.report } : {}),
          ...(out.edits?.length ? { edits: out.edits.slice(0, 50) } : {}),
          ...(out.problems?.length ? { problems: out.problems.slice(0, 50) } : {}),
        },
      });
    } catch (e) {
      run.log(`uilm after deploy: the record could not be written (${String(e).slice(0, 120)})`);
    }
    return out;
  };
  const failed = (why: string, ms: string[] = modules.length ? modules : tried, held: Record<string, Pending["reason"]> = {}): TextsOutcome => {
    run.log(`uilm after deploy ${app.name}: ${why}; retry: madp uilm --project ${path.basename(app.registry)} --modules ${ms.join(",")} --yes (the next build retries it too)`);
    return finish({ status: "failed", modules: ms, line: failedLine(ms) }, held);
  };
  try {
    // 1. the modules: what the lane's commits changed in the localization repo, plus the ones pending from before
    const commits = await commitsIn(repo, work.commits);
    const head = commits[0] ?? (await git(repo, ["rev-parse", "HEAD"])).trim();
    const oldest = commits[commits.length - 1] ?? "";
    const base = oldest ? ((await tryGit(repo, ["rev-parse", "--verify", "--quiet", `${oldest}^`]))?.trim() ?? "") : "";
    const changed = commits.length ? changedModules(await filesOf(repo, commits), loc) : [];
    const headFiles = await dictionaryFiles(repo, head, loc);
    const atHead = new Set(headFiles.map((f) => dictionaryName(f.name, loc.parts)!.module));
    tried = [...new Set([...changed, ...Object.keys(record.pending)])];
    modules = tried.filter((m) => atHead.has(m)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const gone = tried.filter((m) => !atHead.has(m));
    if (gone.length) run.log(`uilm after deploy ${app.name}: module(s) ${gone.join(", ")} no longer have dictionaries; not synced`);
    if (modules.length === 0) {
      if (gone.length) finish({ status: "none", modules: gone, line: "" });
      return none;
    }
    await step(`Syncing the new texts to Blocks Localization (${moduleList(modules)}).`);
    const blocksConfigDir = storeOf(data, app.name, "dev");
    const reportDir = path.join(app.dir, "reports", "uilm");
    fs.mkdirSync(reportDir, { recursive: true });
    const copy = (label: string) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), `madp-uilm-${label}-`));
      scratch.push(d);
      return d;
    };
    const deployed = copy("deployed");
    await snapshot(repo, head, loc, deployed);
    // the dictionaries before this work: the commit before its first commit here (the previous deployed one), or
    // the deployed commit when the work changed nothing in this repo (a pending module's problems are all old)
    const baselineRev = commits.length ? base : head;
    let baseline = "";
    if (baselineRev) {
      baseline = copy("baseline");
      await snapshot(repo, baselineRev, loc, baseline);
    }
    const args = (mode: string[], root: string, ms: string[]) => [
      "uilm", "--project", app.registry, "--env", "dev", "--modules", ms.join(","), ...mode, "--json", "--report-dir", reportDir, "--repo-path", root,
      ...(baseline && !mode.includes("--pull") ? ["--baseline-path", baseline] : []),
    ];
    const call = (mode: string[], root: string, label: string, ms = modules) => lane(run, args(mode, root, ms), { projectDir: app.dir, label, timeoutMs: 15 * 60_000, blocksConfigDir });

    // 2. the plan (dry run): check against the baseline, sign-in, tenant languages, validate, push --dry-run
    let active = modules;
    let problemModules: string[] = [];
    const plan = await call([], deployed, "uilm-plan");
    const planned = laneJson(plan.stdout);
    noteProblems(planned);
    if (plan.code !== 0) {
      // only NEW problems stop the check: the modules they are in wait, the others go on
      const bad = [...new Set(problemsOf(planned.new_problems).map((p) => p.module))];
      if (plan.code !== CHECK_FAILED || !bad.length || !bad.every((m) => modules.includes(m))) {
        return failed(`the plan stopped (exit ${plan.code}, ${text(planned.status) || "no status"})`);
      }
      problemModules = bad.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const mine = fresh.filter((p) => problemModules.includes(p.module));
      const known = problemsOf(planned.known_problems).filter((p) => problemModules.includes(p.module)).length;
      run.log(
        `uilm after deploy ${app.name}: ${problemModules.join(", ")} not synced: this work brought ${mine.length} new dictionary problem(s) into ${problemModules.length === 1 ? "it" : "them"}: ${mine
          .slice(0, 8)
          .map(problemLine)
          .join("; ")}${mine.length > 8 ? `; and ${mine.length - 8} more` : ""}${known ? ` (${known} problem(s) that were there before do not count)` : ""}; the list is in reports/uilm/${path.basename(text(planned.report))} and uilm.json; a change that fixes them gets them synced`,
      );
      active = modules.filter((m) => !problemModules.includes(m));
    }
    const heldProblems = Object.fromEntries(problemModules.map((m) => [m, "problems" as const]));
    const problemLines = fresh.filter((p) => problemModules.includes(p.module)).map(problemLine);
    // the outcome when the modules with new problems are held back (alone, or with portal edits elsewhere)
    const withProblems = (synced: string[], report: string): TextsOutcome =>
      finish(
        {
          status: "failed",
          modules: problemModules,
          line: problemsLine(problemModules, problemLines.length),
          problems: problemLines,
          ...(synced.length ? { synced } : {}),
          ...(report ? { report } : {}),
        },
        heldProblems,
      );
    if (!active.length) return withProblems([], path.basename(text(planned.report)));
    if (problemModules.length) {
      // the plan again for the modules without new problems
      const again = await call([], deployed, "uilm-plan", active);
      const replanned = laneJson(again.stdout);
      noteProblems(replanned);
      if (again.code !== 0) return failed(`the plan stopped (exit ${again.code}, ${text(replanned.status) || "no status"})`, active, heldProblems);
    }

    // 3. the safety comparison: what Blocks holds, pulled into a scratch copy (the repo is never written)
    const pulledRoot = copy("blocks");
    await snapshot(repo, head, loc, pulledRoot);
    const pull = await call(["--pull"], pulledRoot, "uilm-pull", active);
    if (pull.code !== 0) return failed(`reading the texts Blocks holds stopped (exit ${pull.code})`, active, heldProblems);
    const work_ = new Map<string, Set<string>>();
    const baseFiles = await dictionaryFiles(repo, base, loc);
    for (const m of changed.filter((x) => active.includes(x))) {
      for (const c of new Set([...headFiles, ...baseFiles].map((f) => dictionaryName(f.name, loc.parts)!).filter((n) => n.module === m).map((n) => n.culture))) {
        const before = await dictionaryAt(repo, base, loc, m, c, baseFiles);
        const after = await dictionaryAt(repo, head, loc, m, c, headFiles);
        const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => before[k] !== after[k]));
        work_.set(`${m}\u0000${c}`, keys);
      }
    }
    const history = new Map<string, Map<string, Set<string>>>();
    const repoValues = async (m: string, c: string, key: string): Promise<Set<string>> => {
      const id = `${m}\u0000${c}`;
      if (!history.has(id)) {
        const values = new Map<string, Set<string>>();
        const specs = [`:(glob)${loc.dir}/${m}.${c}.json`, ...(loc.parts === "merge" ? [`:(glob)${loc.dir}/${m}-*.${c}.json`] : [])];
        const revs = ((await tryGit(repo, ["log", "--format=%H", "-n", String(HISTORY_REVISIONS), head, "--", ...specs])) ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
        // every revision that changed the module's files, and the one before the oldest of them
        for (const r of revs.length ? [...revs, `${revs[revs.length - 1]}^`] : [head]) {
          for (const [k, v] of Object.entries(await dictionaryAt(repo, r, loc, m, c))) {
            if (!values.has(k)) values.set(k, new Set());
            values.get(k)!.add(v);
          }
        }
        history.set(id, values);
      }
      return history.get(id)!.get(key) ?? new Set();
    };
    const pulledDicts = new Map<string, Record<string, string>>();
    const edits = await portalEdits({
      pulls: pulledFiles(laneJson(pull.stdout)).filter((p) => active.includes(p.module)),
      remoteValue: (m, c, k) => {
        const id = `${m}\u0000${c}`;
        if (!pulledDicts.has(id)) pulledDicts.set(id, copiedDictionary(pulledRoot, loc, m, c));
        return pulledDicts.get(id)![k];
      },
      changedByWork: (m, c, k) => work_.get(`${m}\u0000${c}`)?.has(k) ?? false,
      repoValues,
    });
    const heldBack = [...new Set(edits.map((e) => e.module))];
    const safe = active.filter((m) => !heldBack.includes(m));
    if (heldBack.length) {
      run.log(`uilm after deploy ${app.name}: not pushed, Blocks has ${edits.length} text(s) edited in the portal in ${heldBack.join(", ")} (${edits.slice(0, 8).map((e) => `${e.module}.${e.culture}:${e.key}`).join(", ")})`);
    }
    const portal = (synced: string[], report: string): TextsOutcome =>
      finish(
        {
          status: "portal-edits",
          modules: heldBack,
          line: problemModules.length ? `${portalLine(heldBack)} ${problemsLine(problemModules, problemLines.length)}` : portalLine(heldBack),
          edits,
          ...(problemLines.length ? { problems: problemLines } : {}),
          ...(synced.length ? { synced } : {}),
          ...(report ? { report } : {}),
        },
        heldProblems,
      );
    if (safe.length === 0) return portal([], path.basename(text(laneJson(pull.stdout).report)));

    // 4. the push of every module without portal edits or new problems: per culture (source first), then the
    //    runtime UILM files
    const push = await call(["--yes"], deployed, "uilm", safe);
    const pushed = laneJson(push.stdout);
    noteProblems(pushed);
    const held = { ...heldProblems, ...Object.fromEntries(heldBack.map((m) => [m, "portal-edits" as const])) };
    if (push.code !== 0) return failed(`the push stopped (exit ${push.code}, ${text(pushed.status) || "no status"})`, safe, held);
    const report = path.basename(text(pushed.report));
    run.log(`uilm after deploy ${app.name}: pushed ${safe.join(", ")}`);
    if (heldBack.length) return portal(safe, report);
    if (problemModules.length) return withProblems(safe, report);
    return finish({ status: "synced", modules, line: SYNCED_LINE, ...(report ? { report } : {}) });
  } catch (e) {
    if (run.signal?.aborted) throw e;
    return failed(`it stopped (${String((e as { code?: unknown }).code ?? (e as Error).name ?? "error")})`);
  } finally {
    for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
  }
}

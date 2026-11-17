// Data tables after a deploy. A product keeps its Blocks data tables as files in the API repo
// (blocks/data/schemas/<Table>.json) and has its own sync script that pushes them and regenerates the rules that lock
// every table to the API's service role (the template's scripts/data-sync.mjs, `npm run data:sync`). The build and
// change lanes commit, push and deploy in one run, so nothing would create a table the new API code needs. After every
// successful build or change lane this file runs that script for each API-role repo (or the one repo of a one-repo
// app) whose schema files changed:
//
//   1. what changed: the schema files at the deployed commit (the lane's newest commit in the repo) against the commit
//      before the lane's first one. A sync an earlier build could not finish (`data-sync.json` "pending") keeps its
//      starting commit, so the next build retries it by itself;
//   2. additive only: a new table or a new field is fine. A removed table, a removed or renamed field or a field whose
//      type changed stops here with a plain note ("an engineer must apply this by hand") and nothing is run;
//   3. the script: package.json "data:sync" (run through npm) or scripts/data-sync.mjs, and its dry-run convention read
//      from its source (`--yes` applies, else `--dry-run` previews). No script, or one without a preview, is a plain
//      note for an engineer too;
//   4. the dry run, then the apply, in a clean worktree of the repo at the deployed commit (never a working tree with
//      changes) with the repo's own node_modules, the dev environment's Blocks login store (BLOCKS_CONFIG_DIR) and the
//      account the lanes use (MF_BLOCKS_RELEASE_ACCOUNT).
//
//   5. new tables locked: `blocks data schema push` leaves a NEW table open until its access rules are deployed (CLI
//      0.9.x makes it Public for read/insert/update/delete and prints "grantedPublicAccess"; later CLIs leave it at
//      User). So when the apply stopped after its push created tables, it runs once more right away (the scripts are
//      idempotent), and after every apply that created tables the engine checks on its own that each of them has
//      access policies for all four operations (`blocks data rules pull` in the temp worktree). A table it cannot
//      confirm is a "SECURITY:" line in the engine log, an `exposed` entry in data-sync.json and a plain sentence in
//      the tickets and the job's message.
//
// The lanes cannot pause between their push and their deploy, so this runs right after the deploy. A failure never
// undoes the deploy: it answers a plain line, stays pending for the next build and logs the script's own output only
// to the engine log (redacted, clipped). The page and the tickets never see it.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { releaseAccount, storeEnv, storeOf } from "./blocksLogin.ts";
import { cliOf, deployOrder, parseRegistry, registryRepos, type RegistryRepo } from "./hostRegistry.ts";
import { commitsIn } from "./uilm.ts";
import { EXPOSED_LINE } from "../../../../src/domain/afterDeploy";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const exec = promisify(execFile);

/** Where a product keeps its table definitions, relative to the API repo (the sync scripts read it directly). */
export const SCHEMA_DIR = "blocks/data/schemas";

// ------------------------------------------------------------------ the lines people read (pure)

export const updatedLine = (tables: number, fields: number): string => `Data tables updated on Blocks (${tables} new, ${fields} changed fields added).`;

export const REFUSED_LINE = "The new build changes existing data fields; an engineer must apply this by hand.";

export const NO_SCRIPT_LINE = "The new build changes its data tables, but the API has no data script the engine can preview and run; an engineer must apply them by hand.";

export const FAILED_LINE = "The new build is deployed, but its data tables did not reach Blocks yet, so new screens may not save. The next build tries again; if that fails too, ask the engine team.";

/** First in the job's message and the tickets' note whenever a new table may still be open (the page's line too:
 *  src/domain/afterDeploy.ts). */
export { EXPOSED_LINE };

// ------------------------------------------------------------------ the additive check (pure)

export interface SchemaField {
  name: string;
  type: string;
  isArray: boolean;
}

export interface TableSchema {
  /** The file name in the schema folder. */
  file: string;
  schemaName: string;
  collectionName: string;
  schemaType: string;
  fields: SchemaField[];
}

export type ProblemKind = "removed-table" | "renamed-table" | "changed-table" | "removed-field" | "renamed-field" | "changed-type";

export interface SchemaProblem {
  table: string;
  kind: ProblemKind;
  field?: string;
  /** "Name -> Title", "String -> Int". */
  detail?: string;
}

export interface SchemaPlan {
  newTables: string[];
  addedFields: Array<{ table: string; field: string }>;
  problems: SchemaProblem[];
}

/** A schema file's table, or null when it is not one (pure). */
export function parseSchema(file: string, body: string): TableSchema | null {
  let doc: Row;
  try {
    doc = rec(JSON.parse(body.replace(/^﻿/, "")));
  } catch {
    return null;
  }
  const schemaName = text(doc.schemaName);
  const collectionName = text(doc.collectionName);
  if (!schemaName && !collectionName) return null;
  const seen = new Set<string>();
  const fields: SchemaField[] = [];
  for (const f of (Array.isArray(doc.fields) ? doc.fields : []).map(rec)) {
    const name = text(f.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    fields.push({ name, type: text(f.type), isArray: f.isArray === true });
  }
  return { file, schemaName, collectionName, schemaType: doc.schemaType === undefined || doc.schemaType === null ? "" : String(doc.schemaType), fields };
}

const keyOf = (s: TableSchema): string => s.collectionName || s.schemaName || s.file;
const nameOf = (s: TableSchema): string => s.schemaName || s.collectionName || s.file.replace(/\.json$/i, "");
const typeOf = (f: SchemaField): string => `${f.type}${f.isArray ? "[]" : ""}`;

/** What the new schema files do to the tables Blocks has: new tables and new fields are fine; a removed table, a
 *  renamed or removed field or a changed type is a problem (pure). */
export function compareSchemas(before: TableSchema[], after: TableSchema[]): SchemaPlan {
  const was = new Map(before.map((s) => [keyOf(s), s]));
  const now = new Map(after.map((s) => [keyOf(s), s]));
  const plan: SchemaPlan = { newTables: [], addedFields: [], problems: [] };
  const claimed = new Set<string>();
  for (const [key, old] of was) {
    const cur = now.get(key);
    if (!cur) {
      // the same table under another collection, or the same file with another table: a rename
      const moved = after.find((s) => !was.has(keyOf(s)) && !claimed.has(keyOf(s)) && ((old.schemaName && s.schemaName === old.schemaName) || s.file === old.file));
      if (moved) {
        claimed.add(keyOf(moved));
        plan.problems.push({ table: nameOf(old), kind: "renamed-table", detail: `${key} -> ${keyOf(moved)}` });
      } else {
        plan.problems.push({ table: nameOf(old), kind: "removed-table" });
      }
      continue;
    }
    if (old.schemaName && cur.schemaName && old.schemaName !== cur.schemaName) plan.problems.push({ table: nameOf(old), kind: "renamed-table", detail: `${old.schemaName} -> ${cur.schemaName}` });
    if (old.schemaType && cur.schemaType && old.schemaType !== cur.schemaType) plan.problems.push({ table: nameOf(old), kind: "changed-table", detail: `schemaType ${old.schemaType} -> ${cur.schemaType}` });
    const curFields = new Map(cur.fields.map((f) => [f.name, f]));
    const oldNames = new Set(old.fields.map((f) => f.name));
    const added = cur.fields.filter((f) => !oldNames.has(f.name));
    const pairedAdds = new Set<string>();
    for (const f of old.fields) {
      const c = curFields.get(f.name);
      if (c) {
        if (typeOf(c) !== typeOf(f)) plan.problems.push({ table: nameOf(cur), kind: "changed-type", field: f.name, detail: `${typeOf(f)} -> ${typeOf(c)}` });
        continue;
      }
      // a field that is gone while one of the same type came: most likely renamed
      const twin = added.find((a) => !pairedAdds.has(a.name) && typeOf(a) === typeOf(f));
      if (twin) {
        pairedAdds.add(twin.name);
        plan.problems.push({ table: nameOf(cur), kind: "renamed-field", field: f.name, detail: `${f.name} -> ${twin.name}` });
      } else {
        plan.problems.push({ table: nameOf(cur), kind: "removed-field", field: f.name });
      }
    }
    for (const a of added) if (!pairedAdds.has(a.name)) plan.addedFields.push({ table: nameOf(cur), field: a.name });
  }
  for (const [key, s] of now) if (!was.has(key) && !claimed.has(key)) plan.newTables.push(nameOf(s));
  plan.newTables.sort((a, b) => a.localeCompare(b));
  return plan;
}

/** "Employee: field Category removed" for the engine log (pure). */
export const problemText = (p: SchemaProblem): string =>
  `${p.table}: ${p.kind === "removed-table" ? "table removed" : p.kind === "renamed-table" ? `table renamed (${p.detail ?? ""})` : p.kind === "changed-table" ? `table kind changed (${p.detail ?? ""})` : p.kind === "removed-field" ? `field ${p.field} removed` : p.kind === "renamed-field" ? `field renamed (${p.detail ?? ""})` : `field ${p.field} type changed (${p.detail ?? ""})`}`;

// ------------------------------------------------------------------ the product's sync script (pure)

export interface SyncScript {
  /** "npm": `npm run data:sync [-- flags]`; "node": `node <file> [flags]`. */
  command: "npm" | "node";
  /** The script file, repo-relative. */
  file: string;
  /** The flags of the preview ([] when the script previews by default). */
  dry: string[];
  /** The flags of the apply ([] when the script applies by default). */
  apply: string[];
}

export type ScriptFound = { kind: "script"; script: SyncScript } | { kind: "none" } | { kind: "unknown"; file: string };

/** The script's dry-run convention from its source: `argv.includes("--dry-run")` previews with that flag and applies
 *  without one; `argv.includes("--yes")` previews by default and applies with --yes (pure). */
export function flagConvention(source: string): { dry: string[]; apply: string[] } | null {
  const reads = (flag: string) => new RegExp(`argv\\b[^;\\n]{0,60}?\\.includes\\(\\s*(["'\`])${flag}\\1\\s*\\)`).test(source);
  const yes = reads("--yes");
  if (reads("--dry-run")) return { dry: ["--dry-run"], apply: yes ? ["--yes"] : [] };
  return yes ? { dry: [], apply: ["--yes"] } : null;
}

const DEFAULT_SCRIPT = "scripts/data-sync.mjs";
const safeFile = (f: string): string => {
  const p = path.posix.normalize(f.replace(/\\/g, "/").replace(/^\.\/+/, ""));
  return p && !p.startsWith("../") && p !== ".." && !path.posix.isAbsolute(p) ? p : "";
};

/** package.json's "data:sync" script ("" when it has none) (pure). */
function npmScript(packageJson: string | null): string {
  try {
    return packageJson ? text(rec(rec(JSON.parse(packageJson)).scripts)["data:sync"]) : "";
  } catch {
    return "";
  }
}

/** The file package.json's "data:sync" runs (`node [flags] <file>`), repo-relative; none when it names none (pure). */
export function scriptFileOf(packageJson: string | null): string[] {
  const m = /\bnode\s+(?:--?[\w-]+(?:=\S+)?\s+)*["']?([^\s"'&|;]+\.(?:mjs|cjs|js))["']?/.exec(npmScript(packageJson));
  const file = m ? safeFile(m[1]!) : "";
  return file ? [file] : [];
}

/** The repo's data sync: package.json "data:sync" first (its `node <file>`), else scripts/data-sync.mjs (pure). */
export function syncScriptOf(packageJson: string | null, read: (file: string) => string | null): ScriptFound {
  if (npmScript(packageJson)) {
    const file = scriptFileOf(packageJson)[0] ?? "";
    const src = file ? read(file) : null;
    const conv = src === null ? null : flagConvention(src);
    return conv ? { kind: "script", script: { command: "npm", file, ...conv } } : { kind: "unknown", file: file || "package.json" };
  }
  const src = read(DEFAULT_SCRIPT);
  if (src === null) return { kind: "none" };
  const conv = flagConvention(src);
  return conv ? { kind: "script", script: { command: "node", file: DEFAULT_SCRIPT, ...conv } } : { kind: "unknown", file: DEFAULT_SCRIPT };
}

/** The command of one run of the script (pure). */
export function scriptCommand(s: SyncScript, flags: string[], node = process.execPath): [string, string[]] {
  if (s.command === "npm") return ["npm", ["run", "data:sync", ...(flags.length ? ["--", ...flags] : [])]];
  return [node, [s.file, ...flags]];
}

/** The repos whose data tables the API owns: the API-role repos, else the one repo of a one-repo app (pure). */
export function dataRepos(repos: RegistryRepo[]): RegistryRepo[] {
  const api = deployOrder(repos).filter((r) => r.role === "api");
  return api.length ? api : repos.length === 1 ? repos : [];
}

/** A script's output for the engine log: no tokens or credentials, one line, clipped (pure). */
export function redactOutput(s: string, max = 1_200): string {
  const flat = s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, "[token]")
    .replace(/\b(bearer)\s+[\w.~+/=-]{8,}/gi, "$1 [token]")
    .replace(/\b([\w-]*(?:token|secret|password|apikey|api_key)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1$2[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `…${flat.slice(-max)}` : flat;
}

// ------------------------------------------------------------------ new tables locked (pure)

/** The JSON value (an array or an object) that starts at s[i], as text; null when it does not close (pure). */
function jsonAt(s: string, i: number): string | null {
  let depth = 0;
  let quoted = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (quoted) {
      if (ch === "\\") j++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return s.slice(i, j + 1);
    }
  }
  return null;
}

const parsed = (s: string | null): unknown => {
  try {
    return s === null ? undefined : JSON.parse(s);
  } catch {
    return undefined;
  }
};

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/** The tables an apply's output says its push created, wherever the JSON sits among other text and however often it
 *  is printed (the script's own push, `data sync`'s push): the CLI's "grantedPublicAccess" (0.9.x: made Public),
 *  "newSchemaAccess": {"schemas"} (later CLIs: left at User) and the template's own "createdTables" line. A clipped
 *  value is skipped (pure). */
export function createdTablesIn(out: string): string[] {
  const found = new Set<string>();
  for (const m of out.matchAll(/"(grantedPublicAccess|createdTables)"\s*:\s*(?=\[)/g)) for (const n of names(parsed(jsonAt(out, m.index + m[0].length)))) found.add(n);
  for (const m of out.matchAll(/"newSchemaAccess"\s*:\s*(?=\{)/g)) for (const n of names(rec(parsed(jsonAt(out, m.index + m[0].length))).schemas)) found.add(n);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** PolicyOperation: READ = 0, WRITE (insert) = 1, EDIT (update) = 2, DELETE = 3. ALL = 4 is not counted: the
 *  service branches on the four concrete operations only (the CLI's own note on ConfigureSchemaAccess). */
const OPERATIONS = [0, 1, 2, 3] as const;
const OPERATION_NAMES: Record<string, number> = { read: 0, write: 1, insert: 1, create: 1, edit: 2, update: 2, delete: 3 };

function operationOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const t = text(v).toLowerCase();
  return /^\d+$/.test(t) ? Number(t) : (OPERATION_NAMES[t] ?? null);
}

export interface TableRef {
  schemaName: string;
  collectionName?: string;
}

/** The tables whose access policies in a `data rules pull` file do not cover all four operations. A policy names its
 *  table by schemaName (or entityName); either the table's schema name or its collection name counts (pure).
 *  The file holds policies only, not the tables' access levels: a table with four policies counts as locked. */
export function unlockedTables(rules: unknown, tables: TableRef[]): string[] {
  const ops = new Map<string, Set<number>>();
  for (const p of (Array.isArray(rec(rules).policies) ? (rec(rules).policies as unknown[]) : []).map(rec)) {
    const key = (text(p.schemaName) || text(p.entityName)).toLowerCase();
    const op = operationOf(p.operation);
    if (!key || op === null) continue;
    if (!ops.has(key)) ops.set(key, new Set());
    ops.get(key)!.add(op);
  }
  const covered = (t: TableRef): boolean => {
    const have = new Set([...(ops.get(t.schemaName.toLowerCase()) ?? []), ...(t.collectionName ? (ops.get(t.collectionName.toLowerCase()) ?? []) : [])]);
    return OPERATIONS.every((op) => have.has(op));
  };
  return tables.filter((t) => !covered(t)).map((t) => t.schemaName);
}

/** One page of `data schema list --json`: { data: { totalCount, items } } (one more `data` level tolerated, as the CLI
 *  does); null when the output is not one (pure). */
export function schemaPage(stdout: string): { items: Row[]; total: number | null } | null {
  const doc = rec(parsed(jsonAt(stdout, Math.max(0, stdout.indexOf("{")))));
  const body = [rec(rec(doc.data).data), rec(doc.data), doc].find((x) => Array.isArray(x.items));
  if (!body) return null;
  return { items: (body.items as unknown[]).map(rec), total: typeof body.totalCount === "number" ? body.totalCount : null };
}

// ------------------------------------------------------------------ git (read-only on the clone)

const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repo, ...args], { env: gitEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  return String(stdout);
}

async function tryGit(repo: string, args: string[]): Promise<string | null> {
  try {
    return await git(repo, args);
  } catch {
    return null;
  }
}

interface Blob {
  name: string;
  oid: string;
}

/** The schema files at a revision ("" is the empty tree: before the first commit). */
async function schemaFiles(repo: string, rev: string): Promise<Blob[]> {
  if (!rev) return [];
  const raw = await tryGit(repo, ["ls-tree", "-z", rev, "--", `${SCHEMA_DIR}/`]);
  const out: Blob[] = [];
  for (const entry of (raw ?? "").split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (m && /\.json$/i.test(m[2]!)) out.push({ name: path.posix.basename(m[2]!), oid: m[1]! });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const sameFiles = (a: Blob[], b: Blob[]): boolean => a.length === b.length && a.every((x, i) => x.name === b[i]!.name && x.oid === b[i]!.oid);

async function tablesOf(repo: string, files: Blob[]): Promise<{ tables: TableSchema[]; unreadable: string[] }> {
  const tables: TableSchema[] = [];
  const unreadable: string[] = [];
  for (const f of files) {
    const t = parseSchema(f.name, (await tryGit(repo, ["cat-file", "blob", f.oid])) ?? "");
    if (t) tables.push(t);
    else unreadable.push(f.name);
  }
  return { tables, unreadable };
}

/** A file of the repo at a revision, or null. */
const fileAt = (repo: string, rev: string, file: string): Promise<string | null> => tryGit(repo, ["show", `${rev}:${file}`]);

// ------------------------------------------------------------------ the record (data-sync.json in the product folder)

interface Pending {
  /** The commit whose schema files Blocks is known to have (the comparison starts there; "" = before the first). */
  from: string;
  /** The deployed commit the sync was for. */
  to: string;
  reason: "failed" | "refused";
  at: string;
  job: string;
  problems?: SchemaProblem[];
}

/** A new table the engine could not confirm locked after a sync: it may be open until its rules are deployed. */
export interface Exposure {
  /** The registry repo key. */
  repo: string;
  table: string;
  /** When the engine first saw it open (kept while it stays open). */
  since: string;
  /** The deployed commit whose sync left it open. */
  commit: string;
  job: string;
}

interface DataRecord {
  schema: "madp-data-sync-after-deploy/1";
  /** By registry repo key. */
  pending: Record<string, Pending>;
  /** The new tables that may still be open; a later sync that confirms one locked removes it. */
  exposed?: Exposure[];
  last?: { at: string; job: string; status: DataStatus; repos: string[]; tables: number; fields: number; problems?: SchemaProblem[]; exposed?: string[] };
}

const recordFile = (app: Pick<OfficialApp, "dir">): string => path.join(app.dir, "data-sync.json");

export function readDataRecord(app: Pick<OfficialApp, "dir">): DataRecord {
  try {
    const r = rec(JSON.parse(fs.readFileSync(recordFile(app), "utf8")));
    const exposed = (Array.isArray(r.exposed) ? r.exposed : []).map(rec).filter((x) => text(x.repo) && text(x.table)) as unknown as Exposure[];
    return { schema: "madp-data-sync-after-deploy/1", pending: rec(r.pending) as Record<string, Pending>, ...(exposed.length ? { exposed } : {}), ...(r.last ? { last: r.last as DataRecord["last"] } : {}) };
  } catch {
    return { schema: "madp-data-sync-after-deploy/1", pending: {} };
  }
}

function writeDataRecord(app: Pick<OfficialApp, "dir">, r: DataRecord): void {
  fs.mkdirSync(app.dir, { recursive: true });
  const f = recordFile(app);
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(r, null, 2)}\n`);
  fs.renameSync(`${f}.tmp`, f);
}

// ------------------------------------------------------------------ the sync

/** "exposed": a new table may still be open (it ranks above everything else). */
export type DataStatus = "none" | "updated" | "refused" | "failed" | "exposed";

export interface DataOutcome {
  status: DataStatus;
  /** The line for the tickets and the job ("" when nothing ran). */
  line: string;
  /** The repo keys the step worked on. */
  repos: string[];
  /** New tables and new fields on existing tables that reached Blocks. */
  tables: number;
  fields: number;
  problems?: SchemaProblem[];
  /** The new tables that may still be open (status "exposed"). */
  exposed?: string[];
  /** Every table the record still lists as possibly open after this sync (this build's and an earlier one's): the
   *  build is not finished while one is (afterDeploy.ts). */
  openTables?: string[];
  /** The repos whose earlier refused change still waits for an engineer (kept: this build says nothing new about it). */
  waiting?: string[];
}

export interface DataSyncOptions {
  step?: (pct: number, line: string) => Promise<void>;
  pct?: number;
  /** How long one run of the script may take. */
  timeoutMs?: number;
}

interface RepoOutcome {
  key: string;
  status: Exclude<DataStatus, "none"> | "none";
  line: string;
  tables: number;
  fields: number;
  problems?: SchemaProblem[];
  /** The pending entry the next build starts from (undefined: none). */
  pending?: Omit<Pending, "at" | "job">;
  /** The pending entry stays as it was (a refusal and a build that changed no schema file). */
  kept?: boolean;
  /** The new tables the engine checked after the apply, and those of them it could not confirm locked. */
  checked?: string[];
  exposed?: string[];
  /** The deployed commit (for the exposure record). */
  head?: string;
  /** Exposed and the apply stopped too. */
  stopped?: boolean;
}

/** One run of the script (or of the CLI) in the clean worktree; its own output goes only to the engine log. */
function runScript(run: JobRun, cwd: string, env: NodeJS.ProcessEnv, cmd: [string, string[]], timeoutMs: number): Promise<{ code: number; out: string; stdout: string }> {
  return new Promise((resolve) => {
    const beat = setInterval(() => void run.heartbeat().catch(() => undefined), 20_000);
    execFile(cmd[0], cmd[1], { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, signal: run.signal, killSignal: "SIGTERM" }, (err, stdout, stderr) => {
      clearInterval(beat);
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: `${String(stdout ?? "")}\n${String(stderr ?? "")}`, stdout: String(stdout ?? "") });
    }).stdin?.end();
  });
}

// ------------------------------------------------------------------ the check that new tables are locked

/** The Blocks CLI the product's own script runs: the copy in its node_modules (the template's blocks-cli.mjs runs
 *  node_modules/@seliseblocks/cli-os/bin/run.js), else the registry's cli.run_js, else `blocks` on PATH. */
function productCli(dir: string, data: Row): [string, string[]] {
  const own = path.join(dir, "node_modules", "@seliseblocks", "cli-os", "bin", "run.js");
  if (fs.existsSync(own)) return [process.execPath, [own]];
  const registry = cliOf(data).runJs;
  return registry && fs.existsSync(registry) ? [process.execPath, [registry]] : ["blocks", []];
}

/** Where `data rules pull` writes in the worktree (blocks.json data.rules, as the CLI reads it); never outside it. */
function rulesFileIn(dir: string): string {
  const fallback = path.join(dir, "blocks", "data", "rules.json");
  let configured = "";
  try {
    configured = text(rec(rec(JSON.parse(fs.readFileSync(path.join(dir, "blocks.json"), "utf8"))).data).rules);
  } catch {
    /* the CLI's default */
  }
  const file = configured ? path.resolve(dir, configured) : fallback;
  return file.startsWith(`${dir}${path.sep}`) ? file : fallback;
}

interface Verify {
  run: JobRun;
  label: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  cli: [string, string[]];
  timeoutMs: number;
}

/** The project's access policies as Blocks has them now: `blocks data rules pull` (read-only on Blocks, it writes the
 *  rules file in the temp worktree, never in the product's clone). The apply wrote its own rules file there, so it is
 *  removed first: only what the pull wrote counts. One retry; null when it does not work.
 *  Limits: the pull returns policies only, not the tables' access levels (Public/User/Custom), so a table counts as
 *  locked when it has policies for all four operations; and it reads the first 500 tables of the project only (one
 *  page), so a table beyond them is not confirmed (it fails closed). `data schema aggregation` has the access levels
 *  per table and could make this check stronger once its response shape is pinned down. */
async function pulledRules(v: Verify): Promise<unknown | null> {
  const file = rulesFileIn(v.dir);
  for (let attempt = 1; attempt <= 2; attempt++) {
    fs.rmSync(file, { force: true });
    const res = await runScript(v.run, v.dir, v.env, [v.cli[0], [...v.cli[1], "data", "rules", "pull", "--json"]], v.timeoutMs);
    v.run.check();
    if (res.code === 0) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        /* nothing written */
      }
    }
    v.run.log(`${v.label}: the check of the new tables' access rules could not read them (rules pull exit ${res.code}, try ${attempt} of 2): ${redactOutput(res.out, 300)}`);
  }
  return null;
}

/** The names (schema and collection, lower case) of every table on Blocks: `data schema list` page after page (it
 *  answers 100 per page). Null when it does not work. */
async function tablesOnBlocks(v: Verify): Promise<Set<string> | null> {
  const PAGE_SIZE = 100;
  const seen = new Set<string>();
  let count = 0;
  for (let page = 1; page <= 200; page++) {
    const res = await runScript(v.run, v.dir, v.env, [v.cli[0], [...v.cli[1], "data", "schema", "list", "--page", String(page), "--page-size", String(PAGE_SIZE), "--json"]], v.timeoutMs);
    v.run.check();
    const got = res.code === 0 ? schemaPage(res.stdout) : null;
    if (!got) {
      v.run.log(`${v.label}: the list of the project's tables could not be read (exit ${res.code}): ${redactOutput(res.out, 300)}`);
      return null;
    }
    for (const it of got.items) for (const n of [text(it.schemaName), text(it.collectionName)]) if (n) seen.add(n.toLowerCase());
    count += got.items.length;
    if (!got.items.length || (got.total !== null ? count >= got.total : got.items.length < PAGE_SIZE)) return seen;
  }
  return null;
}

/** The new tables that may still be open after the apply. `created`: the tables the apply's output says its push
 *  created (they exist); `fresh`: the new tables of the schema files (the push creates them, if it got that far).
 *  After an apply that went through, every one of them must have its policies. After one that stopped, a created one
 *  must; a fresh one only if Blocks has it (a sync that stopped before its push created nothing). A check that cannot
 *  run fails closed for the tables known to exist. */
async function stillOpen(v: Verify, o: { created: string[]; fresh: TableRef[]; applied: boolean }): Promise<{ checked: string[]; open: string[] }> {
  const refs = new Map<string, TableRef>();
  for (const t of o.fresh) refs.set(t.schemaName.toLowerCase(), t);
  const known = new Set(o.created.map((n) => n.toLowerCase()));
  for (const n of o.created) if (!refs.has(n.toLowerCase())) refs.set(n.toLowerCase(), { schemaName: n });
  const all = [...refs.values()];
  if (!all.length) return { checked: [], open: [] };
  const exists = (t: TableRef) => o.applied || known.has(t.schemaName.toLowerCase());
  const rules = await pulledRules(v);
  if (rules === null) {
    const open = all.filter(exists).map((t) => t.schemaName);
    if (all.length > open.length) v.run.log(`${v.label}: whether ${all.filter((t) => !exists(t)).map((t) => t.schemaName).join(", ")} exist on Blocks is not known; the next build checks again`);
    return { checked: open, open };
  }
  const unlocked = new Set(unlockedTables(rules, all).map((n) => n.toLowerCase()));
  const doubt = all.filter((t) => unlocked.has(t.schemaName.toLowerCase()) && !exists(t));
  let onBlocks: Set<string> | null = new Set();
  if (doubt.length) onBlocks = await tablesOnBlocks(v);
  const open: string[] = [];
  const checked: string[] = [];
  for (const t of all) {
    const name = t.schemaName.toLowerCase();
    if (!unlocked.has(name)) {
      checked.push(t.schemaName);
      continue;
    }
    if (exists(t)) {
      checked.push(t.schemaName);
      open.push(t.schemaName);
    } else if (onBlocks === null) {
      v.run.log(`${v.label}: whether ${t.schemaName} exists on Blocks is not known; the next build checks again`);
    } else {
      checked.push(t.schemaName);
      if (onBlocks.has(name) || (t.collectionName && onBlocks.has(t.collectionName.toLowerCase()))) open.push(t.schemaName);
    }
  }
  return { checked, open };
}

/** A clean worktree of the repo at the commit (hooks off), with the clone's node_modules linked in. */
async function cleanWorktree(repo: string, sha: string): Promise<{ dir: string; drop: () => Promise<void> }> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "madp-data-sync-"));
  const dir = path.join(parent, "repo");
  const drop = async () => {
    const link = path.join(dir, "node_modules");
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      /* none */
    }
    await tryGit(repo, ["worktree", "remove", "--force", dir]);
    fs.rmSync(parent, { recursive: true, force: true });
    await tryGit(repo, ["worktree", "prune"]);
  };
  try {
    await git(repo, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--quiet", dir, sha]);
    const modules = path.join(repo, "node_modules");
    if (fs.existsSync(modules) && !fs.existsSync(path.join(dir, "node_modules"))) fs.symlinkSync(modules, path.join(dir, "node_modules"), "dir");
  } catch (e) {
    await drop();
    throw e;
  }
  return { dir, drop };
}

/** The script's environment: the dev store, the registry's cli.env and the account the lanes use. */
function scriptEnv(data: Row, store: string, account: string): NodeJS.ProcessEnv {
  const extra = Object.fromEntries(Object.entries(rec(rec(data.cli).env)).filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === "string").map(([k, v]) => [k, String(v)]));
  return { ...storeEnv(store), ...extra, MF_BLOCKS_RELEASE_ACCOUNT: account };
}

async function syncRepo(run: JobRun, app: OfficialApp, data: Row, r: RegistryRepo, work: { commits: string[] }, pend: Pending | undefined, o: DataSyncOptions): Promise<RepoOutcome> {
  const none: RepoOutcome = { key: r.key, status: "none", line: "", tables: 0, fields: 0 };
  const label = `data tables after deploy ${app.name} [${r.key}]`;
  const commits = await commitsIn(r.path, work.commits);
  if (!commits.length && !pend) return none;
  const exists = async (rev: string) => Boolean(rev) && (await tryGit(r.path, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])) !== null;
  const head = commits[0] ?? ((await exists(pend!.to)) ? pend!.to : "");
  if (!head) {
    run.log(`${label}: the pending sync's commit is gone from the clone; dropped`);
    return none;
  }
  const oldest = commits[commits.length - 1];
  const before = oldest ? ((await tryGit(r.path, ["rev-parse", "--verify", "--quiet", `${oldest}^`]))?.trim() ?? "") : "";
  // a sync an earlier build could not finish starts where Blocks was known to be
  const pendOk = pend ? pend.from === "" || ((await exists(pend.from)) && (await tryGit(r.path, ["merge-base", "--is-ancestor", pend.from, head])) !== null) : false;
  if (pend && !pendOk) run.log(`${label}: the pending sync's start is not in the deployed history; comparing this build's commits only`);
  if (pend && !pendOk && !commits.length) return none;
  const from = pend && pendOk ? pend.from : before;

  // 1. what the schema files changed
  const [was, now] = [await schemaFiles(r.path, from), await schemaFiles(r.path, head)];
  if (sameFiles(was, now)) return none;
  // a refusal waits for an engineer: a build that changed no schema file says nothing about it again
  if (pend?.reason === "refused" && pendOk && (!commits.length || sameFiles(await schemaFiles(r.path, before), now))) return { ...none, pending: pend, kept: true };
  const keep = (reason: Pending["reason"], problems?: SchemaProblem[]): RepoOutcome["pending"] => ({ from, to: head, reason, ...(problems?.length ? { problems: problems.slice(0, 50) } : {}) });
  const failed = (why: string): RepoOutcome => {
    run.log(`${label}: ${why}; nothing more applied, the next build tries again`);
    return { ...none, status: "failed", line: FAILED_LINE, pending: keep("failed") };
  };
  if (o.step) await o.step(o.pct ?? 95, "Updating the new build's data tables on Blocks.");
  let applying = false;
  let newTables: string[] = [];
  try {
    const after = await tablesOf(r.path, now);
    if (after.unreadable.length) return failed(`schema file(s) ${after.unreadable.join(", ")} at ${head.slice(0, 9)} cannot be read`);
    const plan = compareSchemas((await tablesOf(r.path, was)).tables, after.tables);
    newTables = plan.newTables;

    // 2. additive only
    if (plan.problems.length) {
      run.log(`${label}: not applied, the schema change is not additive (${plan.problems.slice(0, 8).map(problemText).join("; ")}); an engineer applies it by hand, then removes "${r.key}" from data-sync.json "pending"`);
      return { ...none, status: "refused", line: REFUSED_LINE, problems: plan.problems, pending: keep("refused", plan.problems) };
    }

    // 3. the product's script and its dry-run convention, as committed
    const pkg = await fileAt(r.path, head, "package.json");
    const sources = new Map<string, string | null>();
    for (const f of new Set([DEFAULT_SCRIPT, ...scriptFileOf(pkg)])) sources.set(f, await fileAt(r.path, head, f));
    const found = syncScriptOf(pkg, (f) => sources.get(f) ?? null);
    if (found.kind !== "script") {
      run.log(`${label}: ${found.kind === "none" ? "the repo has no data:sync script or scripts/data-sync.mjs" : `${found.file} has no dry run the engine knows (--dry-run or --yes)`}; nothing applied, an engineer applies it by hand`);
      return { ...none, status: "refused", line: NO_SCRIPT_LINE, pending: keep("refused") };
    }
    if (!fs.existsSync(path.join(r.path, "node_modules"))) return failed("the clone has no node_modules (its packages are not installed on the engine host)");

    // 4. dry run, then apply, in a clean worktree at the deployed commit, in the product's own Blocks store
    const env = scriptEnv(data, storeOf(data, app.name, "dev"), releaseAccount(data));
    const timeoutMs = o.timeoutMs ?? 15 * 60_000;
    const wt = await cleanWorktree(r.path, head);
    const once = async (mode: string, flags: readonly string[]) => {
      const res = await runScript(run, wt.dir, env, scriptCommand(found.script, [...flags]), timeoutMs);
      run.check();
      run.log(`${label}: ${mode} exit ${res.code}: ${redactOutput(res.out)}`);
      return res;
    };
    let stopped = "";
    let check: { checked: string[]; open: string[] };
    try {
      const dry = await once("dry run", found.script.dry);
      if (dry.code !== 0) return failed(`the dry run stopped (exit ${dry.code})`);
      applying = true;
      let res = await once("apply", found.script.apply);
      const created = new Set(createdTablesIn(res.out));
      if (res.code !== 0 && (created.size || /^SECURITY:/m.test(res.out))) {
        // the push went through and a later step stopped: the new tables stay open until their rules are deployed,
        // and the product's script is idempotent, so it runs once more now instead of at the next build
        run.log(`${label}: the apply stopped after its push created table(s)${created.size ? ` ${[...created].slice(0, 8).join(", ")}` : ""}, which stay open until their rules are deployed; running it once more now`);
        res = await once("apply (retry)", found.script.apply);
        for (const t of createdTablesIn(res.out)) created.add(t);
      }
      if (res.code !== 0) stopped = `the apply stopped (exit ${res.code})`;
      // 5. every new table locked, checked on Blocks itself (the script's word is not enough)
      const fresh = after.tables.filter((t) => plan.newTables.includes(nameOf(t))).map((t) => ({ schemaName: nameOf(t), collectionName: t.collectionName }));
      check = await stillOpen({ run, label, dir: wt.dir, env, cli: productCli(wt.dir, data), timeoutMs: Math.min(timeoutMs, 5 * 60_000) }, { created: [...created], fresh, applied: !stopped });
    } finally {
      await wt.drop();
    }
    applying = false;
    const changed = new Set(plan.addedFields.map((f) => f.table)).size;
    const applied = { tables: stopped ? 0 : plan.newTables.length, fields: stopped ? 0 : plan.addedFields.length };
    if (check.open.length) {
      run.log(`SECURITY: ${label}: new data table(s) ${check.open.join(", ")} may be readable by anyone: the schema push created them, but their access rules are not confirmed on Blocks (${stopped || "the apply went through, the rules are missing"}; deployed commit ${head.slice(0, 9)}). Deploy the rules now: run the API's data sync (npm run data:sync -- --yes) at that commit.`);
      return { key: r.key, status: "exposed", line: EXPOSED_LINE, ...applied, pending: keep("failed"), checked: check.checked, exposed: check.open, head, ...(stopped ? { stopped: true } : {}) };
    }
    if (stopped) return { ...failed(stopped), checked: check.checked, head };
    if (check.checked.length) run.log(`${label}: the new table(s) ${check.checked.join(", ")} have their access rules on Blocks`);
    run.log(`${label}: applied at ${head.slice(0, 9)}: ${plan.newTables.length} new table(s)${plan.newTables.length ? ` (${plan.newTables.slice(0, 8).join(", ")})` : ""}, ${plan.addedFields.length} new field(s) on ${changed} table(s)`);
    return { key: r.key, status: "updated", line: updatedLine(plan.newTables.length, plan.addedFields.length), tables: plan.newTables.length, fields: plan.addedFields.length, checked: check.checked, head };
  } catch (e) {
    const why = String((e as { code?: unknown }).code ?? (e as Error).name ?? "error");
    // stopped during the apply or its check: the new tables may be open and nothing confirmed them (fails closed)
    const unsure = applying && newTables.length > 0;
    if (unsure) run.log(`SECURITY: ${label}: the data step stopped during the apply or its check (${run.signal?.aborted ? "the job was stopped" : why}); new data table(s) ${newTables.slice(0, 8).join(", ")} may be readable by anyone until the API's data sync runs again at ${head.slice(0, 9)}`);
    if (run.signal?.aborted) throw e;
    if (unsure) return { ...failed(`it stopped (${why})`), status: "exposed", line: EXPOSED_LINE, exposed: newTables, head, stopped: true };
    return failed(`it stopped (${why})`);
  }
}

const RANK: Record<DataStatus, number> = { none: 0, updated: 1, failed: 2, refused: 3, exposed: 4 };

/** The exposure record after this sync: a repo's entries for the tables it checked now are replaced by what it found
 *  (a table that stays open keeps its first `since`); the other entries stay (pure). */
export function nextExposures(before: Exposure[], outs: Array<{ key: string; checked?: string[]; exposed?: string[]; head?: string }>, at: string, job: string): Exposure[] {
  let list = [...before];
  for (const x of outs) {
    if (!x.checked?.length && !x.exposed?.length) continue;
    const checked = new Set([...(x.checked ?? []), ...(x.exposed ?? [])].map((n) => n.toLowerCase()));
    const was = new Map(list.filter((e) => e.repo === x.key).map((e) => [e.table.toLowerCase(), e]));
    list = list.filter((e) => e.repo !== x.key || !checked.has(e.table.toLowerCase()));
    for (const table of x.exposed ?? []) list.push({ repo: x.key, table, since: was.get(table.toLowerCase())?.since ?? at, commit: x.head ?? "", job });
  }
  return list;
}

/** After a successful build or change lane: the new data tables to Blocks (see the top of this file). Never throws for
 *  a sync problem (the deploy stands); a stopped job still stops. */
export async function syncDataTables(run: JobRun, app: OfficialApp, work: { commits: string[] }, o: DataSyncOptions = {}): Promise<DataOutcome> {
  const none: DataOutcome = { status: "none", line: "", repos: [], tables: 0, fields: 0 };
  let data: Row;
  try {
    data = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  } catch {
    return none;
  }
  const targets = dataRepos(registryRepos(data)).filter((r) => r.path && fs.existsSync(path.join(r.path, ".git")));
  if (!targets.length) return none;
  const record = readDataRecord(app);
  const outs: RepoOutcome[] = [];
  for (const r of targets) {
    const pend = record.pending[r.key];
    try {
      outs.push(await syncRepo(run, app, data, r, work, pend, o));
    } catch (e) {
      // the commits could not be read (git): a pending sync stays as it was
      if (run.signal?.aborted) throw e;
      run.log(`data tables after deploy ${app.name} [${r.key}]: the commits could not be read (${String((e as { code?: unknown }).code ?? (e as Error).name ?? "error")})`);
      outs.push({ key: r.key, status: "failed", line: FAILED_LINE, tables: 0, fields: 0, ...(pend ? { pending: pend } : {}) });
    }
  }
  // what stays open whatever this build did: a refusal still waiting for an engineer, a table that may still be open
  const waiting = outs.filter((x) => x.kept).map((x) => x.key);
  const stillOpen = (list: Exposure[]) => ({ ...(waiting.length ? { waiting } : {}), ...(list.length ? { openTables: list.map((e) => e.table) } : {}) });
  const worked = outs.filter((x) => !x.kept && (x.status !== "none" || record.pending[x.key]));
  if (!worked.length) return { ...none, ...stillOpen(record.exposed ?? []) };
  const pending = { ...record.pending };
  for (const x of worked) {
    if (x.pending) pending[x.key] = { ...x.pending, at: run.iso(), job: run.id };
    else delete pending[x.key];
  }
  const shown = outs.filter((x) => x.status !== "none");
  const status = shown.reduce<DataStatus>((s, x) => (RANK[x.status] > RANK[s] ? x.status : s), "none");
  const tables = shown.reduce((n, x) => n + x.tables, 0);
  const fields = shown.reduce((n, x) => n + x.fields, 0);
  const problems = shown.flatMap((x) => x.problems ?? []);
  const exposedNow = shown.flatMap((x) => x.exposed ?? []);
  // a table that may be open comes first: the job's message is clipped at 200 characters
  const lines = [...new Set(shown.flatMap((x) => (x.status === "updated" ? [] : x.status === "exposed" ? (x.stopped ? [FAILED_LINE] : []) : [x.line])))];
  const line = status === "none" ? "" : status === "updated" ? updatedLine(tables, fields) : [...(exposedNow.length ? [EXPOSED_LINE] : []), ...(tables || fields ? [updatedLine(tables, fields)] : []), ...lines].join(" ");
  const exposed = nextExposures(record.exposed ?? [], outs, run.iso(), run.id);
  const outcome: DataOutcome = { status, line, repos: shown.map((x) => x.key), tables, fields, ...(problems.length ? { problems } : {}), ...(exposedNow.length ? { exposed: exposedNow } : {}), ...stillOpen(exposed) };
  try {
    writeDataRecord(app, {
      schema: "madp-data-sync-after-deploy/1",
      pending,
      ...(exposed.length ? { exposed } : {}),
      last: { at: run.iso(), job: run.id, status, repos: outcome.repos, tables, fields, ...(problems.length ? { problems: problems.slice(0, 50) } : {}), ...(exposedNow.length ? { exposed: exposedNow } : {}) },
    });
  } catch (e) {
    run.log(`${exposedNow.length ? "SECURITY: " : ""}data tables after deploy ${app.name}: the record could not be written (${String(e).slice(0, 120)})`);
  }
  return outcome;
}

/** The notes of the steps after a deploy as one line for the job's message (withTexts in uilm.ts) (pure). */
export function afterDeployNote(...xs: Array<{ status: string; line: string } | null | undefined>): { status: "none" | "synced"; line: string } {
  const line = xs
    .filter((x): x is { status: string; line: string } => Boolean(x && x.status !== "none" && x.line))
    .map((x) => x.line)
    .join(" ");
  return { status: line ? "synced" : "none", line };
}

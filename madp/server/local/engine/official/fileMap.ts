// The product's code as the Factory's planning steps read it (change.analyse): a compact FILE MAP of each repository of
// a product on the official MADP engine, built by the same rules as the engine's feature lane
// (engine/selise-madp/MADP/orchestrator/primitives/quick_ops.py, file_map: `git ls-files`, source and config files
// only, one line per directory with line counts, the smallest files folded into "+k smaller" first when the map is
// over its budget, then directory summaries), and a read-only reader of the product's registry (<name>.yml in
// <project folder>/madp: its description, agent_rules and repositories with their key, role and path).
//
// Read-only: the only command it runs is `git ls-files` (no optional locks, no fsmonitor), it reads file contents only
// to count their lines, and it never writes anything. Errors never carry paths or tool output.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** The whole map's budget in characters, across all repositories. */
export const FILE_MAP_MAX_CHARS = 20_000;

// ── which files the map lists (quick_ops.py MAP_EXTS, _MAP_JSON_RE, _MAP_SKIP_DIRS, _MAP_SKIP_RE) ─────────────────

/** Source files worth listing: code, styles, markup, schema. */
export const MAP_EXTS: ReadonlySet<string> = new Set(
  ".ts .tsx .mts .cts .js .jsx .mjs .cjs .vue .svelte .astro .css .scss .sass .less .html .py .go .cs .java .kt .rb .php .rs .sql .graphql .gql .prisma .proto".split(" "),
);
/** JSON only when it is configuration (locale, fixture and data JSON would swamp the map). */
const MAP_JSON_RE = /^(package|tsconfig[\w.-]*|jsconfig[\w.-]*|components|[\w.-]+\.config|\.?[\w-]*rc|vercel|netlify|turbo|nx|project|angular|app)\.json$/i;
const MAP_SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", "vendor", "__snapshots__", ".git", ".cache", "storybook-static"]);
const MAP_SKIP_RE = /(\.min\.(js|css)|\.map|-lock\.json|\.generated\.\w+)$/i;

/** The extension as Python's os.path.splitext gives it (a leading dot does not start one: ".eslintrc" has none). */
function extOf(name: string): string {
  const base = name.replace(/^\.+/, "");
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i) : "";
}

/** True when the map lists this tracked path (relative, "/"-separated). */
export function mapWanted(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.slice(0, -1).some((d) => MAP_SKIP_DIRS.has(d)) || MAP_SKIP_RE.test(rel)) return false;
  const name = parts[parts.length - 1] ?? "";
  const ext = extOf(name).toLowerCase();
  if (ext === ".json") return MAP_JSON_RE.test(name);
  return MAP_EXTS.has(ext);
}

// ── the entries of one repository ────────────────────────────────────────────────────────────────────────────────

export interface MapEntry {
  /** The directory, relative to the repository ("" for its root). */
  dir: string;
  name: string;
  lines: number;
}

const READ_MAX = 4_000_000;
const READ_PARALLEL = 32;

/** git without the caller's repository overrides, prompts or optional locks (ls-files then never touches the index). */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) delete env[k];
  return env;
}

async function lineCount(file: string): Promise<number | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const st = await fs.promises.lstat(file);
    if (!st.isFile()) return null; // a symlink, a submodule folder, a file deleted in the work tree
    fh = await fs.promises.open(file, "r");
    const size = Math.min(st.size, READ_MAX);
    const buf = Buffer.alloc(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    let n = 0;
    for (let i = 0; i < bytesRead; i++) if (buf[i] === 10) n++;
    return n + (bytesRead > 0 && buf[bytesRead - 1] !== 10 ? 1 : 0);
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** [{dir, name, lines}] of the repository's tracked source files (`git ls-files`). Throws a plain Error when the folder
 *  is not a git repository or git fails. */
export async function mapEntries(repo: string): Promise<MapEntry[]> {
  if (!fs.existsSync(path.join(repo, ".git"))) throw new Error("not a git repository");
  let stdout = "";
  try {
    ({ stdout } = await exec("git", ["-c", "core.fsmonitor=false", "ls-files", "-z"], { cwd: repo, env: gitEnv(), timeout: 60_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }));
  } catch {
    throw new Error("git ls-files failed");
  }
  const rels = stdout.split("\0").map((r) => r.trim().replace(/\\/g, "/")).filter((r) => r && mapWanted(r));
  const out: MapEntry[] = [];
  for (let i = 0; i < rels.length; i += READ_PARALLEL) {
    const chunk = rels.slice(i, i + READ_PARALLEL);
    const counts = await Promise.all(chunk.map((rel) => lineCount(path.join(repo, ...rel.split("/")))));
    chunk.forEach((rel, k) => {
      const lines = counts[k];
      if (lines === null || lines === undefined) return;
      const cut = rel.lastIndexOf("/");
      out.push({ dir: cut >= 0 ? rel.slice(0, cut) : "", name: rel.slice(cut + 1), lines });
    });
  }
  return out;
}

// ── rendering (quick_ops.py _render_map, render_file_map, file_map) ──────────────────────────────────────────────

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One line per directory: `dir/ (N files, L lines): a.tsx 120, b.ts 80, +k smaller`. `hidden` holds the indexes of
 *  files shown only as a count; `depth` (null = exact directories) folds directories into their first `depth` path
 *  components (summaries only). */
function renderMap(entries: readonly MapEntry[], hidden: ReadonlySet<number>, depth: number | null): string {
  const groups = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = depth === null ? e.dir : e.dir.split("/").slice(0, depth).join("/");
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const rows: string[] = [];
  for (const key of [...groups.keys()].sort(byCodePoint)) {
    const idx = groups.get(key)!;
    const total = idx.reduce((s, i) => s + entries[i]!.lines, 0);
    const head = `${key ? `${key}/` : "(root)"} (${idx.length} file${idx.length !== 1 ? "s" : ""}, ${total} lines)`;
    const shown = depth !== null ? [] : [...idx].sort((a, b) => byCodePoint(entries[a]!.name, entries[b]!.name)).filter((i) => !hidden.has(i)).map((i) => `${entries[i]!.name} ${entries[i]!.lines}`);
    if (!shown.length) {
      rows.push(head);
      continue;
    }
    const more = idx.length - shown.length;
    rows.push(`${head}: ${[...shown, ...(more ? [`+${more} smaller`] : [])].join(", ")}`);
  }
  return rows.join("\n");
}

/** The directory-grouped listing within `maxChars`: the smallest files fold into a per-directory "+k smaller" count
 *  first; when the directory lines alone are still too long, directories fold into summaries of their first path
 *  components (the deepest level that fits); a hard cut is the last resort. */
export function renderFileMap(entries: readonly MapEntry[], maxChars: number): string {
  const full = renderMap(entries, new Set(), null);
  if (full.length <= maxChars) return full;
  const order = entries.map((_, i) => i).sort((a, b) => entries[a]!.lines - entries[b]!.lines || byCodePoint(entries[a]!.name, entries[b]!.name));
  if (renderMap(entries, new Set(order), null).length <= maxChars) {
    let lo = 1;
    let hi = order.length; // the fewest hidden (smallest) files that fit
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (renderMap(entries, new Set(order.slice(0, mid)), null).length <= maxChars) hi = mid;
      else lo = mid + 1;
    }
    return renderMap(entries, new Set(order.slice(0, lo)), null);
  }
  const note = "\n(directory summaries only: the full listing exceeds the map budget)";
  const deepest = entries.reduce((d, e) => (e.dir ? Math.max(d, e.dir.split("/").length) : d), 1);
  for (let depth = deepest; depth > 0; depth--) {
    const text = renderMap(entries, new Set(), depth);
    if (text.length + note.length <= maxChars) return text + note;
  }
  const cut = "\n… (file map truncated)";
  const head = renderMap(entries, new Set(), 1).slice(0, Math.max(0, maxChars - cut.length));
  const nl = head.lastIndexOf("\n");
  return (nl >= 0 ? head.slice(0, nl) : head) + cut;
}

/** One repository's part of the map: its entries, or null when they could not be read. */
export interface RepoMap {
  key: string;
  entries: MapEntry[] | null;
}

/** The entries of each repository (a repository git cannot list gets null, never an exception). */
export async function repoMaps(repos: readonly { key: string; dir: string }[]): Promise<RepoMap[]> {
  return Promise.all(repos.map(async (r) => ({ key: r.key, entries: await mapEntries(r.dir).catch(() => null) })));
}

/** The FILE MAP of several repositories within `maxChars` in all (the budget is shared in proportion to each
 *  repository's full map), one "### `key`" section per repository. */
export function renderRepoMaps(maps: readonly RepoMap[], maxChars: number = FILE_MAP_MAX_CHARS): string {
  const UNAVAILABLE = "(file map unavailable: the repository could not be listed)";
  const header = (m: RepoMap): string => (m.entries ? `### \`${m.key}\` — ${m.entries.length} source files, ${m.entries.reduce((s, e) => s + e.lines, 0)} lines` : `### \`${m.key}\``);
  // headers, separators and the fixed text of unlisted repositories come off the budget first
  const fixed = maps.reduce((s, m) => s + header(m).length + 3 + (m.entries ? 0 : UNAVAILABLE.length), 0);
  const budget = Math.max(0, maxChars - fixed);
  const full = maps.map((m) => (m.entries ? renderMap(m.entries, new Set(), null).length : 0));
  const whole = full.reduce((s, n) => s + n, 0) || 1;
  return maps
    .map((m, k) => {
      const share = whole <= budget ? budget : Math.floor((budget * full[k]!) / whole);
      return `${header(m)}\n${m.entries ? renderFileMap(m.entries, share) : UNAVAILABLE}`;
    })
    .join("\n\n");
}

/** The FILE MAP of repository folders (read-only). */
export async function fileMap(repos: readonly { key: string; dir: string }[], o?: { maxChars?: number }): Promise<string> {
  return renderRepoMaps(await repoMaps(repos), o?.maxChars ?? FILE_MAP_MAX_CHARS);
}

/** Where a path the analysis names stands in a repository's map: a listed "file", a "dir" with listed files below it,
 *  "new" (a file or folder up to two levels below a listed directory, or at the repository's root), or null (it does
 *  not fit the code at all). `rel` is relative and "/"-separated, without a trailing slash. */
export function pathInMap(entries: readonly MapEntry[], rel: string): "file" | "dir" | "new" | null {
  const dirs = new Set<string>([""]);
  for (const e of entries) {
    const parts = e.dir ? e.dir.split("/") : [];
    for (let k = 1; k <= parts.length; k++) dirs.add(parts.slice(0, k).join("/"));
  }
  if (entries.some((e) => (e.dir ? `${e.dir}/${e.name}` : e.name) === rel)) return "file";
  if (dirs.has(rel)) return "dir";
  const parts = rel.split("/");
  for (let up = 1; up <= 2 && up <= parts.length; up++) if (dirs.has(parts.slice(0, parts.length - up).join("/"))) return "new";
  return null;
}

// ── the registry (a small YAML subset) ───────────────────────────────────────────────────────────────────────────

export class YamlError extends Error {}

const indentOf = (l: string): number => /^ */.exec(l)![0].length;
const isSeqItem = (t: string): boolean => t === "-" || t.startsWith("- ") || t.startsWith("-\t");
const isDocMarker = (l: string): boolean => /^(---|\.\.\.)(\s|$)/.test(l);
/** A plain scalar without its comment (" #..."). */
const cutComment = (s: string): string => {
  const m = /(^|\s)#/.exec(s);
  return m ? s.slice(0, m.index) : s;
};

function resolvePlain(t: string): unknown {
  if (t === "" || t === "~" || /^(null|Null|NULL)$/.test(t)) return null;
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(t)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(t)) return false;
  if (/^[-+]?(0|[1-9][0-9_]*)$/.test(t)) return Number(t.replace(/_/g, ""));
  // YAML 1.1 (PyYAML): 0b binary, 0 octal, 0x hex
  const radix = /^([-+]?)0(b[01_]+|[0-7_]+|x[0-9a-fA-F_]+)$/.exec(t);
  if (radix) {
    const body = radix[2]!.replace(/_/g, "");
    const n = body[0] === "b" ? Number.parseInt(body.slice(1), 2) : body[0] === "x" ? Number.parseInt(body.slice(1), 16) : Number.parseInt(body, 8);
    return radix[1] === "-" ? -n : n;
  }
  if (/^[-+]?(\d[\d_]*)?\.\d[\d_]*([eE][-+]?\d+)?$/.test(t) || /^[-+]?\d[\d_]*\.[\d_]*([eE][-+]?\d+)?$/.test(t)) return Number(t.replace(/_/g, ""));
  return t;
}

const ESCAPES: Record<string, string> = { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: " ", L: " ", P: " " };

/** The escape at s[j] (a backslash and what follows it) in a double-quoted scalar: its text and its length. */
function escapeAt(s: string, j: number): { value: string; len: number } {
  const e = s[j + 1] ?? "";
  const hex = e === "x" ? 2 : e === "u" ? 4 : e === "U" ? 8 : 0;
  if (hex) {
    const digits = s.slice(j + 2, j + 2 + hex);
    const code = /^[0-9a-fA-F]+$/.test(digits) && digits.length === hex ? Number.parseInt(digits, 16) : -1;
    if (code < 0 || code > 0x10ffff) throw new YamlError("a bad escape");
    return { value: String.fromCodePoint(code), len: 2 + hex };
  }
  const value = Object.prototype.hasOwnProperty.call(ESCAPES, e) ? ESCAPES[e] : undefined;
  if (value === undefined) throw new YamlError("a bad escape");
  return { value, len: 2 };
}

/** A one-line quoted scalar at the start of `s`: its value and the text after it, or null when it does not close. */
function quotedOnLine(s: string): { value: string; rest: string } | null {
  const q = s[0];
  let out = "";
  for (let j = 1; j < s.length; j++) {
    const ch = s[j]!;
    if (q === "'" && ch === "'") {
      if (s[j + 1] !== "'") return { value: out, rest: s.slice(j + 1) };
      out += "'";
      j++;
    } else if (q === '"' && ch === "\\") {
      if (j + 1 >= s.length) return null; // an escaped line break: the value goes on below
      const x = escapeAt(s, j);
      out += x.value;
      j += x.len - 1;
    } else if (q === '"' && ch === '"') {
      return { value: out, rest: s.slice(j + 1) };
    } else {
      out += ch;
    }
  }
  return null;
}

function keyOf(t: string): { key: string; rest: string } | null {
  if (!t || "#[]{},|>&*!%@`?".includes(t[0]!)) return null;
  if (t[0] === '"' || t[0] === "'") {
    let q: { value: string; rest: string } | null = null;
    try {
      q = quotedOnLine(t);
    } catch {
      return null; // not a key; read as a value, it says what is wrong
    }
    const m = q ? /^[ \t]*:(?=\s|$)/.exec(q.rest) : null;
    return q && m ? { key: q.value, rest: q.rest.slice(m[0].length) } : null;
  }
  const m = /:(?=\s|$)/.exec(t);
  if (!m) return null;
  const c = /(^|\s)#/.exec(t);
  if (c && c.index < m.index) return null;
  return { key: t.slice(0, m.index).trim(), rest: t.slice(m.index + 1) };
}

/** Block-style YAML as registries use it (PyYAML's safe_dump output and hand edits): mappings, sequences, plain,
 *  single- and double-quoted scalars over several lines, | and > block scalars, flow lists and maps, comments. Anchors
 *  and tags are read past; aliases, complex keys and tabs for indentation are not supported (YamlError). */
export function parseYaml(src: string): unknown {
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  /** The indent of the next content line (blank and comment lines skipped), -1 at the end. */
  const peek = (): number => {
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (t === "" || t.startsWith("#")) {
        i++;
        continue;
      }
      return indentOf(lines[i]!);
    }
    return -1;
  };

  const block = (ind: number, parent: number): unknown => {
    const t = lines[i]!.slice(ind);
    if (t.startsWith("\t")) throw new YamlError("tabs for indentation");
    if (isSeqItem(t)) return seq(ind);
    if (keyOf(t)) return map(ind);
    return inline(t.trim(), parent);
  };

  const map = (ind: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (;;) {
      const n = peek();
      if (n < 0 || n < ind || (n === 0 && isDocMarker(lines[i]!))) break;
      if (n > ind) throw new YamlError(`line ${i + 1}: unexpected indentation`);
      const kv = keyOf(lines[i]!.slice(ind));
      if (!kv) throw new YamlError(`line ${i + 1}: a mapping key was expected`);
      const value = valueAfterKey(kv.rest, ind);
      if (kv.key !== "__proto__") out[kv.key] = value;
    }
    return out;
  };

  const valueAfterKey = (rest: string, ind: number): unknown => {
    const t = rest.trim();
    if (t === "" || t.startsWith("#")) {
      i++;
      const n = peek();
      if (n > ind) return block(n, ind);
      if (n === ind && isSeqItem(lines[i]!.slice(ind))) return seq(ind);
      return null;
    }
    return inline(t, ind);
  };

  const seq = (ind: number): unknown[] => {
    const out: unknown[] = [];
    for (;;) {
      const n = peek();
      if (n !== ind) break;
      const line = lines[i]!;
      const t = line.slice(ind);
      if (!isSeqItem(t)) break;
      const body = t.slice(1);
      const content = body.trim();
      if (content === "" || content.startsWith("#")) {
        i++;
        const m = peek();
        out.push(m > ind ? block(m, ind) : null);
        continue;
      }
      const col = ind + 1 + (body.length - body.trimStart().length);
      if (isSeqItem(content) || keyOf(content)) {
        // a block node that starts on the dash's line: read on as if the dash were a space
        lines[i] = " ".repeat(col) + line.slice(col);
        out.push(block(col, ind));
      } else {
        out.push(inline(content, ind));
      }
    }
    return out;
  };

  /** A value that starts in the current line (`t`, trimmed); continuation lines are those indented past `parent`. */
  const inline = (t: string, parent: number): unknown => {
    let s = t;
    for (let m = /^(?:!\S*|&\S+)(?:\s+|$)/.exec(s); m; m = /^(?:!\S*|&\S+)(?:\s+|$)/.exec(s)) s = s.slice(m[0].length);
    if (s === "" || s.startsWith("#")) {
      i++;
      const n = peek();
      return n > parent ? block(n, parent) : null;
    }
    const c = s[0];
    if (c === "*") throw new YamlError("aliases are not supported");
    if (c === "|" || c === ">") return blockScalar(s, parent);
    if (c === "[" || c === "{") return flow(s);
    if (c === '"' || c === "'") return quoted(s);
    return plain(s, parent);
  };

  const plain = (s: string, parent: number): unknown => {
    const first = cutComment(s).trim();
    let out = first;
    let ended = first !== s.trim();
    i++;
    let blanks = 0;
    while (!ended && i < lines.length) {
      const l = lines[i]!;
      const tt = l.trim();
      if (tt === "") {
        blanks++;
        i++;
        continue;
      }
      if (indentOf(l) <= parent || tt.startsWith("#") || (indentOf(l) === 0 && isDocMarker(l))) break;
      const part = cutComment(tt).trim();
      ended = part !== tt;
      out += (blanks ? "\n".repeat(blanks) : " ") + part;
      blanks = 0;
      i++;
    }
    return resolvePlain(out);
  };

  const quoted = (s: string): string => {
    const q = s[0]!;
    let out = "";
    let line = s.slice(1);
    for (;;) {
      let seg = "";
      let keep = 0; // seg's length up to its last escape (escaped whitespace is never folded away)
      let joined = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j]!;
        if (q === "'" && ch === "'") {
          if (line[j + 1] === "'") {
            seg += "'";
            j++;
            keep = seg.length;
            continue;
          }
          const rest = cutComment(line.slice(j + 1)).trim();
          if (rest) throw new YamlError(`line ${i + 1}: text after a quoted value`);
          i++;
          return out + seg;
        }
        if (q === '"' && ch === "\\") {
          if (j + 1 >= line.length) {
            joined = true; // an escaped line break: the next line follows without a space
            break;
          }
          const x = escapeAt(line, j);
          seg += x.value;
          j += x.len - 1;
          keep = seg.length;
          continue;
        }
        if (q === '"' && ch === '"') {
          const rest = cutComment(line.slice(j + 1)).trim();
          if (rest) throw new YamlError(`line ${i + 1}: text after a quoted value`);
          i++;
          return out + seg;
        }
        seg += ch;
      }
      out += joined ? seg : seg.slice(0, keep) + seg.slice(keep).replace(/[ \t]+$/, "");
      i++;
      let blanks = 0;
      while (i < lines.length && lines[i]!.trim() === "") {
        blanks++;
        i++;
      }
      if (i >= lines.length) throw new YamlError("a quoted value does not end");
      out += blanks ? "\n".repeat(blanks) : joined ? "" : " ";
      line = lines[i]!.replace(/^[ \t]+/, "");
    }
  };

  const blockScalar = (s: string, parent: number): string => {
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)\s*(#.*)?$/.exec(s);
    if (!m) throw new YamlError(`line ${i + 1}: a bad block scalar header`);
    const literal = m[1] === "|";
    const chomp = m[2] || m[4];
    let indent = m[3] ? Math.max(0, parent) + Number(m[3]) : -1;
    i++;
    const raw: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === "") {
        raw.push(indent >= 0 ? l.slice(indent) : "");
        i++;
        continue;
      }
      const n = indentOf(l);
      if (indent < 0) {
        if (n <= parent) break;
        indent = n;
      }
      if (n < indent) break;
      raw.push(l.slice(indent));
      i++;
    }
    let trailing = 0;
    while (raw.length && raw[raw.length - 1]!.trim() === "") {
      raw.pop();
      trailing++;
    }
    let body = "";
    if (literal) body = raw.join("\n");
    else {
      let breaks = 0;
      let first = true;
      let prevMore = false;
      for (const line of raw) {
        if (line.trim() === "") {
          breaks++;
          continue;
        }
        const more = /^[ \t]/.test(line);
        if (first) body = "\n".repeat(breaks) + line;
        else if (breaks === 0) body += (more || prevMore ? "\n" : " ") + line;
        else body += "\n".repeat(more || prevMore ? breaks + 1 : breaks) + line;
        first = false;
        breaks = 0;
        prevMore = more;
      }
    }
    if (!raw.length) return chomp === "+" ? "\n".repeat(trailing) : "";
    if (chomp === "-") return body;
    if (chomp === "+") return `${body}\n${"\n".repeat(trailing)}`;
    return `${body}\n`;
  };

  /** A flow list or map, possibly over several lines. */
  const flow = (s: string): unknown => {
    let text = "";
    let line = s;
    let depth = 0;
    let q = "";
    for (;;) {
      let done = -1;
      for (let j = 0; j < line.length && done < 0; j++) {
        const ch = line[j]!;
        if (q) {
          if (q === '"' && ch === "\\") j++;
          else if (ch === q) {
            if (q === "'" && line[j + 1] === "'") j++;
            else q = "";
          }
          continue;
        }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === "#" && (j === 0 || /\s/.test(line[j - 1]!))) {
          line = line.slice(0, j);
          break;
        } else if (ch === "[" || ch === "{") depth++;
        else if (ch === "]" || ch === "}") {
          depth--;
          if (depth === 0) done = j;
        }
      }
      if (done >= 0) {
        const rest = cutComment(line.slice(done + 1)).trim();
        if (rest) throw new YamlError(`line ${i + 1}: text after a flow value`);
        text += line.slice(0, done + 1);
        i++;
        break;
      }
      text += `${line} `;
      i++;
      if (i >= lines.length) throw new YamlError("a flow value does not end");
      line = lines[i]!.trim();
    }
    return parseFlow(text);
  };

  const ind = (() => {
    for (;;) {
      const n = peek();
      if (n === 0 && (/^%/.test(lines[i]!) || /^---\s*(#.*)?$/.test(lines[i]!))) {
        i++;
        continue;
      }
      return n;
    }
  })();
  if (ind < 0) return null;
  const value = block(ind, -1);
  const after = peek();
  if (after >= 0 && !(after === 0 && isDocMarker(lines[i]!))) throw new YamlError(`line ${i + 1}: unexpected content`);
  return value;
}

/** A flow node ([a, "b", {c: d}]) on one line. */
function parseFlow(text: string): unknown {
  let p = 0;
  const ws = () => {
    while (p < text.length && /\s/.test(text[p]!)) p++;
  };
  const scalar = (): unknown => {
    if (text[p] === '"' || text[p] === "'") {
      const q = quotedOnLine(text.slice(p));
      if (!q) throw new YamlError("a quoted value does not end");
      p = text.length - q.rest.length;
      return q.value;
    }
    const start = p;
    while (p < text.length && !",[]{}".includes(text[p]!) && !(text[p] === ":" && (p + 1 >= text.length || /[\s,\]}]/.test(text[p + 1]!)))) p++;
    return resolvePlain(text.slice(start, p).trim());
  };
  const node = (): unknown => {
    ws();
    const c = text[p];
    if (c === "[") {
      p++;
      const out: unknown[] = [];
      for (;;) {
        ws();
        if (text[p] === "]") {
          p++;
          return out;
        }
        out.push(node());
        ws();
        if (text[p] === ",") p++;
        else if (text[p] !== "]") throw new YamlError("a flow list does not close");
      }
    }
    if (c === "{") {
      p++;
      const out: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (text[p] === "}") {
          p++;
          return out;
        }
        const key = String(scalar() ?? "");
        ws();
        let value: unknown = null;
        if (text[p] === ":") {
          p++;
          ws();
          value = text[p] === "," || text[p] === "}" ? null : node();
        }
        if (key !== "__proto__") out[key] = value;
        ws();
        if (text[p] === ",") p++;
        else if (text[p] !== "}") throw new YamlError("a flow map does not close");
      }
    }
    return scalar();
  };
  const v = node();
  ws();
  if (p < text.length) throw new YamlError("text after a flow value");
  return v;
}

export interface RegistryRepo {
  /** The repo key the lanes use (api, web, ...). */
  key: string;
  role: string;
  /** The local clone as the registry names it ("" when it names none). */
  path: string;
}

export interface Registry {
  project: string;
  description: string;
  /** The owner's standing rules for every agent of the lanes (registry `agent_rules`). */
  agentRules: string[];
  repos: RegistryRepo[];
}

const REPO_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const textOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The parts of a registry the Factory reads, or null when the text is not a registry it can read. */
export function parseRegistry(text: string): Registry | null {
  let data: Record<string, unknown>;
  try {
    data = rec(parseYaml(text));
  } catch {
    return null;
  }
  const repos = Object.entries(rec(data.repos))
    .filter(([key]) => REPO_KEY.test(key))
    .map(([key, v]) => ({ key, role: textOf(rec(v).role), path: textOf(rec(v).path) }));
  if (!repos.length) return null;
  const rules = Array.isArray(data.agent_rules) ? data.agent_rules.map(textOf).filter(Boolean) : [];
  return { project: textOf(data.project), description: textOf(data.description), agentRules: rules, repos };
}

const REGISTRY_MAX_BYTES = 1_000_000;

/** The registry file, or null when it is missing, too large or unreadable. */
export function readRegistry(file: string): Registry | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > REGISTRY_MAX_BYTES) return null;
    return parseRegistry(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ── the product's code on this host ──────────────────────────────────────────────────────────────────────────────

export interface ProductRepo extends RepoMap {
  role: string;
}

export interface ProductCode {
  /** The registry name. */
  name: string;
  description: string;
  agentRules: string[];
  /** The repositories found on this host, in the registry's order. */
  repos: ProductRepo[];
  /** The FILE MAP of those repositories. */
  map: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The registry name of the product in its MADP folder: factory.json's name, else `hint`, else the folder's only
 *  registry file. */
function registryName(madpDir: string, hint: string): string {
  try {
    const state = rec(JSON.parse(fs.readFileSync(path.join(madpDir, "factory.json"), "utf8")));
    const name = textOf(state.name);
    if (NAME.test(name) && fs.existsSync(path.join(madpDir, `${name}.yml`))) return name;
  } catch {
    /* below */
  }
  if (NAME.test(hint) && fs.existsSync(path.join(madpDir, `${hint}.yml`))) return hint;
  try {
    const ymls = fs.readdirSync(madpDir).filter((f) => f.endsWith(".yml") && NAME.test(f.slice(0, -4)));
    return ymls.length === 1 ? ymls[0]!.slice(0, -4) : "";
  } catch {
    return "";
  }
}

/** The product's code in its MADP folder (<project folder>/madp): its registry, the repositories of the registry that
 *  are on this host (the registry's own path, else <folder>/<name>-<key>) and their FILE MAP; null when the folder,
 *  the registry or every repository is missing. Read-only, and never throws. */
export async function productCode(madpDir: string, o?: { name?: string; maxChars?: number }): Promise<ProductCode | null> {
  try {
    if (!isDir(madpDir)) return null;
    const name = registryName(madpDir, o?.name ?? "");
    if (!name) return null;
    const registry = readRegistry(path.join(madpDir, `${name}.yml`));
    if (!registry) return null;
    const found = registry.repos
      .map((r) => {
        const own = r.path ? (path.isAbsolute(r.path) ? r.path : path.resolve(madpDir, r.path)) : "";
        const dir = [own, path.join(madpDir, `${name}-${r.key}`)].find((d) => d && isDir(d));
        return dir ? { key: r.key, role: r.role, dir } : null;
      })
      .filter((r): r is { key: string; role: string; dir: string } => r !== null);
    if (!found.length) return null;
    const maps = await repoMaps(found);
    return {
      name,
      description: registry.description,
      agentRules: registry.agentRules,
      repos: found.map((r, k) => ({ key: r.key, role: r.role, entries: maps[k]!.entries })),
      map: renderRepoMaps(maps, o?.maxChars ?? FILE_MAP_MAX_CHARS),
    };
  } catch {
    return null;
  }
}

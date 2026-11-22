/**
 * Parallel streams: independent change requests of one product build side by side, each in its own working copy and
 * lane run (a stream), and land on the development environment one at a time through a merge queue (the engine's
 * `--merge-turn`: rebase onto the latest branch, the gates, the deploy and the checks after it). Pure and import-light:
 * the delivery ops, the engine's job runner and the web all use this file.
 *
 *   - Project.ParallelStreams (StreamsChoice, written by cr.parallelStreams): how many streams the person chose (1..5)
 *     and the tech lead's suggestion they chose from. Absent: 1, one build at a time (the behaviour before streams).
 *   - Project.StreamsAdvice (StreamsAdvice, written by the engine host): what the product's set-up allows at most (its
 *     repositories ready for separate working copies, its environment's limits on check runs) and why, in one line.
 *   - suggestStreams: the tech lead's suggestion (1..5, one plain line): as many as the approved changes that touch
 *     separate code, at least 2, never above what the product's set-up allows (the advice). What a waiting change shares
 *     with a running one is said per waiting change, never as a lower cap.
 *   - planStreams: which change builds run in which stream, which start now and which wait, and for what. Optimistic
 *     parallel development: a build starts as soon as a stream is free (only another build of the same change and a
 *     milestone build hold it). What it shares with a build that started before it (the same files or folders: its
 *     code areas, else the paths its planned tickets name; the same data table; never tests, change records or
 *     translations) only means it lands after that one: rebased onto it, conflicts merged with both intents, checked
 *     again. The landing (the merge turn) stays one at a time, in the order builds finish. The engine starts exactly
 *     what this plan names and writes its line on the job (server/local/engine/streams.ts); the Build step and the
 *     change's page show the same line.
 */
import { parseChangeAnalysis, type ChangeAnalysis } from "./changeAnalysis";
import { changeCode } from "./delivery";

/** The hard cap: never more than this many streams of one product. */
export const MAX_STREAMS = 5;
/** Stored reason and advice lines, in characters. */
export const STREAMS_LINE_MAX = 240;

const ACTIVE = new Set(["queued", "claimed", "running"]);
/** The delivery builds a stream runs: a change request's build (and its fix rounds, reverts, steps after a deploy) and,
 *  alone, a milestone's build. */
export const STREAM_KINDS: readonly string[] = ["change.build", "build.run"];

const clampStreams = (n: unknown, fallback = 1): number =>
  typeof n === "number" && Number.isInteger(n) ? Math.min(MAX_STREAMS, Math.max(1, n)) : fallback;
const line = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, STREAMS_LINE_MAX) : "");
const objectOf = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ the stored values

/** What the person chose (Project.ParallelStreams). */
export interface StreamsChoice {
  v: 1;
  /** 1..MAX_STREAMS; 1 = one build at a time. */
  chosen: number;
  /** The tech lead's suggestion when it was chosen, and its reason. */
  suggested: number;
  reason: string;
  /** Who chose, and when. */
  by: string;
  at: string;
}

export function parseStreamsChoice(raw: unknown): StreamsChoice | null {
  const o = objectOf(raw);
  if (!o || typeof o.chosen !== "number" || !Number.isInteger(o.chosen)) return null;
  return { v: 1, chosen: clampStreams(o.chosen), suggested: clampStreams(o.suggested, clampStreams(o.chosen)), reason: line(o.reason), by: line(o.by), at: line(o.at) };
}

export const serializeStreamsChoice = (c: StreamsChoice): string =>
  JSON.stringify({ v: 1, chosen: clampStreams(c.chosen), suggested: clampStreams(c.suggested), reason: line(c.reason), by: line(c.by), at: line(c.at) });

/** What the engine host found about the product (Project.StreamsAdvice): the most streams its set-up allows. */
export interface StreamsAdvice {
  v: 1;
  /** 1..MAX_STREAMS. */
  cap: number;
  /** Why the cap is what it is, in plain words ("" when nothing limits it). */
  why: string;
  /** The product's repositories. */
  repos: number;
  /** Their keys ("api", "web"): a path a ticket names as "api/src/x.ts" is the api repo's src/x.ts. */
  keys?: string[];
  /** The product's append-only registration files that never make changes wait ("api: src/rbac.ts"; registry
   *  streams.merge_friendly). */
  friendly?: string[];
  at: string;
}

const KEY = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && KEY.test(k.toLowerCase())).map((k) => k.toLowerCase()))].slice(0, 12) : []);

const friendlyOf = (v: unknown): string[] => (Array.isArray(v)
  ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_.-]{1,40}\s*:\s*\S/.test(x)).map((x) => x.replace(/\s+/g, " ").trim().slice(0, 200)))].slice(0, 40)
  : []);

export function parseStreamsAdvice(raw: unknown): StreamsAdvice | null {
  const o = objectOf(raw);
  if (!o || typeof o.cap !== "number") return null;
  const keys = keysOf(o.keys);
  const friendly = friendlyOf(o.friendly);
  return { v: 1, cap: clampStreams(Math.floor(o.cap), MAX_STREAMS), why: line(o.why), repos: typeof o.repos === "number" && o.repos >= 0 ? Math.floor(o.repos) : 0, ...(keys.length ? { keys } : {}), ...(friendly.length ? { friendly } : {}), at: line(o.at) };
}

export const serializeStreamsAdvice = (a: StreamsAdvice): string => {
  const keys = keysOf(a.keys);
  const friendly = friendlyOf(a.friendly);
  return JSON.stringify({ v: 1, cap: clampStreams(a.cap, MAX_STREAMS), why: line(a.why), repos: Math.max(0, Math.floor(a.repos)), ...(keys.length ? { keys } : {}), ...(friendly.length ? { friendly } : {}), at: line(a.at) });
};

/** The same advice apart from when it was written (the engine writes it only when it changed). */
export const sameAdvice = (a: StreamsAdvice | null, b: StreamsAdvice | null): boolean =>
  !!a && !!b && a.cap === b.cap && a.why === b.why && a.repos === b.repos && keysOf(a.keys).join(",") === keysOf(b.keys).join(",")
  && friendlyOf(a.friendly).join("|") === friendlyOf(b.friendly).join("|");

/** The product's merge-friendly registration files of an advice. */
export const productFriendly = (advice: StreamsAdvice | null | undefined): string[] => friendlyOf(advice?.friendly);

/** The repo keys a ticket's path may start with: the advice's, else the usual ones. */
export const repoKeysOf = (advice: StreamsAdvice | null | undefined): string[] => (advice?.keys?.length ? advice.keys : ["api", "web", "app"]);

/** How many streams run (pure): the person's choice, never above what the engine host allows; 1 without a choice. */
export function streamsInUse(choice: StreamsChoice | null, advice: StreamsAdvice | null): number {
  return Math.min(clampStreams(choice?.chosen ?? 1), clampStreams(advice?.cap ?? MAX_STREAMS, MAX_STREAMS));
}

// ------------------------------------------------------------------ what a build touches

/** A change request as the streams read it. */
export interface StreamChange {
  id: string;
  lane: string;
  number: number;
  title: string;
  status: string;
  /** ChangeRequest.Analysis (stored text or the parsed analysis). */
  analysis: unknown;
}

export interface CodeArea {
  /** The repo key ("api", "web"); "" when the analysis named none (any repo). */
  repo: string;
  /** Repo-relative; a folder ends in "/". */
  path: string;
}

/** What a build touches: the files and folders it changes (its code areas, else the paths its planned tickets name),
 *  the data tables it names, the change it belongs to; a build that names no code (`known` false) and a milestone build
 *  (`exclusive`) run alone. */
export interface Footprint {
  /** The change request (or milestone) it belongs to: two builds of the same change never run side by side. */
  chain: string;
  code: string;
  areas: CodeArea[];
  /** The data tables it names (schema files, tables named in the analysis or its tickets), lower case. */
  tables: string[];
  /** Where its areas come from: the analysis's code areas, the paths its tickets name, or nothing. */
  from: "analysis" | "tickets" | "none";
  known: boolean;
  exclusive: boolean;
  /** The product's merge-friendly files (registry streams.merge_friendly) it was made with: never shared code. */
  friendly?: readonly CodeArea[];
}

/** A glob or a folder written without its "/": the folder it stands for ("src/purchases/*" -> "src/purchases/"). */
function normalPath(raw: string): string {
  const p = raw.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/[),.;:'"`”’]+$/, "");
  const glob = p.search(/[*?[{]/);
  if (glob < 0) return p;
  const cut = p.slice(0, glob);
  return cut.includes("/") ? cut.slice(0, cut.lastIndexOf("/") + 1) : "";
}

/** "api: src/invoices/" -> { repo: "api", path: "src/invoices/" }; a path without a repo key names any repo (pure). */
export function codeAreaOf(text: string): CodeArea | null {
  const t = text.trim().replace(/\\/g, "/");
  if (!t) return null;
  const m = /^([A-Za-z0-9_.-]{1,40})\s*:\s*(.*)$/.exec(t);
  const repo = m ? m[1]!.toLowerCase() : "";
  const raw = normalPath((m ? m[2]! : t).trim().replace(/\s+.*$/, ""));
  if (!raw || raw.split("/").includes("..")) return repo ? { repo, path: "" } : null;
  return { repo, path: raw };
}

/** Folders a bare path in a ticket usually starts with (a path like "and/or" is no code). */
const CODE_TOPS = new Set(["src", "test", "tests", "app", "lib", "blocks", "scripts", "pages", "components", "server", "client", "public", "docs", "migrations", "db", "prisma", "e2e", "packages", "config"]);

/** The paths a ticket's words name (pure): "api: src/x.ts", "api/src/x.ts" (a repo key first), "src/x.ts", a folder
 *  "src/purchases/". Never a web address. */
export function pathsIn(text: string, repoKeys: readonly string[]): CodeArea[] {
  const keys = new Set(repoKeys.map((k) => k.toLowerCase()));
  const out: CodeArea[] = [];
  const re = /(?:^|[\s(`'"“‘[])((?:([A-Za-z0-9_.-]{1,40}):\s*)?([A-Za-z0-9_.*-]+(?:\/[A-Za-z0-9_.*{}-]+)+\/?))/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 8), (m.index ?? 0) + 1);
    if (/[a-z]+:\/\/?$/i.test(before) || /:\/\//.test(m[1]!)) continue;
    let repo = (m[2] ?? "").toLowerCase();
    let p = normalPath(m[3]!);
    const segs = p.split("/");
    if (!repo && segs.length > 1 && keys.has(segs[0]!.toLowerCase())) {
      repo = segs[0]!.toLowerCase();
      p = segs.slice(1).join("/");
    }
    const first = p.split("/")[0]!.toLowerCase();
    const looksLikeCode = /\.[A-Za-z0-9]{1,6}$/.test(p) || p.endsWith("/") || CODE_TOPS.has(first);
    if (!p || p.split("/").includes("..") || (!repo && !looksLikeCode) || (repo && !looksLikeCode && !p.includes("/"))) continue;
    out.push({ repo, path: p });
  }
  return out;
}

/** A schema file of the data tables ("blocks/data/schemas/Membership.json") -> its table, lower case. */
const SCHEMA_FILE = /(?:^|\/)schemas?\/([A-Za-z][A-Za-z0-9_-]{1,60})\.(?:json|ya?ml|sql|prisma|ts)$/i;
/** "the Membership table", "schema Membership", "table `Membership`". */
const TABLE_NAMED = [
  /\b([A-Z][A-Za-z0-9_]{2,60})\s+(?:table|schema)s?\b/g,
  /\b(?:table|schema)\s+[`'"“‘]?([A-Z][A-Za-z0-9_]{2,60})\b/g,
];
const NOT_A_TABLE = new Set(["the", "this", "that", "each", "every", "new", "one", "data", "blocks", "its", "their", "our", "your", "same", "any", "all", "existing", "database", "gateway", "dev"]);

/** The data tables a text and some code areas name, lower case (pure). */
export function tablesIn(texts: readonly string[], areas: readonly CodeArea[]): string[] {
  const out = new Set<string>();
  for (const a of areas) {
    const m = SCHEMA_FILE.exec(a.path);
    if (m) out.add(m[1]!.toLowerCase());
  }
  for (const t of texts) {
    for (const re of TABLE_NAMED) {
      for (const m of t.matchAll(re)) {
        const name = m[1]!.toLowerCase();
        if (!NOT_A_TABLE.has(name)) out.add(name);
      }
    }
    for (const m of t.matchAll(/[A-Za-z0-9_./-]*schemas?\/[A-Za-z][A-Za-z0-9_-]{1,60}\.(?:json|ya?ml|sql|prisma|ts)\b/gi)) {
      const f = SCHEMA_FILE.exec(m[0]);
      if (f) out.add(f[1]!.toLowerCase());
    }
  }
  return [...out].sort();
}

export const areaText = (a: CodeArea): string => (a.repo ? `${a.repo}: ${a.path || "(all of it)"}` : a.path);

/** The change request's code ("CR-007", "FX-3"). */
export const changeCodeOf = (c: Pick<StreamChange, "lane" | "number">): string => changeCode(c);

const dedupe = (areas: CodeArea[]): CodeArea[] => [...new Map(areas.map((a) => [`${a.repo}:${a.path}`, a])).values()];

/** What a change's build touches, from its approved analysis (pure): its code areas, else the paths its planned tickets
 *  name; the data tables either names. No analysis, or no path anywhere: unknown, it runs alone. `repoKeys`: the
 *  product's repo keys, so "api/src/x.ts" in a ticket is the api repo's (repoKeysOf). */
/** A folder area: "" (the whole repo), ending in "/", or a last segment without an extension ("src/routes"). */
const isFolder = (p: string): boolean => p === "" || p.endsWith("/") || !/\.[A-Za-z0-9]{1,6}$/.test(p.split("/").at(-1) ?? "");

/** A folder the analysis names, narrowed to the files its tickets name inside it ("api: src/routes/" and a ticket's
 *  "api/src/routes/workingTime.ts" -> that file); a folder no ticket names a file in stays the folder (pure). */
export function narrowAreas(areas: readonly CodeArea[], ticketPaths: readonly CodeArea[]): CodeArea[] {
  const files = ticketPaths.filter((t) => !isFolder(t.path));
  return dedupe(areas.flatMap((a) => {
    if (!isFolder(a.path)) return [a];
    const inside = files.filter((f) => (!a.repo || !f.repo || f.repo === a.repo) && within(f.path, a.path))
      .map((f) => ({ repo: a.repo || f.repo, path: f.path }));
    return inside.length ? inside : [a];
  }));
}

/** The product's merge-friendly files ("api: src/rbac.ts") as code areas. */
export const friendlyAreas = (entries: readonly string[]): CodeArea[] => entries.map(codeAreaOf).filter((x): x is CodeArea => x !== null && x.path !== "");

/** What a change's build touches, from its approved analysis (pure): its code areas (a folder narrowed to the files its
 *  tickets name inside it), else the paths its planned tickets name; the data tables either names. No analysis, or no
 *  path anywhere: unknown. `repoKeys`: the product's repo keys, so "api/src/x.ts" in a ticket is the api repo's
 *  (repoKeysOf); `friendly`: the product's merge-friendly files (productFriendly), never shared code. */
export function footprintOf(change: StreamChange | null, o: { chain?: string; exclusive?: boolean; code?: string; repoKeys?: readonly string[]; friendly?: readonly string[] } = {}): Footprint {
  const chain = o.chain ?? change?.id ?? "";
  const code = o.code ?? (change ? changeCodeOf(change) : "a build");
  if (o.exclusive) return { chain, code, areas: [], tables: [], from: "none", known: false, exclusive: true };
  const a: ChangeAnalysis | null = change ? parseChangeAnalysis(change.analysis) : null;
  const own = dedupe((a?.codeAreas ?? []).map(codeAreaOf).filter((x): x is CodeArea => x !== null));
  const ticketTexts = (a?.tickets ?? []).map((t) => `${t.title}\n${t.description}`);
  const ticketPaths = dedupe(ticketTexts.flatMap((t) => pathsIn(t, o.repoKeys ?? repoKeysOf(null))));
  const areas = own.length ? narrowAreas(own, ticketPaths) : ticketPaths;
  const texts = a ? [a.summary, ...a.acceptanceCriteria, ...ticketTexts] : [];
  const friendly = friendlyAreas(o.friendly ?? []);
  return {
    chain, code, areas, tables: tablesIn(texts, areas),
    from: own.length ? "analysis" : ticketPaths.length ? "tickets" : "none",
    known: areas.length > 0, exclusive: false,
    ...(friendly.length ? { friendly } : {}),
  };
}

/** Why two builds may not run side by side; null when they are independent. */
export type Overlap =
  | { kind: "same-change" }
  | { kind: "exclusive" }
  | { kind: "unknown"; mine: boolean }
  | { kind: "table"; table: string }
  | { kind: "code"; area: string };

/** `a` is `b`, or inside the folder `b` ("" is the whole repo; a folder named without its "/" counts too). */
const within = (a: string, b: string): boolean => a === b || b === "" || a.startsWith(b.endsWith("/") ? b : `${b}/`);

/** Two code areas share code: the same file, or one is inside the other's folder (in the same repo, or a repo neither
 *  names) (pure). */
export function areasMeet(a: CodeArea, b: CodeArea): boolean {
  if (a.repo && b.repo && a.repo !== b.repo) return false;
  return within(a.path, b.path) || within(b.path, a.path);
}

/** Files that merge without harm when two changes both touch them: tests (test/**, tests/**, e2e/**, __tests__/**,
 *  *.test.*, *.spec.*), the changes' records (docs/changes/**) and translations (i18n/**, the JSON under locales/). The
 *  merge turn rebases each stream onto what landed, runs the gates again and builds a stream once more on a conflict,
 *  so sharing these never makes a change wait (pure). */
export function mergeFriendly(path: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  return /^(?:tests?|e2e)(?:\/|$)/i.test(p)
    || /(?:^|\/)__tests__(?:\/|$)/i.test(p)
    || /\.(?:test|spec)\.[A-Za-z0-9]{1,5}$/i.test(p)
    || /^docs\/changes(?:\/|$)/i.test(p)
    || /(?:^|\/)i18n(?:\/|$)/i.test(p)
    || /(?:^|\/)locales?\/(?:.*\/)?[^/]*\.json$/i.test(p)
    || /(?:^|\/)locales?\/?$/i.test(p);
}

/** The areas that make changes wait for each other: all but the merge-friendly ones (pure). */
export const sourceAreas = (areas: readonly CodeArea[], friendly: readonly CodeArea[] = []): CodeArea[] =>
  areas.filter((a) => !mergeFriendly(a.path) && !friendly.some((f) => (!f.repo || !a.repo || f.repo === a.repo) && within(a.path, f.path)));

/** Why `a` may not run beside `b` (pure): the same change, a milestone build, a build that names no code, the same data
 *  table, or the same source files or folders (tests, change records and translations merge without harm: never a
 *  reason to wait). Changing data in general is no overlap. */
export function overlapOf(a: Footprint, b: Footprint): Overlap | null {
  if (a.chain && a.chain === b.chain) return { kind: "same-change" };
  if (a.exclusive || b.exclusive) return { kind: "exclusive" };
  if (!a.known || !b.known) return { kind: "unknown", mine: !a.known };
  // the product's merge-friendly files: those of either side (they are the product's, the same list)
  const friendly = [...(a.friendly ?? []), ...(b.friendly ?? [])];
  const theirs = sourceAreas(b.areas, friendly);
  for (const x of sourceAreas(a.areas, friendly)) {
    const hit = theirs.find((y) => areasMeet(x, y));
    if (hit) return { kind: "code", area: areaText(x.path.length >= hit.path.length ? x : hit) };
  }
  const table = a.tables.find((t) => b.tables.includes(t));
  if (table) return { kind: "table", table };
  return null;
}

/** "Membership" as people read a table's name (the analysis's own spelling when it is known). */
const tableWord = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Why a build waits for `other` (its code), in plain words (pure). */
export function overlapWords(o: Overlap, other: string): string {
  switch (o.kind) {
    case "same-change": return `the next build of the same change follows it`;
    case "exclusive": return `${other} builds alone`;
    case "unknown": return o.mine ? "its analysis names no code areas" : `${other} runs alone, its analysis names no code areas`;
    case "table": return `both change the ${tableWord(o.table)} table`;
    case "code": return `both change ${o.area}`;
  }
}

// ------------------------------------------------------------------ the plan

/** A delivery job as the streams read it (a row's fields, or the web's EngineJob). */
export interface StreamJob {
  id: string;
  kind: string;
  status: string;
  inputJson: string | null;
  createdAt: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
}

export interface RunningStream {
  jobId: string;
  /** The change request (or milestone) it builds. */
  targetId: string;
  code: string;
  title: string;
  /** Its stream: 1..; stable while it runs (streamNumbers). */
  stream: number;
  /** It shares code or a table with a build that started before it: "Developing in parallel; lands after CR-018 (both
   *  change api: src/projects/entries.ts — will be rebased and checked again)." ("" when it shares nothing). */
  note: string;
}

/** A queued build: it starts now (a stream is free and nothing running shares what it changes), or it waits. */
export interface QueuedStream {
  jobId: string;
  targetId: string;
  code: string;
  title: string;
  /** starting: the engine starts it now; waiting: for `behind` (its code), or for a free stream (null). */
  state: "starting" | "waiting";
  behind: string | null;
  overlap: Overlap | null;
  /** The one line the queue, the change's page and the job show: "Waits for CR-020: both change api: src/session.ts." */
  words: string;
}

/** A queued build that waits (the plan's `waiting`). */
export type WaitingStream = QueuedStream & { state: "waiting" };

export interface StreamPlan {
  /** Streams in use. */
  limit: number;
  running: RunningStream[];
  /** Queued builds that start now, in order (their ids are `startable`). */
  starting: QueuedStream[];
  waiting: WaitingStream[];
  /** The queued builds that may start now, in order. */
  startable: string[];
}

const inputOf = (raw: string | null | undefined): Record<string, unknown> => objectOf(raw ?? "") ?? {};
const targetOf = (j: Pick<StreamJob, "kind" | "inputJson">): string => {
  const i = inputOf(j.inputJson);
  const id = j.kind === "build.run" ? i.milestoneId : i.changeRequestId;
  return typeof id === "string" ? id : "";
};
const time = (v: string | null | undefined): number => {
  const t = Date.parse(v ?? "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** Each started build's stream (pure): a replay of the builds' claims and ends, where a build takes the lowest stream no
 *  build running at its start holds. Stable for a running build (its past does not change). */
export function streamNumbers(jobs: readonly StreamJob[]): Map<string, number> {
  const started = jobs
    .filter((j) => STREAM_KINDS.includes(j.kind) && j.claimedAt && j.status !== "queued")
    .map((j) => ({ id: j.id, start: time(j.claimedAt), end: ACTIVE.has(j.status) ? Number.POSITIVE_INFINITY : time(j.finishedAt ?? j.claimedAt) }))
    .filter((j) => Number.isFinite(j.start))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  let live: { end: number; n: number }[] = [];
  for (const j of started) {
    live = live.filter((x) => x.end > j.start);
    let n = 1;
    while (live.some((x) => x.n === n)) n += 1;
    live.push({ end: j.end, n });
    out.set(j.id, n);
  }
  return out;
}

/** The line of a queued build that starts now. */
export const STARTING_WORDS = "Starting: develops in parallel; it lands on development in its turn.";

/** Which builds run in which stream, which start now and which wait, and for what (pure). Queued builds start in the
 *  order they were asked for, as long as a stream is free and they share nothing with a running build or an earlier
 *  waiting one. `repoKeys`: the product's repo keys (repoKeysOf). */
export function planStreams(o: { jobs: readonly StreamJob[]; changes: readonly StreamChange[]; limit: number; repoKeys?: readonly string[]; friendly?: readonly string[] }): StreamPlan {
  const limit = clampStreams(o.limit);
  const byId = new Map(o.changes.map((c) => [c.id, c]));
  const active = o.jobs.filter((j) => STREAM_KINDS.includes(j.kind) && ACTIVE.has(j.status));
  const view = (j: StreamJob) => {
    const target = targetOf(j);
    const change = j.kind === "change.build" ? byId.get(target) ?? null : null;
    const fp = j.kind === "build.run"
      ? footprintOf(null, { chain: target, exclusive: true, code: "the milestone build" })
      : footprintOf(change, { chain: target, code: change ? changeCodeOf(change) : "a change build", repoKeys: o.repoKeys, friendly: o.friendly });
    return { job: j, target, fp, title: change?.title ?? "" };
  };
  const numbers = streamNumbers(o.jobs);
  const runningViews = active.filter((j) => j.status !== "queued").map(view)
    .sort((a, b) => time(a.job.claimedAt) - time(b.job.claimedAt) || a.job.id.localeCompare(b.job.id));
  const queued = active.filter((j) => j.status === "queued").map(view)
    .sort((a, b) => time(a.job.createdAt) - time(b.job.createdAt) || a.job.id.localeCompare(b.job.id));
  const admitted: typeof queued = [];
  const waiting: (WaitingStream & { fp: Footprint })[] = [];
  for (const q of queued) {
    // optimistic parallel development: only the streams, the same change and a milestone build hold a start; shared
    // code only means the later one lands after it, rebased and checked again
    const ahead = [...runningViews, ...admitted];
    const blocker = ahead.map((r) => ({ r, o: holdOf(q.fp, r.fp) })).find((x) => x.o);
    const earlier = blocker ? null : waiting.map((w) => ({ w, o: holdOf(q.fp, w.fp) })).find((x) => x.o);
    const base = { jobId: q.job.id, targetId: q.target, code: q.fp.code, title: q.title, state: "waiting" as const, fp: q.fp };
    if (blocker) {
      waiting.push({ ...base, behind: blocker.r.fp.code, overlap: blocker.o, words: `Waits for ${blocker.r.fp.code}: ${overlapWords(blocker.o!, blocker.r.fp.code)}.` });
    } else if (earlier) {
      waiting.push({ ...base, behind: earlier.w.code, overlap: earlier.o, words: `Waits for ${earlier.w.code}, asked for earlier: ${overlapWords(earlier.o!, earlier.w.code)}.` });
    } else if (ahead.length >= limit) {
      waiting.push({ ...base, behind: null, overlap: null, words: limit === 1 ? "Waits for a free stream: one build at a time." : `Waits for a free stream: all ${limit} are busy.` });
    } else {
      admitted.push(q);
    }
  }
  let free = 1;
  const taken = new Set(runningViews.map((r) => numbers.get(r.job.id)).filter((n): n is number => typeof n === "number"));
  const next = (): number => {
    while (taken.has(free)) free += 1;
    taken.add(free);
    return free;
  };
  // in the order they started: what each shares with one that started before it (it lands after that one)
  const started = [...runningViews, ...admitted];
  const noteOf = (i: number): string => {
    for (let k = 0; k < i; k += 1) {
      const ov = overlapOf(started[i]!.fp, started[k]!.fp);
      if (ov && (ov.kind === "code" || ov.kind === "table")) return landsAfterWords(started[k]!.fp.code, ov);
    }
    return "";
  };
  const running: RunningStream[] = runningViews.map((r, i) => ({ jobId: r.job.id, targetId: r.target, code: r.fp.code, title: r.title, stream: numbers.get(r.job.id) ?? next(), note: noteOf(i) }));
  const starting: QueuedStream[] = admitted.map((a, i) => {
    const note = noteOf(runningViews.length + i);
    return {
      jobId: a.job.id, targetId: a.target, code: a.fp.code, title: a.title, state: "starting", behind: null, overlap: null,
      words: note ? `Starting: ${note.charAt(0).toLowerCase()}${note.slice(1)}` : STARTING_WORDS,
    };
  });
  return {
    limit,
    running,
    starting,
    waiting: waiting.map(({ fp: _fp, ...w }) => w),
    startable: admitted.map((a) => a.job.id),
  };
}

/** What holds the START of a build (optimistic parallel development): another build of the same change, or a milestone
 *  build. Shared code never does: the later one lands after the earlier, rebased and checked again (pure). */
export function holdOf(a: Footprint, b: Footprint): Overlap | null {
  if (a.chain && a.chain === b.chain) return { kind: "same-change" };
  if (a.exclusive || b.exclusive) return { kind: "exclusive" };
  return null;
}

/** "Developing in parallel; lands after CR-018 (both change api: src/projects/entries.ts — will be rebased and checked
 *  again)." (pure). */
export function landsAfterWords(other: string, o: Overlap): string {
  return `Developing in parallel; lands after ${other} (${overlapWords(o, other)} — will be rebased and checked again).`;
}

/** The line of one queued build in the plan ("" when the plan does not hold it) (pure). */
export function queuedWords(plan: StreamPlan, jobId: string): string {
  return [...plan.starting, ...plan.waiting].find((q) => q.jobId === jobId)?.words ?? "";
}

// ------------------------------------------------------------------ the suggestion and the choice

export interface StreamsSuggestion {
  /** 1..MAX_STREAMS. */
  suggested: number;
  /** One plain line. */
  reason: string;
  /** What the engine host allows (MAX_STREAMS without advice). */
  cap: number;
}

/** Before the build host has looked at the product's set-up (no advice yet), and the floor of every suggestion while
 *  the set-up allows it: a safe start. */
export const SAFE_START = 2;

/** Change requests whose builds are approved or on their way: what the suggestion counts. */
const QUEUED_CHANGES = new Set(["approved", "building"]);

/** How many of the approved or building change requests touch separate code right now: the most of them that share
 *  nothing (the same rule as the plan; one whose analysis names no code counts only alone) (pure). */
export function independentChanges(changes: readonly StreamChange[], repoKeys?: readonly string[], friendly?: readonly string[]): number {
  const fps = changes.filter((c) => QUEUED_CHANGES.has(c.status) && parseChangeAnalysis(c.analysis) !== null)
    .sort((a, b) => a.number - b.number)
    .map((c) => footprintOf(c, { repoKeys, friendly }));
  const picked: Footprint[] = [];
  for (const fp of [...fps.filter((f) => f.known), ...fps.filter((f) => !f.known)]) {
    if (!picked.some((p) => overlapOf(fp, p))) picked.push(fp);
  }
  return picked.length;
}

/** The tech lead's suggestion (pure): as many streams as the approved or building change requests that touch separate
 *  code right now, at least SAFE_START, never above what the product's set-up allows (the advice; SAFE_START before the
 *  build host checked it). "4 approved changes touch separate code; the environment allows 5." What a waiting change
 *  shares with a running one is said per change (planStreams), never as a lower cap. */
export function suggestStreams(o: { changes?: readonly StreamChange[]; advice: StreamsAdvice | null; repoKeys?: readonly string[] }): StreamsSuggestion {
  const cap = o.advice ? clampStreams(o.advice.cap, MAX_STREAMS) : SAFE_START;
  if (cap === 1) return { suggested: 1, cap, reason: o.advice?.why || "The product's set-up allows one build at a time." };
  const k = independentChanges(o.changes ?? [], o.repoKeys ?? repoKeysOf(o.advice), productFriendly(o.advice));
  const suggested = Math.min(cap, Math.max(SAFE_START, k));
  const why = (o.advice?.why ?? "").replace(/[.;\s]+$/, "");
  const env = !o.advice ? `the build host has not checked the product's set-up yet, so ${cap} for now`
    : k > cap && why ? `the environment allows ${cap} (${why.charAt(0).toLowerCase()}${why.slice(1)})` : `the environment allows ${cap}`;
  const reason = k >= SAFE_START ? `${k} approved changes touch separate code; ${env}.`
    : `${k === 0 ? "No approved change waits" : "One approved change waits"} right now; ${SAFE_START} is a safe start, and ${env}.`;
  return { suggested, reason, cap };
}

/** The suggestion a page shows while it is open (pure): the one it showed until a higher one comes or the cap changes,
 *  so it never flaps while builds start and end. */
export function heldSuggestion(shown: StreamsSuggestion | null, now: StreamsSuggestion): StreamsSuggestion {
  return !shown || shown.cap !== now.cap || now.suggested > shown.suggested ? now : shown;
}

export interface StreamOption {
  n: number;
  /** Shown as "suggested". */
  suggested: boolean;
  disabled: boolean;
  /** Why it cannot be picked ("" when it can). */
  why: string;
}

/** The 1..5 control (pure): the options above the suggestion are disabled with a plain reason, except the person's own
 *  saved choice (never shown as "above the suggestion"); a person who may not choose sees every option disabled. */
export function streamOptions(s: Pick<StreamsSuggestion, "suggested" | "cap">, canChoose: boolean, chosen?: number): StreamOption[] {
  return Array.from({ length: MAX_STREAMS }, (_x, i) => {
    const n = i + 1;
    const above = n > s.suggested && n !== chosen;
    const why = !canChoose ? "Only people who run builds or edit the business context choose this."
      : !above ? "" : n > s.cap ? "The product's set-up does not allow this many yet." : `Above the tech lead's suggestion of ${s.suggested}.`;
    return { n, suggested: n === s.suggested, disabled: !!why, why };
  });
}

/** Whether a new change build (or a fix round, a revert, the steps after a deploy) may be asked for now (pure): while a
 *  milestone builds, with one stream while any build runs, or while another build of the same change is on its way, it
 *  may not ("delivery.build.active"); otherwise it is queued and the engine starts it when the plan lets it. */
export function mayQueueBuild(o: { jobs: readonly Pick<StreamJob, "kind" | "status" | "inputJson">[]; limit: number; targetId: string }): { ok: true } | { ok: false; messageKey: "delivery.build.active" } {
  const active = o.jobs.filter((j) => STREAM_KINDS.includes(j.kind) && ACTIVE.has(j.status));
  if (!active.length) return { ok: true };
  if (o.limit <= 1 || active.some((j) => j.kind === "build.run") || active.some((j) => targetOf(j) === o.targetId)) {
    return { ok: false, messageKey: "delivery.build.active" };
  }
  return { ok: true };
}

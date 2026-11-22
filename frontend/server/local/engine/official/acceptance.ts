// A change's own checks on the development environment, as the LAST step after a deploy. A repo whose registry entry
// has an `acceptance:` section (engine MADP/QUICK-LANE.md "Live acceptance on the deployed environment") gets its live
// tests run against dev after deploy and smoke. The lanes would run them right after their smoke test, BEFORE the
// Factory's own steps after a deploy; a change's tests may need its new data tables (or texts). So for such a product:
//
//   1. the lane runs with `--no-accept` (when the installed official engine has it: engineAccepts);
//   2. the data tables (dataTables.ts), then the texts (uilm.ts);
//   3. `madp accept --project <registry> --env dev --repo <key> --commit <deployed commit>` for each repo the work
//      changed, in deploy order, with the same project folder, Blocks store and report folder (reports/accept) as every
//      lane (runLane). Exit 0 is ok (or nothing to run), 12 failed tests or fixtures, 13 not judged (nothing failed,
//      but a test could not start on the engine host, the environment was not ready, a limit such as invitations per
//      hour left no room, or the step's time ran out), 3 (preflight: no address for a placeholder, the test accounts folder missing) or anything else: the checks
//      could not run. The engine waits for the deployed app to be ready, runs the change's own tests and the existing
//      ones that cover the changed code, and writes a structured result next to its report (`result   <path>` on
//      stdout, schema madp-accept-result/1): per file why it ran, and the checks that failed or could not judge, with a
//      short redacted reason. An older engine has no such file: then the step line is read.
//
// No outcome is a failed build: the code is live and nothing is rolled back. It is the job's attention
// (afterDeploy.ts; accept-failed with "<failed>/<files>" or "fixtures", accept-not-run with "setup", "ready", "limit", "time" or
// nothing). A lane that ran the checks itself anyway (an older registry, a lane without `--no-accept`) and did not pass
// them throws LaneAttention (build.ts): its steps say the same, and the build still runs its data tables and texts.
// What is open is kept in accept.json ("open", by job, with the checks and, when known, only the files still open), so
// "Finish the steps after the deploy" (a job with { afterDeploy: true }) runs those checks again.
//
// Fair on a long-lived product (09.11.2026, PrimaBook CR-006/CR-007): the engine reports a file that fails the same way
// as before the change as "known before this change" (AcceptOutcome.known: never the change's failure, never a fix
// round's target, always shown); the Factory names the change's other commits (`--change-commit`: a fix round's base
// build and earlier rounds, never "before"), hands a person's marks (`--known`) and, after a fix round, the round's
// result (`--passed-in-round`): what its recheck passed on exactly the deployed commit is counted, not run again.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { storeOf } from "./blocksLogin.ts";
import { deployOrder, parseRegistry, registryRepos, type RegistryRepo } from "./hostRegistry.ts";
import { officialHome, runLane, stepFamily, type LaneOptions, type LaneResult, type LaneStep } from "./madp.ts";
import { commitsIn } from "./uilm.ts";
import { LaneAttention, type WorkResult } from "./build.ts";
import { acceptFailedFact, acceptNotRunLine, type AcceptCheck, type AcceptKnown, type AfterDeployDetails, type AfterDeployIssue } from "../../../../src/domain/afterDeploy";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One repo the checks run in, at the commit the work deployed there. `only`: just these test files (what an earlier
 *  run left open on that commit), with why they were selected then. */
export interface AcceptTarget {
  key: string;
  commit: string;
  only?: string[];
  why?: Record<string, string>;
  /** A fix round's live tests of this repo that must pass too (`madp accept --also`), also when the work did not
   *  change them. A retry with `only` runs exactly what was left open instead. */
  also?: string[];
  /** The change's other commits (its base build, earlier rounds): never "before this change" (`--change-commit`). */
  change?: string[];
}

/** not-judged: nothing failed, but the environment did not let every check judge the change (not ready, a limit, out
 *  of time); open like not-run, never a pass. */
export type AcceptStatus = "none" | "ok" | "failed" | "not-run" | "not-judged";
/** Why checks could not judge the change: a test could not start on the engine host (a file, module or setting it
 *  needs is missing there), a fixture a test uses was not prepared, a service of the environment refused (its mail
 *  service), the environment was not ready, a limit had no room, the step's time ran out. */
export type Unjudged = "" | "setup" | "fixture" | "service" | "ready" | "limit" | "time";

/** One test file that ran (or was to run), and why it was selected. "known": it still fails as before the change. */
export interface AcceptTest {
  repo: string;
  file: string;
  verdict: "ok" | "failed" | "not-judged" | "known";
  why: string;
  /** Not run again: "passed in the round on <commit>". */
  reused?: string;
}

export interface AcceptOutcome {
  status: AcceptStatus;
  /** The line for the tickets and the job ("" when nothing ran). */
  line: string;
  /** The repos checked, and those whose checks could not run. */
  repos: string[];
  notRun: string[];
  /** Test files that failed, and that ran, over every repo. */
  failed: number;
  files: number;
  /** A repo's test data could not be prepared, so no test ran there. */
  fixtures: boolean;
  targets: AcceptTarget[];
  /** Test files that could not judge the change, and why (the strongest reason over every repo). */
  notJudged: number;
  unjudged: Unjudged;
  /** The checks that failed or could not judge the change (file, short redacted reason, why it ran, a limit). */
  checks: AcceptCheck[];
  /** Every test file and why it ran (the change's own, or an existing one that covers the changed code). */
  tests: AcceptTest[];
  /** The checks that still fail as before the change (or a person marked so): reported apart, never the change's. */
  known: AcceptKnown[];
}

export const NO_CHECKS: AcceptOutcome = { status: "none", line: "", repos: [], notRun: [], failed: 0, files: 0, fixtures: false, targets: [], notJudged: 0, unjudged: "", checks: [], tests: [], known: [] };

/** The repos whose registry entry checks a change on `env` (its `acceptance.envs`, default the registry's default_env),
 *  in deploy order (pure). */
export function acceptanceRepos(data: Row, env = "dev"): RegistryRepo[] {
  const repos = rec(data.repos);
  const fallback = text(data.default_env) || "dev";
  return deployOrder(registryRepos(data)).filter((r) => {
    const acc = rec(repos[r.key]).acceptance;
    if (!acc || typeof acc !== "object" || Array.isArray(acc)) return false;
    const envs = Array.isArray(rec(acc).envs) ? (rec(acc).envs as unknown[]).map((e) => String(e).trim()) : [fallback];
    return envs.includes(env);
  });
}

/** True when the installed official engine has `madp accept` and the lanes' `--no-accept`, so the Factory can run the
 *  checks after its own steps; an older engine has no acceptance step at all (the Factory and the engine can be
 *  updated in either order). */
export function engineAccepts(home = officialHome()): boolean {
  try {
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    if (!fs.existsSync(path.join(cli, "accept.py"))) return false;
    return ["quick.py", "feature.py"].every((f) => fs.readFileSync(path.join(cli, f), "utf8").includes('"--no-accept"'));
  } catch {
    return false;
  }
}

/** True when the installed official engine's `madp accept` takes `--also` (a fix round's live checks). */
export function engineAcceptsAlso(home = officialHome()): boolean {
  return engineAcceptOptions(home).also;
}

/** The options the installed official engine's `madp accept` knows (the Factory and the engine can be updated in either
 *  order): `--also`, and the baseline's `--change-commit`, `--known` and `--passed-in-round`. */
export function engineAcceptOptions(home = officialHome()): { also: boolean; changeCommit: boolean; known: boolean; passedInRound: boolean } {
  try {
    const src = fs.readFileSync(path.join(home, "MADP", "orchestrator", "cli", "accept.py"), "utf8");
    return { also: src.includes('"--also"'), changeCommit: src.includes('"--change-commit"'), known: src.includes('"--known"'), passedInRound: src.includes('"--passed-in-round"') };
  } catch {
    return { also: false, changeCommit: false, known: false, passedInRound: false };
  }
}

const execGit = promisify(execFile);

/** The commit dev runs for a repo a work did not change (the engine's live_debug_ops.deployed_head): origin/<branch> as
 *  last fetched, else HEAD of the clone; "" when neither resolves. */
async function deployedHead(r: Pick<RegistryRepo, "path" | "branch">): Promise<string> {
  for (const ref of [`origin/${r.branch || "dev"}`, "HEAD"]) {
    try {
      const out = (await execGit("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: r.path, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
      if (out) return out;
    } catch {
      /* not there */
    }
  }
  return "";
}

/** The commits of `shas` that are commits of the repo (full ids, in the given order; no ordering by ancestry). */
async function existingIn(repoPath: string, shas: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of new Set(shas.filter((x) => /^[0-9a-f]{7,40}$/i.test(x)))) {
    try {
      const full = (await execGit("git", ["rev-parse", "--verify", "--quiet", `${s}^{commit}`], { cwd: repoPath, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
      if (full && !out.includes(full)) out.push(full);
    } catch {
      /* not a commit of this repo */
    }
  }
  return out;
}

/** Why a live check ran (the engine's acceptance_ops.LIVE_CHECK). */
const LIVE_CHECK = "a live test this fix round must make pass";

/** The repos to check after this work: every repo with an acceptance section for dev that the work's commits changed,
 *  at its newest commit of the work, in deploy order; a repo's live checks of the work (WorkResult.liveChecks,
 *  "<repo>:<path>") go with it as `also`. A repo with live checks that the work did not change (a fix round that
 *  fixed the cause elsewhere) is checked too: exactly those tests (`only`), on the code dev runs (its deployed head),
 *  so a test that failed is never left unchecked. */
export async function acceptTargets(app: Pick<OfficialApp, "registry">, work: { commits: string[]; liveChecks?: string[] }, change: string[] = []): Promise<AcceptTarget[]> {
  let data: Row;
  try {
    data = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  } catch {
    return [];
  }
  const out: AcceptTarget[] = [];
  for (const r of acceptanceRepos(data)) {
    if (!r.path || !fs.existsSync(path.join(r.path, ".git"))) continue;
    const commits = await commitsIn(r.path, work.commits);
    const also = (work.liveChecks ?? []).filter((x) => x.startsWith(`${r.key}:`)).map((x) => x.slice(r.key.length + 1));
    const mine = change.length ? (await existingIn(r.path, change)).filter((c) => c !== commits[0]) : [];
    const other = mine.length ? { change: mine.slice(0, 40) } : {};
    if (commits[0]) out.push({ key: r.key, commit: commits[0], ...(also.length ? { also } : {}), ...other });
    else if (also.length) {
      const head = await deployedHead(r);
      if (head) out.push({ key: r.key, commit: head, only: also, why: Object.fromEntries(also.map((f) => [f, LIVE_CHECK])), ...other });
    }
  }
  return out;
}

interface Part {
  key: string;
  status: Exclude<AcceptStatus, "none"> | "none";
  failed: number;
  files: number;
  fixtures: boolean;
  notJudged?: number;
  unjudged?: Unjudged;
  checks?: AcceptCheck[];
  tests?: AcceptTest[];
  /** The files of this repo still open after the run (failed or not judged), when the engine said which. */
  open?: string[];
  known?: AcceptKnown[];
}

const unjudgedOf = (text: string): Unjudged =>
  (/could not start/i.test(text) ? "setup" : /fixture[^;)]*not prepared/i.test(text) ? "fixture" : /service[^;)]*refused/i.test(text) ? "service" : /time ran out/i.test(text) ? "time" : /limit/i.test(text) ? "limit" : /not ready|did not answer|no answer/i.test(text) ? "ready" : "");

/** One `accept[<repo>]` step line's outcome (acceptance_ops.AcceptanceResult.outcome) as counts (pure). */
export function readAcceptStep(key: string, outcome: string): Part {
  const o = outcome.trim();
  const part: Part = { key, status: "ok", failed: 0, files: 0, fixtures: false };
  if (/^nothing to run\b/i.test(o)) return { ...part, status: "none" };
  // nothing failed, but the environment did not let every check judge the change ("not judged": never a pass)
  if (/^not judged\b/i.test(o)) {
    const n = /^not judged: (\d+) of (\d+) file/i.exec(o);
    return { ...part, status: "not-judged", files: n ? Number(n[2]) : 0, notJudged: n ? Number(n[1]) : 0, unjudged: unjudgedOf(o) || "ready" };
  }
  const ok = /^ok: (\d+) file/i.exec(o);
  if (ok) return { ...part, files: Number(ok[1]) };
  if (!/\bfail/i.test(o)) return part;
  const bad = /FAILED: (\d+) of (\d+) file/i.exec(o);
  const open = /; (\d+) not judged \(([^)]*)\)/i.exec(o);
  return {
    ...part, status: "failed", failed: bad ? Number(bad[1]) : 0, files: bad ? Number(bad[2]) : 0, fixtures: /fixtures could not be prepared/i.test(o),
    ...(open ? { notJudged: Number(open[1]), unjudged: unjudgedOf(open[2]!) } : {}),
  };
}

const VERDICTS = new Set(["ok", "failed", "not-judged", "known"]);
const clip = (v: unknown, n: number): string => text(v).replace(/\s+/g, " ").slice(0, n);

/** One repo of the engine's structured result (madp-accept-result/1, acceptance_ops.AcceptanceResult.data) as a part;
 *  null when it is not one (pure). */
export function readAcceptResult(key: string, raw: unknown): Part | null {
  const r = rec(raw);
  const status = text(r.status);
  if (!["ok", "failed", "not-judged", "none"].includes(status)) return null;
  const repo = text(r.repo) || key;
  const files = (Array.isArray(r.files) ? r.files : []).map(rec).filter((f) => text(f.file));
  const notRun = (Array.isArray(r.not_run) ? r.not_run : []).map(rec).filter((f) => text(f.file));
  const tests: AcceptTest[] = [
    ...files.map((f) => ({ repo, file: clip(f.file, 200), verdict: (VERDICTS.has(text(f.verdict)) ? text(f.verdict) : "failed") as AcceptTest["verdict"], why: clip(f.why, 240), ...(text(f.reused) ? { reused: clip(f.reused, 120) } : {}) })),
    ...notRun.map((f) => ({ repo, file: clip(f.file, 200), verdict: "not-judged" as const, why: clip(f.why, 240) })),
  ].slice(0, 60);
  const checks: AcceptCheck[] = (Array.isArray(r.checks) ? r.checks : []).map(rec).filter((c) => text(c.verdict) !== "known").slice(0, 50).map((c) => ({
    repo, file: clip(c.file, 200), verdict: text(c.verdict) === "failed" ? "failed" : "not-judged", reason: clip(c.reason, 300), why: clip(c.why, 240), limit: clip(c.limit, 80),
  }));
  const known: AcceptKnown[] = (Array.isArray(r.known) ? r.known : []).map(rec).filter((k) => text(k.file)).slice(0, 50).map((k) => ({
    repo, file: clip(k.file, 200), reason: clip(k.reason, 300), evidence: clip(k.evidence, 300), by: text(k.by) === "person" ? "person" : "history", why: clip(k.why, 240),
  }));
  const failed = tests.filter((t) => t.verdict === "failed").length;
  const judgedNot = tests.filter((t) => t.verdict === "not-judged").length;
  const u = text(r.unjudged);
  const fixtures = status === "failed" && /^FAILED/.test(text(r.fixtures));
  // a run that tested files leaves only the files still open for a retry (a known one is not open: it is not the
  // change's); one stopped before them (readiness, test data) runs everything again
  const open = files.length ? tests.filter((t) => t.verdict !== "ok" && t.verdict !== "known").map((t) => t.file) : undefined;
  return {
    key: repo, status: status as Part["status"], failed, files: files.length + notRun.length, fixtures,
    notJudged: judgedNot, unjudged: (["setup", "fixture", "service", "ready", "limit", "time"].includes(u) ? u : judgedNot || status === "not-judged" ? "ready" : "") as Unjudged,
    checks, tests, ...(open ? { open } : {}), ...(known.length ? { known } : {}),
  };
}

/** The structured result `madp accept` wrote (its `result   <path>` line), when it is a file in `reportDir`; else null. */
export function engineResult(stdout: string, reportDir: string): Row | null {
  const m = /^result\s+(\S.*\.json)\s*$/m.exec(stdout);
  if (!m) return null;
  const file = path.resolve(m[1]!.trim());
  const dir = path.resolve(reportDir);
  if (path.dirname(file) !== dir) return null;
  try {
    const data = rec(JSON.parse(fs.readFileSync(file, "utf8")));
    return text(data.schema) === "madp-accept-result/1" ? data : null;
  } catch {
    return null;
  }
}

// the one that needs a person first: a test that could not start does not start by itself on a retry, a service of the
// environment that refused needs someone to bring it back
const UNJUDGED_ORDER: Unjudged[] = ["setup", "fixture", "service", "ready", "limit", "time"];

/** The outcome of the checks of every repo (pure). */
export function acceptOutcome(parts: Part[], targets: AcceptTarget[]): AcceptOutcome {
  const ran = parts.filter((p) => p.status !== "none");
  const failed = parts.filter((p) => p.status === "failed");
  const notRun = parts.filter((p) => p.status === "not-run").map((p) => p.key);
  const unjudgedParts = parts.filter((p) => p.status === "not-judged" || (p.notJudged ?? 0) > 0);
  const sum = (k: "failed" | "files") => parts.reduce((n, p) => n + p[k], 0);
  const status: AcceptStatus = failed.length ? "failed" : notRun.length ? "not-run" : unjudgedParts.length ? "not-judged" : ran.length ? "ok" : "none";
  const unjudged = UNJUDGED_ORDER.find((u) => unjudgedParts.some((p) => (p.unjudged || "ready") === u)) ?? "";
  const tests = parts.flatMap((p) => p.tests ?? []);
  const base = {
    repos: [...new Set(parts.map((p) => p.key).filter(Boolean))], notRun, failed: sum("failed"), files: sum("files"), fixtures: failed.some((p) => p.fixtures),
    targets: targets.map((t) => narrowed(t, parts.find((p) => p.key === t.key), tests)),
    notJudged: parts.reduce((n, p) => n + (p.notJudged ?? 0), 0), unjudged: unjudgedParts.length ? unjudged || "ready" : ("" as Unjudged),
    checks: parts.flatMap((p) => p.checks ?? []).slice(0, 50), tests: tests.slice(0, 60),
    known: parts.flatMap((p) => p.known ?? []).slice(0, 50),
  };
  const d = acceptDetails({ status, failed: base.failed, files: base.files, fixtures: base.fixtures, notRun, unjudged: base.unjudged });
  const mine = tests.filter((t) => t.verdict !== "known");
  const own = mine.filter((t) => t.why === OWN_TEST).length;
  // a fix round's live check is neither the change's own test nor one that covers the changed code
  const covering = mine.length - own - mine.filter((t) => t.why === LIVE_CHECK).length;
  const passed = base.files - base.known.length;
  const reused = tests.filter((t) => t.reused).length;
  // known before this change: said with checks that passed (the tickets get the line); with checks that did not pass,
  // the change's page and the report list them beside the failures (the job's message stays about what is the change's)
  const known = base.known.length ? ` ${plural(base.known.length, "check")} still ${base.known.length === 1 ? "fails" : "fail"} as before this change (not this change's): ${base.known.slice(0, 3).map((k) => k.file).join(", ")}${base.known.length > 3 ? " …" : ""}.` : "";
  // a failure: the fact only and never "delivered" (what happens next, a fix round, development put back or a person,
  // is the build's to say: kinds/delivery.ts)
  const line = status === "failed" ? `The change is on dev, but not usable yet. ${acceptFailedFact(d["accept-failed"])}`
    : status === "not-run" || status === "not-judged" ? `The change is on dev, but ${lower(acceptNotRunLine(d["accept-not-run"]))}`
      : status === "ok" ? `The change's own checks on the development environment passed (${plural(passed, "test file")}${covering > 0 && mine.length === passed ? `, ${covering} of them existing tests that cover the changed code` : ""}${reused ? `, ${reused} passed in the fix round on the deployed commit and were not run again` : ""}).${known}` : "";
  return { status, line, ...base };
}

/** The engine's words for a test file that is the change's own (acceptance_ops.OWN_TEST). */
const OWN_TEST = "the change's own test";
const lower = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** A target narrowed to the files its run left open (for a retry on the same commit), when the engine said which. */
function narrowed(t: AcceptTarget, p: Part | undefined, tests: AcceptTest[]): AcceptTarget {
  if (!p?.open?.length) return t;
  const why = Object.fromEntries(tests.filter((x) => x.repo === p.key && p.open!.includes(x.file) && x.why).map((x) => [x.file, x.why]));
  return { key: t.key, commit: t.commit, only: p.open.slice(0, 50), ...(Object.keys(why).length ? { why } : {}) };
}

/** The job's attention from the checks (pure): accept-failed when a check did not pass, accept-not-run when a repo's
 *  checks could not run or some could not judge the change (both can be open at once). */
export function acceptIssues(a: Pick<AcceptOutcome, "status" | "notRun"> & Partial<Pick<AcceptOutcome, "notJudged" | "unjudged">>): AfterDeployIssue[] {
  const out: AfterDeployIssue[] = [];
  if (a.status === "failed") out.push("accept-failed");
  if (a.notRun.length || a.status === "not-judged" || (a.notJudged ?? 0) > 0 || (a.status === "failed" && a.unjudged)) out.push("accept-not-run");
  return out;
}

/** The details the job's ErrorCode carries: accept-failed "<failed>/<files>" test files, else "fixtures";
 *  accept-not-run why nothing could be judged ("setup", "ready", "limit", "time"), none when a repo's checks could not run at
 *  all (pure). */
export function acceptDetails(a: Pick<AcceptOutcome, "status" | "failed" | "files" | "fixtures"> & Partial<Pick<AcceptOutcome, "notRun" | "unjudged">>): AfterDeployDetails {
  const out: AfterDeployDetails = {};
  if (a.status === "failed") {
    if (a.failed > 0 && a.files > 0) out["accept-failed"] = `${a.failed}/${a.files}`;
    else if (a.fixtures) out["accept-failed"] = "fixtures";
  }
  if (a.unjudged && !(a.notRun ?? []).length) out["accept-not-run"] = a.unjudged;
  return out;
}

/** The checks a lane ran itself (its accept[<repo>] steps), when it stopped with exit 12 (LaneAttention) (pure). */
export function acceptFromLane(steps: LaneStep[], targets: AcceptTarget[]): AcceptOutcome {
  const parts = steps.filter((s) => stepFamily(s.name) === "accept").map((s) => readAcceptStep(/\[([^\]]+)\]/.exec(s.name)?.[1] ?? "", s.outcome));
  const out = acceptOutcome(parts, targets);
  // exit 12 said they did not pass (failed, or could not judge the change), whatever else the lines show
  return out.status === "failed" || out.status === "not-judged" ? out
    : acceptOutcome([...parts, { key: targets[0]?.key ?? "", status: "failed", failed: 0, files: 0, fixtures: false }], targets);
}

// ------------------------------------------------------------------ the record (accept.json in the product folder)

interface AcceptRecord {
  schema: "madp-accept-after-deploy/1";
  /** By job id: the checks a job could not get through (and what they said), for "Finish the steps after the deploy". */
  open: Record<string, { targets: AcceptTarget[]; status: AcceptStatus; at: string; checks?: AcceptCheck[] }>;
  last?: { at: string; job: string; status: AcceptStatus; repos: string[]; failed: number; files: number; notJudged?: number; checks?: AcceptCheck[]; tests?: AcceptTest[]; known?: AcceptKnown[] };
}

const recordFile = (app: Pick<OfficialApp, "dir">): string => path.join(app.dir, "accept.json");
const MAX_OPEN = 50;

export function readAcceptRecord(app: Pick<OfficialApp, "dir">): AcceptRecord {
  try {
    const r = rec(JSON.parse(fs.readFileSync(recordFile(app), "utf8")));
    return { schema: "madp-accept-after-deploy/1", open: rec(r.open) as AcceptRecord["open"], ...(r.last ? { last: r.last as AcceptRecord["last"] } : {}) };
  } catch {
    return { schema: "madp-accept-after-deploy/1", open: {} };
  }
}

const SAFE_FILE = /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))[^\s,]{1,200}$/;

/** The checks an earlier job could not get through (null: it had none open); a target's `only` keeps repo-relative
 *  file names only (they go to `madp accept --only`). */
export function openAcceptTargets(app: Pick<OfficialApp, "dir">, jobId: string): AcceptTarget[] | null {
  const e = readAcceptRecord(app).open[jobId];
  if (!e || !Array.isArray(e.targets)) return null;
  return e.targets.filter((t) => text(t?.key) && text(t?.commit)).map((t) => {
    const only = Array.isArray(t.only) ? t.only.filter((f): f is string => typeof f === "string" && SAFE_FILE.test(f)).slice(0, 50) : [];
    const why = Object.fromEntries(Object.entries(rec(t.why)).filter(([f, w]) => only.includes(f) && typeof w === "string").map(([f, w]) => [f, clip(w, 240)]));
    const also = Array.isArray(t.also) ? t.also.filter((f): f is string => typeof f === "string" && SAFE_FILE.test(f)).slice(0, 50) : [];
    const change = Array.isArray(t.change) ? t.change.filter((c): c is string => typeof c === "string" && /^[0-9a-f]{7,40}$/i.test(c)).slice(0, 40) : [];
    return { key: text(t.key), commit: text(t.commit), ...(only.length ? { only } : {}), ...(only.length && Object.keys(why).length ? { why } : {}), ...(also.length ? { also } : {}), ...(change.length ? { change } : {}) };
  });
}

/** What a job's checks said that did not pass or could not judge the change: the ones it left open, else (its last
 *  run) the ones of the newest run when that was this job; [] when none are known. */
export function acceptChecksOf(app: Pick<OfficialApp, "dir">, jobId: string): AcceptCheck[] {
  const r = readAcceptRecord(app);
  const checks = r.open[jobId]?.checks ?? (r.last?.job === jobId ? r.last.checks : undefined);
  return Array.isArray(checks) ? checks : [];
}

/** Keeps what this job's checks left open (by its id), so a later job can run them again. Never throws. */
export function recordAccept(run: Pick<JobRun, "id" | "iso" | "log">, app: Pick<OfficialApp, "dir">, a: AcceptOutcome): void {
  if (a.status === "none") return;
  try {
    const r = readAcceptRecord(app);
    const open = { ...r.open };
    if (acceptIssues(a).length) open[run.id] = { targets: a.targets, status: a.status, at: run.iso(), ...(a.checks.length ? { checks: a.checks } : {}) };
    const kept = Object.entries(open).sort((x, y) => String(y[1].at).localeCompare(String(x[1].at))).slice(0, MAX_OPEN);
    fs.mkdirSync(app.dir, { recursive: true });
    const f = recordFile(app);
    const last = { at: run.iso(), job: run.id, status: a.status, repos: a.repos, failed: a.failed, files: a.files, ...(a.notJudged ? { notJudged: a.notJudged } : {}), ...(a.checks.length ? { checks: a.checks } : {}), ...(a.tests.length ? { tests: a.tests } : {}), ...(a.known?.length ? { known: a.known } : {}) };
    const body: AcceptRecord = { schema: "madp-accept-after-deploy/1", open: Object.fromEntries(kept), last };
    fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(body, null, 2)}\n`);
    fs.renameSync(`${f}.tmp`, f);
  } catch (e) {
    run.log(`acceptance after deploy: the record could not be written (${String(e).slice(0, 120)})`);
  }
}

// ------------------------------------------------------------------ the run

export type AcceptLane = (run: JobRun, args: string[], o: LaneOptions) => Promise<LaneResult>;

export interface AcceptOptions {
  step?: (pct: number, line: string) => Promise<void>;
  pct?: number;
  /** The official lane runner (tests give a fake one). */
  lane?: AcceptLane;
  /** The installed engine's `madp accept` takes `--also` (default: engineAcceptsAlso()). */
  also?: boolean;
  /** The options of the installed engine's `madp accept` (default: engineAcceptOptions()). */
  options?: ReturnType<typeof engineAcceptOptions>;
  /** A person's "known before this change" marks of the change (`--known`). */
  known?: Array<{ repo: string; file: string; reason: string; commit?: string }>;
  /** A fix round's result (madp-fix-round/1): what its recheck passed on exactly the deployed commit is counted, not run
   *  again (`--passed-in-round`). */
  passedInRound?: string;
}

/** `madp accept` for each target, after the data tables and the texts. Never throws for a check that did not pass or
 *  could not run (the deploy stands); a stopped job still stops. */
export async function runAcceptance(run: JobRun, app: OfficialApp, targets: AcceptTarget[], o: AcceptOptions = {}): Promise<AcceptOutcome> {
  if (!targets.length) return NO_CHECKS;
  const lane = o.lane ?? runLane;
  let blocksConfigDir: string | undefined;
  try {
    blocksConfigDir = storeOf(parseRegistry(fs.readFileSync(app.registry, "utf8")), app.name, "dev");
  } catch {
    blocksConfigDir = undefined;
  }
  if (o.step) await o.step(o.pct ?? 96, "Checking the change on the development environment with its own tests and the existing tests that cover it.");
  const reportDir = path.join(app.dir, "reports", "accept");
  const parts: Part[] = [];
  const can = o.options ?? engineAcceptOptions();
  const also = o.also ?? can.also;
  // a person's marks go to the engine as a file of this job (repo-relative names and short reasons only)
  const marks = can.known && o.known?.length ? path.join(reportDir, `${run.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}.known.json`) : "";
  if (marks) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(marks, `${JSON.stringify({ known: o.known!.filter((m) => SAFE_FILE.test(m.file)).map((m) => ({ repo: m.repo, file: m.file, reason: clip(m.reason, 200), ...(m.commit ? { commit: m.commit } : {}) })) }, null, 2)}\n`);
  }
  const passedInRound = can.passedInRound && o.passedInRound && fs.existsSync(o.passedInRound) ? o.passedInRound : "";
  for (const t of targets) {
    let r: LaneResult;
    const only = t.only?.length ? ["--only", t.only.join(",")] : [];
    try {
      // a fix round's live checks run with the change's own tests; a retry (`only`) runs exactly what was left open
      const extra = also && t.also?.length && !t.only?.length ? ["--also", t.also.join(",")] : [];
      // the baseline: the change's other commits are never "before" it; a person's marks; what the round passed
      const baseline = [
        ...(can.changeCommit && t.change?.length ? ["--change-commit", t.change.join(",")] : []),
        ...(marks && o.known!.some((m) => m.repo === t.key) ? ["--known", marks] : []),
        ...(passedInRound ? ["--passed-in-round", passedInRound] : []),
      ];
      r = await lane(run, ["accept", "--project", app.registry, "--env", "dev", "--repo", t.key, "--commit", t.commit, ...only, "--report-dir", reportDir, ...extra, ...baseline], {
        projectDir: app.dir, label: "accept", timeoutMs: 65 * 60_000, ...(blocksConfigDir ? { blocksConfigDir, blocksTenant: app.tenant } : {}),
      });
    } catch (e) {
      if (run.signal?.aborted) throw e;
      run.log(`acceptance after deploy ${app.name} [${t.key}]: it could not start (${String((e as { code?: unknown }).code ?? (e as Error).name ?? "error")})`);
      parts.push({ key: t.key, status: "not-run", failed: 0, files: 0, fixtures: false });
      continue;
    }
    const step = r.steps.filter((s) => stepFamily(s.name) === "accept").at(-1);
    // the engine's structured result when it wrote one (the checks with their reasons), else its step line
    const data = r.code === 0 || r.code === 12 || r.code === NOT_JUDGED_EXIT ? engineResult(r.stdout, reportDir) : null;
    const fromData = data && Array.isArray(data.repos) ? readAcceptResult(t.key, (data.repos as unknown[]).find((x) => text(rec(x).repo) === t.key)) : null;
    const read = fromData ? withWhy(fromData, t) : step ? readAcceptStep(t.key, step.outcome) : null;
    if (r.code === 0) {
      parts.push(read ?? { key: t.key, status: "none", failed: 0, files: 0, fixtures: false });
    } else if (r.code === 12) {
      parts.push(read && read.status === "failed" ? read : { key: t.key, status: "failed", failed: 0, files: 0, fixtures: false });
    } else if (r.code === NOT_JUDGED_EXIT) {
      // nothing failed, but the environment did not let every check judge the change: open, never a pass
      parts.push(read && read.status === "not-judged" ? read : { key: t.key, status: "not-judged", failed: 0, files: 0, fixtures: false, unjudged: "ready" });
    } else {
      run.log(`acceptance after deploy ${app.name} [${t.key}]: madp accept exit ${r.code} (${r.code === 3 ? "preflight: an address or the test accounts folder is missing" : "it could not run"}); retry: madp accept --project ${path.basename(app.registry)} --repo ${t.key} --commit ${t.commit}`);
      parts.push({ key: t.key, status: "not-run", failed: 0, files: 0, fixtures: false });
    }
  }
  const out = acceptOutcome(parts, targets);
  recordAccept(run, app, out);
  run.log(`acceptance after deploy ${app.name}: ${out.status}${out.files ? ` (${out.failed} of ${out.files} test file(s) failed${out.notJudged ? `, ${out.notJudged} not judged: ${out.unjudged}` : ""}${out.known.length ? `, ${out.known.length} known before this change` : ""})` : ""}`);
  return out;
}

/** `madp accept`: nothing failed, but the environment did not let every check judge the change (cli/accept.py). */
export const NOT_JUDGED_EXIT = 13;

/** A retry's result (`--only`, selected as "given") with why each file was selected the first time (pure). */
function withWhy(p: Part, t: AcceptTarget): Part {
  if (!t.why) return p;
  const why = (w: string, file: string) => (!w || w === "given with --only" ? t.why?.[file] ?? w : w);
  return { ...p, tests: p.tests?.map((x) => ({ ...x, why: why(x.why, x.file) })), checks: p.checks?.map((c) => ({ ...c, why: why(c.why, c.file) })) };
}

/** The product checks changes on dev (a repo with an acceptance section for dev). */
export function productChecks(app: Pick<OfficialApp, "registry">): boolean {
  try {
    return acceptanceRepos(parseRegistry(fs.readFileSync(app.registry, "utf8"))).length > 0;
  } catch {
    return false;
  }
}

export interface LaneChecks {
  work: WorkResult;
  /** The last step after the deploy: the change's own checks on dev (absent: the product has none, or the engine cannot
   *  run them alone and the lane ran them itself and they passed). */
  accept?: () => Promise<AcceptOutcome>;
}

/**
 * The lane, with the change's own checks moved behind the Factory's steps after the deploy. `lane(noAccept)` runs the
 * official lane (runOfficialWork); `noAccept` is true when the product checks changes on dev and the installed engine
 * can run the checks alone (`checks`, default productChecks && engineAccepts). Then `accept` runs `madp accept` for the
 * repos the work changed. A lane that ran the checks itself anyway and failed them (exit 12: LaneAttention) is still a
 * deployed work: it answers its work, and `accept` answers what the lane's checks said (recorded for a retry), so the
 * data tables and texts still run and the job needs attention instead of failing.
 */
export async function laneWithChecks(
  run: JobRun,
  app: OfficialApp,
  lane: (noAccept: boolean) => Promise<WorkResult>,
  o: { checks?: boolean; changeCommits?: string[] } & AcceptOptions = {},
): Promise<LaneChecks> {
  const checks = o.checks ?? (productChecks(app) && engineAccepts());
  try {
    const work = await lane(checks);
    if (!checks) return { work };
    // a fix round's result: what its recheck passed on the deployed commit is counted, not run again
    const passedInRound = o.passedInRound ?? work.fixLoop?.result;
    return { work, accept: async () => runAcceptance(run, app, await acceptTargets(app, work, o.changeCommits ?? []), { ...o, ...(passedInRound ? { passedInRound } : {}) }) };
  } catch (e) {
    if (!(e instanceof LaneAttention)) throw e;
    run.log(`the lane deployed the work, but its own checks on dev did not pass or could not judge it (exit 12): the steps after the deploy run, the job needs attention`);
    const outcome = acceptFromLane(e.work.steps, await acceptTargets(app, e.work));
    return { work: e.work, accept: async () => { recordAccept(run, app, outcome); return outcome; } };
  }
}

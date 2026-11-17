/**
 * "Fix what the checks found": a change whose own checks failed after its deploy is NOT usable on that environment,
 * and it goes back to the development team as a FIX ROUND of the same change, instead of a person reading the report
 * and writing a new change request by hand. When the rounds do not make the checks pass, the environment is put back
 * to the last build whose checks passed (a REVERT), so it does not stay half-broken.
 *
 *   - The checks of every checked deploy of a change are recorded on the change (ChangeRequest.Checks, JSON version 1,
 *     written by the engine's change.build): where, when, which version and commits, how many test files failed, and
 *     the failing checks by name with a short reason (the full redacted output stays on the engine host, for the fix).
 *   - A fix round is a change.build of the same change with { fixChecks: true, afterJobId, baseJobId, round, auto,
 *     version }: its input is the change, the failing checks with their output, the deployed commits and the rule "fix
 *     the code, or the test where the test is wrong; nothing else changes". The same gates, deploy and checks run; it
 *     gets a patch version of its own and changes no status (an increment of a feature stays "approved", a change
 *     "released-dev").
 *   - A revert is a change.build with { revertChecks: true, afterJobId, baseJobId, auto, version }: the commits of the
 *     base build and its rounds are reverted on the environment's branch and deployed through the same lane (gates,
 *     deploy, checks); the change goes back to "approved" with its tickets open, ready to build again. It never touches
 *     staging or production (promotion only ever fast-forwards a tested dev commit).
 *   - Rounds belong to the build whose checks failed first (`baseJobId`). The project's policy (Project.ChecksPolicy,
 *     checksPolicyOf) says how many rounds the engine starts by itself (at most MAX_AUTO_FIX_ROUNDS per base build) and
 *     whether it reverts by itself once those did not help; otherwise, and after any round a person started, a person
 *     decides (cr.fixChecks).
 *
 * The record names its environment (`env`): today every check runs on dev after the deploy; a later per-change preview
 * environment can run the same checks before dev and record them the same way (only green builds then reach dev).
 *
 * Fair on a long-lived product (09.11.2026, PrimaBook CR-006 and CR-007, held back for hours by failures older than
 * them):
 *   - KNOWN BEFORE THIS CHANGE: a check that failed the same way before the change (the engine's history of the runs
 *     on the same environment) is recorded apart (ChecksRun.known, with its evidence): never the change's failure,
 *     never a fix round's target, always shown. A person can mark a failing check so on the change's page with a short
 *     reason (ChangeChecks.marks, op cr.markKnown): the same, from then on, for every build of the change (the engine
 *     gets the marks: `madp accept --known`), and the change's newest failing run counts without it (openFailing).
 *   - THE DIAGNOSIS BESIDE THE VERDICT: a fix round's diagnosis that puts a failing check in the environment with
 *     evidence is kept with the run (ChecksRun.diagnosed); the check stays failed (the test decides, never the model),
 *     the page shows both, and no further automatic round starts for it (fixTargets).
 *   - THE CHANGE'S COMMITS: the commits of the base build and its rounds (changeCommitsOf) are never "before this
 *     change" for the checks' baseline (`--change-commit`).
 *   - NOTHING TO CHANGE: a round whose engine finds that the checks that failed are the environment's (a fixture the
 *     checks did not prepare, a limit, a service; PrimaBook CR-007, 09.11.2026) changes and deploys nothing and ends
 *     normally ("nothing to change: the failing checks are the environment's (<reasons>); a person decides"), never a
 *     job failure. It is kept on the record with its reasons (ChecksRun.nothing) and is not one of the automatic
 *     rounds (sparedRounds): once the environment is fixed and the checks fail again, the engine may still start them.
 *
 * No imports: the server functions bundle this file.
 */

/** At most this many automatic fix rounds follow one build whose checks failed; then a person decides. */
export const MAX_AUTO_FIX_ROUNDS = 2;
/** A project without its own policy fixes automatically, up to the maximum. */
export const DEFAULT_AUTO_FIX_ROUNDS = MAX_AUTO_FIX_ROUNDS;

const MAX_FAILING = 20;
/** At most this many passed files are kept per run (a run checks the change's own tests and those covering its code). */
export const MAX_PASSED = 80;
const MAX_RUNS = 20;
const NAME_MAX = 160;
const REASON_MAX = 200;
/** ChangeRequest.Checks maxLength (blocks/data/validations.json). */
export const CHECKS_MAX_CHARS = 20_000;

/** One check (a live test file) that did not pass, by repo and name, with a short reason. */
export interface FailingCheck {
  repo: string;
  name: string;
  reason: string;
}

/** A check that still fails, but as it did before the change (the engine's baseline, by "history"), or that a person
 *  marked so ("person"): not the change's failure. */
export interface KnownCheck extends FailingCheck {
  /** Why it counts as known before this change, in words ("failed the same way before this change (on abc…)"). */
  evidence: string;
  by: "history" | "person";
}

/** A failing check a fix round's diagnosis puts in the environment, with its evidence (the check stays failed). */
export interface DiagnosedCheck {
  repo: string;
  name: string;
  side: "environment";
  cause: string;
  evidence: string[];
}

/** A person's "known before this change" mark on a failing check of the change (cr.markKnown). */
export interface KnownMark {
  repo: string;
  /** The test file. */
  name: string;
  /** Their short reason (at most MARK_REASON_MAX characters). */
  reason: string;
  byUserId: string;
  at: string;
  /** The build whose failing check was marked, and the commit it ran on there (the engine compares with that run). */
  jobId: string;
  commit: string;
}

export const MARK_REASON_MAX = 200;
const MAX_MARKS = 40;

/** What a checked deploy was: the change's own build (or an increment), a fix round, or a revert. */
export type ChecksRunKind = "build" | "fix" | "revert";

/** The checks after one deploy of the change. */
export interface ChecksRun {
  /** The change.build job that deployed and checked. */
  jobId: string;
  kind: ChecksRunKind;
  /** The environment the checks ran on ("dev"; a per-change preview later). */
  env: string;
  at: string;
  /** "not-judged": nothing failed, but the environment did not let every check judge the change (not ready, a limit,
   *  out of time); never a reason for a fix round. */
  status: "ok" | "failed" | "not-run" | "not-judged";
  /** The version that deploy got ("" when it had none). */
  version: string;
  /** The deployed commits (as the lane reported them). */
  commits: string[];
  /** Test files that failed, and that ran. */
  failed: number;
  files: number;
  /** The test data could not be prepared, so no test ran. */
  fixtures: boolean;
  failing: FailingCheck[];
  /** 0: the change's own build (an increment of a feature) or a revert; n: fix round n. */
  round: number;
  /** A fix round or a revert the engine started by itself. */
  auto: boolean;
  /** The build whose checks failed first (a fix round's or a revert's); "" for a build. */
  baseJobId: string;
  /** Checks that still fail as they did before the change (or a person marked so): not the change's (always set when
   *  read back). */
  known?: KnownCheck[];
  /** Failing checks the round's diagnosis put in the environment, with evidence (they stay failing ones; always set
   *  when read back). */
  diagnosed?: DiagnosedCheck[];
  /** A fix round that found nothing to change: why the checks that failed are the environment's (it deployed nothing;
   *  status "not-run"). */
  nothing?: string[];
  /** The test files that passed in this run, by repo and name (recorded since 09.11.2026; absent on older runs): what
   *  lets a later run of ANY change on the same environment show that a check another change left failing passes now
   *  (supersededChecks). */
  passed?: CheckFile[];
}

/** A check file by repo and name. */
export interface CheckFile {
  repo: string;
  name: string;
}

export interface ChangeChecks {
  v: 1;
  /** Every checked deploy of the change, oldest first (the newest MAX_RUNS). */
  runs: ChecksRun[];
  /** A person's "known before this change" marks. */
  marks?: KnownMark[];
}

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const STATUS = new Set(["ok", "failed", "not-run", "not-judged"]);
const KINDS = new Set(["build", "fix", "revert"]);

function failingOf(v: unknown): FailingCheck[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ repo: str(rec(x).repo, 40), name: str(rec(x).name, NAME_MAX), reason: str(rec(x).reason, REASON_MAX) }))
    .filter((f) => f.name)
    .slice(0, MAX_FAILING);
}

function knownOf(v: unknown): KnownCheck[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ repo: str(rec(x).repo, 40), name: str(rec(x).name, NAME_MAX), reason: str(rec(x).reason, REASON_MAX), evidence: str(rec(x).evidence, REASON_MAX), by: (rec(x).by === "person" ? "person" : "history") as KnownCheck["by"] }))
    .filter((f) => f.name)
    .slice(0, MAX_FAILING);
}

function diagnosedOf(v: unknown): DiagnosedCheck[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ repo: str(rec(x).repo, 40), name: str(rec(x).name, NAME_MAX), side: "environment" as const, cause: str(rec(x).cause, REASON_MAX), evidence: (Array.isArray(rec(x).evidence) ? (rec(x).evidence as unknown[]) : []).map((e) => str(e, REASON_MAX)).filter(Boolean).slice(0, 3) }))
    .filter((d) => d.name && d.evidence.length)
    .slice(0, MAX_FAILING);
}

function marksOf(v: unknown): KnownMark[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ repo: str(rec(x).repo, 40), name: str(rec(x).name, NAME_MAX), reason: str(rec(x).reason, MARK_REASON_MAX), byUserId: str(rec(x).byUserId, 128), at: str(rec(x).at, 40), jobId: str(rec(x).jobId, 128), commit: /^[0-9a-f]{7,40}$/.test(str(rec(x).commit, 40)) ? str(rec(x).commit, 40) : "" }))
    .filter((m) => m.name && m.reason)
    .slice(-MAX_MARKS);
}

function runOf(v: unknown): ChecksRun | null {
  const r = rec(v);
  const jobId = str(r.jobId, 128);
  const status = str(r.status, 10);
  if (!jobId || !STATUS.has(status)) return null;
  const kind = str(r.kind, 10);
  return {
    jobId,
    kind: KINDS.has(kind) ? (kind as ChecksRunKind) : "build",
    env: str(r.env, 20) || "dev",
    at: str(r.at, 40),
    status: status as ChecksRun["status"],
    version: str(r.version, 20),
    commits: Array.isArray(r.commits) ? r.commits.map((c) => str(c, 40)).filter((c) => /^[0-9a-f]{7,40}$/.test(c)).slice(0, 40) : [],
    failed: int(r.failed),
    files: int(r.files),
    fixtures: r.fixtures === true,
    failing: failingOf(r.failing),
    round: int(r.round),
    auto: r.auto === true,
    baseJobId: str(r.baseJobId, 128),
    known: knownOf(r.known),
    diagnosed: diagnosedOf(r.diagnosed),
    ...(nothingOf(r.nothing).length ? { nothing: nothingOf(r.nothing) } : {}),
    ...(passedOf(r.passed).length ? { passed: passedOf(r.passed) } : {}),
  };
}

function passedOf(v: unknown): CheckFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ repo: str(rec(x).repo, 40), name: str(rec(x).name, NAME_MAX) }))
    .filter((f) => f.name)
    .slice(0, MAX_PASSED);
}

function nothingOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, REASON_MAX)).filter(Boolean).slice(0, 6) : [];
}

/** The fix rounds of the record that found nothing to change (the checks that failed are the environment's), by job:
 *  they deployed nothing and are not one of the automatic rounds (pure). */
export function sparedRounds(c: ChangeChecks | null): Set<string> {
  return new Set((c?.runs ?? []).filter((r) => r.kind === "fix" && (r.nothing?.length ?? 0) > 0).map((r) => r.jobId));
}

/** The job's line of a fix round that found nothing to change, at most `max` characters (the reasons are cut at a word
 *  to fit): "CR-7 fix round 1: nothing to change: the failing checks are the environment's (…); a person decides." The
 *  change's page says how (pure). */
export function nothingLine(what: string, reasons: readonly string[], max = 200): string {
  const head = `${what}: nothing to change: the failing checks are the environment's (`;
  const tail = "); a person decides.";
  const all = reasons.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean).join("; ") || "the environment";
  const room = Math.max(0, max - head.length - tail.length);
  if (all.length <= room) return `${head}${all}${tail}`;
  const cut = all.slice(0, Math.max(0, room - 1));
  const word = cut.lastIndexOf(" ");
  return `${head}${(word > room / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:]+$/, "")}…${tail}`;
}

/** ChangeRequest.Checks read back; null when it is empty or unreadable (pure). */
export function parseChangeChecks(raw: unknown): ChangeChecks | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = rec(v);
  if (r.v !== 1 || !Array.isArray(r.runs)) return null;
  const runs = r.runs.map(runOf).filter((x): x is ChecksRun => x !== null).slice(-MAX_RUNS);
  const marks = marksOf(r.marks);
  return { v: 1, runs, ...(marks.length ? { marks } : {}) };
}

/** The record as stored: the newest runs that fit CHECKS_MAX_CHARS, the marks always kept (pure). */
export function serializeChangeChecks(c: ChangeChecks): string {
  const parsed = parseChangeChecks({ v: 1, runs: c.runs, marks: c.marks ?? [] }) ?? { v: 1, runs: [] };
  let runs = parsed.runs;
  const marks = parsed.marks?.length ? { marks: parsed.marks } : {};
  let out = JSON.stringify({ v: 1, runs, ...marks });
  // too long: the passed files of the oldest runs go first (a later run judges those files again), then the oldest runs
  for (let i = 0; out.length > CHECKS_MAX_CHARS && i < runs.length - 1; i += 1) {
    if (!runs[i]!.passed) continue;
    const { passed: _p, ...rest } = runs[i]!;
    runs = [...runs.slice(0, i), rest, ...runs.slice(i + 1)];
    out = JSON.stringify({ v: 1, runs, ...marks });
  }
  while (out.length > CHECKS_MAX_CHARS && runs.length > 1) {
    runs = runs.slice(1);
    out = JSON.stringify({ v: 1, runs, ...marks });
  }
  // too long with one run left: its lists are cut (the passed files first: the failing ones are what people act on)
  if (out.length > CHECKS_MAX_CHARS) out = JSON.stringify({ v: 1, runs: runs.map((r) => ({ ...r, failing: r.failing.slice(0, 5), known: (r.known ?? []).slice(0, 5), diagnosed: (r.diagnosed ?? []).slice(0, 5), ...(r.passed ? { passed: r.passed.slice(0, 20) } : {}) })), ...marks });
  return out;
}

/** The record with one more run (a run of the same job replaces its earlier one: a restarted job); the marks stay
 *  (pure). */
export function withRun(c: ChangeChecks | null, run: ChecksRun): ChangeChecks {
  const runs = (c?.runs ?? []).filter((r) => r.jobId !== run.jobId);
  return { v: 1, runs: [...runs, { ...run, known: run.known ?? [], diagnosed: run.diagnosed ?? [] }].slice(-MAX_RUNS), ...(c?.marks?.length ? { marks: c.marks } : {}) };
}

// ------------------------------------------------------------------ known before this change, the diagnosis

const sameCheck = (a: { repo: string; name: string }, b: { repo: string; name: string }): boolean => a.name === b.name && (!a.repo || !b.repo || a.repo === b.repo);

/** The record with a person's mark on a check (a mark of the same check replaces its earlier one) (pure). */
export function withMark(c: ChangeChecks | null, mark: KnownMark): ChangeChecks {
  const marks = [...(c?.marks ?? []).filter((m) => !sameCheck(m, mark)), { ...mark, reason: mark.reason.trim().slice(0, MARK_REASON_MAX) }];
  return { v: 1, runs: c?.runs ?? [], marks: marks.slice(-MAX_MARKS) };
}

/** The record without a person's mark on a check (pure). */
export function withoutMark(c: ChangeChecks | null, check: { repo: string; name: string }): ChangeChecks {
  const marks = (c?.marks ?? []).filter((m) => !sameCheck(m, check));
  return { v: 1, runs: c?.runs ?? [], ...(marks.length ? { marks } : {}) };
}

/** A person's mark on this check, if any (pure). */
export const markOf = (c: ChangeChecks | null, check: { repo: string; name: string }): KnownMark | null => (c?.marks ?? []).find((m) => sameCheck(m, check)) ?? null;

/** The failing checks of a run that are still the change's: without those a person marked known before this change,
 *  and how many failing test files that leaves (the run's count less the marked ones; at least the unmarked ones it
 *  names) (pure). */
export function openFailing(run: Pick<ChecksRun, "failing" | "failed">, marks: readonly KnownMark[] = []): { failing: FailingCheck[]; marked: FailingCheck[]; failed: number } {
  const marked = run.failing.filter((f) => marks.some((m) => sameCheck(m, f)));
  const failing = run.failing.filter((f) => !marked.includes(f));
  return { failing, marked, failed: Math.max(failing.length, run.failed - marked.length) };
}

/** What a run's failing checks leave for a fix round: the change's failing checks (openFailing) without the ones the
 *  round's diagnosis put in the environment with evidence (they stay failing; a person decides on them) (pure). */
export function fixTargets(run: Pick<ChecksRun, "failing" | "failed" | "diagnosed">, marks: readonly KnownMark[] = []): { failed: number; environment: DiagnosedCheck[] } {
  const open = openFailing(run, marks);
  const environment = (run.diagnosed ?? []).filter((d) => open.failing.some((f) => sameCheck(f, d)));
  return { failed: Math.max(0, open.failed - environment.length), environment };
}

/** True when every check that failed in the job's run is marked "known before this change" on the change (its stored
 *  Checks record, raw or parsed): the build's checks then leave nothing that is the change's (pure). */
export function checksCleared(raw: unknown, jobId: string): boolean {
  const record = typeof raw === "string" || raw === null || raw === undefined ? parseChangeChecks(raw ?? null) : parseChangeChecks(raw);
  const run = latestRun(record, jobId);
  if (!run || run.status !== "failed" || !record?.marks?.length || !run.failing.length) return false;
  return openFailing(run, record.marks).failed === 0;
}

// ------------------------------------------------------------------ checks that pass again on a later version
//
// A change's own checks are judged on the environment after its deploy, and the verdict stays with that run. Later
// changes may fix what it left failing: PrimaBook's CR-005 (tariff hierarchy) failed its tariff tests on 0.9.0 and
// 0.13.0, and the follow-up changes CR-008 to CR-015 fixed them until every one of them passed on 0.15.0; CR-005 and
// the follow-ups whose own runs had failed kept reading "not usable" and held back the promotion for hours. So a
// change's failing checks follow the NEWEST judged result of each failing file on the same environment, whichever
// change's run judged it: when every one of them has passed since (and not failed again), the change's checks pass
// on that environment since that version; its own failed run stays on its record and on its page. A file that was not
// judged again since, or failed again, keeps the change not usable; so does a run that does not name its failing files.

/** One judged result of a check file on an environment, from any change's checks record. */
export interface FileVerdict extends CheckFile {
  env: string;
  at: string;
  version: string;
  verdict: "passed" | "failed";
  /** The change whose run judged it, and that run's job. */
  changeId: string;
  jobId: string;
}

/** Every judged result of every check file in the project's change records (pure): a failing check (also one known
 *  before a change: it still fails) is "failed", a file the run names as passed is "passed". A run that could not run
 *  adds nothing; a run recorded without its passed files only adds its failures. */
export function fileVerdicts(changes: readonly { id: string; checks?: unknown }[]): FileVerdict[] {
  const out: FileVerdict[] = [];
  for (const c of changes) {
    for (const r of parseChangeChecks(c.checks ?? null)?.runs ?? []) {
      if (r.status === "not-run") continue;
      const add = (f: CheckFile, verdict: FileVerdict["verdict"]) =>
        out.push({ repo: f.repo, name: f.name, env: r.env, at: r.at, version: r.version, verdict, changeId: c.id, jobId: r.jobId });
      for (const f of r.failing) add(f, "failed");
      for (const k of r.known ?? []) add(k, "failed");
      for (const f of r.passed ?? []) add(f, "passed");
    }
  }
  return out;
}

/** Since when the checks a change's build left failing pass on its environment: the version, time, change and job of
 *  the run from which on every one of them passes, and each file with the run it passed again in. */
export interface ChecksPassSince {
  version: string;
  at: string;
  changeId: string;
  jobId: string;
  files: Array<CheckFile & { version: string; at: string; changeId: string; jobId: string }>;
}

const timeOf = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

/** Whether the checks the change's build `jobId` left failing (its run, without the checks a person marked known before
 *  this change) pass now on the same environment: the NEWEST judged result of each failing file after that run, from
 *  any change's run, is a pass. Answers since when all of them pass (for each file the first pass of its passes since
 *  its last failure; overall the latest of those), or null when one failed again or was not judged since, or when the
 *  run does not name every failing file (pure). */
export function checksPassSince(record: ChangeChecks | null, jobId: string, verdicts: readonly FileVerdict[]): ChecksPassSince | null {
  const run = latestRun(record, jobId);
  if (!run || run.status !== "failed") return null;
  const open = openFailing(run, record?.marks ?? []);
  if (!open.failing.length || open.failed > open.failing.length) return null;
  const after = timeOf(run.at);
  if (Number.isNaN(after)) return null;
  const files: ChecksPassSince["files"] = [];
  for (const f of open.failing) {
    const later = verdicts
      .filter((v) => v.env === run.env && sameCheck(v, f) && timeOf(v.at) > after)
      .sort((a, b) => timeOf(a.at) - timeOf(b.at));
    if (!later.length || later[later.length - 1]!.verdict !== "passed") return null;
    let i = later.length - 1;
    while (i > 0 && later[i - 1]!.verdict === "passed") i -= 1;
    const first = later[i]!;
    files.push({ repo: f.repo, name: f.name, version: first.version, at: first.at, changeId: first.changeId, jobId: first.jobId });
  }
  const last = files.reduce((a, b) => (timeOf(b.at) > timeOf(a.at) ? b : a));
  return { version: last.version, at: last.at, changeId: last.changeId, jobId: last.jobId, files };
}

/** The one rule for "the checks a change's build left failing are not the change's any more" (pure): every failing
 *  check is marked known before this change (checksCleared), or each passes since on a later version (checksPassSince,
 *  over every change's record). For changesNotUsable's `cleared`, so the Release page, the change pages, the team's
 *  messages, cr.startBuild and release.promote all read the same. */
export function checksSettled(changes: readonly { id: string; checks?: unknown }[]): (changeId: string, jobId: string) => boolean {
  const verdicts = fileVerdicts(changes);
  const byId = new Map(changes.map((c) => [c.id, c.checks ?? null]));
  return (changeId, jobId) => {
    const raw = byId.get(changeId) ?? null;
    return checksCleared(raw, jobId) || checksPassSince(parseChangeChecks(raw), jobId, verdicts) !== null;
  };
}

/** The commits of a change's base build and of its rounds before `beforeJobId` (all of them without it), as the
 *  record keeps them: never "before this change" for the checks' baseline (pure). */
export function changeCommitsOf(c: ChangeChecks | null, baseJobId: string, beforeJobId = ""): string[] {
  if (!c || !baseJobId) return [];
  const runs = c.runs.filter((r) => (r.jobId === baseJobId || r.baseJobId === baseJobId) && r.kind !== "revert");
  const upto = beforeJobId ? runs.findIndex((r) => r.jobId === beforeJobId) : -1;
  return [...new Set((upto >= 0 ? runs.slice(0, upto) : runs).flatMap((r) => r.commits))];
}

/** The newest run of the record, or of one job (pure). */
export function latestRun(c: ChangeChecks | null, jobId?: string): ChecksRun | null {
  const runs = c?.runs ?? [];
  for (let i = runs.length - 1; i >= 0; i -= 1) if (!jobId || runs[i]!.jobId === jobId) return runs[i]!;
  return null;
}

// ------------------------------------------------------------------ the policy

/** What the engine does by itself when a change's checks fail (Project.ChecksPolicy, JSON version 1). */
export interface ChecksPolicy {
  /** Fix rounds it starts by itself per failed build: 0 to MAX_AUTO_FIX_ROUNDS. */
  autoFixRounds: number;
  /** Put the environment back to the last build whose checks passed, by itself, once those rounds did not help. */
  autoRevert: boolean;
}

/** A project without its own policy: fix automatically up to the maximum, then put development back. */
export const DEFAULT_CHECKS_POLICY: ChecksPolicy = { autoFixRounds: DEFAULT_AUTO_FIX_ROUNDS, autoRevert: true };

/** Project.ChecksPolicy read back; the default for an empty or unreadable one (pure). */
export function checksPolicyOf(raw: unknown): ChecksPolicy {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      v = null;
    }
  }
  const r = rec(v);
  const n = r.autoFixRounds;
  const rounds = typeof n === "number" && Number.isInteger(n) && n >= 0 ? Math.min(MAX_AUTO_FIX_ROUNDS, n) : DEFAULT_CHECKS_POLICY.autoFixRounds;
  return { autoFixRounds: rounds, autoRevert: typeof r.autoRevert === "boolean" ? r.autoRevert : DEFAULT_CHECKS_POLICY.autoRevert };
}

/** The policy as stored (pure). */
export function serializeChecksPolicy(p: ChecksPolicy): string {
  const c = checksPolicyOf({ autoFixRounds: p.autoFixRounds, autoRevert: p.autoRevert });
  return JSON.stringify({ v: 1, autoFixRounds: c.autoFixRounds, autoRevert: c.autoRevert });
}

// ------------------------------------------------------------------ the rounds (from the jobs)

/** The fields of a job these rules read (the web's EngineJob and an op's rows map to it). */
export interface ChecksJob {
  id: string;
  kind: string;
  status: string;
  inputJson?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
}

export interface FixRoundInput {
  changeRequestId: string;
  /** The build whose failing checks this round fixes (the base build, or the round before). */
  afterJobId: string;
  /** The build whose checks failed first: its rounds are counted together. */
  baseJobId: string;
  round: number;
  auto: boolean;
  version: string;
}

function inputOf(json: string | null | undefined): Row {
  if (!json) return {};
  try {
    return rec(JSON.parse(json));
  } catch {
    return {};
  }
}

/** A fix round's input; null for any other job (pure). */
export function fixRoundOf(job: Pick<ChecksJob, "kind" | "inputJson"> | null | undefined): FixRoundInput | null {
  if (!job || job.kind !== "change.build") return null;
  const i = inputOf(job.inputJson);
  if (i.fixChecks !== true) return null;
  const afterJobId = str(i.afterJobId, 128);
  return {
    changeRequestId: str(i.changeRequestId, 128),
    afterJobId,
    baseJobId: str(i.baseJobId, 128) || afterJobId,
    round: int(i.round) || 1,
    auto: i.auto === true,
    version: str(i.version, 20),
  };
}

export const isFixRound = (job: Pick<ChecksJob, "kind" | "inputJson"> | null | undefined): boolean => fixRoundOf(job) !== null;

/** The input of a fix round (pure). */
export function fixRoundInput(projectId: string, f: FixRoundInput): Record<string, unknown> {
  return {
    projectId, changeRequestId: f.changeRequestId, fixChecks: true, afterJobId: f.afterJobId, baseJobId: f.baseJobId, round: f.round, auto: f.auto,
    ...(f.version ? { version: f.version } : {}),
  };
}

/** The base build of the build `after`: itself, unless it is a fix round or a revert (their base), or a job that ran
 *  the checks of an earlier deploy again ({ afterDeploy: true, afterJobId }: that deploy's base) (pure). */
export function baseJobOf(after: Pick<ChecksJob, "id" | "kind" | "inputJson">, jobs: readonly Pick<ChecksJob, "id" | "kind" | "inputJson">[] = [], depth = 0): string {
  const own = fixRoundOf(after)?.baseJobId || revertOf(after)?.baseJobId;
  if (own) return own;
  const i = inputOf(after.inputJson);
  const earlier = i.afterDeploy === true && typeof i.afterJobId === "string" ? jobs.find((j) => j.id === i.afterJobId && j.id !== after.id) : undefined;
  return earlier && depth < 10 ? baseJobOf(earlier, jobs, depth + 1) : after.id;
}

/** The fix rounds of one base build, by round (pure). */
export function roundsOf<J extends ChecksJob>(jobs: readonly J[], baseJobId: string): J[] {
  return jobs
    .filter((j) => fixRoundOf(j)?.baseJobId === baseJobId)
    .sort((a, b) => fixRoundOf(a)!.round - fixRoundOf(b)!.round);
}

export interface NextRound {
  round: number;
  baseJobId: string;
  afterJobId: string;
}

/** The next round after the build `after` whose checks failed (round numbers count every round of its base build,
 *  also one that stopped) (pure). */
export function nextRound(jobs: readonly ChecksJob[], after: Pick<ChecksJob, "id" | "kind" | "inputJson">): NextRound {
  const base = baseJobOf(after, jobs);
  const rounds = roundsOf(jobs, base).map((j) => fixRoundOf(j)!.round);
  return { round: (rounds.length ? Math.max(...rounds) : 0) + 1, baseJobId: base, afterJobId: after.id };
}

export type AutoDecision =
  | { start: true; next: NextRound }
  | { start: false; why: "policy-off" | "rounds-used" | "person-started" | "no-failing-tests" | "environment" };

/**
 * Whether the engine starts the next fix round itself after the build `after` whose checks failed with `failedFiles`
 * failing test files: only where the policy allows (`allowed` automatic rounds), only for test files that failed (test
 * data that could not be prepared, or checks that could not run, wait for a person), never after a round a person
 * started, and at most `allowed` automatic rounds per base build; a round in `spared` (it found nothing to change:
 * sparedRounds) is not one of them (pure).
 */
export function autoFixDecision(jobs: readonly ChecksJob[], after: Pick<ChecksJob, "id" | "kind" | "inputJson">, failedFiles: number, allowed: number, environment = 0, spared: ReadonlySet<string> = new Set()): AutoDecision {
  if (allowed <= 0) return { start: false, why: "policy-off" };
  // every failing test file is one the last round's diagnosis put in the environment: no automatic round for them
  if (failedFiles <= 0) return { start: false, why: environment > 0 ? "environment" : "no-failing-tests" };
  const next = nextRound(jobs, after);
  const rounds = roundsOf(jobs, next.baseJobId);
  if (rounds.some((j) => !fixRoundOf(j)!.auto)) return { start: false, why: "person-started" };
  // a round that found nothing to change (the checks that failed were the environment's) used none of them
  if (rounds.filter((j) => !spared.has(j.id)).length >= Math.min(allowed, MAX_AUTO_FIX_ROUNDS)) return { start: false, why: "rounds-used" };
  return { start: true, next };
}

// ------------------------------------------------------------------ the revert

export interface RevertInput {
  changeRequestId: string;
  /** The newest build whose checks failed (its record names what is reverted). */
  afterJobId: string;
  /** The build whose checks failed first: it and its rounds are reverted. */
  baseJobId: string;
  auto: boolean;
  version: string;
}

/** A revert's input; null for any other job (pure). */
export function revertOf(job: Pick<ChecksJob, "kind" | "inputJson"> | null | undefined): RevertInput | null {
  if (!job || job.kind !== "change.build") return null;
  const i = inputOf(job.inputJson);
  if (i.revertChecks !== true) return null;
  const afterJobId = str(i.afterJobId, 128);
  return { changeRequestId: str(i.changeRequestId, 128), afterJobId, baseJobId: str(i.baseJobId, 128) || afterJobId, auto: i.auto === true, version: str(i.version, 20) };
}

export const isRevert = (job: Pick<ChecksJob, "kind" | "inputJson"> | null | undefined): boolean => revertOf(job) !== null;

/** The input of a revert (pure). */
export function revertInput(projectId: string, r: RevertInput): Record<string, unknown> {
  return {
    projectId, changeRequestId: r.changeRequestId, revertChecks: true, afterJobId: r.afterJobId, baseJobId: r.baseJobId, auto: r.auto,
    ...(r.version ? { version: r.version } : {}),
  };
}

/** The jobs a revert undoes: the base build and every fix round of it, by when they were made (pure). */
export function redBuildsOf<J extends ChecksJob>(jobs: readonly J[], baseJobId: string): J[] {
  const base = jobs.find((j) => j.id === baseJobId);
  return [...(base ? [base] : []), ...roundsOf(jobs, baseJobId)];
}

/** What the engine does by itself after the build `after` whose checks failed. */
export type AfterChecks =
  | { action: "fix"; next: NextRound }
  | { action: "revert"; baseJobId: string }
  | { action: "wait"; why: "policy-off" | "rounds-used" | "person-started" | "no-failing-tests" | "environment" };

/** The fix round while the policy's rounds last; then, once automatic rounds were used and did not help, the revert
 *  when the policy allows it; else a person decides (pure). A revert that already ran for the base build is never
 *  started again. */
export function afterChecksDecision(jobs: readonly ChecksJob[], after: Pick<ChecksJob, "id" | "kind" | "inputJson">, failedFiles: number, policy: ChecksPolicy, environment = 0, spared: ReadonlySet<string> = new Set()): AfterChecks {
  const fix = autoFixDecision(jobs, after, failedFiles, policy.autoFixRounds, environment, spared);
  if (fix.start) return { action: "fix", next: fix.next };
  const base = baseJobOf(after, jobs);
  const reverted = jobs.some((j) => revertOf(j)?.baseJobId === base);
  if (fix.why === "rounds-used" && policy.autoRevert && !reverted) return { action: "revert", baseJobId: base };
  return { action: "wait", why: fix.why };
}

/** The rule every fix round follows (the lane's description and the page say it). */
export const FIX_RULE = "Fix the code, or the test where the test is wrong; nothing else changes.";

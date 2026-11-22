// What a change's own checks found after its deploy, for "Fix what the checks found" (src/domain/changeChecks.ts).
//
// The official engine writes every acceptance run as a markdown report (`madp accept` into reports/accept, a lane that
// ran the checks itself into reports/feature or reports/quick): acceptance_ops.report_lines, one section per repo,
// "### `<repo>` on <env>: FAILED ...", a table of the test files with their result, and the REDACTED output tail of
// each file that failed (every secret value and token-like string already replaced by the engine). This file reads
// those sections into failing checks:
//
//   - for the change's page: repo, name and a short reason (one line of the output, host paths and tokens taken out);
//   - for the fix round's developers: the same plus the output tail as the report has it.
//
// The interface is small on purpose (FoundCheck): when the acceptance step reports its failing checks as structured
// data, that source replaces the report reading here and nothing else changes. What a build's checks found is kept on
// the engine host by job (checks-found.json in the product folder), so a fix round or a revert started later reads the
// failing checks, the deployed commits and the repos of exactly that build.
import fs from "node:fs";
import path from "node:path";
import type { JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { FIX_RULE, type FailingCheck } from "../../../../src/domain/changeChecks";
import type { AcceptCheck } from "../../../../src/domain/afterDeploy";

/** A failing check with what its output said (redacted by the engine; at most OUTPUT_MAX characters). */
export interface FoundCheck extends FailingCheck {
  output: string;
  /** Why it ran (the acceptance step's own words: "the change's own test", "calls GET /api/x"); absent: not known. */
  why?: string;
}

const OUTPUT_MAX = 4000;
const REASON_MAX = 160;
const MAX_CHECKS = 20;

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// a host path ("/srv/madp/products/x/api/test/a.mjs:12:5", "C:\\work\\x") becomes its last part
const HOST_PATH = /(?:~\/|\/(?:srv|home|tmp|var|usr|opt|etc|root|mnt|private|Users|Volumes|workspace)\/)[^\s"'`)]*|\b[A-Za-z]:\\[^\s"'`)]*/g;
const TOKEN = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}(?:\.[\w-]+)?)|\bBearer\s+\S{8,}/g;
// a line that says what went wrong (node:test, TAP, vitest, jest, mocha, plain asserts)
const SAYS_WHY = /\bnot ok\b|[✗✖×]|\bAssertionError\b|\bexpected\b|\bError\b:|\bassert(?:ion)?\b|\bfailed\b|\bFAIL\b/i;
const NOISE = /^(?:#\s*(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b|at\s|\s*\^|[-=_*]{3,}$|\d+\s+(?:passed|failed|passing|failing)\b)/i;

/** One line of a test's output as people may read it: no colours, host paths shortened to their last part, tokens
 *  taken out, at most REASON_MAX characters (pure). */
export function plainReason(line: string): string {
  const flat = line
    .replace(ANSI, "")
    .replace(TOKEN, "[redacted]")
    .replace(HOST_PATH, (m) => m.split(/[\\/]/).filter(Boolean).pop() ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= REASON_MAX ? flat : `${flat.slice(0, REASON_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

/** The short reason of a failing test file from its output tail and counts (pure). */
export function reasonOf(output: string, o: { passed?: number | null; failed?: number | null; exit?: number | null } = {}): string {
  const lines = output.split(/\r?\n/).map((l) => l.replace(ANSI, "").trim()).filter((l) => l && !NOISE.test(l));
  const at = lines.findIndex((l) => SAYS_WHY.test(l) && !/^(?:ok|pass)\b/i.test(l));
  const counts = o.failed && o.passed !== null && o.passed !== undefined ? `${o.failed} of ${o.passed + o.failed} checks failed` : "";
  if (at >= 0) {
    // the failing test's name ("not ok 3 - creates an invoice"), then the first line after it that says why
    const head = lines[at]!.replace(/^(?:not ok \d+\s*-?\s*|[✗✖×]\s*)/i, "");
    const named = /^not ok\b|^[✗✖×]/i.test(lines[at]!);
    const detail = named ? lines.slice(at + 1, at + 8).find((l) => /\b(?:error|expected|assert(?:ion)?|received|actual)\b/i.test(l)) : undefined;
    const why = detail ? `${head}: ${detail.replace(/^(?:error|message)\s*:\s*/i, "").replace(/^['"]|['"]$/g, "")}` : head;
    return plainReason(counts ? `${counts}: ${why}` : why);
  }
  if (counts) return counts;
  return o.exit ? "the test file ended with an error" : "the test file did not pass";
}

const num = (s: string | undefined): number | null => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** The failing checks of an acceptance report (its "### `<repo>` on <env>: FAILED" sections; pure). */
export function failingChecksOfReport(md: string): FoundCheck[] {
  const out: FoundCheck[] = [];
  const lines = md.split(/\r?\n/);
  let repo = "";
  let failedSection = false;
  let sectionReason = "";
  const files = new Map<string, { passed: number | null; failed: number | null; exit: number | null }>();
  const tails = new Map<string, string>();
  let fixturesTail = "";
  const flush = () => {
    if (repo && failedSection) {
      const before = out.length;
      for (const [name, c] of files) {
        const output = (tails.get(name) ?? "").slice(-OUTPUT_MAX);
        out.push({ repo, name, reason: reasonOf(output, c), output });
      }
      if (out.length === before) {
        // no file failed on its own: the test data, or the run itself
        const fixtures = /fixtures/i.test(sectionReason) || !!fixturesTail;
        out.push({
          repo, name: fixtures ? "test data (fixtures)" : "the checks",
          reason: plainReason(sectionReason || (fixtures ? "the test data could not be prepared, so no test ran" : "the checks did not pass")),
          output: fixturesTail.slice(-OUTPUT_MAX),
        });
      }
    }
    repo = "";
    failedSection = false;
    sectionReason = "";
    files.clear();
    tails.clear();
    fixturesTail = "";
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const head = /^###\s+`([^`]+)`\s+on\s+\S+:\s*(.*)$/.exec(line);
    if (head) {
      flush();
      repo = head[1]!.trim();
      failedSection = /^FAILED\b/i.test(head[2]!.trim());
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      continue;
    }
    if (!repo) continue;
    const commitLine = /^- Commit: .*? — (.+)$/.exec(line);
    if (commitLine) sectionReason = commitLine[1]!.trim();
    const row = /^\|\s*`([^`]+)`\s*\|\s*(FAIL|ok)\s*\|\s*([\d-]+)\s*\|\s*([\d-]+)\s*\|\s*(-?\d+)\s*\|/.exec(line);
    if (row && row[2] === "FAIL") files.set(row[1]!, { passed: num(row[3]), failed: num(row[4]), exit: num(row[5]) });
    const tailHead = /^`([^`]+)` output \(tail, redacted\):$/.exec(line.trim());
    const fixturesHead = /^Fixtures output \(tail, redacted\):$/.test(line.trim());
    if ((tailHead || fixturesHead) && lines[i + 1]?.trim().startsWith("```")) {
      const body: string[] = [];
      let j = i + 2;
      for (; j < lines.length && !lines[j]!.trim().startsWith("```"); j += 1) body.push(lines[j]!);
      if (tailHead) tails.set(tailHead[1]!, body.join("\n"));
      else fixturesTail = body.join("\n");
      i = j;
    }
  }
  flush();
  return out.slice(0, MAX_CHECKS);
}

const REPORT_DIRS = ["accept", "quick", "feature"];

/** The acceptance reports written since `sinceMs` (madp accept's, and a lane's own when it ran the checks itself),
 *  oldest first. */
export function reportsSince(app: Pick<OfficialApp, "dir">, sinceMs: number): string[] {
  const found: Array<{ file: string; at: number }> = [];
  const walk = (dir: string, depth: number) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      const f = path.join(dir, d.name);
      if (d.isDirectory() && depth < 2) walk(f, depth + 1);
      else if (d.isFile() && d.name.endsWith(".md")) {
        try {
          const at = fs.statSync(f).mtimeMs;
          if (at >= sinceMs) found.push({ file: f, at });
        } catch {
          /* gone */
        }
      }
    }
  };
  for (const d of REPORT_DIRS) walk(path.join(app.dir, "reports", d), 0);
  return found.sort((a, b) => a.at - b.at).map((x) => x.file);
}

/** The failing checks the reports written since `sinceMs` name; for each repo the newest report that checked it wins
 *  (a later run of the same repo replaces an earlier one). Never throws. */
export function failingChecksSince(app: Pick<OfficialApp, "dir">, sinceMs: number): FoundCheck[] {
  const byRepo = new Map<string, FoundCheck[]>();
  for (const f of reportsSince(app, sinceMs)) {
    let md = "";
    try {
      md = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!md.includes("## Acceptance on the deployed environment")) continue;
    const checked = [...md.matchAll(/^###\s+`([^`]+)`\s+on\s+/gm)].map((m) => m[1]!.trim());
    const failing = failingChecksOfReport(md);
    for (const repo of checked) byRepo.set(repo, failing.filter((c) => c.repo === repo));
  }
  return [...byRepo.values()].flat().slice(0, MAX_CHECKS);
}

// ------------------------------------------------------------------ the record (checks-found.json in the product folder)

/** What one build's checks found, kept by its job id. */
export interface FoundEntry {
  at: string;
  /** The environment the checks ran on. */
  env: string;
  /** The commits the build deployed (as the lane reported them). */
  commits: string[];
  /** Each checked repo at the commit it was checked at. */
  targets: Array<{ key: string; commit: string }>;
  checks: FoundCheck[];
  /** What the acceptance step reported (AcceptOutcome.checks: the checks that failed and those that could not judge
   *  the change), as a fix round's lane takes it (WorkAsk.failedChecks); absent in entries kept before. */
  reported?: AcceptCheck[];
}

interface FoundRecord {
  schema: "madp-checks-found/1";
  byJob: Record<string, FoundEntry>;
}

const recordFile = (app: Pick<OfficialApp, "dir">): string => path.join(app.dir, "checks-found.json");
const MAX_JOBS = 40;

function readRecord(app: Pick<OfficialApp, "dir">): FoundRecord {
  try {
    const r = JSON.parse(fs.readFileSync(recordFile(app), "utf8")) as Partial<FoundRecord>;
    return { schema: "madp-checks-found/1", byJob: r.byJob && typeof r.byJob === "object" ? r.byJob : {} };
  } catch {
    return { schema: "madp-checks-found/1", byJob: {} };
  }
}

/** What the build `jobId`'s checks found; null when nothing was kept. */
export function readFound(app: Pick<OfficialApp, "dir">, jobId: string): FoundEntry | null {
  const e = readRecord(app).byJob[jobId];
  if (!e || !Array.isArray(e.checks)) return null;
  const { reported, ...rest } = e;
  return { ...rest, commits: Array.isArray(e.commits) ? e.commits : [], targets: Array.isArray(e.targets) ? e.targets : [], ...(Array.isArray(reported) && reported.length ? { reported } : {}) };
}

/** Keeps what the build's checks found (the newest MAX_JOBS builds). Never throws. */
export function recordFound(run: Pick<JobRun, "id" | "log">, app: Pick<OfficialApp, "dir">, entry: FoundEntry): void {
  try {
    const r = readRecord(app);
    const byJob = { ...r.byJob, [run.id]: entry };
    const kept = Object.entries(byJob).sort((x, y) => String(y[1].at).localeCompare(String(x[1].at))).slice(0, MAX_JOBS);
    fs.mkdirSync(app.dir, { recursive: true });
    const f = recordFile(app);
    fs.writeFileSync(`${f}.tmp`, `${JSON.stringify({ schema: "madp-checks-found/1", byJob: Object.fromEntries(kept) }, null, 2)}\n`);
    fs.renameSync(`${f}.tmp`, f);
  } catch (e) {
    run.log(`checks found: the record could not be written (${String(e).slice(0, 120)})`);
  }
}

// ------------------------------------------------------------------ the fix round's brief

const FIXTURES_WHY = "the test data (fixtures)";

/** What the checks after a build reported, as its fix round's lane takes it (WorkAsk.failedChecks, the engine's
 *  `--failed-checks`): the acceptance step's own result kept with the build (FoundEntry.reported), else the one
 *  accept.json kept (`accepted`), both with the checks that could not judge the change; else, for a build checked by
 *  an engine without that result, its failing checks (the report's, else the change's record) as failed checks of
 *  their test file. A check that names no test file (the test data, the step as a whole) never becomes one to run
 *  again; a "not judged" one is the environment's, never a fix target (build.ts liveChecksOf) (pure). */
export function reportedChecks(found: Pick<FoundEntry, "checks" | "reported"> | null, accepted: readonly AcceptCheck[], failing: readonly FailingCheck[]): AcceptCheck[] {
  if (found?.reported?.length) return [...found.reported];
  if (accepted.length) return [...accepted];
  const from: ReadonlyArray<FailingCheck & { why?: string }> = found?.checks.length ? found.checks : failing;
  return from.map((c) => {
    const fixtures = c.name === "test data (fixtures)" || /fixtures/i.test(c.why ?? "");
    const file = !fixtures && c.name && !/\s/.test(c.name) ? c.name : "";
    return { repo: c.repo, file, verdict: "failed" as const, reason: c.reason, why: fixtures ? FIXTURES_WHY : c.why ?? "", limit: "" };
  });
}

/** The part of a fix round's description that says what to fix: the deployed commits, every failing check with its
 *  output, and the rule (pure). */
export function fixBlock(o: { round: number; env?: string; found: FoundEntry | null; failing: FailingCheck[] }): string {
  const env = o.env === "dev" || !o.env ? "development" : o.env;
  const checks: FoundCheck[] = o.found?.checks.length ? o.found.checks : o.failing.map((f) => ({ ...f, output: "" }));
  const out: string[] = [`## Fix what the checks found (fix round ${o.round})`];
  const deployed = o.found?.targets.length
    ? o.found.targets.map((t) => `${t.key} at ${t.commit.slice(0, 12)}`).join(", ")
    : (o.found?.commits ?? []).map((c) => c.slice(0, 12)).join(", ");
  out.push(`This change is deployed on the ${env} environment${deployed ? ` (${deployed})` : ""}. Its own live tests ran there after the deploy, and ${checks.length === 1 ? "this check" : `these ${checks.length} checks`} did not pass. Until they pass, the change is not usable there.`);
  for (const c of checks) {
    const lines = [`### ${c.repo ? `${c.repo}: ` : ""}${c.name}`, `What failed: ${c.reason}`, ...(c.why ? [`Why it ran: ${c.why}`] : [])];
    if (c.output.trim()) lines.push(`Output (its end; secret values were removed):\n\`\`\`text\n${c.output.trim()}\n\`\`\``);
    out.push(lines.join("\n"));
  }
  out.push(`## The rule for this fix\n- ${FIX_RULE}\n- Find the cause first: a test changes only where it checks something the change did not ask for, or checks it the wrong way; never weaken a test just to make it pass, and say in the commit why a test changed.\n- Keep every other screen, route, text, data field and behaviour exactly as it is.\n- The same checks run again on the ${env} environment after this fix is deployed.`);
  return out.join("\n\n");
}

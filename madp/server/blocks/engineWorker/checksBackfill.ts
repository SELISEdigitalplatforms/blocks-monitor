// The checks of change builds that ran before their per-file results were recorded on the change (ChangeRequest.Checks,
// src/domain/changeChecks.ts), read back from the engine host's acceptance reports, so the rule "a change's failing
// checks follow the newest result of each file" (checksPassSince) has the files it needs for them too.
//
// 09.11.2026, PrimaBook: CR-005 and its follow-ups CR-008 to CR-015 ran their checks before the Factory recorded them
// on the change; only the job's ErrorCode ("accept-failed=1/2") said how many files failed, never which, so those
// changes kept reading "not usable" although every tariff test passed on 0.15.0. The engine host still has the report
// of every acceptance run (`madp accept` writes reports/accept/<time>-<registry>-<env>.md: a section per repo with a
// table of every test file and its result). For each succeeded change build without a run on its change, the reports
// written while it ran (from its claim to a few minutes after it finished; per repo the newest wins) give its run: the
// files that failed and the files that passed, its version (the job's, else its release's) and its kind (build, fix
// round, revert). Nothing else changes; runs already on the record stay as they are.
//
//   node scripts/backfill-checks.mjs --project <project id> --reports <the product's madp folder>/reports [--apply]
//
// Without --apply it only prints what it would add (no Blocks write). Run on the engine host, where the reports are.
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { serviceTokens } from "../../../functions/_lib/serviceToken";
import { createRawGateway, type RawGateway, type Row } from "../../../functions/_lib/gateway";
import { defaultSdk } from "../../../functions/_lib/sdk";
import { f } from "../../../functions/_lib/filter";
import type { FnEnv } from "../../../functions/_lib/env";
import {
  MAX_PASSED, fixRoundOf, latestRun, parseChangeChecks, revertOf, serializeChangeChecks, withRun, type ChecksRun,
} from "../../../src/domain/changeChecks";

/** One test file's result in a report. */
export interface ReportFile {
  repo: string;
  name: string;
  verdict: "passed" | "failed";
}

const ACCEPT_HEADING = "## Acceptance on the deployed environment";
const SECTION = /^###\s+`([^`]+)`\s+on\s+\S+:/;
const ROW = /^\|\s*`([^`]+)`\s*\|\s*(FAIL|ok)\s*\|/;

/** Every test file of an acceptance report with its result, by repo (pure); [] for any other report. */
export function fileResultsOfReport(md: string): ReportFile[] {
  if (!md.includes(ACCEPT_HEADING)) return [];
  const out: ReportFile[] = [];
  let repo = "";
  for (const line of md.split(/\r?\n/)) {
    const head = SECTION.exec(line);
    if (head) { repo = head[1]!.trim(); continue; }
    if (/^##\s/.test(line)) { repo = ""; continue; }
    const row = repo ? ROW.exec(line) : null;
    if (row && !out.some((x) => x.repo === repo && x.name === row[1])) out.push({ repo, name: row[1]!, verdict: row[2] === "ok" ? "passed" : "failed" });
  }
  return out;
}

/** The repos a report checked (its sections), each with its files (pure). */
function byRepo(files: readonly ReportFile[]): Map<string, ReportFile[]> {
  const m = new Map<string, ReportFile[]>();
  for (const x of files) m.set(x.repo, [...(m.get(x.repo) ?? []), x]);
  return m;
}

/** How long after a job finished its report may still be written (the file's time is when it was written). */
export const REPORT_GRACE_MS = 3 * 60_000;

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const time = (v: unknown): number => {
  const t = Date.parse(s(v));
  return Number.isFinite(t) ? t : Number.NaN;
};
const input = (j: Row): Record<string, unknown> => {
  try {
    const v = JSON.parse(s(j.InputJson)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The run of one succeeded change build from the reports written while it ran (per repo the newest wins); null when
 *  no acceptance report falls in its time (pure). */
export function runOfJob(job: Row, reports: readonly { at: number; md: string }[], version: string): ChecksRun | null {
  const from = time(job.ClaimedAt) || time(job.StartedAt) || time(job.CreatedDate);
  const to = time(job.FinishedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const repos = new Map<string, ReportFile[]>();
  for (const r of [...reports].filter((x) => x.at >= from && x.at <= to + REPORT_GRACE_MS).sort((a, b) => a.at - b.at)) {
    for (const [repo, files] of byRepo(fileResultsOfReport(r.md))) repos.set(repo, files);
  }
  if (!repos.size) return null;
  const all = [...repos.values()].flat();
  const failing = all.filter((x) => x.verdict === "failed").map((x) => ({ repo: x.repo, name: x.name, reason: "did not pass (read back from its report)" }));
  const passed = all.filter((x) => x.verdict === "passed").map((x) => ({ repo: x.repo, name: x.name })).slice(0, MAX_PASSED);
  const fix = fixRoundOf({ kind: "change.build", inputJson: s(job.InputJson) });
  const revert = revertOf({ kind: "change.build", inputJson: s(job.InputJson) });
  return {
    jobId: s(job.ItemId), kind: fix ? "fix" : revert ? "revert" : "build", env: "dev", at: new Date(to).toISOString(),
    status: failing.length ? "failed" : "ok", version, commits: [], failed: failing.length, files: all.length, fixtures: false,
    failing, round: fix?.round ?? 0, auto: fix?.auto ?? revert?.auto ?? false, baseJobId: fix?.baseJobId ?? revert?.baseJobId ?? "",
    known: [], diagnosed: [], ...(passed.length ? { passed } : {}),
  };
}

/** What a backfill adds: per change request the runs its record lacks, oldest first (pure). */
export function backfillPlan(o: { jobs: readonly Row[]; changes: readonly Row[]; releases: readonly Row[]; reports: readonly { at: number; md: string }[] }): Array<{ changeId: string; number: number; runs: ChecksRun[] }> {
  const versionOf = (j: Row): string => {
    const own = s(input(j).version);
    if (own) return own;
    const rel = o.releases.find((r) => s(r.EngineJobId) === s(j.ItemId));
    if (rel) return s(rel.Version);
    // a run of the steps after an earlier deploy checks that deploy's version
    const after = s(input(j).afterJobId);
    const prior = after ? o.releases.find((r) => s(r.EngineJobId) === after) : undefined;
    return prior ? s(prior.Version) : "";
  };
  const out: Array<{ changeId: string; number: number; runs: ChecksRun[] }> = [];
  for (const c of o.changes) {
    const id = s(c.ItemId);
    const record = parseChangeChecks(c.Checks);
    const jobs = o.jobs
      .filter((j) => s(j.Kind) === "change.build" && s(j.Status) === "succeeded" && s(input(j).changeRequestId) === id && s(j.ErrorCode) !== "nothing-deployed")
      .filter((j) => !latestRun(record, s(j.ItemId)))
      .sort((a, b) => time(a.FinishedAt) - time(b.FinishedAt));
    const runs = jobs.map((j) => runOfJob(j, o.reports, versionOf(j))).filter((r): r is ChecksRun => r !== null);
    if (runs.length) out.push({ changeId: id, number: Number(c.Number) || 0, runs });
  }
  return out;
}

/** The acceptance reports under `dir` (reports/accept, reports/quick, reports/feature), with when each was written. */
export function readReports(dir: string): Array<{ at: number; md: string; file: string }> {
  const out: Array<{ at: number; md: string; file: string }> = [];
  const walk = (d: string, depth: number) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n.name);
      if (n.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (n.isFile() && n.name.endsWith(".md")) {
        try {
          const md = fs.readFileSync(p, "utf8");
          if (md.includes(ACCEPT_HEADING)) out.push({ at: fs.statSync(p).mtimeMs, md, file: p });
        } catch { /* gone */ }
      }
    }
  };
  walk(dir, 0);
  return out;
}

const PROJECT_ID = /^[0-9a-f-]{36}$/i;

/** The command: prints the plan; with --apply writes each change's record once (its runs merged in by time). */
export async function backfillMain(argv: string[], root: string): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? "" : ""; };
  const projectId = arg("--project");
  const reportsDir = arg("--reports");
  const apply = argv.includes("--apply");
  if (!PROJECT_ID.test(projectId) || !reportsDir) {
    console.error("Usage: node scripts/backfill-checks.mjs --project <project id> --reports <the product's madp folder>/reports [--apply]");
    return 1;
  }
  const e = { ...loadEnv("development", root, ""), ...process.env } as Record<string, string | undefined>;
  const env: FnEnv = {
    apiUrl: (e.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com").replace(/\/+$/, ""),
    tenant: e.MF_BLOCKS_TENANT || e.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: e.MF_SVC_CLIENT_ID || "",
    clientSecret: e.MF_SVC_CLIENT_SECRET || "",
  };
  if (!env.tenant || !env.clientId || !env.clientSecret) {
    console.error("MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET are needed (the engine host's bridge.env).");
    return 1;
  }
  const raw: RawGateway = createRawGateway({ env, sdk: defaultSdk, tokens: serviceTokens(env, defaultSdk), batch: false });
  const of = f.eq("ProjectId", projectId);
  const [jobs, changes, releases] = await Promise.all([
    raw.findAll("EngineJob", { where: f.and(of, f.eq("Kind", "change.build")), fields: ["ItemId", "Kind", "Status", "InputJson", "ErrorCode", "ClaimedAt", "StartedAt", "FinishedAt", "CreatedDate"], max: 2000 }),
    raw.findAll("ChangeRequest", { where: of, fields: ["ItemId", "Number", "Checks"], max: 1000 }),
    raw.findAll("Release", { where: of, fields: ["ItemId", "Version", "EngineJobId", "Environment"], max: 2000 }),
  ]);
  const reports = readReports(reportsDir);
  const plan = backfillPlan({ jobs, changes, releases: releases.filter((r) => s(r.Environment) === "dev"), reports });
  for (const p of plan) {
    for (const r of p.runs) {
      console.log(`CR-${String(p.number).padStart(3, "0")} ${r.jobId.slice(0, 8)} ${r.kind} v${r.version || "?"} ${r.status}: ${r.failed} of ${r.files} failed${r.failing.length ? ` (${r.failing.map((x) => x.name).join(", ")})` : ""}; ${r.passed?.length ?? 0} passed`);
    }
  }
  console.log(`${plan.reduce((n, p) => n + p.runs.length, 0)} runs for ${plan.length} change requests from ${reports.length} reports${apply ? "" : " (dry run: nothing written; add --apply)"}`);
  if (!apply) return 0;
  for (const p of plan) {
    const row = changes.find((c) => s(c.ItemId) === p.changeId)!;
    let record = parseChangeChecks(row.Checks);
    // every run in time order: the record keeps its runs oldest first
    const runs = [...(record?.runs ?? []), ...p.runs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    record = { v: 1, runs: [], ...(record?.marks?.length ? { marks: record.marks } : {}) };
    for (const r of runs) record = withRun(record, r);
    await raw.update("ChangeRequest", p.changeId, { Checks: serializeChangeChecks(record) });
    console.log(`CR-${String(p.number).padStart(3, "0")}: ${p.runs.length} runs written`);
  }
  return 0;
}

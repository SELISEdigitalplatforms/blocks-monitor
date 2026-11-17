// Usage of jobs that ran before the engine recorded it (server/local/engine/usage.ts): read back from the engine host's
// lane logs and reports, written as EngineJob.UsageJson and the job's one usage CreditEntry (RequestKey usage:<job id>,
// so running it twice changes nothing). Run on the engine host; without --apply it only prints what it would write.
//
//   node scripts/backfill-usage.mjs --root <folder holding the products' madp folders> [--apply] [--force]
//
// Where a job's usage is found:
//   <madp folder>/logs/<job id>-<lane>.log   runLane's log of every lane run of the job (the id in the file name, cut to
//                                            24 characters): every usage line in it, one per lane run, summed
//   <madp folder>/reports/{feature,quick}/*.md  a lane report that names the job id in its name or text, for jobs
//                                            without a log
// Jobs that already have UsageJson are left alone unless --force (then their usage is replaced by what the files say).
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { createRawGateway, type RawGateway, type Row } from "../../../functions/_lib/gateway";
import { defaultSdk } from "../../../functions/_lib/sdk";
import { serviceTokens } from "../../../functions/_lib/serviceToken";
import type { FnEnv } from "../../../functions/_lib/env";
import { f } from "../../../functions/_lib/filter";
import { EMPTY_USAGE, addUsage, parseJobUsage, parseLaneUsage, parseUsageLines, type JobUsage } from "../../../src/domain/billing";
import { chargeJobUsage, priceFactorOf, USAGE_JOB_FIELDS } from "../../local/engine/usage.ts";

const s = (v: unknown): string => (typeof v === "string" ? v : "");
/** runLane's log name: the job id with only [A-Za-z0-9_-], cut to 24 characters. */
export const logIdOf = (jobId: string): string => jobId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);

export interface UsageFile {
  file: string;
  kind: "log" | "report";
  text: string;
}

function walk(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth - 1, out);
    else if (e.isFile()) {
      const parent = path.basename(path.dirname(full));
      const grand = path.basename(path.dirname(path.dirname(full)));
      if ((parent === "logs" && e.name.endsWith(".log")) || (grand === "reports" && (parent === "feature" || parent === "quick") && e.name.endsWith(".md"))) out.push(full);
    }
  }
}

/** The lane logs and feature/quick reports under `root` (up to 8 folders deep) that hold a usage line. */
export function readUsageFiles(root: string): UsageFile[] {
  const files: string[] = [];
  walk(root, 8, files);
  const out: UsageFile[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!parseUsageLines(text).length) continue;
    out.push({ file, kind: file.endsWith(".log") ? "log" : "report", text });
  }
  return out;
}

export interface BackfillItem {
  jobId: string;
  usage: JobUsage;
  sources: string[];
  had: JobUsage | null;
}

/** Which job each file's usage belongs to: logs by the id in their name, reports by a job id in their name or text. */
export function usagePlan(jobs: readonly Row[], files: readonly UsageFile[], o: { force?: boolean } = {}): BackfillItem[] {
  const byLogId = new Map<string, Row>();
  for (const j of jobs) byLogId.set(logIdOf(s(j.ItemId)), j);
  const found = new Map<string, { usage: JobUsage; sources: string[]; fromLog: boolean }>();
  const add = (job: Row, u: JobUsage, file: string, fromLog: boolean) => {
    const id = s(job.ItemId);
    const cur = found.get(id);
    if (cur && cur.fromLog && !fromLog) return; // a log holds every lane run of the job; its report is one of them
    if (cur && !cur.fromLog && fromLog) found.delete(id);
    const next = found.get(id) ?? { usage: EMPTY_USAGE, sources: [], fromLog };
    found.set(id, { usage: addUsage(next.usage, u), sources: [...next.sources, file], fromLog });
  };
  for (const file of files.filter((x) => x.kind === "log")) {
    const m = /^([A-Za-z0-9_-]{1,24})-[a-z-]+\.log$/.exec(path.basename(file.file));
    const job = m ? byLogId.get(m[1]!) : undefined;
    if (!job) continue;
    // one usage line per lane run in the log (each run is appended after a "$ madp …" line)
    const runs = file.text.split(/\n\$ madp /);
    for (const run of runs) {
      const u = parseLaneUsage(run);
      if (u) add(job, u, file.file, true);
    }
  }
  for (const file of files.filter((x) => x.kind === "report")) {
    const job = jobs.find((j) => {
      const id = s(j.ItemId);
      return id.length >= 8 && (path.basename(file.file).includes(id) || file.text.includes(id));
    });
    if (!job) continue;
    const u = parseLaneUsage(file.text);
    if (u) add(job, u, file.file, false);
  }
  const out: BackfillItem[] = [];
  for (const [jobId, v] of found) {
    const job = jobs.find((j) => s(j.ItemId) === jobId)!;
    const had = parseJobUsage(job.UsageJson);
    if (had && had.lanes > 0 && !o.force) continue;
    out.push({ jobId, usage: v.usage, sources: v.sources, had });
  }
  return out.sort((a, b) => a.jobId.localeCompare(b.jobId));
}

export async function applyUsagePlan(gateway: RawGateway, jobs: readonly Row[], plan: readonly BackfillItem[], log: (line: string) => void): Promise<number> {
  const factor = await priceFactorOf(gateway);
  let written = 0;
  for (const item of plan) {
    const job = jobs.find((j) => s(j.ItemId) === item.jobId)!;
    await gateway.update("EngineJob", item.jobId, { UsageJson: JSON.stringify(item.usage) });
    const at = s(job.FinishedAt) || s(job.StartedAt) || s(job.CreatedDate) || new Date().toISOString();
    const res = await chargeJobUsage(gateway, job, item.usage, at, factor);
    log(`${item.jobId.slice(0, 8)}: usage written, credit entry ${res.written} (${(res.cents / 100).toFixed(2)} USD)`);
    written++;
  }
  return written;
}

export async function backfillMain(argv: string[], root: string): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] ?? "" : "";
  };
  const folder = arg("--root") || process.env.MF_ENGINE_ROOT || "";
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  if (!folder || !fs.existsSync(folder)) {
    console.error("Usage: node scripts/backfill-usage.mjs --root <folder holding the products' madp folders> [--apply] [--force]");
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
  const files = readUsageFiles(folder);
  const jobs = await raw.findAll("EngineJob", {
    where: f.in("Status", ["succeeded", "failed", "cancelled"]),
    fields: [...USAGE_JOB_FIELDS, "Status", "StartedAt", "FinishedAt", "CreatedDate"],
    max: 5000,
  });
  const plan = usagePlan(jobs, files, { force });
  for (const p of plan) {
    console.log(`${p.jobId.slice(0, 8)}: ${p.usage.tokens.total} tokens, cost $${p.usage.costUsd.toFixed(4)}, ${p.usage.lanes} lane run(s), models ${p.usage.models.join("+") || "-"}${p.had ? " (replaces recorded usage)" : ""} <- ${p.sources.map((x) => path.relative(folder, x)).join(", ")}`);
  }
  const total = plan.reduce((n, p) => n + p.usage.costUsd, 0);
  console.log(`${plan.length} jobs, cost $${total.toFixed(4)} from ${files.length} files with usage lines${apply ? "" : " (dry run: nothing written; add --apply)"}`);
  if (!apply) return 0;
  const n = await applyUsagePlan(raw, jobs, plan, (line) => console.log(line));
  console.log(`${n} jobs written`);
  return 0;
}

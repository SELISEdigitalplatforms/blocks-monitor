// Putting development back to the last build whose checks passed (src/domain/changeChecks.ts "the revert"): a change
// whose own checks still fail after its fix rounds must not leave development half-broken. The commits of the build
// whose checks failed first and of its fix rounds are reverted on the environment's branch, and the revert goes the
// SAME deploy path as every change: the official quick lane (gate, commit, push, deploy, smoke), then the Factory's
// steps after the deploy (data tables, texts, the checks). Never a reset or a force push, never staging or production
// (promotion only fast-forwards a tested dev commit; the engine's own rule: "to roll back, revert on dev, re-verify on
// DEV, then promote again").
//
// How, per repo the reverted commits are in (API first, then the web app):
//   1. the repo must have no uncommitted file (nothing of anyone else's is ever mixed in);
//   2. `git revert --no-commit <commits, newest first>` puts the revert in the working tree; a conflict (later work
//      changed the same lines) is undone at once (`git revert --abort`) and a person decides;
//   3. `madp quick --target <repo> --include <each file> --allow-dirty` commits exactly those files (the lane's own
//      way to commit "a previous run's uncommitted first attempt", QUICK-LANE.md), with a task that tells the agent
//      the revert is complete and nothing else changes;
//   4. a lane that stopped before its commit leaves the tree as it was before (the revert is aborted again).
//
// The change's record (docs/changes/<id>.md, committed with every build of the change) is never reverted: its rounds
// are the change's history. The lane gets it (`--change-record`, when the installed engine takes it) with a round that
// says development was put back and which commits were reverted, and commits it with the revert.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { JobFailure, type JobRun } from "../run.ts";
import type { OfficialApp } from "./app.ts";
import { storeOf } from "./blocksLogin.ts";
import { changeRecordOf, commitOf, commitsOf, engineLaneOptions, LaneAttention, type WorkAsk, type WorkResult } from "./build.ts";
import { deployOrder, parseRegistry, registryRepos } from "./hostRegistry.ts";
import { laneFailure, needsAttention, runLane, type LaneOptions, type LaneResult, type LaneStep } from "./madp.ts";
import { commitsIn } from "./uilm.ts";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout;
}
async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/** One repo to revert: its commits of the red builds (newest first). */
export interface RevertRepo {
  key: string;
  path: string;
  commits: string[];
}

/** The repos the commits are in, in deploy order (API first), each with its commits newest first. */
export async function revertPlan(app: Pick<OfficialApp, "registry">, commits: string[]): Promise<RevertRepo[]> {
  const data = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  const out: RevertRepo[] = [];
  for (const r of deployOrder(registryRepos(data))) {
    if (!r.path || !fs.existsSync(path.join(r.path, ".git"))) continue;
    const mine = await commitsIn(r.path, commits);
    if (mine.length) out.push({ key: r.key, path: r.path, commits: mine });
  }
  return out;
}

/** The files a working tree changed, repo-relative (staged, unstaged and untracked). */
async function changedFiles(repo: string): Promise<string[]> {
  const out = await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  const files: string[] = [];
  const parts = out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]!;
    const status = entry.slice(0, 2);
    files.push(entry.slice(3));
    // a rename names its old path next
    if (status.includes("R") || status.includes("C")) i += 1;
  }
  return [...new Set(files)].sort();
}

/** Puts the revert of the repo's commits in its working tree; answers the files it changed. `keep`: repo-relative
 *  files that stay as they are (the change's record: its rounds are history). Throws a JobFailure when the tree has
 *  uncommitted files or the revert does not apply (then nothing is left changed). */
export async function prepareRevert(repo: RevertRepo, what: string, keep: readonly string[] = []): Promise<string[]> {
  if ((await changedFiles(repo.path)).length) {
    throw new JobFailure(`Development could not be put back by itself: the product's ${repo.key} code has changes nobody committed. A person decides how to go on.`, "checks.revert_dirty");
  }
  try {
    await git(repo.path, ["revert", "--no-commit", ...repo.commits]);
  } catch {
    await tryGit(repo.path, ["revert", "--abort"]);
    await tryGit(repo.path, ["reset", "--merge"]);
    throw new JobFailure(`Development could not be put back by itself: later work changed the same parts of the ${repo.key} code as ${what}. A person decides how to go on.`, "checks.revert_conflict");
  }
  const changed = await changedFiles(repo.path);
  const kept = changed.filter((f) => keep.includes(f));
  if (kept.length) await git(repo.path, ["checkout", "HEAD", "--", ...kept]);
  const left = kept.length ? await changedFiles(repo.path) : changed;
  // nothing left to revert here: no revert stays in progress (a later lane would commit it)
  if (!left.length) await tryGit(repo.path, ["revert", "--quit"]);
  return left;
}

/** The repo-relative file of a change's record in the product repos (the registry's change_records.dir, default
 *  docs/changes; the engine's change_record_ops.rel_path) (pure). */
export function changeRecordPath(registry: Record<string, unknown>, id: string): string {
  const cr = registry.change_records;
  const dir = cr && typeof cr === "object" && !Array.isArray(cr) && typeof (cr as Record<string, unknown>).dir === "string" ? String((cr as Record<string, unknown>).dir).trim() : "";
  return `${(dir || "docs/changes").replace(/^\/+|\/+$/g, "")}/${id}.md`;
}

/** Undoes a prepared revert that no lane committed (the tree is as it was before). */
export async function undoRevert(repo: Pick<RevertRepo, "path">): Promise<void> {
  if ((await tryGit(repo.path, ["revert", "--abort"])) === null) await tryGit(repo.path, ["reset", "--merge"]);
}

/** The lane's task for a revert: the working tree holds it already; the agent changes nothing (pure). */
export function revertTask(o: { product: string; label: string; repo: string; commits: string[]; files: string[] }): string {
  return [
    `${o.product}: ${o.label}`,
    `## Put development back to the last build whose checks passed`,
    `The working tree of the ${o.repo} repository already holds the exact revert of ${o.commits.length === 1 ? "commit" : "the commits"} ${o.commits.map((c) => c.slice(0, 12)).join(", ")}: the change's own checks on the development environment did not pass, so the change is taken off development until it is fixed.`,
    `The revert touches ${o.files.length === 1 ? "this file" : `these ${o.files.length} files`}:\n${o.files.slice(0, 60).map((f) => `- ${f}`).join("\n")}${o.files.length > 60 ? `\n- … and ${o.files.length - 60} more` : ""}`,
    `## Ground rules\n- Do not change any file: the revert is complete as it is.\n- Only if the checks of the reverted code fail because of the revert itself, change the least that makes them pass, and nothing else.`,
  ].join("\n\n") + "\n";
}

export type RevertLane = (run: JobRun, args: string[], o: LaneOptions) => Promise<LaneResult>;

/**
 * The revert through the official quick lane, one repo after the other in deploy order. `noAccept`: the lane skips the
 * checks (the job runs them after its data tables and texts, acceptance.ts). `changeRecord`: the lane takes the
 * change's record (default: the installed engine's engineLaneOptions). Answers the lanes' work; a lane whose
 * checks failed (exit 12) throws LaneAttention with all of it; any other stop fails the job (a repo already reverted
 * and deployed stays so, and the message says it).
 */
export async function runRevert(
  run: JobRun,
  app: OfficialApp,
  ask: WorkAsk,
  plan: RevertRepo[],
  o: { onStep: (s: LaneStep) => Promise<void>; noAccept?: boolean; lane?: RevertLane; changeRecord?: boolean },
): Promise<WorkResult> {
  const lane = o.lane ?? runLane;
  const started = Date.now();
  const commit = commitOf({ ...ask, revert: true });
  const registry = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  const blocksConfigDir = storeOf(registry, app.name, "dev");
  const work = path.join(app.dir, "work");
  fs.mkdirSync(work, { recursive: true });
  // the change's record: kept out of the revert, its round written by the lane (when the installed engine takes it)
  const base = changeRecordOf({ ...ask, revert: true });
  const keep = base ? [changeRecordPath(registry, base.id)] : [];
  const record = base && (o.changeRecord ?? engineLaneOptions().changeRecord)
    ? { ...base, round: { ...base.round, goal: plan.map((r) => `${r.key} ${r.commits.map((c) => c.slice(0, 12)).join(", ")}`).join("; ") } }
    : null;
  const recordFile = record ? path.join(work, `${run.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}-revert.change.json`) : "";
  if (record) fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  const commits: string[] = [];
  const steps: LaneStep[] = [];
  const done: string[] = [];
  for (const repo of plan) {
    const files = await prepareRevert(repo, ask.label, keep);
    if (!files.length) continue; // the commits were reverted already
    const head = (await tryGit(repo.path, ["rev-parse", "HEAD"]))?.trim() ?? "";
    const file = path.join(work, `${run.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}-revert-${repo.key.replace(/[^A-Za-z0-9_-]/g, "")}.md`);
    fs.writeFileSync(file, revertTask({ product: ask.product, label: ask.label, repo: repo.key, commits: repo.commits, files }));
    let r: LaneResult;
    try {
      r = await lane(run, [
        "quick", "--task-file", file, "--project", app.registry, "--env", "dev", "--target", repo.key, "--allow-dirty",
        ...files.flatMap((f) => ["--include", f]), "--title", commit.title, "--summary", commit.summary, ...(o.noAccept ? ["--no-accept"] : []),
        ...(recordFile ? ["--change-record", recordFile] : []),
      ], { projectDir: app.dir, label: "quick", timeoutMs: 40 * 60_000, onStep: o.onStep, blocksConfigDir });
    } catch (e) {
      if ((await tryGit(repo.path, ["rev-parse", "HEAD"]))?.trim() === head) await undoRevert(repo);
      throw e;
    }
    // the lane stopped before its commit: the tree goes back to how it was
    if (r.code !== 0 && (await tryGit(repo.path, ["rev-parse", "HEAD"]))?.trim() === head) await undoRevert(repo);
    commits.push(...commitsOf(r));
    steps.push(...r.steps);
    const result: WorkResult = { lane: "quick", commits, seconds: Math.round((Date.now() - started) / 1000), steps };
    if (r.code !== 0 && needsAttention(r.code) && !r.capacity) {
      const f = laneFailure(ask.label, r);
      throw new LaneAttention(f.message, f.code, result);
    }
    if (r.code !== 0) {
      const f = laneFailure(`Putting development back${done.length ? ` (the ${done.join(" and ")} part is back already)` : ""}`, r);
      throw new JobFailure(f.message, f.code);
    }
    done.push(repo.key);
  }
  return { lane: "quick", commits, seconds: Math.round((Date.now() - started) / 1000), steps };
}

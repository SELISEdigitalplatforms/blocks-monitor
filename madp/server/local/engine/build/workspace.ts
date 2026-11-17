// A project's engine folder (build/paths.ts): its project.json and its own git repository with one worktree per branch.
// Every build works on its own branch and merges into main when it succeeds. No remote, no push.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { worktreeDir, type ProjectDirs } from "./paths.ts";

// ------------------------------------------------------------------ project.json

export interface BuildRecord {
  version: string;
  branch: string;
  commit: string;
  jobId: string;
  at: string;
  files: number;
  jsKb: number;
  cssKb: number;
  seconds: number;
}

export interface Published {
  version: string;
  buildId: string;
  url: string;
  at: string;
}

/** What project.json holds (no secrets). Unknown keys written by others are kept. */
export interface ProjectJson {
  name: string;
  workspaceId: string;
  projectId: string;
  updatedAt: string;
  /** Branch names (the engine's projectFolder.ts writes ["main"] first). */
  branches: string[];
  /** Per branch: open while a build works on it, merged once it is in main. */
  branchStatus: Record<string, { status: "open" | "merged"; commit: string; buildId: string; at: string }>;
  builds: Record<string, BuildRecord>;
  /** Published version -> build id (what /<projectId>/v/<version>/ serves). */
  versions: Record<string, string>;
  /** The latest published build: what /<projectId>/ serves. */
  latestBuild: Published | null;
  previewUrl: string;
  environments: Partial<Record<"dev" | "stage" | "production", Published>>;
  [k: string]: unknown;
}

export function readProjectJson(d: ProjectDirs): ProjectJson | null {
  try {
    const v = JSON.parse(fs.readFileSync(d.projectJson, "utf8")) as Partial<ProjectJson>;
    if (!v || typeof v !== "object") return null;
    return {
      ...v,
      name: String(v.name ?? ""),
      workspaceId: String(v.workspaceId ?? ""),
      projectId: String(v.projectId ?? ""),
      updatedAt: String(v.updatedAt ?? ""),
      branches: Array.isArray(v.branches) ? v.branches.filter((b): b is string => typeof b === "string") : ["main"],
      branchStatus: v.branchStatus && typeof v.branchStatus === "object" && !Array.isArray(v.branchStatus) ? v.branchStatus : {},
      builds: v.builds && typeof v.builds === "object" ? v.builds : {},
      versions: v.versions && typeof v.versions === "object" ? v.versions : {},
      latestBuild: v.latestBuild ?? null,
      previewUrl: String(v.previewUrl ?? ""),
      environments: v.environments && typeof v.environments === "object" ? v.environments : {},
    };
  } catch {
    return null;
  }
}

/** Read, change, write (atomically: a temporary file renamed over it). */
export function updateProjectJson(d: ProjectDirs, base: { name: string; workspaceId: string; projectId: string }, change: (p: ProjectJson) => void): ProjectJson {
  const p: ProjectJson = readProjectJson(d) ?? { ...base, updatedAt: "", branches: ["main"], branchStatus: {}, builds: {}, versions: {}, latestBuild: null, previewUrl: "", environments: {} };
  p.name = base.name || p.name;
  p.workspaceId = base.workspaceId;
  p.projectId = base.projectId;
  change(p);
  p.updatedAt = new Date().toISOString();
  fs.mkdirSync(d.root, { recursive: true });
  const tmp = `${d.projectJson}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`);
  fs.renameSync(tmp, d.projectJson);
  return p;
}

// ------------------------------------------------------------------ git

const GIT_ID = ["-c", "user.name=MADP Factory", "-c", "user.email=engine@madp-factory.local", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0" };
  return env;
}

export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", [...GIT_ID, ...args], { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`git ${args[0]} failed: ${String(err.stderr || err.message || "").trim().split("\n").slice(-2).join(" ")}`);
  }
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/** The project's repository: created on main with the starter as its first commit (a repository the engine's
 *  projectFolder.ts made already is used as it is; the first build adds the starter on its branch). */
export function ensureRepo(d: ProjectDirs, starter: Record<string, string>): void {
  if (fs.existsSync(path.join(d.repo, ".git")) && gitOk(d.repo, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])) return;
  if (fs.existsSync(path.join(d.repo, ".git"))) {
    git(d.repo, ["commit", "-q", "--allow-empty", "-m", "Project repository"]);
    return;
  }
  fs.mkdirSync(d.repo, { recursive: true });
  git(d.repo, ["init", "-q", "-b", "main"]);
  for (const [rel, body] of Object.entries(starter)) {
    const f = path.join(d.repo, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  git(d.repo, ["add", "-A"]);
  git(d.repo, ["commit", "-q", "-m", "Starter: Vite, React, TypeScript, Tailwind CSS"]);
}

/** The working folder of a branch, from main. A folder whose branch is merged already is moved up to main (its
 *  installed packages stay); one with unmerged work (a failed or stopped build) is kept as it is, so a retry goes on. */
export function openWorktree(d: ProjectDirs, branch: string): string {
  const dir = worktreeDir(d, branch);
  if (fs.existsSync(path.join(dir, ".git"))) {
    const head = git(dir, ["rev-parse", "HEAD"]);
    const merged = gitOk(d.repo, ["merge-base", "--is-ancestor", head, "main"]);
    const clean = git(dir, ["status", "--porcelain"]) === "";
    if (merged && clean) git(dir, ["reset", "-q", "--hard", "main"]);
    return dir;
  }
  git(d.repo, ["worktree", "prune"]);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(d.repo, ["worktree", "add", "-q", "-B", branch, dir, "main"]);
  return dir;
}

/** Commits everything of the working folder (ignored files left out); answers the commit. */
export function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  if (!gitOk(dir, ["diff", "--cached", "--quiet"])) git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/** Keeps a path out of every commit of the repository, whatever its .gitignore says: a line in the repository's own
 *  info/exclude (shared by all its worktrees; never committed itself). Idempotent; throws when git cannot say where. */
export function excludeFromCommits(dir: string, pattern: string): void {
  const file = path.resolve(dir, git(dir, ["rev-parse", "--git-path", "info/exclude"]));
  let body = "";
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    /* not there yet */
  }
  if (body.split(/\r?\n/).some((l) => l.trim() === pattern)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${body && !body.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}

/** Merges the branch into main (a merge commit); answers main's commit. A conflict is undone and thrown. */
export function mergeIntoMain(d: ProjectDirs, branch: string, message: string): string {
  if (gitOk(d.repo, ["merge-base", "--is-ancestor", branch, "main"])) return git(d.repo, ["rev-parse", "main"]);
  try {
    git(d.repo, ["merge", "--no-ff", "-q", "-m", message, branch]);
  } catch (e) {
    gitOk(d.repo, ["merge", "--abort"]);
    throw e;
  }
  return git(d.repo, ["rev-parse", "main"]);
}

/** True once a build was merged into main (every build merges with a merge commit). */
export function hasBuiltCode(d: ProjectDirs): boolean {
  try {
    return Number(git(d.repo, ["rev-list", "--count", "--merges", "main"])) > 0;
  } catch {
    return false;
  }
}

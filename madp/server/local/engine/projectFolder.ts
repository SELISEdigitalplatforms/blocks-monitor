// The engine's folder of one project on the engine host (DEMO-SCOPE-31.10.md, "Engine folder layout on this PC"):
//
//   <MF_ENGINE_ROOT>/projects/<workspaceId>/<projectId>/
//     project.json             name, ids, branches, latest build + preview URL (no secrets)
//     repo/                    the project's own git repository (main = released code); made on first use
//     worktrees/<branch>/      one working folder per branch (build/m1, change/<ticketId>, ...)
//     inputs/                  files the people uploaded, downloaded from Blocks Storage
//     artifacts/               documents the engine writes (brief, BRD/PRD, plan, specs)
//     builds/<buildId>/        built output of one build (what the preview serves)
//     jobs/<jobId>-<attempt>/  per job: prompt, transcript, result, log
//     logs/
//
// Every id is checked against ID before a path is made; nothing is shared between projects; no git remote is added.
// Synchronous on purpose (one engine process per host): a first use makes the folders and the repository at once.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** One branch name segment (build/m1 = two segments). */
const BRANCH_PART = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const MAX_BRANCH_PARTS = 4;

export interface ProjectFolder {
  /** <root>/projects/<workspaceId>/<projectId> */
  readonly dir: string;
  readonly workspaceId: string;
  readonly projectId: string;
  /** The project's git repository (branch main, at least one commit). */
  readonly repo: string;
  readonly inputs: string;
  readonly artifacts: string;
  readonly logs: string;
  /** The working folder of a branch (worktrees/build/m1). Not made here: `git worktree add` makes it. */
  worktree(branch: string): string;
  /** The output folder of one build (made). */
  build(buildId: string): string;
  /** The folder of one job attempt (made). */
  job(jobId: string, attempt: number): string;
  /** project.json as stored ({} before the first write). */
  readProject(): Record<string, unknown>;
  /** Merges fields into project.json (never put secrets here). */
  updateProject(patch: Record<string, unknown>): Record<string, unknown>;
}

export function checkId(kind: string, v: string): string {
  if (typeof v !== "string" || !ID.test(v)) throw new Error(`invalid ${kind} for an engine folder`);
  return v;
}

export function checkBranch(branch: string): string[] {
  const parts = typeof branch === "string" ? branch.split("/") : [];
  if (parts.length < 1 || parts.length > MAX_BRANCH_PARTS || parts.some((p) => !BRANCH_PART.test(p) || p.endsWith(".lock") || p.includes(".."))) {
    throw new Error("invalid branch name for an engine worktree");
  }
  return parts;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "MADP engine",
  GIT_AUTHOR_EMAIL: "engine@madp.invalid",
  GIT_COMMITTER_NAME: "MADP engine",
  GIT_COMMITTER_EMAIL: "engine@madp.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).toString("utf8").trim();
}

/** Makes repo/ a git repository with a main branch and one first commit (so worktrees can branch from main). */
function ensureRepo(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  if (!fs.existsSync(path.join(repo, ".git"))) git(repo, ["init", "--quiet", "--initial-branch=main"]);
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/main"]);
  } catch {
    git(repo, ["commit", "--quiet", "--allow-empty", "-m", "Project folder created by the MADP engine"]);
  }
}

/** The engine root (MF_ENGINE_ROOT), or null when it is not set. */
export function engineRoot(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  const v = String(env.MF_ENGINE_ROOT ?? "").trim();
  if (v) return path.resolve(v);
  const fallback = path.resolve(process.cwd(), "..", "madp-factory-work", "engine-root");
  return fs.existsSync(fallback) ? fallback : null;
}

/** The project's folder under `root`; makes the folders, project.json and the repository on first use. */
export function projectWorkspace(root: string, workspaceId: string, projectId: string, o?: { name?: string }): ProjectFolder {
  checkId("workspace id", workspaceId);
  checkId("project id", projectId);
  const dir = path.join(path.resolve(root), "projects", workspaceId, projectId);
  const sub = (name: string) => path.join(dir, name);
  for (const name of ["inputs", "artifacts", "builds", "jobs", "logs", "worktrees"]) fs.mkdirSync(sub(name), { recursive: true });
  ensureRepo(sub("repo"));
  const file = sub("project.json");
  const readProject = (): Record<string, unknown> => {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const updateProject = (patch: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...readProject(), ...patch, workspaceId, projectId, updatedAt: new Date().toISOString() };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return next;
  };
  const current = readProject();
  if (!current.projectId || (o?.name && current.name !== o.name)) {
    updateProject({ ...(current.createdAt ? {} : { createdAt: new Date().toISOString(), branches: ["main"] }), ...(o?.name ? { name: o.name } : {}) });
  }
  return {
    dir,
    workspaceId,
    projectId,
    repo: sub("repo"),
    inputs: sub("inputs"),
    artifacts: sub("artifacts"),
    logs: sub("logs"),
    worktree: (branch) => path.join(sub("worktrees"), ...checkBranch(branch)),
    build(buildId) {
      const d = path.join(sub("builds"), checkId("build id", buildId));
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    job(jobId, attempt) {
      if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new Error("invalid job attempt for an engine folder");
      const d = path.join(sub("jobs"), `${checkId("job id", jobId)}-${attempt}`);
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    readProject,
    updateProject,
  };
}

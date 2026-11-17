// Where a real build lives and where its preview is served, and the switch between the real build and the board-only
// build (kinds/delivery.ts).
//
//   MF_ENGINE_BUILD=claude   build.run / change.build write the app with headless Claude Code, install and build it;
//                            preview.deploy publishes it on the preview server (build/previewServer.ts)
//   MF_ENGINE_BUILD=off      (default) the board-only build: tickets move through the columns, preview records only
//
//   MF_ENGINE_ROOT           everything the engine does on this PC (default madp-factory-work/engine-root next to the
//                            repository; later /srv/madp-factory). One folder per project, nothing shared:
//
//     <root>/projects/<workspaceId>/<projectId>/
//       project.json             name, ids, branches, builds, published versions, latest build + preview URL (no secrets)
//       repo/                    the project's own git repository (main = the accepted code)
//       worktrees/<branch>/      one working folder per branch (build/m1, change/<id>)
//       artifacts/               what the engine writes for the code writer (the build's spec)
//       builds/<buildId>/        the built output of one build (what the preview serves)
//       jobs/<jobId>-<attempt>/  per job: prompt, transcript, logs, result
//       logs/
//
//   MF_PREVIEW_ORIGIN        the preview server's address (default https://dbsaun.slsblx.com:5321)
//
// Read on every job, so a changed environment is used by the next job. Ids are checked before any path is made.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** frontend/ */
export const FRONTEND_DIR = path.resolve(HERE, "..", "..", "..", "..");
/** selise-madp/ */
const REPO_DIR = path.resolve(FRONTEND_DIR, "..");
/** madp-factory-work/ (next to the repository). */
const WORK_DIR = path.resolve(REPO_DIR, "..", "madp-factory-work");

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
/** A branch: one or two id segments (build/m1, change/<id>). */
export const BRANCH_RE = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64})?$/;

export type BuildMode = "claude" | "codex" | "off";

export function buildMode(env: NodeJS.ProcessEnv = process.env): BuildMode {
  const v = String(env.MF_ENGINE_BUILD ?? env.MF_ENGINE_BUILD_RUNNER ?? "").trim().toLowerCase();
  if (v === "claude") return "claude";
  if (v === "codex") return "codex";
  return "off";
}

export function engineRoot(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.MF_ENGINE_ROOT ?? "").trim();
  return v ? path.resolve(v) : path.join(WORK_DIR, "engine-root");
}

export function previewOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.MF_PREVIEW_ORIGIN ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+(:\d{2,5})?$/.test(v) ? v : "https://dbsaun.slsblx.com:5321";
}

export const ENGINE_HOST_DIR = path.join(WORK_DIR, "engine-host");
export const CERT_FILE = path.join(FRONTEND_DIR, ".cert", "dev-cert.pem");
export const KEY_FILE = path.join(FRONTEND_DIR, ".cert", "dev-key.pem");

/** A checked id (workspace, project, job, build): only letters, digits, _ and -, so it is safe in a path and a URL. */
export function safeId(id: string, what = "id"): string {
  if (!ID_RE.test(id)) throw new Error(`the ${what} "${id.slice(0, 80)}" cannot name an engine folder`);
  return id;
}

export interface ProjectDirs {
  root: string;
  projectJson: string;
  repo: string;
  worktrees: string;
  artifacts: string;
  builds: string;
  jobs: string;
  logs: string;
}

export function projectDirs(workspaceId: string, projectId: string, env: NodeJS.ProcessEnv = process.env): ProjectDirs {
  return projectDirsAt(path.join(engineRoot(env), "projects", safeId(workspaceId, "workspace id"), safeId(projectId, "project id")));
}

/** The layout under a project folder (the worker's projectWorkspace helper may name the folder). */
export function projectDirsAt(root: string): ProjectDirs {
  return {
    root,
    projectJson: path.join(root, "project.json"),
    repo: path.join(root, "repo"),
    worktrees: path.join(root, "worktrees"),
    artifacts: path.join(root, "artifacts"),
    builds: path.join(root, "builds"),
    jobs: path.join(root, "jobs"),
    logs: path.join(root, "logs"),
  };
}

export function worktreeDir(d: ProjectDirs, branch: string): string {
  if (!BRANCH_RE.test(branch)) throw new Error(`"${branch.slice(0, 80)}" cannot name a branch`);
  return path.join(d.worktrees, ...branch.split("/"));
}

export function buildDir(d: ProjectDirs, buildId: string): string {
  return path.join(d.builds, safeId(buildId, "build id"));
}

export function jobDir(d: ProjectDirs, jobId: string, attempt: number): string {
  return path.join(d.jobs, `${safeId(jobId, "job id")}-${Math.max(1, Math.floor(attempt))}`);
}

/** The folder of a project by its id alone (the preview server's addresses carry no workspace). */
export function findProjectRoot(projectId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!ID_RE.test(projectId)) return null;
  const base = path.join(engineRoot(env), "projects");
  let workspaces: string[] = [];
  try {
    workspaces = fs.readdirSync(base);
  } catch {
    return null;
  }
  for (const w of workspaces) {
    if (!ID_RE.test(w)) continue;
    const p = path.join(base, w, projectId);
    if (fs.existsSync(path.join(p, "project.json"))) return p;
  }
  return null;
}

/** The build id of a version: m1-v0-1-0, cr3-v1-0-1 (dots are not allowed in ids). */
export function buildIdOf(prefix: string, version: string): string {
  return safeId(`${prefix}-v${version.replace(/\./g, "-")}`, "build id");
}

/** The preview address of a published version (/<projectId>/v/<version>/), the latest build (/<projectId>/), or a
 *  promoted environment (/<projectId>/stage/, /<projectId>/production/). */
export function siteUrl(projectId: string, where: { version: string } | "latest" | "stage" | "production", env: NodeJS.ProcessEnv = process.env): string {
  const base = `${previewOrigin(env)}/${safeId(projectId, "project id")}/`;
  if (typeof where === "object") {
    if (!VERSION_RE.test(where.version)) throw new Error(`"${where.version}" is not a version`);
    return `${base}v/${where.version}/`;
  }
  return where === "latest" ? base : `${base}${where}/`;
}

// Where platform feedback goes (the team's private GitHub Projects board) and the GitHub sign-in that writes it.
//
// The sign-in, in this order:
//   1. MF_FEEDBACK_GITHUB_TOKEN, when set;
//   2. `gh auth token` with GH_CONFIG_DIR set to the feedback login's own gh config folder: MF_FEEDBACK_GH_CONFIG_DIR,
//      else /srv/madp-factory/home/.config/gh-feedback when it exists. The engine host's default gh login belongs to the
//      account that builds products and is never used or changed here;
//   3. nothing else: without the board's own login the host has no token and never claims the job.
// The gh program: MF_GH_BIN, else `gh` on PATH, else $HOME/.local/bin/gh. The token is never logged.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

export interface FeedbackConfig {
  projectId: string;
  statusFieldId: string;
  statusOptionId: string;
  /** "owner/repo" of the private repository that keeps the screenshots. */
  assetsRepo: string;
  assetsBranch: string;
  boardUrl: string;
}

export const FEEDBACK_DEFAULTS: FeedbackConfig = {
  projectId: "PVT_kwDOFS0xws4BrI9x",
  statusFieldId: "PVTSSF_lADOFS0xws4BrI9xzhpc-9Y",
  statusOptionId: "f75ad846", // "Backlog"
  assetsRepo: "SELISE-Products/madp-beta-feedback",
  assetsBranch: "main",
  boardUrl: "https://github.com/orgs/SELISE-Products/projects/1",
};

/** The feedback login's gh config folder on the production engine host. */
export const DEFAULT_FEEDBACK_GH_CONFIG_DIR = "/srv/madp-factory/home/.config/gh-feedback";

const pick = (v: string | undefined, d: string) => (v && v.trim() ? v.trim() : d);

export function feedbackConfig(env: Env = process.env): FeedbackConfig {
  return {
    projectId: pick(env.MF_FEEDBACK_GITHUB_PROJECT_ID, FEEDBACK_DEFAULTS.projectId),
    statusFieldId: pick(env.MF_FEEDBACK_STATUS_FIELD_ID, FEEDBACK_DEFAULTS.statusFieldId),
    statusOptionId: pick(env.MF_FEEDBACK_STATUS_OPTION_ID, FEEDBACK_DEFAULTS.statusOptionId),
    assetsRepo: pick(env.MF_FEEDBACK_ASSETS_REPO, FEEDBACK_DEFAULTS.assetsRepo),
    assetsBranch: FEEDBACK_DEFAULTS.assetsBranch,
    boardUrl: pick(env.MF_FEEDBACK_BOARD_URL, FEEDBACK_DEFAULTS.boardUrl).replace(/\/+$/, ""),
  };
}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The gh program: MF_GH_BIN, else `gh` on PATH, else $HOME/.local/bin/gh; null when none is there. */
export function ghBinary(env: Env = process.env): string | null {
  if (env.MF_GH_BIN?.trim()) return isFile(env.MF_GH_BIN.trim()) ? env.MF_GH_BIN.trim() : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, "gh");
    if (isFile(p)) return p;
  }
  const home = env.HOME || os.homedir();
  const local = path.join(home, ".local", "bin", "gh");
  return isFile(local) ? local : null;
}

/** The gh config folder of the feedback login (GH_CONFIG_DIR for `gh auth token`); null: gh's own default. */
export function feedbackGhConfigDir(env: Env = process.env, exists: (p: string) => boolean = isDir): string | null {
  if (env.MF_FEEDBACK_GH_CONFIG_DIR?.trim()) return env.MF_FEEDBACK_GH_CONFIG_DIR.trim();
  return exists(DEFAULT_FEEDBACK_GH_CONFIG_DIR) ? DEFAULT_FEEDBACK_GH_CONFIG_DIR : null;
}

/** Runs a program and answers its standard output (rejects on a non-zero exit or a timeout). */
export type Exec = (file: string, args: string[], o: { env: Env; timeoutMs: number }) => Promise<string>;

const execOut: Exec = (file, args, o) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: o.env as NodeJS.ProcessEnv, timeout: o.timeoutMs, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(`${path.basename(file)} ${args.join(" ")} exited with an error`));
      else resolve(String(stdout));
    });
  });

/** The GitHub token for the board; null when no sign-in is configured. Never logged, never in an error message. */
export async function feedbackToken(env: Env = process.env, exec: Exec = execOut, exists?: (p: string) => boolean): Promise<string | null> {
  const direct = env.MF_FEEDBACK_GITHUB_TOKEN?.trim();
  if (direct) return direct;
  const gh = ghBinary(env);
  if (!gh) return null;
  // only the board's own login answers: never a developer's or the product builds' default gh login
  const configDir = feedbackGhConfigDir(env, exists);
  if (!configDir) return null;
  const childEnv: Env = { ...env, GH_CONFIG_DIR: configDir };
  // gh answers GH_TOKEN / GITHUB_TOKEN before its own login: the feedback login must be the one that answers
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  try {
    const out = (await exec(gh, ["auth", "token"], { env: childEnv, timeoutMs: 15_000 })).trim();
    return /^[A-Za-z0-9_.-]{20,255}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Cheap check (no program run, no network) whether this host has a sign-in for the board: a token in the environment,
 *  or the gh program and a gh login (hosts.yml) in the feedback config folder (else gh's own default folder). A host
 *  that answers false never claims a platform.feedback job (jobScope.ts). */
export function feedbackHostReady(env: Env = process.env): boolean {
  if (env.MF_FEEDBACK_GITHUB_TOKEN?.trim()) return true;
  if (!ghBinary(env)) return false;
  // only the board's own login (its own gh config folder) counts; a default gh login on a developer PC never does
  const dir = feedbackGhConfigDir(env);
  return dir !== null && isFile(path.join(dir, "hosts.yml"));
}

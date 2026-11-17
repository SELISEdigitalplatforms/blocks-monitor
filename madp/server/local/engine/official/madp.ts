// The official MADP engine (engine/selise-madp): the one engine that writes, checks, commits, pushes and deploys the
// products the Factory plans. The Factory's planning and conversation steps hand their result to its lanes
// (MADP/QUICK-LANE.md): `new-app` sets a product up (api + web repos, Blocks), `feature` builds a milestone or a change
// (planner, parallel dev agents, gate, commit, push, deploy, smoke and, for a repo whose registry has `acceptance:`, the
// change's own live tests on dev: step accept[<repo>], exit 12 when they fail), `quick` ships a one-ticket change and `promote`
// fast-forwards a tested dev commit to stage or production. This file runs a lane for a job and reads its progress.
import { spawn } from "node:child_process";
import { recordLaneUsage } from "../usage.ts";
import fs from "node:fs";
import path from "node:path";
import { CAPACITY_CODE, capacityMessage, fallbackSettings, laneCapacity, type CapacityHit } from "../../../api/extraction/claudeCapacity.ts";
import { JobFailure, type JobRun } from "../run.ts";
import { JOB_MESSAGE_MAX } from "../../../../src/domain/jobMessage";
import { madpPython as python, officialHome } from "./home.ts";
import { accountPool, laneUsage } from "../ai/accountPool.ts";
import { redactedOutput, repositoryEnvironment } from "./repositoryEnvironment.ts";

export { officialHome };

/** What a lane's exit code means (MADP/QUICK-LANE.md "Exit codes"), in plain words for the job's message. */
export const LANE_EXIT: Record<number, { code: string; text: string }> = {
  2: { code: "madp.registry", text: "the product's MADP settings are incomplete" },
  3: { code: "madp.preflight", text: "the preflight stopped it (branch, Blocks login, pull or files changed by hand)" },
  4: { code: "madp.agent", text: "the development agent did not finish" },
  5: { code: "madp.verify", text: "the code did not pass the checks (type check or build), also after one fix-up pass" },
  6: { code: "madp.review", text: "the reviewer did not approve the change" },
  7: { code: "madp.git", text: "the commit or push to GitHub failed" },
  8: { code: "madp.deploy", text: "the Blocks deployment failed" },
  9: { code: "madp.smoke", text: "the deployed app did not answer the smoke test" },
  10: { code: "madp.ownership", text: "an agent changed files outside its step" },
  11: { code: "madp.plan", text: "the planner's plan was not usable" },
  // after commit, push, deploy and smoke: the change is live, nothing was rolled back (QUICK-LANE.md "Live acceptance")
  12: { code: "madp.accept", text: "the change's own tests on the development environment did not pass (nothing was rolled back)" },
};

/** What happens next after a lane stopped with an exit code, and who acts (the job's line says it after the cause). */
const AGAIN = "Start it again; if it stops there again, ask the engine team to look into it.";
export const LANE_NEXT: Record<number, string> = {
  2: "Ask the engine team to complete them, then start it again.",
  3: "Start it again in a few minutes; if it stops there again, ask the engine team to look into it.",
  4: AGAIN,
  5: "Start it again for another try, or describe the change more precisely.",
  6: "Start it again for another try, or describe the change more precisely.",
  7: AGAIN,
  8: "Start it again in a few minutes; if the deployment fails again, ask the engine team to look into it.",
  9: "Start it again in a few minutes; if the app still does not answer, ask the engine team to look into it.",
  10: AGAIN,
  11: "Start it again for a new plan; if it stops there again, describe the work more precisely.",
};

/** Exit codes after which the change IS deployed and live, but needs attention (not a failed build or deploy). */
export const LANE_ATTENTION: ReadonlySet<number> = new Set([12]);
export const needsAttention = (code: number): boolean => LANE_ATTENTION.has(code);

export interface LaneStep {
  /** The lane's step name: plan, dev, gate[web], commit[api], deploy[web], smoke[web], ... */
  name: string;
  outcome: string;
  seconds: number;
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** One progress line of a lane (`Run.step` in cli/quick.py, printed on stderr): "▸ gate[web]: pass (18.2s)". */
export function parseStepLine(raw: string): LaneStep | null {
  const line = raw.replace(ANSI, "").replace(/^[\s▸✓✗•-]+/, "").trim();
  const m = /^([a-z][a-z0-9_-]*(?:\[[^\]]{1,40}\])?): (.*) \((\d+(?:\.\d+)?)s\)$/.exec(line);
  return m ? { name: m[1]!, outcome: m[2]!.trim(), seconds: Number(m[3]) } : null;
}

/** The step's family: "gate[web]" -> "gate". */
export const stepFamily = (name: string): string => name.replace(/\[.*$/, "").replace(/-.*$/, "");

export interface LaneResult {
  code: number;
  /** stdout (the lane's summary and, with --json, its JSON). */
  stdout: string;
  /** The last lines of stderr, for the job log and the failure message. */
  tail: string[];
  steps: LaneStep[];
  /** Set when the lane stopped because the AI capacity is used up (its agent log or its own words say so). */
  capacity?: CapacityHit | null;
}

export interface LaneOptions {
  /** The product's MADP folder: MADP_PROJECT_DIR, reports, the lane's log. */
  projectDir: string;
  /** For the log file name: "feature", "quick", "new-app", "promote". */
  label: string;
  timeoutMs: number;
  onStep?: (s: LaneStep) => Promise<void> | void;
  /** The product environment's own Blocks login store (blocksLogin.ts): BLOCKS_CONFIG_DIR of the lane and everything
   *  it starts. The registry's cli_config_dir sets it for the CLI calls too (deploy_ops.cli_env). */
  blocksConfigDir?: string;
}

/** Runs one official lane for the job: `python -m MADP.orchestrator.cli.project <args>` from the official engine's
 *  folder (as bin/madp does), its progress on the job, its full output in the product's MADP log folder. The job's
 *  heartbeat continues while it runs; stopping the job stops the lane (its whole process group). */
export async function runLane(run: JobRun, args: string[], o: LaneOptions): Promise<LaneResult> {
  const repository = await repositoryEnvironment(run);
  const home = officialHome();
  if (!fs.existsSync(path.join(home, "MADP", "orchestrator", "cli", "project.py"))) {
    throw new JobFailure("The official MADP engine is not installed on the engine host.", "madp.missing");
  }
  const logs = path.join(o.projectDir, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const logFile = path.join(logs, `${run.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}-${o.label}.log`);
  const log = fs.createWriteStream(logFile, { flags: "a" });
  // the lane's log is for the engine team: a failed write (full disk, folder removed) never stops the lane or the worker
  log.on("error", () => undefined);
  log.write(`\n$ madp ${args.join(" ")}\n`);
  const startedAt = Date.now();
  const reportDirs = ["feature", "quick", "promote"].map((k) => path.join(o.projectDir, "reports", k));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // the lanes' own subscription-limit fallback (auth_fallback.py) finds the same key and limit record as the Factory
    ...fallbackSettings(process.env),
    MADP_PROJECT_DIR: o.projectDir,
    MADP_FRAMEWORK_HOME: home,
    MADP_FEATURE_REPORT_DIR: reportDirs[0],
    MADP_QUICK_REPORT_DIR: reportDirs[1],
    MADP_PROMOTE_REPORT_DIR: reportDirs[2],
    // a gate's dictionary check (uilm_sync.py) writes its report here, not in the read-only official engine
    MADP_UILM_REPORT_DIR: path.join(o.projectDir, "reports", "uilm"),
    // `madp accept` (the acceptance step alone) writes its report here
    MADP_ACCEPT_REPORT_DIR: path.join(o.projectDir, "reports", "accept"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    BLOCKS_NO_UPDATE_CHECK: "1",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
    ...(o.blocksConfigDir ? { BLOCKS_CONFIG_DIR: o.blocksConfigDir } : {}),
    ...repository.env,
  };
  // the AI account pool (accountPool.ts): the lane runs on the account with the most headroom; without a pool exactly
  // as before (the host's single login)
  const lease = accountPool()?.lease() ?? null;
  const laneEnv = lease ? lease.env(env) : env;
  if (lease) log.write(`[account ${lease.label}]\n`);
  const child = spawn(python(), ["-B", "-m", "MADP.orchestrator.cli.project", ...args], {
    cwd: home,
    env: laneEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const steps: LaneStep[] = [];
  const tail: string[] = [];
  let stdout = "";
  let pending = Promise.resolve();
  const out = redactedOutput(repository.redact, (safe) => { stdout += safe; log.write(safe); });
  const errorOutput = redactedOutput(repository.redact, (safe) => {
      const clean = safe.replace(ANSI, "").trimEnd();
      log.write(clean + "\n");
      if (!clean.trim()) return;
      tail.push(clean);
      if (tail.length > 40) tail.shift();
      const s = parseStepLine(clean);
      if (s) {
        steps.push(s);
        if (o.onStep) pending = pending.then(() => o.onStep!(s)).catch((e) => run.log(`step hook: ${String(e).slice(0, 160)}`));
      }
  });
  child.stdout.on("data", (d: Buffer) => out.push(d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => errorOutput.push(d.toString("utf8")));
  const kill = (sig: NodeJS.Signals) => {
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* gone */
    }
  };
  const onAbort = () => {
    kill("SIGTERM");
    setTimeout(() => kill("SIGKILL"), 10_000).unref();
  };
  run.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(onAbort, o.timeoutMs);
  const beat = setInterval(() => void run.heartbeat().catch(() => undefined), 20_000);
  const code: number = await new Promise((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (c) => resolve(c ?? 1));
  });
  clearTimeout(timer);
  out.flush();
  errorOutput.flush();
  clearInterval(beat);
  run.signal.removeEventListener("abort", onAbort);
  await pending;
  // the whole output is in the log before the result is read ("close" also follows a failed write)
  await new Promise<void>((resolve) => {
    if (log.destroyed) return resolve(); // a failed write already closed it
    log.once("close", () => resolve());
    log.end(`\n[exit ${code}]\n`);
  });
  // operators read the lane's own words in the engine log; people get the plain message (laneFailure)
  if (code !== 0) run.log(`madp ${o.label} exit ${code}: ${tail.slice(-6).join(" | ").replace(/\s+/g, " ").slice(0, 900)}`);
  // what the lane's agents cost goes onto the job and the organization's credit, failed or stopped lanes included
  // (usage.ts); a failed write never fails the lane
  try {
    const usage = await recordLaneUsage(run.deps.gateway, run.id, stdout, run.now().toISOString());
    if (usage) run.log(`madp ${o.label} usage: ${usage.tokens.total} tokens, cost $${usage.costUsd.toFixed(4)} so far for this job`);
  } catch (e) {
    run.log(`madp ${o.label} usage not recorded: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
  }
  run.check();
  // out of AI capacity (claudeCapacity.ts): the job gets the plain capacity message, not the lane's failure
  const capacity = code !== 0 ? laneCapacity({ texts: [...tail, stdout.slice(-20_000)], reportDirs, since: startedAt }) : null;
  if (capacity) run.log(`madp ${o.label}: stopped because the AI capacity is used up (${capacity.kind})`);
  if (lease) {
    try {
      lease.done({ capacity, usage: laneUsage({ reportDirs, since: startedAt }) });
    } catch {
      lease.done();
    }
  }
  return { code, stdout, tail, steps, capacity };
}

/** The step a lane stopped at: new-app's "✗ step data-sync failed", else the last step that reported FAIL. */
export function failedStep(r: Pick<LaneResult, "tail" | "steps">): string {
  for (const line of [...r.tail].reverse()) {
    const m = /step ([a-z][a-z0-9_-]*) failed/i.exec(line);
    if (m) return m[1]!;
  }
  return [...r.steps].reverse().find((s) => /\bfail/i.test(s.outcome))?.name ?? "";
}

/** A lane step in the words people read on the build page. */
export function plainStep(step: string): string {
  const s = step.replace(/\[.*$/, "");
  const part = /-(api|web)$/.exec(s)?.[1] ?? /\[(api|web)\]/.exec(step)?.[1];
  const of = part === "api" ? " of the API" : part === "web" ? " of the web app" : "";
  const base = s === "live-debug" ? "live" : s.replace(/-(api|web)$/, "");
  // accept[<repo>]: the change's own live tests against the deployed dev environment (after deploy and smoke)
  if (base === "accept") return `checking the ${part === "api" ? "API " : part === "web" ? "web app " : ""}change on the development environment`;
  const words: Record<string, string> = {
    scaffold: "creating the app", "overlay": "creating the app", "render": "creating the app", "git-init": "creating the repository",
    "npm-install": "installing the packages", "blocks-login": "checking the Blocks sign-in", "blocks-project-get": "reading the Blocks project",
    "blocks-use": "selecting the Blocks project", "git-add": "the first commit", "git-commit": "the first commit",
    "github-create": "creating the GitHub repository", "git-remote": "connecting GitHub", "git-push": "the first push to GitHub",
    register: "registering the product", "data-sync-dry-run": "checking the product's data setup", "data-sync": "setting up the product's data",
    secrets: "the deployment settings", "release-linked": "the link to Blocks Release", "release-setup-dry-run": "preparing the first deployment",
    "release-setup": "the first deployment", smoke: "the smoke test", preflight: "the preflight", plan: "planning the work", dev: "writing the code",
    ownership: "checking the agents' files", gate: "the checks", verify: "the checks", review: "the review", commit: "the commit",
    push: "the push to GitHub", deploy: "the deployment", locate: "finding the code to change",
    // live debugging (a fix round) and the change's record in the repos
    live: "preparing the checks on the development environment", reproduce: "running the failing tests on the development environment",
    record: "the change's record",
    // a fix round with depth (the engine's fix_round_ops.py)
    iteration: "the fix round's next deploy", diagnose: "finding the cause of the failing checks", depth: "deciding how deep the fix goes",
    previous: "reading what the round before changed", guard: "checking that the change fixes what failed",
    "guard-retry": "a second pass on a change that did not fix what failed", "guard-2": "checking the second pass",
    recheck: "running the failing tests again on the development environment",
    // parallel streams: the turn to land, the work brought onto what landed meanwhile, a conflict merged with both intents
    "merge-turn": "waiting for its turn to land", "pre-rebase": "bringing the work onto what landed meanwhile",
    "conflict-fix": "resolving a conflict with a change that landed",
    // a fix round that found the failing checks are the environment's: nothing to change, a person decides
    "nothing-to-change": "finding that the failing checks are the environment's",
  };
  return `${words[base] ?? base.replace(/[-_]+/g, " ")}${of}`;
}

/** The first of `lines` that fits a job's line (JOB_MESSAGE_MAX), so what happens next is never cut off; else the
 *  shortest, cut (pure). */
function fitting(lines: string[]): string {
  return lines.find((l) => l.length <= JOB_MESSAGE_MAX) ?? lines[lines.length - 1]!.slice(0, JOB_MESSAGE_MAX);
}

/** Fails the job in plain words: what stopped, at which step, why in general terms, and what happens next and who acts
 *  (a line that would be too long drops the step first, then the cause, never the next step). The lane's own output
 *  stays in the engine log and the product's lane log (never on the page: it holds tool noise and host details).
 *  `fix`: the work was a fix round of a change (a person decides on the change's page). */
export function laneFailure(what: string, r: Pick<LaneResult, "code" | "tail" | "steps"> & Pick<Partial<LaneResult>, "capacity">, o: { fix?: boolean } = {}): JobFailure {
  if (r.capacity) return new JobFailure(capacityMessage(r.capacity), CAPACITY_CODE);
  // the agent ran to its end but changed no file (quick lane status "FAILED (no_changes)"): not "did not finish". A fix
  // round whose failing checks are the environment's never gets here: the engine ends it "nothing to change"
  if (r.code === 4 && r.tail.some((l) => /\bno_changes\b/.test(l))) {
    const next = o.fix ? "Decide on the change's page how to go on." : "Describe the change more precisely and start it again.";
    return new JobFailure(fitting([`${what} stopped: the development agent found nothing to change, so nothing was deployed. ${next}`, `${what} stopped: nothing to change was found. ${next}`]), "madp.no_changes");
  }
  const known = LANE_EXIT[r.code];
  const step = failedStep(r);
  const at = step ? ` at "${plainStep(step)}"` : "";
  // deployed and live: never worded as a stopped build (the deploy stands; the change needs attention)
  if (known && needsAttention(r.code)) return new JobFailure(`${what} is on dev, but not usable yet${at}: ${known.text}. What the checks found goes back to the development team to fix.`.slice(0, 300), known.code);
  const next = (known && LANE_NEXT[r.code]) || AGAIN;
  const lines = known
    ? [`${what} stopped${at}: ${known.text}. ${next}`, `${what} stopped: ${known.text}. ${next}`, `${what} stopped${at}. ${next}`, `${what} stopped. ${next}`]
    : [`${what} stopped${at}. ${next}`, `${what} stopped. ${next}`];
  return new JobFailure(fitting(lines), known?.code ?? (step ? `madp.${step.replace(/\[.*$/, "")}` : "madp.failed"));
}

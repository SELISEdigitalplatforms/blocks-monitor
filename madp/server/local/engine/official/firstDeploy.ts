// The first deployment of a former template builder's product (legacy.ts) on the official MADP engine. Such a product
// is onboarded as an existing one-repo product, but its Blocks deployment never ran through the official engine (the
// former builder's own release adapter is gone), so its dev address can still answer 404. Its first preview or dev
// release therefore deploys the dev commit as it is (no code change) through the official engine's own deploy, the code
// every lane deploys with (MADP/orchestrator/primitives/deploy_ops.py): the explicit dev tenant and account, the
// product's own Blocks login store, `release repos list` (the repo linked on branch dev), a `--dry-run` that must
// confirm tenant, repo, branch and environment, `release setup` for a repo never deployed (else `release deploy`),
// `--wait` for the verdict, then the registry's health URLs as its smoke check. The Factory never calls the Blocks CLI
// for it. Done once: factory.json records the commit (`firstDeploy`); later builds deploy through their lanes.
import fs from "node:fs";
import { JobFailure, type JobRun } from "../run.ts";
import { linkMessage, projectRepoOwner, readState, writeState, type OfficialApp } from "./app.ts";
import { runCommand, type Exec } from "./attach.ts";
import { releaseAccount, storeOf } from "./blocksLogin.ts";
import { madpPython, officialHome } from "./home.ts";
import { deployOrder, parseRegistry, registryRepos, shownRepo } from "./hostRegistry.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The official engine's deploy of every registry repo (API-role repos first) to one environment, then the smoke check
 *  of its health URLs, as the lanes do it. It prints one line, `MADP_DEPLOY <json>`: per repo its verdict, build and
 *  smoke status codes, and an error code when it stopped. Never the CLI's output, which can hold account details. */
export const DEPLOY_DRIVER = [
  "import json, sys",
  "from MADP.orchestrator.primitives import deploy_ops, project_registry as reg",
  "project = reg.load(sys.argv[1])",
  "env = sys.argv[2]",
  "out = {'repos': []}",
  "order = sorted(project.repos, key=lambda k: {'api': 0, 'web': 1}.get(project.repos[k].role or k, 2))",
  "try:",
  "    deploy_ops.require_project_target(project, env)",
  "    deploy_ops.require_login(project, env=env)",
  "    for key in order:",
  "        d = deploy_ops.release_deploy(project, key, env)",
  "        item = {'repo': key, 'verdict': d.verdict, 'build': d.build_id}",
  "        out['repos'].append(item)",
  "        if not d.ok:",
  "            out['error'] = 'deploy_failed'",
  "            break",
  "        urls = list(project.health_for(key, env))",
  "        sm = deploy_ops.smoke(urls) if urls else []",
  "        item['smoke'] = [{'url': s.url, 'status': s.status, 'ok': s.ok} for s in sm]",
  "        if any(not s.ok for s in sm):",
  "            out['error'] = 'smoke_failed'",
  "            break",
  "except deploy_ops.DeployError as exc:",
  "    out['error'] = exc.code",
  "except reg.RegistryError:",
  "    out['error'] = 'registry'",
  "print('MADP_DEPLOY ' + json.dumps(out), flush=True)",
  "sys.exit(1 if 'error' in out else 0)",
].join("\n");

export interface DeployOutcome {
  repos: Array<{ repo: string; verdict: string; build: string; smoke?: Array<{ url: string; status: number; ok: boolean }> }>;
  error?: string;
}

/** The driver's one line (null when it printed none: it did not run). */
export function deployOutcomeOf(stdout: string): DeployOutcome | null {
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith("MADP_DEPLOY "));
  if (!line) return null;
  try {
    const doc = rec(JSON.parse(line.slice("MADP_DEPLOY ".length)));
    const repos = (Array.isArray(doc.repos) ? doc.repos : []).map(rec).map((r) => ({
      repo: text(r.repo),
      verdict: text(r.verdict),
      build: text(r.build),
      ...(Array.isArray(r.smoke) ? { smoke: r.smoke.map(rec).map((s) => ({ url: text(s.url), status: Number(s.status) || 0, ok: s.ok === true })) } : {}),
    }));
    return { repos, ...(text(doc.error) ? { error: text(doc.error) } : {}) };
  } catch {
    return null;
  }
}

export interface FirstDeployDeps {
  exec?: Exec;
  engineHome?: string;
  now?: () => Date;
}

/** The first deployment of a former product's dev commit, once (factory.json `legacy: true` without `firstDeploy`).
 *  Answers true when it deployed now, false when there was nothing to do. Fails in plain words. */
export async function ensureFirstDeploy(run: JobRun, app: OfficialApp, step: (pct: number, line: string) => Promise<void>, deps: FirstDeployDeps = {}): Promise<boolean> {
  const state = readState(app.dir);
  if (state.legacy !== true || state.firstDeploy) return false;
  const exec = deps.exec ?? runCommand;
  const data = parseRegistry(fs.readFileSync(app.registry, "utf8"));
  const repos = deployOrder(registryRepos(data));
  // the commit Blocks Release deploys is the dev branch on GitHub: the clone follows it (fast-forward only), so the
  // commit the onboarding checked and the one recorded are the one deployed
  const commits: string[] = [];
  for (const r of repos) {
    const git = (...args: string[]) => exec("git", ["-C", r.path, ...args], { timeoutMs: 5 * 60_000 });
    const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
    const synced = branch === "dev" && (await git("fetch", "--quiet", "origin", "dev")).code === 0 && (await git("merge", "--ff-only", "--quiet", "origin/dev")).code === 0;
    if (!synced) {
      run.log(`first deploy ${app.name}: ${r.key} is on "${branch || "?"}" or differs from origin/dev`);
      throw new JobFailure("The product's copy on the engine host does not match its dev branch on GitHub, so it was not deployed. Ask the engine team to bring the copy up to date, then start it again.", "madp.first_deploy");
    }
    commits.push((await git("rev-parse", "HEAD")).stdout.trim());
  }
  const commit = commits[0] ?? "";
  await step(30, `First deployment of ${run.p.name} on Blocks with the official MADP engine: its dev commit ${commit.slice(0, 7)} as it is, no code change.`);
  const engineHome = deps.engineHome || officialHome();
  const beat = setInterval(() => void run.heartbeat().catch(() => undefined), 20_000);
  let r: Awaited<ReturnType<Exec>>;
  try {
    r = await exec(madpPython(), ["-B", "-c", DEPLOY_DRIVER, app.registry, "dev"], {
      cwd: engineHome,
      timeoutMs: 45 * 60_000,
      // the product's own Blocks login store (ensureApp connected it) and the account the lanes use
      env: { BLOCKS_CONFIG_DIR: storeOf(data, app.name, "dev"), MF_BLOCKS_RELEASE_ACCOUNT: releaseAccount(data), MADP_PROJECT_DIR: app.dir, MADP_FRAMEWORK_HOME: engineHome, PYTHONUNBUFFERED: "1" },
    });
  } finally {
    clearInterval(beat);
  }
  run.check();
  const out = deployOutcomeOf(r.stdout);
  const summary = out ? out.repos.map((x) => `${x.repo} ${x.verdict || "?"}${x.build ? ` (build ${x.build})` : ""}`).join(", ") : "";
  if (!out || out.error || r.code !== 0) {
    run.log(`first deploy ${app.name}: ${out ? `${out.error ?? `exit ${r.code}`}${summary ? `: ${summary}` : ""}` : `the official deploy did not run (exit ${r.code})`}`);
    const failed = out?.repos.at(-1);
    const repo = repos.find((x) => x.key === failed?.repo) ?? repos[0]!;
    // the repository as people read it: never the GitHub account MADP Factory keeps the code in (shownRepo)
    const owner = projectRepoOwner(run);
    const shown = shownRepo(repo.repo, owner);
    if (out?.error === "repo_not_linked") throw new JobFailure(linkMessage(repos, owner), "madp.link_repos");
    if (out?.error === "deploy_failed") throw new JobFailure(`The first deployment of ${shown} on Blocks ended "${failed?.verdict || "failed"}". Start it again in a few minutes; if it fails again, ask the engine team to look into it.`, "madp.first_deploy");
    if (out?.error === "smoke_failed") throw new JobFailure(`The repository ${shown} is deployed on Blocks, but it did not answer the smoke test. Start it again in a few minutes; if it still does not answer, ask the engine team to look into it.`, "madp.smoke");
    if (out?.error === "not_logged_in") throw new JobFailure(`The Blocks sign-in of ${run.p.name} is not usable. Start it again to connect it to Blocks.`, "blocks.connect_unavailable");
    throw new JobFailure(`The first deployment of ${run.p.name} on Blocks did not go through. Start it again in a few minutes; if it fails again, ask the engine team to look into it.`, "madp.first_deploy");
  }
  writeState(app.dir, { ...readState(app.dir), firstDeploy: { commit, at: (deps.now ?? (() => new Date()))().toISOString() } });
  run.log(`first deploy ${app.name}: ${commit.slice(0, 12)} ${summary}`);
  return true;
}

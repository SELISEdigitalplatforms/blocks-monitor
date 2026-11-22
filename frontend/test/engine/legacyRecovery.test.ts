// Recovering a product of the Factory's former template builder on the official MADP engine: the builder's commits that
// only its clone on the engine host has go to GitHub as branch dev (plain push, never forced), and the first preview
// deploys the dev commit through the official engine's own deploy (deploy_ops), once. Temp git repos, local bare
// remotes, a fake runner and a fake Blocks CLI only: no network, no Blocks, no GitHub.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Exec } from "../../server/local/engine/official/attach.ts";
import { DEPLOY_DRIVER, deployOutcomeOf, ensureFirstDeploy } from "../../server/local/engine/official/firstDeploy.ts";
import { officialHome } from "../../server/local/engine/official/home.ts";
import { legacyRegistry, pushBuilderWork } from "../../server/local/engine/official/legacy.ts";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import type { JobRun } from "../../server/local/engine/run.ts";

const DEV = `D${"0123456789abcdef".repeat(2)}`;
const ENGINE = officialHome();
const hasPython = spawnSync("python3", ["-c", "import yaml"], { stdio: "ignore" }).status === 0 && fs.existsSync(path.join(ENGINE, "MADP", "orchestrator", "primitives", "deploy_ops.py"));

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-legacy-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}
/** A commit of one file in the repo. */
function commit(repo: string, file: string, body: string): string {
  fs.writeFileSync(path.join(repo, file), body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `add ${file}`);
  return git(repo, "rev-parse", "HEAD");
}
/** <tmp>/git/example-org/shop.git with a main branch, and the former builder's clone of it whose origin names GitHub. */
function remoteAndBuilderClone(): { bare: string; remote: string; clone: string } {
  const work = path.join(tmp, "work");
  fs.mkdirSync(work, { recursive: true });
  git(work, "init", "-q", "-b", "main");
  commit(work, "package.json", "{}\n");
  const bare = path.join(tmp, "git", "example-org", "shop.git");
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  git(tmp, "clone", "-q", "--bare", work, bare);
  const clone = path.join(tmp, "project", "repo");
  git(tmp, "clone", "-q", bare, clone);
  git(clone, "remote", "set-url", "origin", "https://github.com/example-org/shop.git");
  return { bare, remote: `file://${bare}`, clone };
}

/** The JobRun parts the recovery uses. */
function fakeRun(): JobRun & { lines: string[]; logs: string[] } {
  const lines: string[] = [];
  const logs: string[] = [];
  return {
    id: "job-1",
    projectId: "proj-1",
    p: { name: "Shop", project: {}, rows: () => [] },
    signal: new AbortController().signal,
    heartbeat: async () => undefined,
    log: (l: string) => void logs.push(l),
    check: () => undefined,
    step: async (_p: number, l: string) => void lines.push(l),
    lines,
    logs,
  } as unknown as JobRun & { lines: string[]; logs: string[] };
}

describe("the former builder's unpushed commits", () => {
  it("are pushed to GitHub as a new branch dev, a plain push; the builder's clone keeps its own branches", async () => {
    const { bare, remote, clone } = remoteAndBuilderClone();
    const mainBefore = git(bare, "rev-parse", "main");
    commit(clone, "a.ts", "export const a = 1;\n");
    const built = commit(clone, "b.ts", "export const b = 2;\n");
    const run = fakeRun();
    const r = await pushBuilderWork(run, runCommand, clone, remote, "example-org/shop");
    expect(r.pushed).toBe(true);
    expect(r.notes[0]).toMatch(/^2 commits of the former builder .* pushed to GitHub as branch "dev" \(a new branch\)/);
    // the report names the repository, never the GitHub account it is in (the project's record names none)
    expect(r.notes[0]).toMatch(/Release must list shop on branch "dev"\.$/);
    expect(r.notes.join("\n")).not.toContain("example-org");
    expect(git(bare, "rev-parse", "dev")).toBe(built);
    expect(git(bare, "rev-parse", "main")).toBe(mainBefore);
    expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(clone, "rev-parse", "HEAD")).toBe(built);
    // nothing left to push the next time
    expect(await pushBuilderWork(run, runCommand, clone, remote, "example-org/shop")).toEqual({ pushed: false, notes: [] });
  });

  it("move dev forward when GitHub's dev is part of the builder's work; uncommitted changes stay and are named", async () => {
    const { bare, remote, clone } = remoteAndBuilderClone();
    git(clone, "push", "-q", remote, "HEAD:refs/heads/dev");
    const built = commit(clone, "c.ts", "export const c = 3;\n");
    fs.writeFileSync(path.join(clone, "draft.ts"), "// never committed\n");
    const r = await pushBuilderWork(fakeRun(), runCommand, clone, remote, "example-org/shop");
    expect(r.pushed).toBe(true);
    expect(r.notes[0]).toMatch(/^1 commit of the former builder .* was pushed to GitHub as branch "dev"\./);
    expect(r.notes[1]).toMatch(/never committed; they stay there/);
    expect(git(bare, "rev-parse", "dev")).toBe(built);
    expect(fs.existsSync(path.join(clone, "draft.ts"))).toBe(true);
  });

  it("stop in plain words, pushing nothing, when GitHub's dev has other work", async () => {
    const { bare, remote, clone } = remoteAndBuilderClone();
    // someone else's dev on GitHub
    const other = path.join(tmp, "other");
    git(tmp, "clone", "-q", bare, other);
    const theirs = commit(other, "theirs.ts", "export const t = 0;\n");
    git(other, "push", "-q", "origin", "HEAD:refs/heads/dev");
    commit(clone, "mine.ts", "export const m = 1;\n");
    await expect(pushBuilderWork(fakeRun(), runCommand, clone, remote, "example-org/shop")).rejects.toMatchObject({
      code: "madp.legacy_unpushed",
      message: expect.stringMatching(/Nothing was pushed or changed/),
    });
    expect(git(bare, "rev-parse", "dev")).toBe(theirs);
  });

  it("leave a clone of another repository, or one without commits GitHub lacks, as it is", async () => {
    const { remote, clone } = remoteAndBuilderClone();
    commit(clone, "x.ts", "x\n");
    git(clone, "remote", "set-url", "origin", "https://github.com/example-org/other.git");
    expect(await pushBuilderWork(fakeRun(), runCommand, clone, remote, "example-org/shop")).toEqual({ pushed: false, notes: [] });
    expect(await pushBuilderWork(fakeRun(), runCommand, path.join(tmp, "none"), remote, "example-org/shop")).toEqual({ pushed: false, notes: [] });
  });
});

/** An onboarded former product: its registry, factory.json and the clone of GitHub's dev (a local bare remote). */
function onboarded(o: { cliRunJs?: string; health?: boolean } = {}): { app: OfficialApp; bare: string; store: string } {
  const { bare, clone } = remoteAndBuilderClone();
  git(clone, "push", "-q", `file://${bare}`, "HEAD:refs/heads/dev");
  const dir = path.join(tmp, "project", "madp");
  const repo = path.join(dir, "shop-proj01-app");
  fs.mkdirSync(dir, { recursive: true });
  git(tmp, "clone", "-q", "--branch", "dev", bare, repo);
  const store = path.join(tmp, "stores", "shop-proj01-dev");
  const data = legacyRegistry({
    name: "shop-proj01", repoPath: repo, repo: "example-org/shop", tenant: DEV, url: o.health ? "https://shop.example.test" : "", cliRunJs: o.cliRunJs ?? path.join(tmp, "cli.js"),
    description: "Shop", checks: { verify: [{ name: "build", argv: ["npm", "run", "build"] }], fast_verify: [] },
  });
  ((data.environments as Record<string, Record<string, unknown>>).dev!).cli_config_dir = store;
  const registry = path.join(dir, "shop-proj01.yml");
  fs.writeFileSync(registry, YAML.stringify(data));
  fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify({ name: "shop-proj01", org: "example-org", existing: true, legacy: true, data: true, setup: { app: true }, url: "https://shop.example.test" }));
  return { app: { name: "shop-proj01", dir, registry, org: "example-org", repos: { app: repo }, tenant: DEV, url: "https://shop.example.test" }, bare, store };
}

/** git for real; python (the official deploy) answered by `deploy`. */
const fakeExec = (deploy: (args: string[], env: Record<string, string>) => { code: number; stdout: string }, calls: Array<{ args: string[]; env: Record<string, string>; cwd: string }>): Exec => async (cmd, args, o) => {
  if (cmd === "git") return runCommand(cmd, args, o);
  calls.push({ args, env: o.env ?? {}, cwd: o.cwd ?? "" });
  return { ...deploy(args, o.env ?? {}), stderr: "" };
};

describe("the first preview of an onboarded former product", () => {
  it("deploys its dev commit once through the official engine's deploy, in the product's own Blocks store", async () => {
    const { app, bare, store } = onboarded();
    const calls: Array<{ args: string[]; env: Record<string, string>; cwd: string }> = [];
    const exec = fakeExec(() => ({ code: 0, stdout: 'MADP_DEPLOY {"repos": [{"repo": "app", "verdict": "succeeded", "build": "b-1", "smoke": []}]}\n' }), calls);
    const run = fakeRun();
    expect(await ensureFirstDeploy(run, app, run.step, { exec, engineHome: ENGINE, now: () => new Date("2026-11-05T10:00:00Z") })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["-B", "-c", DEPLOY_DRIVER, app.registry, "dev"]);
    expect(calls[0]!.cwd).toBe(ENGINE);
    expect(calls[0]!.env).toMatchObject({ BLOCKS_CONFIG_DIR: store, MF_BLOCKS_RELEASE_ACCOUNT: "default" });
    const dev = git(bare, "rev-parse", "dev");
    expect(run.lines.join("\n")).toMatch(new RegExp(`its dev commit ${dev.slice(0, 7)} as it is, no code change`));
    expect(JSON.parse(fs.readFileSync(path.join(app.dir, "factory.json"), "utf8")).firstDeploy).toEqual({ commit: dev, at: "2026-11-05T10:00:00.000Z" });
    // done once: the next preview only checks the address
    expect(await ensureFirstDeploy(run, app, run.step, { exec, engineHome: ENGINE })).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("an attached or new product is never redeployed by it; a repo not linked in Release names the portal step", async () => {
    const { app } = onboarded();
    const calls: Array<{ args: string[]; env: Record<string, string>; cwd: string }> = [];
    const notLinked = fakeExec(() => ({ code: 1, stdout: 'MADP_DEPLOY {"repos": [], "error": "repo_not_linked"}\n' }), calls);
    // the project's record names no repository: the GitHub account the code is in is never named
    await expect(ensureFirstDeploy(fakeRun(), app, async () => undefined, { exec: notLinked, engineHome: ENGINE })).rejects.toMatchObject({
      code: "madp.link_repos",
      message: expect.stringMatching(/open Release and add MADP Factory's repository shop \(branch "dev"\)/),
    });
    // the team's repository, as the project's record names it, keeps its owner
    const teams = { ...fakeRun(), p: { name: "Shop", project: { RepoProvider: "github", RepoOwner: "example-org", RepoName: "shop" }, rows: () => [] } } as unknown as JobRun;
    await expect(ensureFirstDeploy(teams, app, async () => undefined, { exec: notLinked, engineHome: ENGINE })).rejects.toMatchObject({
      message: expect.stringMatching(/open Release and add the repository example-org\/shop \(branch "dev"\)/),
    });
    expect(JSON.parse(fs.readFileSync(path.join(app.dir, "factory.json"), "utf8")).firstDeploy).toBeUndefined();
    const failed = fakeExec(() => ({ code: 1, stdout: 'MADP_DEPLOY {"repos": [{"repo": "app", "verdict": "failed", "build": "b-2"}], "error": "deploy_failed"}\n' }), calls);
    await expect(ensureFirstDeploy(fakeRun(), app, async () => undefined, { exec: failed, engineHome: ENGINE })).rejects.toMatchObject({ code: "madp.first_deploy", message: "The first deployment of shop on Blocks ended \"failed\". Start it again in a few minutes; if it fails again, ask the engine team to look into it." });
    // an attached product (no legacy mark)
    fs.writeFileSync(path.join(app.dir, "factory.json"), JSON.stringify({ name: "shop-proj01", existing: true }));
    const before = calls.length;
    expect(await ensureFirstDeploy(fakeRun(), app, async () => undefined, { exec: failed, engineHome: ENGINE })).toBe(false);
    expect(calls.length).toBe(before);
    expect(deployOutcomeOf("noise\n")).toBeNull();
  });

  it("the official engine's deploy_ops runs it: repos list, the dry run, the first `release setup` on dev", async () => {
    if (!hasPython) return;
    const log = path.join(tmp, "cli.log");
    const cli = path.join(tmp, "cli.js");
    fs.writeFileSync(cli, `
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, (process.env.BLOCKS_CONFIG_DIR || "") + "|" + a.join(" ") + "\\n");
const has = (k) => a.includes(k);
if (a[0] === "auth") console.log(JSON.stringify({ projectAccessToken: "valid", projectRefreshToken: "valid" }));
else if (a[0] === "release" && a[1] === "repos") console.log(JSON.stringify({ repos: [{ name: "example-org/shop", branch: "dev", repoId: "repo-1", namespace: "" }] }));
else if (a[0] === "release" && a[1] === "setup" && has("--dry-run")) console.log(JSON.stringify({ dryRun: true, projectKey: ${JSON.stringify(DEV)}, repoId: "repo-1", environment: "dev" }));
else if (a[0] === "release" && a[1] === "setup") console.log(JSON.stringify({ verdict: "succeeded", buildId: "build-7" }));
else { console.error("unexpected"); process.exit(3); }
`);
    const { app, store } = onboarded({ cliRunJs: cli });
    const env = { MADP_DEPLOY_FREEZE_FILE: path.join(tmp, "no-freeze.json") };
    const exec: Exec = (cmd, args, o) => runCommand(cmd, args, { ...o, env: { ...env, ...o.env } });
    const run = fakeRun();
    expect(await ensureFirstDeploy(run, app, run.step, { exec, engineHome: ENGINE })).toBe(true);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split("|"));
    expect(calls.every(([s]) => s === store)).toBe(true);
    const argv = calls.map(([, a]) => a!);
    expect(argv[0]).toMatch(/^auth status --json --account default --project D/);
    expect(argv.slice(1)).toEqual([
      `release repos list --json --account default --project ${DEV}`,
      `release setup --repo repo-1 --dry-run --json --account default --project ${DEV}`,
      expect.stringMatching(new RegExp(`^release setup --repo repo-1 --wait --poll-interval 2 --timeout 1500 --json --yes --account default --project ${DEV}$`)),
    ]);
    expect(run.logs.join("\n")).toMatch(/first deploy shop-proj01: [0-9a-f]{12} app succeeded \(build build-7\)/);
  });
});

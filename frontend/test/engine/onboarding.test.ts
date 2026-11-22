// Onboarding products onto the official MADP engine (official/onboarding.ts, official/legacy.ts): each repo's checks
// once on the pristine dev branch with a choice per failing check, the real languages, the report, the re-check, and
// the former template builder's products through ensureApp (never new-app). Temp git repos, local bare remotes, fake
// runners and a fake npm only: no network, no Blocks, no GitHub.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Exec } from "../../server/local/engine/official/attach.ts";
import { ensureApp } from "../../server/local/engine/official/app.ts";
import { acceptanceSecretsDir, officialHome, productStore } from "../../server/local/engine/official/home.ts";
import { cliCalls, signedIn, writeFakeBlocksCli } from "./fakeBlocksCli.ts";
import { hostRegistry, parseRegistry } from "../../server/local/engine/official/hostRegistry.ts";
import { detectChecks, githubRepoOf, legacyProduct } from "../../server/local/engine/official/legacy.ts";
import {
  acceptanceLines, applyAcceptance, applyChecks, decide, detectLanguages, devUrlKnown, findLiveTests, onboardRegistry, plainReason, readReport, recheckProduct, redact, reportMarkdown, runChecks,
  suggestAcceptance, writeReport, writeValidatedRegistry,
  type CheckOutcome,
} from "../../server/local/engine/official/onboarding.ts";
import type { JobRun } from "../../server/local/engine/run.ts";

const DEV = `D${"0123456789abcdef".repeat(2)}`;
const ENGINE = officialHome();
const hasPython = spawnSync("python3", ["-c", "import yaml"], { stdio: "ignore" }).status === 0 && fs.existsSync(path.join(ENGINE, "MADP", "orchestrator", "primitives", "project_registry.py"));

let tmp = "";
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => {
  if (!(k in saved)) saved[k] = process.env[k];
  process.env[k] = v;
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-onboard-"));
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

/** A work repo on `branch` holding the files (committed). */
function repoWith(dir: string, files: Record<string, string>, branch = "dev"): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  git(dir, "init", "-q", "-b", branch);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

/** A bare repo <base>/<slug>.git made from the files. */
function bareRepo(base: string, slug: string, files: Record<string, string>, branch = "dev"): string {
  const work = repoWith(path.join(tmp, "work", slug.replace("/", "-")), files, branch);
  const bare = path.join(base, `${slug}.git`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  git(tmp, "clone", "-q", "--bare", work, bare);
  return bare;
}

/** git for real; every other program is answered by `fake` (name + args -> exit code, output). */
const fakeExec = (fake: (cmd: string, args: string[], cwd: string) => { code: number; out?: string; write?: string } | null, calls: string[] = []): Exec => async (cmd, args, o) => {
  if (cmd === "git") return runCommand(cmd, args, o);
  calls.push(`${cmd} ${args.join(" ")}`);
  const r = fake(cmd, args, o.cwd ?? "");
  if (!r) return runCommand(cmd, args, o);
  if (r.write) fs.writeFileSync(path.join(o.cwd!, r.write), "output\n");
  return { code: r.code, stdout: "", stderr: r.out ?? "" };
};

const ok = (s: Partial<CheckOutcome> & Pick<CheckOutcome, "repo" | "kind" | "name" | "result">): CheckOutcome => ({
  id: `${s.repo}.${s.kind}.${s.name}`, reason: "", detail: "", seconds: 0, inGate: false, decision: "", step: { name: s.name, argv: ["node", "-v"] }, ...s,
});

describe("each repo's checks once, with a choice per failing check", () => {
  it("leaves a failing check out by default, keeps one when chosen, never empties verify, keeps live tests off", () => {
    const d = decide([
      ok({ repo: "web", kind: "fast_verify", name: "i18n", result: "fail", reason: "the language files do not match (missing, extra or empty keys)" }),
      ok({ repo: "web", kind: "verify", name: "build", result: "pass" }),
      ok({ repo: "web", kind: "verify", name: "lint", result: "fail", reason: "it failed (exit code 1)" }),
      ok({ repo: "api", kind: "verify", name: "typecheck", result: "fail", reason: "the type check found 2 errors" }),
      ok({ repo: "api", kind: "live_test", name: "suites", result: "not-run", reason: "live tests are off: they run against the live development environment" }),
    ], { choices: { "web.verify.lint": "keep" } });
    const by = Object.fromEntries(d.outcomes.map((c) => [c.id, c]));
    expect(by["web.fast_verify.i18n"]!.inGate).toBe(false);
    expect(by["web.verify.build"]!.inGate).toBe(true);
    expect(by["web.verify.lint"]!).toMatchObject({ inGate: true, decision: expect.stringMatching(/^kept by choice/) });
    expect(by["api.verify.typecheck"]!).toMatchObject({ inGate: true, decision: expect.stringMatching(/at least one step/) });
    expect(by["api.live_test.suites"]!.inGate).toBe(false);
    expect(d.attention.join("\n")).toMatch(/Every build check of api fails/);
    expect(d.attention.join("\n")).toMatch(/"i18n" of web .* left out/);

    const data = { project: "p", repos: { web: { path: "/x/web", verify: [{ name: "build", argv: ["npm", "run", "build"] }, { name: "lint", argv: ["npm", "run", "lint"] }], fast_verify: [{ name: "i18n", argv: ["node", "i18n.mjs"] }] }, api: { path: "/x/api", verify: [{ name: "typecheck", argv: ["tsc"] }], live_test: [{ name: "suites", argv: ["node", "live.mjs"] }] } } };
    const next = applyChecks(data, d.outcomes, { checkedAt: "2026-11-05T10:00:00.000Z", liveTests: "off", choices: { "web.verify.lint": "keep" } });
    const repos = next.repos as Record<string, Record<string, unknown>>;
    expect(repos.web!.fast_verify).toBeUndefined();
    expect((repos.web!.verify as Array<{ name: string }>).map((x) => x.name)).toEqual(["build", "lint"]);
    expect(repos.api!.live_test).toBeUndefined();
    expect(next.onboarding).toEqual({
      checked_at: "2026-11-05T10:00:00.000Z", live_tests: "off", choices: { "web.verify.lint": "keep" },
      left_out: [
        { repo: "web", kind: "fast_verify", name: "i18n", argv: ["node", "-v"], reason: "the language files do not match (missing, extra or empty keys)" },
        { repo: "api", kind: "live_test", name: "suites", argv: ["node", "-v"], reason: "live tests are off: they run against the live development environment" },
      ],
    });
  });

  it("says why in plain words and never repeats a secret", () => {
    const r = (stderr: string, code = 1) => ({ code, stdout: "", stderr });
    const step = (argv: string[], name = "t") => ({ name, argv });
    expect(plainReason(step(["python3", "/srv/other/uilm_sync.py"]), r("python3: can't open file '/srv/other/uilm_sync.py': [Errno 2] No such file or directory", 2), "/repo", 60_000)).toBe("it names a file that is not on the engine host");
    expect(plainReason(step(["node", "--env-file=.env", "src/server.ts"]), r("node: .env: not found"), "/repo", 60_000)).toBe("it needs a .env file, which is not in git");
    expect(plainReason(step(["python3", "uilm.py", "--check"], "uilm-check"), r("missing_key sales.title"), "/repo", 60_000)).toBe("the language files do not match (missing, extra or empty keys)");
    expect(plainReason(step(["tsc"]), r("a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS2345: y"), "/repo", 60_000)).toBe("the type check found 2 errors");
    expect(plainReason(step(["nope-tool"]), r("", 127), "/repo", 60_000)).toBe('the program "nope-tool" is not installed on the engine host');
    expect(plainReason(step(["node", "x"]), { ...r(""), timedOut: true }, "/repo", 120_000)).toBe("it did not finish within 2 minutes");
    const said = redact("GET https://user:pa55@host.example/x failed\nAPI_TOKEN=abc123secret ghp_abcdefghijklmnopqrstuvwxyz0123 in /home/someone/app");
    for (const s of ["pa55", "abc123secret", "ghp_abcdefghijklmnopqrstuvwxyz0123", "/home/someone"]) expect(said).not.toContain(s);
  });

  it("runs on the pristine dev branch, puts aside what a check wrote, and does not check a clone with changes", async () => {
    const web = repoWith(path.join(tmp, "p", "madp", "shop-web"), { ".gitignore": "node_modules/\n", "package.json": "{}" });
    const data = {
      project: "shop",
      repos: { web: { path: web, repo: "o/shop-web", branch: "dev", verify: [{ name: "build", argv: ["npm", "run", "build"] }], fast_verify: [{ name: "i18n", argv: ["node", "i18n.mjs"] }], live_test: [{ name: "live", argv: ["node", "live.mjs"] }] } },
    };
    const calls: string[] = [];
    const exec = fakeExec((cmd, args) => (cmd === "npm" ? { code: 0, write: "dist.txt" } : args[0] === "i18n.mjs" ? { code: 1, out: "missing_key a.b" } : { code: 0 }), calls);
    const r = await runChecks(data, { exec });
    expect(r.outcomes.map((c) => [c.id, c.result])).toEqual([["web.fast_verify.i18n", "fail"], ["web.verify.build", "pass"], ["web.live_test.live", "not-run"]]);
    expect(calls).toEqual(["node i18n.mjs", "npm run build"]);
    expect(r.repos[0]).toMatchObject({ key: "web", repo: "o/shop-web", branch: "dev" });
    // the build's output is in a stash, the clone is clean again
    expect(git(web, "status", "--porcelain")).toBe("");
    expect(git(web, "stash", "list")).toMatch(/madp onboarding/);
    expect(r.notes.join()).toMatch(/put aside/);

    // a clone with changes is not checked; its checks keep their place
    fs.writeFileSync(path.join(web, "package.json"), '{"changed":true}');
    const dirty = await runChecks(data, { exec });
    expect(dirty.outcomes.every((c) => c.result === "not-run")).toBe(true);
    const d = decide(dirty.outcomes, { inGateBefore: new Set(["web.verify.build", "web.fast_verify.i18n"]) });
    expect(d.outcomes.filter((c) => c.inGate).map((c) => c.id)).toEqual(["web.fast_verify.i18n", "web.verify.build"]);

    // live tests only when asked
    git(web, "checkout", "--", ".");
    const live = await runChecks(data, { exec, allowLiveTests: true });
    expect(live.outcomes.find((c) => c.kind === "live_test")?.result).toBe("pass");
  });
});

describe("the product's real languages", () => {
  it("corrects a registry that lists 2 of 4 languages, from the files", () => {
    const web = path.join(tmp, "web");
    for (const c of ["en-US", "de-CH", "fr-CH", "it-CH"]) {
      fs.mkdirSync(path.join(web, "src", "i18n"), { recursive: true });
      fs.writeFileSync(path.join(web, "src", "i18n", `common.${c}.json`), "{}");
      if (c !== "it-CH") fs.writeFileSync(path.join(web, "src", "i18n", `sales.${c}.json`), "{}");
    }
    fs.writeFileSync(path.join(web, "src", "i18n", "README.json"), "{}");
    const data = { project: "p", localization: { repo: "web", dir: "src/i18n", source: "en-US", cultures: ["en-US", "de-CH"], key_style: "dot" }, repos: { web: { path: web } } };
    const l = detectLanguages(data)!;
    expect(l).toEqual({ repo: "web", dir: "src/i18n", declared: ["en-US", "de-CH"], found: ["en-US", "de-CH", "fr-CH", "it-CH"], source: "en-US", changed: true, inRegistry: true });
    const same = detectLanguages({ ...data, localization: { ...data.localization, cultures: ["en-US", "de-CH", "fr-CH", "it-CH"] } })!;
    expect(same.changed).toBe(false);
    // no localization section: found in the usual folders, never written
    expect(detectLanguages({ project: "p", repos: { web: { path: web } } })).toMatchObject({ dir: "src/i18n", found: ["en-US", "de-CH", "fr-CH", "it-CH"], inRegistry: false });
    expect(detectLanguages({ project: "p", repos: { web: { path: path.join(tmp, "none") } } })).toBeNull();
    fs.mkdirSync(path.join(web, "src", "locales"), { recursive: true });
    fs.writeFileSync(path.join(web, "src", "locales", "app.de-CH.json"), "{}");
    fs.writeFileSync(path.join(web, "src", "locales", "app.en-GB.json"), "{}");
    expect(detectLanguages({ project: "p", repos: { web: { path: web } } })).toMatchObject({ dir: "src/locales", found: ["en-GB", "de-CH"], source: "en-GB", inRegistry: false });
  });
});

// ------------------------------------------------------------------ the report and the re-check

/** An attached product on the engine host: registry (one web repo), factory.json, a fake engine CLI. */
function attachedProduct(o: { i18nPasses: () => boolean }) {
  const dir = path.join(tmp, "projects", "ws1", "proj-1", "madp");
  const web = repoWith(path.join(dir, "shop-web"), { ".gitignore": "node_modules/\n", "package.json": "{}", "src/i18n/common.en-US.json": "{}", "src/i18n/common.de-CH.json": "{}", "src/i18n/common.fr-CH.json": "{}" });
  const cli = path.join(tmp, "cli", "run.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "");
  const data = {
    project: "shop",
    localization: { repo: "web", dir: "src/i18n", source: "en-US", cultures: ["en-US", "de-CH"] },
    default_env: "dev",
    environments: { dev: { branch: "dev", tenant_id: DEV } },
    git: { author_name: "MADP Factory", author_email: "engine@madp-factory.local", commit_trailer: "" },
    cli: { run_js: cli, cwd: web },
    repos: { web: { path: web, repo: "example-org/shop-web", branch: "dev", role: "web", verify: [{ name: "build", argv: ["npm", "run", "build"] }], fast_verify: [{ name: "i18n", argv: ["node", "i18n.mjs"] }] } },
  };
  fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify({ name: "shop", org: "example-org", existing: true, data: true, setup: { web: true }, url: "https://shop.example.test" }));
  const exec = fakeExec((cmd, args) => (cmd === "npm" ? { code: 0 } : args[0] === "i18n.mjs" ? { code: o.i18nPasses() ? 0 : 1, out: "missing_key a.b" } : null));
  return { dir, data, exec, file: path.join(dir, "shop.yml") };
}

describe("the onboarding report and the re-check", () => {
  it("writes a plain report, shows it in What MADP produced terms, and brings a fixed check back by itself", async () => {
    if (!hasPython) return;
    let passes = false;
    const p = attachedProduct({ i18nPasses: () => passes });
    expect(await writeValidatedRegistry(p.exec, ENGINE, p.file, p.data)).toEqual([]);
    const first = await onboardRegistry(p.data, { exec: p.exec, now: () => new Date("2026-11-05T10:00:00Z") });
    expect(await writeValidatedRegistry(p.exec, ENGINE, p.file, first.data)).toEqual([]);
    writeReport(p.dir, first.report);
    let reg = parseRegistry(fs.readFileSync(p.file, "utf8"));
    expect((reg.repos as Record<string, Record<string, unknown>>).web!.fast_verify).toBeUndefined();
    expect((reg.localization as { cultures: string[] }).cultures).toEqual(["en-US", "de-CH", "fr-CH"]);
    expect(first.report.summary).toBe("1 of 2 checks passed on the dev branch as it is; 1 check failed and needs the product's team.");
    const md = reportMarkdown(readReport(p.dir)!);
    expect(md).toContain("## Needs your team");
    expect(md).toContain("Leave it out");
    expect(md).toContain("Keep it");
    expect(md).toMatch(/3 languages: en-US, de-CH, fr-CH/);
    for (const s of [tmp, os.homedir(), "argv", "node i18n.mjs"]) expect(md).not.toContain(s);

    // the product's team fixed the dictionaries: the re-check puts the check back
    passes = true;
    const again = await recheckProduct(p.dir, { exec: p.exec, engineHome: ENGINE });
    expect(again.attention).toEqual([]);
    reg = parseRegistry(fs.readFileSync(p.file, "utf8"));
    expect(((reg.repos as Record<string, Record<string, Array<{ name: string }>>>).web!.fast_verify ?? []).map((x) => x.name)).toEqual(["i18n"]);
    expect((reg.onboarding as { left_out: unknown[] }).left_out).toEqual([]);

    // broken again, kept by choice: it stays in the gate, and the choice is remembered on the next re-check
    passes = false;
    await recheckProduct(p.dir, { exec: p.exec, engineHome: ENGINE, choices: { "web.fast_verify.i18n": "keep" } });
    const kept = await recheckProduct(p.dir, { exec: p.exec, engineHome: ENGINE });
    expect(kept.checks.find((c) => c.id === "web.fast_verify.i18n")).toMatchObject({ result: "fail", inGate: true });
    reg = parseRegistry(fs.readFileSync(p.file, "utf8"));
    expect((reg.onboarding as { choices: Record<string, string> }).choices).toEqual({ "web.fast_verify.i18n": "keep" });
  });
});

// ------------------------------------------------------------------ checking each change on dev (acceptance)

const LIVE_TEST = 'const BASE = process.argv.slice(2).find((a) => a.startsWith("http"));\nconst r = await fetch(BASE + "/health/live");\nconsole.log(`x: ${r.ok ? 1 : 0} passed, ${r.ok ? 0 : 1} failed`);\n';
const HELPER = 'export function fixtureWs(name) {\n  return process.argv.find((a) => a.startsWith("--ws=")) ?? name;\n}\n';

/** An attached product with an API repo of the shape: a fixtures script, live tests, helpers, a runner. */
function apiProduct() {
  const dir = path.join(tmp, "projects", "ws1", "proj-2", "madp");
  const api = repoWith(path.join(dir, "books-api"), {
    ".gitignore": ".local/\nnode_modules/\n",
    "package.json": "{}",
    "test/fixtures.mjs": 'const BASE = process.argv[2];\nawait fetch(BASE + "/api/workspaces");\n',
    "test/categories.mjs": LIVE_TEST,
    "test/themes.mjs": LIVE_TEST,
    "test/fixture-ws.mjs": HELPER,
    "test/run-all.mjs": "const BASE = process.argv[2];\nawait fetch(BASE);\n",
    "test/notes.mjs": "console.log('no address');\n",
    "test/pure.test.ts": "export {};\n",
  });
  const cli = path.join(tmp, "cli", "run.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "");
  const data: Record<string, unknown> = {
    project: "books",
    default_env: "dev",
    environments: { dev: { branch: "dev", tenant_id: DEV } },
    git: { author_name: "MADP Factory", author_email: "engine@madp-factory.local", commit_trailer: "" },
    cli: { run_js: cli, cwd: api },
    repos: { api: { path: api, repo: "example-org/books-api", branch: "dev", role: "api", verify: [{ name: "typecheck", argv: ["node", "-e", "0"] }], health: ["https://books-api.example.test/health/live"] } },
  };
  return { dir, api, data, file: path.join(dir, "books.yml") };
}

type Repos = Record<string, Record<string, unknown>>;

describe("checking each change on the development environment", () => {
  it("finds the fixtures script and the live tests, suggests the section, and turns it on only when it can run", () => {
    const p = apiProduct();
    expect(findLiveTests(p.api)).toEqual({
      fixtures: "test/fixtures.mjs", dir: "test", ext: ".mjs", tests: ["test/categories.mjs", "test/themes.mjs"],
      others: ["test/fixture-ws.mjs", "test/notes.mjs", "test/run-all.mjs"],
    });
    expect(findLiveTests(path.join(tmp, "nothing-here"))).toBeNull();
    expect(devUrlKnown(p.data, "api")).toBe(true);
    expect(devUrlKnown(p.data, "web")).toBe(false);

    const root = path.join(tmp, "acceptance");
    const secretsDirOf = (repo: string) => acceptanceSecretsDir("books", "dev", repo, root);
    const [s] = suggestAcceptance(p.data, { secretsDirOf });
    expect(s).toMatchObject({ repo: "api", state: "suggested", tests: 2, fixtures: "test/fixtures.mjs", reason: "its test accounts are not on the engine host yet", secretsDir: path.join(root, "books-dev", "api") });
    expect(s!.section).toEqual({
      envs: ["dev"],
      fixtures: { argv: ["node", "test/fixtures.mjs", "{api_url}"], timeout: 900 },
      tests: { argv: ["node", "{file}", "{api_url}"], files: ["test/*.mjs"], exclude: ["test/fixtures.mjs", "test/fixture-ws.mjs", "test/notes.mjs", "test/run-all.mjs"], max_files: 8, timeout: 900 },
      secrets_dir: path.join(root, "books-dev", "api"),
      links: ["node_modules"],
    });
    // a suggestion writes nothing; the operator's console says what to put where
    expect(applyAcceptance(p.data, [s!])).toBe(p.data);
    expect(acceptanceLines([s!])[0]).toMatch(/acceptance api: suggested \(2 live test files, fixtures test\/fixtures\.mjs\), not on: .*books-dev[\\/]api, then re-check/);

    // the accounts are there, but the registry knows no API address: still not on
    fs.mkdirSync(s!.secretsDir, { recursive: true });
    const noUrl = structuredClone(p.data);
    delete (noUrl.repos as Repos).api!.health;
    expect(suggestAcceptance(noUrl, { secretsDirOf })[0]).toMatchObject({ state: "suggested", reason: "the product's settings have no development address for the API" });

    // accounts on the host and an address: on, written into the registry (pure)
    const [on] = suggestAcceptance(p.data, { secretsDirOf });
    expect(on).toMatchObject({ state: "on", reason: "" });
    const next = applyAcceptance(p.data, [on!]);
    expect((next.repos as Repos).api!.acceptance).toEqual(on!.section);
    expect((p.data.repos as Repos).api!.acceptance).toBeUndefined();

    // a section the registry has already is left as it is; its accounts folder missing is flagged
    expect(suggestAcceptance(next, { secretsDirOf })[0]!.state).toBe("configured");
    fs.rmSync(on!.secretsDir, { recursive: true });
    const missing = suggestAcceptance(next, { secretsDirOf });
    expect(missing[0]!.state).toBe("configured-missing");
    expect(acceptanceLines(missing)[0]).toMatch(/^ {2}! acceptance api: configured, but .* is missing/);
  });

  it("onboarding writes it only when it can run, the official validator accepts it, and the report names no path", async () => {
    if (!hasPython) return;
    const p = apiProduct();
    const root = path.join(tmp, "acceptance");
    // the gate's node step is answered; git and the official validator run for real
    const exec = fakeExec((cmd) => (cmd === "node" ? { code: 0 } : null));
    const off = await onboardRegistry(p.data, { exec, acceptanceRoot: root, now: () => new Date("2026-11-05T10:00:00Z") });
    expect((off.data.repos as Repos).api!.acceptance).toBeUndefined();
    expect(off.report.acceptance?.[0]?.state).toBe("suggested");
    expect(off.report.attention).toEqual([]);
    const md = reportMarkdown(off.report);
    expect(md).toContain("## Checking each change on the development environment");
    expect(md).toContain("- **api** (2 live test files found): available, not on yet: its test accounts are not on the engine host yet.");
    for (const s of [tmp, root, "secrets_dir", "node test/", "{api_url}"]) expect(md).not.toContain(s);

    const secrets = acceptanceSecretsDir("books", "dev", "api", root);
    fs.mkdirSync(secrets, { recursive: true });
    const on = await onboardRegistry(p.data, { exec, acceptanceRoot: root });
    expect(on.report.acceptance?.[0]?.state).toBe("on");
    expect(reportMarkdown(on.report)).toContain("- **api** (2 live test files found): on: every change is checked this way from now on.");
    // the official validator (paths checked) accepts the section the onboarding wrote
    expect(await writeValidatedRegistry(exec, ENGINE, p.file, on.data)).toEqual([]);
    expect(((parseRegistry(fs.readFileSync(p.file, "utf8")).repos as Repos).api!.acceptance as Record<string, unknown>).secrets_dir).toBe(secrets);
    // and refuses it once the accounts folder is gone (a lane would stop at its preflight)
    fs.rmSync(secrets, { recursive: true });
    expect((await writeValidatedRegistry(exec, ENGINE, p.file, on.data)).join("\n")).toMatch(/acceptance\.secrets_dir: not a directory/);
    const flagged = await onboardRegistry(on.data, { exec, acceptanceRoot: root });
    expect(flagged.report.attention.join("\n")).toMatch(/test accounts are not on the engine host, so builds stop before they start/);
  });

  it("an attached product's own acceptance section is left out on the engine host, with a plain note", () => {
    const source = [
      "project: books",
      "default_env: dev",
      "environments: {dev: {branch: dev}}",
      "git: {author_name: Op, author_email: op@example.test}",
      "cli: {run_js: /opt/operator/books-api/node_modules/@seliseblocks/cli-os/bin/run.js, cwd: /opt/operator/books-api}",
      "repos:",
      "  api:",
      "    path: /opt/operator/books-api",
      "    repo: example-org/books-api",
      "    branch: dev",
      "    role: api",
      "    verify: [{name: typecheck, argv: [node, -e, '0']}]",
      "    acceptance: {tests: {argv: [node, '{file}', '{api_url}'], files: ['test/*.mjs']}, secrets_dir: /opt/operator/books-api-secrets}",
    ].join("\n");
    const h = hostRegistry(source, { dir: path.join(tmp, "p", "madp"), devTenant: DEV, engineHome: path.join(tmp, "engine") });
    expect((h.data.repos as Repos).api!.acceptance).toBeUndefined();
    expect(h.notes).toContain("repos.api.acceptance was left out: its test accounts are on the operator's machine. The onboarding suggests it again and turns it on once the accounts are on the engine host.");
    expect(h.yaml).not.toContain("/opt/operator");
  });
});

// ------------------------------------------------------------------ the former template builder's products

/** The JobRun parts ensureApp, legacy.ts and runLane use. */
function fakeRun(folder: string, project: Record<string, unknown>, rows: Record<string, Array<Record<string, unknown>>> = {}): JobRun & { steps: string[] } {
  const steps: string[] = [];
  return {
    id: "job-1",
    projectId: "proj-1",
    deps: { projectFolder: () => undefined },
    folder: () => ({ dir: folder }),
    p: { name: "Shop", project, rows: (s: string) => rows[s] ?? [] },
    signal: new AbortController().signal,
    heartbeat: async () => undefined,
    log: () => undefined,
    check: () => undefined,
    step: async (_p: number, l: string) => void steps.push(l),
    steps,
  } as unknown as JobRun & { steps: string[] };
}

const READY = { BlocksProvisioningStatus: "ready", BlocksProjectRef: DEV, BlocksProjectDomain: "https://shop.example.test" };
const LEGACY = { ...READY, RepoProvider: "github", RepoOwner: "example-org", RepoName: "shop", RepoBranch: "main", RepoMode: "new" };
const VITE = {
  ".gitignore": "node_modules/\ndist/\n",
  "package.json": JSON.stringify({ name: "shop", private: true, scripts: { build: "vite build" }, devDependencies: { typescript: "5.9.3", vite: "7.0.0" } }),
  "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
  "tsconfig.app.json": JSON.stringify({ compilerOptions: { noEmit: true } }),
  "src/main.tsx": "export {};\n",
  "src/i18n/locales/app.en-US.json": "{}",
};

describe("a product of the former template builder", () => {
  it("is told apart from a new product without changing anything", async () => {
    const gitBase = path.join(tmp, "git");
    bareRepo(gitBase, "example-org/shop", VITE, "main");
    const folder = path.join(tmp, "projects", "ws1", "proj-1");
    const dir = path.join(folder, "madp");
    fs.mkdirSync(dir, { recursive: true });
    const deps = { gitBase: `file://${gitBase}` };
    // the Factory project names its GitHub repo and the repo has code: a former product, on its main branch
    expect(await legacyProduct(fakeRun(folder, LEGACY), dir, {}, "shop-proj01", deps)).toMatchObject({ repo: "example-org/shop", branch: "main", halfMadeRegistry: false });
    // a new product: no GitHub repo named, or one that does not exist yet
    expect(await legacyProduct(fakeRun(folder, READY), dir, {}, "shop-proj01", deps)).toBeNull();
    expect(await legacyProduct(fakeRun(folder, { ...LEGACY, RepoName: "not-made-yet" }), dir, {}, "shop-proj01", deps)).toBeNull();
    // a new product that stopped at the portal step (registry, nothing deployed, nothing built) stays a new product
    fs.writeFileSync(path.join(dir, "shop-proj01.yml"), "project: shop-proj01\n");
    expect(await legacyProduct(fakeRun(folder, READY), dir, { name: "shop-proj01", setup: {} }, "shop-proj01", deps)).toBeNull();
    // ...but with an earlier preview it is the former product, its half-made registry to be moved aside
    expect(await legacyProduct(fakeRun(folder, LEGACY, { Preview: [{ Version: "0.1.0" }] }), dir, { name: "shop-proj01", setup: {} }, "shop-proj01", deps)).toMatchObject({ halfMadeRegistry: true });
    // the former builder's clone alone is enough (its origin names the repo)
    fs.rmSync(path.join(dir, "shop-proj01.yml"));
    repoWith(path.join(folder, "repo"), { "a.txt": "a" });
    git(path.join(folder, "repo"), "remote", "add", "origin", "https://github.com/example-org/shop.git");
    expect(await legacyProduct(fakeRun(folder, READY), dir, {}, "shop-proj01", deps)).toMatchObject({ repo: "example-org/shop" });
    // an attached product is never one
    expect(await legacyProduct(fakeRun(folder, LEGACY), dir, { existing: true }, "shop-proj01", deps)).toBeNull();
    expect(githubRepoOf("git@github.com:example-org/shop.git")).toBe("example-org/shop");
    expect(detectChecks(path.join(tmp, "work", "example-org-shop"))).toEqual({
      verify: [{ name: "typecheck", argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.app.json"] }, { name: "build", argv: ["npm", "run", "build"] }],
      fast_verify: [{ name: "typecheck-incremental", argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.app.json", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/madp/app.tsbuildinfo"] }],
    });
  });

  it("ensureApp onboards it as an existing one-repo product, never new-app; a half-made new-app attempt is moved aside", async () => {
    if (!hasPython) return;
    const gitBase = path.join(tmp, "git");
    const bare = bareRepo(gitBase, "example-org/shop", VITE, "main");
    const folder = path.join(tmp, "projects", "ws1", "proj-1");
    const dir = path.join(folder, "madp");
    // what the failed `madp new-app` attempt left: state, its scaffold folder
    fs.mkdirSync(path.join(dir, "shop-proj01", "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shop-proj01", "src", "kept.txt"), "kept");
    fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify({ name: "shop-proj01", org: "example-org", oidcClientId: "client-1" }));
    // the engine host: GitHub at a local folder, the engine user's Blocks CLI, an npm that installs nothing; no engine
    // lane may run (new-app would fail: the engine home has no project.py)
    setEnv("MF_MADP_GIT_BASE", `file://${gitBase}`);
    const home = path.join(tmp, "home");
    const cli = path.join(home, ".local", "lib", "node_modules", "@seliseblocks", "cli-os", "bin", "run.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    // the engine's own Blocks CLI is the stand-in, and the product's own store is already signed in to its dev tenant
    const fake = writeFakeBlocksCli(path.join(tmp, "fake-cli"));
    fs.copyFileSync(fake.runJs, cli);
    setEnv("HOME", home);
    setEnv("FAKE_CLI_LOG", path.join(tmp, "cli.log"));
    setEnv("MF_BLOCKS_PRODUCT_STORES", path.join(tmp, "stores"));
    signedIn(productStore("shop-proj01", "dev", path.join(tmp, "stores")), DEV);
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${path.join(tmp, "npm.log")}"\nexit 0\n`, { mode: 0o755 });
    setEnv("PATH", `${bin}${path.delimiter}${path.dirname(fake.bin)}${path.delimiter}${process.env.PATH ?? ""}`);
    setEnv("MF_MADP_PYTHON", "python3");

    const run = fakeRun(folder, LEGACY, { Release: [{ Environment: "dev", Version: "0.1.0" }] });
    const app = await ensureApp(run, run.step);
    const repo = path.join(dir, "shop-proj01-app");
    expect(app).toMatchObject({ name: "shop-proj01", org: "example-org", tenant: DEV, url: "https://shop.example.test", repos: { app: repo } });
    // the repository as the project's own record names it (the team's): its owner is shown, as on the project's page
    expect(run.steps[0]).toBe("Setting up the repository example-org/shop on the official MADP engine: its code, its checks and its languages.");
    // the clone is on dev, made from main and pushed (a plain push)
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("dev");
    expect(git(bare, "branch", "--list", "dev")).toMatch(/dev/);
    expect(fs.readFileSync(path.join(tmp, "npm.log"), "utf8").split("\n")[0]).toMatch(/^install --no-audit --no-fund --no-package-lock/);
    // the half-made folder is moved aside with a time stamp, never deleted
    const aside = fs.readdirSync(dir).filter((f) => /^shop-proj01\.set-aside-\d{8}-\d{6}$/.test(f));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, aside[0]!, "src", "kept.txt"), "utf8")).toBe("kept");
    // the registry: one app repo, role web, branch dev, the dev tenant; the type check (no typescript installed) is
    // left out of the gate, the build stays
    const reg = parseRegistry(fs.readFileSync(path.join(dir, "shop-proj01.yml"), "utf8"));
    const appRepo = (reg.repos as Record<string, Record<string, unknown>>).app!;
    expect(appRepo).toMatchObject({ path: repo, repo: "example-org/shop", branch: "dev", role: "web", health: ["https://shop.example.test/"] });
    expect((appRepo.verify as Array<{ name: string }>).map((x) => x.name)).toEqual(["build"]);
    expect(appRepo.fast_verify).toBeUndefined();
    expect((reg.environments as Record<string, Record<string, unknown>>).dev!.tenant_id).toBe(DEV);
    // the same store and sign-in steps as every existing product: the registry names the product's own store and the
    // dev session was checked there (people would get the "Connect to Blocks" card without one)
    const store = productStore("shop-proj01", "dev", path.join(tmp, "stores"));
    expect((reg.environments as Record<string, Record<string, unknown>>).dev!.cli_config_dir).toBe(store);
    expect(cliCalls(path.join(tmp, "cli.log")).some(([s, a]) => s === store && a.startsWith(`auth status --json --account default --project ${DEV}`))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8"))).toMatchObject({ name: "shop-proj01", existing: true, legacy: true, setup: { app: true } });
    const report = readReport(dir)!;
    expect(report.languages).toMatchObject({ found: ["en-US"], inRegistry: false });
    expect(report.notes.join("\n")).toMatch(/moved aside/);
    expect(report.notes.join("\n")).toMatch(/no dev branch; MADP made one from main/);

    // the next build uses it as it is
    fs.writeFileSync(path.join(tmp, "npm.log"), "");
    const next = await ensureApp(fakeRun(folder, LEGACY), async () => undefined);
    expect(next.repos).toEqual({ app: repo });
    expect(fs.readFileSync(path.join(tmp, "npm.log"), "utf8")).toBe("");
  });
});

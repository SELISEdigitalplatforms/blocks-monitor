// Existing products on the official MADP engine: the engine-host registry made from a product's own registry
// (hostRegistry.ts), the operator's attach command (attach.ts) and ensureApp's existing-product and one-repo paths
// (app.ts). Temp folders, local bare git repos and fake CLIs only: no network, no Blocks, no GitHub.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostRegistry, parseRegistry, registryRepos, shownRepo } from "../../server/local/engine/official/hostRegistry.ts";
import { attachExisting, factoryRows, runCommand, type Exec, type FactoryData } from "../../server/local/engine/official/attach.ts";
import { appName, layoutArgs, ensureApp, existingApp, linkMessage } from "../../server/local/engine/official/app.ts";
import { officialHome, productStore } from "../../server/local/engine/official/home.ts";
import { cliCalls, signedIn, writeFakeBlocksCli } from "./fakeBlocksCli.ts";
import type { JobRun } from "../../server/local/engine/run.ts";

const DEV = `D${"0123456789abcdef".repeat(2)}`;
const OTHER_DEV = `D${"f".repeat(32)}`;

// A product registry as an operator writes it for their own machine (made-up names and paths).
const SOURCE = `# the operator's registry
project: ledgerly
description: Ledgerly accounting app on SELISE Blocks OS (web + API)
work_dir: /opt/operator/ledgerly-work
standards:
  profile: selise-blocks-app
  file: MADP/profiles/selise-blocks-app/CLAUDE.md
agent_rules:
  - "Keep the current colour themes intact."
  - "Logs go to /opt/operator/ledgerly-work/logs on this PC."
localization:
  repo: web
  dir: src/i18n/locales
  source: en-US
  cultures: [en-US, de-CH]
  key_style: dot
  parts: merge
default_env: dev
environments:
  dev:
    branch: dev
  stg:
    branch: stg
    tenant_id: S0123456789abcdef0123456789abcdef
    explicit_only: true
    promote_from: dev
    cli_config_dir: /opt/operator/ledgerly-work/stage/.blocks-cli
    cli_cwd: /opt/operator/ledgerly-work/stage/cli
    urls:
      web: https://stage-web.example.test
    health:
      web: [https://stage-web.example.test/]
    secrets_files:
      api: /opt/operator/code/ledgerly/api/.local/release-stg.env
deploy: true
git:
  author_name: Example Person
  author_email: person@example.com
  commit_trailer: "Co-Authored-By: Example Bot <bot@example.com>"
cli:
  run_js: /opt/operator/code/ledgerly/api/node_modules/@seliseblocks/cli-os/bin/run.js
  cwd: /opt/operator/code/ledgerly/api
  deploy_timeout: 1500
  poll_interval: 2
  env:
    BLOCKS_STRICT_FLAGS: "1"
    MSYS_NO_PATHCONV: "1"
    BLOCKS_CONFIG_DIR: /opt/operator/.blocks
repos:
  web:
    path: /opt/operator/code/ledgerly/web
    repo: example-org/ledgerly-web
    branch: dev
    keywords: [ui, button, page,
               "on", modal]
    verify:
      - name: typecheck
        argv: [node, node_modules/typescript/bin/tsc, --noEmit, -p, tsconfig.app.json]
      - name: build
        argv: [npm, run, build]
    fast_verify:
      - name: typecheck-incremental
        argv: [node, node_modules/typescript/bin/tsc, --noEmit, -p, tsconfig.app.json,
               --incremental, --tsBuildInfoFile, node_modules/.cache/madp/app.tsbuildinfo]
      - name: uilm-check
        argv: [python3, "/opt/operator/Tools Dir/selise-madp/MADP/orchestrator/cli/uilm_sync.py",
               --project, ledgerly, --check]
      - name: extra
        argv: [node, /opt/operator/scripts/extra-check.mjs]
    health:
      - https://dev-web.example.test/
    isolation:
      links: [node_modules]
  api:
    path: /opt/operator/code/ledgerly/api
    repo: example-org/ledgerly-api
    branch: dev
    keywords: [api, endpoint]
    verify:
      - name: typecheck
        argv: [node, node_modules/typescript/bin/tsc, --noEmit, -p, tsconfig.json]
    live_test:
      - name: live-suites-core
        argv: [node, "/opt/operator/Tools Dir/selise-madp/MADP/scripts/live-gate.mjs",
               --port, auto, --start, "node --import tsx --env-file=.env src/server.ts",
               --test, 'node "/opt/operator/Tools Dir/selise-madp/MADP/scripts/live-suites.mjs" {url} --waves "i18n;sales"']
    health:
      - https://dev-api.example.test/health/live
    secrets_file: /opt/operator/code/ledgerly/api/.local/release-dev.env
    isolation:
      links: [node_modules, .local]
      copy: [.env]
pipeline:
  project_id: EXAMPLE-LEDGERLY
  work_root: /opt/operator/madp-work
  modules: []
`;

const PERSONAL = ["/opt/operator", "Example Person", "person@example.com", "Example Bot", "bot@example.com", "Tools Dir"];
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

let tmp = "";
let storesBefore: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-existing-"));
  // every product's own Blocks sign-in lives under the test's folder
  storesBefore = process.env.MF_BLOCKS_PRODUCT_STORES;
  process.env.MF_BLOCKS_PRODUCT_STORES = path.join(tmp, "stores");
});
afterEach(() => {
  if (storesBefore === undefined) delete process.env.MF_BLOCKS_PRODUCT_STORES;
  else process.env.MF_BLOCKS_PRODUCT_STORES = storesBefore;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ENGINE = officialHome();
const hasPython = spawnSync("python3", ["-c", "import yaml"], { stdio: "ignore" }).status === 0 && fs.existsSync(path.join(ENGINE, "MADP", "orchestrator", "primitives", "project_registry.py"));

/** The official validator (paths checked) on a registry file. */
function officialCheck(file: string): { ok: boolean; out: string } {
  const r = spawnSync("python3", ["-B", "-m", "MADP.orchestrator.primitives.project_registry", file], { cwd: ENGINE, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

describe("an existing product's registry on the engine host", () => {
  const dir = "/srv/factory/projects/ws1/proj-1/madp";
  const engineHome = "/srv/factory/engine/selise-madp";
  const make = (extra: Partial<Parameters<typeof hostRegistry>[1]> = {}) => hostRegistry(SOURCE, { dir, devTenant: DEV, engineHome, ...extra });

  it("reads the source the way the official engine (PyYAML) does", () => {
    if (!hasPython) return;
    const py = execFileSync("python3", ["-c", "import sys, json, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: SOURCE, encoding: "utf8" });
    expect(parseRegistry(SOURCE)).toEqual(JSON.parse(py));
  });

  it("keeps the parallel streams' merge-friendly files (streams.merge_friendly)", () => {
    const withStreams = `${SOURCE.trimEnd()}\nstreams:\n  merge_friendly: ["api: src/rbac.ts"]\n`;
    const h = hostRegistry(withStreams, { dir, devTenant: DEV, engineHome });
    expect(h.data.streams).toEqual({ merge_friendly: ["api: src/rbac.ts"] });
    expect(h.notes.join(" ")).not.toContain("streams was left out");
  });

  it("carries nothing of the operator's machine or person over", () => {
    const h = make();
    for (const s of [...strings(h.data), h.yaml]) for (const p of PERSONAL) expect(s).not.toContain(p);
    expect(h.data.work_dir).toBeUndefined();
    expect(h.data.pipeline).toBeUndefined();
    expect(h.data.deploy).toBeUndefined();
    const api = (h.data.repos as Record<string, Record<string, unknown>>).api!;
    expect(api.secrets_file).toBeUndefined();
    expect((h.data.cli as Record<string, unknown>).env).toEqual({ BLOCKS_STRICT_FLAGS: "1", MSYS_NO_PATHCONV: "1", BLOCKS_NO_UPDATE_CHECK: "1" });
    expect(h.data.agent_rules).toEqual(["Keep the current colour themes intact."]);
    expect(h.notes.join("\n")).toMatch(/work_dir was left out/);
    expect(h.notes.join("\n")).toMatch(/repos\.web\.fast_verify "extra" was left out/);
    expect(h.notes.join("\n")).toMatch(/cli\.env\.BLOCKS_CONFIG_DIR was left out/);
    // the notes name keys, never the values
    for (const p of PERSONAL) expect(h.notes.join("\n")).not.toContain(p);
  });

  it("keeps STAGE out by default and in only when asked, without the operator's CLI session or secrets", () => {
    const h = make();
    expect(Object.keys(h.data.environments as object)).toEqual(["dev"]);
    expect(h.environments).toEqual(["dev"]);
    expect(h.notes.join("\n")).toMatch(/environments\.stg was left out/);
    expect(h.yaml).not.toMatch(/\bstg:/);
    const s = make({ withStage: true });
    const stg = (s.data.environments as Record<string, Record<string, unknown>>).stg!;
    expect(stg).toEqual({
      branch: "stg", tenant_id: "S0123456789abcdef0123456789abcdef", explicit_only: true, promote_from: "dev",
      urls: { web: "https://stage-web.example.test" }, health: { web: ["https://stage-web.example.test/"] },
    });
    expect(s.notes.join("\n")).toMatch(/environments\.stg\.cli_config_dir was left out/);
    const given = make({ withStage: true, envPaths: { stg: { cliConfigDir: "/srv/factory/stage/.blocks-cli", cliCwd: "/srv/factory/stage/cli" } } });
    expect((given.data.environments as Record<string, Record<string, unknown>>).stg).toMatchObject({ cli_config_dir: "/srv/factory/stage/.blocks-cli", cli_cwd: "/srv/factory/stage/cli" });
  });

  it("puts the repos and the CLI in the product's folder and re-points the engine's own scripts", () => {
    const h = make();
    const repos = h.data.repos as Record<string, Record<string, unknown>>;
    expect(repos.web!.path).toBe(path.join(dir, "ledgerly-web"));
    expect(repos.api!.path).toBe(path.join(dir, "ledgerly-api"));
    expect(repos.web!.role).toBe("web");
    expect(h.file).toBe(path.join(dir, "ledgerly.yml"));
    expect(h.cliRepo).toBe("api");
    expect(h.data.cli).toMatchObject({ run_js: path.join(dir, "ledgerly-api", "node_modules", "@seliseblocks", "cli-os", "bin", "run.js"), cwd: path.join(dir, "ledgerly-api"), deploy_timeout: 1500, poll_interval: 2 });
    const uilm = (repos.web!.fast_verify as Array<{ name: string; argv: string[] }>).find((s) => s.name === "uilm-check")!;
    expect(uilm.argv).toEqual(["python3", `${engineHome}/MADP/orchestrator/cli/uilm_sync.py`, "--project", h.file, "--check"]);
    const live = (repos.api!.live_test as Array<{ argv: string[] }>)[0]!.argv;
    expect(live[1]).toBe(`${engineHome}/MADP/scripts/live-gate.mjs`);
    expect(live[live.length - 1]).toBe(`node "${engineHome}/MADP/scripts/live-suites.mjs" {url} --waves "i18n;sales"`);
    expect(h.notes.join("\n")).toMatch(/live-suites-core" reads a \.env file/);
    // kept as they are
    expect(repos.web!.keywords).toEqual(["ui", "button", "page", "on", "modal"]);
    expect(repos.web!.health).toEqual(["https://dev-web.example.test/"]);
    expect(repos.api!.isolation).toEqual({ links: ["node_modules", ".local"], copy: [".env"] });
    expect(h.data.localization).toEqual({ repo: "web", dir: "src/i18n/locales", source: "en-US", cultures: ["en-US", "de-CH"], key_style: "dot", parts: "merge" });
    expect(h.data.standards).toEqual({ profile: "selise-blocks-app", file: "MADP/profiles/selise-blocks-app/CLAUDE.md" });
    // the YAML reads back as the data ("on" stays a string)
    expect(parseRegistry(h.yaml)).toEqual(h.data);
  });

  it("uses the operator's dev tenant and the Factory's author unless others are given", () => {
    const h = make();
    expect((h.data.environments as Record<string, unknown>).dev).toEqual({ branch: "dev", tenant_id: DEV });
    expect(h.data.git).toEqual({ author_name: "MADP Factory", author_email: "engine@madp-factory.local", commit_trailer: "" });
    const g = make({ author: { name: "Release Bot", email: "release@factory.example" }, commitTrailer: "Change-Source: factory" });
    expect(g.data.git).toEqual({ author_name: "Release Bot", author_email: "release@factory.example", commit_trailer: "Change-Source: factory" });
    expect(() => make({ devTenant: "S0123456789abcdef0123456789abcdef" })).toThrow(/dev tenant/);
    expect(() => make({ devTenant: "D123" })).toThrow(/dev tenant/);
    expect(() => make({ dir: "relative/madp" })).toThrow(/absolute/);
  });

  it("passes the official validator, dev only and with STAGE", () => {
    if (!hasPython) return;
    for (const withStage of [false, true]) {
      const d = path.join(tmp, withStage ? "stage" : "dev", "madp");
      const h = hostRegistry(SOURCE, { dir: d, devTenant: DEV, engineHome: ENGINE, withStage });
      fs.mkdirSync(path.join(d, "ledgerly-web", "src", "i18n", "locales"), { recursive: true });
      const cli = path.join(d, "ledgerly-api", "node_modules", "@seliseblocks", "cli-os", "bin");
      fs.mkdirSync(cli, { recursive: true });
      fs.writeFileSync(path.join(cli, "run.js"), "");
      fs.writeFileSync(h.file, h.yaml);
      const r = officialCheck(h.file);
      expect(r.out).toMatch(/✓/);
      expect(r.ok).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ the attach command

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

/** A bare repo <base>/<org>/<repo>.git with a dev branch holding the given files. */
function bareRepo(base: string, slug: string, files: Record<string, string>): void {
  const work = path.join(tmp, "work", slug.replace("/", "-"));
  fs.mkdirSync(work, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true });
    fs.writeFileSync(path.join(work, f), body);
  }
  git(work, "init", "-q");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "initial");
  const bare = path.join(base, `${slug}.git`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  git(tmp, "clone", "-q", "--bare", work, bare);
}

/** git for real; npm ci only puts the official CLI where an install would. */
const fakeNpm = (calls: string[]): Exec => async (cmd, args, o) => {
  if (cmd === "npm") {
    calls.push(`${args.join(" ")} @ ${path.basename(o.cwd ?? "")}`);
    const bin = path.join(o.cwd!, "node_modules", "@seliseblocks", "cli-os", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "run.js"), "");
    return { code: 0, stdout: "", stderr: "" };
  }
  return runCommand(cmd, args, o);
};

function fakeData(project: Record<string, unknown> | null) {
  let row = project ? { ...project } : null;
  const releases: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const data: FactoryData = {
    project: async () => (row ? structuredClone(row) : null),
    releases: async () => structuredClone(releases),
    link: async (seen, patch) => {
      calls.push("link");
      if (!row || row.BlocksProjectRef !== seen.BlocksProjectRef) return false;
      row = { ...row, ...patch };
      return true;
    },
    insertRelease: async (r) => {
      calls.push("insertRelease");
      releases.push({ ...r, ItemId: `rel-${releases.length + 1}` });
      return { created: true, itemId: `rel-${releases.length}` };
    },
    updateProject: async (_id, patch) => {
      calls.push("updateProject");
      row = { ...row!, ...patch };
    },
  };
  return { data, row: () => row, releases, calls };
}

describe("attaching an existing product", () => {
  const PROJECT = { ItemId: "proj-1", Status: "active", WorkspaceId: "ws1", ReaderIds: ["user-1"], CreatedByUserId: "user-1", Stage: "board", Rev: 4, RepoMode: "existing", BlocksProvisioningStatus: "pending" };

  function setup() {
    const folder = path.join(tmp, "engine", "projects", "ws1", "proj-1");
    fs.mkdirSync(folder, { recursive: true });
    const gitBase = path.join(tmp, "git");
    const lock = JSON.stringify({ name: "x", lockfileVersion: 3, requires: true, packages: { "": { name: "x" } } });
    const ignore = { ".gitignore": "node_modules/\n" };
    bareRepo(gitBase, "example-org/ledgerly-web", { ...ignore, "package.json": JSON.stringify({ name: "ledgerly-web", version: "2.4.1" }), "package-lock.json": lock, "src/i18n/locales/en-US.json": "{}" });
    bareRepo(gitBase, "example-org/ledgerly-api", { ...ignore, "package.json": JSON.stringify({ name: "ledgerly-api", version: "0.9.0" }), "package-lock.json": lock });
    const registryFile = path.join(tmp, "source", "ledgerly.yml");
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(registryFile, SOURCE);
    return {
      folder,
      options: { projectId: "proj-1", projectFolder: folder, registryFile, devTenant: DEV, webUrl: "https://dev-web.example.test", liveUrl: "https://dev-web.example.test", engineHome: ENGINE, gitBase: `file://${gitBase}` },
    };
  }

  it("plans the rows it would write", () => {
    const rows = factoryRows({ projectId: "proj-1", project: PROJECT, releases: [], devTenant: DEV, webUrl: "https://dev-web.example.test", live: { url: "https://dev-web.example.test", version: "1.0.0", at: "2026-11-05T10:00:00.000Z" } });
    expect(rows.link).toEqual({ BlocksProjectRef: DEV, BlocksProjectDomain: "https://dev-web.example.test", BlocksProvisioningStatus: "ready", BlocksProvisioningError: "" });
    expect(rows.stage).toEqual({ Stage: "release", Rev: 5 });
    expect(rows.release).toMatchObject({ ProjectId: "proj-1", WorkspaceId: "ws1", ReaderIds: ["user-1"], Environment: "dev", Version: "1.0.0", Url: "https://dev-web.example.test", Status: "released", ChangeRequestIds: [], ReleasedAt: "2026-11-05T10:00:00.000Z" });
    const linked = factoryRows({ projectId: "proj-1", project: { ...PROJECT, BlocksProjectRef: DEV, Stage: "release" }, releases: [{ Environment: "dev", Version: "1.0.0" }], devTenant: DEV, webUrl: "https://dev-web.example.test", live: { url: "https://dev-web.example.test", version: "1.0.0", at: "x" } });
    expect([linked.link, linked.stage, linked.release, linked.problems]).toEqual([null, null, null, []]);
    expect(factoryRows({ projectId: "proj-1", project: { ...PROJECT, BlocksProjectRef: OTHER_DEV }, releases: [], devTenant: DEV, webUrl: "https://x.example.test" }).problems.join()).toMatch(/another Blocks project/);
    expect(factoryRows({ projectId: "proj-1", project: null, releases: [], devTenant: DEV, webUrl: "https://x.example.test" }).problems.join()).toMatch(/no project/);
  });

  it("dry run: prints the plan and writes nothing", async () => {
    if (!hasPython) return;
    const s = setup();
    const f = fakeData(PROJECT);
    const lines: string[] = [];
    const r = await attachExisting(s.options, { exec: fakeNpm([]), data: f.data, log: (l) => lines.push(l) });
    expect(r.done).toBe(false);
    expect(r.plan.problems).toEqual([]);
    expect(fs.readdirSync(s.folder)).toEqual([]);
    expect(f.calls).toEqual([]);
    const out = lines.join("\n");
    expect(out).toMatch(/Plan \(dry run, nothing is written\)/);
    expect(out).toMatch(/web: example-org\/ledgerly-web \(branch dev\)/);
    expect(out).toMatch(/only while it has no Blocks project: \{"BlocksProjectRef":"D0123/);
    expect(out).toMatch(/new Release row: \{"ProjectId":"proj-1"/);
    expect(out).toMatch(/"Stage":"release","Rev":5/);
    for (const p of PERSONAL.filter((x) => x !== "/opt/operator")) expect(out).not.toContain(p);
  });

  it("--yes: clones, installs, writes the registry and factory.json, links and records the product; again changes nothing", async () => {
    if (!hasPython) return;
    const s = setup();
    const f = fakeData(PROJECT);
    const npm: string[] = [];
    const r = await attachExisting({ ...s.options, yes: true }, { exec: fakeNpm(npm), data: f.data, log: () => undefined });
    expect(r.plan.problems).toEqual([]);
    expect(r.done).toBe(true);
    const dir = path.join(s.folder, "madp");
    for (const key of ["web", "api"]) expect(git(path.join(dir, `ledgerly-${key}`), "rev-parse", "--abbrev-ref", "HEAD")).toBe("dev");
    // npm ci in each clone, then each repo's checks once on its pristine dev branch (the web build is the fake npm's)
    expect(npm).toEqual(["ci --no-audit --no-fund @ ledgerly-web", "ci --no-audit --no-fund @ ledgerly-api", "run build @ ledgerly-web"]);
    expect(officialCheck(path.join(dir, "ledgerly.yml")).ok).toBe(true);
    // each environment signs in to Blocks in the product's own store on the engine host
    const written = parseRegistry(fs.readFileSync(path.join(dir, "ledgerly.yml"), "utf8")).environments as Record<string, Record<string, unknown>>;
    expect(written.dev!.cli_config_dir).toBe(productStore("ledgerly", "dev"));
    expect(fs.readdirSync(dir).sort()).toEqual(["ONBOARDING.md", "factory.json", "ledgerly-api", "ledgerly-web", "ledgerly.yml", "onboarding.json", "reports"]);
    // the engine's dictionary check wrote its report in the product's folder, never in the official engine
    expect(fs.readdirSync(path.join(dir, "reports", "uilm")).length).toBeGreaterThan(0);
    // the onboarding: failing checks left out of the gate (a repo keeps one verify step), live tests off
    const reg = parseRegistry(fs.readFileSync(path.join(dir, "ledgerly.yml"), "utf8"));
    const repos = reg.repos as Record<string, Record<string, Array<{ name: string }>>>;
    expect(repos.web!.verify!.map((x) => x.name)).toEqual(["build"]);
    expect(repos.web!.fast_verify).toBeUndefined();
    expect(repos.api!.verify!.map((x) => x.name)).toEqual(["typecheck"]);
    expect(repos.api!.live_test).toBeUndefined();
    const onboarding = reg.onboarding as { live_tests: string; left_out: Array<{ repo: string; kind: string; name: string; reason: string }> };
    expect(onboarding.live_tests).toBe("off");
    expect(onboarding.left_out.map((x) => `${x.repo}.${x.kind}.${x.name}`).sort()).toEqual(["api.live_test.live-suites-core", "web.fast_verify.typecheck-incremental", "web.fast_verify.uilm-check", "web.verify.typecheck"]);
    const report = JSON.parse(fs.readFileSync(path.join(dir, "onboarding.json"), "utf8"));
    expect(report.notRunnable).toEqual([{ repo: "web", kind: "fast_verify", name: "extra", reason: "it names a file on another machine" }]);
    expect(report.attention.join("\n")).toMatch(/Every build check of api fails/);
    const md = fs.readFileSync(path.join(dir, "ONBOARDING.md"), "utf8");
    for (const p of [...PERSONAL, tmp, os.homedir()]) expect(md).not.toContain(p);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8"))).toEqual({ name: "ledgerly", org: "example-org", existing: true, data: true, setup: { web: true, api: true }, url: "https://dev-web.example.test" });
    expect(f.row()).toMatchObject({ BlocksProjectRef: DEV, BlocksProjectDomain: "https://dev-web.example.test", BlocksProvisioningStatus: "ready", Stage: "release", Rev: 5 });
    expect(f.releases).toHaveLength(1);
    expect(f.releases[0]).toMatchObject({ Environment: "dev", Version: "2.4.1", Status: "released", RequestKey: "factory:attach:proj-1:release:dev" });

    // the Factory now uses it as it is
    const app = existingApp(dir, JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8")));
    expect(app).toMatchObject({ name: "ledgerly", tenant: DEV, url: "https://dev-web.example.test", org: "example-org" });
    expect(Object.keys(app.repos)).toEqual(["web", "api"]);

    // a second run: clones kept, no second release, no second link
    const again = await attachExisting({ ...s.options, yes: true }, { exec: fakeNpm([]), data: f.data, log: () => undefined });
    expect(again.plan.problems).toEqual([]);
    expect(again.plan.repos.every((x) => x.present)).toBe(true);
    expect(f.releases).toHaveLength(1);
    expect(f.calls.filter((c) => c === "link")).toHaveLength(1);
  });

  it("never re-links a project linked to another Blocks project, and writes nothing then", async () => {
    if (!hasPython) return;
    const s = setup();
    const f = fakeData({ ...PROJECT, BlocksProjectRef: OTHER_DEV });
    const r = await attachExisting({ ...s.options, yes: true }, { exec: fakeNpm([]), data: f.data, log: () => undefined });
    expect(r.done).toBe(false);
    expect(r.plan.problems.join()).toMatch(/another Blocks project/);
    expect(fs.readdirSync(s.folder)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("refuses a folder that is not the project's", async () => {
    const s = setup();
    await expect(attachExisting({ ...s.options, projectId: "proj-2" }, { exec: fakeNpm([]), data: null, log: () => undefined })).rejects.toThrow(/not this project's engine folder/);
  });
});

// ------------------------------------------------------------------ ensureApp

/** The JobRun parts ensureApp and runLane use. */
function fakeRun(folder: string, project: Record<string, unknown>, name = "Ledgerly"): JobRun {
  const steps: string[] = [];
  return {
    id: "job-1",
    projectId: "proj-1",
    deps: { projectFolder: () => undefined },
    folder: () => ({ dir: folder }),
    p: { name, project },
    signal: new AbortController().signal,
    heartbeat: async () => undefined,
    log: () => undefined,
    check: () => undefined,
    step: async (_p: number, l: string) => void steps.push(l),
  } as unknown as JobRun;
}

const noStep = async () => undefined;

describe("ensureApp for an existing product", () => {
  function attached(keys: string[]) {
    const folder = path.join(tmp, "projects", "ws1", "proj-1");
    const dir = path.join(folder, "madp");
    const repos = keys.map((k) => `  ${k}:\n    path: ${path.join(dir, `acme-${k}`)}\n    repo: example-org/acme-${k}\n    branch: dev\n    verify:\n      - {name: t, argv: [node, -v]}\n`).join("");
    fs.mkdirSync(dir, { recursive: true });
    const cli = writeFakeBlocksCli(path.join(tmp, "cli"));
    fs.writeFileSync(path.join(dir, "acme.yml"), `project: acme\nenvironments:\n  dev:\n    branch: dev\n    tenant_id: ${DEV}\ngit: {author_name: MADP Factory, author_email: engine@madp-factory.local}\ncli: {run_js: ${cli.runJs}, cwd: /x}\nrepos:\n${repos}`);
    // the product's own Blocks sign-in is there already
    signedIn(productStore("acme", "dev"), DEV);
    process.env.FAKE_CLI_LOG = path.join(tmp, "cli.log");
    for (const k of keys) {
      fs.mkdirSync(path.join(dir, `acme-${k}`), { recursive: true });
      git(path.join(dir, `acme-${k}`), "init", "-q");
    }
    const state = { name: "acme", org: "example-org", existing: true, data: true, setup: Object.fromEntries(keys.map((k) => [k, true])), url: "https://acme.example.test" };
    fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify(state));
    return { folder, dir, state };
  }
  let envBefore: string | undefined;
  beforeEach(() => {
    envBefore = process.env.MF_MADP_ENGINE_HOME;
    // no engine at all: any lane, CLI or set-up step would fail
    process.env.MF_MADP_ENGINE_HOME = path.join(tmp, "no-engine");
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env.MF_MADP_ENGINE_HOME;
    else process.env.MF_MADP_ENGINE_HOME = envBefore;
    delete process.env.FAKE_CLI_LOG;
  });

  it("uses the registry as it is, with any repo keys, and sets nothing up", async () => {
    const a = attached(["api", "web", "worker"]);
    const before = fs.readFileSync(path.join(a.dir, "factory.json"), "utf8");
    // the Factory project has no Blocks project of its own: nothing is provisioned or asked of it
    const app = await ensureApp(fakeRun(a.folder, {}), noStep);
    expect(app).toEqual({
      name: "acme", dir: a.dir, registry: path.join(a.dir, "acme.yml"), org: "example-org", tenant: DEV, url: "https://acme.example.test",
      repos: { api: path.join(a.dir, "acme-api"), web: path.join(a.dir, "acme-web"), worker: path.join(a.dir, "acme-worker") },
    });
    expect(fs.readFileSync(path.join(a.dir, "factory.json"), "utf8")).toBe(before);
    expect(fs.readdirSync(a.dir).sort()).toEqual(["acme-api", "acme-web", "acme-worker", "acme.yml", "factory.json"]);
    // a registry attached before every product had its own Blocks sign-in names its store now, and only the session was checked
    const reg = parseRegistry(fs.readFileSync(path.join(a.dir, "acme.yml"), "utf8"));
    expect((reg.environments as Record<string, Record<string, unknown>>).dev!.cli_config_dir).toBe(productStore("acme", "dev"));
    expect(cliCalls(process.env.FAKE_CLI_LOG!)).toEqual([[productStore("acme", "dev"), `auth status --json --account default --project ${DEV}`]]);
  });

  it("stops in plain words when a clone is missing", async () => {
    const a = attached(["app"]);
    fs.rmSync(path.join(a.dir, "acme-app", ".git"), { recursive: true, force: true });
    await expect(ensureApp(fakeRun(a.folder, {}), noStep)).rejects.toThrow(/the app repository is missing/);
  });
});

describe("ensureApp for a new one-repo product", () => {
  const PROJECT = { BlocksProvisioningStatus: "ready", BlocksProjectRef: DEV, BlocksProjectDomain: "https://app.example.test" };
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete saved[k];
    }
  });

  /** A unified product's folder: registry with one `app` repo, a fake official CLI in it that logs its calls. */
  function unified(o: { linked: boolean; data: boolean; setup?: Record<string, boolean> }) {
    const folder = path.join(tmp, "projects", "ws1", "proj-1");
    const dir = path.join(folder, "madp");
    const repo = path.join(dir, "shop");
    const bin = path.join(repo, "node_modules", "@seliseblocks", "cli-os", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "shop", private: true, scripts: { "data:sync": "node scripts/data-sync.mjs" } }));
    fs.writeFileSync(path.join(repo, "scripts", "data-sync.mjs"), `import fs from "node:fs"; fs.appendFileSync(process.env.FAKE_LOG, "data-sync " + process.argv.slice(2).join(" ") + "\\n");\n`);
    fs.writeFileSync(path.join(bin, "run.js"), [
      "const fs = require('fs'); const a = process.argv.slice(2);",
      "fs.appendFileSync(process.env.FAKE_LOG, 'cli ' + a.join(' ') + '\\n');",
      "if (a[0] === 'auth' && a[1] === 'status') console.log(JSON.stringify({ projectAccessToken: 'valid', projectRefreshToken: 'valid' }));",
      "else if (a[0] === 'release' && a[1] === 'repos') console.log(JSON.stringify({ items: process.env.FAKE_LINKED ? [{ repository: process.env.FAKE_LINKED }] : [] }));",
      "else if (a[0] === 'release' && a[1] === 'setup' && !a.includes('--dry-run')) console.log(JSON.stringify({ verdict: 'succeeded', url: 'https://shop-live.example.test' }));",
      "else console.log('{}');",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "shop.yml"), [
      "project: shop", "environments:", "  dev:", "    branch: dev", `    tenant_id: ${DEV}`,
      "git: {author_name: MADP Factory, author_email: engine@madp-factory.local}",
      `cli: {run_js: ${path.join(bin, "run.js")}, cwd: ${repo}}`,
      "repos:", "  app:", `    path: ${repo}`, "    repo: example-org/shop", "    branch: dev", "    role: web",
      "    verify: [{name: t, argv: [node, -v]}]", "    health: [https://app.example.test/health/live, https://app.example.test/]", "",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify({ name: "shop", org: "example-org", data: o.data, setup: o.setup ?? {} }));
    const log = path.join(tmp, "calls.log");
    fs.writeFileSync(log, "");
    setEnv("FAKE_LOG", log);
    setEnv("FAKE_LINKED", o.linked ? "example-org/shop" : "");
    // the sign-in check is not a set-up step: the calls below leave it out
    return { folder, dir, repo, calls: () => fs.readFileSync(log, "utf8").split("\n").map((l) => l.trimEnd()).filter((l) => l && !l.startsWith("cli auth status")) };
  }

  it("asks for exactly its one repository in the portal, never naming the GitHub account MADP Factory keeps the code in", async () => {
    // "Keep it in MADP Factory": the project's record names no repository; the engine's own GitHub account is not shown
    const u = unified({ linked: false, data: true });
    await expect(ensureApp(fakeRun(u.folder, PROJECT), noStep)).rejects.toThrow(
      'One step in the Blocks portal is needed: in this product\'s Blocks project, open Release and add MADP Factory\'s repository shop (branch "dev"). Then start the build again.',
    );
    expect(linkMessage([{ repo: "o/a", branch: "dev" }, { repo: "o/b", branch: "dev" }])).toMatch(/add MADP Factory's repositories a and b \(branch "dev"\)/);
    // a repository the project's own record names (the team's) keeps its owner, as the project's page shows it
    expect(linkMessage([{ repo: "o/a", branch: "dev" }, { repo: "o/b", branch: "dev" }], "O")).toMatch(/add the repositories o\/a and o\/b \(branch "dev"\)/);
    await expect(ensureApp(fakeRun(u.folder, { ...PROJECT, RepoOwner: "example-org", RepoName: "shop" }), noStep)).rejects.toThrow(/add the repository example-org\/shop \(branch "dev"\)/);
  });

  it("names a repository by its owner only when the project's own record names that owner", () => {
    expect(shownRepo("engine-login/shop-ab12cd")).toBe("shop-ab12cd");
    expect(shownRepo("engine-login/shop-ab12cd", "")).toBe("shop-ab12cd");
    expect(shownRepo("engine-login/shop-ab12cd", "someone-else")).toBe("shop-ab12cd");
    expect(shownRepo("Team-Org/shop", " team-org ")).toBe("Team-Org/shop");
    expect(shownRepo("shop")).toBe("shop");
  });

  it("runs the data step in the repo that has it, then the first deployment of its one repo", async () => {
    const u = unified({ linked: true, data: false });
    const lines: string[] = [];
    const app = await ensureApp(fakeRun(u.folder, PROJECT), async (_pct, line) => void lines.push(line));
    // the progress people read names the repository, never the GitHub account MADP Factory keeps the code in
    expect(lines).toContain("First deployment of the app on Blocks (shop).");
    expect(lines.join("\n")).not.toContain("example-org");
    const calls = u.calls();
    expect(calls.filter((c) => c.startsWith("data-sync"))).toEqual(["data-sync", "data-sync --yes"]);
    const cli = calls.filter((c) => c.startsWith("cli"));
    expect(cli[0]).toMatch(/^cli release repos list --project D0123\S+ --account default --json$/);
    expect(cli.slice(1).map((c) => c.split(" --project")[0])).toEqual(["cli release setup example-org/shop --dry-run", "cli release setup example-org/shop --wait --yes"]);
    expect(app.repos).toEqual({ app: u.repo });
    expect(app.url).toBe("https://shop-live.example.test");
    expect(JSON.parse(fs.readFileSync(path.join(u.dir, "factory.json"), "utf8"))).toMatchObject({ data: true, setup: { app: true }, url: "https://shop-live.example.test" });
    // done: a second call deploys nothing
    fs.writeFileSync(process.env.FAKE_LOG!, "");
    await ensureApp(fakeRun(u.folder, PROJECT), noStep);
    expect(u.calls()).toEqual([]);
  });

  it("asks for the one-repo layout only when the installed official engine offers it", () => {
    const home = path.join(tmp, "engine-layout");
    const cli = path.join(home, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cli, { recursive: true });
    expect(layoutArgs(home)).toEqual([]);
    fs.writeFileSync(path.join(cli, "new_app.py"), 'add("--layout", default="unified")\n');
    expect(layoutArgs(home)).toEqual(["--layout", "unified"]);
    fs.writeFileSync(path.join(cli, "new_app.py"), 'add("--github-org", required=True)\n');
    expect(layoutArgs(home)).toEqual([]);
  });

  it("sets a new product up with `madp new-app --layout unified` and keys its state by the registry's repos", async () => {
    if (!hasPython) return;
    const folder = path.join(tmp, "projects", "ws1", "proj-1");
    const dir = path.join(folder, "madp");
    const engine = path.join(tmp, "fake-engine");
    const cliDir = path.join(engine, "MADP", "orchestrator", "cli");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, "project.py"), [
      "import json, os, sys",
      "a = sys.argv[1:]",
      "open(os.environ['FAKE_LOG'], 'a').write(json.dumps(a) + '\\n')",
      "v = lambda k: a[a.index(k) + 1]",
      "repo = os.path.join(v('--dir'), a[1])",
      "os.makedirs(repo, exist_ok=True)",
      "reg = {'project': a[1], 'environments': {'dev': {'branch': 'dev', 'tenant_id': v('--tenant-id')}},",
      "       'git': {'author_name': v('--author-name'), 'author_email': v('--author-email')},",
      "       'cli': {'run_js': os.path.join(repo, 'node_modules/@seliseblocks/cli-os/bin/run.js'), 'cwd': repo},",
      "       'repos': {'app': {'path': repo, 'repo': v('--github-org') + '/' + a[1], 'branch': 'dev', 'role': 'web', 'verify': [{'name': 't', 'argv': ['node', '-v']}]}}}",
      "open(os.path.join(v('--dir'), a[1] + '.yml'), 'w').write(json.dumps(reg))",
      "open(os.environ['FAKE_LOG'] + '.store', 'w').write(os.environ.get('BLOCKS_CONFIG_DIR', ''))",
    ].join("\n"));
    // an official engine whose new-app offers the one-repo layout
    fs.writeFileSync(path.join(cliDir, "new_app.py"), 'add("--layout", choices=["unified", "split"])\n');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "factory.json"), JSON.stringify({ org: "example-org", oidcClientId: "client-1" }));
    const log = path.join(tmp, "lane.log");
    fs.writeFileSync(log, "");
    setEnv("FAKE_LOG", log);
    setEnv("MF_MADP_ENGINE_HOME", engine);
    setEnv("MF_MADP_PYTHON", "python3");
    // before any registry the engine's own CLI checks the product's sign-in, in the product's own store
    const fake = writeFakeBlocksCli(path.join(tmp, "cli"));
    setEnv("PATH", `${path.dirname(fake.bin)}${path.delimiter}${process.env.PATH ?? ""}`);
    setEnv("FAKE_CLI_LOG", path.join(tmp, "cli.log"));
    const store = productStore(appName("Shop", "proj-1"), "dev");
    signedIn(store, DEV);
    const app = await ensureApp(fakeRun(folder, PROJECT, "Shop"), noStep);
    expect(cliCalls(process.env.FAKE_CLI_LOG!)).toEqual([[store, `auth status --json --account default --project ${DEV}`]]);
    expect(fs.readFileSync(`${log}.store`, "utf8")).toBe(store);
    expect((parseRegistry(fs.readFileSync(app.registry, "utf8")).environments as Record<string, Record<string, unknown>>).dev!.cli_config_dir).toBe(store);
    const args = JSON.parse(fs.readFileSync(log, "utf8").trim()) as string[];
    expect(args.slice(0, 4)).toEqual(["new-app", app.name, "--layout", "unified"]);
    expect(args).toEqual(expect.arrayContaining(["--yes", "--create-github", "--deploy", "--author-name", "MADP Factory"]));
    expect(app.repos).toEqual({ app: path.join(dir, app.name) });
    expect(app.url).toBe("https://app.example.test");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8"))).toMatchObject({ name: app.name, data: true, setup: { app: true } });
    expect(registryRepos(parseRegistry(fs.readFileSync(app.registry, "utf8"))).map((r) => r.key)).toEqual(["app"]);
  });
});

describe("the project's Code step after attaching an existing product", () => {
  it("records the main repository, branch, web address and every repository, without overwriting answers", async () => {
    const { codeRows } = await import("../../server/local/engine/official/attach.ts");
    const repos = [
      { key: "web", repo: "example-org/books-web", branch: "dev", role: "web" },
      { key: "api", repo: "example-org/books-api", branch: "dev", role: "api" },
    ];
    const rows = codeRows({}, repos, "https://books.example.test")!;
    expect(rows).toMatchObject({ RepoProvider: "github", RepoOwner: "example-org", RepoName: "books-web", RepoBranch: "dev", RepoMode: "existing", AppUrl: "https://books.example.test" });
    expect(JSON.parse(String(rows.TestEnv))).toMatchObject({ available: "yes", url: "https://books.example.test" });
    expect(String(rows.RunInstructions)).toContain("API: example-org/books-api (branch dev)");
    // filled in by people: kept; recorded already: nothing to write
    const kept = codeRows({ AppUrl: "https://own.example.test", RunInstructions: "npm start" }, repos, "https://books.example.test")!;
    expect(kept.AppUrl).toBeUndefined();
    expect(kept.RunInstructions).toBeUndefined();
    expect(codeRows({ RepoOwner: "x", RepoName: "y", RepoBranch: "main" }, repos, "https://books.example.test")).toBeNull();
    expect(codeRows({}, [], "https://books.example.test")).toBeNull();
  });
});

describe("the engine's own Blocks CLI in an attached product's registry", () => {
  it("is a host path, never taken for the operator's machine (it lives under the engine user's home)", async () => {
    const { hostRegistry } = await import("../../server/local/engine/official/hostRegistry.ts");
    const src = [
      "project: books", "standards: {profile: selise-blocks-app}", "default_env: dev",
      "environments:", "  dev: {branch: dev}", "deploy: true",
      "git: {author_name: Someone, author_email: someone@example.test}",
      "cli: {run_js: /home/operator/code/books-api/node_modules/@seliseblocks/cli-os/bin/run.js, cwd: /home/operator/code/books-api}",
      "repos:",
      "  api: {path: /home/operator/code/books-api, repo: example-org/books-api, branch: dev, role: api, verify: [{name: typecheck, argv: [npx, tsc]}]}",
    ].join("\n");
    const engineCli = "/srv/engine-host/home/.local/lib/node_modules/@seliseblocks/cli-os/bin/run.js";
    const host = hostRegistry(src, { dir: "/srv/engine-host/projects/w/p/madp", devTenant: `D${"a".repeat(32)}`, engineHome: "/srv/engine-host/app/engine/selise-madp", cliRunJs: engineCli });
    expect(host.yaml).toContain(engineCli);
    expect(host.yaml).not.toContain("/home/operator");
  });
});

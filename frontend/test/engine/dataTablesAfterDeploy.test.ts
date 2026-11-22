// Data tables after a deploy (official/dataTables.ts): after a build or change lane, an API repo whose schema files
// (blocks/data/schemas) the lane's commits changed runs its own data sync: additive changes only, dry run first, then
// the apply, in a clean worktree at the deployed commit with the product's own Blocks store and account. Temp git repos
// for real; the sync scripts are fakes that record how they were run. No Blocks call.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import {
  EXPOSED_LINE,
  FAILED_LINE,
  NO_SCRIPT_LINE,
  REFUSED_LINE,
  afterDeployNote,
  compareSchemas,
  createdTablesIn,
  dataRepos,
  flagConvention,
  parseSchema,
  readDataRecord,
  scriptCommand,
  syncDataTables,
  syncScriptOf,
  unlockedTables,
  updatedLine,
  type TableSchema,
} from "../../server/local/engine/official/dataTables.ts";
import { SYNCED_LINE, withTexts } from "../../server/local/engine/official/uilm.ts";
import { sharedDataSync } from "../../server/local/engine/official/sharedDataSync.ts";

const SCHEMAS = "blocks/data/schemas";
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

type Files = Record<string, unknown>;

function write(repo: string, files: Files): void {
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(repo, name);
    if (body === null) {
      fs.rmSync(f, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
}

/** A lane's commit of these files (null deletes one); answers the 9-character sha the lanes print. */
function commit(repo: string, files: Files, msg = "feat(api): change"): string {
  write(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD").slice(0, 9);
}

const field = (name: string, type = "String", extra: Record<string, unknown> = {}) => ({ name, type, isArray: false, isPIIData: false, isUniqueData: false, description: "", ...extra });
const table = (name: string, fields: ReturnType<typeof field>[]) => ({ schemaName: name, collectionName: `blx_${name}s`, schemaType: 1, fields });

const EMPLOYEE = table("Employee", [field("UKey", "String", { isUniqueData: true }), field("Name"), field("StartDate", "DateTime")]);
const PLAN = table("Plan", [field("UKey", "String", { isUniqueData: true }), field("Code"), field("PriceMinor", "Int")]);
const BASE: Files = { [`${SCHEMAS}/Employee.json`]: EMPLOYEE, [`${SCHEMAS}/Plan.json`]: PLAN };

/** A fake data sync that records each run (mode, argv, folder, store, account, the schemas it read) in `log`; it fails
 *  when `<log>.fail-<mode>` exists. `yes`: the template's convention (dry run by default, --yes applies); `dry-run`: an
 *  existing product's (--dry-run previews, no flag applies). Its apply plays the push and the rules on the fake Blocks
 *  project (`state`, the fake CLI's): a new table is created Public (printed as the CLI does, "grantedPublicAccess"),
 *  then locked with service-only policies. Knobs (files next to the log): .fail-after-push (stops after the push, every
 *  time), .fail-after-push-once (once), .no-rules (the apply "works" but deploys no rules), .half-rules (read and insert
 *  only). */
function fakeScript(log: string, convention: "yes" | "dry-run", state: string): string {
  return `import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
${convention === "yes" ? 'const apply = process.argv.includes("--yes");' : 'const dry = process.argv.includes("--dry-run");\nconst apply = !dry;'}
const dir = join(root, "blocks", "data", "schemas");
const schemas = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]));
const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const mode = apply ? "apply" : "dry";
const log = ${JSON.stringify(log)};
appendFileSync(log, JSON.stringify({ mode, argv: process.argv.slice(2), root, store: process.env.BLOCKS_CONFIG_DIR ?? "", account: process.env.MF_BLOCKS_RELEASE_ACCOUNT ?? "", schemas, nodeModules: existsSync(join(root, "node_modules", "marker.txt")), status }) + "\\n");
console.log("pushing " + Object.keys(schemas).length + " schemas; session token=abc123secretvalue");
if (existsSync(log + ".fail-" + mode)) { console.error("simulated failure in " + mode); process.exit(3); }
if (apply) {
  const stateFile = ${JSON.stringify(state)};
  const st = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  st.schemas ??= []; st.policies ??= []; st.security ??= {};
  const save = () => writeFileSync(stateFile, JSON.stringify(st, null, 2));
  const created = [];
  for (const s of Object.values(schemas)) {
    if (st.schemas.some((x) => x.schemaName === s.schemaName)) continue;
    const id = "sch-" + String(st.schemas.length + 1).padStart(4, "0");
    st.schemas.push({ id, schemaName: s.schemaName, collectionName: s.collectionName });
    st.security[id] = { 0: 2, 1: 2, 2: 2, 3: 2 };
    created.push(s.schemaName);
  }
  save();
  console.log(JSON.stringify({ results: created.map((n) => ({ isSuccess: true, schemaName: n })), ...(created.length ? { grantedPublicAccess: created } : {}), gatewayReload: { isSuccess: true } }, null, 2));
  const stop = () => { console.error("Schema Leave (blx_Leaves) was not found after push"); process.exit(4); };
  if (existsSync(log + ".fail-after-push")) stop();
  if (existsSync(log + ".fail-after-push-once")) { rmSync(log + ".fail-after-push-once"); stop(); }
  if (!existsSync(log + ".no-rules")) {
    const ops = existsSync(log + ".half-rules") ? [0, 1] : [0, 1, 2, 3];
    for (const s of Object.values(schemas)) {
      const id = st.schemas.find((x) => x.schemaName === s.schemaName).id;
      for (const op of ops) {
        if (!st.policies.some((p) => p.schemaName === s.schemaName && p.operation === op)) st.policies.push({ schemaName: s.schemaName, policyName: "ServiceOnly" + op, operation: op });
        st.security[id][op] = 3;
      }
    }
    save();
  }
}
`;
}

/** The engine's shared fake Blocks CLI for the data commands (paged schema list, push, rules deploy and pull, sync). */
const FAKE_CLI = fileURLToPath(new URL("../../../engine/selise-madp/MADP/orchestrator/tests/fixtures/fake_blocks_data_cli.mjs", import.meta.url));
const TEMPLATE_SCRIPTS = fileURLToPath(new URL("../../../engine/selise-madp/MADP/profiles/selise-blocks-app/templates/app/scripts/", import.meta.url));

interface FakeState {
  access?: "public" | "user";
  schemas: Array<{ id: string; schemaName: string; collectionName: string }>;
  policies: Array<{ schemaName: string; policyName: string; operation: number }>;
  security: Record<string, Record<string, number>>;
  fail?: Record<string, unknown>;
}

/** The fake CLI in the clone's node_modules (where the template's blocks-cli.mjs runs it); the tables of `tables`
 *  are on the fake Blocks project already, locked as a sync before left them. */
function installFakeCli(api: string, tables: Array<{ schemaName: string; collectionName: string }>): string {
  const home = path.join(api, "node_modules", "@seliseblocks", "cli-os");
  fs.mkdirSync(path.join(home, "bin"), { recursive: true });
  fs.copyFileSync(FAKE_CLI, path.join(home, "bin", "run.js"));
  fs.writeFileSync(path.join(home, "package.json"), JSON.stringify({ name: "@seliseblocks/cli-os", type: "module" }));
  const state: FakeState = { access: "public", schemas: [], policies: [], security: {}, fail: {} };
  tables.forEach((t, i) => {
    const id = `sch-${String(i + 1).padStart(4, "0")}`;
    state.schemas.push({ id, schemaName: t.schemaName, collectionName: t.collectionName });
    state.security[id] = { 0: 3, 1: 3, 2: 3, 3: 3 };
    for (const op of [0, 1, 2, 3]) state.policies.push({ schemaName: t.schemaName, policyName: `ServiceOnly${op}`, operation: op });
  });
  fs.writeFileSync(path.join(home, "fake-state.json"), JSON.stringify(state, null, 2));
  return home;
}

interface Product {
  app: OfficialApp;
  api: string;
  store: string;
  log: string;
  calls: () => Array<{ mode: "dry" | "apply"; argv: string[]; root: string; store: string; account: string; schemas: Record<string, { fields: Array<{ name: string }> }>; nodeModules: boolean; status: string }>;
  /** The fake Blocks project and the fake CLI's calls ({cwd, args}). */
  blocks: () => FakeState;
  setBlocks: (change: (s: FakeState) => void) => void;
  cli: () => Array<{ cwd: string; args: string[] }>;
}

/** `real`: the template's own data-sync.mjs and blocks-cli.mjs, run against the fake CLI. `tables`: more tables in the
 *  first commit (and on the fake Blocks project), e.g. more than one page of the schema list. */
function product(o: { script?: "template" | "existing" | "none" | "unknown" | "real"; layout?: "two" | "one"; nodeModules?: boolean; tables?: number } = {}): Product {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-data-test-"));
  made.push(root);
  const dir = path.join(root, "madp");
  const api = path.join(dir, o.layout === "one" ? "shop-ab12cd" : "shop-ab12cd-api");
  const log = path.join(root, "calls.log");
  const home = path.join(api, "node_modules", "@seliseblocks", "cli-os");
  const stateFile = path.join(home, "fake-state.json");
  fs.mkdirSync(api, { recursive: true });
  git(api, "init", "-q", "-b", "dev");
  const script = o.script ?? "template";
  const more = Object.fromEntries(Array.from({ length: o.tables ?? 0 }, (_, i) => [`${SCHEMAS}/Ledger${String(i).padStart(3, "0")}.json`, table(`Ledger${String(i).padStart(3, "0")}`, [field("Code"), field("Amount", "Int")])]));
  const files: Files = { ...BASE, ...more, ".gitignore": "node_modules\n", "src/index.ts": "export {};\n" };
  if (script === "template") {
    files["package.json"] = { name: "shop-api", type: "module", scripts: { "data:sync": "node scripts/data-sync.mjs" } };
    files["scripts/data-sync.mjs"] = fakeScript(log, "yes", stateFile);
  } else if (script === "existing") {
    files["package.json"] = { name: "shop-api", type: "module", scripts: { build: "tsc" } };
    files["scripts/data-sync.mjs"] = fakeScript(log, "dry-run", stateFile);
  } else if (script === "real") {
    files["package.json"] = { name: "shop-api", type: "module", scripts: { "data:sync": "node scripts/data-sync.mjs" } };
    files["scripts/data-sync.mjs"] = fs.readFileSync(path.join(TEMPLATE_SCRIPTS, "data-sync.mjs"), "utf8").replace("{{SERVICE_ROLE}}", "shop-service");
    files["scripts/blocks-cli.mjs"] = fs.readFileSync(path.join(TEMPLATE_SCRIPTS, "blocks-cli.mjs"), "utf8");
  } else if (script === "unknown") {
    files["package.json"] = { name: "shop-api", type: "module" };
    files["scripts/data-sync.mjs"] = "console.log('applies everything, no preview');\n";
  } else {
    files["package.json"] = { name: "shop-api", type: "module" };
  }
  commit(api, files, "initial");
  if (o.nodeModules !== false) {
    write(api, { "node_modules/marker.txt": "installed\n" });
    installFakeCli(api, [EMPLOYEE, PLAN, ...(Object.values(more) as Array<{ schemaName: string; collectionName: string }>)]);
  }
  const store = path.join(root, "stores", "shop-ab12cd-dev");
  const yml = [
    "project: shop-ab12cd",
    "default_env: dev",
    "cli:",
    "  env:",
    "    MF_BLOCKS_RELEASE_ACCOUNT: factory-acct",
    "environments:",
    "  dev:",
    "    branch: dev",
    `    tenant_id: D${"a".repeat(32)}`,
    `    cli_config_dir: ${store}`,
    "repos:",
    ...(o.layout === "one"
      ? ["  app:", `    path: ${api}`, "    repo: example-org/shop-ab12cd", "    branch: dev", "    role: web"]
      : [
          "  web:",
          `    path: ${path.join(dir, "shop-ab12cd-web")}`,
          "    repo: example-org/shop-ab12cd-web",
          "    branch: dev",
          "    role: web",
          "  api:",
          `    path: ${api}`,
          "    repo: example-org/shop-ab12cd-api",
          "    branch: dev",
          "    role: api",
        ]),
    "",
  ].join("\n");
  const registry = path.join(dir, "shop-ab12cd.yml");
  fs.writeFileSync(registry, yml);
  const key = o.layout === "one" ? "app" : "api";
  const app: OfficialApp = { name: "shop-ab12cd", dir, registry, org: "example-org", repos: { [key]: api }, tenant: `D${"a".repeat(32)}`, url: "https://shop.example.test" };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const blocks = (): FakeState => JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const setBlocks = (change: (s: FakeState) => void) => {
    const s = blocks();
    change(s);
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  };
  const cliLog = path.join(home, "fake-calls.log");
  const cli = () => (fs.existsSync(cliLog) ? fs.readFileSync(cliLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { app, api, store, log, calls, blocks, setBlocks, cli };
}

const fakeRun = () => {
  const lines: string[] = [];
  return {
    id: "job-data-1",
    signal: new AbortController().signal,
    log: (l: string) => void lines.push(l),
    iso: () => "2026-11-05T10:00:00.000Z",
    heartbeat: async () => undefined,
    check: () => undefined,
    lines,
  };
};

const CATEGORY = table("EmploymentCategory", [field("UKey", "String", { isUniqueData: true }), field("Name"), field("WorkspaceId")]);
const withCategory = { ...EMPLOYEE, fields: [...EMPLOYEE.fields, field("CategoryId")] };

describe("the product's data sync script", () => {
  it("selects the trusted shared-session script for a standard scaffold and preserves its service role", () => {
    const template = fs.readFileSync(fileURLToPath(new URL("../../../engine/selise-madp/MADP/profiles/selise-blocks-app/templates/app/scripts/data-sync.mjs", import.meta.url)), "utf8");
    const scaffold = template.replace("{{SERVICE_ROLE}}", "shop-service");
    const olderScaffold = scaffold.replace("process.env.MF_BLOCKS_BROKER_URL && process.env.MF_BLOCKS_DATA_SERVICE_ROLE || ", "");
    for (const source of [scaffold, olderScaffold]) {
      expect(sharedDataSync(source, "/workspace/shop", "test")).toMatchObject({
        env: { MF_BLOCKS_DATA_WORKSPACE: "/workspace/shop", MF_BLOCKS_DATA_SERVICE_ROLE: "shop-service" },
      });
    }
    expect(sharedDataSync(scaffold + "\nconsole.log('custom step');\n", "/workspace/shop", "test")).toBeUndefined();
    expect(sharedDataSync(scaffold, "/workspace/shop", "test", JSON.stringify({ scripts: { "predata:sync": "node custom.js" } }))).toBeUndefined();
  });

  it("finds the template's npm script (dry run by default, --yes applies) and an existing product's (--dry-run previews)", () => {
    const template = fs.readFileSync(fileURLToPath(new URL("../../../engine/selise-madp/MADP/profiles/selise-blocks-app/templates/api/scripts/data-sync.mjs", import.meta.url)), "utf8");
    expect(flagConvention(template)).toEqual({ dry: [], apply: ["--yes"] });
    const pkg = JSON.stringify({ scripts: { "data:sync": "node scripts/data-sync.mjs" } });
    expect(syncScriptOf(pkg, (f) => (f === "scripts/data-sync.mjs" ? template : null))).toEqual({ kind: "script", script: { command: "npm", file: "scripts/data-sync.mjs", dry: [], apply: ["--yes"] } });

    const existing = 'const dry = process.argv.includes("--dry-run");\nconsole.log(blocks(["data", "schema", "push", dry ? "--dry-run" : "--yes"]));\n';
    expect(syncScriptOf(JSON.stringify({ scripts: { build: "tsc" } }), (f) => (f === "scripts/data-sync.mjs" ? existing : null))).toEqual({ kind: "script", script: { command: "node", file: "scripts/data-sync.mjs", dry: ["--dry-run"], apply: [] } });
    expect(syncScriptOf(JSON.stringify({ scripts: { "data:sync": "node --env-file=.env ./tools/sync.mjs" } }), (f) => (f === "tools/sync.mjs" ? existing : null))).toMatchObject({ kind: "script", script: { command: "npm", file: "tools/sync.mjs" } });
    expect(flagConvention("const apply = argv.includes('--yes') && !argv.includes('--dry-run');")).toEqual({ dry: ["--dry-run"], apply: ["--yes"] });

    expect(syncScriptOf(null, () => null)).toEqual({ kind: "none" });
    expect(syncScriptOf("{}", (f) => (f === "scripts/data-sync.mjs" ? "pushEverything();" : null))).toEqual({ kind: "unknown", file: "scripts/data-sync.mjs" });
    expect(syncScriptOf(JSON.stringify({ scripts: { "data:sync": "tsx scripts/sync.ts" } }), () => null)).toEqual({ kind: "unknown", file: "package.json" });
    expect(syncScriptOf(JSON.stringify({ scripts: { "data:sync": "node ../outside.mjs" } }), () => "process.argv.includes('--yes')").kind).toBe("unknown");

    expect(scriptCommand({ command: "npm", file: "scripts/data-sync.mjs", dry: [], apply: ["--yes"] }, ["--yes"])).toEqual(["npm", ["run", "data:sync", "--", "--yes"]]);
    expect(scriptCommand({ command: "npm", file: "scripts/data-sync.mjs", dry: [], apply: ["--yes"] }, [])).toEqual(["npm", ["run", "data:sync"]]);
    expect(scriptCommand({ command: "node", file: "scripts/data-sync.mjs", dry: ["--dry-run"], apply: [] }, ["--dry-run"], "/usr/bin/node")).toEqual(["/usr/bin/node", ["scripts/data-sync.mjs", "--dry-run"]]);
  });

  it("works on the API-role repos, or the one repo of a one-repo app", () => {
    const r = (key: string, role: string) => ({ key, path: `/x/${key}`, repo: `o/${key}`, branch: "dev", role });
    expect(dataRepos([r("web", "web"), r("api", "api")]).map((x) => x.key)).toEqual(["api"]);
    expect(dataRepos([r("app", "web")]).map((x) => x.key)).toEqual(["app"]);
    expect(dataRepos([r("web", "web"), r("admin", "web")])).toEqual([]);
  });
});

describe("the additive check", () => {
  const t = (s: object, file = "X.json"): TableSchema => parseSchema(file, JSON.stringify(s))!;
  const before = [t(EMPLOYEE, "Employee.json"), t(PLAN, "Plan.json")];

  it("accepts a new table and new fields", () => {
    const plan = compareSchemas(before, [t(withCategory, "Employee.json"), t(PLAN, "Plan.json"), t(CATEGORY, "EmploymentCategory.json")]);
    expect(plan).toEqual({ newTables: ["EmploymentCategory"], addedFields: [{ table: "Employee", field: "CategoryId" }], problems: [] });
    // a description or a unique flag is not a change of the data
    const described = { ...PLAN, fields: PLAN.fields.map((f) => (f.name === "Code" ? { ...f, description: "the plan's code", isUniqueData: true } : f)) };
    expect(compareSchemas(before, [t(EMPLOYEE, "Employee.json"), t(described, "Plan.json")]).problems).toEqual([]);
  });

  it("refuses a removed table, a removed, renamed or retyped field", () => {
    expect(compareSchemas(before, [t(EMPLOYEE, "Employee.json")]).problems).toEqual([{ table: "Plan", kind: "removed-table" }]);
    const removed = { ...EMPLOYEE, fields: EMPLOYEE.fields.filter((f) => f.name !== "StartDate") };
    expect(compareSchemas(before, [t(removed, "Employee.json"), t(PLAN, "Plan.json")]).problems).toEqual([{ table: "Employee", kind: "removed-field", field: "StartDate" }]);
    const renamed = { ...EMPLOYEE, fields: EMPLOYEE.fields.map((f) => (f.name === "Name" ? { ...f, name: "FullName" } : f)) };
    const r = compareSchemas(before, [t(renamed, "Employee.json"), t(PLAN, "Plan.json")]);
    expect(r.problems).toEqual([{ table: "Employee", kind: "renamed-field", field: "Name", detail: "Name -> FullName" }]);
    expect(r.addedFields).toEqual([]);
    const retyped = { ...PLAN, fields: PLAN.fields.map((f) => (f.name === "PriceMinor" ? { ...f, type: "Float" } : f)) };
    expect(compareSchemas(before, [t(EMPLOYEE, "Employee.json"), t(retyped, "Plan.json")]).problems).toEqual([{ table: "Plan", kind: "changed-type", field: "PriceMinor", detail: "Int -> Float" }]);
    const listed = { ...PLAN, fields: PLAN.fields.map((f) => (f.name === "Code" ? { ...f, isArray: true } : f)) };
    expect(compareSchemas(before, [t(EMPLOYEE, "Employee.json"), t(listed, "Plan.json")]).problems[0]).toMatchObject({ kind: "changed-type", field: "Code" });
    const moved = { ...PLAN, collectionName: "blx_PricePlans" };
    expect(compareSchemas(before, [t(EMPLOYEE, "Employee.json"), t(moved, "Plan.json")]).problems).toEqual([{ table: "Plan", kind: "renamed-table", detail: "blx_Plans -> blx_PricePlans" }]);
  });
});

describe("data tables after a deploy", () => {
  it("runs the dry run, then the apply, at the deployed commit, in the product's own Blocks store", async () => {
    const p = product();
    commit(p.api, { "src/routes.ts": "export const a = 1;\n" }, "feat(api): routes");
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY, [`${SCHEMAS}/Employee.json`]: withCategory }, "feat(api): employment categories");
    // someone edits the working tree after the lane: the sync still applies what was committed and deployed
    write(p.api, { [`${SCHEMAS}/Draft.json`]: table("Draft", [field("UKey")]) });
    const run = fakeRun();
    const steps: string[] = [];
    const out = await syncDataTables(run as never, p.app, { commits: ["abcdef123", sha, git(p.api, "rev-parse", "HEAD~1").slice(0, 9)] }, { step: async (_p, l) => void steps.push(l) });

    expect(out).toEqual({ status: "updated", line: "Data tables updated on Blocks (1 new, 1 changed fields added).", repos: ["api"], tables: 1, fields: 1 });
    expect(out.line).toBe(updatedLine(1, 1));
    const calls = p.calls();
    expect(calls.map((c) => [c.mode, c.argv])).toEqual([["dry", []], ["apply", ["--yes"]]]);
    for (const c of calls) {
      expect(c.store).toBe(p.store);
      expect(c.account).toBe("factory-acct");
      expect(c.nodeModules).toBe(true);
      expect(c.status).toBe("");
      expect(c.root.startsWith(p.api)).toBe(false);
      expect(Object.keys(c.schemas).sort()).toEqual(["Employee.json", "EmploymentCategory.json", "Plan.json"]);
      expect(c.schemas["Employee.json"]!.fields.map((f) => f.name)).toContain("CategoryId");
    }
    expect(steps).toEqual(["Updating the new build's data tables on Blocks."]);
    expect(readDataRecord(p.app)).toMatchObject({ pending: {}, last: { status: "updated", repos: ["api"], tables: 1, fields: 1 } });
    // the script's own output goes to the engine log only, without the secret it printed
    const logged = run.lines.join("\n");
    expect(logged).toContain("pushing 3 schemas");
    expect(logged).not.toContain("abc123secretvalue");
    expect(out.line).not.toMatch(/pushing|token|exit/);
    // the clean worktree is gone and the clone's own working tree is as it was
    expect(git(p.api, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    expect(fs.existsSync(calls[0]!.root)).toBe(false);
    expect(fs.existsSync(path.join(p.api, "node_modules", "marker.txt"))).toBe(true);
    expect(git(p.api, "status", "--porcelain")).toBe(`?? ${SCHEMAS}/Draft.json`);
  });

  it("uses an existing product's convention: --dry-run previews, no flag applies", async () => {
    const p = product({ script: "existing" });
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    const out = await syncDataTables(fakeRun() as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "updated", tables: 1, fields: 0, line: updatedLine(1, 0) });
    expect(p.calls().map((c) => [c.mode, c.argv])).toEqual([["dry", ["--dry-run"]], ["apply", []]]);
  });

  it("runs in the one repo of a one-repo app", async () => {
    const p = product({ layout: "one" });
    const sha = commit(p.api, { [`${SCHEMAS}/Plan.json`]: { ...PLAN, fields: [...PLAN.fields, field("Currency")] } });
    const out = await syncDataTables(fakeRun() as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "updated", repos: ["app"], tables: 0, fields: 1 });
    expect(p.calls()).toHaveLength(2);
  });

  it("refuses a change of existing fields with a plain line, runs nothing, and keeps refusing until an engineer applied it", async () => {
    const cases: Files[] = [
      { [`${SCHEMAS}/Plan.json`]: null },
      { [`${SCHEMAS}/Employee.json`]: { ...EMPLOYEE, fields: EMPLOYEE.fields.filter((f) => f.name !== "StartDate") } },
      { [`${SCHEMAS}/Employee.json`]: { ...EMPLOYEE, fields: EMPLOYEE.fields.map((f) => (f.name === "Name" ? { ...f, name: "FullName" } : f)) } },
      { [`${SCHEMAS}/Plan.json`]: { ...PLAN, fields: PLAN.fields.map((f) => (f.name === "PriceMinor" ? { ...f, type: "String" } : f)) } },
    ];
    for (const change of cases) {
      const p = product();
      // a new table in the same build is not applied either
      const sha = commit(p.api, { ...change, [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
      const run = fakeRun();
      const out = await syncDataTables(run as never, p.app, { commits: [sha] });
      expect(out.status).toBe("refused");
      expect(out.line).toBe(REFUSED_LINE);
      expect(out.line).toBe("The new build changes existing data fields; an engineer must apply this by hand.");
      expect(p.calls()).toEqual([]);
      expect(readDataRecord(p.app).pending.api).toMatchObject({ reason: "refused", job: "job-data-1" });
      expect(run.lines.join("\n")).toContain("not additive");

      // a build that changes only code says nothing about it again, and the refusal stays pending
      const code = commit(p.api, { "src/routes.ts": "export const c = 1;\n" }, "fix(api): code only");
      expect(await syncDataTables(fakeRun() as never, p.app, { commits: [code] })).toMatchObject({ status: "none", line: "" });
      expect(readDataRecord(p.app).pending.api).toMatchObject({ reason: "refused", job: "job-data-1" });
      // the next build adds only a new table: the earlier change is still not on Blocks, so it is still refused
      const next = commit(p.api, { [`${SCHEMAS}/Leave.json`]: table("Leave", [field("UKey")]) });
      const again = await syncDataTables(fakeRun() as never, p.app, { commits: [next] });
      expect(again.status).toBe("refused");
      expect(p.calls()).toEqual([]);
    }
  });

  it("runs nothing when the lane's commits changed no schema file", async () => {
    const p = product();
    const sha = commit(p.api, { "src/routes.ts": "export const a = 2;\n", [`${SCHEMAS}/README.md`]: "# notes\n" });
    expect(await syncDataTables(fakeRun() as never, p.app, { commits: [sha] })).toEqual({ status: "none", line: "", repos: [], tables: 0, fields: 0 });
    expect(await syncDataTables(fakeRun() as never, p.app, { commits: [] })).toMatchObject({ status: "none" });
    expect(p.calls()).toEqual([]);
    expect(fs.existsSync(path.join(p.app.dir, "data-sync.json"))).toBe(false);
  });

  it("a failed dry run applies nothing, keeps the deploy, and the next build retries", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    fs.writeFileSync(`${p.log}.fail-dry`, "");
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "failed", line: FAILED_LINE });
    expect(out.line).not.toMatch(/exit \d|\/|BLOCKS_|token|simulated/);
    expect(p.calls().map((c) => c.mode)).toEqual(["dry"]);
    expect(readDataRecord(p.app).pending.api).toMatchObject({ reason: "failed" });
    expect(run.lines.join("\n")).toContain("simulated failure in dry");

    // the next build changed only code: the pending tables are applied now
    fs.rmSync(`${p.log}.fail-dry`);
    const next = commit(p.api, { "src/routes.ts": "export const b = 1;\n" }, "fix(api): code only");
    const again = await syncDataTables(fakeRun() as never, p.app, { commits: [next] });
    expect(again).toMatchObject({ status: "updated", tables: 1, fields: 0 });
    expect(p.calls().map((c) => c.mode)).toEqual(["dry", "dry", "apply"]);
    expect(readDataRecord(p.app).pending).toEqual({});
  });

  it("a failed apply is a plain failure too", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    fs.writeFileSync(`${p.log}.fail-apply`, "");
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "failed", line: FAILED_LINE });
    expect(p.calls().map((c) => c.mode)).toEqual(["dry", "apply"]);
    expect(readDataRecord(p.app).pending.api).toMatchObject({ reason: "failed" });
    // it stopped before its push: the new table is not on Blocks (the engine looked), so nothing is open
    expect(p.cli().some((c) => c.args.slice(0, 3).join(" ") === "data schema list")).toBe(true);
    expect(run.lines.some((l) => l.startsWith("SECURITY:"))).toBe(false);
    expect(readDataRecord(p.app).exposed).toBeUndefined();
  });

  it("asks an engineer when the repo has no script with a preview, and fails without installed packages", async () => {
    for (const script of ["none", "unknown"] as const) {
      const p = product({ script });
      const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
      const out = await syncDataTables(fakeRun() as never, p.app, { commits: [sha] });
      expect(out).toMatchObject({ status: "refused", line: NO_SCRIPT_LINE });
    }
    const p = product({ nodeModules: false });
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    const run = fakeRun();
    expect(await syncDataTables(run as never, p.app, { commits: [sha] })).toMatchObject({ status: "failed", line: FAILED_LINE });
    expect(p.calls()).toEqual([]);
    expect(run.lines.join("\n")).toContain("no node_modules");
  });
});

describe("new tables locked after the apply", () => {
  it("reads the tables the push created from the apply's output, wherever the JSON sits", () => {
    const push = JSON.stringify({ results: [{ isSuccess: true }], grantedPublicAccess: ["EmploymentCategory", "Leave"], gatewayReload: { isSuccess: true } }, null, 2);
    const sync = JSON.stringify({ results: [], newSchemaAccess: { level: "user", schemas: ["Contract"] } }, null, 2);
    const out = `pushing 3 schemas\n${push.slice(-600)}\n== data:schema:push ==\n${sync}\n{"createdTables":["Leave","Shift"]}\nError: Schema Leave was not found after push`;
    expect(createdTablesIn(out)).toEqual(["Contract", "EmploymentCategory", "Leave", "Shift"]);
    // the dry run's access setting, a clipped value and plain text are no tables
    expect(createdTablesIn('{ "dryRun": true, "newSchemaAccess": "user", "schemas": ["Employee"] }')).toEqual([]);
    expect(createdTablesIn('…ccess": [ "Leave" ] }')).toEqual([]);
    expect(createdTablesIn('"grantedPublicAccess": [\n    "Lea')).toEqual([]);
    expect(createdTablesIn('"grantedPublicAccess": ["We]ird", 3, ""]')).toEqual(["We]ird"]);
    expect(createdTablesIn("data sync done")).toEqual([]);
  });

  it("counts a table locked only with policies for all four operations", () => {
    const p = (schemaName: string, operation: unknown, key = "schemaName") => ({ [key]: schemaName, policyName: `P${String(operation)}`, operation });
    const rules = {
      policies: [
        ...[0, 1, 2, 3].map((op) => p("Employee", op)),
        p("Leave", 0),
        p("Leave", 1),
        ...["Read", "Write", "Edit", "Delete"].map((op) => p("Shift", op)),
        ...["0", "1", "2", "3"].map((op) => p("blx_Contracts", op, "entityName")),
        p("Plan", 4),
      ],
    };
    const tables = [{ schemaName: "Employee" }, { schemaName: "Leave" }, { schemaName: "Shift" }, { schemaName: "Contract", collectionName: "blx_Contracts" }, { schemaName: "Plan" }, { schemaName: "Missing" }];
    expect(unlockedTables(rules, tables)).toEqual(["Leave", "Plan", "Missing"]);
    expect(unlockedTables({}, [{ schemaName: "Employee" }])).toEqual(["Employee"]);
    expect(unlockedTables(rules, [{ schemaName: "employee" }])).toEqual([]);
  });

  it("checks on Blocks that every new table has its access rules after the apply, from the temp worktree", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toEqual({ status: "updated", line: updatedLine(1, 0), repos: ["api"], tables: 1, fields: 0 });
    const pulls = p.cli().filter((c) => c.args.slice(0, 3).join(" ") === "data rules pull");
    expect(pulls).toHaveLength(1);
    expect(pulls[0]!.cwd.startsWith(p.api)).toBe(false);
    expect(fs.existsSync(path.join(p.api, "blocks", "data", "rules.json"))).toBe(false);
    expect(run.lines.join("\n")).toContain("the new table(s) EmploymentCategory have their access rules on Blocks");
    expect(run.lines.some((l) => l.startsWith("SECURITY:"))).toBe(false);
    expect(readDataRecord(p.app).exposed).toBeUndefined();

    // new fields only: no new table, nothing to check
    const q = product();
    const fieldOnly = commit(q.api, { [`${SCHEMAS}/Employee.json`]: withCategory });
    expect(await syncDataTables(fakeRun() as never, q.app, { commits: [fieldOnly] })).toMatchObject({ status: "updated", tables: 0, fields: 1 });
    expect(q.cli()).toEqual([]);
  });

  it("an apply that stops after its push created a table runs once more, then says plainly that the table may be open", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    const full = git(p.api, "rev-parse", "HEAD");
    fs.writeFileSync(`${p.log}.fail-after-push`, "");
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(p.calls().map((c) => c.mode)).toEqual(["dry", "apply", "apply"]);
    expect(out).toMatchObject({ status: "exposed", tables: 0, fields: 0, repos: ["api"], exposed: ["EmploymentCategory"] });
    expect(out.line).toBe(`${EXPOSED_LINE} ${FAILED_LINE}`);
    expect(out.line).not.toMatch(/SECURITY|grantedPublicAccess|exit \d|token|Public|polic|EmploymentCategory/);
    const security = run.lines.filter((l) => l.startsWith("SECURITY:"));
    expect(security).toHaveLength(1);
    expect(security[0]).toContain("EmploymentCategory may be readable by anyone");
    expect(security[0]).toContain(full.slice(0, 9));
    expect(security[0]).not.toContain("abc123secretvalue");
    expect(run.lines.join("\n")).toContain("running it once more now");
    const record = readDataRecord(p.app);
    expect(record.exposed).toEqual([{ repo: "api", table: "EmploymentCategory", since: "2026-11-05T10:00:00.000Z", commit: full, job: "job-data-1" }]);
    expect(record.pending.api).toMatchObject({ reason: "failed" });
    expect(record.last).toMatchObject({ status: "exposed", exposed: ["EmploymentCategory"] });
    // the job's message says it first, in plain words, within its 200 characters
    const msg = withTexts("Milestone 2 Checkout and payment built by MADP: 12 of 12 tickets done, commit abc1234.", afterDeployNote(out), "Checkout is on dev.");
    expect(msg.startsWith(`Checkout is on dev. ${EXPOSED_LINE}`)).toBe(true);
    expect(msg.length).toBeLessThanOrEqual(200);

    // still open at the next build: the record keeps when it was first seen, and names the newest deployed commit
    const code = commit(p.api, { "src/routes.ts": "export const y = 1;\n" }, "fix(api): code only");
    const second = { ...fakeRun(), id: "job-data-2", iso: () => "2026-11-05T11:00:00.000Z" };
    expect(await syncDataTables(second as never, p.app, { commits: [code] })).toMatchObject({ status: "exposed" });
    expect(readDataRecord(p.app).exposed).toEqual([{ repo: "api", table: "EmploymentCategory", since: "2026-11-05T10:00:00.000Z", commit: git(p.api, "rev-parse", "HEAD"), job: "job-data-2" }]);

    // the cause fixed, the build after deploys the rules, and the record is clear again
    fs.rmSync(`${p.log}.fail-after-push`);
    const next = commit(p.api, { "src/routes.ts": "export const z = 1;\n" }, "fix(api): code only");
    expect(await syncDataTables(fakeRun() as never, p.app, { commits: [next] })).toMatchObject({ status: "updated", tables: 1 });
    expect(readDataRecord(p.app).pending).toEqual({});
    expect(readDataRecord(p.app).exposed).toBeUndefined();
  });

  it("a retry that goes through is a plain update, checked", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    fs.writeFileSync(`${p.log}.fail-after-push-once`, "");
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(p.calls().map((c) => c.mode)).toEqual(["dry", "apply", "apply"]);
    expect(out).toEqual({ status: "updated", line: updatedLine(1, 0), repos: ["api"], tables: 1, fields: 0 });
    expect(run.lines.some((l) => l.startsWith("SECURITY:"))).toBe(false);
    expect(readDataRecord(p.app)).toMatchObject({ pending: {} });
  });

  it("an apply that went through but left a new table without all four rules is a security note too", async () => {
    for (const knob of ["no-rules", "half-rules"]) {
      const p = product();
      const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY, [`${SCHEMAS}/Employee.json`]: withCategory });
      fs.writeFileSync(`${p.log}.${knob}`, "");
      const run = fakeRun();
      const out = await syncDataTables(run as never, p.app, { commits: [sha] });
      expect(p.calls().map((c) => c.mode)).toEqual(["dry", "apply"]); // it went through: no retry
      expect(out).toMatchObject({ status: "exposed", tables: 1, fields: 1, exposed: ["EmploymentCategory"] });
      expect(out.line).toBe(`${EXPOSED_LINE} ${updatedLine(1, 1)}`);
      expect(run.lines.filter((l) => l.startsWith("SECURITY:"))).toHaveLength(1);
      expect(readDataRecord(p.app)).toMatchObject({ pending: { api: { reason: "failed" } }, exposed: [{ repo: "api", table: "EmploymentCategory" }] });
    }
  });

  it("a check that cannot read the rules fails closed for the tables known to exist", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    p.setBlocks((s) => void (s.fail = { pull: true }));
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "exposed", exposed: ["EmploymentCategory"] });
    expect(p.cli().filter((c) => c.args.slice(0, 3).join(" ") === "data rules pull")).toHaveLength(2); // one retry
    expect(run.lines.join("\n")).toContain("could not read them");
  });

  it("the template's own script: every page of a big project's tables, the new table locked and confirmed", async () => {
    const p = product({ script: "real", tables: 120 }); // 122 tables on Blocks: two pages of the schema list
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out, run.lines.join("\n")).toMatchObject({ status: "updated", tables: 1, fields: 0 });
    const cat = p.blocks().schemas.find((s) => s.schemaName === "EmploymentCategory")!;
    expect(p.blocks().security[cat.id]).toEqual({ 0: 3, 1: 3, 2: 3, 3: 3 });
    expect(p.cli().some((c) => c.args.join(" ").startsWith("data schema list --page 2 --page-size 100"))).toBe(true);
    expect(run.lines.some((l) => l.startsWith("SECURITY:"))).toBe(false);
  });

  it("the incident: a product with the earlier template script, which read one page of the table list and stopped before the rules", async () => {
    const p = product({ script: "real", tables: 120 }); // 123 tables after the push: the earlier script saw 100
    // the earlier template's flow (scripts/data-sync.mjs before the fix): push, ONE page of `data schema list`, throw
    const earlier = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blocks, blocksJson, requireSession, root } from "./blocks-cli.mjs";
const apply = process.argv.includes("--yes");
requireSession();
const dir = join(root, "blocks", "data", "schemas");
const schemas = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
console.log(blocks(["data", "schema", "push", apply ? "--yes" : "--dry-run"]).slice(-600));
if (!apply) process.exit(0);
const listed = blocksJson(["data", "schema", "list"]);
const idByCollection = new Map((listed?.data?.items ?? listed?.items ?? []).map((s) => [s.collectionName, s.id]));
for (const s of schemas) if (!idByCollection.get(s.collectionName)) throw new Error(\`Schema \${s.schemaName} (\${s.collectionName}) not found after push\`);
console.log(blocks(["data", "sync", "--yes"]).slice(-600));
`;
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY, "scripts/data-sync.mjs": earlier });
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "exposed", exposed: ["EmploymentCategory"] });
    expect(out.line.startsWith(EXPOSED_LINE)).toBe(true);
    expect(p.cli().filter((c) => c.args.join(" ") === "data schema push --yes")).toHaveLength(2); // apply + retry
    expect(run.lines.filter((l) => l.startsWith("SECURITY:"))).toHaveLength(1);
    expect(readDataRecord(p.app).exposed).toMatchObject([{ repo: "api", table: "EmploymentCategory" }]);
  });

  it("the template's own script that cannot deploy the rules: one retry, then the plain security note", async () => {
    const p = product({ script: "real" });
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    p.setBlocks((s) => void (s.fail = { sync: true, rulesDeploy: true }));
    const run = fakeRun();
    const out = await syncDataTables(run as never, p.app, { commits: [sha] });
    expect(out).toMatchObject({ status: "exposed", exposed: ["EmploymentCategory"] });
    expect(p.cli().filter((c) => c.args.join(" ") === "data schema push --yes --json")).toHaveLength(2); // apply + retry
    const cat = p.blocks().schemas.find((s) => s.schemaName === "EmploymentCategory")!;
    expect(p.blocks().security[cat.id]).toEqual({ 0: 2, 1: 2, 2: 2, 3: 2 }); // really still Public: the note is true
    expect(run.lines.filter((l) => l.startsWith("SECURITY:"))).toHaveLength(1);
  });
});

describe("the job's message with the notes after a deploy", () => {
  it("joins the data tables' and the texts' lines", () => {
    const tables = { status: "updated", line: updatedLine(1, 2) };
    expect(withTexts("CR-3 released to dev as 1.2.0; commit abc1234.", afterDeployNote(tables, { status: "synced", line: SYNCED_LINE }), "CR-3 is on dev.")).toBe(
      `CR-3 released to dev as 1.2.0; commit abc1234. ${updatedLine(1, 2)} ${SYNCED_LINE}`,
    );
    expect(afterDeployNote(null, { status: "none", line: "" })).toEqual({ status: "none", line: "" });
    const msg = withTexts("Milestone 2 Checkout and payment built by MADP: 12 of 12 tickets done, commit abc1234.", afterDeployNote({ status: "failed", line: FAILED_LINE }), "Checkout is on dev.");
    expect(msg).toBe(`Checkout is on dev. ${FAILED_LINE}`);
    expect(msg.length).toBeLessThanOrEqual(200);
  });
});

describe("what stays open for the build's outcome (official/afterDeploy.ts)", () => {
  it("a refusal still waiting for an engineer is named on every later build, which says nothing new about it", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/Plan.json`]: null });
    expect(await syncDataTables(fakeRun() as never, p.app, { commits: [sha] })).toMatchObject({ status: "refused" });
    const code = commit(p.api, { "src/routes.ts": "export const c = 1;\n" }, "fix(api): code only");
    const later = await syncDataTables(fakeRun() as never, p.app, { commits: [code] });
    expect(later).toMatchObject({ status: "none", line: "", waiting: ["api"] });
    expect(afterDeployNote(later)).toEqual({ status: "none", line: "" });
  });

  it("a table the record still lists as possibly open is named until a sync confirms it locked", async () => {
    const p = product();
    const sha = commit(p.api, { [`${SCHEMAS}/EmploymentCategory.json`]: CATEGORY });
    fs.writeFileSync(`${p.log}.fail-after-push`, "");
    expect(await syncDataTables(fakeRun() as never, p.app, { commits: [sha] })).toMatchObject({ status: "exposed", openTables: ["EmploymentCategory"] });
    fs.rmSync(`${p.log}.fail-after-push`);
    const next = commit(p.api, { "src/routes.ts": "export const z = 1;\n" }, "fix(api): code only");
    const fixed = await syncDataTables(fakeRun() as never, p.app, { commits: [next] });
    expect(fixed).toMatchObject({ status: "updated" });
    expect(fixed.openTables).toBeUndefined();
    expect(fixed.waiting).toBeUndefined();
  });
});

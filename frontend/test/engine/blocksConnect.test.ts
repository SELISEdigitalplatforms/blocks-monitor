// Blocks sign-in per product: every product environment has its own Blocks login store (never the engine's default
// one), registries old and new name it, and "Connect to Blocks" shows the device login's link and code on the job,
// continues once it is approved and fails plainly when the code expires. A fake CLI (fakeBlocksCli.ts) plays Blocks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectBlocks, ensureBlocksSession, storeOf, withProductStores, type BlocksTarget } from "../../server/local/engine/official/blocksLogin.ts";
import { defaultBlocksStore, productStore, productStoreRoot } from "../../server/local/engine/official/home.ts";
import { hostRegistry, parseRegistry } from "../../server/local/engine/official/hostRegistry.ts";
import { JobFailure, type JobRun } from "../../server/local/engine/run.ts";
import { CONNECT_EXPIRY_MINUTES, connectLine, connectOf } from "../../src/domain/blocksConnect.ts";
import { JOB_MESSAGE_MAX, plainJobMessage, technicalSignal } from "../../src/domain/jobMessage.ts";
import { FAKE_CODES, FAKE_TOKENS, cliCalls, signedIn, writeFakeBlocksCli } from "./fakeBlocksCli.ts";

const DEV = `D${"0123456789abcdef".repeat(2)}`;
const STG = `S${"0123456789abcdef".repeat(2)}`;

let tmp = "";
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-blocks-connect-"));
  setEnv("MF_BLOCKS_PRODUCT_STORES", path.join(tmp, "stores"));
  setEnv("MF_BLOCKS_RELEASE_ACCOUNT", undefined);
  setEnv("FAKE_CLI_LOG", path.join(tmp, "cli.log"));
  setEnv("FAKE_CLI_MODE", "approve");
  setEnv("BLOCKS_CONFIG_DIR", undefined);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** The JobRun parts the sign-in uses; `lines` are the job's lines people read, `logs` the engine log. */
function fakeRun() {
  const lines: Array<[number, string]> = [];
  const logs: string[] = [];
  const ctl = new AbortController();
  const run = {
    id: "job-1",
    projectId: "proj-1",
    p: { name: "PrimaBook", project: {} },
    signal: ctl.signal,
    heartbeat: async () => undefined,
    log: (l: string) => void logs.push(l),
    check: () => {
      if (ctl.signal.aborted) throw new Error("stopped");
    },
    step: async (p: number, l: string) => void lines.push([p, l]),
  } as unknown as JobRun;
  return { run, lines, logs, ctl, step: (p: number, l: string) => run.step(p, l) };
}

function target(o: Partial<BlocksTarget> = {}): BlocksTarget {
  const cli = writeFakeBlocksCli(path.join(tmp, "cli"));
  return { product: "PrimaBook", name: "primabook-1a2b3c", env: "dev", tenant: DEV, store: productStore("primabook-1a2b3c", "dev"), account: "default", cliRunJs: cli.runJs, ...o };
}

describe("the connect line on the job", () => {
  it("carries the link and the code as a plain job line, and the page reads them back", () => {
    expect(connectLine({ product: "Shop", url: "https://iam.example.test/d", code: "WDJB-MJHT" })).toBe(
      `Connect Shop to Blocks: open https://iam.example.test/d, sign in with the Blocks account that may deploy this product and confirm code WDJB-MJHT. It expires in about ${CONNECT_EXPIRY_MINUTES} minutes.`,
    );
    // a longer line keeps the address with the code in it; the expiry sentence is on the page's card
    const line = connectLine({ product: "PrimaBook", url: "https://iam.example.test/device?user_code=WDJB-MJHT", code: "WDJB-MJHT" });
    expect(line).toBe(
      "Connect PrimaBook to Blocks: open https://iam.example.test/device?user_code=WDJB-MJHT, sign in with the Blocks account that may deploy this product and confirm code WDJB-MJHT.",
    );
    expect(line.length).toBeLessThanOrEqual(JOB_MESSAGE_MAX);
    expect(technicalSignal(line)).toBeNull();
    // the engine's safety net keeps it as it is, while the job runs
    expect(plainJobMessage("build.run", "running", line)).toBe(line);
    expect(connectOf(line)).toEqual({ product: "PrimaBook", url: "https://iam.example.test/device?user_code=WDJB-MJHT", code: "WDJB-MJHT" });
    expect(connectOf("Building the milestone: planning the work.")).toBeNull();
    expect(connectOf(null)).toBeNull();
  });

  it("stays within a job line for long names and addresses", () => {
    const long = connectLine({ product: "A product with a really very long name that goes on and on", url: `https://iam.example.test/device?user_code=WDJB-MJHT&client=${"x".repeat(30)}`, code: "WDJB-MJHT" });
    expect(long.length).toBeLessThanOrEqual(JOB_MESSAGE_MAX);
    expect(technicalSignal(long)).toBeNull();
    expect(connectOf(long)).toMatchObject({ url: "https://iam.example.test/device", code: "WDJB-MJHT" });
  });
});

describe("a Blocks login store for every product environment", () => {
  const NEW_APP = [
    "# MADP project registry — generated by `madp new-app shop` (selise-blocks-app); edit freely.",
    "project: shop-1a2b3c",
    "environments:",
    "  dev:",
    "    branch: dev",
    `    tenant_id: ${DEV}`,
    "cli:",
    "  run_js: /srv/engine/products/shop/node_modules/@seliseblocks/cli-os/bin/run.js",
    "repos:",
    "  app:",
    "    path: /srv/engine/products/shop",
    "    repo: example-org/shop",
    "    verify:",
    "    - name: t",
    "      argv: [node, -v]",
    "",
  ].join("\n");

  it("lives in its own folder per product and environment, never the engine's default store", () => {
    const root = productStoreRoot();
    expect(root).toBe(path.join(tmp, "stores"));
    const a = productStore("shop-1a2b3c", "dev");
    const b = productStore("shop-1a2b3c", "stg");
    const c = productStore("books-4d5e6f", "dev");
    expect(new Set([a, b, c, defaultBlocksStore()]).size).toBe(4);
    expect(a).toBe(path.join(tmp, "stores", "shop-1a2b3c-dev"));
    setEnv("MF_BLOCKS_PRODUCT_STORES", undefined);
    expect(productStoreRoot("/srv/engine-home")).toBe(path.join("/srv/engine-home", ".config", "seliseblocks-products"));
    expect(productStoreRoot("/srv/engine-home")).not.toBe(defaultBlocksStore("/srv/engine-home"));
  });

  it("is added to a registry new-app wrote (and to older ones on their next use), once", () => {
    const fixed = withProductStores(NEW_APP, "shop-1a2b3c")!;
    const data = parseRegistry(fixed);
    expect((data.environments as Record<string, Record<string, unknown>>).dev).toEqual({ branch: "dev", tenant_id: DEV, cli_config_dir: productStore("shop-1a2b3c", "dev") });
    // everything else as it was
    const { environments: _a, ...rest } = data;
    const { environments: _b, ...before } = parseRegistry(NEW_APP);
    expect(rest).toEqual(before);
    expect(fixed).toContain("# MADP project registry");
    expect(withProductStores(fixed, "shop-1a2b3c")).toBe(fixed);
    expect(storeOf(data, "shop-1a2b3c", "dev")).toBe(productStore("shop-1a2b3c", "dev"));
    expect(withProductStores("project: x\n", "x")).toBeNull();
  });

  it("keeps a store given on purpose and replaces the engine's default store", () => {
    const own = NEW_APP.replace(`    tenant_id: ${DEV}\n`, `    tenant_id: ${DEV}\n    cli_config_dir: /srv/stores/shop-dev\n`);
    expect(withProductStores(own, "shop-1a2b3c")).toBe(own);
    const shared = NEW_APP.replace(`    tenant_id: ${DEV}\n`, `    tenant_id: ${DEV}\n    cli_config_dir: ${defaultBlocksStore()}\n`);
    const fixed = parseRegistry(withProductStores(shared, "shop-1a2b3c")!);
    expect(storeOf(fixed, "shop-1a2b3c", "dev")).toBe(productStore("shop-1a2b3c", "dev"));
  });

  it("is named in an attached product's engine-host registry for each environment", () => {
    const source = [
      "project: ledgerly",
      "environments:",
      "  dev: {branch: dev}",
      `  stg: {branch: stg, tenant_id: ${STG}, promote_from: dev, cli_config_dir: /opt/operator/stage/.blocks-cli}`,
      "git: {author_name: Example Person, author_email: person@example.com}",
      "cli: {run_js: /opt/operator/code/ledgerly/node_modules/@seliseblocks/cli-os/bin/run.js, cwd: /opt/operator/code/ledgerly, env: {BLOCKS_CONFIG_DIR: /opt/operator/.blocks}}",
      "repos:",
      "  app: {path: /opt/operator/code/ledgerly, repo: example-org/ledgerly, branch: dev, verify: [{name: t, argv: [node, -v]}]}",
      "",
    ].join("\n");
    const stores = path.join(tmp, "home", ".config", "seliseblocks-products");
    const h = hostRegistry(source, { dir: path.join(tmp, "p", "madp"), devTenant: DEV, engineHome: path.join(tmp, "engine"), withStage: true, blocksStores: stores });
    const envs = h.data.environments as Record<string, Record<string, unknown>>;
    expect(envs.dev!.cli_config_dir).toBe(path.join(stores, "ledgerly-dev"));
    expect(envs.stg!.cli_config_dir).toBe(path.join(stores, "ledgerly-stg"));
    expect(JSON.stringify(h.data)).not.toContain("/opt/operator");
    expect((h.data.cli as Record<string, Record<string, unknown>>).env!.BLOCKS_CONFIG_DIR).toBeUndefined();
    // an explicit store for STAGE still wins
    const given = hostRegistry(source, { dir: path.join(tmp, "p", "madp"), devTenant: DEV, engineHome: path.join(tmp, "engine"), withStage: true, blocksStores: stores, envPaths: { stg: { cliConfigDir: "/srv/stage-store" } } });
    expect((given.data.environments as Record<string, Record<string, unknown>>).stg!.cli_config_dir).toBe("/srv/stage-store");
  });
});

describe("Connect to Blocks", () => {
  it("does nothing more when the store has a usable session for the tenant", async () => {
    const t = target();
    signedIn(t.store, DEV);
    const r = fakeRun();
    expect(await connectBlocks(r.run, t, { step: r.step, pct: 4 })).toBe(false);
    expect(cliCalls(process.env.FAKE_CLI_LOG!)).toEqual([[t.store, `auth status --json --account default --project ${DEV}`]]);
    expect(r.lines).toEqual([]);
  });

  it("shows an http device link (CLI 0.11) as its https form", async () => {
    process.env.FAKE_LOGIN_HTTP = "1";
    try {
      const t = target({ account: "release" });
      const r = fakeRun();
      expect(await connectBlocks(r.run, t, { step: r.step, pct: 4 })).toBe(true);
      const first = connectOf(r.lines.map(([, l]) => l)[0]);
      expect(first?.url.startsWith("https://iam.example.test/device?user_code=")).toBe(true);
    } finally {
      delete process.env.FAKE_LOGIN_HTTP;
    }
  });

  it("shows the link and the code, waits for the approval, selects the tenant in the product's store and goes on", async () => {
    const t = target({ account: "release" });
    const r = fakeRun();
    expect(await connectBlocks(r.run, t, { step: r.step, pct: 4 })).toBe(true);
    const shown = r.lines.map(([, l]) => l);
    expect(connectOf(shown[0])).toEqual({ product: "PrimaBook", url: `https://iam.example.test/device?user_code=${FAKE_CODES[0]}`, code: FAKE_CODES[0] });
    expect(shown[1]).toBe("PrimaBook is signed in to Blocks. Selecting its Blocks project.");
    expect(r.lines.every(([p]) => p === 4)).toBe(true);
    const calls = cliCalls(process.env.FAKE_CLI_LOG!);
    expect(calls.map(([, a]) => a)).toEqual([
      `auth status --json --account release --project ${DEV}`,
      "login --account release",
      `release repos list --project ${DEV} --account release --json`,
      `use ${DEV} --account release`,
      `auth status --json --account release --project ${DEV}`,
    ]);
    // every call ran in the product's own store, never the engine's default one
    expect(new Set(calls.map(([s]) => s))).toEqual(new Set([t.store]));
    expect(t.store).not.toBe(defaultBlocksStore());
    expect(fs.statSync(t.store).mode & 0o777).toBe(0o700);
    // the engine's own environment is untouched: the provisioning scan keeps the default store
    expect(process.env.BLOCKS_CONFIG_DIR).toBeUndefined();
    // no secrets anywhere people or the log read; the log names neither the link nor the code
    const all = [...shown, ...r.logs].join("\n");
    for (const tok of FAKE_TOKENS) expect(all).not.toContain(tok);
    expect(r.logs.join("\n")).not.toContain(FAKE_CODES[0]);
    expect(r.logs.join("\n")).not.toContain("iam.example.test");
    // the next job finds the session
    expect(await connectBlocks(fakeRun().run, t, { step: async () => undefined, pct: 4 })).toBe(false);
  });

  it("fails in plain words when the code expires, and a new start shows a new code", async () => {
    setEnv("FAKE_CLI_MODE", "expire");
    const t = target();
    const r = fakeRun();
    const err = await connectBlocks(r.run, t, { step: r.step, pct: 4 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect(err).toMatchObject({ code: "blocks.connect_expired" });
    const message = (err as Error).message;
    expect(message).toBe("The Blocks sign-in for PrimaBook was not confirmed within about 10 minutes, so its code expired. Start it again to get a new code.");
    expect(technicalSignal(message)).toBeNull();
    expect(connectOf(r.lines[0]![1])?.code).toBe(FAKE_CODES[0]);

    setEnv("FAKE_CLI_MODE", "approve");
    const again = fakeRun();
    expect(await connectBlocks(again.run, t, { step: again.step, pct: 4 })).toBe(true);
    expect(connectOf(again.lines[0]![1])?.code).toBe(FAKE_CODES[1]);
  });

  it("gives up when nobody approves in time, and when the account cannot reach the tenant", async () => {
    setEnv("FAKE_CLI_DELAY_MS", "60000");
    const slow = fakeRun();
    await expect(connectBlocks(slow.run, target(), { step: slow.step, pct: 4, waitMs: 800 })).rejects.toMatchObject({ code: "blocks.connect_expired" });
    setEnv("FAKE_CLI_DELAY_MS", undefined);
    setEnv("FAKE_CLI_MODE", "noaccess");
    const r = fakeRun();
    const t = target({ name: "other-9f8e7d", store: productStore("other-9f8e7d", "dev") });
    const err = await connectBlocks(r.run, t, { step: r.step, pct: 4 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "blocks.connect_no_access" });
    // the product's name is never made possessive ("Team lunch orders's")
    expect((err as Error).message).toBe(
      "The Blocks account that signed in cannot reach the Blocks project of PrimaBook. Start it again and sign in with the Blocks account that may deploy this product.",
    );
    expect(technicalSignal((err as Error).message)).toBeNull();

    const retry = fakeRun();
    await expect(connectBlocks(retry.run, t, { step: retry.step, pct: 4 })).rejects.toMatchObject({ code: "blocks.connect_no_access" });
    expect(connectOf(retry.lines[0]![1])?.code).toBe(FAKE_CODES[1]);

    setEnv("FAKE_CLI_MODE", "approve");
    const recovered = fakeRun();
    expect(await connectBlocks(recovered.run, t, { step: recovered.step, pct: 4 })).toBe(false);
    expect(recovered.lines).toEqual([]);
  });

  it("never signs a product in to the engine's default store", async () => {
    const r = fakeRun();
    await expect(connectBlocks(r.run, target({ store: defaultBlocksStore() }), { step: r.step, pct: 4 })).rejects.toMatchObject({ code: "blocks.store_shared" });
    expect(cliCalls(process.env.FAKE_CLI_LOG!)).toEqual([]);
  });

  it("keeps two products' sessions apart: signing one in never touches the other's store", async () => {
    const a = target();
    const b = target({ product: "Shop", name: "shop-4d5e6f", store: productStore("shop-4d5e6f", "dev"), tenant: `D${"f".repeat(32)}` });
    signedIn(b.store, b.tenant);
    const before = fs.readFileSync(path.join(b.store, "fake-state.json"), "utf8");
    expect(await connectBlocks(fakeRun().run, a, { step: async () => undefined, pct: 4 })).toBe(true);
    expect(fs.readFileSync(path.join(b.store, "fake-state.json"), "utf8")).toBe(before);
    expect(cliCalls(process.env.FAKE_CLI_LOG!).every(([s]) => s === a.store)).toBe(true);
    expect(await connectBlocks(fakeRun().run, b, { step: async () => undefined, pct: 4 })).toBe(false);
  });

  it("reads the store, tenant, account and CLI from the registry", async () => {
    const cli = writeFakeBlocksCli(path.join(tmp, "cli"));
    const store = path.join(tmp, "explicit-stg");
    signedIn(store, STG);
    const data = { environments: { stg: { branch: "stg", tenant_id: STG, cli_config_dir: store } }, cli: { run_js: cli.runJs, env: { MF_BLOCKS_RELEASE_ACCOUNT: "stage-release" } } };
    expect(await ensureBlocksSession(fakeRun().run, { product: "PrimaBook", name: "primabook-1a2b3c", env: "stg", data }, { step: async () => undefined, pct: 30 })).toBe(false);
    expect(cliCalls(process.env.FAKE_CLI_LOG!)).toEqual([[store, `auth status --json --account stage-release --project ${STG}`]]);
    await expect(ensureBlocksSession(fakeRun().run, { product: "PrimaBook", name: "primabook-1a2b3c", env: "prod", data }, { step: async () => undefined, pct: 30 })).rejects.toMatchObject({ code: "blocks.tenant_missing" });
  });
});

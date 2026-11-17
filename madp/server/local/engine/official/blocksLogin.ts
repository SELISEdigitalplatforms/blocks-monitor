// Blocks sign-in per product. A Blocks CLI login store (BLOCKS_CONFIG_DIR) keeps ONE impersonated project session at a
// time, and any CLI call that impersonates another project in the same store evicts the one before. So every product
// environment has its own store on the engine host (home.ts productStore: <root>/<registry name>-<env>, mode 700),
// named in the product's registry as environments.<env>.cli_config_dir (the official lanes then run the CLI with it:
// deploy_ops.cli_env). The engine's default store stays the Factory's own (the provisioning scan, the Factory app).
//
// "Connect to Blocks": when a set-up step or a lane needs a product environment's session and its store has none for
// the environment's tenant (the CLI's own `auth status --json --account <acct> --project <tenant>`: token states only),
// the engine starts the CLI's device login in that store, shows its link and code on the job (the product's build,
// change and release pages show it as a card: src/domain/blocksConnect.ts), waits while it heartbeats, and right
// after the approval selects the tenant in that store (`release repos list --project <tenant>`, then `use <tenant>`).
// A code that expires fails the job in plain words; starting it again gives a new code. No token is ever read, logged or
// shown: the CLI prints token states, the link and the code only, and the engine log names neither the link nor the code.
//
// A product store is never seeded with a copy of another store's sign-in (e.g. the provisioning account's): Blocks IAM
// keeps ONE refresh-token lineage per sign-in and rotates it on every refresh, `use` (impersonation) and stop, so two
// stores holding one lineage cannot both stay valid. The store left with the superseded token presents it on its next
// refresh; after the IAM's grace window (5 minutes by default) that counts as token reuse and the IAM revokes the whole
// lineage, which signs out both stores, the engine's provisioning sign-in included (blocks-iam RefreshSessionResolver).
//
// Only members of a Blocks project can hold its session. Right before a device login the engine makes the people of
// MF_BLOCKS_PROJECT_MEMBERS members of the environment's project, as the provisioning account that created it
// (server/blocks/provisioningMembers.ts; best effort: off when unset, and a failure is logged and the card follows).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONNECT_EXPIRY_MINUTES, connectLine, connectShowable } from "../../../../src/domain/blocksConnect";
import { addProjectMembersFromEnv } from "../../../blocks/provisioningMembers.ts";
import { JobFailure, type JobRun } from "../run.ts";
import { tenantPattern } from "./hostRegistry.ts";
import { defaultBlocksStore, productStore, productStoreRoot } from "./home.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const USABLE = new Set(["valid", "available"]);
const TOKEN_STATES = ["accountAccessToken", "accountRefreshToken", "projectAccessToken", "projectRefreshToken"] as const;

// ------------------------------------------------------------------ the stores in a registry (pure)

const same = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);

/** The registry with every environment's own Blocks login store: an environment without `cli_config_dir`, or one that
 *  names the engine's default store, gets <root>/<name>-<env>; a store given on purpose (another folder) stays. Answers
 *  the YAML unchanged when nothing is missing, null when it has no `environments` mapping (pure). */
export function withProductStores(yml: string, name: string, o: { root?: string; defaultStore?: string } = {}): string | null {
  const doc = YAML.parseDocument(yml, { version: "1.1" });
  const envs = doc.get("environments", true);
  if (!YAML.isMap(envs)) return null;
  const root = o.root ?? productStoreRoot();
  const fallback = o.defaultStore ?? defaultBlocksStore();
  let changed = false;
  for (const item of envs.items) {
    const env = YAML.isScalar(item.key) ? String(item.key.value) : "";
    if (!env || !YAML.isMap(item.value)) continue;
    const now = text(item.value.get("cli_config_dir"));
    if (now && !same(now, fallback)) continue;
    item.value.set("cli_config_dir", productStore(name, env, root));
    changed = true;
  }
  return changed ? doc.toString({ lineWidth: 0 }) : yml;
}

/** The Blocks login store of a registry's environment: its cli_config_dir, else the product's own (pure). */
export function storeOf(data: Row, name: string, env: string, root = productStoreRoot()): string {
  return text(rec(rec(data.environments)[env]).cli_config_dir) || productStore(name, env, root);
}

/** The environment's Blocks tenant in a registry ("" when it names none). */
export const tenantOf = (data: Row, env: string): string => text(rec(rec(data.environments)[env]).tenant_id);

/** The Blocks CLI account the lanes use (deploy_ops.cli_argv): the registry's cli.env, else the engine's
 *  MF_BLOCKS_RELEASE_ACCOUNT, else "default". */
export function releaseAccount(data: Row = {}): string {
  const account = text(rec(rec(data.cli).env).MF_BLOCKS_RELEASE_ACCOUNT) || String(process.env.MF_BLOCKS_RELEASE_ACCOUNT ?? "").trim() || "default";
  if (!ACCOUNT_RE.test(account)) throw new JobFailure("The engine's Blocks account setting is not valid. Ask the engine team to correct it, then start it again.", "blocks.account");
  return account;
}

/** The registry file with every environment's own store (written only when something was missing). */
export function ensureRegistryStores(file: string, name: string): void {
  const yml = fs.readFileSync(file, "utf8");
  const fixed = withProductStores(yml, name);
  if (fixed === null) throw new JobFailure("The product's MADP registry has no environments the engine can complete. Ask the engine team to add them, then start it again.", "madp.registry");
  if (fixed !== yml) {
    fs.writeFileSync(`${file}.tmp`, fixed);
    fs.renameSync(`${file}.tmp`, file);
  }
}

// ------------------------------------------------------------------ the CLI in a product's store

export interface BlocksTarget {
  /** The product's name as people know it (the card's title). */
  product: string;
  /** The registry name (the store's folder and the engine log). */
  name: string;
  env: string;
  tenant: string;
  /** The environment's login store (BLOCKS_CONFIG_DIR). */
  store: string;
  account: string;
  /** The official CLI the lanes run (the registry's cli.run_js); else `blocks` on PATH. */
  cliRunJs?: string;
}

/** How long the device login may wait for its approval before the job gives up (a little longer than the CLI's own). */
const LOGIN_WAIT_MS = (CONNECT_EXPIRY_MINUTES + 2) * 60_000;

function cliCommand(runJs?: string): [string, string[]] {
  return runJs && fs.existsSync(runJs) ? [process.execPath, [runJs]] : ["blocks", []];
}

/** The CLI's environment in a product's store. Built per call: the engine's own environment never changes, so the
 *  provisioning scan and every other engine-level CLI call keep the default store. */
export function storeEnv(store: string): NodeJS.ProcessEnv {
  return { ...process.env, BLOCKS_CONFIG_DIR: store, BLOCKS_STRICT_FLAGS: "1", BLOCKS_NO_UPDATE_CHECK: "1", BROWSER: "true", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" };
}

/** The store folder, made when missing and kept private to the engine user (mode 700). Never the default store. */
export function ensureStore(store: string): void {
  if (same(store, defaultBlocksStore())) throw new JobFailure("A product may not use the engine's own Blocks sign-in. Ask the engine team to give it a sign-in of its own, then start it again.", "blocks.store_shared");
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  fs.chmodSync(store, 0o700);
}

/** One CLI call in the store. The output never leaves this file except as token states. */
function runCli(t: BlocksTarget, args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string }> {
  const [bin, pre] = cliCommand(t.cliRunJs);
  return new Promise((resolve) => {
    execFile(bin, [...pre, ...args], { cwd: t.store, env: storeEnv(t.store), timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    }).stdin?.end();
  });
}

/** The token states of the environment's session in its store (the CLI prints states, never tokens). */
export async function sessionStates(t: BlocksTarget): Promise<{ usable: boolean; project: boolean; states: Record<string, string> }> {
  const r = await runCli(t, ["auth", "status", "--json", "--account", t.account, "--project", t.tenant], 60_000);
  let doc: Row = {};
  try {
    const s = r.stdout;
    const start = s.indexOf("{");
    doc = start >= 0 ? rec(JSON.parse(s.slice(start, s.lastIndexOf("}") + 1))) : {};
  } catch {
    doc = {};
  }
  const states = Object.fromEntries(TOKEN_STATES.map((k) => [k, typeof doc[k] === "string" ? String(doc[k]) : "missing"]));
  const ok = (keys: readonly string[]) => r.code === 0 && keys.some((k) => USABLE.has(states[k]!));
  return { usable: ok(TOKEN_STATES), project: ok(["projectAccessToken", "projectRefreshToken"]), states };
}

/** The device login in the store: the link and code go to `show`; answers once the CLI says "Login done." and has
 *  ended. Fails in plain words when it cannot start or the code expires. */
async function deviceLogin(run: JobRun, t: BlocksTarget, show: (url: string, code: string) => Promise<void>, waitMs: number): Promise<void> {
  const [bin, pre] = cliCommand(t.cliRunJs);
  const child = spawn(bin, [...pre, "login", "--account", t.account], {
    cwd: t.store,
    env: storeEnv(t.store),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let url = "";
  let code = "";
  let shown = false;
  let done = false;
  let showing = Promise.resolve();
  let showFailed: unknown = null;
  const carry = { out: "", err: "" };
  const read = (which: "out" | "err") => (d: Buffer) => {
    const lines = (carry[which] + d.toString("utf8")).split(/\r?\n/);
    carry[which] = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
      // CLI 0.11 prints the device link as http://iam.seliseblocks.com/…; the sign-in page also answers on https, which is
      // the only kind the card may show (connectShowable), so an http link is shown as its https form
      const u = /^URL:\s*(https?:\/\/\S+)$/.exec(line);
      const c = /^Code:\s*(\S+)$/.exec(line);
      if (u && !url) url = u[1]!.replace(/^http:\/\//, "https://");
      if (c && !code) code = c[1]!;
      if (/^Login done\.?$/.test(line)) done = true;
      if (url && code && !shown) {
        shown = true;
        showing = showing.then(() => show(url, code)).catch((e: unknown) => {
          showFailed = e;
          stop();
        });
      }
    }
  };
  child.stdout.on("data", read("out"));
  child.stderr.on("data", read("err"));
  const kill = (sig: NodeJS.Signals) => {
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* gone */
    }
  };
  const stop = () => {
    kill("SIGTERM");
    setTimeout(() => kill("SIGKILL"), 5_000).unref();
  };
  run.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, waitMs);
  const beat = setInterval(() => void run.heartbeat().catch(() => undefined), 20_000);
  const exit: number = await new Promise((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (c) => resolve(c ?? 1));
  });
  clearTimeout(timer);
  clearInterval(beat);
  run.signal.removeEventListener("abort", stop);
  await showing;
  run.check();
  if (showFailed) throw showFailed;
  if (done) return;
  run.log(`blocks sign-in ${t.name}-${t.env}: ${url && code ? "not approved in time" : "the device login did not start"} (exit ${exit})`);
  if (!url || !code) throw new JobFailure(`The Blocks sign-in for ${t.product} could not be started on the engine host. Start it again in a few minutes; if it fails again, ask the engine team to look into it.`, "blocks.connect_unavailable");
  throw new JobFailure(
    `The Blocks sign-in for ${t.product} was not confirmed within about ${CONNECT_EXPIRY_MINUTES} minutes, so its code expired. Start it again to get a new code.`,
    "blocks.connect_expired",
  );
}

/** One sign-in per store at a time: a second job of the same product waits for the first one's sign-in. */
const busy = new Map<string, Promise<unknown>>();

export interface ConnectOptions {
  /** Reports the line people read (the job's step). */
  step: (pct: number, line: string) => Promise<void>;
  /** The progress the line is shown at (never below the job's progress so far). */
  pct: number;
  /** How long the login waits for its approval (tests). */
  waitMs?: number;
  /** Makes the configured people members of the tenant's project before a device login (tests replace it). */
  addMembers?: (o: { tenant: string; label: string; log: (line: string) => void }) => Promise<unknown>;
}

/** The job's progress so far, after the pending reports are written (a lower one would hide the line). */
async function progressNow(run: JobRun): Promise<number> {
  try {
    if (typeof run.flush === "function") await run.flush();
    const p = Number(rec(run.job).Progress);
    return Number.isFinite(p) ? Math.max(0, Math.min(99, p)) : 0;
  } catch {
    return 0;
  }
}

/** The environment's Blocks session in its own store: answers false when it was usable already, true when people
 *  connected it now. Fails in plain words when the sign-in expires or the account cannot reach the tenant. */
export async function connectBlocks(run: JobRun, t: BlocksTarget, o: ConnectOptions): Promise<boolean> {
  if (!tenantPattern(t.env).test(t.tenant)) throw new JobFailure(`The product's ${t.env} environment has no Blocks project in its MADP registry yet. Ask the engine team to add it, then start it again.`, "blocks.tenant_missing");
  ensureStore(t.store);
  const before = busy.get(t.store);
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = (before ?? Promise.resolve()).then(() => mine);
  busy.set(t.store, chain);
  try {
    if (before) {
      await o.step(Math.max(o.pct, await progressNow(run)), `Waiting for the Blocks sign-in of ${t.product} that another job started.`);
      await before.catch(() => undefined);
    }
    if ((await sessionStates(t)).usable) return false;
    // the configured people become members of the project first, so whoever of them approves can reach its tenant
    await (o.addMembers ?? addProjectMembersFromEnv)({ tenant: t.tenant, label: `${t.name}-${t.env}`, log: (line) => run.log(line) }).catch(() => undefined);
    run.check();
    const pct = Math.max(o.pct, await progressNow(run));
    await deviceLogin(run, t, async (url, code) => {
      const shownUrl = connectShowable(url, code) ? url : url.replace(/[?#].*$/, "");
      if (!connectShowable(shownUrl, code)) throw new JobFailure(`The Blocks sign-in for ${t.product} gave a link the page cannot show. Start it again; if it happens again, ask the engine team to look into it.`, "blocks.connect_unavailable");
      run.log(`blocks sign-in ${t.name}-${t.env}: waiting for a person to approve it on the product's page`);
      await o.step(pct, connectLine({ product: t.product, url: shownUrl, code }));
    }, o.waitMs ?? LOGIN_WAIT_MS);
    await o.step(pct, `${t.product} is signed in to Blocks. Selecting its Blocks project.`);
    // the approval leaves account tokens: they start the tenant's own session in this store and select it
    await runCli(t, ["release", "repos", "list", "--project", t.tenant, "--account", t.account, "--json"]);
    await runCli(t, ["use", t.tenant, "--account", t.account]);
    // the tenant's own session must be there now (account tokens alone would mean the account cannot reach it)
    if (!(await sessionStates(t)).project) {
      run.log(`blocks sign-in ${t.name}-${t.env}: approved, but no session for the environment's tenant`);
      throw new JobFailure(
        `The Blocks account that signed in cannot reach the Blocks project of ${t.product}. Start it again and sign in with the Blocks account that may deploy this product.`,
        "blocks.connect_no_access",
      );
    }
    run.log(`blocks sign-in ${t.name}-${t.env}: connected`);
    return true;
  } finally {
    release();
    if (busy.get(t.store) === chain) busy.delete(t.store);
  }
}

/** A registry environment's session (the store and tenant it names), connected when needed. */
export async function ensureBlocksSession(
  run: JobRun,
  o: { product: string; name: string; env: string; data: Row; tenant?: string; cliRunJs?: string },
  c: ConnectOptions,
): Promise<boolean> {
  const t: BlocksTarget = {
    product: o.product,
    name: o.name,
    env: o.env,
    tenant: o.tenant ?? tenantOf(o.data, o.env),
    store: storeOf(o.data, o.name, o.env),
    account: releaseAccount(o.data),
    cliRunJs: o.cliRunJs ?? text(rec(o.data.cli).run_js),
  };
  return connectBlocks(run, t, c);
}

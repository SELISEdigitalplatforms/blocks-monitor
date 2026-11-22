import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirsOf } from "../local/engine/build/jobKit.ts";
import { JobFailure, type JobRun } from "../local/engine/run.ts";
import { runSharedBlocksCommand, sharedBlocksSession } from "./sharedCliSession.ts";

const client = fileURLToPath(new URL("./sharedCliClient.cjs", import.meta.url));
export const SHARED_BLOCKS_QUEUE_GRACE_MS = 45 * 60_000;
const flagSets: Record<string, string> = {
  "auth status": "",
  "auth oidc-clients list": "",
  "auth oidc-clients get": "",
  "auth oidc-clients save": "item-id client-display-name client-type redirect-uris require-pkce register-as-identity-provider auto-redirect active scope use-tokens-cookie",
  "auth config get": "",
  "auth config save": "oidc-enabled",
  "projects get": "",
  "release repos list": "",
  "release setup": "repo wait timeout poll-interval register-callback",
  "release deploy": "repo wait timeout poll-interval register-callback",
  "release secrets sync": "repo file",
  "data schema list": "page page-size",
  "data schema push": "",
  "data schema indexes list": "schema-id",
  "data schema indexes create": "schema-id fields unique name",
  "data sync": "",
  "data rules pull": "",
  "data rules deploy": "",
  "localization language list": "",
  "localization language list-for-tenant": "",
  "localization language save": "language-name language-code is-default",
  "localization module list": "",
  "localization module list-for-tenant": "",
  "localization module save": "module-name",
  "localization validate": "module language file",
  "localization push": "module language file route context",
  "localization pull": "module language out",
  "localization key translate-all": "module-id default-language",
  "localization key generate-uilm-file": "module-id",
  "localization key get-by-names": "key-names module-id",
  "localization key delete-keys": "item-ids",
};
const booleanFlags = new Set([
  "json", "yes", "dry-run", "require-pkce", "register-as-identity-provider", "auto-redirect", "active",
  "use-tokens-cookie", "oidc-enabled", "wait", "register-callback", "unique", "is-default",
]);

interface Broker {
  run: JobRun;
  tenant: string;
  root: string;
  session: NonNullable<ReturnType<typeof sharedBlocksSession>>;
  url: string;
  token: string;
}
const current = new AsyncLocalStorage<Broker>();

function invalid(): never {
  throw new Error("This Blocks command is unavailable through the shared engine login.");
}

function within(root: string, entry: string): boolean {
  const relative = path.relative(root, entry);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve both existing paths and a new output path through its nearest existing parent. */
function projectPath(root: string, entry: string): string {
  const absolute = path.resolve(entry);
  if (!within(root, absolute)) invalid();
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (ancestor === root) invalid();
    ancestor = path.dirname(ancestor);
  }
  if (fs.realpathSync(ancestor) !== ancestor) invalid();
  return absolute;
}

function projectFile(root: string, entry: string): string {
  const file = projectPath(root, entry);
  if (fs.existsSync(file)) {
    const info = fs.statSync(file);
    if (!info.isFile() || info.nlink !== 1) invalid();
  }
  return file;
}

/** The broker owns the project/API/account selectors. Product processes can request only known project operations. */
export function brokerArgs(tenant: string, args: string[], root: string, cwd: string): string[] {
  const command = [4, 3, 2].map((n) => args.slice(0, n).join(" ")).find((key) => Object.hasOwn(flagSets, key));
  if (!command) invalid();
  const words = command.split(" ");
  const flags = new Set(["json", "dry-run", "yes", ...flagSets[command]!.split(" ").filter(Boolean)]);
  const positions = command === "projects get" || command === "auth oidc-clients get" ||
    command === "release deploy" || command === "release setup" ? 1 : 0;
  const result = [...words];
  let position = 0;
  for (let i = words.length; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      if (arg.startsWith("-") || ++position > positions || (command === "projects get" && arg !== tenant)) invalid();
      result.push(arg);
      continue;
    }
    const [key, ...inline] = arg.slice(2).split("=");
    if (key === "project") {
      if ((inline.length ? inline.join("=") : args[++i]) !== tenant) invalid();
      continue;
    }
    if (!key || !flags.has(key)) invalid();
    if (booleanFlags.has(key)) {
      if (inline.length && !/^(true|false)$/.test(inline.join("="))) invalid();
      result.push(arg);
      continue;
    }
    const value = inline.length ? inline.join("=") : args[++i];
    if (!value || value.startsWith("-")) invalid();
    result.push(`--${key}`, key === "file" || key === "out" ? projectFile(root, path.resolve(cwd, value)) : value);
  }
  if (command === "projects get" && position !== 1) invalid();
  return result;
}

function workspaceData(root: string, cwd: string): void {
  const config = JSON.parse(fs.readFileSync(projectFile(root, path.join(cwd, "blocks.json")), "utf8"));
  if (config.data?.schemas !== "blocks/data/schemas" || config.data?.rules !== "blocks/data/rules.json") invalid();
  const walk = (entry: string): void => {
    projectPath(root, entry);
    if (!fs.existsSync(entry)) return;
    const st = fs.lstatSync(entry);
    if (st.isDirectory()) for (const name of fs.readdirSync(entry)) walk(path.join(entry, name));
    else if (!st.isFile() || st.nlink !== 1) invalid();
  };
  walk(path.join(cwd, "blocks", "data"));
}

function reply(res: ServerResponse, code: number, body: object): void {
  if (res.destroyed) return;
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function request(broker: Broker, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST" || req.url !== "/" || req.headers.authorization !== `Bearer ${broker.token}`) {
    reply(res, 404, {});
    return;
  }
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  try {
    let body = "";
    for await (const chunk of req) {
      body += String(chunk);
      if (body.length > 64 * 1024) invalid();
    }
    const { args, cwd: proposed } = JSON.parse(body);
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string") || typeof proposed !== "string") invalid();
    const cwd = projectPath(broker.root, proposed);
    const argv = brokerArgs(broker.tenant, args, broker.root, cwd);
    if (argv[0] === "data" && (argv[1] === "sync" || argv[2] === "push" || argv[1] === "rules")) workspaceData(broker.root, cwd);
    const signal = AbortSignal.any([broker.run.signal, abort.signal]);
    const timeoutMs = argv[0] === "release" && argv.includes("--wait") ? SHARED_BLOCKS_QUEUE_GRACE_MS : undefined;
    const result = await runSharedBlocksCommand(broker.session, broker.tenant, argv, { cwd, signal, timeoutMs });
    reply(res, 200, { stdout: result.stdout });
  } catch {
    reply(res, 400, { error: "The shared Blocks CLI command could not be completed." });
  }
}

/** Only Factory-provisioned Dev tenants use the provisioning account. Attached products keep their own login. */
export async function withFactoryBlocks<T>(run: JobRun, work: () => Promise<T>): Promise<T> {
  const p = run.p.project;
  const tenant = p.BlocksProjectRef;
  const name = p.BlocksProvisioningName;
  if (p.RepoMode === "existing" || p.BlocksProvisioningStatus !== "ready" ||
      typeof tenant !== "string" || !/^D[0-9a-f]{32}$/i.test(tenant) ||
      typeof name !== "string" || !name.startsWith("MADP ") || !name.endsWith(` ${run.projectId}`)) return work();
  const session = sharedBlocksSession();
  if (!session) return work();
  const root = path.resolve(dirsOf(run).root);
  const broker: Broker = { run, tenant, root, session, token: randomBytes(32).toString("hex"), url: "" };
  const server = createServer((req, res) => void request(broker, req, res));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new JobFailure("The engine could not start its shared Blocks CLI.", "blocks.shared_unavailable");
    broker.url = `http://127.0.0.1:${address.port}`;
    return await current.run(broker, work);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

export function factoryBlocksActive(tenant?: string): boolean {
  const broker = current.getStore();
  return !!broker && (tenant === undefined || broker.tenant === tenant);
}

export function factoryBlocksEnv(tenant?: string): NodeJS.ProcessEnv {
  const broker = current.getStore();
  if (!broker || !factoryBlocksActive(tenant)) return {};
  return {
    MF_BLOCKS_BROKER_URL: broker.url,
    MF_BLOCKS_BROKER_TOKEN: broker.token,
    MF_BLOCKS_BROKER_CLIENT: client,
    MF_BLOCKS_BROKER_NODE: process.execPath,
    MF_BLOCKS_BROKER_TENANT: broker.tenant,
    BLOCKS_CONFIG_DIR: path.join(broker.root, ".blocks-cli-local"),
  };
}

export async function execFactoryBlocks(
  tenant: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const broker = current.getStore();
  if (!broker || broker.tenant !== tenant) invalid();
  const cwd = options.cwd ? projectPath(broker.root, options.cwd) : undefined;
  return runSharedBlocksCommand(broker.session, tenant, args, { ...options, cwd, signal: broker.run.signal });
}

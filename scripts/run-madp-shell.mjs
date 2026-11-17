import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const envIndex = args.indexOf("--factory-env");
if (envIndex >= 0) {
  if (!args[envIndex + 1]) throw new Error("--factory-env requires the path of a private factory environment file");
  // Load into this process only; no credentials are copied into the checkout or printed.
  process.loadEnvFile(path.resolve(args[envIndex + 1]));
}
const localEnv = path.join(root, "madp/.env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const env = { ...process.env };
env.MF_BLOCKS_TENANT ||= env.VITE_BLOCKS_PROJECT_KEY;
for (const name of ["MF_BLOCKS_TENANT", "MF_SVC_CLIENT_ID", "MF_SVC_CLIENT_SECRET", "VITE_BLOCKS_API_URL"]) {
  if (!env[name]?.trim()) throw new Error(`Missing ${name}. Configure madp/.env.local or pass --factory-env.`);
}
for (const file of ["madp/node_modules/vite/bin/vite.js", "client/node_modules/vite/bin/vite.js"]) {
  if (!existsSync(path.join(root, file))) throw new Error("Install client and madp dependencies before starting the shell.");
}
const ports = [4001, 5001, 5311];
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}
for (const port of ports) if (await listening(port)) throw new Error(`Port ${port} is already in use. Identify its owning service before restarting it.`);
if (args.includes("--check")) {
  console.log("Factory settings, installed frontend dependencies, and local ports are ready. No services started.");
  process.exit(0);
}
function sharedKey(nodeName, gatewayName) {
  if (env[nodeName] && env[gatewayName] && env[nodeName] !== env[gatewayName]) throw new Error(`The configured ${nodeName} and ${gatewayName} must match.`);
  const value = env[nodeName] || env[gatewayName] || randomBytes(48).toString("base64url");
  if (Buffer.byteLength(value, "utf8") < 32) throw new Error(`${nodeName} must contain at least 32 bytes.`);
  return value;
}
const bridgeKey = sharedKey("MF_BLOCKS_SHELL_KEY", "Madp__BridgeKey");
const repositoryKey = sharedKey("MF_BLOCKS_REPOSITORY_KEY", "Madp__RepositoryKey");
Object.assign(env, {
  MF_BLOCKS_SHELL_ENABLED: "1", MF_BLOCKS_SHELL_KEY: bridgeKey,
  Madp__BridgeKey: bridgeKey, Madp__ApiBaseUrl: "http://127.0.0.1:5311",
  Madp__PublicOrigin: env.MADP_PUBLIC_ORIGIN || "https://dev-monitor.blocksdevelopers.com:4001",
  MF_APP_ORIGIN: "http://127.0.0.1:5311", MF_LISTEN_HOST: "127.0.0.1", MF_INTERNAL_HOST: "127.0.0.1:5311", PORT: "5311",
  FACTORY_PLATFORM: "blocks", VITE_BLOCKS_AUTH_MODE: "embedded",
  MF_BLOCKS_PROVISIONING_ENABLED: "false",
  BLOCKS_MADP_GATEWAY_URL: "http://localhost:5001",
  Madp__RepositoryKey: repositoryKey,
  MF_BLOCKS_REPOSITORY_KEY: repositoryKey,
  MF_BLOCKS_REPOSITORY_URL: "http://127.0.0.1:5001/internal/madp/repositories",
});
env.MF_BLOCKS_SHELL_WRITE_PERMISSIONS ||= "blocks-monitor::monitor::write";
env.FrontendRuntime__BLOCKS_MONITOR_BASE_URL = env.Madp__PublicOrigin;
env.FrontendRuntime__BLOCKS_MONITOR_CALLBACK_URL = env.Madp__PublicOrigin + "/login/callback";
const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }
}
function start(command, arguments_, cwd) {
  const child = spawn(command, arguments_, { cwd, env, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.once("error", () => { console.error(`Could not start ${path.basename(command)}.`); stop(); process.exitCode = 1; });
  child.once("exit", (code) => { if (!stopping) { process.exitCode = code || 1; stop(); } });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const built = spawnSync(process.execPath, ["scripts/build-madp.mjs"], { cwd: root, env, stdio: "inherit", windowsHide: true });
if (built.status !== 0) process.exit(built.status || 1);
start(process.execPath, ["--experimental-sqlite", "scripts/serve-shell.mjs"], path.join(root, "madp"));
start("dotnet", ["run", "--project", "server/Api/Api.csproj", "--launch-profile", "Api", "--", "--urls", "http://127.0.0.1:5001"], root);
start(process.execPath, [path.join(root, "client/node_modules/vite/bin/vite.js"), "--config", "vite.config.ts"], path.join(root, "client"));
console.log(`Starting Blocks MADP at ${env.Madp__PublicOrigin}. The shared owner engine is not started by this launcher.`);

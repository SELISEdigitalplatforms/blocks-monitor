import { cp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [path.join(root, "madp/node_modules/typescript/bin/tsc"), "--noEmit", "-p", path.join(root, "madp")], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
const build = spawnSync(process.execPath, [path.join(root, "madp/node_modules/vite/bin/vite.js"), "build"], { cwd: path.join(root, "madp"), stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
const destination = path.join(root, "server/Api/wwwroot/madp");
await mkdir(destination, { recursive: true });
await cp(path.join(root, "madp/dist"), destination, { recursive: true });

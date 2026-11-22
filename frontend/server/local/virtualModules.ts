// The two virtual modules the functions import: mf:ops/<fn> (every op file of a function, collected by the registry) and
// mf:schemas/acl (the schemas that carry WorkspaceId and ReaderIds). Same output as the root's scripts/functions-common.mjs,
// for this folder's functions/ and blocks/.
import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

const VIRTUAL_PREFIX = "\0";
const toPosix = (p: string): string => p.split(path.sep).join("/");

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".dist" || entry.name === "node_modules") continue;
      walk(full, accept, out);
    } else if (accept(full)) out.push(full);
  }
  return out;
}

const isSource = (f: string): boolean => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts");

/** Function names from functions/functions.config.json. */
export function functionNames(root: string): string[] {
  const config = JSON.parse(fs.readFileSync(path.join(root, "functions", "functions.config.json"), "utf8")) as { functions?: Record<string, unknown> };
  return Object.keys(config.functions ?? {});
}

/** Sorted names of the schemas that have both WorkspaceId and ReaderIds. */
export function aclSchemaNames(root: string): string[] {
  const dir = path.join(root, "blocks", "data", "schemas");
  const names: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { schemaName?: string; fields?: { name: string }[] };
    const fields = new Set((schema.fields ?? []).map((f) => f.name));
    if (fields.has("WorkspaceId") && fields.has("ReaderIds")) names.push(schema.schemaName ?? file.replace(/\.json$/, ""));
  }
  return names.sort();
}

function opsModule(root: string, fn: string): string {
  const rootPosix = toPosix(root).replace(/\/$/, "");
  const files = walk(path.join(root, "functions", fn, "ops"), isSource)
    .map(toPosix)
    .sort()
    .map((abs) => abs.slice(rootPosix.length));
  const lines = ['import { collectOps } from "/functions/_lib/registry.ts";'];
  files.forEach((id, i) => lines.push(`import * as ns${i} from ${JSON.stringify(id)};`));
  lines.push(`export default collectOps([${files.map((id, i) => `[${JSON.stringify(id.slice(1))}, ns${i}]`).join(", ")}]);`);
  return `${lines.join("\n")}\n`;
}

export function localVirtualModules(root: string): Plugin {
  return {
    name: "factory-virtual-modules",
    resolveId(source) {
      if (source === "mf:schemas/acl") return `${VIRTUAL_PREFIX}${source}`;
      if (source.startsWith("mf:ops/")) {
        const fn = source.slice("mf:ops/".length);
        if (!functionNames(root).includes(fn)) throw new Error(`Unknown function "${fn}" in ${source}`);
        return `${VIRTUAL_PREFIX}${source}`;
      }
      return null;
    },
    load(id) {
      if (id === `${VIRTUAL_PREFIX}mf:schemas/acl`) return `export default ${JSON.stringify(aclSchemaNames(root))};\n`;
      if (id.startsWith(`${VIRTUAL_PREFIX}mf:ops/`)) return opsModule(root, id.slice(`${VIRTUAL_PREFIX}mf:ops/`.length));
      return null;
    },
    configureServer(server: ViteDevServer) {
      // A new or removed op file changes the op list: regenerate mf:ops/*.
      const opsDir = `${toPosix(path.join(root, "functions"))}/`;
      const invalidate = (file: string): void => {
        const f = toPosix(file);
        if (!f.startsWith(opsDir) || !f.includes("/ops/")) return;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith(`${VIRTUAL_PREFIX}mf:ops/`)) server.moduleGraph.invalidateModule(mod);
        }
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}

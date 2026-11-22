// Shared helpers of the functions build and deploy scripts: catalogue, op discovery, virtual modules, import boundary, input hash.
import crypto from "node:crypto";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SLUG = /^mf-[a-z][a-z0-9-]{0,40}$/;
const MAX_DESCRIPTION = 200;
const MAX_SOURCE_PARTS = ["mf:ops/", "mf:schemas/"];
const VIRTUAL_PREFIX = "\0";
const toPosix = (p) => p.split(path.sep).join("/");

export const FUNCTION_KEYS = ["workspace", "project", "delivery", "collab", "admin", "engine", "billing"];

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** Reads and validates functions/functions.config.json. */
export function readFunctionsConfig(root = ROOT) {
  const file = path.join(root, "functions", "functions.config.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = [];
  if (typeof config.projectKey !== "string" || !config.projectKey) problems.push("projectKey is missing");
  if (!config.trigger || typeof config.trigger !== "object") problems.push("trigger is missing");
  else if (config.trigger.authMode === "Public" || config.trigger.authMode !== "Token") problems.push("trigger.authMode must be Token");
  if (!Array.isArray(config.variables)) problems.push("variables must be a list");
  const fns = config.functions;
  if (!fns || typeof fns !== "object") problems.push("functions is missing");
  else {
    for (const [key, fn] of Object.entries(fns)) {
      if (!SLUG.test(fn?.slug ?? "")) problems.push(`${key}: invalid slug`);
      if (typeof fn?.description !== "string" || !fn.description || fn.description.length > MAX_DESCRIPTION) {
        problems.push(`${key}: description must be 1 to ${MAX_DESCRIPTION} characters`);
      }
      if (!Array.isArray(fn?.roles) || fn.roles.length === 0) problems.push(`${key}: roles must not be empty`);
    }
  }
  if (problems.length) throw new Error(`functions.config.json: ${problems.join("; ")}`);
  return config;
}

function walk(dir, accept, out = []) {
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

const isSource = (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts");

/** Sorted absolute posix paths of functions/<fn>/ops/**\/*.ts without tests and declarations. */
export function listOpFiles(root, fn) {
  return walk(path.join(root, "functions", fn, "ops"), isSource).map(toPosix).sort();
}

/** Sorted names of the S1 schemas that have both WorkspaceId and ReaderIds. */
export function aclSchemaNames(root) {
  const dir = path.join(root, "blocks", "data", "schemas");
  if (!fs.existsSync(dir)) throw new Error(`blocks/data/schemas is missing: lane S1 (data model) must be merged first (${dir})`);
  const names = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const fields = new Set((schema.fields ?? []).map((f) => f.name));
    if (fields.has("WorkspaceId") && fields.has("ReaderIds")) names.push(schema.schemaName ?? file.replace(/\.json$/, ""));
  }
  return names.sort();
}

/** Source of the virtual module mf:ops/<fn>: every op file as a namespace, collected by the registry. */
export function generateOpsModule(root, fn) {
  const rootPosix = toPosix(root).replace(/\/$/, "");
  const files = listOpFiles(root, fn).map((abs) => abs.slice(rootPosix.length));
  const lines = ['import { collectOps } from "/functions/_lib/registry.ts";'];
  files.forEach((id, i) => lines.push(`import * as ns${i} from ${JSON.stringify(id)};`));
  const entries = files.map((id, i) => `[${JSON.stringify(id.slice(1))}, ns${i}]`);
  lines.push(`export default collectOps([${entries.join(", ")}]);`);
  return `${lines.join("\n")}\n`;
}

export function generateAclModule(root) {
  return `export default ${JSON.stringify(aclSchemaNames(root))};\n`;
}

/** Vite plugin that resolves and generates mf:ops/<fn> and mf:schemas/acl. */
export function mfVirtualModules({ root = ROOT, config } = {}) {
  const cfg = () => config ?? readFunctionsConfig(root);
  const knownFns = () => Object.keys(cfg().functions);
  return {
    name: "mf-virtual-modules",
    resolveId(source) {
      if (source === "mf:schemas/acl") return `${VIRTUAL_PREFIX}${source}`;
      if (source.startsWith("mf:ops/")) {
        const fn = source.slice("mf:ops/".length);
        if (!knownFns().includes(fn)) throw new Error(`Unknown function "${fn}" in ${source}`);
        return `${VIRTUAL_PREFIX}${source}`;
      }
      return null;
    },
    load(id) {
      if (id === `${VIRTUAL_PREFIX}mf:schemas/acl`) return generateAclModule(root);
      if (id.startsWith(`${VIRTUAL_PREFIX}mf:ops/`)) return generateOpsModule(root, id.slice(`${VIRTUAL_PREFIX}mf:ops/`.length));
      return null;
    },
    configureServer(server) {
      const opsDir = `${toPosix(path.join(root, "functions"))}/`;
      const invalidate = (file) => {
        const f = toPosix(file);
        if (!f.startsWith(opsDir) || !f.includes("/ops/")) return;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith(`${VIRTUAL_PREFIX}mf:ops/`)) server.moduleGraph.invalidateModule(mod);
        }
      };
      server.watcher.add(path.join(root, "functions"));
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}

const BUILTINS = new Set(builtinModules);

function insideAllowedTree(root, file) {
  const rel = toPosix(path.relative(root, file.split("?")[0]));
  if (rel.startsWith("../")) return false;
  if (rel.startsWith("functions/")) return !rel.startsWith("functions/_lib/testing/") && !rel.startsWith("functions/.dist/");
  return rel.startsWith("src/domain/");
}

/** Build-time import boundary: functions import only functions/**, src/domain/**, the SDK and node: builtins. */
export function boundaryPlugin({ root = ROOT } = {}) {
  return {
    name: "mf-boundary",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(VIRTUAL_PREFIX) || importer.includes("node_modules")) return null;
      const where = toPosix(path.relative(root, importer.split("?")[0]));
      const refuse = (rule) => this.error(`${where}: import "${source}" is not allowed (${rule})`);
      if (source.startsWith("node:")) return null;
      if (MAX_SOURCE_PARTS.some((p) => source.startsWith(p))) return null;
      if (source === "@seliseblocks/client" || source.startsWith("@seliseblocks/client/")) return null;
      if (BUILTINS.has(source) || BUILTINS.has(source.split("/")[0])) return refuse('Node builtins must be imported as "node:<name>"');
      if (!(source.startsWith(".") || source.startsWith("/"))) {
        return refuse("allowed: functions/**, src/domain/**, @seliseblocks/client and node: builtins");
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      if (resolved.external) return null;
      if (!insideAllowedTree(root, resolved.id)) {
        return refuse("allowed: functions/** (not functions/_lib/testing), src/domain/**, @seliseblocks/client and node: builtins");
      }
      return resolved;
    },
  };
}

/** sha256 over the inputs of a build: function and domain sources, config, S1 schemas and validations. */
export function hashInputs(root = ROOT) {
  const files = [
    ...walk(path.join(root, "functions"), (f) => f.endsWith(".ts")),
    ...walk(path.join(root, "src", "domain"), (f) => f.endsWith(".ts")),
    path.join(root, "functions", "functions.config.json"),
    ...walk(path.join(root, "blocks", "data", "schemas"), (f) => f.endsWith(".json")),
    path.join(root, "blocks", "data", "validations.json"),
  ]
    .filter((f) => fs.existsSync(f))
    .map((f) => [toPosix(path.relative(root, f)), f])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = crypto.createHash("sha256");
  for (const [rel, abs] of files) {
    h.update(rel);
    h.update("\0");
    h.update(fs.readFileSync(abs));
    h.update("\0");
  }
  return h.digest("hex");
}

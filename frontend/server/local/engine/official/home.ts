// Where the official MADP engine lives on the engine host, and the Python that runs it. Kept apart from madp.ts (which
// needs the job runner) so the operator's attach command can run with plain Node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A folder with every link in its path resolved; as given when it does not exist. On the engine host the app is a
 *  link to the current release (engine-host/install-engine-vm.sh): a lane gets the concrete release folder once, at
 *  its start, as its working folder and MADP_FRAMEWORK_HOME, so it runs on that release's files to its end even when
 *  the link moves to a newer release meanwhile. */
export function concretePath(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

/** The official engine's folder, concrete (see concretePath): MF_MADP_ENGINE_HOME, else engine/selise-madp of this
 *  repository. Resolved on every call, so each lane resolves it once when it starts. */
export function officialHome(env: Record<string, string | undefined> = process.env): string {
  const home = String(env.MF_MADP_ENGINE_HOME ?? "").trim();
  return concretePath(home ? path.resolve(home) : path.resolve(here, "../../../../..", "engine", "selise-madp"));
}

/** The official engine's folder as it stays named across releases, for paths written down in a product's registry
 *  (attach.ts -> hostRegistry): MF_MADP_ENGINE_HOME as given; on the engine host the engine folder through the release
 *  link (MF_ENGINE_APP_LINK from run.sh: <bridge>/app/selise-madp/frontend -> <bridge>/app/selise-madp/engine/selise-madp),
 *  never a release folder that a later prune removes; else this checkout's. A lane resolves such a path when it uses
 *  it, as before the releases (the link names a complete release at any moment). */
export function stableOfficialHome(env: Record<string, string | undefined> = process.env): string {
  const home = String(env.MF_MADP_ENGINE_HOME ?? "").trim();
  if (home) return path.resolve(home);
  const link = String(env.MF_ENGINE_APP_LINK ?? "").trim();
  return link ? path.resolve(link, "..", "engine", "selise-madp") : path.resolve(here, "../../../../..", "engine", "selise-madp");
}

/** Python 3.11+ with PyYAML: MF_MADP_PYTHON, else python3. */
export const madpPython = (): string => String(process.env.MF_MADP_PYTHON ?? "").trim() || "python3";

/** Where every product keeps its own Blocks sign-in on the engine host, one folder per product and environment:
 *  MF_BLOCKS_PRODUCT_STORES, else <engine home>/.config/seliseblocks-products. */
export function productStoreRoot(home = os.homedir()): string {
  const env = String(process.env.MF_BLOCKS_PRODUCT_STORES ?? "").trim();
  return env ? path.resolve(env) : path.join(home, ".config", "seliseblocks-products");
}

/** The Blocks login store (BLOCKS_CONFIG_DIR) of one product environment: <root>/<registry name>-<env>. */
export const productStore = (name: string, env: string, root = productStoreRoot()): string => path.join(root, `${name}-${env}`);

/** Where every product keeps the files its live acceptance tests read as `.local/` (its QA test accounts) on the engine
 *  host, outside every clone: MF_ACCEPTANCE_SECRETS, else <engine home>/.config/madp-acceptance. The engine team puts
 *  them there by hand; nothing in the Factory writes or reads their contents. */
export function acceptanceSecretsRoot(home = os.homedir()): string {
  const env = String(process.env.MF_ACCEPTANCE_SECRETS ?? "").trim();
  return env ? path.resolve(env) : path.join(home, ".config", "madp-acceptance");
}

/** The registry's `acceptance.secrets_dir` of one product environment and repo: <root>/<registry name>-<env>/<repo key>. */
export const acceptanceSecretsDir = (name: string, env: string, repo: string, root = acceptanceSecretsRoot()): string => path.join(root, `${name}-${env}`, repo);

/** The engine's own default Blocks login store (the Blocks CLI's configDir() without BLOCKS_CONFIG_DIR): the Factory's
 *  own login, which the provisioning scan uses. A product never shares it. */
export function defaultBlocksStore(home = os.homedir()): string {
  if (process.platform === "win32") return path.join(String(process.env.APPDATA ?? "").trim() || path.join(home, "AppData", "Roaming"), "seliseblocks", "cli");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "seliseblocks", "cli");
  return path.join(String(process.env.XDG_CONFIG_HOME ?? "").trim() || path.join(home, ".config"), "seliseblocks", "cli");
}

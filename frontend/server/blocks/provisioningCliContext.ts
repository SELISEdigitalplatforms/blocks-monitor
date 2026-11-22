import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultBlocksStore } from "../local/engine/official/home.ts";

/** Use the same Blocks CLI login store for the provisioning account and shared project operations. */
export function provisioningStore(env: Record<string, string | undefined> = process.env): string {
  const own = String(env.BLOCKS_CONFIG_DIR ?? "").trim();
  return own ? path.resolve(own) : defaultBlocksStore();
}

/** Avoid a product workspace's blocks.json selecting a tenant during account-mode operations. */
export const neutralCwd = (store: string): string => (fs.existsSync(store) ? store : os.homedir());

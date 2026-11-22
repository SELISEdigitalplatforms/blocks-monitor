import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { factoryBlocksEnv } from "../../../blocks/sharedCliBroker.ts";
import { officialHome } from "./home.ts";

const BODY = /^const SERVICE_ROLE = .+;$/m;
// The unified and split templates shared this implementation before the fail-closed data sync update.
const ORIGINAL_TEMPLATE = "a0d5ace38c91dcabb4b77048a6427699126955e03cf464f8331cfbae3a10ce8e";

function body(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(BODY, "SERVICE_ROLE").trim();
}

/** Run the engine's template for Factory data sync. Existing scaffolds need no repository edits. */
export function sharedDataSync(source: string, repo: string, tenant: string, packageJson: string | null = null): { script: string; env: NodeJS.ProcessEnv } | undefined {
  if (packageJson !== null) {
    try {
      const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> } | null)?.scripts;
      if (scripts?.["predata:sync"] || scripts?.["postdata:sync"]) return;
      if (scripts?.["data:sync"] && scripts["data:sync"] !== "node scripts/data-sync.mjs") return;
    } catch {
      return;
    }
  }
  const role = /^const SERVICE_ROLE = (?:process\.env\.MF_BLOCKS_BROKER_URL && process\.env\.MF_BLOCKS_DATA_SERVICE_ROLE \|\| )?"([A-Za-z0-9_-]{1,128})";\r?$/m.exec(source)?.[1];
  if (!role) return;
  const script = path.join(officialHome(), "MADP", "profiles", "selise-blocks-app", "templates", "app", "scripts", "data-sync.mjs");
  const standard = body(fs.readFileSync(script, "utf8"));
  const actual = body(source);
  if (standard !== actual && createHash("sha256").update(actual).digest("hex") !== ORIGINAL_TEMPLATE) return;
  return {
    script,
    env: { ...factoryBlocksEnv(tenant), MF_BLOCKS_DATA_WORKSPACE: repo, MF_BLOCKS_DATA_SERVICE_ROLE: role },
  };
}

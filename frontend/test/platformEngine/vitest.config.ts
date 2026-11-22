// Platform → Engine & capacity and AI accounts: the host readers, the heartbeat, the account pool, the ops and the sections.
//   FACTORY_PLATFORM=local npx vitest run --config frontend/test/platformEngine/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/platformEngine/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

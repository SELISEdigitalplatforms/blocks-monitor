// The change request light SDLC in the UI (CHANGE-PROCESS-31.10): the lifecycle model and the rendered states.
//   npx vitest run --config frontend/test/changes/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/changes/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

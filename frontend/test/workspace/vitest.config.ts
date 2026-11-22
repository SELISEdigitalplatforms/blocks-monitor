// Workspace settings: the workspace.rename op through the real router and the Settings → Workspace card.
//   npx vitest run --config frontend/test/workspace/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/workspace/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

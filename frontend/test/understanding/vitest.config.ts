// "Understanding your project" (step 2): the What to do now model and the analysis that starts at the hand-over.
//   npx vitest run --config frontend/test/understanding/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/understanding/**/*.test.ts"], environment: "node", testTimeout: 120_000, hookTimeout: 120_000 },
});

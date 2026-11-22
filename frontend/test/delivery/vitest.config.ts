// The Build and Release steps (step 5 and 6): their frame models, and the milestone.accept / milestone.feedback ops.
//   npx vitest run --config frontend/test/delivery/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/delivery/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
});

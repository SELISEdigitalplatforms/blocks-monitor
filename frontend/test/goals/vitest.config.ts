// Goals & requirements (priorities, the step frame's checklist, the workflows / not included / constraints lists and
// their ops through the router):
//   npx vitest run --config frontend/test/goals/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/goals/**/*.test.ts"], environment: "node" },
});

// Scope & success tests (success & performance targets, the "What to do now" checklist, the scope.success ops, the
// lock rule and the product manager's proposals):
//   npx vitest run --config frontend/test/scope/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/scope/**/*.test.ts"], environment: "node" },
});

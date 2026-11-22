// The project journey bar's tests (the step model and the rendered bar):
//   npx vitest run --config frontend/test/journey/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/journey/**/*.test.ts"], environment: "node" },
});

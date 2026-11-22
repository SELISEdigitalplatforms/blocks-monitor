// The Project setup windows' tests (save rules, the brief sections, project.setup.save through the router):
//   npx vitest run --config frontend/test/setup/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/setup/**/*.test.ts"], environment: "node" },
});

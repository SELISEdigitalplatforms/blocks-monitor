// The project switcher and the leave guard (what is unfinished on a project before switching away):
//   npx vitest run --config test/project/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/project/**/*.test.{ts,tsx}"], environment: "node" },
});

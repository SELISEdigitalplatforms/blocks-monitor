// What MADP produced (/p/:id/produced): the outputs list and file links, and the page in every state.
//   npx vitest run --config frontend/test/outputs/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/outputs/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

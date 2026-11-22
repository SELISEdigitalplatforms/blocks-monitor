// The local MADP engine's tests (the app's vite.config starts the local host, which a unit test must not do):
//   npx vitest run --config frontend/test/engine/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/engine/**/*.test.ts"], environment: "node", testTimeout: 120_000, hookTimeout: 120_000 },
});

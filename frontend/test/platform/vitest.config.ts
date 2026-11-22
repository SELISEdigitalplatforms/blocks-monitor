// Platform management (/admin): its sections, the navigation, the access gate and the overview's defensive reads.
//   npx vitest run --config frontend/test/platform/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/platform/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

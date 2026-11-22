// The seed's own test run (the app's vite.config starts the local host, which a unit test must not do):
//   npx vitest run --config frontend/seed/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.join(root, "src")}/` },
    ],
  },
  test: { include: ["seed/**/*.test.ts"], environment: "node", testTimeout: 120_000 },
});

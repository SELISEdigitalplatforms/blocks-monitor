// Factory texts in several languages: t() and its fallbacks, the language switch and its preference, the formatting
// helpers, the UILM text route and the push script's extractor:
//   npx vitest run --config frontend/test/i18n/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/i18n/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

// IAM migration and parity (server/iam/migrate): the plan from today's Factory rows and IAM, the apply order and its
// idempotency over an in-memory IAM, and the parity check before switching rbac.source to "iam":
//   npx vitest run --config frontend/test/iamMigrate/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/iamMigrate/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

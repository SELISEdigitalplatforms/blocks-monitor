// Billing: the usage surfaces (pill, breakdown, account menu line, Plan and usage card, plan cards) over a fake billing
// function, and the money math, usage-line parser, billing ops, usage capture and backfill (money.test.ts, ops.test.ts):
//   npx vitest run --config frontend/test/billing/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/billing/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

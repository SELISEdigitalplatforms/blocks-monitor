// Public sign-up, e-mail verification, forgot/reset password: the /api/auth routes over a fake IAM and sign-up backend
// (rate limits, no account enumeration, single-use links that expire, the password policy), the shared rules, the
// first-organization and settings ops through the real router, and the pages' states:
//   npx vitest run --config frontend/test/auth/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/auth/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 60_000 },
});

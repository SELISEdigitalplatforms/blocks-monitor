// The 3D visit's stories (the scripted answers, the chips, files, repositories, questions and requirements):
//   npx vitest run --config frontend/test/cinematic/vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export default defineConfig({
  root,
  resolve: { alias: [{ find: /^@\//, replacement: `${path.join(root, "src")}/` }] },
  test: { include: ["test/cinematic/**/*.test.ts"], environment: "node" },
});

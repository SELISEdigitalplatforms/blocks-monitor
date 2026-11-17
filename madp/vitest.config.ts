import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve: { alias: { "@": path.join(root, "src") } },
  test: {
    include: ["src/**/*.test.ts", "server/shell/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});

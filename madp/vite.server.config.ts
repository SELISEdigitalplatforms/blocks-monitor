import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localVirtualModules } from "./server/local/virtualModules.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [localVirtualModules(root)],
  build: {
    ssr: path.join(root, "server/production.ts"),
    outDir: "dist-server",
    rolldownOptions: { output: { entryFileNames: "production.mjs" } },
  },
});

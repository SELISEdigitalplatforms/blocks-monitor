import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";
import tailwindConfig from "./tailwind.config.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/madp/",
  plugins: [react()],
  resolve: { alias: { "@": path.join(here, "src") } },
  // The existing MADP service owns workflow functions and its session cookie.
  define: { __MF_FN_HOST__: JSON.stringify("local"), "import.meta.env.VITE_BLOCKS_AUTH_MODE": JSON.stringify("embedded") },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...tailwindConfig, content: [path.join(here, "index.html"), path.join(here, "src/**/*.{ts,tsx}")] }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
});

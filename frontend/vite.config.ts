import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tailwindConfig from "./tailwind.config.ts";
import { blocksFrontend } from "./server/blocks/plugin.ts";
import { localVirtualModules } from "./server/local/virtualModules.ts";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PORT = 5310;

/** The local app's own first-paint theme script (light by default); the root public/theme-init.js stays the root app's. */
function themeInitLocal(): Plugin {
  const file = path.join(here, "theme-init-local.js");
  return {
    name: "local-theme-init",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== "/theme-init-local.js") return next();
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "theme-init-local.js", source: readFileSync(file, "utf8") });
    },
  };
}
// npm run reset loads the seed through a middleware-mode Vite server: it must never touch the dev server's pre-bundle cache.
const resetTask = process.env.FACTORY_TASK === "reset";

const VENDOR_3D = new Set(["three", "three-stdlib", "react-reconciler", "its-fine", "suspend-react"]);
const VENDOR_REACT = new Set([
  "react",
  "react-dom",
  "scheduler",
  "react-router",
  "react-router-dom",
  "@remix-run/router",
  "use-sync-external-store",
  "zustand",
]);

// Matches the exact package name (last node_modules segment) so shared deps such as zustand never land in vendor-3d.
export function manualChunks(id: string): string | undefined {
  const marker = "node_modules/";
  const at = id.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = id.slice(at + marker.length).split("/");
  const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  if (pkg.startsWith("@react-three/") || VENDOR_3D.has(pkg)) return "vendor-3d";
  if (VENDOR_REACT.has(pkg)) return "vendor-react";
  return undefined;
}

// MADP Factory on the local store: http://localhost:5310 (the Blocks-backed app at the repository root keeps 5300).
// 3D models and theme-init.js come from frontend/public/.
export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, here, "");
  const cloud = env.FACTORY_PLATFORM !== "local";
  const devHost = env.VITE_BLOCKS_DEV_HOST || "dbsaun.slsblx.com";
  const devPort = Number(env.VITE_BLOCKS_DEV_PORT || LOCAL_PORT);
  const appOrigin = `https://${devHost}:${devPort}`;
  const keyFile = path.join(here, ".cert/dev-key.pem");
  const certFile = path.join(here, ".cert/dev-cert.pem");
  if (cloud && command === "serve" && (!existsSync(keyFile) || !existsSync(certFile))) {
    throw new Error("Blocks hosted login needs local HTTPS. Run npm run cert first.");
  }
  return {
  root: here,
  publicDir: path.join(here, "public"),
  plugins: [react(), themeInitLocal(), cloud
    ? [localVirtualModules(here), blocksFrontend({ root: here, appOrigin, apiOrigin: env.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com", env })]
    : (await import("./server/local/plugin.ts")).localFactory({ root: here })],
  resolve: { alias: { "@": path.join(here, "src") } },
  // Its own pre-bundle cache, so the root app's dev server never invalidates this one (and the other way round).
  cacheDir: path.join(here, ".vite-cache", resetTask ? "reset" : "app"),
  // Pre-bundle every dependency at startup, including those reached only through lazy screens (3D office, studio, board,
  // timeline), so a first visit never answers 504 "Outdated Optimize Dep".
  optimizeDeps: resetTask
    ? { noDiscovery: true, entries: [], include: [] }
    : {
        entries: ["index.html", "src/**/*.{ts,tsx}"],
        include: ["three", "@react-three/fiber", "@react-three/drei"],
      },
  // Tailwind with absolute content paths: the app builds the same from any working directory.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...tailwindConfig, content: [path.join(here, "index.html"), path.join(here, "src/**/*.{ts,tsx}")] }),
        autoprefixer(),
      ],
    },
  },
  server: {
    // Engine artifacts and runtime caches are private generated data, never source modules.
    // Windows can lock downloaded archives while tools run; do not attach fs.watch to them.
    watch: { ignored: ['**/data/**', '**/.vite-cache/**', '**/dist/**', '**/test-results/**', '**/e2e-report/**'] },
    host: "127.0.0.1",
    port: cloud ? devPort : LOCAL_PORT,
    ...(cloud && existsSync(keyFile) && existsSync(certFile) ? { https: { key: readFileSync(keyFile), cert: readFileSync(certFile) } } : {}),
    strictPort: true,
    // The app's one origin is http://localhost:5310; 127.0.0.1 redirects there (cookies and same-origin checks are per origin).
    allowedHosts: cloud ? [devHost, "localhost"] : ["localhost"],
    // The app is same-origin; Vite's default CORS middleware would answer cross-origin preflights first.
    cors: false,
    // This folder and its own node_modules (fonts and other package assets).
    fs: { allow: [here, path.join(here, "node_modules")] },
  },
  preview: { host: "127.0.0.1", port: cloud ? devPort : LOCAL_PORT + 1, strictPort: true,
    ...(cloud && existsSync(keyFile) && existsSync(certFile) ? { https: { key: readFileSync(keyFile), cert: readFileSync(certFile) } } : {}) },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: (id: string) => manualChunks(id) === "vendor-react", priority: 2 },
            { name: "vendor-3d", test: (id: string) => manualChunks(id) === "vendor-3d", priority: 1 },
          ],
        },
      },
    },
  },
  };
});

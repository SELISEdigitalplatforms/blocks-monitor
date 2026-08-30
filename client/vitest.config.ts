/// <reference types="vitest/config" />
import path from "path";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

const alias = {
  "@/components": path.resolve(__dirname, "./app/components"),
  "@/constants": path.resolve(__dirname, "./app/constants"),
  "@/contexts": path.resolve(__dirname, "./app/contexts"),
  "@/hooks": path.resolve(__dirname, "./app/hooks"),
  "@/layouts": path.resolve(__dirname, "./app/layouts"),
  "@/lib": path.resolve(__dirname, "./app/lib"),
  "@/models": path.resolve(__dirname, "./app/models"),
  "@/pages": path.resolve(__dirname, "./app/pages"),
  "@/providers": path.resolve(__dirname, "./app/providers"),
  "@/routes": path.resolve(__dirname, "./app/routes"),
  "@/services": path.resolve(__dirname, "./app/services"),
  "@/styles": path.resolve(__dirname, "./app/styles"),
  "@/utils": path.resolve(__dirname, "./app/utils"),
  "@": path.resolve(__dirname, "./app"),
  // The real subpath bundles a nested framer-motion build that fails to load
  // under jsdom (reads process.env.NODE_ENV during evaluation). The app only
  // uses tiny helpers from it, so redirect to a local stub in tests.
  "@seliseblocks/genesis-os/components": path.resolve(
    __dirname,
    "./app/__tests__/stubs/blocks-kit-components.tsx",
  ),
  // The real subpath builds a Rollbar client at import time and reads runtime env through the
  // package's own inlined getRuntimeEnv, which `vi.mock(".../lib")` does not intercept; it then
  // falls through to import.meta.env, undefined in the externalized dep. http-client calls
  // getRollbar at module scope, so that broke every spec importing a service.
  // NOTE: these are prefix matches. If a bare "@seliseblocks/genesis-os" alias is ever added it
  // must go BELOW both subpath entries, or it swallows them.
  "@seliseblocks/genesis-os/observability": path.resolve(
    __dirname,
    "./app/__tests__/stubs/blocks-kit-observability.tsx",
  ),
};

export default defineConfig({
  // svgr must match vite.config.ts: "*.svg?react" imports are React components in
  // the app build, and without this plugin the tests get the asset URL instead.
  plugins: [react(), svgr({ svgrOptions: { svgo: true, titleProp: true } })],
  resolve: { alias },
  // Pin NODE_ENV for code that reads it during module init (runtime-env,
  // http-client). blocks-kit's framer-motion is not inlined, so this does not
  // reach it — the `/components` alias above keeps framer out of the tests.
  define: {
    "process.env.NODE_ENV": JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    coverage: {
      all: true,
      provider: "v8",
      // lcov must stay in this list - it is the only format SonarQube reads.
      // A duplicate `reporter` key previously overrode it, so coverage was
      // computed but never written and Sonar reported 0%.
      reporter: ["text", "text-summary", "lcov"],
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.test.*",
        "app/**/*.spec.*",
        // Test helpers / fixtures live alongside the specs.
        "**/__tests__/**",
        "app/**/*.d.ts",
        "app/**/main.tsx",
        "app/**/vite-env.d.ts",
        "**/components/ui/**",
        // This repo's shadcn/ui primitives live under components/core.
        "**/components/core/**",
        "app/**/*.stories.*",
        "**/__generated__/**",
        "**/*.gen.*",
      ],
    },
  },
});

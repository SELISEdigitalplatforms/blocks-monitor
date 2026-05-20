import fs from "fs";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

// Local dev HTTPS, driven ONLY by the machine env vars OBSERVABILITY_SSL_CERT /
// OBSERVABILITY_SSL_KEY (abs paths to an mkcert PEM cert + key). Read directly
// from process.env — NOT loadEnv, which is BLOCKS_-prefixed and would hide
// these non-prefixed names. Both set AND both files present -> HTTPS;
// otherwise warn and fall back to HTTP (returns undefined). Never throws.
// NOTE: this is consumed only by Vite's `server` block (the dev server). It is
// not referenced by `vite build`, so the built/deployed artifact is unaffected.
// `undefined` (not `false`) is the HTTP value: Vite 6 types `server.https` as
// `https.ServerOptions | undefined`, and vite.config.ts is type-checked by
// `tsc -b` (tsconfig.node.json, strict) during `npm run build`.
function resolveDevHttps(): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env.OBSERVABILITY_SSL_CERT;
  const keyPath = process.env.OBSERVABILITY_SSL_KEY;

  if (!certPath || !keyPath) {
    console.warn(
      "[dev-https] OBSERVABILITY_SSL_CERT / OBSERVABILITY_SSL_KEY not set — serving HTTP.",
    );
    return undefined;
  }
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.warn(
      `[dev-https] cert/key file missing (cert=${certPath}, key=${keyPath}) — serving HTTP.`,
    );
    return undefined;
  }
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "BLOCKS_");
  const proxyTarget = env.BLOCKS_API_BASE_URL;
  const idpProxyTarget = env.BLOCKS_IDP_BASE_URL;
  const devHost = env.BLOCKS_DEV_HOST || true;
  const httpsConfig = resolveDevHttps();

  return {
    envPrefix: ["BLOCKS_"],
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./app"),
        "@blocks-idp": path.resolve(__dirname, "./app/cross-modules/idp"),
        "@blocks-lmt": path.resolve(__dirname, "./app/cross-modules/lmt"),
        "@blocks-storage": path.resolve(
          __dirname,
          "./app/cross-modules/storage",
        ),
        "@blocks-communication": path.resolve(
          __dirname,
          "./app/cross-modules/communication",
        ),
        "@blocks-identifier": path.resolve(
          __dirname,
          "./app/cross-modules/identifier",
        ),
        "@blocks-localization": path.resolve(
          __dirname,
          "./app/cross-modules/localization",
        ),
        "@blocks-utilities": path.resolve(
          __dirname,
          "./app/cross-modules/utilities",
        ),
        "@blocks-ai": path.resolve(__dirname, "./app/cross-modules/ai"),
        "@blocks-observability": path.resolve(
          __dirname,
          "./app/cross-modules/observability",
        ),
      },
    },
    build: {
      outDir: "../server/Api/wwwroot",
      emptyOutDir: true,
    },
    server: {
      host: devHost,
      port: 4000,
      strictPort: true, // Exit if the port is already in use
      https: httpsConfig, // HTTPS when DEPLOYMENT_SSL_* are set; else HTTP
      allowedHosts: [
        "dev-cloud.seliseblocks.com",
        "dev-observability.blocksdevelopers.com",
        "localhost",
        ".seliseblocks.com",
        ".blocksdevelopers.com",
      ],
      proxy: {
        ...(idpProxyTarget
          ? {
              "/dev-idp-proxy": {
                target: idpProxyTarget,
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/dev-idp-proxy/, ""),
              },
            }
          : {}),
        ...(proxyTarget
          ? {
              "/api": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/cloudbuild": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/idp": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/identifier": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/communication": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/cloudconfiguration": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/uilm": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/utilities": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/lmt": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/mfa": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/alert": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/blocksai-api": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/studio": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
              "/uds": {
                target: proxyTarget,
                changeOrigin: true,
                secure: false,
              },
            }
          : {}),
      },
    },
  };
});

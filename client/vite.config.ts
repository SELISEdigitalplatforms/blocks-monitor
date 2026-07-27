import fs from "fs";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

// Local dev HTTPS, driven ONLY by the machine env vars MONITOR_SSL_CERT /
// MONITOR_SSL_KEY (abs paths to an mkcert PEM cert + key). Read directly
// from process.env — NOT loadEnv, which is BLOCKS_-prefixed and would hide
// these non-prefixed names. Both set AND both files present -> HTTPS;
// otherwise warn and fall back to HTTP (returns undefined). Never throws.
// NOTE: this is consumed only by Vite's `server` block (the dev server). It is
// not referenced by `vite build`, so the built/deployed artifact is unaffected.
// `undefined` (not `false`) is the HTTP value: Vite 6 types `server.https` as
// `https.ServerOptions | undefined`, and vite.config.ts is type-checked by
// `tsc -b` (tsconfig.node.json, strict) during `npm run build`.
function resolveDevHttps(): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env.MONITOR_SSL_CERT;
  const keyPath = process.env.MONITOR_SSL_KEY;

  if (!certPath || !keyPath) {
    console.warn("[dev-https] MONITOR_SSL_CERT / MONITOR_SSL_KEY not set — serving HTTP.");
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
  const proxyTarget = env.BLOCKS_MONITOR_BASE_URL;
  const iamProxyTarget = env.BLOCKS_IAM_BASE_URL;
  const devHost = env.BLOCKS_DEV_HOST || true;
  const httpsConfig = resolveDevHttps();

  return {
    envPrefix: ["BLOCKS_"],
    plugins: [react()],

    resolve: {
      alias: {
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
      },
    },
    build: {
      outDir: "../server/Api/wwwroot",
      emptyOutDir: true,
    },
    server: {
      host: devHost,
      port: 4001,
      strictPort: true, // Exit if the port is already in use
      https: httpsConfig, // HTTPS when DEPLOYMENT_SSL_* are set; else HTTP
      allowedHosts: [
        "dev-cloud.seliseblocks.com",
        "dev-monitor.blocksdevelopers.com",
        "localhost",
        ".seliseblocks.com",
        ".blocksdevelopers.com",
      ],
      proxy: {
        ...(iamProxyTarget
          ? {
              "/api/auth": {
                target: iamProxyTarget,
                changeOrigin: true,
                secure: true,
              },
              "/api/Impersonation": {
                target: iamProxyTarget,
                changeOrigin: true,
                secure: true,
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
              "/iam": {
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
              "/localization": {
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
              "/data": {
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

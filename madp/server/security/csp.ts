import crypto from "node:crypto";

// The single source of the dev server's Content-Security-Policy (pure; see docs/THREAT-MODEL.md "CSP and headers").
export const CSP_NONCE_PLACEHOLDER = "__mf_csp_nonce__";

/** Must equal the default apiUrl in src/blocks/config.ts (test/security-headers.test.ts checks it). */
export const DEFAULT_BLOCKS_API_URL = "https://blocksapi.slsblx.com";

/** Presigned upload and download URLs point at Blocks Storage (design section 5; live storage is Azure). */
export const STORAGE_ORIGINS: readonly string[] = ["https://*.blob.core.windows.net"];

export interface CspInput {
  nonce: string;
  https: boolean;
  appOrigin: string;
  /** Explicit trusted SDK API origin for hosted OIDC; empty for the legacy local host. */
  blocksApiOrigin: string;
  storageOrigins: readonly string[];
  wasm: boolean;
  reportOnly: boolean;
  hubUrl?: string | null;
}

export interface CspResult {
  header: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
}

const hubOrigins = (hubUrl: string | null | undefined): string[] => {
  if (!hubUrl) return [];
  try {
    const u = new URL(hubUrl);
    if (u.protocol !== "https:" && u.protocol !== "wss:") return [];
    return [`https://${u.host}`, `wss://${u.host}`];
  } catch {
    return [];
  }
};

export function buildCsp(i: CspInput): CspResult {
  const nonce = `'nonce-${i.nonce}'`;
  const storage = [...i.storageOrigins];
  let appHost = "";
  try {
    appHost = new URL(i.appOrigin).host;
  } catch {
    appHost = "";
  }
  const connect = [
    "'self'",
    i.appOrigin,
    ...(appHost ? [`${i.https ? "wss" : "ws"}://${appHost}`] : []),
    ...(i.blocksApiOrigin ? [new URL(i.blocksApiOrigin).origin] : []),
    ...storage,
    ...hubOrigins(i.hubUrl),
  ];
  const directives = [
    "default-src 'none'",
    `script-src 'self' ${nonce}${i.wasm ? " 'wasm-unsafe-eval'" : ""}`,
    `style-src 'self' ${nonce}`,
    `style-src-elem 'self' ${nonce}`,
    "style-src-attr 'unsafe-inline'",
    ["img-src 'self' data: blob:", ...storage].join(" "),
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    // blob: workers are made only by the page's own nonce-checked scripts (drei's 3D text renders its glyphs in one;
    // without it the text falls back to the main thread and the console reports a violation). No other origin.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Only the published Make runtime is framed; never the editor or arbitrary preview hosts.
    "frame-src 'self' https://*.figma.site",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(i.https ? ["upgrade-insecure-requests"] : []),
  ];
  return {
    header: i.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    value: directives.join("; "),
  };
}

/** The policy text shown in docs/THREAT-MODEL.md section 8. https: true documents the optional MF_DEV_HTTPS=1 mode. */
export const DOC_CSP_INPUT: CspInput = {
  nonce: "NONCE",
  https: true,
  appOrigin: "https://localhost:5300",
  blocksApiOrigin: DEFAULT_BLOCKS_API_URL,
  storageOrigins: STORAGE_ORIGINS,
  wasm: false,
  reportOnly: false,
};

/** 'wasm-unsafe-eval' is needed exactly while sql.js is installed (L12 removes it). */
export function needsWasm(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): boolean {
  return Boolean(pkg.dependencies?.["sql.js"] || pkg.devDependencies?.["sql.js"]);
}

export function cspModeOf(env: Record<string, string | undefined>): "enforce" | "report-only" {
  return env.MF_CSP_REPORT_ONLY === "1" ? "report-only" : "enforce";
}

export function newNonce(): string {
  return crypto.randomBytes(18).toString("base64");
}

export const HTML_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

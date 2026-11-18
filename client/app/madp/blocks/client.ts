// SELISE Blocks OS: the ONE client. Nothing else creates one.
import { BlocksApiError, createBlocksClient, type BlocksClient } from "@seliseblocks/client";
import { blocksConfig, hostedLoginEnabled } from "./config";

export interface TokenSource {
  accessToken: () => string | undefined;
  onUnauthorized: () => Promise<string | undefined>;
}

let source: TokenSource = {
  accessToken: () => undefined,
  onUnauthorized: async () => undefined,
};

export function bindTokenSource(src: TokenSource): void {
  source = src;
}

export function recoverUnauthorized(): Promise<string | undefined> {
  return source.onUnauthorized();
}

const { apiUrl, projectKey, oidcClientId, oidcUrl, oidcScope } = blocksConfig();

function inBrowser(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return !!loc && (loc.protocol === "http:" || loc.protocol === "https:");
}

function originOf(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

/**
 * Bridge: rewrite Blocks API calls to same-origin /api/blocks/* so the BFF
 * adds credentials and handles CORS. Presigned URLs pass through untouched.
 */
function bridgedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const apiOrigin = originOf(apiUrl);
  let target: URL;
  try { target = new URL(raw); } catch { return globalThis.fetch(input, init); }
  if (!apiOrigin || target.origin !== apiOrigin) return globalThis.fetch(input, init);
  const bridged = `${globalThis.location.origin}/api/blocks${target.pathname}${target.search}`;
  const headers = new Headers(typeof input === "object" && "headers" in input ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  headers.delete("authorization");
  headers.delete("x-blocks-key");
  const base = typeof input === "object" && "method" in input ? new Request(bridged, input) : bridged;
  return globalThis.fetch(base, { ...init, headers, credentials: "same-origin" });
}

export const blocks: BlocksClient = createBlocksClient({
  apiUrl,
  xBlocksKey: projectKey,
  accessToken: () => undefined,
  onUnauthorized: () => source.onUnauthorized(),
  ...(inBrowser() ? { fetch: bridgedFetch } : {}),
});

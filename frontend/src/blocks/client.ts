// SELISE Blocks OS: the ONE client. Nothing else creates one.
import { BlocksApiError, createBlocksClient, type BlocksClient } from "@seliseblocks/client";
import { blocksConfig, hostedLoginEnabled } from "./config";

/** Session recovery is bound by the session store; hosted IAM uses secure HttpOnly cookies. */
export interface TokenSource {
  accessToken: () => string | undefined;
  onUnauthorized: () => Promise<string | undefined>;
}

let source: TokenSource = {
  accessToken: () => undefined,
  onUnauthorized: async () => undefined,
};

/** Replace the token source (the session store binds itself at module init). */
export function bindTokenSource(src: TokenSource): void {
  source = src;
}

/** Recover from a 401 on /api/data through the session store. */
export function recoverUnauthorized(): Promise<string | undefined> {
  return source.onUnauthorized();
}

const { apiUrl, projectKey, oidcClientId, oidcUrl, oidcScope } = blocksConfig();

// The auth SDK returns response bodies even on HTTP errors. Keep status information so a
// refused session cannot be mistaken for valid claims. Never include response bodies in errors.
async function hostedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  try {
    const response = await globalThis.fetch(input, { ...init, signal });
    if (!response.ok) throw new BlocksApiError(response.status, response.statusText, null);
    return response;
  } finally { clearTimeout(timeout); }
}

function inBrowser(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return !!loc && (loc.protocol === "http:" || loc.protocol === "https:");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The browser never calls the Blocks API itself: a request to the Blocks API origin goes to this app's own
 * /api/blocks bridge (same-origin, session cookie), without any authorization or project-key header.
 * Every other URL (presigned storage uploads) passes through untouched.
 */
function bridgedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const apiOrigin = originOf(apiUrl);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return globalThis.fetch(input, init);
  }
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
  // Both supported adapters keep tokens out of browser storage.
  accessToken: () => undefined,
  onUnauthorized: () => source.onUnauthorized(),
  ...(hostedLoginEnabled() && inBrowser() ? { oidc: { clientId: oidcClientId, url: oidcUrl, scope: oidcScope } } : {}),
  ...(inBrowser() ? { fetch: hostedLoginEnabled() ? hostedFetch : bridgedFetch } : {}),
});

// The service identity's token (client credentials). Warm sandboxes are shared by every caller, so the two
// maps below are the ONLY module state allowed under functions/**: they hold the service token and its
// in-flight request, never anything about a caller. Tokens and secrets are never logged or put in errors.
import type { FnEnv } from "./env";
import { OpError } from "./errors";
import type { SdkClient, SdkFactory } from "./sdk";

export interface Cached {
  token: string;
  expMs: number;
  claims: Record<string, unknown>;
}

const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

const RENEW_BEFORE_MS = 60_000;
const DEFAULT_TTL_S = 300;

export interface TokenProvider {
  token(): Promise<string>;
  claims(): Promise<Record<string, unknown>>;
  invalidate(): void;
}

/** Drops all cached tokens. Tests only. */
export function resetServiceTokens(): void {
  cache.clear();
  inflight.clear();
}

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

/** Longest the shared renewal may take; every caller waits on it, so a hung IAM must not hold them. */
export const TOKEN_FETCH_TIMEOUT_MS = 12_000;

async function fetchToken(env: FnEnv, sdk: SdkFactory, now: () => number): Promise<Cached> {
  let res: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = sdk({ apiUrl: env.apiUrl, xBlocksKey: env.tenant });
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { status: 408 })), TOKEN_FETCH_TIMEOUT_MS);
    });
    res = await Promise.race([client.auth.oidc.clientCredentials({ clientId: env.clientId, clientSecret: env.clientSecret }), limit]);
  } catch (error) {
    const status = statusOf(error);
    if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) throw new OpError("not_configured");
    throw new OpError("unavailable");
  } finally {
    clearTimeout(timer);
  }
  const body = res && typeof res === "object" ? (res as Record<string, unknown>) : {};
  const token = body.access_token ?? body.accessToken;
  if (typeof token !== "string" || !token) throw new OpError("not_configured");
  const claims = decodeClaims(token);
  const expiresIn = Number(body.expires_in);
  const expMs =
    typeof claims.exp === "number"
      ? claims.exp * 1000
      : now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TTL_S) * 1000;
  return { token, expMs, claims };
}

/**
 * A token cache the host owns. Host A keeps one for the whole process, so a loader that re-evaluates this module
 * (Vite's ssrLoadModule) cannot reset it; without one the module maps above are used.
 */
export interface TokenStore {
  cache: Map<string, Cached>;
  inflight: Map<string, Promise<Cached>>;
}

export function createTokenStore(): TokenStore {
  return { cache: new Map(), inflight: new Map() };
}

export interface TokenHooks {
  store?: TokenStore;
  /** Told once per load: served from the cache, or fetched (and how long the fetch took). */
  onLoad?(info: { fetchedMs: number | null }): void;
}

export function serviceTokens(env: FnEnv, sdk: SdkFactory, now: () => number = Date.now, hooks: TokenHooks = {}): TokenProvider {
  const key = `${env.apiUrl}|${env.clientId}`;
  const tokenCache = hooks.store?.cache ?? cache;
  const tokenInflight = hooks.store?.inflight ?? inflight;
  const load = async (): Promise<Cached> => {
    const hit = tokenCache.get(key);
    if (hit && hit.expMs - RENEW_BEFORE_MS > now()) {
      hooks.onLoad?.({ fetchedMs: null });
      return hit;
    }
    const began = Date.now();
    let pending = tokenInflight.get(key);
    if (!pending) {
      pending = fetchToken(env, sdk, now)
        .then((fresh) => {
          tokenCache.set(key, fresh);
          return fresh;
        })
        .finally(() => {
          tokenInflight.delete(key);
        });
      tokenInflight.set(key, pending);
    }
    let fresh: Cached;
    try {
      fresh = await pending;
    } catch (error) {
      // Renewal failed (IAM slow or down): keep serving the old token while it is still valid.
      if (hit && hit.expMs - 5_000 > now()) {
        hooks.onLoad?.({ fetchedMs: null });
        return hit;
      }
      throw error;
    }
    hooks.onLoad?.({ fetchedMs: Math.max(0, Date.now() - began) });
    return fresh;
  };
  return {
    token: async () => (await load()).token,
    claims: async () => ({ ...(await load()).claims }),
    invalidate: () => {
      tokenCache.delete(key);
    },
  };
}

/** A service-authenticated client; rebuilt when the token string changes (kept in the closure). */
export function serviceClient(env: FnEnv, sdk: SdkFactory, tokens: TokenProvider): () => Promise<SdkClient> {
  let current: { token: string; client: SdkClient } | null = null;
  return async () => {
    const token = await tokens.token();
    if (!current || current.token !== token) {
      current = { token, client: sdk({ apiUrl: env.apiUrl, xBlocksKey: env.tenant, accessToken: token }) };
    }
    return current.client;
  };
}

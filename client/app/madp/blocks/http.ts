// Auth transport: hosted mode uses the shared Blocks SDK; the historical local adapter
// uses /api/auth/*. Both expose the existing session-store response contract.

import { hostedLoginEnabled } from "./config";
import { hostedAuthCall } from "./oidc";

export interface AuthAnswer {
  status: number;
  body: unknown;
}

export const AUTH_CALL_TIMEOUT_MS = 15_000;

/** One same-origin call to /api/auth/<path>. Resolves null when the server was not reached (network error or timeout). */
export async function authCall(method: "GET" | "POST", path: string, payload?: unknown): Promise<AuthAnswer | null> {
  if (hostedLoginEnabled()) return hostedAuthCall(method, path, payload);
  const ctl = new AbortController();
  let wait: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<AuthAnswer> => {
        const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
        // Blocks shell integration: inject the genesis-os access token so the BFF can authenticate.
        try {
          const store = (window as unknown as Record<string, unknown>).__GENESIS_AUTH_STORE__;
          if (store && typeof store === "object" && "getState" in store) {
            const token = (store as { getState: () => Record<string, unknown> }).getState().accessToken as string | undefined;
            if (token) headers.authorization = `Bearer ${token}`;
          }
        } catch { /* ignore */ }
        const res = await fetch(`/api/auth/${path}`, {
          method,
          credentials: "same-origin",
          headers,
          body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
          signal: ctl.signal,
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* not JSON */
        }
        return { status: res.status, body };
      })(),
      new Promise<never>((_, reject) => {
        wait = setTimeout(() => {
          ctl.abort();
          reject(new Error("auth timeout"));
        }, AUTH_CALL_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (wait) clearTimeout(wait);
  }
}

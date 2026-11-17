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
        const res = await fetch(`/api/auth/${path}`, {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/json" },
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

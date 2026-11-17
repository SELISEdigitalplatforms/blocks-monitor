// The data cache for the Blocks gateway (2-6 s latency): fresh for 30 s, one retry; Blocks data is kept for the session per person, the defaults stay gateway-safe.
// This module must not import from ./session (the session clears this cache on sign-out).
import { QueryClient } from "@tanstack/react-query";

/** An auth failure (401/403) will not heal by asking again. */
function isAuthFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const code = e.status ?? e.statusCode ?? e.response?.status;
  return code === 401 || code === 403;
}

export function retryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && !isAuthFailure(error);
}

/** Data younger than this is not refetched when the window regains focus. */
export const FOCUS_FRESH_MS = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: retryQuery,
      refetchOnWindowFocus: (query) => Date.now() - query.state.dataUpdatedAt >= FOCUS_FRESH_MS,
    },
    mutations: { retry: 0 },
  },
});

/** Blocks data stays in memory for the session so a revisit renders at once (never written to any storage). */
export const SESSION_CACHE_MS = 8 * 60 * 60_000;
for (const root of ["ws", "me", "platform"]) queryClient.setQueryDefaults([root], { gcTime: SESSION_CACHE_MS });

let cacheOwner: string | null = null;

/** Cached data never survives a change of person: a different user clears the cache before taking ownership. */
export function claimCacheFor(userId: string): void {
  if (cacheOwner !== null && cacheOwner !== userId) queryClient.clear();
  cacheOwner = userId;
}

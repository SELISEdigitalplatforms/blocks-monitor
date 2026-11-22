// Host A's service token cache: one per process, created here (never inside functions/**) so that Vite's
// ssrLoadModule re-evaluating the function modules cannot reset it. The router fills it (refresh 60 s before
// expiry, one fetch at a time); it only ever holds the service identity's token, never a caller's.
export interface HostTokenStore {
  cache: Map<string, unknown>;
  inflight: Map<string, Promise<unknown>>;
}

export function createHostTokenStore(): HostTokenStore {
  return { cache: new Map(), inflight: new Map() };
}

// Per-user cache of the me.bootstrap answer in Host A (dev only): at most 30 s, dropped by any write.
export const BOOTSTRAP_CACHE_MAX_TTL_MS = 30_000;
const MAX_ENTRIES = 1000;

export interface BootstrapCache {
  key(userId: string, displayName: string): string;
  get(key: string): string | null;
  generation(): number;
  /** Stores the body unless a write invalidated the cache since `generation` was read. */
  set(key: string, body: string, generation: number): void;
  inflight(key: string): Promise<unknown> | undefined;
  share(key: string, promise: Promise<unknown>): void;
  invalidateAll(): void;
}

export function createBootstrapCache(opts: { ttlMs?: number; now?: () => number; maxEntries?: number } = {}): BootstrapCache {
  const now = opts.now ?? Date.now;
  const ttl = Math.min(BOOTSTRAP_CACHE_MAX_TTL_MS, Math.max(0, opts.ttlMs ?? BOOTSTRAP_CACHE_MAX_TTL_MS));
  const max = opts.maxEntries ?? MAX_ENTRIES;
  const entries = new Map<string, { body: string; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let gen = 0;
  return {
    key: (userId, displayName) => JSON.stringify([userId, displayName]),
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (hit.expires <= now()) {
        entries.delete(key);
        return null;
      }
      return hit.body;
    },
    generation: () => gen,
    set(key, body, generation) {
      if (generation !== gen) return;
      entries.delete(key);
      entries.set(key, { body, expires: now() + ttl });
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    inflight: (key) => pending.get(key),
    share(key, promise) {
      pending.set(key, promise);
      const clear = () => {
        if (pending.get(key) === promise) pending.delete(key);
      };
      promise.then(clear, clear);
    },
    invalidateAll() {
      gen += 1;
      entries.clear();
      // A bootstrap that started before the write must not be shared with one that starts after it.
      pending.clear();
    },
  };
}

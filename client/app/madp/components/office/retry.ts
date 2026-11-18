/** Loading the 3D chunk without silently dying (pure; no React, DOM or three imports). */

/** The error a failed lazy chunk raises (a network drop, a dev server re-optimizing, a redeploy that removed the old
 *  hashed file). Browsers word it differently; a runtime error inside the 3D floor is not one of these. */
export function isChunkLoadError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  const message = String((e as { message?: unknown } | null)?.message ?? e ?? "");
  if (name === "ChunkLoadError") return true;
  return /dynamically imported module|Importing a module script failed|Loading chunk .* failed|Outdated Optimize Dep|Unable to preload CSS|module script.*MIME type/i.test(message);
}

/** wait before attempt `attempt` (1-based retries): 400 ms, 800 ms, 1.6 s ... capped at 5 s */
export function backoffMs(attempt: number, baseMs = 400): number {
  return Math.min(5000, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Runs `load`, retrying chunk-load failures with a growing pause; any other error is thrown at once. */
export async function retryImport<T>(
  load: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (e) {
      if (attempt >= retries || !isChunkLoadError(e)) throw e;
      await wait(backoffMs(attempt + 1, opts.baseMs));
    }
  }
}

/** WebGL context-loss recovery: whether to rebuild the canvas again, given the times (ms) of earlier rebuilds.
 *  At most `max` rebuilds per `windowMs`; after that the floor plan stays and the person can retry. */
export function mayRebuild(rebuilds: readonly number[], now: number, max = 3, windowMs = 60_000): boolean {
  return rebuilds.filter((t) => now - t < windowMs).length < max;
}

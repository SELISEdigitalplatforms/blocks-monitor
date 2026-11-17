/** Bounded-concurrency map. Order is kept; no new starts after a failure; rejects with the first error once in-flight work settles. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
        return;
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  if (failed) throw firstError;
  return out;
}

/** Like mapPool, but every item is attempted and the outcomes are reported. */
export async function settlePool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return mapPool(items, limit, async (item, i): Promise<PromiseSettledResult<R>> => {
    try {
      return { status: "fulfilled", value: await fn(item, i) };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  });
}

// CLI authentication transitions share an operator token store. Serialize all
// provisioning and release calls in this host, not just calls within one job.
// Module reloads must not create a second queue while an old job is running.
const state = ((globalThis as Record<string, unknown>).__madpBlocksCliQueue ??= { tail: Promise.resolve() }) as { tail: Promise<unknown> };
export function serializedBlocks<T>(call: () => Promise<T>): Promise<T> {
  const task = state.tail.then(call);
  state.tail = task.catch(() => undefined);
  return task;
}

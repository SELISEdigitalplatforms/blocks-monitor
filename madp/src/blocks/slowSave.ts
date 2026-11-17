// Tracks writes that are taking long, so the top bar can say "Saving… SELISE Blocks is slow right now" (no error).
import { useSyncExternalStore } from "react";

export const SLOW_SAVE_AFTER_MS = 3_000;

interface Watch {
  slow: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const watches = new Set<Watch>();
const listeners = new Set<() => void>();
let current = false;

function refresh(): void {
  let next = false;
  for (const w of watches) if (w.slow) next = true;
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

/** Start watching one write; the returned stop is idempotent. */
export function watchSave(o: { afterMs?: number } = {}): () => void {
  const w: Watch = {
    slow: false,
    timer: setTimeout(() => {
      w.slow = true;
      refresh();
    }, o.afterMs ?? SLOW_SAVE_AFTER_MS),
  };
  watches.add(w);
  return () => {
    if (!watches.delete(w)) return;
    clearTimeout(w.timer);
    refresh();
  };
}

export function isSlowSaving(): boolean {
  return current;
}

export function subscribeSlowSaving(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSlowSaving(): boolean {
  return useSyncExternalStore(subscribeSlowSaving, isSlowSaving, () => false);
}

/** Tests only. */
export function resetSlowSaving(): void {
  for (const w of watches) clearTimeout(w.timer);
  watches.clear();
  refresh();
}

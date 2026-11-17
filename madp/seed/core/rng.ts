// Deterministic randomness: the same seed string always gives the same sequence, so a reset is reproducible.

/** FNV-1a over the joined parts (32 bit). */
export function hashOf(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join("\u0001");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Rand {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
  hex(len: number): string;
}

/** mulberry32 seeded from a string. */
export function rand(seed: string): Rand {
  let a = hashOf(seed) || 1;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)]!,
    chance: (p) => next() < p,
    hex: (len) => Array.from({ length: len }, () => Math.floor(next() * 16).toString(16)).join(""),
  };
}

/** A stable lowercase hex string for a name (for tokens, short ids and commit hashes in texts). */
export function hexOf(name: string, len: number): string {
  return rand(`hex:${name}`).hex(len);
}

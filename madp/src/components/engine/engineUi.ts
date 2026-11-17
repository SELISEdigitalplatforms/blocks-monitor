// Small pure helpers for the engine job components: elapsed time and safe output links.

/** "45 s", "2 min 05 s", "1 h 04 min"; anything not a positive number reads "0 s". */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const two = (n: number) => String(n).padStart(2, "0");
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${two(total % 60)} s`;
  return `${Math.floor(total / 3600)} h ${two(Math.floor((total % 3600) / 60))} min`;
}

/** Milliseconds from an ISO date-time to `now`; null when the date is missing or unreadable. */
export function elapsedSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export type OutputHref = { kind: "internal" | "external"; href: string };

/** An app path or an http(s) address; null for anything else (javascript:, data:, protocol-relative). */
export function safeOutputHref(href: string): OutputHref | null {
  if (typeof href !== "string") return null;
  if (href.startsWith("/")) return href[1] === "/" || href[1] === "\\" ? null : { kind: "internal", href };
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? { kind: "external", href } : null;
  } catch {
    return null;
  }
}

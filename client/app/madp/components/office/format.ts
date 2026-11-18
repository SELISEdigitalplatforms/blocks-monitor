/** Time helpers used by the office overlays (copied from MADP Studio's lib/format.ts). */

export function dur(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return "–";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export function since(iso?: string, now = Date.now()): string {
  if (!iso) return "–";
  return dur(Math.max(0, now - Date.parse(iso)) / 1000);
}

/** When each team thread was last opened, per project, in this browser only (a per-viewer convenience for the unread
 *  dot; nothing is shared). Storage can be missing or blocked: the dot then falls back to what waits for the person. */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { TeamContactId } from "./teamMessages";

type Seen = Partial<Record<TeamContactId, number>>;

const KEY = (projectId: string) => `madp-team-seen:${projectId}`;
const cache = new Map<string, Seen>();
const listeners = new Set<() => void>();

function read(projectId: string): Seen {
  const hit = cache.get(projectId);
  if (hit) return hit;
  let seen: Seen = {};
  try {
    const raw = localStorage.getItem(KEY(projectId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const k of ["analyst", "lead"] as const) {
        const t = (v as Record<string, unknown>)[k];
        if (typeof t === "number" && Number.isFinite(t)) seen[k] = t;
      }
    }
  } catch {
    seen = {};
  }
  cache.set(projectId, seen);
  return seen;
}

/** Marks a thread seen up to `at` (ms); never moves back. */
export function markSeen(projectId: string, contact: TeamContactId, at: number): void {
  if (!projectId || !Number.isFinite(at)) return;
  const now = read(projectId);
  if ((now[contact] ?? -Infinity) >= at) return;
  const next = { ...now, [contact]: at };
  cache.set(projectId, next);
  try { localStorage.setItem(KEY(projectId), JSON.stringify(next)); } catch { /* blocked storage: this session only */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The last-seen time of each thread of a project (null: never opened in this browser). */
export function useSeen(projectId: string): Record<TeamContactId, number | null> {
  const seen = useSyncExternalStore(subscribe, () => read(projectId), () => read(projectId));
  return { analyst: seen.analyst ?? null, lead: seen.lead ?? null };
}

/** The panel: open or not, which contact, and whether it was opened in this session (the questions are read from then on). */
export const useTeamPanel = create<{ open: boolean; contact: TeamContactId | null; session: number }>(() => ({ open: false, contact: null, session: 0 }));

export function openTeamPanel(contact: TeamContactId | null = null): void {
  useTeamPanel.setState((s) => ({ open: true, contact, session: s.session + 1 }));
}

export function closeTeamPanel(): void {
  useTeamPanel.setState({ open: false });
}

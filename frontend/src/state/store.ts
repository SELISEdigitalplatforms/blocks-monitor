/** The session store of this browser: who is signed in and the theme.
 *  Nothing else lives here: projects, requests and every business record are in SELISE Blocks (see src/blocks).
 *  The theme is kept in localStorage (other open tabs follow through storage events).
 *  All storage access is inside try/catch: the app still works when storage is blocked. */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { peopleVersion, personById, subscribePeople } from "@/data/people";
import type { Role } from "@/data/types";

/** v3: light by default everywhere (landing and app); older saved choices are not carried over. */
export const SESSION_KEY = "madp-factory-session-v3";

interface Session {
  personaId: string | null;
  theme: "light" | "dark";
  /** the public landing page has its own theme: light unless the visitor picks dark */
  landingTheme: "light" | "dark";
}

export interface DemoState extends Session {
  /** true while the browser refuses to save the session (full or blocked storage) */
  storageFailed: boolean;
  signIn: (personaId: string) => void;
  signOut: () => void;
  toggleTheme: () => void;
  toggleLandingTheme: () => void;
}

function read<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return isObj(v) ? (v as Partial<T>) : {};
  } catch {
    return {};
  }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { /* storage blocked */ return false; }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const asTheme = (v: unknown, d: "light" | "dark") => (v === "light" || v === "dark" ? v : d);

const session = read<Session>(SESSION_KEY);
// Older builds kept the guide bar's hidden flag in the session; it is gone, so rewrite the session without it on start.
if ("guideHidden" in session) write(SESSION_KEY, { theme: asTheme(session.theme, "light"), landingTheme: asTheme(session.landingTheme, "light") });
export const useDemo = create<DemoState>((set, get) => ({
  personaId: null,
  theme: asTheme(session.theme, "light"),
  landingTheme: asTheme(session.landingTheme, "light"),
  storageFailed: false,
  signIn: (personaId) => set({ personaId }),
  signOut: () => set({ personaId: null }),
  toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
  toggleLandingTheme: () => set({ landingTheme: get().landingTheme === "dark" ? "light" : "dark" }),
}));

// persist the session conveniences
useDemo.subscribe((s) => {
  if (!write(SESSION_KEY, { theme: s.theme, landingTheme: s.landingTheme })) {
    if (!s.storageFailed) useDemo.setState({ storageFailed: true });
  }
});

// another tab signed in/out or changed the theme
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.newValue || e.key !== SESSION_KEY) return;
    try {
      const next = JSON.parse(e.newValue) as Session;
      useDemo.setState({ theme: asTheme(next.theme, "light"), landingTheme: asTheme(next.landingTheme, "light") });
    } catch { /* ignore a partial write */ }
  });
}

export function currentRole(s: Pick<DemoState, "personaId">): Role | null {
  return s.personaId ? personById(s.personaId)?.role ?? null : null;
}

// the person is gone from the people lookup (signed out of Blocks): clear the persona
subscribePeople(() => {
  const id = useDemo.getState().personaId;
  if (id && !personById(id)) useDemo.setState({ personaId: null });
});

export const usePersona = () => {
  const id = useDemo((s) => s.personaId);
  useSyncExternalStore(subscribePeople, peopleVersion, peopleVersion);
  return id ? personById(id) ?? null : null;
};

/** true while the persona id does not resolve to a person yet */
export function usePersonaPending(): boolean {
  const id = useDemo((s) => s.personaId);
  useSyncExternalStore(subscribePeople, peopleVersion, peopleVersion);
  return !!id && !personById(id);
}

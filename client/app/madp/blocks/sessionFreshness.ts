// The signed-in person's own facts stay fresh during a session, not only at sign-in: the session profile (name, e-mail and
// the super admin flag, from IAM through GET /api/auth/session) and the platform permissions (me.access, read-only).
// They are read again
//   - at the calm pace (docs/FRESHNESS.md: every 5 min) while the tab is shown,
//   - when the window or the tab comes back (at most once per focus window, 30 s, like every other read),
//   - at once after the app's own role changes (refreshSessionAccess, called by those writes).
// The account button's role line, the Platform management entry and every permission check read that same session and
// workspace store, so they all follow one refresh. The session ping is the keep-alive's own (shared when both are due).
import { FRESHNESS_MS } from "./data/freshness";
import { FOCUS_FRESH_MS } from "./queryClient";
import { refreshNow, useSession } from "./session";
import { refreshAccess } from "./workspaces/sync";

/** The calm tier's pace: roles and names change only when someone edits them. */
export const SESSION_ACCESS_MS = FRESHNESS_MS.calm.busy;
/** How often the clock looks whether a read is due (a local check, no request). */
export const SESSION_ACCESS_TICK_MS = 60_000;

export interface SessionFreshnessDeps {
  /** The session profile again (the keep-alive ping; a 401 ends the session). */
  refreshProfile(): Promise<unknown>;
  /** The platform permissions again. */
  refreshAccess(): Promise<unknown>;
  signedIn(): boolean;
  now(): number;
}

const DEFAULT_DEPS: SessionFreshnessDeps = {
  refreshProfile: () => refreshNow(),
  refreshAccess: () => refreshAccess(),
  signedIn: () => useSession.getState().status === "signed-in",
  now: () => Date.now(),
};

let deps: SessionFreshnessDeps = DEFAULT_DEPS;
let lastAt = 0;
let inflight: Promise<void> | null = null;
let queued: Promise<void> | null = null;

function run(): Promise<void> {
  const d = deps;
  lastAt = d.now();
  const p = (async () => {
    try {
      await d.refreshProfile();
      if (d.signedIn()) await d.refreshAccess();
    } catch {
      /* each source keeps what it has; the next read tries again */
    }
  })().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

/**
 * Reads the profile and the platform permissions again now (after the app's own role change, for instance). A read that
 * is already running may have started before the change was saved, so one more follows it.
 */
export function refreshSessionAccess(): Promise<void> {
  if (!deps.signedIn()) return Promise.resolve();
  if (!inflight) return run();
  if (!queued) {
    queued = inflight.then(() => {
      queued = null;
      return deps.signedIn() ? run() : undefined;
    });
  }
  return queued;
}

/** A read when the last one is older than `ms` (and none runs): the focus and the clock use it. */
function readIfOlder(ms: number): void {
  if (inflight || !deps.signedIn() || deps.now() - lastAt < ms) return;
  void run();
}

type Listens = Pick<Window, "addEventListener" | "removeEventListener">;

let stopCurrent: (() => void) | null = null;

/** Starts the clock and the focus listeners (idempotent); returns the stop. */
export function startSessionFreshness(o: {
  win?: Listens | null;
  doc?: (Listens & { visibilityState?: DocumentVisibilityState }) | null;
  deps?: Partial<SessionFreshnessDeps>;
} = {}): () => void {
  if (stopCurrent) return stopCurrent;
  deps = { ...DEFAULT_DEPS, ...o.deps };
  const win = o.win !== undefined ? o.win : typeof window !== "undefined" ? window : null;
  const doc = o.doc !== undefined ? o.doc : typeof document !== "undefined" ? document : null;
  const shown = () => !doc || doc.visibilityState === undefined || doc.visibilityState === "visible";
  // a sign-in (or a restored session) has just read everything: the clock counts from there
  lastAt = deps.now();
  let wasSignedIn = useSession.getState().status === "signed-in";
  const unsubscribe = useSession.subscribe((s) => {
    const now = s.status === "signed-in";
    if (now && !wasSignedIn) lastAt = deps.now();
    wasSignedIn = now;
  });
  const onFocus = () => { if (shown()) readIfOlder(FOCUS_FRESH_MS); };
  const tick = setInterval(() => { if (shown()) readIfOlder(SESSION_ACCESS_MS); }, SESSION_ACCESS_TICK_MS);
  win?.addEventListener("focus", onFocus);
  doc?.addEventListener("visibilitychange", onFocus);
  const stop = () => {
    clearInterval(tick);
    win?.removeEventListener("focus", onFocus);
    doc?.removeEventListener("visibilitychange", onFocus);
    unsubscribe();
    deps = DEFAULT_DEPS;
    inflight = null;
    queued = null;
    stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}

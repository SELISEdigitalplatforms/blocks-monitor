// The signed-in person's own profile and platform permissions are read again during the session: every 5 min (the calm
// tier) while the tab is shown, when the window or tab comes back (at most once per 30 s focus window), and at once after
// the app's own role change (a read that was already running gets one more after it). Nothing while signed out or hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSession, type BlocksProfile } from "../../src/blocks/session";
import { SESSION_ACCESS_MS, refreshSessionAccess, startSessionFreshness } from "../../src/blocks/sessionFreshness";
import { FRESHNESS_MS } from "../../src/blocks/data/freshness";
import { FOCUS_FRESH_MS } from "../../src/blocks/queryClient";

const PROFILE: BlocksProfile = {
  userId: "u-1", email: "ada@example.org", firstName: "Ada", lastName: "Lovelace", displayName: "Ada Lovelace", roles: [], permissions: [], isSuperAdmin: false,
};

class Target {
  listeners = new Map<string, Set<() => void>>();
  visibilityState: DocumentVisibilityState = "visible";
  addEventListener(type: string, fn: () => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn); }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  fire(type: string) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn(); }
  count() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
}

let stop: (() => void) | null = null;
let reads: string[] = [];
let win: Target;
let doc: Target;

function start(o: { profile?: () => Promise<unknown>; access?: () => Promise<unknown> } = {}) {
  win = new Target();
  doc = new Target();
  stop = startSessionFreshness({
    win: win as unknown as Window,
    doc: doc as unknown as Document,
    deps: {
      now: () => Date.now(),
      signedIn: () => useSession.getState().status === "signed-in",
      refreshProfile: o.profile ?? (async () => { reads.push("profile"); }),
      refreshAccess: o.access ?? (async () => { reads.push("access"); }),
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T08:00:00Z"));
  reads = [];
  useSession.setState({ status: "signed-in", profile: PROFILE, notice: null });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  useSession.setState({ status: "restoring", profile: null, notice: null });
});

describe("the session's own facts while it runs", () => {
  it("reads at the calm tier's pace, the profile first and then the permissions", async () => {
    expect(SESSION_ACCESS_MS).toBe(FRESHNESS_MS.calm.busy);
    start();
    await vi.advanceTimersByTimeAsync(SESSION_ACCESS_MS - 60_000);
    expect(reads).toEqual([]); // signing in has just read them
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toEqual(["profile", "access"]);
    await vi.advanceTimersByTimeAsync(SESSION_ACCESS_MS);
    expect(reads).toEqual(["profile", "access", "profile", "access"]);
  });

  it("reads when the window or the tab comes back, at most once per focus window", async () => {
    start();
    win.fire("focus");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual([]); // the sign-in read is younger than 30 s
    await vi.advanceTimersByTimeAsync(FOCUS_FRESH_MS);
    win.fire("focus");
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["profile", "access"]);
    await vi.advanceTimersByTimeAsync(FOCUS_FRESH_MS);
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["profile", "access", "profile", "access"]);
  });

  it("reads nothing while the tab is hidden or nobody is signed in", async () => {
    start();
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(3 * SESSION_ACCESS_MS);
    win.fire("focus");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual([]);
    doc.visibilityState = "visible";
    useSession.setState({ status: "signed-out", profile: null });
    await vi.advanceTimersByTimeAsync(2 * SESSION_ACCESS_MS);
    doc.fire("visibilitychange");
    await refreshSessionAccess();
    expect(reads).toEqual([]);
  });

  it("a new sign-in counts as a fresh read", async () => {
    start();
    useSession.setState({ status: "signed-out", profile: null });
    await vi.advanceTimersByTimeAsync(SESSION_ACCESS_MS);
    useSession.setState({ status: "signed-in", profile: PROFILE });
    await vi.advanceTimersByTimeAsync(SESSION_ACCESS_MS - 60_000);
    expect(reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toEqual(["profile", "access"]);
  });

  it("after the app's own role change: at once, whatever the pace", async () => {
    start();
    await refreshSessionAccess();
    expect(reads).toEqual(["profile", "access"]);
    await refreshSessionAccess();
    expect(reads).toEqual(["profile", "access", "profile", "access"]);
  });

  it("a read already running may predate the change: exactly one more follows it", async () => {
    let release: () => void = () => undefined;
    let n = 0;
    start({
      profile: () => {
        reads.push(`profile-${++n}`);
        return n === 1 ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
      },
    });
    const first = refreshSessionAccess();
    const second = refreshSessionAccess();
    const third = refreshSessionAccess();
    expect(second).toBe(third);
    expect(reads).toEqual(["profile-1"]);
    release();
    await first;
    await second;
    expect(reads).toEqual(["profile-1", "access", "profile-2", "access"]);
  });

  it("a failed read keeps the clock going", async () => {
    start({ profile: async () => { reads.push("profile"); throw new Error("offline"); } });
    await refreshSessionAccess();
    expect(reads).toEqual(["profile"]);
    await vi.advanceTimersByTimeAsync(SESSION_ACCESS_MS);
    expect(reads).toEqual(["profile", "profile"]);
  });

  it("stops: no clock, no listeners", async () => {
    start();
    expect(win.count() + doc.count()).toBe(2);
    stop!();
    stop = null;
    expect(win.count() + doc.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(3 * SESSION_ACCESS_MS);
    expect(reads).toEqual([]);
  });
});

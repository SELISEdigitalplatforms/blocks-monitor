// The doorbell: a contentless "something changed" ring. The payload is never read; the ring only refreshes the bell.
import { useEffect, useRef } from "react";
import { invalidateBell } from "../workspaces/bell";
import { useSession } from "../session";
import { DOORBELL_METHOD, doorbellHubUrl } from "./config";
import { setDoorbellState } from "./state";
import { createHubTransport, type HubState, type HubTransport, type HubTransportFactory } from "./transport";

export const RING_DEBOUNCE_MS = 750;
export const RING_MIN_GAP_MS = 3_000;
export const RING_MAX_PER_MINUTE = 20;
export const RETRY_MS = 60_000;

export interface DoorbellDeps {
  hubUrl: () => string | null;
  createTransport: HubTransportFactory;
  invalidate: () => Promise<void>;
  isVisible?: () => boolean;
  retryMs?: number;
}

export function createDoorbell(deps: DoorbellDeps): { start(userId: string): void; stop(): void; ring(): void } {
  const retryMs = deps.retryMs ?? RETRY_MS;
  const visible = deps.isVisible ?? (() => true);
  let started = false;
  let generation = 0;
  let transport: HubTransport | null = null;
  let offs: Array<() => void> = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let slotTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let sent: number[] = [];

  const clearTimers = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (slotTimer) clearTimeout(slotTimer);
    if (retryTimer) clearTimeout(retryTimer);
    debounceTimer = slotTimer = retryTimer = null;
  };

  const fire = (): void => {
    slotTimer = null;
    if (!started) return;
    const now = Date.now();
    sent = sent.filter((t) => now - t < 60_000);
    let at = now;
    const last = sent[sent.length - 1];
    if (last !== undefined) at = Math.max(at, last + RING_MIN_GAP_MS);
    if (sent.length >= RING_MAX_PER_MINUTE) at = Math.max(at, (sent[sent.length - RING_MAX_PER_MINUTE] as number) + 60_000);
    if (at > now) {
      slotTimer = setTimeout(fire, at - now);
      return;
    }
    sent.push(now);
    void Promise.resolve()
      .then(() => deps.invalidate())
      .catch(() => undefined);
  };

  const ring = (): void => {
    if (!started) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!slotTimer) fire();
    }, RING_DEBOUNCE_MS);
  };

  const teardown = (): void => {
    generation += 1;
    const old = transport;
    const unsub = offs;
    transport = null;
    offs = [];
    for (const off of unsub) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    if (old) {
      try {
        void old.stop().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  };

  const scheduleRetry = (gen: number): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!started || gen !== generation) return;
      if (!visible()) {
        scheduleRetry(gen);
        return;
      }
      connect();
    }, retryMs);
  };

  const connect = (): void => {
    teardown();
    const url = deps.hubUrl();
    const t = url ? deps.createTransport(url) : null;
    if (!t) {
      setDoorbellState("off");
      return;
    }
    const gen = generation;
    transport = t;
    setDoorbellState("connecting");
    offs.push(t.on(DOORBELL_METHOD, () => ring()));
    offs.push(
      t.onState((s: HubState) => {
        if (!started || gen !== generation) return;
        if (s === "connected") setDoorbellState("live");
        else if (s === "connecting") setDoorbellState("connecting");
        else if (s === "reconnecting") setDoorbellState("polling");
        else {
          setDoorbellState("polling");
          scheduleRetry(gen);
        }
      }),
    );
    let pending: Promise<void>;
    try {
      pending = t.start();
    } catch {
      pending = Promise.reject(new Error("start"));
    }
    pending.catch(() => {
      if (!started || gen !== generation) return;
      setDoorbellState("polling");
      scheduleRetry(gen);
    });
  };

  return {
    start(_userId: string): void {
      started = false;
      teardown();
      clearTimers();
      sent = [];
      started = true;
      connect();
    },
    stop(): void {
      started = false;
      teardown();
      clearTimers();
      sent = [];
      setDoorbellState("off");
    },
    ring,
  };
}

const documentVisible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Mount once (Shell): rings the bell refresh while signed in. */
export function useDoorbell(): void {
  const { status, profile } = useSession();
  const uid = profile?.userId ?? "";
  const ref = useRef<ReturnType<typeof createDoorbell> | null>(null);
  if (ref.current === null) {
    ref.current = createDoorbell({
      hubUrl: doorbellHubUrl,
      createTransport: createHubTransport,
      invalidate: invalidateBell,
      isVisible: documentVisible,
    });
  }
  const signedIn = status === "signed-in" && uid !== "";
  useEffect(() => {
    const bell = ref.current;
    if (!bell || !signedIn) return undefined;
    bell.start(uid);
    return () => bell.stop();
  }, [signedIn, uid]);
}

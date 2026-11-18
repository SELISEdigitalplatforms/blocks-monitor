// Design brief text autosave: an 800 ms per-field debounce, flushed on blur, tab change and unmount.
// Each flush is one user action: one requestId. A failed save stays pending; retry re-sends with the SAME requestId
// so the server de-duplicates. The write itself is a Logic Function op (see mutations.ts); this file holds no write rights.
import { useEffect, useMemo, useRef, useState } from "react";
import { newRequestId } from "../fn";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export const AUTOSAVE_LABEL: Record<AutosaveStatus, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" };

export const AUTOSAVE_DELAY_MS = 800;

export interface AutosaveTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (h: unknown) => void;
}

export interface AutosaveOptions<T> {
  save: (value: T, requestId: string) => Promise<void>;
  delayMs?: number;
  newRequestId?: () => string;
  timers?: AutosaveTimers;
  onStatus?: (s: AutosaveStatus, error?: unknown) => void;
}

export interface Autosave<T> {
  set(value: T): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  dispose(): Promise<void>;
  status(): AutosaveStatus;
  /** the last failure; kept until a save of the latest value succeeds */
  error(): unknown;
}

const defaultTimers: AutosaveTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  const mint = opts.newRequestId ?? newRequestId;
  const timers = opts.timers ?? defaultTimers;
  let status: AutosaveStatus = "idle";
  let pending: { value: T } | null = null;
  let requestId: string | null = null; // set once a flush started; kept while the value stays pending after a failure
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let lastError: unknown = null;

  const setStatus = (s: AutosaveStatus) => {
    status = s;
    if (s === "saved") lastError = null;
    opts.onStatus?.(s, s === "error" ? lastError : undefined);
  };
  const stopTimer = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };

  async function send(): Promise<void> {
    while (running) await running; // a concurrent flush waits for the run in flight, then re-checks pending
    if (!pending) return;
    const sent = pending;
    const rid = requestId ?? (requestId = mint());
    setStatus("saving");
    let run!: Promise<void>;
    run = (async () => {
      await null; // `running` is assigned before the body continues
      try {
        await opts.save(sent.value, rid);
        if (pending === sent) {
          pending = null;
          requestId = null;
          setStatus("saved");
        } // else a newer value arrived while saving: status stays 'saving' until it is sent
      } catch (e) {
        lastError = e;
        setStatus("error");
      } finally {
        if (running === run) running = null;
      }
    })();
    running = run;
    await run;
    // a superseded run succeeded and nothing else will send the newer value
    if (pending && pending !== sent && status === "saving" && timer === null && !running) await send();
  }

  return {
    set(value) {
      if (!pending || pending.value !== value) requestId = null; // a changed value is a new action
      pending = { value };
      stopTimer();
      timer = timers.set(() => {
        timer = null;
        void send();
      }, delay);
    },
    async flush() {
      stopTimer();
      await send();
    },
    async retry() {
      stopTimer();
      await send();
    },
    async dispose() {
      stopTimer();
      await send();
    },
    status: () => status,
    error: () => lastError,
  };
}

/** React binding: flushes on unmount. Components also call flush() on blur and on tab change. */
export function useAutosave<T>(
  save: (value: T, requestId: string) => Promise<void>,
  opts: { delayMs?: number } = {},
): { status: AutosaveStatus; error: unknown; set: (v: T) => void; flush: () => Promise<void>; retry: () => Promise<void> } {
  const [state, setState] = useState<{ status: AutosaveStatus; error: unknown }>({ status: "idle", error: null });
  const saveRef = useRef(save);
  saveRef.current = save;
  const delayMs = opts.delayMs;
  const auto = useMemo(
    () => createAutosave<T>({ save: (v, id) => saveRef.current(v, id), delayMs, onStatus: (status, error) => setState({ status, error: status === "error" ? error : null }) }),
    [delayMs],
  );
  useEffect(() => () => void auto.dispose(), [auto]);
  return { status: state.status, error: state.error, set: auto.set, flush: auto.flush, retry: auto.retry };
}

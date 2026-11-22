/** Serialised autosave for one note: an 800 ms debounce, one save in flight, later edits coalesced into the next save. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AUTOSAVE_DELAY_MS } from "../../domain/docs";
import { t } from "@/i18n";

export type AutosaveStatus = "idle" | "saving" | "saved" | "failed";
export interface AutosaveSnapshot { status: AutosaveStatus; savedAt: number | null; unsaved: boolean }

export interface AutosaverOptions {
  /** Saves the CURRENT content; `version` is the edit counter the save was started for. */
  save: (version: number) => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Autosaver {
  edit(): void;
  flush(): void;
  retry(): void;
  /** Forgets unsaved edits (the text was replaced by the stored version). */
  discard(): void;
  dispose(): void;
  subscribe(listener: () => void): () => void;
  getStatus(): AutosaveSnapshot;
}

export function createAutosaver(opts: AutosaverOptions): Autosaver {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let version = 0;      // latest edit
  let saved = 0;        // latest version known saved
  let inFlight = false;
  let failed = false;
  let disposed = false;
  let savedAt: number | null = null;
  let timer: unknown = null;
  let snap: AutosaveSnapshot = { status: "idle", savedAt: null, unsaved: false };

  const publish = () => {
    const unsaved = version > saved;
    const status: AutosaveStatus = inFlight ? "saving" : failed ? "failed" : savedAt !== null && !unsaved ? "saved" : "idle";
    if (status === snap.status && savedAt === snap.savedAt && unsaved === snap.unsaved) return;
    snap = { status, savedAt, unsaved };
    listeners.forEach((l) => l());
  };
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  const run = () => {
    stopTimer();
    if (disposed || inFlight || version === saved) return;
    const v = version;
    inFlight = true;
    failed = false;
    publish();
    let p: Promise<void>;
    try { p = Promise.resolve(opts.save(v)); } catch (e) { p = Promise.reject(e); }
    p.then(
      () => {
        inFlight = false;
        saved = Math.max(saved, v);
        savedAt = now();
        publish();
        if (version > saved) run(); // edits arrived while saving: one coalesced follow-up
      },
      () => {
        inFlight = false;
        failed = true;
        publish();
      },
    );
  };

  return {
    edit() {
      if (disposed) return;
      version += 1;
      stopTimer();
      timer = setTimer(() => { timer = null; run(); }, AUTOSAVE_DELAY_MS);
      publish();
    },
    flush() { if (!failed) run(); },
    retry() { failed = false; run(); },
    discard() { stopTimer(); saved = version; failed = false; publish(); },
    dispose() { disposed = true; stopTimer(); listeners.clear(); },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    getStatus: () => snap,
  };
}

/** The status line text: "Saving…", "Saved · HH:MM", "Couldn't save." or nothing. */
export function statusLabel(s: AutosaveSnapshot): string {
  if (s.status === "saving") return t("analysis.business.saving", "Saving…");
  if (s.status === "failed") return t("analysis.business.autosave.failed", "Couldn't save.");
  if (s.status === "saved" && s.savedAt !== null) {
    const d = new Date(s.savedAt);
    return t("analysis.business.autosave.savedAt", "Saved · {time}", { time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` });
  }
  return "";
}

/** React wrapper: one autosaver per mount; `save` is always the latest closure. */
export function useAutosave(save: (version: number) => Promise<void>) {
  const ref = useRef(save);
  ref.current = save;
  const saver = useMemo(() => createAutosaver({ save: (v) => ref.current(v) }), []);
  useEffect(() => () => { saver.flush(); }, [saver]);
  const status = useSyncExternalStore(saver.subscribe, saver.getStatus, saver.getStatus);
  return { saver, status };
}

/** Playback of the recorded build for the Studio and the Timeline. Live (the default) follows the records as they
 *  arrive; Replay runs a clock from the build's start over its recorded window at 1x (the whole build in about
 *  REPLAY_SECONDS) or 4x, and every view shows the records up to that clock (focusAt / windowAt). Nothing is invented: a
 *  replay only ever shows recorded engine steps and ticket moves. It never writes, so anyone who can see the build may
 *  replay it. When the clock reaches the end it goes back to live (a running build) or to the full record. */
import { useEffect, useRef, useState } from "react";
import { replayPlay, replayTick, type BuildWindow, type ReplayClock, type ReplaySpeed } from "./model";

const TICK_MS = 100;
const LIVE: ReplayClock = { at: null, playing: false };

export interface BuildReplay {
  /** the replay clock (epoch ms), or null while the views follow the records live */
  at: number | null;
  playing: boolean;
  speed: ReplaySpeed;
  /** play from the start (or on from where the replay was paused) */
  play: () => void;
  pause: () => void;
  setSpeed: (s: ReplaySpeed) => void;
  /** stop the replay and follow the records again */
  live: () => void;
}

/** `window` is the recorded window of the build shown; `buildKey` resets the replay when another build is shown. */
export function useBuildReplay(window: BuildWindow | null, buildKey: string): BuildReplay {
  const [clock, setClock] = useState<ReplayClock>(LIVE);
  const [speed, setSpeed] = useState<ReplaySpeed>("1x");
  const win = useRef(window);
  win.current = window;
  const spd = useRef(speed);
  spd.current = speed;

  // another build shown, or no recorded window (yet): back to live
  const hasWindow = window !== null;
  useEffect(() => { setClock(LIVE); }, [buildKey, hasWindow]);

  useEffect(() => {
    if (!clock.playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1500, now - last);
      last = now;
      const w = win.current;
      if (w) setClock((c) => replayTick(c, w, dt, spd.current));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [clock.playing]);

  return {
    at: clock.at,
    playing: clock.playing,
    speed,
    play: () => { const w = win.current; if (w) setClock((c) => replayPlay(c, w)); },
    pause: () => setClock((c) => ({ ...c, playing: false })),
    setSpeed,
    live: () => setClock(LIVE),
  };
}

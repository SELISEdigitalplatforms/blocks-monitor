/** The time a page compares a change's "building" with (src/components/changes/changeFlow.ts buildLost): read again
 *  every 15 seconds while `live`, so a start that never queued a build turns into "did not reach the development
 *  team" by itself, without a timer per row. */
import { useEffect, useState } from "react";

const TICK_MS = 15_000;

export function useBuildClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

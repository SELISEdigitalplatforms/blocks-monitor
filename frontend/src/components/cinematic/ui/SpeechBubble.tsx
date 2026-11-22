/** The speaking guide's words in a bubble beside their head, streaming word by word while the mouth moves. It is a
 *  plain HTML overlay placed once per line (the head's spot projected from the place's resting view), with a fixed
 *  width, so nothing re-lays it out or repositions it per frame; the text is written by useReveal (no React state).
 *  While walking, the words become captions instead. */
import { memo } from "react";
import { useT } from "@/i18n";
import { STAGES } from "../journey/places";
import { useJourney } from "../journey/store";
import { projectAtRest } from "../world/viewport";
import { useReveal } from "./stream";
import { GUIDE_NAME, GuideAvatar } from "./Avatar";

/** the bubble's width (.cine-bubble), its gap to the head, the stage margin it never crosses (the overlays' 24 px) and
 *  the bottom of the top bar (logo, journey tracker, close button) it stays below */
const WIDTH = 320;
const GAP = 28;
const MARGIN = 24;
const TOP_BAR = 80;

/** The bubble's left edge (CSS): beside the head on the side with free space, held inside the stage so a narrower
 *  window (a narrower view of the same scene) never cuts it off. */
function bubbleLeft(headX: number, side: 1 | -1): string {
  const beside = side < 0 ? `calc(${headX}% - ${GAP + WIDTH}px)` : `calc(${headX}% + ${GAP}px)`;
  return `clamp(${MARGIN}px, ${beside}, calc(100% - ${WIDTH + MARGIN}px))`;
}

export const SpeechBubble = memo(function SpeechBubble({ aspect }: { aspect: number }) {
  useT();
  const line = useJourney((s) => s.line);
  const walk = useJourney((s) => s.walk);
  const stage = useJourney((s) => s.stage);
  const phase = useJourney((s) => s.phase);
  const live = line && !walk && phase === "journey" ? line : null;
  const { text, caret } = useReveal(live);
  if (!live) return null;
  const spot = STAGES[stage][live.who].at;
  const side = STAGES[stage].bubble[live.who];
  const at = projectAtRest(stage, [spot[0], 1.98, spot[2]], aspect);
  return (
    // the bubble ends just above the head's spot; where that spot is too high for it (a short window), it starts below
    // the top bar instead ("safe" alignment)
    <div
      key={live.id}
      className="cine-bubble-anchor pointer-events-none absolute flex flex-col"
      style={{ left: bubbleLeft(at.x, side), top: TOP_BAR, bottom: `${100 - at.y}%`, justifyContent: "safe flex-end" }}
    >
      <div className="cine-bubble cine-rise shrink-0">
        <div className="mb-1 flex items-center gap-2">
          <GuideAvatar who={live.who} size={22} />
          <span className="text-[12px] font-medium text-ink3">{GUIDE_NAME[live.who]}</span>
        </div>
        <p className="sr-only" aria-live="polite">{live.text}</p>
        <p aria-hidden className="text-[16.5px] leading-snug text-ink">
          <span ref={text} />
          <span ref={caret} className="cine-caret" />
        </p>
      </div>
    </div>
  );
});

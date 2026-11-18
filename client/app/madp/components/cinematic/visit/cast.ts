/** Who plays the two people of the office visit: the Studio's realistic cast (characters/registry.ts), the close-up
 *  files with facial blend shapes. No three.js here, so the page can start their download before the 3D floor loads. */
import { prefetchCharacters } from "../../characters/loader";
import type { CharacterId } from "../../characters/registry";

export const GUIDE_CAST: Readonly<Record<"assistant" | "pm", CharacterId>> = { assistant: "phillip", pm: "rajiv" };

/** Starts both people's downloads (one model file each and the shared clip file, cached for the visit). */
export function prefetchGuides(): void {
  prefetchCharacters([{ id: GUIDE_CAST.assistant, tier: "close" }, { id: GUIDE_CAST.pm, tier: "close" }]);
}

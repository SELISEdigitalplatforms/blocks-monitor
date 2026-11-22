/** The contract every landing-hero concept scene follows (the original light line, Story, Foundry, Blueprint),
 *  so the hero can swap them without changing anything else. Kept free of three.js. */
import { STATION_U } from "@/components/landing/heroLine";
import { t } from "@/i18n";

export interface ConceptSceneProps {
  /** draw frames; false while the hero is off screen or the tab is hidden */
  active: boolean;
  /** one composed still frame, no motion (prefers-reduced-motion) */
  still: boolean;
  /** the page canvas colour as "r g b" (follows the theme): the scene's background and fog, so the hero has no separate band */
  canvas: string;
  /** light theme: drawn in deep-blue ink on the light canvas instead of neon light on dark */
  light: boolean;
  /** called once the first frames are on screen */
  onReady?: () => void;
  /** every frame: legend index (0 brief, 1-8 stations, 9 live app) and the story position 0..1 (see headForLegend) */
  onProgress?: (index: number, head: number) => void;
  /** where the headline ends, as a fraction of the stage width; the focal elements stay to the right of it */
  textEdge?: number;
}

export type ConceptId = "story" | "foundry" | "blueprint" | "line";

/** the hero samples; each name and hint is read in the chosen language when it is used */
export const CONCEPTS: readonly { id: ConceptId; readonly label: string; readonly hint: string }[] = [
  {
    id: "story",
    get label() { return t("landing.samples.storyName", "Story"); },
    get hint() { return t("landing.samples.storyHint", "A brief becomes light, passes every agent gate and ships a live app"); },
  },
  {
    id: "foundry",
    get label() { return t("landing.samples.foundryName", "Foundry"); },
    get hint() { return t("landing.samples.foundryHint", "A neon production floor: feature packets through every scanner station"); },
  },
  {
    id: "blueprint",
    get label() { return t("landing.samples.blueprintName", "Blueprint"); },
    get hint() { return t("landing.samples.blueprintHint", "The scope draws itself as a hologram, solidifies under scans and beams up live"); },
  },
  {
    id: "line",
    get label() { return t("landing.samples.lineName", "Line"); },
    get hint() { return t("landing.samples.lineHint", "The original light line"); },
  },
];

export const DEFAULT_CONCEPT: ConceptId = "story";

export const isConcept = (v: string | null): v is ConceptId => CONCEPTS.some((c) => c.id === v);

/** The legend index for a story position (0 brief, 1-8 = 01 Planner ... deploy, 9 live app). */
export function legendIndexAt(head: number): number {
  if (head >= 0.995) return 9;
  let i = 0;
  for (let k = 0; k < STATION_U.length; k++) if (head >= STATION_U[k] - 0.012) i = k + 1;
  return i;
}

/** The story position at which a stage's work happens: station k (0 = 01 Planner ... 7 = deploy). */
export const stationHead = (k: number) => STATION_U[Math.max(0, Math.min(STATION_U.length - 1, k))];
